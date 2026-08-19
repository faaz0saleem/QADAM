/**
 * Pakistan dates, client side.
 *
 * The server is the authority (`pkt_date()`), but the client needs the same
 * notion of "today" to label a reading before it submits it. PKT is UTC+5 with
 * no daylight saving, so this is a fixed offset and needs no timezone database.
 */
const PKT_OFFSET_MINUTES = 5 * 60;

export function pktDateString(at: Date = new Date()): string {
  const shifted = new Date(at.getTime() + PKT_OFFSET_MINUTES * 60000);
  return shifted.toISOString().slice(0, 10);
}

/** Midnight PKT `daysAgo` days back, as a real instant. */
export function startOfPktDay(daysAgo = 0): Date {
  const now = new Date();
  const shifted = new Date(now.getTime() + PKT_OFFSET_MINUTES * 60000);
  shifted.setUTCHours(0, 0, 0, 0);
  shifted.setUTCDate(shifted.getUTCDate() - daysAgo);
  return new Date(shifted.getTime() - PKT_OFFSET_MINUTES * 60000);
}

/** Monday 00:00 PKT of the week containing `at` (§7.3). */
export function pktWeekStart(at: Date = new Date()): Date {
  const shifted = new Date(at.getTime() + PKT_OFFSET_MINUTES * 60000);
  shifted.setUTCHours(0, 0, 0, 0);
  const dow = (shifted.getUTCDay() + 6) % 7; // Monday = 0
  shifted.setUTCDate(shifted.getUTCDate() - dow);
  return new Date(shifted.getTime() - PKT_OFFSET_MINUTES * 60000);
}

export function daysUntilWeekReset(at: Date = new Date()): number {
  const next = pktWeekStart(at);
  next.setUTCDate(next.getUTCDate() + 7);
  return Math.max(0, Math.ceil((next.getTime() - at.getTime()) / 86400000));
}
