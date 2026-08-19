// README §6.1 — device attestation.
//
// THE RULE THIS FILE EXISTS TO KEEP: every path returns false unless it has
// positively verified something. A missing credential, an unreachable Google, a
// malformed token, an unexpected shape — all of it fails closed. An attestation
// layer that defaults to "pass" when misconfigured is worse than none, because it
// looks like it is working.
//
// Failure is also silent to the caller. §6.1: reject unattested submissions
// without telling the attacker why.

import { b64u, b64uBytes, pemToDer, toBase64Url } from './encoding.ts';

export type Platform = 'android' | 'ios';

export interface AttestResult {
  passed: boolean;
  /** Never returned to the device. Logged server-side so we can see what broke. */
  reason: string;
  /** Best-effort device signals. Flags, never auto-bans (§6.1). */
  flags: { rooted?: boolean; emulator?: boolean };
}

const FAIL = (reason: string): AttestResult => ({ passed: false, reason, flags: {} });

export async function verifyAttestation(
  platform: Platform,
  token: string,
  nonce: string,
): Promise<AttestResult> {
  if (!token || !nonce) return FAIL('missing token or nonce');
  return platform === 'android'
    ? await verifyPlayIntegrity(token, nonce)
    : await verifyAppAttest(token, nonce);
}

// ── Android: Play Integrity ────────────────────────────────────────────────
//
// Google decodes the token for us. We then check three things: that the nonce is
// ours, that the app is the one we published, and that the device verdict is
// acceptable.
async function verifyPlayIntegrity(token: string, nonce: string): Promise<AttestResult> {
  const packageName = Deno.env.get('ANDROID_PACKAGE_NAME');
  const serviceAccount = Deno.env.get('GOOGLE_SERVICE_ACCOUNT_JSON');
  if (!packageName || !serviceAccount) return FAIL('play integrity not configured');

  let accessToken: string;
  try {
    accessToken = await googleAccessToken(JSON.parse(serviceAccount));
  } catch (e) {
    return FAIL(`google auth failed: ${e instanceof Error ? e.message : 'unknown'}`);
  }

  let payload: PlayIntegrityPayload;
  try {
    const res = await fetch(
      `https://playintegrity.googleapis.com/v1/${encodeURIComponent(packageName)}:decodeIntegrityToken`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ integrityToken: token }),
      },
    );
    if (!res.ok) return FAIL(`play integrity http ${res.status}`);
    const body = await res.json();
    payload = body?.tokenPayloadExternal;
  } catch (e) {
    return FAIL(`play integrity unreachable: ${e instanceof Error ? e.message : 'unknown'}`);
  }
  if (!payload) return FAIL('play integrity returned no payload');

  // The nonce binds this attestation to this request. Without it a single valid
  // token could be captured and replayed indefinitely.
  const echoed = payload.requestDetails?.nonce;
  if (echoed !== toBase64Url(nonce)) return FAIL('nonce mismatch');

  if (payload.requestDetails?.requestPackageName !== packageName) {
    return FAIL('package mismatch');
  }

  const appVerdict = payload.appIntegrity?.appRecognitionVerdict;
  if (appVerdict !== 'PLAY_RECOGNIZED') return FAIL(`app verdict ${appVerdict}`);

  const device = payload.deviceIntegrity?.deviceRecognitionVerdict ?? [];

  // MEETS_DEVICE_INTEGRITY is the bar. Anything below it is an emulator, a rooted
  // handset, or an unrecognised build — flagged, and unpaid, but not banned:
  // false positives on rooted-but-honest devices are common in this market (§6.1).
  const meetsIntegrity = device.includes('MEETS_DEVICE_INTEGRITY');
  const flags = {
    emulator: !device.includes('MEETS_BASIC_INTEGRITY'),
    rooted: !meetsIntegrity && device.includes('MEETS_BASIC_INTEGRITY'),
  };

  if (!meetsIntegrity) return { passed: false, reason: `device verdict ${device.join(',')}`, flags };
  return { passed: true, reason: 'ok', flags };
}

interface PlayIntegrityPayload {
  requestDetails?: { nonce?: string; requestPackageName?: string; timestampMillis?: string };
  appIntegrity?: { appRecognitionVerdict?: string; packageName?: string };
  deviceIntegrity?: { deviceRecognitionVerdict?: string[] };
}

// Service-account OAuth, signed with Web Crypto. No googleapis SDK in Deno Deploy.
async function googleAccessToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/playintegrity',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const unsigned = `${b64u(JSON.stringify(header))}.${b64u(JSON.stringify(claims))}`;
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64uBytes(new Uint8Array(sig))}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`token endpoint ${res.status}`);
  const { access_token } = await res.json();
  if (!access_token) throw new Error('no access_token');
  return access_token;
}

// ── iOS: App Attest ────────────────────────────────────────────────────────
//
// NOT YET IMPLEMENTED, and therefore returns false — which means iOS submissions
// currently earn nothing. That is the correct failure direction and it is why
// this is a P1 in HUMAN_TASKS.md rather than a quiet TODO.
//
// The real implementation has to:
//   1. CBOR-decode the attestation object from the client's first attest() call
//   2. verify the x5c certificate chain up to Apple's App Attest root CA
//   3. check the nonce appears in the credCert's 1.2.840.113635.100.8.2 extension
//   4. check the rpIdHash equals SHA256(teamId + '.' + bundleId)
//   5. store the public key against the keyId, then on every later submission
//      verify the assertion signature and that the counter strictly increased
//
// Step 5 is what makes it useful — the counter is what stops replay. Doing steps
// 1-4 without it would be theatre, so both land together or neither does.
function verifyAppAttest(_token: string, _nonce: string): Promise<AttestResult> {
  const teamId = Deno.env.get('APPLE_APP_ATTEST_TEAM_ID');
  const bundleId = Deno.env.get('APPLE_APP_ATTEST_BUNDLE_ID');
  if (!teamId || !bundleId) return Promise.resolve(FAIL('app attest not configured'));
  return Promise.resolve(FAIL('app attest verification not implemented — see HUMAN_TASKS.md'));
}
