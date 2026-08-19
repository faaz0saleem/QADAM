import type { DayReading, HealthSource, PermissionState } from './index';
import { pktDateString, startOfPktDay } from '../dates';

/**
 * Android — Health Connect (§2). Read-only Steps.
 *
 * Health Connect delivers step data in batches, so a read can return several
 * hours of steps at once. That is normal and expected; the server's rate
 * ceiling is measured against elapsed time inside the day rather than against
 * the gap between syncs precisely so this does not look like fraud.
 */
const source: HealthSource = {
  name: 'health_connect',

  async checkPermission(): Promise<PermissionState> {
    const hc = await import('react-native-health-connect');
    const status = await hc.getSdkStatus();
    if (status !== hc.SdkAvailabilityStatus.SDK_AVAILABLE) return 'unavailable';
    const granted = await hc.getGrantedPermissions();
    return granted.some((p) => p.recordType === 'Steps' && p.accessType === 'read')
      ? 'granted'
      : 'undetermined';
  },

  async requestPermission(): Promise<PermissionState> {
    const hc = await import('react-native-health-connect');
    await hc.initialize();
    const granted = await hc.requestPermission([{ accessType: 'read', recordType: 'Steps' }]);
    return granted.length > 0 ? 'granted' : 'denied';
  },

  async readDays(days: number): Promise<DayReading[]> {
    const hc = await import('react-native-health-connect');
    await hc.initialize();

    const out: DayReading[] = [];
    for (let i = 0; i < days; i += 1) {
      const start = startOfPktDay(i);
      const end = startOfPktDay(i - 1);
      const result = await hc.aggregateRecord({
        recordType: 'Steps',
        timeRangeFilter: {
          operator: 'between',
          startTime: start.toISOString(),
          endTime: end.toISOString(),
        },
      });
      out.push({ date: pktDateString(start), steps: Number(result.COUNT_TOTAL ?? 0) });
    }
    return out;
  },
};

export default source;
