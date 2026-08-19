import { COIN_BRASS } from '@/theme';

/**
 * The Android notification channel's accent colour.
 *
 * This is the one place outside Coin.tsx that legitimately needs brass, and it
 * is not a §9.2 violation: the notifications it colours are about coins expiring
 * and coins at risk, which is exactly what brass is for. It lives in its own
 * file, named for what it is, so the exception is visible rather than buried in
 * a settings object — and so scripts/check-design.py has one obvious place to
 * allow rather than a wildcard.
 */
export const COIN_BRASS_FOR_NOTIFICATION_CHANNEL = COIN_BRASS;
