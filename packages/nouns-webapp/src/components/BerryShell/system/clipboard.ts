/**
 * BerryOS clipboard manager.
 *
 * Maintains a 50-item ring-buffer history of in-shell copies and mirrors the
 * most recent value to the native `navigator.clipboard` so OS-level paste in
 * other apps still works.
 *
 * Type detection is best-effort:
 * - `0x` + 40 hex chars   → 'address'
 * - starts with `http(s)`  → 'url'
 * - all-digits, < 100k     → 'noun-id'
 * - everything else        → 'text'
 *
 * Persists the last 50 items (sans rare large blobs) to localStorage so the
 * history survives reloads.
 */

import { berryBus } from './eventBus';
import { createStore } from './externalStore';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BerryClipboardType = 'text' | 'url' | 'address' | 'noun-id';

export interface BerryClipboardItem {
  id: string;
  content: string;
  type: BerryClipboardType;
  sourceAppId?: string;
  timestamp: number;
}

interface ClipboardState {
  items: BerryClipboardItem[];
}

const RING_BUFFER_SIZE = 50;
const STORAGE_KEY = 'berry.clipboard';
const MAX_ITEM_LENGTH = 8_000; // skip persisting individual mega-blobs

// ---------------------------------------------------------------------------
// Boot from localStorage
// ---------------------------------------------------------------------------

function readPersisted(): BerryClipboardItem[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (it): it is BerryClipboardItem =>
        typeof it === 'object' &&
        it !== null &&
        typeof (it as BerryClipboardItem).id === 'string' &&
        typeof (it as BerryClipboardItem).content === 'string' &&
        typeof (it as BerryClipboardItem).type === 'string',
    );
  } catch {
    return [];
  }
}

function persist(items: BerryClipboardItem[]): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const trimmed = items.map(it =>
      it.content.length > MAX_ITEM_LENGTH
        ? { ...it, content: it.content.slice(0, MAX_ITEM_LENGTH) + '…' }
        : it,
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // localStorage full / disabled — silent.
  }
}

// ---------------------------------------------------------------------------
// Store + API
// ---------------------------------------------------------------------------

export const clipboardStore = createStore<ClipboardState>({
  items: readPersisted(),
});

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const URL_RE = /^https?:\/\//i;
const DIGITS_RE = /^\d+$/;

export function detectClipboardType(content: string): BerryClipboardType {
  const trimmed = content.trim();
  if (ADDRESS_RE.test(trimmed)) return 'address';
  if (URL_RE.test(trimmed)) return 'url';
  if (DIGITS_RE.test(trimmed)) {
    const n = Number(trimmed);
    if (Number.isFinite(n) && n >= 0 && n < 100_000) return 'noun-id';
  }
  return 'text';
}

function pushItem(item: BerryClipboardItem): void {
  clipboardStore.setState(s => {
    // De-dup if the same content+type as the head — just refresh timestamp.
    const head = s.items[0];
    if (head && head.content === item.content && head.type === item.type) {
      const refreshed = [{ ...head, timestamp: item.timestamp }, ...s.items.slice(1)];
      persist(refreshed);
      return { items: refreshed };
    }
    const next = [item, ...s.items].slice(0, RING_BUFFER_SIZE);
    persist(next);
    return { items: next };
  });
}

let idCounter = 0;
function nextId(): string {
  idCounter += 1;
  return `clip-${Date.now().toString(36)}-${idCounter.toString(36)}`;
}

/**
 * Copy a value into the in-shell clipboard.
 *
 * Mirrors to `navigator.clipboard.writeText` best-effort — if the page isn't
 * focused (or the host blocks clipboard access in iframes) we still keep our
 * own history, the native sync just no-ops.
 */
export function copy(
  content: string,
  type?: BerryClipboardType,
  sourceAppId?: string,
): BerryClipboardItem {
  const resolvedType = type ?? detectClipboardType(content);
  const item: BerryClipboardItem = {
    id: nextId(),
    content,
    type: resolvedType,
    sourceAppId,
    timestamp: Date.now(),
  };
  pushItem(item);

  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(content).catch(() => {
      // Permissions / focus issues — already mirrored to our store, ignore.
    });
  }

  berryBus.emit('clipboard:copy', { item });
  return item;
}

/** Most-recent item. Emits a `clipboard:paste` for telemetry. */
export function paste(): BerryClipboardItem | null {
  const item = clipboardStore.getState().items[0] ?? null;
  berryBus.emit('clipboard:paste', { item });
  return item;
}

/** Promote a history entry to the head + sync native clipboard. */
export function pickHistory(id: string): BerryClipboardItem | null {
  const items = clipboardStore.getState().items;
  const idx = items.findIndex(it => it.id === id);
  if (idx <= 0) {
    if (idx === 0) return items[0];
    return null;
  }
  const picked = items[idx];
  const next = [picked, ...items.slice(0, idx), ...items.slice(idx + 1)].slice(0, RING_BUFFER_SIZE);
  clipboardStore.setState({ items: next });
  persist(next);
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(picked.content).catch(() => {});
  }
  berryBus.emit('clipboard:copy', { item: picked });
  return picked;
}

export function clearAll(): void {
  clipboardStore.setState({ items: [] });
  persist([]);
  berryBus.emit('clipboard:cleared', {});
}

export function removeItem(id: string): void {
  clipboardStore.setState(s => {
    const next = s.items.filter(it => it.id !== id);
    persist(next);
    return { items: next };
  });
}
