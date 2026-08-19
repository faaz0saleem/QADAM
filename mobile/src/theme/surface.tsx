import { createContext, createElement, useContext, type ReactNode } from 'react';

import { earning, spending, type Surface } from './tokens';

/**
 * §9.1 — "Two temperatures, one app."
 *
 * "The earning half (steps, streak, leaderboard) is dark, nocturnal, dense with
 *  numbers. The spending half (store, checkout) is light, airy, product-forward.
 *  The transition between them is the most important moment in the app: it
 *  should feel like stepping indoors. This is the structural idea — hold it
 *  consistently."
 *
 * Holding it consistently is why this is a context rather than a prop. Every
 * component reads the surface it is standing on, so a card moved from the wallet
 * to the shop changes temperature without being edited, and a new screen cannot
 * be built in the wrong one by forgetting.
 */
const SurfaceContext = createContext<Surface>(earning);

export function SurfaceProvider({
  mode,
  children,
}: {
  mode: 'earning' | 'spending';
  children: ReactNode;
}) {
  return createElement(
    SurfaceContext.Provider,
    { value: mode === 'spending' ? spending : earning },
    children,
  );
}

export function useSurface(): Surface {
  return useContext(SurfaceContext);
}

/** True on the light half. For the few places that genuinely need to know. */
export function useIsSpending(): boolean {
  return useContext(SurfaceContext).bg === (spending.bg as string);
}
