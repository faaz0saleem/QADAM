import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState as RNAppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as api from './api';
import { getHealthSource, PermissionState } from '../lib/health';
import { pktDateString } from '../lib/dates';
import type { CoinBatch, TodaySteps } from './types';

const QUEUE_KEY = 'qadam.pendingSteps.v1';

interface Pending {
  date: string;
  rawSteps: number;
  source: 'health_connect' | 'healthkit';
}

interface AppStateValue {
  ready: boolean;
  userId: string | null;
  balance: number;
  today: TodaySteps;
  batches: CoinBatch[];
  permission: PermissionState;
  syncing: boolean;
  error: string | null;
  requestPermission: () => Promise<void>;
  sync: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AppStateValue | null>(null);

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [balance, setBalance] = useState(0);
  const [today, setToday] = useState<TodaySteps>({
    date: pktDateString(),
    rawSteps: 0,
    creditedSteps: 0,
    coinsToday: 0,
    dailyCap: 15000,
    streak: 0,
    lastSyncedAt: null,
  });
  const [batches, setBatches] = useState<CoinBatch[]>([]);
  const [permission, setPermission] = useState<PermissionState>('undetermined');
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const [b, t, batch] = await Promise.all([
        api.getBalance(userId),
        api.getToday(userId),
        api.getBatches(userId),
      ]);
      setBalance(b);
      setToday(t);
      setBatches(batch);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong');
    }
  }, [userId]);

  /**
   * §9.7 — works offline: a submission that cannot reach the server is queued
   * and replayed. §6.1's 48-hour backfill limit means a queue older than that is
   * worthless, so stale entries are dropped rather than retried forever.
   */
  const drainQueue = useCallback(async () => {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    if (!raw) return;
    let queue: Pending[] = [];
    try {
      queue = JSON.parse(raw);
    } catch {
      await AsyncStorage.removeItem(QUEUE_KEY);
      return;
    }

    const cutoff = pktDateString(new Date(Date.now() - 48 * 3600 * 1000));
    const fresh = queue.filter((q) => q.date >= cutoff);
    const failed: Pending[] = [];

    for (const item of fresh) {
      try {
        await api.submitSteps(item.date, item.rawSteps, item.source);
      } catch {
        failed.push(item);
      }
    }
    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(failed));
  }, []);

  const sync = useCallback(async () => {
    // §7.1: sync silently and often, and never make the user press a button.
    if (inFlight.current) return;
    inFlight.current = true;
    setSyncing(true);
    try {
      const health = await getHealthSource();
      const state = await health.checkPermission();
      setPermission(state);

      if (state === 'granted' && health.name !== 'none') {
        // §6.1 caps backfill at 48 hours, so there is no point reading further.
        const readings = await health.readDays(3);
        for (const r of readings) {
          try {
            await api.submitSteps(r.date, r.steps, health.name);
          } catch {
            const raw = await AsyncStorage.getItem(QUEUE_KEY);
            const queue: Pending[] = raw ? JSON.parse(raw) : [];
            const next = queue.filter((q) => q.date !== r.date);
            next.push({ date: r.date, rawSteps: r.steps, source: health.name });
            await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(next));
          }
        }
      }
      await drainQueue();
      await refresh();
    } finally {
      inFlight.current = false;
      setSyncing(false);
    }
  }, [drainQueue, refresh]);

  const requestPermission = useCallback(async () => {
    const health = await getHealthSource();
    setPermission(await health.requestPermission());
    await sync();
  }, [sync]);

  useEffect(() => {
    (async () => {
      const { supabase } = await import('../lib/supabase');
      const session = await supabase?.auth.getSession();
      setUserId(session?.data.session?.user.id ?? null);
      await sync();
      setReady(true);
    })();
    // §7.1: and a foreground sync, so the count is right the moment they look.
    const sub = RNAppState.addEventListener('change', (s) => {
      if (s === 'active') sync();
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<AppStateValue>(
    () => ({
      ready, userId, balance, today, batches, permission, syncing, error,
      requestPermission, sync, refresh,
    }),
    [ready, userId, balance, today, batches, permission, syncing, error, requestPermission, sync, refresh],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppState(): AppStateValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAppState must be used inside <AppStateProvider>');
  return ctx;
}
