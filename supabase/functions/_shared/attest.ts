import { googleAccessToken, signJwt } from './jwt.ts';

/**
 * §6.1 — attestation on every step submission.
 *
 * Play Integrity on Android, DeviceCheck on iOS. Both FAIL CLOSED: an
 * unverifiable token, a missing credential, a network error or an unexpected
 * response all return false, and the database credits nothing for an unattested
 * submission.
 *
 * Failing closed matters more than it looks. If this returned true on error, a
 * farm would only need to make the verification call fail — by sending a
 * malformed token — to mint freely.
 *
 * Nothing here tells the caller which check failed (§6.1). The reason is logged
 * server-side as a fraud_event and the response is an ordinary zero.
 */

export type Platform = 'android' | 'ios';

export interface AttestResult {
  attested: boolean;
  /** Server-side only. Never returned to the client. */
  reason: string;
  /** §6.1 flags: emulator and root are recorded, never hard-blocked. */
  flags: string[];
}

const fail = (reason: string, flags: string[] = []): AttestResult => ({
  attested: false,
  reason,
  flags,
});

async function verifyPlayIntegrity(token: string, nonce: string): Promise<AttestResult> {
  const packageName = Deno.env.get('ANDROID_PACKAGE_NAME');
  const clientEmail = Deno.env.get('GOOGLE_SA_CLIENT_EMAIL');
  const privateKey = Deno.env.get('GOOGLE_SA_PRIVATE_KEY');

  if (!packageName || !clientEmail || !privateKey) {
    return fail('play_integrity_not_configured');
  }

  let accessToken: string;
  try {
    accessToken = await googleAccessToken(
      clientEmail,
      privateKey.replace(/\\n/g, '\n'),
      'https://www.googleapis.com/auth/playintegrity',
    );
  } catch (e) {
    return fail(`play_integrity_auth_failed: ${e instanceof Error ? e.message : e}`);
  }

  const res = await fetch(
    `https://playintegrity.googleapis.com/v1/${packageName}:decodeIntegrityToken`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ integrityToken: token }),
    },
  );

  if (!res.ok) return fail(`play_integrity_http_${res.status}`);

  const payload = (await res.json())?.tokenPayloadExternal;
  if (!payload) return fail('play_integrity_empty_payload');

  const flags: string[] = [];
  const verdicts: string[] = payload.deviceIntegrity?.deviceRecognitionVerdict ?? [];
  const appVerdict: string = payload.appIntegrity?.appRecognitionVerdict ?? '';
  const requestPackage: string = payload.requestDetails?.requestPackageName ?? '';
  const requestHash: string = payload.requestDetails?.requestHash ?? '';
  const issuedMs = Number(payload.requestDetails?.timestampMillis ?? 0);

  // The nonce ties this verdict to THIS submission. Without it a single valid
  // token could be replayed behind every fabricated step count.
  if (requestHash !== nonce) return fail('play_integrity_nonce_mismatch');
  if (requestPackage !== packageName) return fail('play_integrity_wrong_package');
  if (!Number.isFinite(issuedMs) || Date.now() - issuedMs > 5 * 60_000) {
    return fail('play_integrity_stale_token');
  }
  if (appVerdict !== 'PLAY_RECOGNIZED') return fail('play_integrity_app_not_recognised');

  // §6.1: an emulator or an unlocked bootloader is flagged, not blocked. False
  // positives on rooted-but-honest devices are common in this market, and a
  // hard block would cost real users.
  if (!verdicts.includes('MEETS_DEVICE_INTEGRITY')) flags.push('emulator');
  if (!verdicts.includes('MEETS_STRONG_INTEGRITY')) flags.push('rooted');

  if (verdicts.length === 0) return fail('play_integrity_no_verdict', ['emulator']);

  return { attested: true, reason: 'ok', flags };
}

async function verifyDeviceCheck(token: string): Promise<AttestResult> {
  const keyId = Deno.env.get('APPLE_DEVICECHECK_KEY_ID');
  const teamId = Deno.env.get('APPLE_TEAM_ID');
  const privateKey = Deno.env.get('APPLE_DEVICECHECK_PRIVATE_KEY');

  if (!keyId || !teamId || !privateKey) return fail('devicecheck_not_configured');

  const now = Math.floor(Date.now() / 1000);
  let bearer: string;
  try {
    bearer = await signJwt(
      { kid: keyId, typ: 'JWT' },
      { iss: teamId, iat: now },
      privateKey.replace(/\\n/g, '\n'),
      'ES256',
    );
  } catch (e) {
    return fail(`devicecheck_sign_failed: ${e instanceof Error ? e.message : e}`);
  }

  const res = await fetch('https://api.devicecheck.apple.com/v1/validate_device_token', {
    method: 'POST',
    headers: { authorization: `Bearer ${bearer}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      device_token: token,
      transaction_id: crypto.randomUUID(),
      timestamp: Date.now(),
    }),
  });

  // Apple answers 200 with an empty body for a valid token.
  if (res.status !== 200) return fail(`devicecheck_http_${res.status}`);
  return { attested: true, reason: 'ok', flags: [] };
}

export async function verifyAttestation(
  platform: Platform,
  token: string | null,
  nonce: string,
): Promise<AttestResult> {
  if (!token) return fail('no_token');
  try {
    return platform === 'android'
      ? await verifyPlayIntegrity(token, nonce)
      : await verifyDeviceCheck(token);
  } catch (e) {
    // Any unexpected failure is a refusal, never a pass.
    return fail(`attestation_error: ${e instanceof Error ? e.message : e}`);
  }
}
