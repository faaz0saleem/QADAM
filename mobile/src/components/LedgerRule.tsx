import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

import { motion, radius, useSurface } from '@/theme';
import { useReduceMotion } from '@/hooks/useReduceMotion';

/**
 * §9.4 — "A horizontal progress rule toward the daily cap (a ruled ledger line
 * filling, NOT a circular ring — everyone ships a ring)."
 *
 * §9.1 gives the reason: the app is an account book of ground covered, and the
 * visual language comes from ruled lines and stamped numerals. A ring is a
 * fitness tracker's idiom, and looking like a fitness tracker is how this app
 * ends up compared to one.
 *
 * The fill GROWS to its new value rather than appearing at it. On the home
 * screen this line is redrawn every three seconds against a live step count,
 * and a bar that teleports two pixels every three seconds reads as a rendering
 * fault rather than as progress. §9.5's quiet 180ms is exactly the budget.
 */
interface LedgerRuleProps {
  /** 0-1. Values above 1 are clamped; the cap is a cap. */
  progress: number;
  height?: number;
  /** Ticks that mark the ruled divisions of the line. */
  divisions?: number;
  filledColor?: string;
}

export function LedgerRule({
  progress,
  height = 6,
  divisions = 5,
  filledColor,
}: LedgerRuleProps) {
  const surface = useSurface();
  const reduceMotion = useReduceMotion();
  const clamped = Math.max(0, Math.min(1, progress));

  // A percentage width cannot be driven natively, so this runs on the JS thread.
  // It is a six-pixel bar moving once every few seconds: the native driver would
  // buy nothing here and would rule out interpolating to a percentage, which is
  // what lets the rule sit in any column without measuring itself first.
  const fill = useRef(new Animated.Value(clamped)).current;

  useEffect(() => {
    if (reduceMotion) {
      fill.setValue(clamped);
      return;
    }
    const run = Animated.timing(fill, {
      toValue: clamped,
      duration: motion.quiet,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    });
    run.start();
    return () => run.stop();
  }, [clamped, reduceMotion, fill]);

  return (
    <View
      style={[styles.track, { height, borderRadius: radius.sm, backgroundColor: surface.rule }]}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
    >
      <Animated.View
        style={[
          styles.fill,
          {
            width: fill.interpolate({
              inputRange: [0, 1],
              outputRange: ['0%', '100%'],
            }),
            backgroundColor: filledColor ?? surface.ruleFilled,
            borderRadius: radius.sm,
          },
        ]}
      />
      {/* The ruling. Sits above the fill, so the line reads as marked-off
          distance rather than as a bar that happens to have notches. */}
      <View style={styles.ticks} pointerEvents="none">
        {Array.from({ length: Math.max(0, divisions - 1) }, (_, i) => (
          <View
            key={i}
            style={[styles.tick, { left: `${((i + 1) / divisions) * 100}%`, backgroundColor: surface.bg }]}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: { width: '100%', overflow: 'hidden' },
  fill: { height: '100%' },
  ticks: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  tick: { position: 'absolute', top: 0, bottom: 0, width: 1, opacity: 0.9 },
});
