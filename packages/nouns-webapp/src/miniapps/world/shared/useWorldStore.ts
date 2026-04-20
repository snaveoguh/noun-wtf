// ── World store — white/fried world gating + transition state ─────────
//
// Light vanilla external store (React 18 useSyncExternalStore-compatible)
// shaped like a zustand slice so we can drop zustand in later.
// No library deps — stays identical API: getState() / setState() / subscribe().

import { useSyncExternalStore } from 'react';

export type WorldId = 'white' | 'fried';
export type TransitionPhase = 'idle' | 'pullIn' | 'swap' | 'pullOut';

export interface WorldStoreState {
  current: WorldId;
  transition: TransitionPhase;
  hasSeenGlitch: boolean;
  enterWorld: (id: WorldId) => void;
  setTransition: (t: TransitionPhase) => void;
  markGlitchSeen: () => void;
  reset: () => void;
}

type Listener = () => void;

function createStore() {
  let state: Pick<WorldStoreState, 'current' | 'transition' | 'hasSeenGlitch'> = {
    current: 'white',
    transition: 'idle',
    hasSeenGlitch: false,
  };
  const listeners = new Set<Listener>();
  const notify = () => listeners.forEach(l => l());

  const setState = (patch: Partial<typeof state>) => {
    state = { ...state, ...patch };
    notify();
  };

  const enterWorld = (id: WorldId) => {
    if (state.current === id || state.transition !== 'idle') return;
    // Sequence: pullIn (600ms) → swap (held until Suspense resolves) → pullOut (800ms)
    setState({ transition: 'pullIn' });
    window.setTimeout(() => {
      setState({ transition: 'swap', current: id });
      // "swap" is the held-white-flash phase. For white→fried, Suspense will
      // resolve eventually; for fried→white the transition is instant since
      // WhiteRoom is eager. Either way, proceed to pullOut after a minimum beat.
      window.setTimeout(() => {
        setState({ transition: 'pullOut' });
        window.setTimeout(() => {
          setState({ transition: 'idle' });
        }, 800);
      }, 350);
    }, 600);
  };

  const setTransition = (t: TransitionPhase) => setState({ transition: t });
  const markGlitchSeen = () => setState({ hasSeenGlitch: true });
  const reset = () => setState({ current: 'white', transition: 'idle', hasSeenGlitch: false });

  const getState = (): WorldStoreState => ({
    ...state,
    enterWorld,
    setTransition,
    markGlitchSeen,
    reset,
  });

  const subscribe = (fn: Listener) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  };

  return { getState, subscribe };
}

const store = createStore();

// Zustand-shaped helper: `useWorldStore()` returns full state; `useWorldStore(sel)` selects.
export function useWorldStore(): WorldStoreState;
export function useWorldStore<T>(selector: (s: WorldStoreState) => T): T;
export function useWorldStore<T>(selector?: (s: WorldStoreState) => T): T | WorldStoreState {
  return useSyncExternalStore(
    store.subscribe,
    () => (selector ? selector(store.getState()) : store.getState()),
    () => (selector ? selector(store.getState()) : store.getState()),
  );
}

// `useWorldStore.getState()` — same shape as zustand so callers match spec.
useWorldStore.getState = () => store.getState();
useWorldStore.subscribe = store.subscribe;
