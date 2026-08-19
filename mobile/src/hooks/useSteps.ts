import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { createStore, useStore } from '@/lib/store';
import { syncSteps } from '@/lib/sync';
import { lastSyncedAt } from '@/lib/queue';
import { checkStepPermission, requestStepPermission, type HealthStatus } from '@/lib/health';
import { hasBeenAsked, registerForPush } from '@/lib/notifications';
import { registerBackgroundSync } from '@/lib/background';
import { refreshWallet, walletStore } from './useWallet';
import { pktToday } from '@/lib/format';

interface StepState {
  today: number;
  coinsToday: number;
  streakDays: number;
  capped: boolean;
  syncing: boolean;
  queued: boolean;
  syncProblem: 'offline' | 'server' | 'signed_out' | null;
  lastSynced: string | null;
  permission: HealthStatus | 'unknown';
}

export const stepStore = createStore<StepState>({
  today: 0,
  coinsToday: 0,
  streakDays: 0,
  capped: false,
  syncing: false,
  queued: false,
  syncProblem: null,
  lastSynced: null,
  permission: 'unknown',
});

export async function sync(): Promise<void> {
  if (stepStore.get().syncing) return;
  stepStore.set({ syncing: true });
  try {
    const result = await syncSteps();
    const today = result.days.find((d) => d.date === pktToday());

    stepStore.set({
      today: today?.credited_steps ?? stepStore.get().today,
      coinsToday: today?.coins_awarded ?? stepStore.get().coinsToday,
      capped: today?.capped ?? false,
      streakDays: result.streak_days,
      queued: result.queued,
      syncProblem: result.reason,
      lastSynced: await lastSyncedAt(),
    });

    // The pinned header balance comes from the same round trip the steps did,
    // so the coin count and the balance can never disagree on screen.
    if (result.ok) walletStore.set({ balance: result.balance });

    // §4 — ask for notifications the moment there is something worth being
    // notified about, and never before. A permission asked on first launch,
    // with nothing yet to lose, is a permission denied forever.
    if (result.ok && (today?.coins_awarded ?? 0) > 0 && !(await hasBeenAsked())) {
      await registerForPush();
    }
  } finally {
    stepStore.set({ syncing: false });
  }
}

export function useSteps() {
  const state = useStore(stepStore);

  const grantPermission = useCallback(async () => {
    const status = await requestStepPermission();
    stepStore.set({ permission: status });
    if (status === 'granted') await sync();
  }, []);

  return { ...state, sync, grantPermission };
}

/**
 * §7.1 — "Read from Health Connect / HealthKit on foreground, plus a background
 * fetch every few hours." This is the foreground half; the background half is
 * registered in app/_layout.tsx.
 */
export function useForegroundSync() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void (async () => {
      // Check, do not request. A system dialog on every foreground is how an app
      // gets permanently denied.
      const status = await checkStepPermission();
      stepStore.set({ permission: status, lastSynced: await lastSyncedAt() });
      if (status === 'granted') await sync();
      await refreshWallet();
      // §7.1's other half: steps keep reaching the server on a day the app is
      // never opened, so the streak survives it.
      await registerBackgroundSync();
      setReady(true);
    })();

    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active' && stepStore.get().permission === 'granted') void sync();
    });
    return () => sub.remove();
  }, []);

  return ready;
}
