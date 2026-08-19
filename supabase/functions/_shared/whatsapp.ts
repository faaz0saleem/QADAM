/**
 * README §7.5 — "WhatsApp confirmation before dispatch. Automated, with a
 * confirm/cancel button. Do not dispatch an unconfirmed COD order above PKR 3,000."
 *
 * The gate itself lives in the database, in set_order_status, so a courier
 * integration cannot forget it. This is only the message.
 *
 * Like attestation, it FAILS CLOSED: unconfigured means "not sent", never
 * "assume sent". An order that was never actually confirmed must not look
 * confirmed, because the whole point is that somebody said yes before we paid to
 * ship it.
 */
export interface ConfirmationRequest {
  phone: string;          // E.164
  orderId: string;
  totalPkr: number;
  itemCount: number;
  locale: 'en' | 'ur';
}

export interface SendResult {
  sent: boolean;
  reason: string;
  providerMessageId?: string;
}

const FAIL = (reason: string): SendResult => ({ sent: false, reason });

export async function sendOrderConfirmation(req: ConfirmationRequest): Promise<SendResult> {
  const phoneId = Deno.env.get('WHATSAPP_BUSINESS_PHONE_ID');
  const token = Deno.env.get('WHATSAPP_BUSINESS_TOKEN');
  const template = Deno.env.get('WHATSAPP_CONFIRM_TEMPLATE') ?? 'order_confirmation';

  if (!phoneId || !token) return FAIL('whatsapp not configured');

  try {
    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: req.phone,
        type: 'template',
        template: {
          name: template,
          // Urdu where we know the person reads it. A confirmation someone
          // cannot read is a parcel that comes back.
          language: { code: req.locale === 'ur' ? 'ur' : 'en' },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: String(req.itemCount) },
                { type: 'text', text: `PKR ${req.totalPkr.toLocaleString('en-US')}` },
              ],
            },
            {
              // The confirm/cancel buttons §7.5 asks for. The order id rides in
              // the payload so the webhook knows what was answered.
              type: 'button',
              sub_type: 'quick_reply',
              index: '0',
              parameters: [{ type: 'payload', payload: `confirm:${req.orderId}` }],
            },
            {
              type: 'button',
              sub_type: 'quick_reply',
              index: '1',
              parameters: [{ type: 'payload', payload: `cancel:${req.orderId}` }],
            },
          ],
        },
      }),
    });

    if (!res.ok) return FAIL(`whatsapp http ${res.status}`);
    const body = await res.json();
    return { sent: true, reason: 'ok', providerMessageId: body?.messages?.[0]?.id };
  } catch (e) {
    return FAIL(`whatsapp unreachable: ${e instanceof Error ? e.message : 'unknown'}`);
  }
}
