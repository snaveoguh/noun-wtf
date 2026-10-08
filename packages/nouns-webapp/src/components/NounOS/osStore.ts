// ── NounOS window manager state ─────────────────────────────────────────
//
// Tiny external store (same pattern as MiniWindow) so any component can open
// a window without prop drilling. Windows are kept in focus order: the last
// entry is front-most, and the depth of every other window is derived from
// its distance to the front (see OSWindow).

import { useSyncExternalStore } from 'react';

export type AppKind = 'navigator' | 'terminal' | 'manifesto' | 'directory' | 'pip3';

export interface OSWin {
  id: AppKind;
  x: number;
  y: number;
  w: number;
  h: number;
  minimized: boolean;
}

export type OSMode = 'world' | 'desk';

interface State {
  mode: OSMode;
  /** Focus order, back → front */
  windows: OSWin[];
}

const LAYOUT_KEY = 'nounos-layout-v1';

const listeners = new Set<() => void>();
let state: State = { mode: 'world', windows: [] };

function emit() {
  for (const l of listeners) l();
  try {
    const sizes: Record<string, Pick<OSWin, 'x' | 'y' | 'w' | 'h'>> = {};
    for (const w of state.windows) sizes[w.id] = { x: w.x, y: w.y, w: w.w, h: w.h };
    localStorage.setItem(LAYOUT_KEY, JSON.stringify({ ...loadLayout(), ...sizes }));
  } catch {
    // storage blocked — layout just won't persist
  }
}

function loadLayout(): Record<string, Pick<OSWin, 'x' | 'y' | 'w' | 'h'>> {
  try {
    return JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') as Record<
      string,
      Pick<OSWin, 'x' | 'y' | 'w' | 'h'>
    >;
  } catch {
    return {};
  }
}

export const isMobile = () => typeof window !== 'undefined' && window.innerWidth < 760;

function defaultRect(id: AppKind): Pick<OSWin, 'x' | 'y' | 'w' | 'h'> {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const fit = (w: number, h: number, x: number, y: number) => {
    const ww = Math.min(w, W - 24);
    const hh = Math.min(h, H - 110);
    return {
      w: ww,
      h: hh,
      x: Math.max(12, Math.min(x, W - ww - 12)),
      y: Math.max(12, Math.min(y, H - hh - 90)),
    };
  };
  switch (id) {
    case 'navigator':
      return fit(Math.round(W * 0.66), Math.round(H * 0.74), Math.round(W * 0.08), 28);
    case 'terminal':
      return fit(560, Math.round(H * 0.7), W - 600, 40);
    case 'manifesto':
      return fit(520, 600, Math.round(W * 0.5 - 260), 36);
    case 'directory':
      return fit(760, Math.round(H * 0.72), Math.round(W * 0.5 - 380), 24);
    case 'pip3':
      return fit(720, Math.round(H * 0.72), Math.round(W * 0.18), 52);
  }
}

function set(next: Partial<State>) {
  state = { ...state, ...next };
  emit();
}

export const os = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  },
  get: () => state,

  setMode(mode: OSMode) {
    if (state.mode !== mode) set({ mode });
  },
  toggleMode() {
    set({ mode: state.mode === 'world' ? 'desk' : 'world' });
  },

  /** Open (or focus + restore) a window, and bring the desk forward. */
  open(id: AppKind) {
    const existing = state.windows.find(w => w.id === id);
    const others = state.windows.filter(w => w.id !== id);
    const saved = loadLayout()[id];
    const rect = saved !== undefined && !isMobile() ? clampRect(saved) : defaultRect(id);
    const win: OSWin =
      existing !== undefined
        ? { ...existing, minimized: false }
        : { id, ...rect, minimized: false };
    set({ windows: [...others, win], mode: 'desk' });
  },
  focus(id: AppKind) {
    const w = state.windows.find(x => x.id === id);
    if (w === undefined) return;
    const top = state.windows[state.windows.length - 1];
    if (top?.id === id && !w.minimized) return;
    set({ windows: [...state.windows.filter(x => x.id !== id), { ...w, minimized: false }] });
  },
  close(id: AppKind) {
    set({ windows: state.windows.filter(w => w.id !== id) });
  },
  minimize(id: AppKind) {
    set({
      windows: state.windows.map(w => (w.id === id ? { ...w, minimized: true } : w)),
    });
  },
  move(id: AppKind, rect: Partial<Pick<OSWin, 'x' | 'y' | 'w' | 'h'>>) {
    set({ windows: state.windows.map(w => (w.id === id ? { ...w, ...rect } : w)) });
  },
  isOpen: (id: AppKind) => state.windows.some(w => w.id === id && !w.minimized),
};

function clampRect(r: Pick<OSWin, 'x' | 'y' | 'w' | 'h'>) {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const w = Math.min(Math.max(320, r.w), W - 24);
  const h = Math.min(Math.max(220, r.h), H - 100);
  return {
    w,
    h,
    x: Math.max(12, Math.min(r.x, W - w - 12)),
    y: Math.max(12, Math.min(r.y, H - h - 80)),
  };
}

export function useOS(): State {
  return useSyncExternalStore(os.subscribe, os.get, os.get);
}

/** Join class names (falsy parts dropped). */
export const cx = (...parts: (string | false | null | undefined)[]) =>
  parts.filter((p): p is string => typeof p === 'string' && p !== '').join(' ');
