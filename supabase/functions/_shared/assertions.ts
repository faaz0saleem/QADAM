/**
 * Two assertions, so the Edge Function tests need nothing from the network.
 *
 * jsr:@std/assert would do this and more, but a test suite that cannot run
 * without reaching a registry is a test suite that does not run on a bad day.
 */
export class AssertionError extends Error {}

export function assertEquals(actual: unknown, expected: unknown, message?: string): void {
  if (!deepEqual(actual, expected)) {
    throw new AssertionError(
      `${message ? message + ': ' : ''}expected ${show(expected)}, got ${show(actual)}`,
    );
  }
}

export function assertNotEquals(actual: unknown, expected: unknown, message?: string): void {
  if (deepEqual(actual, expected)) {
    throw new AssertionError(
      `${message ? message + ': ' : ''}expected something other than ${show(expected)}`,
    );
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Number.isNaN(a) && Number.isNaN(b)) return true;

  if (a instanceof Uint8Array && b instanceof Uint8Array) {
    return a.length === b.length && a.every((byte, i) => byte === b[i]);
  }

  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }

  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    return (
      ka.length === kb.length &&
      ka.every((k) =>
        deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])
      )
    );
  }

  return false;
}

function show(v: unknown): string {
  if (v instanceof Uint8Array) return `Uint8Array(${v.length})[${Array.from(v.slice(0, 8))}…]`;
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
}
