import { Platform } from 'react-native';

/**
 * §6.1 — the client half of attestation.
 *
 * All this does is fetch a token from Play Integrity or App Attest and hand it
 * over. It makes no claim about the device: the token is verified server-side
 * in the `ingest-steps` Edge Function, and an absent or unverifiable token
 * earns zero coins.
 *
 * The concrete provider is a native module and therefore needs the dev build.
 * It is deliberately behind this boundary rather than imported directly, so the
 * app runs — with no coins minted — in Expo Go, on web, and in a simulator.
 * Wiring the real provider is a HUMAN_TASKS item; the server side is already
 * complete and already refuses everything until it lands.
 */

export type AttestPlatform = 'android' | 'ios';

export interface IntegrityProvider {
  /**
   * @param nonce binds the verdict to one submission, so a valid token cannot
   *              be replayed behind a fabricated step count.
   */
  getToken(nonce: string): Promise<string | null>;
}

/** Fetches nothing. The server treats that exactly as it treats a forged token. */
const unavailable: IntegrityProvider = {
  async getToken() {
    return null;
  },
};

let provider: IntegrityProvider | null = null;

export function setIntegrityProvider(p: IntegrityProvider): void {
  provider = p;
}

export function currentPlatform(): AttestPlatform {
  return Platform.OS === 'android' ? 'android' : 'ios';
}

export async function getIntegrityToken(nonce: string): Promise<string | null> {
  return (provider ?? unavailable).getToken(nonce);
}

/**
 * Binds a verdict to one specific submission. The provider echoes this back and
 * the Edge Function compares it against what it recomputes from the payload.
 */
export async function integrityNonce(date: string, rawSteps: number): Promise<string> {
  const material = new TextEncoder().encode(`${date}:${Math.round(rawSteps)}`);
  const digest = await crypto.subtle.digest('SHA-256', material);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
