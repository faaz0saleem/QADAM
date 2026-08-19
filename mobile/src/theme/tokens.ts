/**
 * README §9.2 — the palette, verbatim.
 *
 * These eight values are the whole system. Everything else in this file is
 * derived from them, and nothing outside this file may invent a colour.
 */
export const palette = {
  ink: '#101828', // earning surfaces, base
  inkRaised: '#1B2437', // cards on dark
  brass: '#C8952E', // the coin. used ONLY for coin values. never decorative
  signal: '#3E9E75', // goal met, delivery confirmed
  clay: '#C0563F', // streak broken, coins expiring, order refused
  paper: '#FAF8F4', // store surfaces, base
  paperLine: '#E4DFD6', // ledger rules, dividers
  graphite: '#4A5468', // secondary text on paper
} as const;

/**
 * §9.1 — two temperatures, one app.
 *
 * The earning half is dark, nocturnal, dense with numbers. The spending half is
 * light, airy, product-forward. The transition between them is the most important
 * moment in the app: it should feel like stepping indoors.
 *
 * Phase 1 ships with no store at all, so only `earning` is used today. `spending`
 * is defined now because the structural idea has to be held from the start — a
 * light half bolted on in Phase 2 would end up as the dark half with the colours
 * inverted, which is not the same thing.
 */
export const earning = {
  bg: palette.ink,
  raised: palette.inkRaised,
  sunken: '#0B1119',
  text: '#F3F5F9',
  textDim: '#93A0B7',
  textFaint: '#5C6880',
  rule: '#26314A',
  ruleFilled: '#F3F5F9',
  good: palette.signal,
  bad: palette.clay,
} as const;

export const spending = {
  bg: palette.paper,
  raised: '#FFFFFF',
  sunken: '#F1EDE6',
  text: palette.ink,
  textDim: palette.graphite,
  textFaint: '#8A93A6',
  rule: palette.paperLine,
  ruleFilled: palette.ink,
  good: palette.signal,
  bad: palette.clay,
} as const;

/**
 * `as const` above pins each value to its own literal type, which is what makes a
 * typo in a token name a compile error. Widening the VALUES back to string is
 * what lets the two surfaces be the same shape — otherwise `spending` is not
 * assignable to `earning`, and the whole point is that they are interchangeable.
 */
export type Surface = { readonly [K in keyof typeof earning]: string };

/**
 * BRASS IS RESERVED.
 *
 * §9.2: "the coin. used ONLY for coin values. never decorative. The moment it
 * appears on a button that isn't about coins, the coin stops feeling like
 * currency."
 *
 * It is deliberately not on `earning` or `spending`. The only legitimate way to
 * reach it is through the components in src/components/Coin.tsx, and
 * scripts/check-brass.sh fails the build if the literal appears anywhere else.
 */
export const COIN_BRASS = palette.brass;

/** 4px base. Everything is a multiple; nothing is a magic number. */
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
 * §9.5 — "Everything else stays quiet: 150–200ms ease-out transitions, no
 * parallax, no scattered micro-interactions."
 *
 * The mint is the one exception, and it gets 400ms.
 */
export const motion = {
  quiet: 180,
  mint: 400,
} as const;

/** §9.7 — tap targets ≥44px, unannounced. */
export const MIN_TAP_TARGET = 44;
