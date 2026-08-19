import { Platform } from 'react-native';

import { pktDayStartIso } from './format';

/**
 * README §7.1 — steps come from the OS health store, and only from there.
 *
 * NO GPS. §2: "No GPS anywhere in the app. We read step counts from the OS health
 * store. This saves battery, avoids a scary permission prompt, and sidesteps the
 * walking-vs-driving classification problem entirely." There is no location
 * import in this file and there must never be one; app.json blocks the three
 * location permissions outright so a transitive dependency cannot add one back.
 */

export interface DailySteps {
  /** YYYY-MM-DD in Asia/Karachi, the only day this product has. */
  date: string;
  steps: number;
}

export type HealthStatus = 'granted' | 'denied' | 'unavailable';

const KARACHI_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Karachi',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function pktDay(d: Date): string {
  return KARACHI_DAY.format(d);
}

// ── Android: Health Connect ────────────────────────────────────────────────
async function androidCheck(): Promise<HealthStatus> {
  const hc = await import('react-native-health-connect');
  const status = await hc.getSdkStatus();
  if (status !== hc.SdkAvailabilityStatus.SDK_AVAILABLE) return 'unavailable';

  await hc.initialize();
  const granted = await hc.getGrantedPermissions();
  return granted.some((p) => p.recordType === 'Steps' && p.accessType === 'read')
    ? 'granted'
    : 'denied';
}

async function androidRequest(): Promise<HealthStatus> {
  const hc = await import('react-native-health-connect');
  const status = await hc.getSdkStatus();
  if (status !== hc.SdkAvailabilityStatus.SDK_AVAILABLE) return 'unavailable';

  await hc.initialize();
  const granted = await hc.requestPermission([{ accessType: 'read', recordType: 'Steps' }]);
  return granted.length > 0 ? 'granted' : 'denied';
}

async function androidRead(sinceDays: number): Promise<DailySteps[]> {
  const hc = await import('react-native-health-connect');
  await hc.initialize();

  const now = new Date();
  const start = new Date(now.getTime() - sinceDays * 86_400_000);

  const result = await hc.readRecords('Steps', {
    timeRangeFilter: {
      operator: 'between',
      startTime: start.toISOString(),
      endTime: now.toISOString(),
    },
  });

  // Health Connect returns individual records, not daily totals. Bucket them by
  // PKT day ourselves rather than trusting the device's own idea of "today",
  // which is the phone's timezone and not necessarily Karachi's.
  const byDay = new Map<string, number>();
  for (const record of result.records) {
    const day = pktDay(new Date(record.startTime));
    byDay.set(day, (byDay.get(day) ?? 0) + record.count);
  }
  return [...byDay.entries()].map(([date, steps]) => ({ date, steps }));
}

// ── iOS: HealthKit ─────────────────────────────────────────────────────────
//
// Apple deliberately does not report READ permission status: an app that could
// ask "may I read steps?" could infer things about the user from the answer. So
// there is no check, only a request, and initHealthKit is silent after the first
// grant. Calling it on launch is therefore safe in a way the Android equivalent
// is not.
async function iosPermission(): Promise<HealthStatus> {
  const { default: AppleHealthKit } = await import('react-native-health');
  const permissions = {
    permissions: {
      // Read only. We never write to Health, and we never ask for anything
      // beyond steps and walking distance.
      read: [
        AppleHealthKit.Constants.Permissions.StepCount,
        AppleHealthKit.Constants.Permissions.DistanceWalkingRunning,
      ],
      write: [],
    },
  };

  return new Promise((resolve) => {
    AppleHealthKit.initHealthKit(permissions, (error) => {
      resolve(error ? 'denied' : 'granted');
    });
  });
}

async function iosRead(sinceDays: number): Promise<DailySteps[]> {
  const { default: AppleHealthKit } = await import('react-native-health');
  const start = new Date(Date.now() - sinceDays * 86_400_000).toISOString();

  return new Promise((resolve) => {
    AppleHealthKit.getDailyStepCountSamples({ startDate: start, ascending: true }, (error, results) => {
      if (error || !results) return resolve([]);
      const byDay = new Map<string, number>();
      for (const sample of results) {
        const day = pktDay(new Date(sample.startDate));
        byDay.set(day, (byDay.get(day) ?? 0) + sample.value);
      }
      resolve([...byDay.entries()].map(([date, steps]) => ({ date, steps: Math.round(steps) })));
    });
  });
}

/**
 * Just today's total, as cheaply as the platform allows.
 *
 * This is the read behind the live counter, so it runs every few seconds while
 * the app is open. readDailySteps() pulls three days of individual records and
 * buckets them; doing that at 3-second intervals would be wasteful on the
 * three-year-old Android §9.7 names as the real hardware.
 */
async function androidToday(): Promise<number> {
  const hc = await import('react-native-health-connect');
  await hc.initialize();

  const from = pktDayStartIso();
  const result = await hc.aggregateRecord({
    recordType: 'Steps',
    timeRangeFilter: { operator: 'between', startTime: from, endTime: new Date().toISOString() },
  });
  return Number((result as { COUNT_TOTAL?: number }).COUNT_TOTAL ?? 0);
}

async function iosToday(): Promise<number> {
  const { default: AppleHealthKit } = await import('react-native-health');
  const start = pktDayStartIso();

  return new Promise((resolve) => {
    AppleHealthKit.getDailyStepCountSamples({ startDate: start, ascending: true }, (error, results) => {
      if (error || !results) return resolve(0);
      const today = pktDay(new Date());
      resolve(
        Math.round(
          results
            .filter((sample) => pktDay(new Date(sample.startDate)) === today)
            .reduce((total, sample) => total + sample.value, 0),
        ),
      );
    });
  });
}

/**
 * Today's step count from the OS, for display only.
 *
 * Nothing here becomes coins. The server decides that from what it is sent and
 * what its own rules allow (§13.2) — this is the number on the screen, which is
 * a different thing and is allowed to move every three seconds.
 */
export async function readTodaySteps(): Promise<number | null> {
  try {
    return Platform.OS === 'android' ? await androidToday() : await iosToday();
  } catch (e) {
    console.warn('live step read failed', e);
    return null;
  }
}

// ── the interface the app uses ─────────────────────────────────────────────

/**
 * Ask the OS what we already have, WITHOUT prompting.
 *
 * This is what runs on every foreground. Calling requestPermission there instead
 * puts a system dialog in front of someone every time they open the app, which
 * is both maddening and the fastest way to get permanently denied.
 */
export async function checkStepPermission(): Promise<HealthStatus> {
  try {
    return Platform.OS === 'android' ? await androidCheck() : await iosPermission();
  } catch (e) {
    console.warn('health permission check failed', e);
    return 'unavailable';
  }
}

/** Prompt. Only ever from a button the user pressed. */
export async function requestStepPermission(): Promise<HealthStatus> {
  try {
    return Platform.OS === 'android' ? await androidRequest() : await iosPermission();
  } catch (e) {
    console.warn('health permission request failed', e);
    return 'unavailable';
  }
}

/**
 * §7.1 — "a one-tap route to settings" when permission was refused. Health
 * Connect has its own settings screen; the OS app settings page does not show
 * health permissions at all on Android, so Linking.openSettings() would land
 * someone somewhere that cannot help them.
 */
export async function openStepPermissionSettings(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    const hc = await import('react-native-health-connect');
    hc.openHealthConnectSettings();
  } catch (e) {
    console.warn('could not open Health Connect settings', e);
  }
}

/**
 * §6.1 caps retroactive data at 48 hours server-side, so reading three days is
 * generous and covers a phone that was off overnight.
 */
export async function readDailySteps(sinceDays = 3): Promise<DailySteps[]> {
  try {
    const rows = Platform.OS === 'android' ? await androidRead(sinceDays) : await iosRead(sinceDays);
    return rows.filter((r) => r.steps > 0).sort((a, b) => a.date.localeCompare(b.date));
  } catch (e) {
    console.warn('health read failed', e);
    return [];
  }
}

export { pktDay };
