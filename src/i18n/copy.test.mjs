// §9.6 — the copy rules, enforced rather than remembered.
//
// "Never use the words points, rewards, cashback, or earn money. We say coins,
// mint, discount." That is easy to hold for a week and impossible to hold for a
// year across two languages, so it is a test.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { en, ur } from './strings.ts';

/** Walks an object and yields [dotted.path, value] for every string leaf. */
function* leaves(obj, prefix = '') {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === 'string') yield [path, v];
    else if (v && typeof v === 'object') yield* leaves(v, path);
  }
}

const paths = (obj) => [...leaves(obj)].map(([p]) => p).sort();
const placeholders = (s) => [...s.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

describe('§9.6 banned vocabulary', () => {
  // Only the displayed strings are checked. `wallet.reason.rewarded_ad` is a KEY
  // matching a database enum value, not copy — its displayed value is
  // "Video watched", which is the point.
  const banned = [
    [/\bpoints?\b/i, 'points — we say coins'],
    [/\brewards?\b/i, 'rewards — we say coins'],
    [/\bcash ?back\b/i, 'cashback — we say discount'],
    [/\bearn (money|cash)\b/i, 'earn money — coins never become cash (§1)'],
    [/\bredeem\b/i, 'redeem — an action keeps its name: "use coins"'],
  ];

  test('the English copy uses none of them', () => {
    for (const [path, value] of leaves(en)) {
      for (const [pattern, why] of banned) {
        assert.ok(!pattern.test(value), `${path}: "${value}" uses ${why}`);
      }
    }
  });

  test('nothing publishes a coin-to-rupee rate (§4)', () => {
    // §4: show "1,000 steps = 10 coins" forever, never a rupee conversion. A
    // string pairing coins with rupees is how that rule gets broken by accident.
    for (const [path, value] of leaves(en)) {
      const pairsCoinsWithRupees =
        /coins?/i.test(value) && /\bPKR\b|\brupees?\b/i.test(value) && /=/.test(value);
      assert.ok(!pairsCoinsWithRupees, `${path}: "${value}" publishes the conversion rate`);
    }
  });

  test('an action keeps its name through a flow', () => {
    // "Use coins" -> "Coins used", not "Redeem" -> "Redeemed".
    assert.match(en.shop.useCoins, /use coins/i);
    assert.match(en.shop.coinsUsed, /coins used/i);
  });
});

describe('translations stay in step', () => {
  test('Urdu has exactly the same keys as English', () => {
    assert.deepEqual(paths(ur), paths(en), 'a key is missing or extra in the Urdu strings');
  });

  test('every placeholder survives translation', () => {
    const enMap = new Map(leaves(en));
    for (const [path, value] of leaves(ur)) {
      assert.deepEqual(
        placeholders(value),
        placeholders(enMap.get(path) ?? ''),
        `${path}: the Urdu string does not carry the same {{placeholders}}`,
      );
    }
  });

  test('no Urdu string was left in English', () => {
    const enMap = new Map(leaves(en));
    // A handful legitimately match: proper nouns, and the language names in the
    // settings toggle, which are always shown in their own script.
    const allowed = new Set(['you.english', 'you.urdu']);
    const untranslated = [...leaves(ur)]
      .filter(([path, value]) => !allowed.has(path) && value === enMap.get(path))
      .map(([path]) => path);
    assert.deepEqual(untranslated, [], 'these strings are still English in the Urdu file');
  });
});
