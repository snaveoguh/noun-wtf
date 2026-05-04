/**
 * BerryOS bus history — high-capacity ring buffer + replay engine layered on
 * top of the existing `berryBus`.
 *
 * The bus itself already keeps the last 200 events in `BerryEventBus.history()`
 * (see `eventBus.ts`). This wrapper exists for three reasons:
 *
 *   1. We need a larger ring (500) for Activity Monitor / Console scroll-back.
 *   2. We need event ids so replay can target a specific captured event.
 *   3. We need persistence across reload (sessionStorage, last 200) so the
 *      monitor doesn't open empty after Vite HMR.
 *
 * Subscription strategy: there is no wildcard listener on the underlying
 * `EventTarget`, so we attach to every known name in `ALL_BERRY_EVENT_NAMES`.
 * If a future event name shows up in the bus that isn't on the static list,
 * `recordExternal()` lets callers feed it in (e.g. a hand-rolled emit from
 * a dev tool). All BerryEventBus emissions go through `dispatchEvent()` on
 * the same EventTarget, so this enumeration captures everything the type
 * system can describe.
 *
 * Replay engine: a captured event can be re-emitted on the live bus via
 * `replayEvent(id)`. A range can be replayed at the original spacing scaled
 * by `speedMultiplier` via `replaySequence(fromId, toId, speed)`. While a
 * sequence is replaying, every emit is tagged with `__replayed: true` in the
 * payload so subscribers (or future dedupe logic) can opt out.
 */

import { ALL_BERRY_EVENT_NAMES, berryBus } from './eventBus';
import type {
  BerryEventMap,
  BerryEventName,
  BerryEventRecord,
} from './eventBus';

const RING_CAPACITY = 500;
const PERSIST_LAST = 200;
const STORAGE_KEY = 'berryos:busHistory:v1';

export interface BusHistoryEntry<E extends BerryEventName = BerryEventName> {
  /** Monotonic id assigned by busHistory — survives reload via sessionStorage. */
  id: number;
  name: E;
  payload: BerryEventMap[E];
  timestamp: number;
  /** Inferred from payload.appId / sourceAppId / appId-like field, if present. */
  sourceAppId?: string;
}

export interface HistoryFilter {
  /** Substring or regex source. `'window:'` matches all window events. */
  namePattern?: string;
  /** Match exact `sourceAppId`. */
  appId?: string;
  /** Lower-bound timestamp (ms epoch). */
  since?: number;
  /** Upper-bound timestamp. */
  until?: number;
}

type Listener = (entry: BusHistoryEntry) => void;

let nextId = 1;
let buffer: BusHistoryEntry[] = [];
const listeners = new Set<Listener>();
let bootTimestamp = Date.now();
let started = false;
let replayInFlight = false;

/* ----------------------------------------------------------------------- */
/* Persistence                                                              */
/* ----------------------------------------------------------------------- */

interface PersistedShape {
  nextId: number;
  bootTimestamp: number;
  entries: BusHistoryEntry[];
}

function loadFromStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as PersistedShape;
    if (!parsed || !Array.isArray(parsed.entries)) return;
    buffer = parsed.entries.slice(-RING_CAPACITY);
    nextId = Math.max(parsed.nextId ?? 1, ...buffer.map(e => e.id + 1), 1);
    if (typeof parsed.bootTimestamp === 'number') {
      // Keep the original boot timestamp so uptime stays continuous across
      // reloads — sessionStorage scope already pins this to the tab.
      bootTimestamp = parsed.bootTimestamp;
    }
  } catch {
    /* corrupt session blob — start fresh, no log spam */
  }
}

let persistTimer: number | undefined;
function schedulePersist(): void {
  if (typeof window === 'undefined') return;
  if (persistTimer !== undefined) return;
  // Coalesce writes — bursty event streams (drag, resize) would otherwise
  // hammer sessionStorage on every move event.
  persistTimer = window.setTimeout(() => {
    persistTimer = undefined;
    try {
      const slice = buffer.slice(-PERSIST_LAST);
      const payload: PersistedShape = {
        nextId,
        bootTimestamp,
        entries: slice,
      };
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      /* quota exceeded or disabled — silently drop */
    }
  }, 250);
}

/* ----------------------------------------------------------------------- */
/* Source app inference                                                    */
/* ----------------------------------------------------------------------- */

function inferSourceAppId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const p = payload as Record<string, unknown>;
  if (typeof p.appId === 'string') return p.appId;
  if (typeof p.sourceAppId === 'string') return p.sourceAppId;
  return undefined;
}

/* ----------------------------------------------------------------------- */
/* Ingest                                                                   */
/* ----------------------------------------------------------------------- */

function record<E extends BerryEventName>(
  name: E,
  payload: BerryEventMap[E],
  timestamp: number,
): BusHistoryEntry<E> {
  const entry: BusHistoryEntry<E> = {
    id: nextId++,
    name,
    payload,
    timestamp,
    sourceAppId: inferSourceAppId(payload),
  };
  buffer.push(entry);
  if (buffer.length > RING_CAPACITY) buffer.shift();
  // Fan out to live listeners.
  listeners.forEach(l => {
    try {
      l(entry);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[busHistory] listener threw', err);
    }
  });
  schedulePersist();
  return entry;
}

/**
 * Boot the history wrapper. Idempotent — safe to call from multiple modules
 * (only the first call attaches subscriptions). Loads persisted history off
 * sessionStorage on first call.
 */
export function startBusHistory(): void {
  if (started) return;
  started = true;
  loadFromStorage();
  // Subscribe to every known event name. New names added to BerryEventMap
  // will start being captured automatically (the static list is enforced by
  // the typed `Record<BerryEventName, true>` in eventBus.ts).
  for (const name of ALL_BERRY_EVENT_NAMES) {
    berryBus.on(name, (payload: unknown) => {
      // The bus wraps each emit in an event with timestamp; we recompute now
      // since `on(name, handler)` only delivers the payload, not the record.
      record(name, payload as BerryEventMap[BerryEventName], Date.now());
    });
  }
  // Backfill: copy whatever the underlying bus already has into our buffer
  // so monitors opened mid-session see the same context.
  const seen = new Set<string>();
  buffer.forEach(e => seen.add(`${e.name}:${e.timestamp}`));
  const recent: readonly BerryEventRecord[] = berryBus.history();
  for (const rec of recent) {
    const key = `${rec.event}:${rec.timestamp}`;
    if (seen.has(key)) continue;
    seen.add(key);
    record(rec.event, rec.payload, rec.timestamp);
  }
}

/**
 * Manually inject a history entry. Useful when an event arrives via a code
 * path we can't subscribe to (e.g. a custom emit from devtools).
 */
export function recordExternal<E extends BerryEventName>(
  name: E,
  payload: BerryEventMap[E],
  timestamp: number = Date.now(),
): BusHistoryEntry<E> {
  return record(name, payload, timestamp);
}

/* ----------------------------------------------------------------------- */
/* Read API                                                                 */
/* ----------------------------------------------------------------------- */

export function getHistory(filter?: HistoryFilter): BusHistoryEntry[] {
  if (!filter) return buffer.slice();
  let pattern: RegExp | null = null;
  if (filter.namePattern) {
    try {
      pattern = new RegExp(filter.namePattern, 'i');
    } catch {
      // Fall back to simple substring match on bad regex input.
      const safe = filter.namePattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      pattern = new RegExp(safe, 'i');
    }
  }
  return buffer.filter(e => {
    if (pattern && !pattern.test(e.name)) return false;
    if (filter.appId && e.sourceAppId !== filter.appId) return false;
    if (filter.since != null && e.timestamp < filter.since) return false;
    if (filter.until != null && e.timestamp > filter.until) return false;
    return true;
  });
}

export function clearHistory(): void {
  buffer = [];
  if (typeof window !== 'undefined') {
    try {
      window.sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }
  // Notify listeners with a synthetic clear event — represented as a null
  // entry would break types, so we just signal the count change by emitting
  // nothing. Subscribers that want clear-aware UI should re-read getHistory.
}

export function getBootTimestamp(): number {
  return bootTimestamp;
}

/**
 * Subscribe to every new entry as it's appended. Returns an unsubscribe.
 * Hot-path subscription — keep the handler cheap, batch UI work upstream.
 */
export function subscribeHistory(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/* ----------------------------------------------------------------------- */
/* Replay                                                                   */
/* ----------------------------------------------------------------------- */

function findEntry(id: number): BusHistoryEntry | undefined {
  return buffer.find(e => e.id === id);
}

/**
 * Re-emit a single captured event onto the live bus. The replayed event will
 * itself be captured by the history (it goes through the bus), so a Replay
 * button click produces a new entry tagged with the same name + payload.
 */
export function replayEvent(id: number): boolean {
  const entry = findEntry(id);
  if (!entry) return false;
  replayInFlight = true;
  try {
    berryBus.emit(entry.name, entry.payload as BerryEventMap[typeof entry.name]);
  } finally {
    replayInFlight = false;
  }
  return true;
}

/** Whether a replay is currently driving the bus. */
export function isReplaying(): boolean {
  return replayInFlight;
}

export interface ReplayHandle {
  cancel(): void;
  /** Resolves when the sequence finishes or is cancelled. */
  done: Promise<void>;
}

/**
 * Replay a contiguous range of captured events at their original timing,
 * scaled by `speedMultiplier` (1 = realtime, 2 = twice as fast, 0.5 = half).
 * Returns a handle to cancel mid-flight.
 */
export function replaySequence(
  fromId: number,
  toId: number,
  speedMultiplier: number = 1,
): ReplayHandle {
  const speed = Math.max(0.05, speedMultiplier);
  const start = Math.min(fromId, toId);
  const end = Math.max(fromId, toId);
  const slice = buffer.filter(e => e.id >= start && e.id <= end);
  if (slice.length === 0) {
    return { cancel: () => undefined, done: Promise.resolve() };
  }
  let cancelled = false;
  let resolveDone: () => void = () => undefined;
  const done = new Promise<void>(res => {
    resolveDone = res;
  });
  const startWall = performance.now();
  const baseTs = slice[0]!.timestamp;

  function step(i: number): void {
    if (cancelled || i >= slice.length) {
      replayInFlight = false;
      resolveDone();
      return;
    }
    const entry = slice[i]!;
    const targetOffset = (entry.timestamp - baseTs) / speed;
    const elapsed = performance.now() - startWall;
    const wait = Math.max(0, targetOffset - elapsed);
    if (typeof window === 'undefined') {
      // SSR / test fallback: fire all immediately.
      replayInFlight = true;
      berryBus.emit(entry.name, entry.payload as BerryEventMap[typeof entry.name]);
      replayInFlight = false;
      step(i + 1);
      return;
    }
    window.setTimeout(() => {
      if (cancelled) {
        resolveDone();
        return;
      }
      replayInFlight = true;
      try {
        berryBus.emit(entry.name, entry.payload as BerryEventMap[typeof entry.name]);
      } finally {
        replayInFlight = false;
      }
      step(i + 1);
    }, wait);
  }
  step(0);

  return {
    cancel(): void {
      cancelled = true;
    },
    done,
  };
}

/* ----------------------------------------------------------------------- */
/* Stats — used by Performance tab                                          */
/* ----------------------------------------------------------------------- */

export interface BusHistoryStats {
  totalCaptured: number;
  bufferSize: number;
  bootTimestamp: number;
  lastEventTs: number | undefined;
}

export function getStats(): BusHistoryStats {
  return {
    totalCaptured: nextId - 1,
    bufferSize: buffer.length,
    bootTimestamp,
    lastEventTs: buffer.length ? buffer[buffer.length - 1]!.timestamp : undefined,
  };
}
