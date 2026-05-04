/**
 * BerryOS event bus — typed pub/sub for window + app + system lifecycle.
 *
 * Built on top of the browser-native `EventTarget` so we get
 * subscribe/unsubscribe semantics for free without pulling in a dependency.
 * The `BerryEventMap` interface gives us a strict, discriminated payload type
 * per event name so subscribers never receive an `any`.
 *
 * Conventions:
 * - Stores call `bus.emit(...)` AFTER mutating their state, never before.
 * - No-op operations should not emit (caller's responsibility — see windowStore
 *   `focus()` / `move()` for examples that early-return).
 * - React components subscribe via the `useBerryEvent` hook so the cleanup is
 *   guaranteed.
 *
 * Dev helper: set `window.__berryDebug = true` in the console to log every
 * event (name + payload) as it fires. The bus also keeps the last 200 events
 * in `window.__berryBusLog` for after-the-fact inspection.
 */

import { useEffect, useRef } from 'react';

// ---------------------------------------------------------------------------
// Event payload map — single source of truth for event names + shapes.
// ---------------------------------------------------------------------------

export interface BerryEventMap {
  // Window lifecycle
  'window:created': { id: string; appId: string; x: number; y: number; w: number; h: number };
  'window:focused': { id: string; appId: string; prevFocusedId?: string };
  'window:blurred': { id: string; appId: string };
  'window:minimized': { id: string; appId: string };
  'window:restored': { id: string; appId: string };
  'window:moved': { id: string; x: number; y: number };
  'window:resized': { id: string; w: number; h: number };
  'window:closed': { id: string; appId: string };

  // App lifecycle
  'app:launching': { appId: string; source: 'dock' | 'menu' | 'finder' | 'event' };
  'app:launched': { appId: string; windowId: string };
  'app:terminating': { appId: string };
  'app:terminated': { appId: string };
  'app:focused': { appId: string };

  // System
  'system:bootComplete': Record<string, never>;
  'system:walletConnected': { address: string };
  'system:walletDisconnected': Record<string, never>;
  'system:themeChanged': { theme: string };

  // Auction (subscribed by notifications/*)
  'auction:newBid': { nounId: number | string; amount: string; bidder?: string };

  // Service / capability lifecycle (subscribed by notifications/*)
  'service:failed': { name: string; reason?: string };
  'permission:denied': { appId: string; appName?: string; capability: string };

  // Notifications (owned by system/notifications.ts)
  'notification:posted': {
    id: string;
    appId: string;
    title: string;
    body?: string;
    level: 'info' | 'success' | 'warning' | 'error';
    timestamp: number;
  };
  'notification:dismissed': { id?: string; appId?: string; all?: boolean };
}

export type BerryEventName = keyof BerryEventMap;

export interface BerryEventRecord<E extends BerryEventName = BerryEventName> {
  event: E;
  payload: BerryEventMap[E];
  timestamp: number;
}

// ---------------------------------------------------------------------------
// Bus implementation — singleton over an EventTarget.
// ---------------------------------------------------------------------------

const RING_BUFFER_SIZE = 200;

declare global {
  interface Window {
    /** Toggle to log every bus event to console. Defaults to off. */
    __berryDebug?: boolean;
    /** Ring buffer of the most recent bus events for debugging. */
    __berryBusLog?: BerryEventRecord[];
  }
}

class BerryEventBus {
  private readonly target = new EventTarget();
  private readonly buffer: BerryEventRecord[] = [];

  emit<E extends BerryEventName>(event: E, payload: BerryEventMap[E]): void {
    const record: BerryEventRecord<E> = { event, payload, timestamp: Date.now() };

    // Ring buffer — drop oldest when over capacity.
    this.buffer.push(record as BerryEventRecord);
    if (this.buffer.length > RING_BUFFER_SIZE) this.buffer.shift();

    if (typeof window !== 'undefined') {
      window.__berryBusLog = this.buffer;
      if (window.__berryDebug) {
        // eslint-disable-next-line no-console
        console.log(`[berry-bus] ${event}`, payload);
      }
    }

    this.target.dispatchEvent(new CustomEvent(event, { detail: record }));
  }

  on<E extends BerryEventName>(
    event: E,
    handler: (payload: BerryEventMap[E]) => void,
  ): () => void {
    const listener = (e: Event) => {
      const detail = (e as CustomEvent<BerryEventRecord<E>>).detail;
      handler(detail.payload);
    };
    this.target.addEventListener(event, listener);
    return () => this.target.removeEventListener(event, listener);
  }

  /** Subscribe to every event — used by SystemMonitor and dev tooling. */
  onAll(handler: (record: BerryEventRecord) => void): () => void {
    const eventNames = Object.keys(EVENT_NAMES) as BerryEventName[];
    const offs = eventNames.map(name =>
      this.on(name, payload =>
        handler({ event: name, payload, timestamp: Date.now() } as BerryEventRecord),
      ),
    );
    return () => offs.forEach(off => off());
  }

  /** Snapshot of the recent event ring buffer (newest last). */
  history(): readonly BerryEventRecord[] {
    return this.buffer;
  }
}

// Static name list keeps `onAll` honest — kept in lockstep with BerryEventMap
// at the type level via `Record<BerryEventName, true>`.
const EVENT_NAMES: Record<BerryEventName, true> = {
  'window:created': true,
  'window:focused': true,
  'window:blurred': true,
  'window:minimized': true,
  'window:restored': true,
  'window:moved': true,
  'window:resized': true,
  'window:closed': true,
  'app:launching': true,
  'app:launched': true,
  'app:terminating': true,
  'app:terminated': true,
  'app:focused': true,
  'system:bootComplete': true,
  'system:walletConnected': true,
  'system:walletDisconnected': true,
  'system:themeChanged': true,
  'auction:newBid': true,
  'service:failed': true,
  'permission:denied': true,
  'notification:posted': true,
  'notification:dismissed': true,
  // Spotlight + global hotkey (augmented in spotlightEvents.ts)
  'hotkey:fired': true,
  'spotlight:toggle': true,
  'spotlight:opened': true,
  'spotlight:closed': true,
  'spotlight:launched': true,
  // Drag-and-drop (augmented in berryEvents.d.ts)
  'dnd:start': true,
  'dnd:end': true,
  'dnd:targetEnter': true,
  'dnd:targetLeave': true,
  // Clipboard (augmented in berryEvents.d.ts)
  'clipboard:copy': true,
  'clipboard:paste': true,
  'clipboard:cleared': true,
  // Virtual filesystem (augmented in berryEvents.d.ts)
  'fs:created': true,
  'fs:modified': true,
  'fs:deleted': true,
  'fs:moved': true,
};

export const berryBus = new BerryEventBus();

// ---------------------------------------------------------------------------
// React hook — subscribe + unsubscribe scoped to component lifetime.
// ---------------------------------------------------------------------------

/**
 * Subscribe to a Berry event from a React component. Re-subscribes only when
 * `deps` change; the handler ref is kept stable so callers don't need to
 * memoize their handler.
 */
export function useBerryEvent<E extends BerryEventName>(
  event: E,
  handler: (payload: BerryEventMap[E]) => void,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deps: ReadonlyArray<unknown> = [],
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    return berryBus.on(event, p => handlerRef.current(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, ...deps]);
}

/**
 * Subscribe to every event — used by SystemMonitor.
 */
export function useBerryAllEvents(handler: (record: BerryEventRecord) => void): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    return berryBus.onAll(r => handlerRef.current(r));
  }, []);
}

export const ALL_BERRY_EVENT_NAMES = Object.keys(EVENT_NAMES) as BerryEventName[];
