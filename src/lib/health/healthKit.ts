import type { DayReading, HealthSource, PermissionState } from './index';
import { pktDateString, startOfPktDay } from '../dates';

/**
 * iOS — HealthKit (§2). Read-only step count and distance, nothing else.
 *
 * Apple's HealthKit terms forbid using health data for advertising. The rewarded
 * video in §7.8 shows an ad next to a step count; it must never target on one.
 */
const source: HealthSource = {
  name: 'healthkit',

  async checkPermission(): Promise<PermissionState> {
    const { default: AppleHealthKit } = await import('react-native-health');
    return new Promise((resolve) => {
      AppleHealthKit.isAvailable((err: unknown, available: boolean) => {
        if (err || !available) return resolve('unavailable');
        AppleHealthKit.getAuthStatus(
          { permissions: { read: [AppleHealthKit.Constants.Permissions.StepCount], write: [] } },
          (statusErr: unknown, result: { permissions: { read: number[] } }) => {
            if (statusErr) return resolve('undetermined');
            resolve(result.permissions.read.every((s) => s === 2) ? 'granted' : 'undetermined');
          },
        );
      });
    });
  },

  async requestPermission(): Promise<PermissionState> {
    const { default: AppleHealthKit } = await import('react-native-health');
    return new Promise((resolve) => {
      AppleHealthKit.initHealthKit(
        {
          permissions: {
            // Read-only, and only these two. §2: step + distance, nothing else.
            read: [
              AppleHealthKit.Constants.Permissions.StepCount,
              AppleHealthKit.Constants.Permissions.DistanceWalkingRunning,
            ],
            write: [],
          },
        },
        (err: unknown) => resolve(err ? 'denied' : 'granted'),
      );
    });
  },

  async readDays(days: number): Promise<DayReading[]> {
    const { default: AppleHealthKit } = await import('react-native-health');
    return new Promise((resolve) => {
      AppleHealthKit.getDailyStepCountSamples(
        {
          startDate: startOfPktDay(days - 1).toISOString(),
          endDate: new Date().toISOString(),
        },
        (err: unknown, samples: Array<{ startDate: string; value: number }>) => {
          if (err) return resolve([]);
          const byDay = new Map<string, number>();
          for (const s of samples ?? []) {
            const key = pktDateString(new Date(s.startDate));
            byDay.set(key, (byDay.get(key) ?? 0) + s.value);
          }
          resolve(
            [...byDay.entries()]
              .map(([date, steps]) => ({ date, steps: Math.round(steps) }))
              .sort((a, b) => (a.date < b.date ? 1 : -1)),
          );
        },
      );
    });
  },
};

export default source;
