import { createClient } from 'jsr:@supabase/supabase-js@2';
import { getCourier } from '../_shared/courier/index.ts';

/**
 * §7.5 — books a confirmed order with the courier.
 *
 * The gate on unconfirmed COD is in the database (`set_order_status`), not here.
 * That is deliberate: this function is one path to dispatch, and a rule that
 * matters this much should not depend on which path was taken.
 *
 *   supabase functions deploy dispatch-order
 *   then schedule it every 10 minutes, or call it from an admin action.
 */
Deno.serve(async (req) => {
  const secret = Deno.env.get('CRON_SECRET');
  if (!secret || req.headers.get('x-cron-secret') !== secret) {
    return new Response('forbidden', { status: 403 });
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  let courier;
  try {
    courier = await getCourier();
  } catch (e) {
    return new Response(e instanceof Error ? e.message : 'no courier', { status: 503 });
  }

  const { data: ready, error } = await db
    .from('orders')
    .select('id, total_pkr, payment_method, address, phone, user_id, users(name)')
    .eq('status', 'confirmed')
    .is('tracking_number', null)
    .limit(25);

  if (error) return new Response(error.message, { status: 500 });

  let booked = 0;
  const failures: string[] = [];

  for (const order of ready ?? []) {
    const address = (order.address ?? {}) as Record<string, string>;
    try {
      const { count } = await db
        .from('order_items')
        .select('id', { count: 'exact', head: true })
        .eq('order_id', order.id);

      const booking = await courier.book({
        orderId: order.id,
        // COD collects the total; a prepaid order collects nothing.
        codAmountPkr: order.payment_method === 'cod' ? order.total_pkr : 0,
        // A real weight comes from the products once we carry one. Until then
        // this is the courier's minimum slab, which is what they bill anyway.
        weightGrams: 500,
        pieces: count ?? 1,
        consignee: {
          name: (order.users as { name: string } | null)?.name ?? 'Customer',
          phone: order.phone,
          address: [address.line1, address.line2].filter(Boolean).join(', '),
          city: address.city ?? 'Lahore',
        },
      });

      await db
        .from('orders')
        .update({
          courier: courier.name,
          tracking_number: booking.trackingNumber,
          courier_charge_pkr: booking.bookedChargePkr,
        })
        .eq('id', order.id);

      // Only after the booking succeeded. An order marked dispatched without a
      // parcel behind it is worse than one that ships an hour late.
      await db.rpc('set_order_status', { p_order: order.id, p_status: 'dispatched' });
      booked += 1;
    } catch (e) {
      failures.push(`${order.id}: ${e instanceof Error ? e.message : e}`);
    }
  }

  if (failures.length) console.error('dispatch failures:', failures.join('; '));

  return new Response(JSON.stringify({ booked, failed: failures.length }), {
    headers: { 'content-type': 'application/json' },
  });
});
