import { Platform } from 'react-native';
import * as AppIntegrity from 'expo-app-integrity';

import { supabase, functionsBase } from './supabase';

/**
 * §6.1 — attestation on every step submission.
 *
 * The nonce comes from our server, is single-use, and expires in five minutes.
 * Without it a valid attestation token could be captured once and replayed
 * forever, which would make the whole exercise decorative.
 *
 * Every failure returns null. The submission still goes to the server, which
 * records a fraud event and credits nothing — and answers in exactly the shape a
 * successful submission would, so a device learns nothing from being rejected.
 */
export interface Attestation {
  token: string;
  nonce: string;
}

const CLOUD_PROJECT_NUMBER = process.env.EXPO_PUBLIC_GOOGLE_CLOUD_PROJECT_NUMBER;

async function fetchNonce(): Promise<string | null> {
  const { data: session } = await supabase.auth.getSession();
  const accessToken = session.session?.access_token;
  if (!accessToken) return null;

  try {
    const res = await fetch(`${functionsBase}/attest-nonce`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { nonce?: string };
    return body.nonce ?? null;
  } catch {
    return null;
  }
}

export async function attest(): Promise<Attestation | null> {
  const nonce = await fetchNonce();
  if (!nonce) return null;

  if (Platform.OS === 'android' && !CLOUD_PROJECT_NUMBER) {
    // Play Integrity cannot run without the cloud project number. Fail closed
    // and stay quiet — see HUMAN_TASKS.md.
    return null;
  }

  try {
    const token = await AppIntegrity.attestKey(
      nonce,
      CLOUD_PROJECT_NUMBER ? Number(CLOUD_PROJECT_NUMBER) : undefined,
    );
    return token ? { token, nonce } : null;
  } catch (e) {
    // Both platforms rate-limit attestation. A failure here is expected
    // occasionally and is not worth showing anyone.
    console.warn('attestation unavailable', e);
    return null;
  }
}
