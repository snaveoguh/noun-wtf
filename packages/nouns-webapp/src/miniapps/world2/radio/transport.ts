// ── NOUN FM transports ──────────────────────────────────────────────────
//
// Online: `fm:*` messages ride the world v2 room's socket (net/Net.ts) to
// the PartyKit relay. Offline (?offline=1): the very same relay runs in
// memory in this tab, no sockets at all, and keeps its station in
// localStorage so a reload doesn't lose the queue.

import type { Net } from '../net/Net';

import { FmRelay, type FmConn } from '../../../../../nouns-party/src/fmRelay';

export interface FmTransport {
  /** Connected (online) / always (offline). */
  readonly ready: boolean;
  readonly offline: boolean;
  send(m: Record<string, unknown>): void;
  onMessage?: (m: Record<string, unknown>) => void;
  dispose(): void;
}

export function netTransport(net: Net): FmTransport {
  const t: FmTransport = {
    get ready() {
      return net.connected;
    },
    offline: false,
    send: m => net.sendFm(m),
    dispose: () => {
      net.onFm = undefined;
    },
  };
  net.onFm = m => t.onMessage?.(m);
  return t;
}

const LOCAL_KEY = 'noun-fm-offline-station';

export function localTransport(): FmTransport & { relay: FmRelay } {
  let closed = false;
  const conn: FmConn = {
    id: 'local',
    send: s => {
      // async like a socket, so callers never re-enter
      queueMicrotask(() => {
        if (closed) return;
        try {
          t.onMessage?.(JSON.parse(s) as Record<string, unknown>);
        } catch {
          // ignore
        }
      });
    },
  };
  const relay = new FmRelay({
    conns: () => [conn],
    save: snap => {
      try {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(snap));
      } catch {
        // private mode: memory only
      }
    },
  });
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    if (raw !== null) relay.load(JSON.parse(raw));
  } catch {
    // start empty
  }
  const t: FmTransport & { relay: FmRelay } = {
    relay,
    ready: true,
    offline: true,
    send: m => relay.message(JSON.stringify(m), conn),
    dispose: () => {
      closed = true;
      relay.dispose();
    },
  };
  return t;
}
