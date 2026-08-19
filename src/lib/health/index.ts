import { Platform } from 'react-native';

/**
 * §2, §7.1 — step counts come from the OS health store. No GPS anywhere: it
 * saves battery, avoids a frightening permission prompt, and sidesteps the
 * walking-vs-driving classification problem entirely.
 *
 * Both platforms sit behind this one interface. The concrete modules
 * (`react-native-health-connect` on Android, `react-native-health` on iOS) are
 * native, so they need a dev build — see HUMAN_TASKS.md.
 */

export type PermissionState = 'granted' | 'denied' | 'unavailable' | 'undetermined';

export interface DayReading {
  /** Pakistan date, YYYY-MM-DD. */
  date: string;
  steps: number;
}

export interface HealthSource {
  readonly name: 'health_connect' | 'healthkit' | 'none';
  checkPermission(): Promise<PermissionState>;
  requestPermission(): Promise<PermissionState>;
  /** Daily totals for the last `days` days, most recent first. */
  readDays(days: number): Promise<DayReading[]>;
}

/**
 * A source that reports nothing. Used on web and in a simulator without the
 * native module, so that the permission-denied path (§7.1) is exercised rather
 * than the app rendering a blank screen.
 */
const none: HealthSource = {
  name: 'none',
  async checkPermission() {
    return 'unavailable';
  },
  async requestPermission() {
    return 'unavailable';
  },
  async readDays() {
    return [];
  },
};

let cached: HealthSource | null = null;

export async function getHealthSource(): Promise<HealthSource> {
  if (cached) return cached;

  try {
    if (Platform.OS === 'android') {
      cached = (await import('./healthConnect')).default;
    } else if (Platform.OS === 'ios') {
      cached = (await import('./healthKit')).default;
    } else {
      cached = none;
    }
  } catch {
    // The native module is missing — Expo Go, web, or a build without it.
    // Falling back keeps the permission screen reachable instead of crashing.
    cached = none;
  }
  return cached!;
}
