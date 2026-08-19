// README §7.8 — AdMob server-side verification for rewarded video.
//
// Google calls this with a signed query string. We verify the ECDSA signature
// against Google's published verifier keys before crediting anything, because
// this endpoint is public by necessity and an unverified one is a coin faucet.
//
// The reward amount in Google's callback is IGNORED. Coins come from
// private.app_config, server-side (§13.2).
import { serviceClient, json } from '../_shared/supabase.ts';

const VERIFIER_KEYS_URL = 'https://gstatic.com/admob/reward/verifier-keys.json';

interface VerifierKey {
  keyId: number;
  pem: string;
  base64: string;
}

let keyCache: { fetchedAt: number; keys: VerifierKey[] } | null = null;

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const query = url.search.startsWith('?') ? url.search.slice(1) : url.search;

  // Google signs everything before "&signature=". Order matters, so operate on
  // the raw query string rather than a re-serialised URLSearchParams.
  const sigIndex = query.indexOf('&signature=');
  if (sigIndex < 0) return json({ error: 'unsigned' }, 400);

  const signedContent = query.slice(0, sigIndex);
  const params = new URLSearchParams(query);
  const signature = params.get('signature');
  const keyId = params.get('key_id');
  const userId = params.get('user_id');
  const transactionId = params.get('transaction_id');

  if (!signature || !keyId || !userId || !transactionId) return json({ error: 'incomplete' }, 400);

  const ok = await verifySignature(signedContent, signature, keyId);
  if (!ok) {
    console.warn('admob ssv signature rejected', { keyId, transactionId });
    return json({ error: 'bad signature' }, 403);
  }

  const db = serviceClient();
  const { data, error } = await db.rpc('credit_rewarded_ad', {
    p_user_id: userId,
    p_network_txn_id: transactionId,
    p_placement: params.get('custom_data') === 'wallet' ? 'wallet' : 'earn_home',
  });

  if (error) {
    console.error('credit_rewarded_ad failed', error);
    return json({ error: 'unavailable' }, 503);
  }

  // Google wants a 200 to consider the callback delivered. A duplicate is a
  // success from its point of view — it simply was not credited again.
  return json(data);
});

async function verifySignature(content: string, signatureB64: string, keyId: string): Promise<boolean> {
  const keys = await verifierKeys();
  const key = keys.find((k) => String(k.keyId) === keyId);
  if (!key) return false;

  try {
    const publicKey = await crypto.subtle.importKey(
      'spki',
      decodeBase64(key.base64),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    // AdMob signs with DER-encoded ECDSA; Web Crypto verifies raw r||s.
    const der = decodeBase64(signatureB64.replace(/-/g, '+').replace(/_/g, '/'));
    const raw = derToRawEcdsa(der);
    if (!raw) return false;

    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      publicKey,
      raw,
      new TextEncoder().encode(content),
    );
  } catch (e) {
    console.error('signature verification threw', e);
    return false;
  }
}

async function verifierKeys(): Promise<VerifierKey[]> {
  // Google rotates these rarely; an hour of caching is plenty and keeps a burst
  // of callbacks from hammering gstatic.
  if (keyCache && Date.now() - keyCache.fetchedAt < 3_600_000) return keyCache.keys;

  const res = await fetch(VERIFIER_KEYS_URL);
  if (!res.ok) throw new Error(`verifier keys http ${res.status}`);
  const body = await res.json();
  const keys: VerifierKey[] = body.keys ?? [];
  keyCache = { fetchedAt: Date.now(), keys };
  return keys;
}

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** SEQUENCE { INTEGER r, INTEGER s } → 32-byte r ‖ 32-byte s. */
function derToRawEcdsa(der: Uint8Array): Uint8Array | null {
  if (der[0] !== 0x30) return null;
  let i = 2;
  if (der[1] & 0x80) i = 2 + (der[1] & 0x7f);

  if (der[i] !== 0x02) return null;
  const rLen = der[i + 1];
  const r = der.slice(i + 2, i + 2 + rLen);
  i = i + 2 + rLen;

  if (der[i] !== 0x02) return null;
  const sLen = der[i + 1];
  const s = der.slice(i + 2, i + 2 + sLen);

  const out = new Uint8Array(64);
  out.set(trimOrPad(r), 0);
  out.set(trimOrPad(s), 32);
  return out;
}

/** DER integers carry a leading zero when the high bit is set; raw form does not. */
function trimOrPad(v: Uint8Array): Uint8Array {
  let start = 0;
  while (start < v.length - 1 && v[start] === 0) start++;
  const trimmed = v.slice(start);
  if (trimmed.length === 32) return trimmed;
  const out = new Uint8Array(32);
  out.set(trimmed, 32 - trimmed.length);
  return out;
}
