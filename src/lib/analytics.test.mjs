// docs/METRICS.md §2 — the buffer, and the rules it must not break.

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  track, flush, configureAnalytics, setAnalyticsUser, startSession, currentSession,
  __resetAnalytics, __bufferSize,
} from './analytics.ts';

function recordingSink() {
  const batches = [];
  return {
    batches,
    async send(events, context) { batches.push({ events, context }); },
  };
}

beforeEach(() => __resetAnalytics());

describe('buffering', () => {
  test('batches events rather than sending one request each', async () => {
    const sink = recordingSink();
    configureAnalytics(sink);
    track('app_open', { days_since_install: 3 });
    track('steps_synced', { raw: 8000, credited: 8000, capped: false });
    assert.equal(sink.batches.length, 0, 'nothing sent yet');

    await flush();
    assert.equal(sink.batches.length, 1);
    assert.equal(sink.batches[0].events.length, 2);
  });

  test('flushes itself once the buffer fills', async () => {
    const sink = recordingSink();
    configureAnalytics(sink);
    for (let i = 0; i < 40; i += 1) track('app_open');
    // The 40th triggers a flush without waiting for the timer.
    await new Promise((r) => setImmediate(r));
    assert.equal(sink.batches.length, 1);
    assert.equal(__bufferSize(), 0);
  });

  test('a failing sink does not lose the app, and the buffer stays bounded', async () => {
    configureAnalytics({ async send() { throw new Error('offline'); } });
    for (let i = 0; i < 100; i += 1) track('app_open');
    await flush();
    assert.ok(__bufferSize() <= 40, `buffer grew to ${__bufferSize()} during an outage`);
  });

  test('drops events entirely when no sink is configured', async () => {
    track('app_open');
    track('app_open');
    await flush();
    assert.equal(__bufferSize(), 0, 'an unconfigured app must not grow an array forever');
  });
});

describe('sessions', () => {
  test('every event carries the current session', async () => {
    const sink = recordingSink();
    configureAnalytics(sink);
    const first = currentSession();
    track('app_open');
    const second = startSession();
    track('app_open');
    await flush();

    const [a, b] = sink.batches[0].events;
    assert.equal(a.session_id, first);
    assert.equal(b.session_id, second);
    assert.notEqual(first, second, 'a foreground is a new session (§1.2)');
  });

  test('a session id is a uuid', () => {
    assert.match(startSession(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

describe('context', () => {
  test('carries user, platform, version and city on the batch', async () => {
    const sink = recordingSink();
    configureAnalytics(sink, { app_version: '1.2.3' });
    setAnalyticsUser('user-1', 'Lahore');
    track('app_open');
    await flush();

    assert.deepEqual(sink.batches[0].context, {
      user_id: 'user-1',
      platform: 'web',
      app_version: '1.2.3',
      city: 'Lahore',
    });
  });
});

describe('§2 the vocabulary matches the database', () => {
  test('every EventName is accepted by the analytics_events CHECK', async () => {
    // The type and the constraint are written out separately, in TypeScript and
    // in SQL. Nothing links them, so a name added to one and not the other fails
    // silently at runtime — the insert is rejected and the event vanishes.
    const { readFile } = await import('node:fs/promises');
    const { join, dirname } = await import('node:path');
    const { fileURLToPath } = await import('node:url');

    const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    const ts = await readFile(join(root, 'src', 'lib', 'analytics.ts'), 'utf8');
    const sql = await readFile(
      join(root, 'supabase', 'migrations', '20260818001600_analytics.sql'), 'utf8');

    const typeBlock = ts.slice(ts.indexOf('export type EventName'), ts.indexOf(';', ts.indexOf('export type EventName')));
    const inType = new Set([...typeBlock.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));

    const checkBlock = sql.slice(sql.indexOf('constraint known_event'), sql.indexOf('))', sql.indexOf('constraint known_event')));
    const inSql = new Set([...checkBlock.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]));

    assert.ok(inType.size > 30, `expected the full vocabulary, parsed ${inType.size}`);
    assert.deepEqual(
      [...inType].filter((n) => !inSql.has(n)), [],
      'these event names exist in TypeScript but the database would reject them',
    );
    assert.deepEqual(
      [...inSql].filter((n) => !inType.has(n)), [],
      'these event names exist in SQL but nothing can emit them',
    );
  });
});
