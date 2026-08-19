// Expo push delivery.
//
// Coin expiry and streak-break reminders are the retention engine (§2, §4), so
// this is not a nice-to-have path — it is the reactivation lever. It batches,
// it reports which tokens Expo rejected, and it never throws into the caller.

export interface PushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface PushOutcome {
  sent: number;
  failed: number;
  invalidTokens: string[];
}

const EXPO_ENDPOINT = 'https://exp.host/--/api/v2/push/send';
const BATCH = 100;

export async function sendPush(messages: PushMessage[]): Promise<PushOutcome> {
  const outcome: PushOutcome = { sent: 0, failed: 0, invalidTokens: [] };

  for (let i = 0; i < messages.length; i += BATCH) {
    const batch = messages.slice(i, i + BATCH);
    try {
      const res = await fetch(EXPO_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          ...(Deno.env.get('EXPO_ACCESS_TOKEN')
            ? { Authorization: `Bearer ${Deno.env.get('EXPO_ACCESS_TOKEN')}` }
            : {}),
        },
        body: JSON.stringify(batch.map((m) => ({ ...m, sound: 'default', priority: 'high' }))),
      });

      if (!res.ok) {
        console.error('expo push http', res.status);
        outcome.failed += batch.length;
        continue;
      }

      const body = await res.json();
      const tickets: Array<{ status: string; details?: { error?: string } }> = body.data ?? [];
      tickets.forEach((ticket, idx) => {
        if (ticket.status === 'ok') {
          outcome.sent++;
        } else {
          outcome.failed++;
          // Expo tells us when a token is dead. Collect them so the caller can
          // prune rather than pushing at a reinstalled phone forever.
          if (ticket.details?.error === 'DeviceNotRegistered') {
            outcome.invalidTokens.push(batch[idx].to);
          }
        }
      });
    } catch (e) {
      console.error('expo push threw', e);
      outcome.failed += batch.length;
    }
  }

  return outcome;
}

/** Grouped thousands, the way a Pakistani reader expects to see a coin count. */
export function formatCount(n: number): string {
  return n.toLocaleString('en-US');
}
