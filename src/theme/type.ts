import { Platform, TextStyle } from 'react-native';

/**
 * §9.3 — three families, each with one job.
 *
 * Display: a characterful grotesque, for screen titles and the step count only.
 * Body:    Inter. Neutral, boring, correct at 13–15px.
 * Data:    a monospace with TABULAR FIGURES. Non-negotiable for the step counter,
 *          the coin balance, prices and leaderboard ranks — proportional numerals
 *          jitter as they tick, and a jittering counter is the difference between
 *          polished and hobby project.
 * Urdu:    Noto Nastaliq Urdu, full RTL.
 *
 * The font files are loaded in app/_layout.tsx. Until they land, these fall back
 * to platform defaults, which is why every data style also sets
 * fontVariant: ['tabular-nums'] — the fallback must not jitter either.
 */

export const fonts = {
  display: 'FamiljenGrotesk_700Bold',
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  data: 'JetBrainsMono_500Medium',
  dataBold: 'JetBrainsMono_700Bold',
  urdu: 'NotoNastaliqUrdu_400Regular',
} as const;

/** Tabular figures, everywhere a number can change. */
const tabular: TextStyle = {
  fontVariant: ['tabular-nums'],
  ...Platform.select({
    ios: { fontFeatureSettings: undefined },
    default: {},
  }),
};

export const text = {
  /** §9.4: today's step count. Very large, monospace, ticking. */
  counter: {
    fontFamily: fonts.data,
    fontSize: 64,
    lineHeight: 68,
    letterSpacing: -2,
    ...tabular,
  } as TextStyle,

  /** The coin balance in the header, and any coin figure in running text. */
  coin: {
    fontFamily: fonts.dataBold,
    fontSize: 16,
    lineHeight: 20,
    letterSpacing: 0,
    ...tabular,
  } as TextStyle,

  coinLarge: {
    fontFamily: fonts.dataBold,
    fontSize: 32,
    lineHeight: 36,
    letterSpacing: -0.5,
    ...tabular,
  } as TextStyle,

  /** Prices, ranks, step totals in a list. */
  data: {
    fontFamily: fonts.data,
    fontSize: 15,
    lineHeight: 20,
    ...tabular,
  } as TextStyle,

  dataSmall: {
    fontFamily: fonts.data,
    fontSize: 13,
    lineHeight: 18,
    ...tabular,
  } as TextStyle,

  title: {
    fontFamily: fonts.display,
    fontSize: 28,
    lineHeight: 32,
    letterSpacing: -0.5,
  } as TextStyle,

  heading: {
    fontFamily: fonts.display,
    fontSize: 19,
    lineHeight: 24,
    letterSpacing: -0.2,
  } as TextStyle,

  body: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 22,
  } as TextStyle,

  bodySmall: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
  } as TextStyle,

  label: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  } as TextStyle,
} as const;

/** Urdu overrides: Nastaliq needs far more line height than Latin. */
export const urduAdjust = (style: TextStyle): TextStyle => ({
  ...style,
  fontFamily: fonts.urdu,
  lineHeight: Math.round((style.lineHeight ?? 20) * 1.9),
  letterSpacing: 0,
  textTransform: undefined,
});
