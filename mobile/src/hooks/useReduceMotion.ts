import { useEffect, useState } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * §9.5 — "Respect prefers-reduced-motion."
 *
 * Three components need this answer and each one had its own copy of the
 * listener. One copy means one place to be wrong, and one place to fix when the
 * setting changes while the app is open — which it does, because someone turning
 * it on is usually turning it on BECAUSE of what they are looking at.
 */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((on) => {
      if (alive) setReduce(on);
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  return reduce;
}
