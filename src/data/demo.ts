import { pktDateString } from '../lib/dates';
import type { BoardRow, CoinBatch, LedgerEntry, Product, TodaySteps } from './types';

/**
 * Demo data for running the app before a Supabase project exists.
 *
 * It mirrors the server's rules rather than inventing friendlier ones, so the
 * app looks the same here as it will in production: the coin figures respect
 * STEPS_PER_COIN and DAILY_STEP_CAP, and `yourDiscountPkr` respects §0 — the
 * phone below shows well under 1% off, exactly as the real formula produces.
 */

const day = (back: number) => {
  const d = new Date();
  d.setDate(d.getDate() - back);
  return pktDateString(d);
};

export const demoToday: TodaySteps = {
  date: pktDateString(),
  rawSteps: 7420,
  creditedSteps: 7420,
  coinsToday: 74,
  dailyCap: 15000,
  streak: 6,
  lastSyncedAt: new Date(Date.now() - 4 * 60000).toISOString(),
};

export const demoBalance = 2840;

export const demoBatches: CoinBatch[] = [
  { expiresAt: day(-11), remaining: 2400, daysLeft: 11 },
  { expiresAt: day(-64), remaining: 440, daysLeft: 64 },
];

export const demoLedger: LedgerEntry[] = [
  { id: '1', delta: 74, reason: 'steps', expiresAt: day(-90), createdAt: day(0) },
  { id: '2', delta: 30, reason: 'rewarded_ad', expiresAt: day(-90), createdAt: day(0) },
  { id: '3', delta: 112, reason: 'steps', expiresAt: day(-89), createdAt: day(1) },
  { id: '4', delta: -600, reason: 'order_hold', expiresAt: day(-11), createdAt: day(2) },
  { id: '5', delta: 98, reason: 'steps', expiresAt: day(-88), createdAt: day(2) },
  { id: '6', delta: 500, reason: 'referral_referrer', expiresAt: day(-80), createdAt: day(10) },
];

export const demoBoard: BoardRow[] = [
  { userId: 'a', name: 'Hina R.', steps: 94210, rank: 1, percentile: 1, isMe: false, pinned: false },
  { userId: 'b', name: 'Bilal K.', steps: 88940, rank: 2, percentile: 2, isMe: false, pinned: false },
  { userId: 'c', name: 'Sana M.', steps: 81200, rank: 3, percentile: 3, isMe: false, pinned: false },
  { userId: 'd', name: 'Usman T.', steps: 77650, rank: 4, percentile: 4, isMe: false, pinned: false },
  { userId: 'me', name: 'You', steps: 52180, rank: 38, percentile: 12, isMe: true, pinned: true },
];

export const demoProducts: Product[] = [
  {
    id: 'p1', title: 'Lawn kurta, unstitched', pricePkr: 3200, stock: 40, images: [],
    maxDiscountPkr: 320, yourDiscountPkr: 85,
  },
  {
    id: 'p2', title: 'Leather wallet', pricePkr: 2200, stock: 50, images: [],
    maxDiscountPkr: 220, yourDiscountPkr: 85,
  },
  {
    id: 'p3', title: 'Cotton bedsheet set', pricePkr: 5600, stock: 20, images: [],
    maxDiscountPkr: 480, yourDiscountPkr: 85,
  },
  {
    // §7.4: low-margin goods stay in the catalogue and §0 caps them near 1%.
    // No special-casing, and no UI apologising for it.
    id: 'p4', title: 'Budget smartphone', pricePkr: 42000, stock: 8, images: [],
    maxDiscountPkr: 340, yourDiscountPkr: 85,
  },
];
