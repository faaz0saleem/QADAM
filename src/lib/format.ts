/**
 * Number formatting.
 *
 * Everything here goes into a tabular-figure style (§9.3). Grouping separators
 * matter: a six-digit step count is unreadable without them, and Pakistan uses
 * Western grouping for step counts and prices in practice, not lakh/crore.
 */

const grouped = new Intl.NumberFormat('en-US');

export const formatSteps = (n: number): string => grouped.format(Math.max(0, Math.round(n)));

export const formatCoins = (n: number): string => grouped.format(Math.max(0, Math.round(n)));

/** PKR is an integer currency here — no decimals anywhere in the product. */
export const formatPkr = (n: number): string => grouped.format(Math.round(n));

/** A signed ledger delta: "+74", "-600". Always shows the sign. */
export const formatDelta = (n: number): string =>
  `${n > 0 ? '+' : n < 0 ? '\u2212' : ''}${grouped.format(Math.abs(Math.round(n)))}`;

/** "4,382" -> "4,382". Ranks are grouped too; a bare 4382 reads as a year. */
export const formatRank = (n: number): string => grouped.format(n);

/**
 * §7.3 percentile framing: "4,382 — top 12%" keeps a mid-table user engaged
 * where a bare rank does not.
 */
export const formatRankLine = (rank: number, percentile: number): string =>
  `${formatRank(rank)} — top ${Math.max(1, Math.min(100, Math.round(percentile)))}%`;

export function relativeTime(iso: string | null, now = Date.now()): 'never' | { unit: 'now' | 'min' | 'hr' | 'yesterday'; n: number } {
  if (!iso) return 'never';
  const mins = Math.floor((now - new Date(iso).getTime()) / 60000);
  if (mins < 2) return { unit: 'now', n: 0 };
  if (mins < 60) return { unit: 'min', n: mins };
  if (mins < 24 * 60) return { unit: 'hr', n: Math.floor(mins / 60) };
  return { unit: 'yesterday', n: Math.floor(mins / (60 * 24)) };
}

/** Days until a date, floored at zero. Used for coin expiry copy. */
export function daysUntil(iso: string, now = Date.now()): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 86400000));
}
