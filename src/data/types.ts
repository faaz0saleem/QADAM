export interface TodaySteps {
  date: string;
  rawSteps: number;
  creditedSteps: number;
  coinsToday: number;
  dailyCap: number;
  streak: number;
  lastSyncedAt: string | null;
}

export interface CoinBatch {
  expiresAt: string;
  remaining: number;
  daysLeft: number;
}

export type LedgerReason =
  | 'steps' | 'streak_bonus' | 'rewarded_ad' | 'referral_referrer' | 'referral_referee'
  | 'challenge_prize' | 'order_refund' | 'admin_credit' | 'order_hold' | 'admin_debit';

export interface LedgerEntry {
  id: string;
  delta: number;
  reason: LedgerReason;
  expiresAt: string;
  createdAt: string;
}

export type BoardScope = 'city' | 'team' | 'friends' | 'pakistan';

export interface BoardRow {
  userId: string;
  name: string | null;
  steps: number;
  rank: number;
  percentile: number;
  isMe: boolean;
  pinned: boolean;
}

export interface Product {
  id: string;
  title: string;
  pricePkr: number;
  stock: number;
  images: string[];
  /** §7.4: what THIS user saves right now, computed server-side. */
  yourDiscountPkr: number;
  maxDiscountPkr: number;
}
