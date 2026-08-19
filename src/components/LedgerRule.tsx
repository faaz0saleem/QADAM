import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, View } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { motion } from '../theme/tokens';

/**
 * §9.4 — "a horizontal progress rule toward the daily cap (a ruled ledger line
 * filling, NOT a circular ring — everyone ships a ring)".
 *
 * A 2px rule that fills left to right, with tick marks at the quarters so the
 * distance travelled reads as a measurement rather than a bar.
 */
export function LedgerRule({
  progress,
  ticks = 4,
  height = 2,
  label,
}: {
  /** 0..1 */
  progress: number;
  ticks?: number;
  height?: number;
  label?: string;
}) {
  const theme = useTheme();
  const clamped = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const fill = useRef(new Animated.Value(clamped)).current;

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then((reduced) => {
      if (reduced) {
        fill.setValue(clamped);
        return;
      }
      Animated.timing(fill, {
        toValue: clamped,
        duration: motion.settle,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }).start();
    });
  }, [clamped, fill]);

  const width = fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
    >
      <View style={{ height, backgroundColor: theme.line, borderRadius: height }}>
        <Animated.View
          style={{ width, height, backgroundColor: theme.coin, borderRadius: height }}
        />
      </View>
      <View style={{ flexDirection: 'row', marginTop: 6 }}>
        {Array.from({ length: ticks }).map((_, i) => (
          <View key={i} style={{ flex: 1, alignItems: 'flex-end' }}>
            <View
              style={{
                width: 1,
                height: 4,
                backgroundColor: theme.line,
                opacity: i === ticks - 1 ? 0 : 1,
              }}
            />
          </View>
        ))}
      </View>
    </View>
  );
}
