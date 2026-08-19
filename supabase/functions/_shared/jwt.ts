/**
 * Minimal JWT signing for the two attestation providers.
 *
 * Google wants RS256 signed with a service-account key; Apple wants ES256
 * signed with a DeviceCheck .p8. Both keys arrive as PEM, so both paths go
 * through the same import.
 *
 * Deno's WebCrypto does all of it — no dependency, nothing to keep patched.
 */

const b64url = (bytes: Uint8Array): string =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const encodeJson = (value: unknown): string =>
  b64url(new TextEncoder().encode(JSON.stringify(value)));

function pemToBytes(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  const raw = atob(body);
  return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
}

export async function signJwt(
  header: Record<string, unknown>,
  claims: Record<string, unknown>,
  pem: string,
  algorithm: 'RS256' | 'ES256',
): Promise<string> {
  const params =
    algorithm === 'RS256'
      ? { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
      : { name: 'ECDSA', namedCurve: 'P-256' };

  const key = await crypto.subtle.importKey('pkcs8', pemToBytes(pem), params, false, ['sign']);

  const signingInput = `${encodeJson({ ...header, alg: algorithm })}.${encodeJson(claims)}`;
  const signature = await crypto.subtle.sign(
    algorithm === 'RS256' ? params : { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput),
  );

  return `${signingInput}.${b64url(new Uint8Array(signature))}`;
}

/** Exchanges a service-account JWT for a Google OAuth access token. */
export async function googleAccessToken(
  clientEmail: string,
  privateKeyPem: string,
  scope: string,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const assertion = await signJwt(
    { typ: 'JWT' },
    {
      iss: clientEmail,
      scope,
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    },
    privateKeyPem,
    'RS256',
  );

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!res.ok) throw new Error(`google token exchange failed: ${res.status}`);
  const json = await res.json();
  return json.access_token as string;
}
