import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getSender, ConfirmationMessage } from '../_shared/whatsapp.ts';

/**
 * §7.5 — sends the queued pre-dispatch confirmations.
 *
 * Runs on a schedule rather than inline with checkout, so a WhatsApp outage
 * cannot fail an order that is otherwise fine. The database already refuses to
 * dispatch a COD order above PKR 3,000 without a confirmation, so a delayed
 * message delays a shipment; it never ships something unconfirmed.
 *
 *   supabase functions deploy send-confirmations
 *   then schedule it every 5 minutes (see supabase/cron.sql)
 */
Deno.serve(async (req) => {
  // Scheduled invocation only. Nothing here should be reachable by a user.
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return new Response('forbidden', { status: 403 });
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: pending, error } = await db
    .from('order_confirmations')
    .select('id, token, phone, attempts, order_id, orders(total_pkr)')
    .is('sent_at', null)
    .lt('attempts', 3)
    .limit(50);

  if (error) return new Response(error.message, { status: 500 });

  const sender = getSender();
  let sent = 0;
  let failed = 0;

  for (const row of pending ?? []) {
    const { count } = await db
      .from('order_items')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', row.order_id);

    const message: ConfirmationMessage = {
      to: row.phone,
      orderId: row.order_id,
      totalPkr: (row.orders as { total_pkr: number } | null)?.total_pkr ?? 0,
      itemCount: count ?? 1,
      token: row.token,
    };

    try {
      await sender.sendConfirmation(message);
      await db.from('order_confirmations')
        .update({ sent_at: new Date().toISOString(), attempts: row.attempts + 1 })
        .eq('id', row.id);
      sent += 1;
    } catch (e) {
      // Count the attempt so a permanently bad number stops after three tries
      // rather than being retried until the end of time.
      await db.from('order_confirmations')
        .update({ attempts: row.attempts + 1 })
        .eq('id', row.id);
      console.error(`confirmation ${row.id} failed:`, e instanceof Error ? e.message : e);
      failed += 1;
    }
  }

  return new Response(JSON.stringify({ sent, failed }), {
    headers: { 'content-type': 'application/json' },
  });
});
