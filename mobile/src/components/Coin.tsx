import { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, type TextStyle } from 'react-native';
import * as Haptics from 'expo-haptics';

import { COIN_BRASS, motion, text as type } from '@/theme';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import { formatNumber } from '@/lib/format';
import { useI18n } from '@/i18n';

/**
 * THE ONLY FILE PERMITTED TO USE BRASS.
 *
 * §9.2: "Brass is reserved. The moment it appears on a button that isn't about
 * coins, the coin stops feeling like currency." scripts/check-brass.sh enforces
 * that mechanically — the hex literal appears in exactly two places in this
 * repo, the token definition and here.
 *
 * Every coin value in the app goes through one of these two components, which
 * also means every coin value is brass, tabular, and correctly grouped without
 * anybody having to remember.
 */

interface CoinValueProps {
  coins: number;
  size?: 'small' | 'medium' | 'large';
  style?: TextStyle;
  /** Screen-reader label. Falls back to "<n> coins" in the active language. */
  label?: string;
}

const SIZES = {
  small: type.dataSmall,
  medium: type.data,
  large: type.dataLarge,
} as const;

export function CoinValue({ coins, size = 'medium', style, label }: CoinValueProps) {
  const { t } = useI18n();
  return (
    <Text
      style={[SIZES[size], styles.brass, style]}
      accessibilityLabel={label ?? `${formatNumber(coins)} ${t.wallet.balance}`}
    >
      {formatNumber(coins)}
    </Text>
  );
}

/**
 * §9.5 — THE SIGNATURE MOMENT.
 *
 * "When a step threshold is crossed, the coin counter increments with a
 * struck-metal micro-animation and a short haptic tap. Roughly 400ms, once per
 * 1,000 steps, never more often. This is the dopamine beat of the entire app and
 * the one place to spend real animation effort."
 *
 * Struck metal, in motion terms, is a hard strike and a slow settle: the value
 * snaps up and slightly over, the glyph brightens for an instant, then both fall
 * back. It is not a bounce and it is not a fade.
 *
 * "Respect prefers-reduced-motion — replace the mint animation with a simple
 * value change, keep the haptic." The haptic is the part that survives, because
 * it is the part that is felt rather than watched.
 */
export function MintingCoinValue({ coins, size = 'large', style, label }: CoinValueProps) {
  const previous = useRef(coins);
  const strike = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (coins === previous.current) return;
    const minted = coins > previous.current;
    previous.current = coins;
    if (!minted) return;

    // Felt, not watched — this happens in both motion modes.
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Rigid);
    if (reduceMotion) return;

    strike.setValue(0);
    Animated.sequence([
      // The strike: fast, and slightly past where it lands.
      Animated.timing(strike, {
        toValue: 1,
        duration: motion.mint * 0.22,
        useNativeDriver: true,
      }),
      // The settle: slow, back to rest.
      Animated.timing(strike, {
        toValue: 0,
        duration: motion.mint * 0.78,
        useNativeDriver: true,
      }),
    ]).start();
  }, [coins, reduceMotion, strike]);

  return (
    <Animated.Text
      style={[
        SIZES[size],
        styles.brass,
        {
          transform: [
            { scale: strike.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] }) },
            { translateY: strike.interpolate({ inputRange: [0, 1], outputRange: [0, -3] }) },
          ],
          opacity: strike.interpolate({ inputRange: [0, 1], outputRange: [1, 0.82] }),
        },
        style,
      ]}
      accessibilityLabel={label}
      accessibilityLiveRegion="polite"
    >
      {formatNumber(coins)}
    </Animated.Text>
  );
}

const styles = StyleSheet.create({
  brass: { color: COIN_BRASS },
});
