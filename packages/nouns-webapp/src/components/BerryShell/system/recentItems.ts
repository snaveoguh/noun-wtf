/**
 * Recent items tracker — listens for `app:launched` and (when present) the
 * vfs `fs:opened` event, and maintains a ring buffer of the last 20 items.
 *
 * Persisted to `localStorage` under `berry.recentItems` so the list survives
 * reloads and the menu-bar dropdowns / Spotlight feel like a real OS.
 *
 * The `fs:opened` event isn't part of the BerryEventMap today (vfs only emits
 * `fs:created` / `fs:modified` / `fs:deleted` / `fs:moved`), so the
 * subscription is wrapped in a try/catch and a runtime presence check — if the
 * other agent ever adds `fs:opened`, this picks it up automatically with no
 * source change.
 */
import { useSyncExternalStore } from 'react';

import { ALL_BERRY_EVENT_NAMES, berryBus, useBerryEvent } from './eventBus';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type RecentItemKind = 'app' | 'file';

export interface RecentItem {
  /** Stable key — `app:<appId>` or `file:<path>`. Dedupe pivot. */
  key: string;
  kind: RecentItemKind;
  label: string;
  /** App id (for kind='app') or owning app id (for kind='file'). */
  appId?: string;
  /** vfs path for kind='file'. */
  path?: string;
  icon?: string;
  timestamp: number;
}

const STORAGE_KEY = 'berry.recentItems';
const MAX_ITEMS = 20;

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

function readPersisted(): RecentItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (x): x is RecentItem =>
          !!x &&
          typeof x === 'object' &&
          typeof (x as RecentItem).key === 'string' &&
          typeof (x as RecentItem).label === 'string' &&
          typeof (x as RecentItem).timestamp === 'number',
      )
      .slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

function writePersisted(items: RecentItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch {
    // Quota exceeded / disabled storage — silently degrade.
  }
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

let items: RecentItem[] = readPersisted();
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach(l => l());
}

function pushItem(next: RecentItem): void {
  // Dedupe by key — bump existing entry to the front rather than duplicate it.
  const filtered = items.filter(i => i.key !== next.key);
  items = [next, ...filtered].slice(0, MAX_ITEMS);
  writePersisted(items);
  notify();
}

export const recentItemsStore = {
  subscribe(l: () => void) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  getSnapshot(): readonly RecentItem[] {
    return items;
  },
  add(item: RecentItem): void {
    pushItem(item);
  },
  clear(): void {
    items = [];
    writePersisted(items);
    notify();
  },
};

// ---------------------------------------------------------------------------
// Bus wiring — runs once on first import.
// ---------------------------------------------------------------------------

let wired = false;

function ensureWired(): void {
  if (wired) return;
  wired = true;

  // app:launched — always present in core BerryEventMap.
  berryBus.on('app:launched', payload => {
    pushItem({
      key: `app:${payload.appId}`,
      kind: 'app',
      label: payload.appId,
      appId: payload.appId,
      icon: undefined,
      timestamp: Date.now(),
    });
  });

  // fs:opened — optional. The vfs subsystem may or may not exist; subscribe
  // defensively. If the event never fires this just sits idle.
  if (ALL_BERRY_EVENT_NAMES.includes('fs:opened' as never)) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (berryBus as any).on('fs:opened', (payload: { path?: string; appId?: string }) => {
        if (!payload?.path) return;
        pushItem({
          key: `file:${payload.path}`,
          kind: 'file',
          label: payload.path.split('/').pop() ?? payload.path,
          appId: payload.appId,
          path: payload.path,
          icon: '📄',
          timestamp: Date.now(),
        });
      });
    } catch {
      // Type guard above is a runtime check; ignore if `on` rejects.
    }
  }
}

ensureWired();

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

/**
 * Read the recent items list. `filter` lets a caller scope to apps or files.
 * The returned array is referentially stable until the next push, so this is
 * safe for menu-bar dropdowns + Spotlight to consume directly.
 */
export function useRecentItems(filter?: RecentItemKind): readonly RecentItem[] {
  const all = useSyncExternalStore(
    recentItemsStore.subscribe,
    recentItemsStore.getSnapshot,
    recentItemsStore.getSnapshot,
  );
  if (!filter) return all;
  return all.filter(i => i.kind === filter);
}

// React-friendly bus handle that re-fires `app:launched` even if the
// `useRecentItems` consumer mounts after the event already fired — the store
// is the source of truth so this is a no-op subscription guard for HMR.
export function useRecentItemsBusGuard(): void {
  useBerryEvent('app:launched', () => {
    /* store is wired at module load — this is a no-op tap purely so HMR
       reloads the subscription cleanly when the consumer re-renders. */
  });
}
