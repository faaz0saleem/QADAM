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
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return locale === 'ur' ? 'ابھی' : 'just now';

  const rtf = new Intl.RelativeTimeFormat(locale === 'ur' ? 'ur' : 'en', { numeric: 'auto' });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return rtf.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (hours < 24) return rtf.format(-hours, 'hour');
  return rtf.format(-Math.round(hours / 24), 'day');
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
