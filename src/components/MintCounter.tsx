import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Text, TextStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTheme } from '../theme/ThemeContext';
import { text } from '../theme/type';
import { motion } from '../theme/tokens';
import { formatCoins } from '../lib/format';

/**
 * §9.5 — THE SIGNATURE MOMENT.
 *
 * When a coin threshold is crossed the counter strikes: a fast scale-up and a
 * warm flash, roughly 400ms, with a short haptic tap. Once per mint, never more
 * often — the caller controls that by only changing `value` when coins are
 * actually minted.
 *
 * Reduced motion (§9.5): the animation is replaced by a plain value change. The
 * haptic stays — it is the part that carries the meaning, and suppressing it
 * would take the moment away from exactly the users who rely on it.
 */
export function MintCounter({
  value,
  style,
  large = false,
}: {
  value: number;
  style?: TextStyle;
  large?: boolean;
}) {
  const theme = useTheme();
  const previous = useRef(value);
  const strike = useRef(new Animated.Value(0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (alive) setReduceMotion(on);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    const minted = value > previous.current;
    previous.current = value;
    if (!minted) return;

    // The tap fires either way. It is the beat.
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});

    if (reduceMotion) return;

    strike.setValue(0);
    Animated.sequence([
      Animated.timing(strike, {
        toValue: 1,
        duration: motion.mint * 0.3,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(strike, {
        toValue: 0,
        duration: motion.mint * 0.7,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [value, reduceMotion, strike]);

  const scale = strike.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Text
        style={[large ? text.coinLarge : text.coin, { color: theme.coin }, style]}
        accessibilityLabel={`${formatCoins(value)} coins`}
        // A counter that reads itself out on every tick is unusable with a
        // screen reader; announce it only when the user focuses it.
        accessibilityLiveRegion="none"
      >
        {formatCoins(value)}
      </Text>
    </Animated.View>
  );
}
