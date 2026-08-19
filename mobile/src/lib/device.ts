import { Platform } from 'react-native';
import * as Application from 'expo-application';
import * as Crypto from 'expo-crypto';

/**
 * §6.1 — one account per device.
 *
 * The identifier is hashed before it leaves the phone. The server only ever needs
 * to know whether two accounts share a device; it does not need the vendor id
 * itself, and storing raw device identifiers is the kind of thing that turns into
 * a privacy question at store review.
 *
 * Both platforms reset their identifier when every app from the vendor is
 * uninstalled, so this flags a shared handset rather than proving one. §6.1 is
 * explicit that it flags and does not ban — shared phones are normal here.
 */
let cached: string | null = null;

export async function deviceHash(): Promise<string | null> {
  if (cached) return cached;

  const raw =
    Platform.OS === 'android'
      ? Application.getAndroidId()
      : await Application.getIosIdForVendorAsync();

  if (!raw) return null;

  cached = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `qadam:${Platform.OS}:${raw}`,
  );
  return cached;
}
