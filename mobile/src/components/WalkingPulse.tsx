import { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet } from 'react-native';

import { useSurface } from '@/theme';
import { useReduceMotion } from '@/hooks/useReduceMotion';

/**
 * A five-pixel dot that breathes while the step count is moving.
 *
 * §9.5 is suspicious of exactly this sort of thing — "no scattered
 * micro-interactions" — so it has to earn its place. It does, because the live
 * counter has a failure mode that is invisible without it: a number that has
 * stopped changing because you stopped walking and a number that has stopped
 * changing because the health read is failing look identical. This is the
 * difference, and it is the only reason it exists.
 *
 * It is not brass. §9.2 — brass is coin values, and this is not one.
 */
export function WalkingPulse({ active }: { active: boolean }) {
  const surface = useSurface();
  const reduceMotion = useReduceMotion();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active || reduceMotion) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [active, reduceMotion, pulse]);

  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.dot,
        {
          backgroundColor: active ? surface.good : surface.textFaint,
          // Still visible when it is not moving, and when motion is reduced:
          // "not walking" is information too, and it should not be a blank space.
          opacity: active
            ? pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] })
            : 0.35,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  dot: { width: 5, height: 5, borderRadius: 3 },
});
