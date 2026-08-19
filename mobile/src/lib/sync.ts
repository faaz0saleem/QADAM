import { Platform } from 'react-native';

import { readDailySteps } from './health';
import { enqueue, readQueue, clearAcknowledged, markSynced } from './queue';
import { attest } from './attest';
import { deviceHash } from './device';
import { supabase, functionsBase } from './supabase';

/**
 * §7.1 — "Sync silently and often; never make the user press a sync button, but
 * do show last-synced time so failures are visible."
 *
 * The whole client contribution to the coin economy is right here, and it is
 * three fields: a date, a raw step count, and a device hash. No coin value, no
 * balance, no discount — §13.2. The server decides everything else.
 */
export interface SyncResult {
  ok: boolean;
  days: Array<{ date: string; credited_steps: number; coins_awarded: number; capped: boolean }>;
  balance: number;
  streak_days: number;
  /** True when the work is on disk but did not reach the server. */
  queued: boolean;
}

const EMPTY: SyncResult = { ok: false, days: [], balance: 0, streak_days: 0, queued: true };

export async function syncSteps(): Promise<SyncResult> {
  // 1. Read the OS health store and put it on disk first. If everything after
  //    this fails, the walk is not lost.
  const fresh = await readDailySteps();
  const queue = await enqueue(fresh);
  if (queue.length === 0) return { ...EMPTY, ok: true, queued: false };

  const { data: session } = await supabase.auth.getSession();
  const accessToken = session.session?.access_token;
  if (!accessToken) return EMPTY;

  // 2. Attest. A null here still submits — the server records it and credits
  //    nothing, and the response looks identical either way.
  const attestation = await attest();

  try {
    const res = await fetch(`${functionsBase}/ingest-steps`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        samples: queue.map((row) => ({ date: row.date, raw_steps: row.steps })),
        platform: Platform.OS === 'android' ? 'android' : 'ios',
        source: Platform.OS === 'android' ? 'health_connect' : 'healthkit',
        device_hash: await deviceHash(),
        attestation_token: attestation?.token ?? '',
        nonce: attestation?.nonce ?? '',
      }),
    });

    if (!res.ok) return EMPTY;
    const body = (await res.json()) as Omit<SyncResult, 'ok' | 'queued'>;

    // 3. Only drop days the server actually acknowledged.
    await clearAcknowledged(body.days.map((d) => d.date));
    await markSynced();

    return { ...body, ok: true, queued: false };
  } catch {
    // Offline. The queue keeps it; the next sync replays it.
    return { ...EMPTY, days: [], queued: true };
  }
}

export { readQueue };
