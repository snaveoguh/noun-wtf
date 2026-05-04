/**
 * Tiny `useSyncExternalStore`-based store factory.
 *
 * Mirrors the structural pattern used by `windowStore.ts` / `dockStore.ts` so
 * dnd / clipboard / vfs don't depend on `zustand` (which isn't a webapp
 * dependency yet) while still giving callers a small, predictable API.
 *
 * Usage:
 *   const dndStore = createStore<DndState>({ currentDrag: null, ... });
 *   dndStore.setState(s => ({ ...s, currentDrag: payload }));
 *   const drag = dndStore.useSelector(s => s.currentDrag);
 */

import { useSyncExternalStore } from 'react';

export interface ExternalStore<T> {
  getState(): T;
  setState(updater: T | ((prev: T) => T)): void;
  subscribe(listener: () => void): () => void;
  useSelector<U>(selector: (state: T) => U, isEqual?: (a: U, b: U) => boolean): U;
}

const refEq = <U,>(a: U, b: U) => Object.is(a, b);

export function createStore<T>(initial: T): ExternalStore<T> {
  let state = initial;
  const listeners = new Set<() => void>();

  const getState = () => state;
  const setState = (updater: T | ((prev: T) => T)) => {
    const next =
      typeof updater === 'function' ? (updater as (p: T) => T)(state) : updater;
    if (Object.is(next, state)) return;
    state = next;
    for (const l of listeners) l();
  };
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener) as unknown as void;
  };

  return {
    getState,
    setState,
    subscribe,
    useSelector<U>(selector: (state: T) => U, isEqual: (a: U, b: U) => boolean = refEq) {
      // Use selector wrapped so we only re-render on selector-output change.
      // Simple ref-equality cache via closure.
      let cached: U | undefined;
      let primed = false;
      return useSyncExternalStore(
        subscribe,
        () => {
          const next = selector(state);
          if (!primed || !isEqual(cached as U, next)) {
            cached = next;
            primed = true;
          }
          return cached as U;
        },
        () => selector(state),
      );
    },
  };
}
