import AsyncStorage from '@react-native-async-storage/async-storage';

import { enqueue, readQueue, clearAcknowledged, markSynced, lastSyncedAt } from '../queue';

beforeEach(async () => {
  await AsyncStorage.clear();
});

/**
 * §9.7 — the steps screen works offline: queue submissions, sync later.
 *
 * The merge rule is the part worth defending. A step counter only rises within a
 * day, so the HIGHEST reading for a day is the truest one — merging by "newest
 * wins" would let a stale or reset reading overwrite a real walk.
 */
describe('the offline step queue', () => {
  it('starts empty', async () => {
    expect(await readQueue()).toEqual([]);
  });

  it('keeps one row per day', async () => {
    await enqueue([{ date: '2026-08-19', steps: 4000 }]);
    await enqueue([{ date: '2026-08-19', steps: 6000 }]);

    const queue = await readQueue();
    expect(queue).toHaveLength(1);
    expect(queue[0]?.steps).toBe(6000);
  });

  it('keeps the HIGHEST count for a day, not the newest', async () => {
    await enqueue([{ date: '2026-08-19', steps: 9000 }]);
    // A reinstall or a device swap can report a lower figure for the same day.
    // Taking it would silently delete most of someone's walk.
    await enqueue([{ date: '2026-08-19', steps: 120 }]);

    expect((await readQueue())[0]?.steps).toBe(9000);
  });

  it('holds several days at once and keeps them in order', async () => {
    await enqueue([
      { date: '2026-08-19', steps: 3000 },
      { date: '2026-08-17', steps: 8000 },
      { date: '2026-08-18', steps: 5000 },
    ]);

    expect((await readQueue()).map((r) => r.date)).toEqual([
      '2026-08-17',
      '2026-08-18',
      '2026-08-19',
    ]);
  });

  it('drops only the days the server acknowledged', async () => {
    await enqueue([
      { date: '2026-08-18', steps: 5000 },
      { date: '2026-08-19', steps: 3000 },
    ]);

    await clearAcknowledged(['2026-08-18']);

    const remaining = await readQueue();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.date).toBe('2026-08-19');
  });

  it('survives a corrupt store rather than throwing into the sync path', async () => {
    await AsyncStorage.setItem('qadam.stepQueue.v1', 'not json');
    expect(await readQueue()).toEqual([]);
  });

  it('records when the last successful sync happened', async () => {
    expect(await lastSyncedAt()).toBeNull();
    await markSynced();
    expect(await lastSyncedAt()).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
