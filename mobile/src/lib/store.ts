import { useSyncExternalStore } from 'react';

/**
 * A twenty-line store instead of a state library.
 *
 * The app has three pieces of shared state — the balance, today's steps, the
 * session — and they are read by a handful of screens. Reaching for Redux or
 * Zustand here would add a dependency, a mental model, and a bundle, to solve a
 * problem the platform already solves.
 */
export interface Store<T> {
  get: () => T;
  set: (next: Partial<T>) => void;
  subscribe: (listener: () => void) => () => void;
}

export function createStore<T extends object>(initial: T): Store<T> {
  let state = initial;
  const listeners = new Set<() => void>();

  return {
    get: () => state,
    set: (next) => {
      state = { ...state, ...next };
      listeners.forEach((l) => l());
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useStore<T extends object>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
