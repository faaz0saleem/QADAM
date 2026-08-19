import AsyncStorage from '@react-native-async-storage/async-storage';

import type { DailySteps } from './health';

/**
 * §9.7 — "works offline for the steps screen (queue submissions, sync later)."
 *
 * Pakistan's mobile data is patchy enough that a walk recorded on a train and
 * lost at the end of it is a real, repeated experience. Samples are queued on
 * disk, merged by day, and replayed on the next successful connection.
 *
 * Merging keeps the HIGHEST count per day rather than the newest. A step counter
 * only rises within a day, so the highest reading is the truest one, and the
 * server rejects anything that looks like a regression anyway.
 */
const KEY = 'qadam.stepQueue.v1';

export interface QueuedDay extends DailySteps {
  queuedAt: string;
}

export async function readQueue(): Promise<QueuedDay[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as QueuedDay[]) : [];
  } catch {
    return [];
  }
}

export async function enqueue(samples: DailySteps[]): Promise<QueuedDay[]> {
  const existing = await readQueue();
  const byDay = new Map<string, QueuedDay>();

  for (const row of existing) byDay.set(row.date, row);
  for (const row of samples) {
    const prior = byDay.get(row.date);
    if (!prior || row.steps > prior.steps) {
      byDay.set(row.date, { ...row, queuedAt: new Date().toISOString() });
    }
  }

  const merged = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  await AsyncStorage.setItem(KEY, JSON.stringify(merged));
  return merged;
}

/** Called only after the server has acknowledged the days in question. */
export async function clearAcknowledged(dates: string[]): Promise<void> {
  const remaining = (await readQueue()).filter((row) => !dates.includes(row.date));
  await AsyncStorage.setItem(KEY, JSON.stringify(remaining));
}

const SYNCED_AT = 'qadam.lastSyncedAt';

export async function markSynced(): Promise<void> {
  await AsyncStorage.setItem(SYNCED_AT, new Date().toISOString());
}

export async function lastSyncedAt(): Promise<string | null> {
  return AsyncStorage.getItem(SYNCED_AT);
}
