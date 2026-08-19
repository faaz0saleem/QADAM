/**
 * §7.5 — the pre-dispatch confirmation.
 *
 * Two backends behind one function, because §2 says WhatsApp Business API "or
 * Twilio" and which one we get first depends on approvals we do not control.
 * Meta's Cloud API is cheaper per message; Twilio is faster to get running.
 *
 * The message is a TEMPLATE with two quick-reply buttons. It has to be: outside
 * a 24-hour customer-service window, Meta only delivers approved templates, and
 * an order confirmation is always outside that window because the customer has
 * not messaged us.
 */

export interface ConfirmationMessage {
  to: string;
  orderId: string;
  totalPkr: number;
  itemCount: number;
  /** Round-trips through the buttons so the webhook knows which order replied. */
  token: string;
}

export interface Sender {
  readonly name: 'meta' | 'twilio';
  sendConfirmation(message: ConfirmationMessage): Promise<void>;
}

const meta: Sender = {
  name: 'meta',
  async sendConfirmation(message) {
    const phoneNumberId = Deno.env.get('WHATSAPP_PHONE_NUMBER_ID');
    const token = Deno.env.get('WHATSAPP_ACCESS_TOKEN');
    const template = Deno.env.get('WHATSAPP_TEMPLATE_NAME') ?? 'order_confirmation';
    if (!phoneNumberId || !token) throw new Error('WhatsApp Cloud API is not configured');

    const res = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: message.to.replace(/^\+/, ''),
        type: 'template',
        template: {
          name: template,
          language: { code: 'en' },
          components: [
            {
              type: 'body',
              parameters: [
                { type: 'text', text: String(message.itemCount) },
                { type: 'text', text: new Intl.NumberFormat('en-US').format(message.totalPkr) },
              ],
            },
            // The token rides in the button payload rather than in the visible
            // text, so the webhook can identify the order without trusting
            // anything the sender types.
            {
              type: 'button',
              sub_type: 'quick_reply',
              index: '0',
              parameters: [{ type: 'payload', payload: `confirm:${message.token}` }],
            },
            {
              type: 'button',
              sub_type: 'quick_reply',
              index: '1',
              parameters: [{ type: 'payload', payload: `cancel:${message.token}` }],
            },
          ],
        },
      }),
    });

    if (!res.ok) {
      throw new Error(`whatsapp send failed: HTTP ${res.status} ${await res.text()}`);
    }
  },
};

const twilio: Sender = {
  name: 'twilio',
  async sendConfirmation(message) {
    const sid = Deno.env.get('TWILIO_ACCOUNT_SID');
    const authToken = Deno.env.get('TWILIO_AUTH_TOKEN');
    const from = Deno.env.get('TWILIO_WHATSAPP_FROM');
    const contentSid = Deno.env.get('TWILIO_CONTENT_SID');
    if (!sid || !authToken || !from) throw new Error('Twilio is not configured');

    const body = new URLSearchParams({
      From: `whatsapp:${from}`,
      To: `whatsapp:${message.to}`,
    });
    if (contentSid) {
      body.set('ContentSid', contentSid);
      body.set('ContentVariables', JSON.stringify({
        1: String(message.itemCount),
        2: new Intl.NumberFormat('en-US').format(message.totalPkr),
        3: message.token,
      }));
    } else {
      body.set(
        'Body',
        `Your order of ${message.itemCount} item(s) for PKR ` +
        `${new Intl.NumberFormat('en-US').format(message.totalPkr)} is ready to ship. ` +
        'Reply CONFIRM to send it, or CANCEL to stop it.',
      );
    }

    const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${btoa(`${sid}:${authToken}`)}`,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!res.ok) throw new Error(`twilio send failed: HTTP ${res.status} ${await res.text()}`);
  },
};

export function getSender(): Sender {
  return (Deno.env.get('WHATSAPP_PROVIDER') ?? 'meta') === 'twilio' ? twilio : meta;
}
