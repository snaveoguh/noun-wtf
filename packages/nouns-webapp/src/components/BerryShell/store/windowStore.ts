/**
 * Tiny window store for the Berry shell.
 *
 * Direct port of the structure from BerryCC0/berry's Zustand `windowStore.ts`
 * (https://github.com/BerryCC0/berry/blob/main/src/OS/store/windowStore.ts) but
 * reimplemented on top of `useSyncExternalStore` so we don't pull in zustand.
 *
 * State shape, action set, and naming intentionally mirror the original so a
 * later swap to zustand would be trivial.
 *
 * Lifecycle events (window:created, window:focused, etc.) are emitted via the
 * BerryOS event bus AFTER state mutations land. No-op operations (focus on
 * already-focused window, move to identical position) skip the emit.
 */

import { useSyncExternalStore } from 'react';

import { berryBus } from '../system/eventBus';

export interface BerryWindowState {
  id: string;
  appId: string;
  title: string;
  icon: string;

  x: number;
  y: number;
  width: number;
  height: number;

  minWidth: number;
  minHeight: number;

  isFocused: boolean;
  isMinimized: boolean;
  isMaximized: boolean;
  zIndex: number;
}

export interface BerryWindowConfig {
  appId: string;
  title: string;
  icon: string;
  width?: number;
  height?: number;
  minWidth?: number;
  minHeight?: number;
  x?: number;
  y?: number;
}

interface State {
  windows: BerryWindowState[];
  focusedId: string | null;
  nextZ: number;
}

type Listener = () => void;

const MENU_BAR = 24;
const DOCK = 76;
const CASCADE = 22;
// HIG (apple-hig SKILL.md): mobile breakpoint = 768pt. Below this, windows
// must collapse to viewport-tight cards rather than free-floating chrome.
const MOBILE_BREAKPOINT = 768;
// Mobile gutter — 8pt margin on each side leaves the window 16pt narrower
// than the viewport. Matches `calc(100vw - 16px)` in the chrome layer.
const MOBILE_GUTTER = 8;
// Mobile-default opening height — 60% of viewport, capped to a sensible
// minimum so the window still looks like a window, not a hairline strip.
const MOBILE_HEIGHT_RATIO = 0.6;
// Reserve for the top of the window on mobile — menu bar + 4pt breathing.
const MOBILE_TOP_INSET = MENU_BAR + 4;

function isMobileViewport(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth <= MOBILE_BREAKPOINT;
}

/**
 * Resolve the opening geometry for a new window. On mobile (<= 768pt) we
 * ignore the app's `defaultWindow` size entirely and lock the window to a
 * tight viewport-cap card, so even a 640pt-wide app like Vote fits the
 * iPhone width comfortably. Desktop keeps the registered defaults.
 */
function resolveOpeningGeometry(
  cfgWidth: number,
  cfgHeight: number,
  cfgX: number | undefined,
  cfgY: number | undefined,
  lastX: number | null,
  lastY: number | null,
): { x: number; y: number; width: number; height: number } {
  if (typeof window === 'undefined') {
    return {
      x: cfgX ?? 80,
      y: cfgY ?? MENU_BAR + 36,
      width: cfgWidth,
      height: cfgHeight,
    };
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  if (isMobileViewport()) {
    const width = Math.max(0, vw - MOBILE_GUTTER * 2);
    const height = Math.min(
      Math.floor(vh * MOBILE_HEIGHT_RATIO),
      Math.max(cfgHeight, 320),
    );
    // Center horizontally; cascade vertically a little so a second window
    // doesn't bury the first.
    const cascadeOffset = lastY != null ? Math.min(40, Math.max(0, lastY - MOBILE_TOP_INSET) + 24) : 0;
    return {
      x: MOBILE_GUTTER,
      y: MOBILE_TOP_INSET + cascadeOffset,
      width,
      height,
    };
  }
  const baseX = cfgX ?? (lastX != null ? lastX + CASCADE : Math.max(40, Math.floor((vw - cfgWidth) / 2)));
  const baseY = cfgY ?? (lastY != null ? lastY + CASCADE : MENU_BAR + 36);
  const c = clampPosition(baseX, baseY, cfgWidth);
  return { x: c.x, y: c.y, width: cfgWidth, height: cfgHeight };
}

let state: State = {
  windows: [],
  focusedId: null,
  nextZ: 100,
};

const listeners = new Set<Listener>();

function notify() {
  listeners.forEach(l => l());
}

function setState(next: State) {
  state = next;
  notify();
}

function genId(): string {
  return `win-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

function clampPosition(x: number, y: number, w: number) {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  // On mobile (<=768pt) windows are pinned to the gutter — no edge-bleed
  // dragging allowed. Anything off-screen would be unrecoverable on touch.
  if (vw <= MOBILE_BREAKPOINT) {
    const minX = MOBILE_GUTTER;
    const maxX = Math.max(minX, vw - w - MOBILE_GUTTER);
    const minY = MENU_BAR;
    const maxY = Math.max(minY, vh - DOCK - 40);
    return {
      x: Math.min(Math.max(x, minX), maxX),
      y: Math.min(Math.max(y, minY), maxY),
    };
  }
  const minY = MENU_BAR;
  const maxY = Math.max(minY, vh - DOCK - 80);
  const maxX = Math.max(20, vw - 80);
  return {
    x: Math.max(-w + 80, Math.min(x, maxX)),
    y: Math.max(minY, Math.min(y, maxY)),
  };
}

export const windowStore = {
  subscribe(l: Listener) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  getState() {
    return state;
  },

  open(config: BerryWindowConfig): string {
    // If already open: just focus + restore.
    const existing = state.windows.find(w => w.appId === config.appId);
    if (existing) {
      windowStore.focus(existing.id);
      if (existing.isMinimized) windowStore.restore(existing.id);
      return existing.id;
    }

    const id = genId();
    const cfgWidth = config.width ?? 640;
    const cfgHeight = config.height ?? 480;

    // Cascade from last window.
    const last = state.windows.length
      ? state.windows.reduce((a, b) => (a.zIndex > b.zIndex ? a : b))
      : null;
    const { x, y, width, height } = resolveOpeningGeometry(
      cfgWidth,
      cfgHeight,
      config.x,
      config.y,
      last ? last.x : null,
      last ? last.y : null,
    );

    const prevFocusedId = state.focusedId ?? undefined;

    const win: BerryWindowState = {
      id,
      appId: config.appId,
      title: config.title,
      icon: config.icon,
      x,
      y,
      width,
      height,
      minWidth: config.minWidth ?? 280,
      minHeight: config.minHeight ?? 200,
      isFocused: true,
      isMinimized: false,
      isMaximized: false,
      zIndex: state.nextZ,
    };

    setState({
      ...state,
      windows: [...state.windows.map(w => ({ ...w, isFocused: false })), win],
      focusedId: id,
      nextZ: state.nextZ + 1,
    });

    berryBus.emit('window:created', { id, appId: config.appId, x, y, w: width, h: height });
    berryBus.emit('window:focused', { id, appId: config.appId, prevFocusedId });
    berryBus.emit('app:focused', { appId: config.appId });
    return id;
  },

  close(id: string) {
    const closing = state.windows.find(w => w.id === id);
    if (!closing) return;
    const next = state.windows.filter(w => w.id !== id);
    let focusedId: string | null = null;
    if (next.length) {
      const top = next.reduce((a, b) => (a.zIndex > b.zIndex ? a : b));
      focusedId = top.id;
    }
    setState({
      ...state,
      windows: next.map(w => ({ ...w, isFocused: w.id === focusedId })),
      focusedId,
    });
    berryBus.emit('window:closed', { id, appId: closing.appId });
    // App is fully terminated when no windows for that appId remain.
    const stillRunning = next.some(w => w.appId === closing.appId);
    if (!stillRunning) {
      berryBus.emit('app:terminating', { appId: closing.appId });
      berryBus.emit('app:terminated', { appId: closing.appId });
    }
    if (focusedId) {
      const newTop = next.find(w => w.id === focusedId);
      if (newTop) {
        berryBus.emit('window:focused', { id: focusedId, appId: newTop.appId, prevFocusedId: id });
        berryBus.emit('app:focused', { appId: newTop.appId });
      }
    }
  },

  focus(id: string) {
    if (state.focusedId === id) return;
    const target = state.windows.find(w => w.id === id);
    if (!target) return;
    const prevFocusedId = state.focusedId ?? undefined;
    const prev = prevFocusedId ? state.windows.find(w => w.id === prevFocusedId) : undefined;
    setState({
      ...state,
      windows: state.windows.map(w =>
        w.id === id
          ? { ...w, isFocused: true, isMinimized: false, zIndex: state.nextZ }
          : { ...w, isFocused: false },
      ),
      focusedId: id,
      nextZ: state.nextZ + 1,
    });
    if (prev) berryBus.emit('window:blurred', { id: prev.id, appId: prev.appId });
    berryBus.emit('window:focused', { id, appId: target.appId, prevFocusedId });
    if (!prev || prev.appId !== target.appId) {
      berryBus.emit('app:focused', { appId: target.appId });
    }
  },

  minimize(id: string) {
    const target = state.windows.find(w => w.id === id);
    if (!target || target.isMinimized) return;
    setState({
      ...state,
      windows: state.windows.map(w =>
        w.id === id ? { ...w, isMinimized: true, isFocused: false } : w,
      ),
      focusedId: state.focusedId === id ? null : state.focusedId,
    });
    berryBus.emit('window:minimized', { id, appId: target.appId });
    if (state.focusedId === id) berryBus.emit('window:blurred', { id, appId: target.appId });
  },

  maximize(id: string) {
    const target = state.windows.find(w => w.id === id);
    if (!target) return;
    setState({
      ...state,
      windows: state.windows.map(w => (w.id === id ? { ...w, isMaximized: !w.isMaximized } : w)),
    });
    // Maximize toggling is a resize event in spirit; emit window:resized with the
    // viewport-derived size so subscribers can react.
    const vw = typeof window !== 'undefined' ? window.innerWidth : target.width;
    const vh = typeof window !== 'undefined' ? window.innerHeight : target.height;
    const w = !target.isMaximized ? vw : target.width;
    const h = !target.isMaximized ? vh - 24 - 76 : target.height;
    berryBus.emit('window:resized', { id, w, h });
  },

  restore(id: string) {
    const target = state.windows.find(w => w.id === id);
    if (!target || !target.isMinimized) return;
    const prevFocusedId = state.focusedId ?? undefined;
    setState({
      ...state,
      windows: state.windows.map(w =>
        w.id === id
          ? { ...w, isMinimized: false, isFocused: true, zIndex: state.nextZ }
          : { ...w, isFocused: false },
      ),
      focusedId: id,
      nextZ: state.nextZ + 1,
    });
    berryBus.emit('window:restored', { id, appId: target.appId });
    berryBus.emit('window:focused', { id, appId: target.appId, prevFocusedId });
    berryBus.emit('app:focused', { appId: target.appId });
  },

  move(id: string, x: number, y: number) {
    const win = state.windows.find(w => w.id === id);
    if (!win) return;
    const c = clampPosition(x, y, win.width);
    if (c.x === win.x && c.y === win.y) return; // no-op
    setState({
      ...state,
      windows: state.windows.map(w => (w.id === id ? { ...w, x: c.x, y: c.y } : w)),
    });
    berryBus.emit('window:moved', { id, x: c.x, y: c.y });
  },

  resize(id: string, width: number, height: number) {
    const win = state.windows.find(w => w.id === id);
    if (!win) return;
    let w = Math.max(win.minWidth, width);
    let h = Math.max(win.minHeight, height);
    // Cap to viewport on mobile so the resize handle (if ever shown) can't
    // push the window past the gutter.
    if (typeof window !== 'undefined' && isMobileViewport()) {
      w = Math.min(w, window.innerWidth - MOBILE_GUTTER * 2);
      h = Math.min(h, window.innerHeight - MENU_BAR - DOCK - 16);
    }
    if (w === win.width && h === win.height) return; // no-op
    setState({
      ...state,
      windows: state.windows.map(x => {
        if (x.id !== id) return x;
        return { ...x, width: w, height: h };
      }),
    });
    berryBus.emit('window:resized', { id, w, h });
  },

  closeAll() {
    const closing = state.windows.slice();
    setState({ ...state, windows: [], focusedId: null });
    closing.forEach(w => {
      berryBus.emit('window:closed', { id: w.id, appId: w.appId });
      berryBus.emit('app:terminated', { appId: w.appId });
    });
  },
};

const subscribe = (l: Listener) => windowStore.subscribe(l);
const getSnapshot = () => state;

export function useBerryWindows(): BerryWindowState[] {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return s.windows;
}

export function useBerryFocusedId(): string | null {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return s.focusedId;
}

export function useRunningAppIds(): Set<string> {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  // useSyncExternalStore expects referential stability when nothing changed;
  // since `s` is the same object until setState fires, this is safe.
  return new Set(s.windows.map(w => w.appId));
}

/** Mobile breakpoint used by the chrome (matches the windowStore internals). */
export const BERRY_MOBILE_BREAKPOINT = MOBILE_BREAKPOINT;
/** Gutter (px) reserved on the left and right of mobile windows. */
export const BERRY_MOBILE_GUTTER = MOBILE_GUTTER;
