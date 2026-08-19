// §7.5 — send the WhatsApp confirmation for COD orders awaiting one.
//
// Run from cron. It only ever asks; the answer arrives at order-webhook, and the
// database is what refuses to dispatch an unconfirmed order over the threshold.
import { serviceClient, json } from '../_shared/supabase.ts';
import { sendOrderConfirmation } from '../_shared/whatsapp.ts';

interface PendingOrder {
  id: string;
  phone: string;
  total_pkr: number;
  item_count: number;
  locale: 'en' | 'ur';
}

Deno.serve(async () => {
  const db = serviceClient();

  const { data, error } = await db.rpc('orders_awaiting_confirmation');
  if (error) {
    console.error('orders_awaiting_confirmation failed', error);
    return json({ error: 'unavailable' }, 503);
  }

  const orders = (data ?? []) as PendingOrder[];
  let sent = 0;

  for (const order of orders) {
    const result = await sendOrderConfirmation({
      phone: order.phone,
      orderId: order.id,
      totalPkr: order.total_pkr,
      itemCount: order.item_count,
      locale: order.locale,
    });

    // Recorded either way. A confirmation we failed to send is worth seeing:
    // the parcel is sitting still and nobody has been asked anything.
    await db.rpc('record_confirmation_attempt', {
      p_order_id: order.id,
      p_sent: result.sent,
      p_detail: result.reason,
    });

    if (result.sent) sent++;
  }

  return json({ considered: orders.length, sent });
});
