// README §7.8 — AdMob server-side verification for rewarded video.
//
// Google calls this with a signed query string. We verify the ECDSA signature
// against Google's published verifier keys before crediting anything, because
// this endpoint is public by necessity and an unverified one is a coin faucet.
//
// The reward amount in Google's callback is IGNORED. Coins come from
// private.app_config, server-side (§13.2).
import { serviceClient, json } from '../_shared/supabase.ts';
import { decodeBase64, derToRawEcdsa } from '../_shared/encoding.ts';

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
