import { createClient } from 'jsr:@supabase/supabase-js@2';
import { verifyAttestation, Platform } from '../_shared/attest.ts';

/**
 * §6.1 — the only door steps come through.
 *
 * The client sends a raw daily step count, a platform, and an attestation
 * token. It sends no coin value, no balance and no discount, and there is no
 * field here it could put one in (§13.2).
 *
 * This function verifies the attestation and then calls `award_steps` as
 * service_role. Everything downstream of the verdict — the daily cap, the rate
 * ceiling, the backfill window, the streak multiplier, the coin arithmetic —
 * lives in the database, not here.
 *
 * Deploy:  supabase functions deploy ingest-steps
 * Secrets: supabase secrets set ANDROID_PACKAGE_NAME=... GOOGLE_SA_CLIENT_EMAIL=... \
 *            GOOGLE_SA_PRIVATE_KEY=... APPLE_TEAM_ID=... \
 *            APPLE_DEVICECHECK_KEY_ID=... APPLE_DEVICECHECK_PRIVATE_KEY=...
 */

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

interface Body {
  date: string;
  raw_steps: number;
  platform: Platform;
  integrity_token: string | null;
  /** Echoed back by the attestation provider, tying the verdict to this request. */
  nonce: string;
  device_hash?: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') {
    return new Response('method not allowed', { status: 405, headers: CORS });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return new Response('unauthorized', { status: 401, headers: CORS });

  // Two clients: one acting as the caller to establish who they are, one as
  // service_role to do the work they are not allowed to do themselves.
  const asCaller = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const asServer = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const { data: auth } = await asCaller.auth.getUser();
  const userId = auth?.user?.id;
  if (!userId) return new Response('unauthorized', { status: 401, headers: CORS });

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return new Response('bad request', { status: 400, headers: CORS });
  }

  if (!body.date || typeof body.raw_steps !== 'number' || !Number.isFinite(body.raw_steps)) {
    return new Response('bad request', { status: 400, headers: CORS });
  }

  let verdict = await verifyAttestation(body.platform, body.integrity_token, body.nonce ?? '');

  // Development escape hatch. Without it nothing can be built against a hosted
  // project until the Play Integrity and DeviceCheck keys exist, because the
  // verifier correctly refuses everything.
  //
  // It is a SERVER secret, never a client capability — no request can turn it
  // on — and every use writes a fraud_event, so a project running with it set
  // is obvious from the data rather than from someone remembering.
  //
  // ⚠️ MUST NOT be set on production. Tracked in HUMAN_TASKS.md.
  if (!verdict.attested && Deno.env.get('ALLOW_UNATTESTED') === 'true') {
    await asServer.from('fraud_events').insert({
      user_id: userId,
      kind: 'unattested_submission',
      detail: {
        reason: verdict.reason,
        date: body.date,
        raw_steps: body.raw_steps,
        dev_bypass: true,
      },
    });
    verdict = { attested: true, reason: 'dev_bypass', flags: ['unattested_dev'] };
  }

  // §6.1: reject unattested submissions silently — don't tell the attacker why.
  // The reason is recorded here and never travels back over the wire.
  if (!verdict.attested && verdict.reason !== 'dev_bypass') {
    await asServer.from('fraud_events').insert({
      user_id: userId,
      kind: 'unattested_submission',
      detail: { reason: verdict.reason, date: body.date, raw_steps: body.raw_steps },
    });
  }

  if (body.device_hash) {
    // The trigger on users flags a hash seen on a second account (§6.1).
    await asServer.from('users').update({ device_hash: body.device_hash }).eq('id', userId);
  }

  const { data, error } = await asServer.rpc('award_steps', {
    p_user: userId,
    p_date: body.date,
    p_raw: Math.max(0, Math.round(body.raw_steps)),
    p_source: body.platform === 'android' ? 'health_connect' : 'healthkit',
    p_attested: verdict.attested,
    p_flags: verdict.flags,
  });

  if (error) {
    console.error('award_steps failed', error.message);
    return new Response(JSON.stringify({ coins: 0 }), {
      status: 200,
      headers: { ...CORS, 'content-type': 'application/json' },
    });
  }

  // An honest zero and a rejected fraud attempt look identical from out here.
  return new Response(JSON.stringify({ coins: data ?? 0 }), {
    status: 200,
    headers: { ...CORS, 'content-type': 'application/json' },
  });
});
