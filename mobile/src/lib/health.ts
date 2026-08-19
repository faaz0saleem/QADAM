import { Platform } from 'react-native';

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
async function androidPermission(): Promise<HealthStatus> {
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

// ── the interface the app uses ─────────────────────────────────────────────
export async function requestStepPermission(): Promise<HealthStatus> {
  try {
    return Platform.OS === 'android' ? await androidPermission() : await iosPermission();
  } catch (e) {
    console.warn('health permission failed', e);
    return 'unavailable';
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
