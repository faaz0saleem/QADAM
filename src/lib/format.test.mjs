// Plain node:test — no database needed, so this runs in the same suite.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatSteps, formatPkr, formatRankLine, daysUntil, relativeTime, formatDelta,
} from './format.ts';


describe('formatting', () => {
  test('groups step counts so they can be read at a glance', () => {
    assert.equal(formatSteps(9), '9');
    assert.equal(formatSteps(9412), '9,412');
    assert.equal(formatSteps(-5), '0');
  });

  test('prices are whole rupees, never decimals', () => {
    assert.equal(formatPkr(2699.6), '2,700');
    assert.equal(formatPkr(180), '180');
  });

  test('a rank reads as a percentile, per §7.3', () => {
    assert.equal(formatRankLine(4382, 12), '4,382 — top 12%');
    assert.equal(formatRankLine(1, 0.2), '1 — top 1%', 'never claims top 0%');
  });

  test('days until an expiry never goes negative', () => {
    const now = Date.parse('2026-08-19T00:00:00Z');
    assert.equal(daysUntil('2026-08-30T00:00:00Z', now), 11);
    assert.equal(daysUntil('2026-08-01T00:00:00Z', now), 0);
  });

  test('relative time degrades sensibly', () => {
    const now = Date.parse('2026-08-19T12:00:00Z');
    assert.deepEqual(relativeTime('2026-08-19T11:59:30Z', now), { unit: 'now', n: 0 });
    assert.deepEqual(relativeTime('2026-08-19T11:20:00Z', now), { unit: 'min', n: 40 });
    assert.deepEqual(relativeTime('2026-08-19T06:00:00Z', now), { unit: 'hr', n: 6 });
    assert.equal(relativeTime(null, now), 'never');
  });
});

describe('ledger deltas', () => {
  test('always carry a sign, and use a real minus rather than a hyphen', () => {
    assert.equal(formatDelta(74), '+74');
    assert.equal(formatDelta(-600), '−600');
    assert.equal(formatDelta(-1200), '−1,200');
    assert.equal(formatDelta(0), '0');
  });
});
