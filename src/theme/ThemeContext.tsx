import React, { createContext, useContext } from 'react';
import { earning, spending, Theme } from './tokens';

/**
 * §9.1 — two temperatures, one app.
 *
 * The earning half is dark; the spending half is light. Which one a screen is
 * in is a property of the screen, not a user preference, so this is a plain
 * provider with no toggle: `<Temperature mode="spending">` around the shop.
 */
const Ctx = createContext<Theme>(earning);

export function Temperature({
  mode,
  children,
}: {
  mode: 'earning' | 'spending';
  children: React.ReactNode;
}) {
  return <Ctx.Provider value={mode === 'earning' ? earning : spending}>{children}</Ctx.Provider>;
}

export const useTheme = (): Theme => useContext(Ctx);
