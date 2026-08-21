import { Platform } from 'react-native';

import { readDailySteps } from './health';
import { enqueue, readQueue, clearAcknowledged, markSynced } from './queue';
import { attest } from './attest';
import { deviceHash } from './device';
import { supabase, functionsBase } from './supabase';
import { DEMO, demoSync } from './demo';

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
  /** The work is on disk and will go up on the next successful sync. */
  queued: boolean;
  /**
   * Why it did not go up. "offline" is normal and says so gently; "server" is
   * ours and deserves different words. Collapsing the two tells someone on a
   * perfect connection that they have no signal.
   */
  reason: 'offline' | 'server' | 'signed_out' | null;
}

const EMPTY: SyncResult = {
  ok: false, days: [], balance: 0, streak_days: 0, queued: true, reason: 'offline',
};

export async function syncSteps(): Promise<SyncResult> {
  // Preview mode has no Edge Function to submit to and no health store to read.
  // Returning the fixture here rather than short-circuiting useSteps keeps the
  // hook, the store and every screen above them on their real code path.
  if (DEMO) return demoSync as SyncResult;

  // 1. Read the OS health store and put it on disk first. If everything after
  //    this fails, the walk is not lost.
  const fresh = await readDailySteps();
  const queue = await enqueue(fresh);
  if (queue.length === 0) return { ...EMPTY, ok: true, queued: false, reason: null };

  const { data: session } = await supabase.auth.getSession();
  const accessToken = session.session?.access_token;
  if (!accessToken) return { ...EMPTY, reason: 'signed_out' };

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

    if (!res.ok) return { ...EMPTY, reason: 'server' };
    const body = (await res.json()) as Omit<SyncResult, 'ok' | 'queued'>;

    // 3. Only drop days the server actually acknowledged.
    await clearAcknowledged(body.days.map((d) => d.date));
    await markSynced();

    return { ...body, ok: true, queued: false, reason: null };
  } catch {
    // Offline. The queue keeps it; the next sync replays it. This is the
    // ordinary case in this market, not an error.
    return { ...EMPTY, reason: 'offline' };
  }
}

export { readQueue };
