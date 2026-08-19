import { createClient } from 'jsr:@supabase/supabase-js@2';

/**
 * §7.5 — receives the customer's confirm or cancel.
 *
 * Two things matter here, and both are security rather than plumbing:
 *
 *   1. The request signature is verified against the app secret. This endpoint
 *      is public by necessity, and without verification anyone could confirm
 *      anyone's order — or cancel it, which returns coins and cancels stock.
 *   2. The order is identified by the TOKEN carried in the button payload, never
 *      by anything the sender says. Reaching this endpoint is not enough to
 *      confirm an order you were not sent.
 */

const encoder = new TextEncoder();

/** Constant-time compare: a fast reject leaks the signature one byte at a time. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function signatureIsValid(rawBody: string, header: string | null): Promise<boolean> {
  const secret = Deno.env.get('WHATSAPP_APP_SECRET');
  if (!secret || !header?.startsWith('sha256=')) return false;

  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const expected = [...new Uint8Array(mac)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  return timingSafeEqual(header.slice('sha256='.length), expected);
}

Deno.serve(async (req) => {
  // Meta's one-time subscription handshake.
  if (req.method === 'GET') {
    const url = new URL(req.url);
    const verifyToken = Deno.env.get('WHATSAPP_VERIFY_TOKEN');
    if (
      verifyToken &&
      url.searchParams.get('hub.mode') === 'subscribe' &&
      url.searchParams.get('hub.verify_token') === verifyToken
    ) {
      return new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 });
    }
    return new Response('forbidden', { status: 403 });
  }

  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  const rawBody = await req.text();
  if (!(await signatureIsValid(rawBody, req.headers.get('x-hub-signature-256')))) {
    return new Response('bad signature', { status: 401 });
  }

  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response('bad request', { status: 400 });
  }

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Meta nests the interesting part four levels down.
  const messages =
    (payload as any)?.entry?.[0]?.changes?.[0]?.value?.messages ?? [];

  for (const message of messages) {
    const buttonPayload: string | undefined =
      message?.button?.payload ?? message?.interactive?.button_reply?.id;

    if (!buttonPayload) continue;

    const [action, token] = String(buttonPayload).split(':');
    if (!token || (action !== 'confirm' && action !== 'cancel')) continue;

    const { error } = await db.rpc('respond_to_confirmation', {
      p_token: token,
      p_response: action === 'confirm' ? 'confirmed' : 'cancelled',
    });

    if (error) console.error('respond_to_confirmation failed:', error.message);
  }

  // Meta retries anything that is not a 200, so acknowledge even when a single
  // message inside the batch could not be matched.
  return new Response('ok', { status: 200 });
});
