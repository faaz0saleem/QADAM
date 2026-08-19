/**
 * Pakistani mobile numbers, normalised to E.164 for Supabase Auth.
 *
 * People here write their number half a dozen ways — 0300 1234567, 300-1234567,
 * +92 300 1234567, 92 3001234567 — and every one of them is the same number.
 * Rejecting four of the six is a signup funnel that leaks for no reason.
 *
 * All Pakistani mobile numbers are 3XX XXXXXXX after the country code: ten
 * digits starting with 3.
 */
const NATIONAL = /^3\d{9}$/;

export function normalisePhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');

  // 03001234567 → 3001234567
  const national = digits.startsWith('92')
    ? digits.slice(2)
    : digits.startsWith('0')
      ? digits.slice(1)
      : digits;

  return NATIONAL.test(national) ? `+92${national}` : null;
}

/** +923001234567 → 0300 1234567, which is how it is read aloud. */
export function displayPhone(e164: string): string {
  const national = e164.replace(/^\+92/, '');
  if (!NATIONAL.test(national)) return e164;
  return `0${national.slice(0, 3)} ${national.slice(3)}`;
}
