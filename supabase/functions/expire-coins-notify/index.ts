// README §4 — "the user who is about to lose their coins is exactly the user who
// finally has enough to want to spend them. That push notification is our single
// best reactivation lever."
//
// Runs daily at 10:00 PKT from pg_cron. Bilingual from day one (§9.3).
// Copy follows §9.6: sentence case, plain verbs, and never the words points,
// rewards, cashback or earn money.
import { serviceClient, json } from '../_shared/supabase.ts';
import { sendPush, formatCount, type PushMessage } from '../_shared/push.ts';

interface Row {
  user_id: string;
  coins: number;
  expires_at: string;
  batch_id: string;
  token: string;
  platform: string;
  locale: string;
}

const HORIZON_DAYS = 7;

Deno.serve(async () => {
  const db = serviceClient();

  const { data, error } = await db.rpc('coins_expiring_soon', {
    p_days: HORIZON_DAYS,
  });
  if (error) {
    console.error('coins_expiring_soon failed', error);
    return json({ error: 'unavailable' }, 503);
  }

  const rows: Row[] = data ?? [];
  if (rows.length === 0) return json({ sent: 0, considered: 0 });

  const messages: PushMessage[] = rows.map((r) => {
    const days = daysUntil(r.expires_at);
    const coins = formatCount(r.coins);
    return {
      to: r.token,
      ...(r.locale === 'ur' ? urdu(coins, days) : english(coins, days)),
      data: { screen: 'wallet', batch_id: r.batch_id },
    };
  });

  const outcome = await sendPush(messages);

  // Record what went out before worrying about failures: sending twice is worse
  // than missing one, and tomorrow's run picks up anything genuinely missed.
  await db.from('notifications_sent').upsert(
    rows.map((r) => ({ user_id: r.user_id, kind: 'coins_expiring', key: r.batch_id })),
    { onConflict: 'user_id,kind,key', ignoreDuplicates: true },
  );

  if (outcome.invalidTokens.length > 0) {
    await db.from('push_tokens').delete().in('token', outcome.invalidTokens);
  }

  return json({ considered: rows.length, ...outcome });
});

function english(coins: string, days: number) {
  return {
    title: days <= 1 ? `${coins} coins expire today` : `${coins} coins expire in ${days} days`,
    body: 'Use them on your next order before they go.',
  };
}

function urdu(coins: string, days: number) {
  return {
    title: days <= 1 ? `${coins} سکے آج ختم ہو رہے ہیں` : `${coins} سکے ${days} دن میں ختم ہو رہے ہیں`,
    body: 'ختم ہونے سے پہلے اپنے اگلے آرڈر پر استعمال کریں۔',
  };
}

function daysUntil(iso: string): number {
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / 86_400_000));
}
