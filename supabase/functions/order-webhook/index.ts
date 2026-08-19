// §7.5 — the replies: a customer confirming or cancelling on WhatsApp, and the
// courier telling us what happened at the door.
//
// This endpoint decides whether coins are spent or BURNED, so it verifies before
// it believes anything. An unverified caller here could burn somebody's three
// months of walking, or hand out a free parcel.
import { serviceClient, json } from '../_shared/supabase.ts';
import { activeCourier } from '../_shared/courier.ts';

/** Constant-time compare, so a shared secret cannot be guessed a byte at a time. */
function secretMatches(provided: string | null, expected: string): boolean {
  if (!provided || provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const expected = Deno.env.get('ORDER_WEBHOOK_SECRET');
  if (!expected) {
    console.error('ORDER_WEBHOOK_SECRET is not set — refusing every callback');
    return json({ error: 'unavailable' }, 503);
  }
  if (!secretMatches(req.headers.get('x-qadam-signature'), expected)) {
    return json({ error: 'forbidden' }, 403);
  }

  let body: { source?: string; payload?: string; order_id?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  const db = serviceClient();

  // ── a customer answering the confirmation ────────────────────────────────
  if (body.source === 'whatsapp' && body.payload) {
    const [action, orderId] = body.payload.split(':');
    if (!orderId) return json({ error: 'bad payload' }, 400);

    const to = action === 'confirm' ? 'confirmed' : action === 'cancel' ? 'cancelled' : null;
    if (!to) return json({ error: 'unknown action' }, 400);

    const { data, error } = await db.rpc('set_order_status', { p_order_id: orderId, p_to: to });
    if (error) {
      // An invalid transition is not an error worth retrying — the parcel has
      // already moved on, and the reply arrived late.
      console.warn('whatsapp reply could not be applied', { orderId, to, error: error.message });
      return json({ applied: false });
    }
    return json(data);
  }

  // ── the courier telling us what happened ─────────────────────────────────
  if (body.source === 'courier' && body.order_id && body.status) {
    const normalised = activeCourier().normaliseStatus(body.status);

    // 'unknown' is not mapped onto anything. Guessing here spends coins that
    // should have been burned, or burns coins that should have been spent.
    const to =
      normalised === 'delivered' ? 'delivered'
      : normalised === 'refused' ? 'refused'
      : normalised === 'returned' ? 'returned'
      : normalised === 'in_transit' ? 'dispatched'
      : null;

    if (!to) {
      console.warn('unmapped courier status, ignoring', { status: body.status });
      return json({ applied: false, reason: 'unmapped_status' });
    }

    const { data, error } = await db.rpc('set_order_status', {
      p_order_id: body.order_id,
      p_to: to,
    });
    if (error) {
      console.warn('courier update could not be applied', { error: error.message });
      return json({ applied: false });
    }
    return json(data);
  }

  return json({ error: 'unrecognised callback' }, 400);
});
