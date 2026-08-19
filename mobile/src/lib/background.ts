import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';

import { syncSteps } from './sync';

/**
 * §7.1 — "Read from Health Connect / HealthKit on foreground, plus a background
 * fetch every few hours."
 *
 * The foreground half lives in useForegroundSync. This is the other half, and it
 * is what makes the streak survive a day the app was never opened: steps still
 * reach the server, coins are still minted, and the evening streak reminder has
 * something true to say.
 *
 * Both platforms treat the interval as a hint. iOS in particular runs background
 * work when it feels like it, often overnight. That is fine — the server accepts
 * 48 hours of backfill (§6.1), so a missed window costs nothing as long as the
 * app opens within two days.
 */
export const STEP_SYNC_TASK = 'qadam-step-sync';

TaskManager.defineTask(STEP_SYNC_TASK, async () => {
  try {
    const result = await syncSteps();
    return result.ok ? BackgroundTask.BackgroundTaskResult.Success : BackgroundTask.BackgroundTaskResult.Failed;
  } catch (e) {
    console.warn('background step sync failed', e);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function registerBackgroundSync(): Promise<void> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status === BackgroundTask.BackgroundTaskStatus.Restricted) return;

    if (await TaskManager.isTaskRegisteredAsync(STEP_SYNC_TASK)) return;

    // Four hours. Often enough that a day of walking is never more than a
    // quarter stale, rare enough not to be a battery complaint on a mid-range
    // Android (§9.7).
    await BackgroundTask.registerTaskAsync(STEP_SYNC_TASK, { minimumInterval: 4 * 60 });
  } catch (e) {
    console.warn('background sync registration failed', e);
  }
}
