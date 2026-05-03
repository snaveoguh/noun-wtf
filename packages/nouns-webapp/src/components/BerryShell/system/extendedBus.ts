/**
 * Extended bus — typed pub/sub for events YOU define here (permission:*,
 * service:*, auction:*) that aren't part of the core BerryEventMap owned by
 * the eventBus.ts owner agent.
 *
 * Mirrors the `BerryEventBus` API exactly (emit / on / hook) so subscribers
 * pay no cognitive cost switching buses. We deliberately keep this separate
 * rather than mutating BerryEventMap so we don't step on the other agent's
 * source of truth.
 *
 * If/when these events graduate into the core map, callers can flip a single
 * import without changing call sites — same shape.
 */

import { useEffect, useRef } from 'react';

import type { BerryCapability } from './permissions';

// ---------------------------------------------------------------------------
// Event payload map
// ---------------------------------------------------------------------------

export interface ExtendedEventMap {
  // Permission lifecycle — the prompt UI listens for `requested` and resolves
  // with `granted` / `denied`. `reset` fires when the user clears a stored
  // decision back to "prompt next time".
  'permission:requested': { appId: string; capability: BerryCapability };
  'permission:granted': { appId: string; capability: BerryCapability };
  'permission:denied': { appId: string; capability: BerryCapability };
  'permission:reset': { appId: string; capability: BerryCapability };

  // Service lifecycle — emitted by the serviceManager after the daemon's
  // start/stop method resolves (or rejects, in the failed case).
  'service:started': { id: string };
  'service:stopped': { id: string };
  'service:failed': { id: string; error: string };

  // Auction watcher — emitted by auctionWatcherDaemon. Keep payloads as
  // primitives (string for wei, since BigInt doesn't survive postMessage and
  // makes JSON.stringify barf in the dev log).
  'auction:newBid': { nounId: string; amountWei: string; bidder: string };
  'auction:settled': { nounId: string; winner: string };
}

export type ExtendedEventName = keyof ExtendedEventMap;

interface ExtendedEventRecord<E extends ExtendedEventName = ExtendedEventName> {
  event: E;
  payload: ExtendedEventMap[E];
  timestamp: number;
}

const RING_BUFFER_SIZE = 100;

class ExtendedEventBus {
  private readonly target = new EventTarget();
  private readonly buffer: ExtendedEventRecord[] = [];

  emit<E extends ExtendedEventName>(event: E, payload: ExtendedEventMap[E]): void {
    const record: ExtendedEventRecord<E> = { event, payload, timestamp: Date.now() };
    this.buffer.push(record as ExtendedEventRecord);
    if (this.buffer.length > RING_BUFFER_SIZE) this.buffer.shift();
    this.target.dispatchEvent(new CustomEvent(event, { detail: record }));
  }

  on<E extends ExtendedEventName>(
    event: E,
    handler: (payload: ExtendedEventMap[E]) => void,
  ): () => void {
    const listener = (e: Event) => {
      const detail = (e as CustomEvent<ExtendedEventRecord<E>>).detail;
      handler(detail.payload);
    };
    this.target.addEventListener(event, listener);
    return () => this.target.removeEventListener(event, listener);
  }

  history(): readonly ExtendedEventRecord[] {
    return this.buffer;
  }
}

export const extendedBus = new ExtendedEventBus();

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

export function useExtendedEvent<E extends ExtendedEventName>(
  event: E,
  handler: (payload: ExtendedEventMap[E]) => void,
  deps: ReadonlyArray<unknown> = [],
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    return extendedBus.on(event, p => handlerRef.current(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, ...deps]);
}

/**
 * Subscribe to ALL extended events — used by the Services manager to render
 * the recent event log.
 */
export function useAllExtendedEvents(
  handler: (record: { event: ExtendedEventName; payload: unknown; timestamp: number }) => void,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    const names: ExtendedEventName[] = [
      'permission:requested',
      'permission:granted',
      'permission:denied',
      'permission:reset',
      'service:started',
      'service:stopped',
      'service:failed',
      'auction:newBid',
      'auction:settled',
    ];
    const offs = names.map(name =>
      extendedBus.on(name, payload =>
        handlerRef.current({ event: name, payload, timestamp: Date.now() }),
      ),
    );
    return () => offs.forEach(off => off());
  }, []);
}
