/**
 * Byte wrangling shared by the attestation and AdMob paths.
 *
 * Extracted from where it was written so it can be tested. Hand-rolled DER
 * parsing is the kind of code that is either exactly right or silently wrong for
 * one input in two hundred, and "silently wrong" here means either rejecting
 * Google's genuine callbacks or accepting a forged one.
 */

// The ArrayBuffer type argument is not decoration: Web Crypto's BufferSource
// requires it, and a bare `Uint8Array` widens to ArrayBufferLike, which does not
// satisfy it.
export function decodeBase64(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function b64uBytes(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function b64u(s: string): string {
  return b64uBytes(new TextEncoder().encode(s));
}

/** Play Integrity echoes the nonce base64url-encoded, without padding. */
export function toBase64Url(s: string): string {
  return s.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function pemToDer(pem: string): Uint8Array<ArrayBuffer> {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '');
  return decodeBase64(body);
}

/**
 * DER `SEQUENCE { INTEGER r, INTEGER s }` → the 32-byte r ‖ 32-byte s that Web
 * Crypto's ECDSA verify expects.
 *
 * Two details do all the damage if missed. DER integers are signed, so a value
 * whose top bit is set carries an extra leading 0x00 that is not part of the
 * number — take it as data and every second signature fails. And DER strips
 * leading zero bytes, so a small r arrives shorter than 32 bytes and has to be
 * left-padded rather than written flush.
 *
 * Returns null rather than throwing on anything malformed: this parses bytes
 * from a public endpoint, and the caller's job is to refuse, not to crash.
 */
export function derToRawEcdsa(der: Uint8Array): Uint8Array<ArrayBuffer> | null {
  if (der.length < 8 || der[0] !== 0x30) return null;

  // Length may be short form (one byte) or long form (0x80 | count, then count
  // bytes). We do not need the value, only where the contents start.
  let i = 2;
  const lengthByte = der[1];
  if (lengthByte === undefined) return null;
  if (lengthByte & 0x80) i = 2 + (lengthByte & 0x7f);

  const r = readInteger(der, i);
  if (!r) return null;
  const s = readInteger(der, r.next);
  if (!s) return null;

  const out = new Uint8Array(64);
  const rBytes = leftPad32(r.value);
  const sBytes = leftPad32(s.value);
  if (!rBytes || !sBytes) return null;

  out.set(rBytes, 0);
  out.set(sBytes, 32);
  return out;
}

function readInteger(der: Uint8Array, at: number): { value: Uint8Array; next: number } | null {
  if (der[at] !== 0x02) return null;
  const len = der[at + 1];
  if (len === undefined || len === 0) return null;
  const start = at + 2;
  const end = start + len;
  if (end > der.length) return null;
  return { value: der.slice(start, end), next: end };
}

/**
 * Strip DER's sign byte and any other leading zeros, then left-pad to 32.
 * A value longer than 32 significant bytes is not a P-256 scalar.
 */
function leftPad32(v: Uint8Array): Uint8Array<ArrayBuffer> | null {
  let start = 0;
  while (start < v.length && v[start] === 0) start++;
  const trimmed = v.slice(start);

  if (trimmed.length > 32) return null;
  if (trimmed.length === 32) return new Uint8Array(trimmed);

  const out = new Uint8Array(32);
  out.set(trimmed, 32 - trimmed.length);
  return out;
}
