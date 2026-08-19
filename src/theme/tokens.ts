/**
 * §9.2 — the palette, verbatim, and the rules that go with it.
 *
 * Two temperatures, one app. The earning half (steps, streak, leaderboard) is
 * dark and dense with numbers. The spending half (shop, checkout) is light and
 * product-forward. Crossing between them should feel like stepping indoors.
 *
 * Brass is reserved. It is the coin. The moment it appears on a button that is
 * not about coins, the coin stops feeling like currency — so it is not in the
 * `surface` or `border` groups of either theme, and there is no `accent` alias
 * for it.
 */

export const palette = {
  ink: '#101828',        // earning surfaces, base
  inkRaised: '#1B2437',  // cards on dark
  brass: '#C8952E',      // the coin. coin values only. never decorative
  signal: '#3E9E75',     // goal met, delivery confirmed
  clay: '#C0563F',       // streak broken, coins expiring, order refused
  paper: '#FAF8F4',      // store surfaces, base
  paperLine: '#E4DFD6',  // ledger rules, dividers
  graphite: '#4A5468',   // secondary text on paper
} as const;

/** Derived tones. Kept few on purpose — a palette that grows stops being one. */
const derived = {
  inkLine: '#2A3448',     // a ruled line on dark, the ink counterpart of paperLine
  inkMuted: '#8A94A8',    // secondary text on dark
  paperRaised: '#FFFFFF', // cards on paper
  brassDim: '#7A5A1C',    // an unfilled coin figure, never text
} as const;

export type Temperature = 'earning' | 'spending';

export interface Theme {
  temperature: Temperature;
  bg: string;
  raised: string;
  line: string;
  text: string;
  textMuted: string;
  coin: string;
  coinDim: string;
  good: string;
  warn: string;
  /** For the status bar and any native chrome. */
  scheme: 'light' | 'dark';
}

export const earning: Theme = {
  temperature: 'earning',
  bg: palette.ink,
  raised: palette.inkRaised,
  line: derived.inkLine,
  text: '#FFFFFF',
  textMuted: derived.inkMuted,
  coin: palette.brass,
  coinDim: derived.brassDim,
  good: palette.signal,
  warn: palette.clay,
  scheme: 'dark',
};

export const spending: Theme = {
  temperature: 'spending',
  bg: palette.paper,
  raised: derived.paperRaised,
  line: palette.paperLine,
  text: palette.ink,
  textMuted: palette.graphite,
  coin: palette.brass,
  coinDim: derived.brassDim,
  good: palette.signal,
  warn: palette.clay,
  scheme: 'light',
};

/** 4pt base. Every gap in the app is one of these. */
export const space = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
} as const;

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
} as const;

/**
 * §9.5 — everything stays quiet except the mint.
 * 150–200ms ease-out transitions, no parallax, no scattered micro-interactions.
 */
export const motion = {
  quick: 150,
  settle: 200,
  /** The one place to spend real animation effort. Once per 1,000 steps. */
  mint: 400,
} as const;

/** §9.7 — nothing interactive is smaller than this. */
export const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;
export const MIN_TAP = 44;
