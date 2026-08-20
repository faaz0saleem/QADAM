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
 * couple of seconds and shows what it finds. It never sends anything anywhere
 * and it never mints a coin. Coins still come only from the server, from what
 * the server was sent and what its own rules allow (§13.2) — a counter that
 * ticked coins up locally would be a client deciding what it had earned, which
 * is the one thing this product must never do.
 *
 * So the screen shows two truths at once and they are both honest: how far you
 * have walked (live, from the phone) and how much of it has been counted and
 * paid (from the server, on its own slower cadence).
 *
 * WHY POLLING, AND NOT AN OBSERVER
 *
 * The obvious objection is that both platforms can push. They can, and neither
 * push is usable here. HealthKit's HKObserverQuery for step count is documented
 * with a minimum update frequency of ONE HOUR — "this frequency is enforced
 * transparently" — so an observer would deliver the first update sometime after
 * lunch. Health Connect's change tokens are a delta API for sync, not a
 * subscription, and reading them costs the same as reading the aggregate.
 *
 * Polling is therefore not the lazy option; it is the only one that produces a
 * number that moves while you walk. What it must not be is a fixed 3-second
 * timer that runs all day whether or not anything is happening — §9.7's target
 * device is a three-year-old Android, and that is how an app gets uninstalled
 * for battery. So the cadence follows the walking.
 */
interface LiveState {
  /** What the phone says right now. null until the first read lands. */
  steps: number | null;
  /** The last value the server confirmed, so the display can never go backwards. */
  floor: number;
  /** True while the count is actually moving — the UI shows this, quietly. */
  walking: boolean;
}

export const liveStepStore = createStore<LiveState>({ steps: null, floor: 0, walking: false });

/**
 * Three cadences, and the rule for moving between them.
 *
 * Someone walking produces a new figure on almost every read: stay at 1.5s and
 * the number climbs continuously, which is the whole effect. Someone sitting
 * produces the same figure forever: there is nothing to show and no reason to
 * ask, so the interval opens out. Coming back to a phone and finding the count
 * already right is what the foreground read is for.
 */
const WALKING_MS = 1_500;
const SETTLING_MS = 3_500;
const RESTING_MS = 10_000;

/** Reads with no change before each step down. Two is about four seconds. */
const SETTLE_AFTER = 2;
const REST_AFTER = 8;

function cadenceFor(unchanged: number): number {
  if (unchanged <= SETTLE_AFTER) return WALKING_MS;
  if (unchanged <= REST_AFTER) return SETTLING_MS;
  return RESTING_MS;
}

export function useLiveStepTicker(): void {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unchanged = 0;
    let last: number | null = null;

    const stop = () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };

    const read = async () => {
      const steps = await readTodaySteps();
      if (cancelled) return;

      if (steps !== null) {
        if (last !== null && steps === last) {
          unchanged += 1;
        } else {
          unchanged = 0;
          last = steps;
        }

        // The server's credited figure is a floor, not a ceiling: it is what has
        // been counted, and the phone may legitimately be ahead of it. Taking
        // the larger keeps the number from lurching backwards after a sync.
        const floor = stepStore.get().today;
        liveStepStore.set({
          steps: Math.max(steps, floor),
          floor,
          walking: unchanged <= SETTLE_AFTER && last !== null,
        });
      }

      // setTimeout rather than setInterval, so the next read is scheduled from
      // the end of this one. An interval on a slow health read stacks calls.
      if (!cancelled) timer.current = setTimeout(() => void read(), cadenceFor(unchanged));
    };

    const start = () => {
      stop();
      // Back from the pocket: ask immediately and at the fast cadence, because
      // the interesting case is someone who has just finished a walk.
      unchanged = 0;
      void read();
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
