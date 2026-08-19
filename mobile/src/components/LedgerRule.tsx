import { StyleSheet, View } from 'react-native';

import { earning, radius } from '@/theme';

/**
 * §9.4 — "A horizontal progress rule toward the daily cap (a ruled ledger line
 * filling, NOT a circular ring — everyone ships a ring)."
 *
 * §9.1 gives the reason: the app is an account book of ground covered, and the
 * visual language comes from ruled lines and stamped numerals. A ring is a
 * fitness tracker's idiom, and looking like a fitness tracker is how this app
 * ends up compared to one.
 */
interface LedgerRuleProps {
  /** 0–1. Values above 1 are clamped; the cap is a cap. */
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
  filledColor = earning.ruleFilled,
}: LedgerRuleProps) {
  const clamped = Math.max(0, Math.min(1, progress));

  return (
    <View
      style={[styles.track, { height, borderRadius: radius.sm }]}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
    >
      <View
        style={[
          styles.fill,
          { width: `${clamped * 100}%`, backgroundColor: filledColor, borderRadius: radius.sm },
        ]}
      />
      {/* The ruling. Sits above the fill, so the line reads as marked-off
          distance rather than as a bar that happens to have notches. */}
      <View style={styles.ticks} pointerEvents="none">
        {Array.from({ length: Math.max(0, divisions - 1) }, (_, i) => (
          <View key={i} style={[styles.tick, { left: `${((i + 1) / divisions) * 100}%` }]} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    width: '100%',
    backgroundColor: earning.rule,
    overflow: 'hidden',
  },
  fill: { height: '100%' },
  ticks: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  tick: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: earning.bg,
    opacity: 0.9,
  },
});
