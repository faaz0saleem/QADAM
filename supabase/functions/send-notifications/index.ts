import { createClient } from 'jsr:@supabase/supabase-js@2';

/**
 * §4, §7.2, §12 — delivers the queued notifications through Expo Push.
 *
 * "The user who is about to lose their coins is exactly the user who finally has
 * enough to want to spend them. That push notification is our single best
 * reactivation lever."
 *
 * The queue is written by `queue_expiry_warnings()` and `queue_streak_warnings()`
 * on a daily cron; this sends what is queued and stamps `sent_at`. Splitting the
 * two means a push outage delays a reminder rather than losing it, and the
 * unique key on (user, kind, dedupe_key) means a retry cannot nag anyone twice.
 *
 *   supabase functions deploy send-notifications
 */

const EXPO_PUSH = 'https://exp.host/--/api/v2/push/send';

interface Notification {
  id: string;
  user_id: string;
  kind: string;
  payload: Record<string, unknown>;
}

/** §9.6 applies to a notification as much as to a screen: plain, active, specific. */
function compose(n: Notification): { title: string; body: string } {
  const coins = Number(n.payload.coins ?? 0);
  const days = Number(n.payload.days_left ?? 0);
  const streak = Number(n.payload.streak ?? 0);
  const grouped = new Intl.NumberFormat('en-US').format(coins);

  switch (n.kind) {
    case 'coins_expiring':
      return {
        title: days <= 1 ? 'Your coins go today' : `${grouped} coins expiring`,
        body:
          days <= 0
            ? `${grouped} coins expire tonight. Spend them in the shop.`
            : days === 1
              ? `${grouped} coins expire tomorrow. Spend them in the shop.`
              : `${grouped} coins expire in ${days} days. Spend them in the shop.`,
      };
    case 'streak_at_risk':
      return {
        title: `${streak}-day streak`,
        body: `Walk today to keep it. It resets at midnight.`,
      };
    default:
      return { title: 'Qadam', body: 'Open the app to see what changed.' };
  }
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return new Response('forbidden', { status: 403 });
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: pending, error } = await db
    .from('notifications')
    .select('id, user_id, kind, payload')
    .is('sent_at', null)
    .order('created_at')
    .limit(500);

  if (error) return new Response(error.message, { status: 500 });
  if (!pending?.length) {
    return new Response(JSON.stringify({ sent: 0 }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  const { data: tokens } = await db
    .from('push_tokens')
    .select('user_id, token')
    .in('user_id', [...new Set(pending.map((n) => n.user_id))]);

  const byUser = new Map<string, string[]>();
  for (const t of tokens ?? []) {
    byUser.set(t.user_id, [...(byUser.get(t.user_id) ?? []), t.token]);
  }

  const messages: Array<Record<string, unknown>> = [];
  const sentIds: string[] = [];
  const unreachableIds: string[] = [];

  for (const n of pending as Notification[]) {
    const userTokens = byUser.get(n.user_id) ?? [];
    if (userTokens.length === 0) {
      // Nobody to deliver to. Stamp it anyway: leaving it queued means this
      // user's row is re-read on every run forever.
      unreachableIds.push(n.id);
      continue;
    }
    const { title, body } = compose(n);
    for (const to of userTokens) {
      messages.push({ to, title, body, sound: 'default', data: { kind: n.kind } });
    }
    sentIds.push(n.id);
  }

  // Expo accepts at most 100 messages per request.
  const failedTokens = new Set<string>();
  for (let i = 0; i < messages.length; i += 100) {
    const batch = messages.slice(i, i + 100);
    const res = await fetch(EXPO_PUSH, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(batch),
    });
    if (!res.ok) {
      console.error(`expo push batch failed: HTTP ${res.status}`);
      continue;
    }
    const json = await res.json();
    (json.data ?? []).forEach((ticket: { status: string; details?: { error?: string } }, index: number) => {
      if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
        failedTokens.add(String(batch[index]!.to));
      }
    });
  }

  // A device that uninstalled the app keeps returning DeviceNotRegistered until
  // its token is dropped, and Expo rate-limits senders that ignore it.
  if (failedTokens.size > 0) {
    await db.from('push_tokens').delete().in('token', [...failedTokens]);
  }

  const stamp = new Date().toISOString();
  if (sentIds.length) {
    await db.from('notifications').update({ sent_at: stamp }).in('id', sentIds);
  }
  if (unreachableIds.length) {
    await db.from('notifications').update({ sent_at: stamp }).in('id', unreachableIds);
  }

  return new Response(
    JSON.stringify({
      sent: sentIds.length,
      unreachable: unreachableIds.length,
      tokensDropped: failedTokens.size,
    }),
    { headers: { 'content-type': 'application/json' } },
  );
});
