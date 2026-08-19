import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { createStore, useStore } from '@/lib/store';
import { readTodaySteps } from '@/lib/health';
import { stepStore } from './useSteps';

/**
 * The live step count, the way Sweatcoin does it: the number on the home screen
 * moves while you watch it, rather than jumping when a sync happens.
 *
 * The important separation, and the reason this is a different hook from
 * useSteps: THIS IS DISPLAY ONLY. It reads the device's own health store every
 * few seconds and shows what it finds. It never sends anything anywhere and it
 * never mints a coin. Coins still come only from the server, from what the
 * server was sent and what its own rules allow (§13.2) — a counter that ticked
 * coins up locally would be a client deciding what it had earned, which is the
 * one thing this product must never do.
 *
 * So the screen shows two truths at once and they are both honest: how far you
 * have walked (live, from the phone) and how much of it has been counted and
 * paid (from the server, on its own slower cadence).
 */
interface LiveState {
  /** What the phone says right now. null until the first read lands. */
  steps: number | null;
  /** The last value the server confirmed, so the display can never go backwards. */
  floor: number;
}

export const liveStepStore = createStore<LiveState>({ steps: null, floor: 0 });

/** Three seconds reads as live without being a battery complaint (§9.7). */
const FOREGROUND_INTERVAL_MS = 3_000;

export function useLiveStepTicker(): void {
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    const read = async () => {
      const steps = await readTodaySteps();
      if (cancelled || steps === null) return;

      // The server's credited figure is a floor, not a ceiling: it is what has
      // been counted, and the phone may legitimately be ahead of it. Taking the
      // larger keeps the number from lurching backwards after a sync.
      const floor = stepStore.get().today;
      liveStepStore.set({ steps: Math.max(steps, floor), floor });
    };

    const start = () => {
      void read();
      timer.current ??= setInterval(() => void read(), FOREGROUND_INTERVAL_MS);
    };

    const stop = () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };

    start();

    // Polling a sensor in the background is how an app ends up on a "drains my
    // battery" list. It stops the moment the app is not being looked at.
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') start();
      else stop();
    });

    return () => {
      cancelled = true;
      stop();
      sub.remove();
    };
  }, []);
}

export function useLiveSteps() {
  return useStore(liveStepStore);
}
