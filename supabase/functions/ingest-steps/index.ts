// README §6.1, §7.1 — the only way step data enters the system.
//
// The device cannot reach public.submit_steps: it is revoked from anon and
// authenticated, and granted to service_role alone. This function holds that key,
// and it only reaches the RPC after Play Integrity or App Attest has passed.
//
// The request body carries raw step counts and nothing else. No coin value, no
// balance, no discount — §13.2. The user id comes from the caller's own JWT, not
// from the body, because a user id in a body is the first field an attacker edits.
import { serviceClient, callerId, json } from '../_shared/supabase.ts';
import { verifyAttestation, type Platform } from '../_shared/attest.ts';

interface Sample {
  date: string;       // YYYY-MM-DD, the device's local (PKT) day
  raw_steps: number;
}

interface Body {
  samples: Sample[];
  platform: Platform;
  source: 'health_connect' | 'healthkit';
  device_hash: string;
  attestation_token: string;
  nonce: string;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const userId = await callerId(req);
  if (!userId) return json({ error: 'unauthorized' }, 401);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  const samples = sanitiseSamples(body.samples);
  if (samples.length === 0) return json({ error: 'bad request' }, 400);

  const db = serviceClient();

  // Burn the nonce first, whatever happens next. A nonce that survives a failed
  // attestation is a nonce an attacker gets unlimited attempts against.
  const { data: nonceOk } = await db.rpc('consume_attestation_nonce', {
    p_user_id: userId,
    p_nonce: body.nonce ?? '',
  });

  let passed = false;
  let flags: Record<string, boolean> = {};

  if (nonceOk === true) {
    const result = await verifyAttestation(body.platform, body.attestation_token, body.nonce);
    passed = result.passed;
    flags = result.flags as Record<string, boolean>;
    if (!passed) {
      // Server-side only. The device is told nothing about why (§6.1).
      console.warn('attestation failed', { userId, reason: result.reason });
    }
  } else {
    console.warn('nonce rejected', { userId });
  }

  // Called even when attestation failed: submit_steps records the fraud event and
  // returns a response shaped exactly like a successful one, so the caller cannot
  // tell the difference.
  const { data, error } = await db.rpc('submit_steps', {
    p_user_id: userId,
    p_samples: samples,
    p_source: body.source === 'healthkit' ? 'healthkit' : 'health_connect',
    p_device_hash: typeof body.device_hash === 'string' ? body.device_hash.slice(0, 128) : null,
    p_attestation_passed: passed,
    p_device_flags: flags,
  });

  if (error) {
    console.error('submit_steps failed', error);
    return json({ error: 'unavailable' }, 503);
  }

  return json(data);
});

// The client is untrusted input. Bound the array, coerce the numbers, drop the
// rest. The database enforces the real rules; this just stops absurd payloads
// reaching it.
function sanitiseSamples(input: unknown): Sample[] {
  if (!Array.isArray(input)) return [];
  const out: Sample[] = [];
  for (const s of input.slice(0, 14)) {
    if (typeof s !== 'object' || s === null) continue;
    const date = (s as Sample).date;
    const steps = Number((s as Sample).raw_steps);
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!Number.isFinite(steps) || steps < 0) continue;
    out.push({ date, raw_steps: Math.min(Math.floor(steps), 10_000_000) });
  }
  return out;
}
