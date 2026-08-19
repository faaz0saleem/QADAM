import { assertEquals } from './assertions.ts';

import { sanitiseSamples } from './samples.ts';

/**
 * The request body is untrusted. The database enforces the real rules; this is
 * only about never handing it something absurd, and about the one case where a
 * malformed payload would produce a wrong answer rather than a rejected one.
 */
Deno.test('it accepts a well-formed payload unchanged', () => {
  assertEquals(
    sanitiseSamples([{ date: '2026-08-19', raw_steps: 8123 }]),
    [{ date: '2026-08-19', raw_steps: 8123 }],
  );
});

Deno.test('it drops anything that is not a dated step count', () => {
  const junk = [
    null,
    'string',
    42,
    {},
    { date: '19-08-2026', raw_steps: 100 },
    { date: '2026-8-9', raw_steps: 100 },
    { date: '2026-08-19' },
    { date: '2026-08-19', raw_steps: 'lots' },
    { date: '2026-08-19', raw_steps: -5 },
    { date: '2026-08-19', raw_steps: Number.NaN },
    { date: '2026-08-19', raw_steps: Number.POSITIVE_INFINITY },
  ];
  assertEquals(sanitiseSamples(junk), []);
});

Deno.test('it is not fooled by a non-array', () => {
  assertEquals(sanitiseSamples(null), []);
  assertEquals(sanitiseSamples({ date: '2026-08-19', raw_steps: 1 }), []);
  assertEquals(sanitiseSamples('2026-08-19'), []);
});

Deno.test('it bounds the number of days', () => {
  const many = Array.from({ length: 400 }, (_, i) => ({
    date: `2026-01-${String((i % 28) + 1).padStart(2, '0')}`,
    raw_steps: 100,
  }));
  assertEquals(sanitiseSamples(many).length <= 14, true);
});

Deno.test('it caps an absurd step count rather than passing it through', () => {
  const [sample] = sanitiseSamples([{ date: '2026-08-19', raw_steps: 9e15 }]);
  assertEquals(sample?.raw_steps, 10_000_000);
});

Deno.test('it floors a fractional count — steps are integers', () => {
  const [sample] = sanitiseSamples([{ date: '2026-08-19', raw_steps: 8123.9 }]);
  assertEquals(sample?.raw_steps, 8123);
});

Deno.test('a day named twice is merged, keeping the higher count', () => {
  // Without this the database processes the day twice in one call, and the
  // second pass sees the first as a step regression — which logs a fraud event
  // against an honest user whose client sent a duplicate.
  const out = sanitiseSamples([
    { date: '2026-08-19', raw_steps: 4000 },
    { date: '2026-08-19', raw_steps: 9000 },
    { date: '2026-08-19', raw_steps: 1000 },
  ]);
  assertEquals(out, [{ date: '2026-08-19', raw_steps: 9000 }]);
});

Deno.test('good entries survive alongside bad ones', () => {
  const out = sanitiseSamples([
    { date: 'nonsense', raw_steps: 5 },
    { date: '2026-08-18', raw_steps: 6000 },
    null,
    { date: '2026-08-19', raw_steps: 7000 },
  ]);
  assertEquals(out, [
    { date: '2026-08-18', raw_steps: 6000 },
    { date: '2026-08-19', raw_steps: 7000 },
  ]);
});
