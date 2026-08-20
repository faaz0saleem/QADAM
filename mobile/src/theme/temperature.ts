import { earning, spending, type Surface } from './tokens';

export type SurfaceMode = 'earning' | 'spending';

export function surfaceFor(mode: SurfaceMode): Surface {
  return mode === 'spending' ? spending : earning;
}

/**
 * §9.1 — "The transition between them is the most important moment in the app:
 * it should feel like stepping indoors."
 *
 * Which is a thing a single screen cannot animate on its own. Only one Screen is
 * mounted at a time, and the one you are leaving is gone before the one you are
 * arriving at renders — so there is nothing on screen to cross-fade FROM unless
 * somebody remembers where you just were. This is that somebody.
 *
 * A module-level variable rather than context, deliberately: context lives inside
 * the tree that is being torn down, and the whole problem is that the answer has
 * to survive the teardown.
 *
 * Returns the temperature you are arriving from when it differs from the one you
 * are arriving at, and null when it does not — so a screen only pays for the
 * animation on the one navigation in the app that earns it. Calling it is what
 * records the new mode, so call it once per Screen mount and not in a render
 * body that runs twice.
 */
let current: SurfaceMode = 'earning';

export function takeTemperatureChange(next: SurfaceMode): SurfaceMode | null {
  const from = current;
  current = next;
  return from === next ? null : from;
}

/** For tests and for a cold start, where there is nothing to transition from. */
export function resetTemperature(mode: SurfaceMode = 'earning'): void {
  current = mode;
}
