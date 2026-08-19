import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * §7.6 — "make joining work from a deep link without an account (create the
 * account after they're in)."
 *
 * A deep link that arrives while signed out sends the person through phone OTP
 * first, and the route they were heading for is gone by the time they come back.
 * The code is parked here across that detour, and claimed once on the other
 * side.
 *
 * Read-and-clear rather than read-then-clear: a code that survives being used
 * would send someone to the team screen every time they open the app.
 */
const KEY = 'qadam.pendingInvite';

export async function setPendingInvite(code: string): Promise<void> {
  const clean = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  if (clean.length === 6) await AsyncStorage.setItem(KEY, clean);
}

export async function takePendingInvite(): Promise<string | null> {
  const code = await AsyncStorage.getItem(KEY);
  if (code) await AsyncStorage.removeItem(KEY);
  return code;
}
