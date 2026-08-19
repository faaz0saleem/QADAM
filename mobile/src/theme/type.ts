import { Platform, type TextStyle } from 'react-native';

/**
 * README §9.3.
 *
 * Three faces doing three jobs, and one rule that is not negotiable: every
 * number in this app is set in the monospace face with tabular figures.
 * Proportional numerals jitter when they tick, and a jittering counter is the
 * difference between "polished" and "hobby project".
 */
export const fontFamily = {
  /** Screen titles and the step count only. */
  display: 'FamiljenGrotesk_600SemiBold',
  displayBold: 'FamiljenGrotesk_700Bold',
  /** Neutral, boring, correct at 13–15px. */
  body: 'Inter_400Regular',
  bodyMedium: 'Inter_500Medium',
  bodySemi: 'Inter_600SemiBold',
  /** The step counter, coin balance, prices, leaderboard ranks. */
  data: 'JetBrainsMono_500Medium',
  dataBold: 'JetBrainsMono_700Bold',
  /** Urdu, full RTL. Nastaliq needs the extra line height or it clips. */
  urdu: 'NotoNastaliqUrdu_400Regular',
} as const;

/**
 * Tabular figures. `fontVariant` covers iOS and modern Android; JetBrains Mono is
 * monospaced anyway, so this is belt and braces on the one thing §9.3 calls
 * non-negotiable.
 */
export const tabular: TextStyle = {
  fontVariant: ['tabular-nums'],
  ...Platform.select({
    android: { fontFeatureSettings: "'tnum'" },
    default: {},
  }),
};

export const text = {
  /** The step count. Very large, monospace, ticking. */
  counter: { fontFamily: fontFamily.data, fontSize: 64, letterSpacing: -2, ...tabular },
  screenTitle: { fontFamily: fontFamily.display, fontSize: 28, letterSpacing: -0.5 },
  sectionTitle: { fontFamily: fontFamily.bodySemi, fontSize: 15, letterSpacing: 0.2 },
  body: { fontFamily: fontFamily.body, fontSize: 15, lineHeight: 22 },
  bodySmall: { fontFamily: fontFamily.body, fontSize: 13, lineHeight: 19 },
  label: { fontFamily: fontFamily.bodyMedium, fontSize: 12, letterSpacing: 0.4 },
  /** Any number that is not the hero counter. */
  data: { fontFamily: fontFamily.data, fontSize: 15, ...tabular },
  dataSmall: { fontFamily: fontFamily.data, fontSize: 13, ...tabular },
  dataLarge: { fontFamily: fontFamily.dataBold, fontSize: 22, ...tabular },
} satisfies Record<string, TextStyle>;

/**
 * Nastaliq sits on a steep diagonal baseline and clips at Latin line heights.
 * Applied wherever the active language is Urdu.
 */
export const urduAdjust: TextStyle = {
  fontFamily: fontFamily.urdu,
  lineHeight: 34,
  writingDirection: 'rtl',
};
