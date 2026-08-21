import type { Locale } from '@/i18n';

/**
 * Numbers are grouped the way a Pakistani reader expects. Urdu uses Western
 * digits here on purpose: prices, step counts and coin balances are read as
 * quantities, and mixing Eastern Arabic numerals into a tabular column breaks
 * the alignment that §9.3 exists to protect.
 */
export function formatNumber(n: number, _locale: Locale = 'en'): string {
  return new Intl.NumberFormat('en-US').format(Math.round(n));
}

export function formatPkr(pkr: number, _locale: Locale = 'en'): string {
  return `PKR ${formatNumber(pkr)}`;
}

/** "Synced 4 minutes ago" — failures have to be visible (§7.1). */
export function relativeTime(iso: string | null, locale: Locale): string {
  if (!iso) return locale === 'ur' ? 'ابھی تک نہیں' : 'never';

  // Past AND future. This used to clamp at zero, which turned every deadline
  // into "just now" — a team basket with 34 hours left read as already gone,
  // and a coin batch expiring on Tuesday read as expiring this second. The
  // sign is the whole meaning of these strings.
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  const magnitude = Math.abs(seconds);
  const sign = seconds < 0 ? 1 : -1;
  if (magnitude < 60) return locale === 'ur' ? 'ابھی' : 'just now';

  const rtf = new Intl.RelativeTimeFormat(locale === 'ur' ? 'ur' : 'en', { numeric: 'auto' });
  const minutes = Math.round(magnitude / 60);
  if (minutes < 60) return rtf.format(sign * minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(sign * hours, 'hour');
  return rtf.format(sign * Math.round(hours / 24), 'day');
}

export function formatDate(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === 'ur' ? 'ur-PK' : 'en-PK', {
    day: 'numeric',
    month: 'short',
    timeZone: 'Asia/Karachi',
  }).format(new Date(iso));
}

/** The PKT business day, which is the only day this product has (§ pkt_date). */
export function pktToday(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  return parts; // en-CA gives YYYY-MM-DD
}

export function pktDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Karachi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * The instant the current PKT day began, as an ISO string.
 *
 * Pakistan is UTC+5 with no daylight saving, so this is fixed-offset arithmetic
 * rather than a timezone lookup — and getting it wrong is how the live counter
 * would show yesterday's steps for the first five hours of every day.
 */
export function pktDayStartIso(at: Date = new Date()): string {
  const PKT_OFFSET_MS = 5 * 3_600_000;
  const pktMs = at.getTime() + PKT_OFFSET_MS;
  const midnightPktMs = Math.floor(pktMs / 86_400_000) * 86_400_000;
  return new Date(midnightPktMs - PKT_OFFSET_MS).toISOString();
}
