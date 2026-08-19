// §9.2, §9.3 — the design rules that erode quietly.
//
// "Brass is reserved. The moment it appears on a button that isn't about coins,
// the coin stops feeling like currency." That is a rule nobody breaks
// deliberately; it goes one careless `backgroundColor: theme.coin` at a time.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { palette, earning, spending } from './tokens.ts';
import { text } from './type.ts';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

async function sourceFiles(dir, acc = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      await sourceFiles(full, acc);
    } else if (/\.tsx?$/.test(entry.name)) {
      acc.push(full);
    }
  }
  return acc;
}

const uiFiles = async () => [
  ...(await sourceFiles(join(repoRoot, 'app'))),
  ...(await sourceFiles(join(repoRoot, 'src', 'components'))),
];

describe('§9.2 brass is reserved for coin values', () => {
  test('it is not aliased into any surface, border or text role', () => {
    for (const theme of [earning, spending]) {
      for (const [role, value] of Object.entries(theme)) {
        if (role === 'coin' || role === 'coinDim' || role === 'temperature' || role === 'scheme') {
          continue;
        }
        assert.notEqual(
          value, palette.brass,
          `${theme.temperature}.${role} is brass — §9.2 reserves it for the coin`,
        );
      }
    }
  });

  test('no screen fills a surface with it', async () => {
    // The one legitimate brass fill is the ledger rule's progress line, which is
    // a coin figure drawn as a line rather than as a number.
    const allowed = new Set(['src/components/LedgerRule.tsx']);
    const offenders = [];

    for (const file of await uiFiles()) {
      const rel = relative(repoRoot, file);
      if (allowed.has(rel)) continue;
      const source = await readFile(file, 'utf8');
      if (/backgroundColor:\s*(theme\.coin|palette\.brass)/.test(source)) {
        offenders.push(rel);
      }
    }

    assert.deepEqual(
      offenders, [],
      'brass is filling a surface here. If it is not a coin value, use another token.',
    );
  });
});

describe('§9.2 colour comes from tokens, never from a literal', () => {
  test('no screen or component hardcodes a hex colour', async () => {
    const offenders = [];
    for (const file of await uiFiles()) {
      const source = await readFile(file, 'utf8');
      const hexes = source.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
      if (hexes.length) offenders.push(`${relative(repoRoot, file)}: ${hexes.join(', ')}`);
    }
    assert.deepEqual(
      offenders, [],
      'a colour has escaped the palette — add it to tokens.ts or use an existing role',
    );
  });
});

describe('§9.3 numbers do not jitter', () => {
  test('every style that renders a changing number sets tabular figures', () => {
    // §9.3: "Proportional numerals jitter when they tick, and a jittering
    // counter is the difference between polished and hobby project."
    for (const name of ['counter', 'coin', 'coinLarge', 'data', 'dataSmall']) {
      assert.ok(
        text[name].fontVariant?.includes('tabular-nums'),
        `text.${name} renders numbers without tabular figures`,
      );
    }
  });

  test('the display face is used for titles, not for data', () => {
    assert.notEqual(text.title.fontFamily, text.data.fontFamily);
    assert.equal(text.counter.fontFamily, text.data.fontFamily,
      'the step counter is monospace, per §9.4');
  });
});

describe('§9.7 the quality floor', () => {
  test('nothing interactive is smaller than 44px', async () => {
    // A weak check by nature — it catches an explicit small target, not a
    // laid-out one. Real verification is on a device (see HUMAN_TASKS.md).
    const offenders = [];
    for (const file of await uiFiles()) {
      const source = await readFile(file, 'utf8');
      for (const m of source.matchAll(/min(?:Height|Width):\s*(\d+)/g)) {
        if (Number(m[1]) < 44 && !/borderRadius|height:\s*2/.test(m[0])) {
          offenders.push(`${relative(repoRoot, file)}: ${m[0]}`);
        }
      }
    }
    assert.deepEqual(offenders, []);
  });
});

describe('§9.3 the fonts are actually bundled', () => {
  test('every family named in a text style is in the asset map', async () => {
    // React Native falls back silently on an unknown family name, so a typo
    // between type.ts and fonts.ts costs the whole typographic system and
    // nothing reports it.
    const source = await readFile(join(repoRoot, 'src', 'theme', 'fonts.ts'), 'utf8');
    const bundled = new Set(
      (source.match(/^\s{2}([A-Za-z]+_\d{3}[A-Za-z]+),$/gm) ?? [])
        .map((line) => line.trim().replace(',', '')),
    );

    const named = new Set(Object.values(text).map((s) => s.fontFamily).filter(Boolean));
    const missing = [...named].filter((f) => !bundled.has(f));
    assert.deepEqual(missing, [], 'a text style names a font that is not bundled');
  });

  test('bundles no weight it does not use', async () => {
    // Every extra file is download size on a connection that charges by the
    // megabyte. The Urdu face is the exception: it is used through urduAdjust,
    // not through a style in `text`.
    const source = await readFile(join(repoRoot, 'src', 'theme', 'fonts.ts'), 'utf8');
    const bundled = (source.match(/^\s{2}([A-Za-z]+_\d{3}[A-Za-z]+),$/gm) ?? [])
      .map((line) => line.trim().replace(',', ''));
    const named = new Set(Object.values(text).map((s) => s.fontFamily));
    const unused = bundled.filter((f) => !named.has(f) && !f.startsWith('NotoNastaliq'));
    assert.deepEqual(unused, [], 'these bundled weights are not used by any style');
  });
});
