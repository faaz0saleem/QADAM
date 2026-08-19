import { createClient } from 'jsr:@supabase/supabase-js@2';

/**
 * §7.8 — AdMob server-side verification.
 *
 * Google calls this once a rewarded video is genuinely watched. It replaces a
 * client-callable claim, which was worth 90 coins a day to anyone willing to
 * call it three times without watching anything — small per user, and exactly
 * the throughput a farm is built for.
 *
 * The callback arrives as a GET with the reward parameters in the query string
 * and an ECDSA signature over everything before `&signature=`. We verify that
 * signature against Google's published keys. An unverifiable callback pays
 * nothing, for the same reason the step attestation fails closed: if a bad
 * signature paid out, forging one would be unnecessary.
 *
 * Set the SSV URL in the AdMob console to this function, and pass the user's id
 * as `user_id` in the ad request's custom data.
 *
 *   supabase functions deploy verify-ad-reward --no-verify-jwt
 */

const KEY_URL = 'https://gstatic.com/admob/reward/verifier-keys.json';

interface VerifierKey {
  keyId: number;
  pem: string;
  base64: string;
}

let keyCache: { fetchedAt: number; keys: VerifierKey[] } | null = null;

async function verifierKeys(): Promise<VerifierKey[]> {
  // Google rotates these. An hour is well inside their rotation window and
  // keeps us from fetching on every impression.
  if (keyCache && Date.now() - keyCache.fetchedAt < 3_600_000) return keyCache.keys;

  const res = await fetch(KEY_URL);
  if (!res.ok) throw new Error(`admob verifier keys: HTTP ${res.status}`);
  const json = await res.json();
  keyCache = { fetchedAt: Date.now(), keys: json.keys ?? [] };
  return keyCache.keys;
}

const b64urlToBytes = (s: string): Uint8Array => {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(
    s.length + ((4 - (s.length % 4)) % 4),
    '=',
  );
  return Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0));
};

/**
 * AdMob signs the query string up to but excluding `&signature=`, and the
 * signature is DER-encoded ECDSA over P-256. WebCrypto wants the raw r||s form,
 * so the DER has to be unpacked.
 */
function derToRaw(der: Uint8Array): Uint8Array {
  let offset = 2;
  if (der[1]! & 0x80) offset += der[1]! & 0x7f;

  const readInt = (): Uint8Array => {
    offset += 1; // 0x02
    let length = der[offset]!;
    offset += 1;
    let value = der.slice(offset, offset + length);
    offset += length;
    // Strip a leading zero added to keep the integer positive, or left-pad to 32.
    while (value.length > 32 && value[0] === 0) value = value.slice(1);
    if (value.length < 32) {
      const padded = new Uint8Array(32);
      padded.set(value, 32 - value.length);
      value = padded;
    }
    return value;
  };

  const r = readInt();
  const s = readInt();
  const raw = new Uint8Array(64);
  raw.set(r, 0);
  raw.set(s, 32);
  return raw;
}

async function signatureIsValid(url: URL): Promise<boolean> {
  const query = url.search.slice(1);
  const signatureAt = query.indexOf('&signature=');
  if (signatureAt === -1) return false;

  const signedPortion = query.slice(0, signatureAt);
  const signature = url.searchParams.get('signature');
  const keyId = url.searchParams.get('key_id');
  if (!signature || !keyId) return false;

  const key = (await verifierKeys()).find((k) => String(k.keyId) === keyId);
  if (!key) return false;

  const publicKey = await crypto.subtle.importKey(
    'spki',
    Uint8Array.from(atob(key.base64), (ch) => ch.charCodeAt(0)),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );

  return crypto.subtle.verify(
    { name: 'ECDSA', hash: 'SHA-256' },
    publicKey,
    derToRaw(b64urlToBytes(signature)),
    new TextEncoder().encode(signedPortion),
  );
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  let valid = false;
  try {
    valid = await signatureIsValid(url);
  } catch (e) {
    console.error('ssv verification error:', e instanceof Error ? e.message : e);
  }

  // A forged or unverifiable callback pays nothing and says nothing about why.
  if (!valid) return new Response('', { status: 403 });

  const userId = url.searchParams.get('user_id');
  const transactionId = url.searchParams.get('transaction_id');
  if (!userId || !transactionId) return new Response('', { status: 400 });

  const db = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { error } = await db.rpc('grant_verified_ad_reward', {
    p_user: userId,
    p_transaction_id: transactionId,
    p_ad_network: url.searchParams.get('ad_network'),
  });

  if (error) {
    console.error('grant_verified_ad_reward failed:', error.message);
    // 500 so AdMob retries; the transaction id makes the retry idempotent.
    return new Response('', { status: 500 });
  }

  return new Response('', { status: 200 });
});
