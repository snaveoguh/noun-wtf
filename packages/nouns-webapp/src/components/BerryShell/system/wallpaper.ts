/**
 * BerryOS wallpaper store.
 *
 * Owns the canonical "current wallpaper" + the catalogue of available
 * wallpapers. Wallpapers are pure CSS (gradients/colors) so we don't ship
 * binary assets just to paint the desktop.
 *
 * State pattern matches the rest of BerryOS — a `useSyncExternalStore` shim
 * with a Zustand-shaped surface. We don't ship Zustand and the brief
 * acknowledges that pattern in `notifications.ts` already.
 *
 * Persistence: the selected wallpaper id is mirrored to localStorage so a
 * cold load restores the user's pick before the desktop paints.
 *
 * Events: `system:wallpaperChanged` fires whenever `setWallpaper` lands a
 * different selection. The window-level CustomEvent variant is used because
 * the canonical event bus' BerryEventMap doesn't include this name yet — we
 * follow the same "extended" pattern used by extendedBus.ts.
 */

import { useSyncExternalStore } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WallpaperDef {
  id: string;
  name: string;
  /** CSS background value — anything valid for the `background` shorthand. */
  src: string;
  /** Optional smaller gradient shown in the picker thumb (defaults to src). */
  thumb?: string;
}

interface WallpaperState {
  current: string;
  list: WallpaperDef[];
}

// ---------------------------------------------------------------------------
// Catalogue — three opinionated gradients. Ids are stable; names are display.
// ---------------------------------------------------------------------------

const STRAWBERRY_GRADIENT =
  'radial-gradient(circle at 25% 15%, #ffd1e0 0%, #ff7aa2 30%, #c8345b 70%, #5a1224 100%)';
const NOUNS_SUNSET =
  'linear-gradient(180deg, #ffb86b 0%, #ff7858 35%, #d63b3b 65%, #5d1d2c 100%)';
const DEEP_SPACE =
  'radial-gradient(ellipse at 70% 30%, #1a2150 0%, #0a0e2a 45%, #02030d 100%)';
const BERRY_AQUA =
  // The default — preserves the existing aqua/early-OS-X desktop look.
  'repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.03) 0px, rgba(0, 0, 0, 0.03) 1px, transparent 1px, transparent 3px), linear-gradient(180deg, #6e9bcf 0%, #5a85b8 35%, #4d76a4 70%, #406088 100%)';

const DEFAULT_LIST: WallpaperDef[] = [
  { id: 'aqua', name: 'Berry Aqua', src: BERRY_AQUA },
  { id: 'strawberry', name: 'Strawberry Field', src: STRAWBERRY_GRADIENT },
  { id: 'sunset', name: 'Nouns Sunset', src: NOUNS_SUNSET },
  { id: 'space', name: 'Deep Space', src: DEEP_SPACE },
];

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'berry.wallpaper';

function loadInitialId(): string {
  if (typeof window === 'undefined') return DEFAULT_LIST[0].id;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (typeof raw === 'string' && DEFAULT_LIST.some(w => w.id === raw)) {
      return raw;
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_LIST[0].id;
}

function persist(id: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    /* quota exceeded — silent */
  }
}

// ---------------------------------------------------------------------------
// Store — same pattern as windowStore / notificationStore.
// ---------------------------------------------------------------------------

let state: WallpaperState = {
  current: loadInitialId(),
  list: DEFAULT_LIST,
};

type Listener = () => void;
const listeners = new Set<Listener>();

function setState(next: WallpaperState): void {
  state = next;
  listeners.forEach(l => l());
}

export interface WallpaperChangedDetail {
  id: string;
  src: string;
}

export const wallpaperStore = {
  getState(): WallpaperState {
    return state;
  },
  subscribe(l: Listener): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  setWallpaper(id: string): void {
    if (state.current === id) return;
    const target = state.list.find(w => w.id === id);
    if (!target) return;
    setState({ ...state, current: id });
    persist(id);
    if (typeof window !== 'undefined') {
      const detail: WallpaperChangedDetail = { id: target.id, src: target.src };
      window.dispatchEvent(new CustomEvent('system:wallpaperChanged', { detail }));
    }
  },
  /** Replace the catalogue (for plugins / future user-uploads). */
  setList(list: WallpaperDef[]): void {
    if (!list.length) return;
    const stillThere = list.some(w => w.id === state.current);
    setState({
      list,
      current: stillThere ? state.current : list[0].id,
    });
  },
};

// ---------------------------------------------------------------------------
// React selectors
// ---------------------------------------------------------------------------

const subscribe = (l: Listener) => wallpaperStore.subscribe(l);
const getSnapshot = () => state;

export function useWallpaperList(): WallpaperDef[] {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return s.list;
}

export function useCurrentWallpaper(): WallpaperDef {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return s.list.find(w => w.id === s.current) ?? s.list[0];
}

export function useCurrentWallpaperId(): string {
  const s = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  return s.current;
}
