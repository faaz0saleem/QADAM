import { useEffect, useRef, useState } from 'react';
import { type TextStyle } from 'react-native';

import { Text } from './ui';
import { formatNumber } from '@/lib/format';
import { motion } from '@/theme';
import { useReduceMotion } from '@/hooks/useReduceMotion';

/**
 * A number that counts up to its new value rather than jumping to it.
 *
 * §9.3 is why this is safe to do at all: the figure is set in a monospace face
 * with tabular figures, so every digit occupies the same width and the number
 * does not shuffle sideways as it climbs. Try this with proportional numerals
 * and it reads as a glitch.
 *
 * It only ever counts UP. A step count does not fall within a day, so a lower
 * value means a fresh day or a corrected reading — either way it snaps, because
 * animating downward would look like losing something.
 */
export function TickingNumber({
  value,
  variant = 'counter',
  style,
  durationMs = 900,
  accessibilityLabel,
}: {
  value: number;
  variant?: 'counter' | 'dataLarge' | 'data';
  style?: TextStyle;
  durationMs?: number;
  accessibilityLabel?: string;
}) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  const frame = useRef<ReturnType<typeof setInterval> | null>(null);
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    if (value === shown) return;

    // §9.5 respects reduced motion by replacing movement with a value change.
    // Down is a snap too: nothing is gained by animating a number backwards.
    if (reduceMotion || value < shown) {
      from.current = value;
      setShown(value);
      return;
    }

    const start = shown;
    const delta = value - start;
    const began = Date.now();

    if (frame.current) clearInterval(frame.current);
    frame.current = setInterval(() => {
      const t = Math.min(1, (Date.now() - began) / durationMs);
      // Ease out: quick off the mark, settling into the final value rather than
      // stopping dead on it.
      const eased = 1 - Math.pow(1 - t, 3);
      setShown(Math.round(start + delta * eased));

      if (t >= 1 && frame.current) {
        clearInterval(frame.current);
        frame.current = null;
      }
    }, 1000 / 30);

    return () => {
      if (frame.current) clearInterval(frame.current);
      frame.current = null;
    };
    // `shown` deliberately absent: including it restarts the animation on every
    // frame it sets, which is an interval that never finishes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, durationMs, reduceMotion]);

  return (
    <Text
      variant={variant}
      style={style}
      numberOfLines={1}
      adjustsFontSizeToFit
      accessibilityLabel={accessibilityLabel}
    >
      {formatNumber(shown)}
    </Text>
  );
}

export const TICK_DURATION_MS = motion.quiet * 5;
