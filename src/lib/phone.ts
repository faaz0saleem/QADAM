/**
 * Pakistani mobile numbers, normalised to E.164 for Supabase auth.
 *
 * People type 0300 1234567, 0300-1234567, +92 300 1234567 and 92 300 1234567,
 * all meaning the same number. Rejecting any of those spellings loses the
 * signup, so all of them normalise to +923001234567.
 */
const MOBILE_PREFIXES = /^3[0-9]{2}$/; // 30x-34x networks, plus room to grow

export function normalisePhone(input: string): string | null {
  const digits = input.replace(/[^\d+]/g, '').replace(/^\+/, '');

  let national: string;
  if (digits.startsWith('92')) national = digits.slice(2);
  else if (digits.startsWith('0')) national = digits.slice(1);
  else national = digits;

  // A Pakistani mobile is 10 digits nationally: 3XX NNNNNNN.
  if (national.length !== 10) return null;
  if (!MOBILE_PREFIXES.test(national.slice(0, 3))) return null;

  return `+92${national}`;
}

/** 0300 1234567 — how a number is shown back to the person who typed it. */
export function formatPhoneLocal(e164: string): string {
  const national = e164.replace(/^\+92/, '');
  if (national.length !== 10) return e164;
  return `0${national.slice(0, 3)} ${national.slice(3)}`;
}
