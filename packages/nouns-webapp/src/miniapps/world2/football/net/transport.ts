// ── How football messages travel ────────────────────────────────────────
//
// In the game: the world v2 PartySocket (net/Net.ts `sendFootball` /
// `onFootball`), relayed by packages/nouns-party/src/footballRelay.ts.
// Offline: nowhere. In tests: a LoopbackHub (several endpoints, optional
// latency / jitter / loss, deterministic from a seed), optionally routed
// through the real relay. Everything that arrives goes through the codec's
// readMsg first.

import type { FootballMsg } from '../contract';

import { readMsg } from './codec';

export interface FootballTransport {
  /** My connection id ('me' offline). */
  readonly selfId: string;
  readonly online: boolean;
  send(m: FootballMsg): void;
  /** Subscribe (lobby + session both listen); returns the unsubscribe. */
  onMessage(cb: (m: FootballMsg) => void): () => void;
}

class Listeners {
  private cbs = new Set<(m: FootballMsg) => void>();
  add(cb: (m: FootballMsg) => void) {
    this.cbs.add(cb);
    return () => {
      this.cbs.delete(cb);
    };
  }
  emit(m: FootballMsg) {
    for (const cb of [...this.cbs]) cb(m);
  }
}

/** The part of world2/net/Net.ts this needs (structural, so tests can fake it). */
export interface FootballNet {
  myId: string;
  connected: boolean;
  onFootball?: (m: Record<string, unknown>) => void;
  sendFootball(m: { type: string }): void;
}

export class NetTransport implements FootballTransport {
  private ls = new Listeners();

  constructor(
    private net: FootballNet,
    private offline = false,
  ) {
    net.onFootball = raw => {
      const m = readMsg(raw);
      if (m !== null) this.ls.emit(m);
    };
  }

  get selfId() {
    return this.offline ? 'me' : this.net.myId || 'me';
  }

  get online() {
    return !this.offline && this.net.connected;
  }

  send(m: FootballMsg) {
    if (this.online) this.net.sendFootball(m);
  }

  onMessage(cb: (m: FootballMsg) => void) {
    return this.ls.add(cb);
  }

  /** Stop listening on the socket. */
  dispose() {
    this.net.onFootball = undefined;
  }
}

// ── Loopback (tests, local dev) ──

export interface LoopConn {
  id: string;
  send(msg: string): void;
}

/** A relay's `handle` (footballRelay.ts FootballRelay fits). */
export interface LoopRelay {
  handle(raw: Record<string, unknown>, from: LoopConn, conns: Iterable<LoopConn>): void;
  close?(id: string, conns: Iterable<LoopConn>): void;
}

export interface LoopbackOptions {
  /** One-way delay, ms (sender → relay → receiver). */
  latencyMs?: number;
  /** Extra random delay 0..jitterMs per message. Order per link is kept (like TCP). */
  jitterMs?: number;
  /** 0..1: chance a delivery is dropped. */
  loss?: number;
  seed?: number;
  /** Route through this relay; without one, `to` goes to that endpoint, the rest to everyone else. */
  relay?: LoopRelay;
}

/** Small seeded PRNG (mulberry32). */
export function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Pending {
  at: number;
  n: number;
  to: string;
  s: string;
}

export class LoopbackEndpoint implements FootballTransport {
  private ls = new Listeners();
  connected = true;
  /** Messages received (after readMsg). */
  received = 0;

  constructor(
    private hub: LoopbackHub,
    readonly selfId: string,
  ) {}

  get online() {
    return this.connected;
  }

  send(m: FootballMsg) {
    if (this.connected) this.hub.post(this.selfId, m);
  }

  onMessage(cb: (m: FootballMsg) => void) {
    return this.ls.add(cb);
  }

  /** @internal */
  deliver(s: string) {
    if (!this.connected) return;
    const m = readMsg(JSON.parse(s));
    if (m === null) return;
    this.received++;
    this.ls.emit(m);
  }
}

export class LoopbackHub {
  /** Hub clock (ms); pass `() => hub.now` to sessions. */
  now = 0;
  sent = 0;
  delivered = 0;
  /** 0..1 chance a delivery is dropped (settable mid-test). */
  loss: number;
  dropped = 0;
  /** Bytes per message type that left a sender. */
  bytes = new Map<string, { n: number; total: number; max: number }>();

  private eps = new Map<string, LoopbackEndpoint>();
  private q: Pending[] = [];
  private seqN = 0;
  private lastAt = new Map<string, number>();
  private rand: () => number;

  constructor(private o: LoopbackOptions = {}) {
    this.rand = rng(o.seed ?? 1);
    this.loss = o.loss ?? 0;
  }

  endpoint(id: string): LoopbackEndpoint {
    let e = this.eps.get(id);
    if (e === undefined) {
      e = new LoopbackEndpoint(this, id);
      this.eps.set(id, e);
    }
    e.connected = true;
    return e;
  }

  /** A socket closes: the relay hears it (if any) and nothing reaches it again. */
  disconnect(id: string) {
    const e = this.eps.get(id);
    if (e === undefined) return;
    e.connected = false;
    this.o.relay?.close?.(id, this.conns(id));
  }

  private conns(from: string): LoopConn[] {
    return [...this.eps.values()]
      .filter(e => e.connected)
      .map(e => ({ id: e.selfId, send: (s: string) => this.schedule(from, e.selfId, s) }));
  }

  /** @internal */
  post(from: string, m: FootballMsg) {
    const s = JSON.stringify(m);
    this.sent++;
    const b = this.bytes.get(m.type) ?? { n: 0, total: 0, max: 0 };
    b.n++;
    b.total += s.length;
    b.max = Math.max(b.max, s.length);
    this.bytes.set(m.type, b);
    const raw = JSON.parse(s) as Record<string, unknown>;
    const conns = this.conns(from);
    if (this.o.relay !== undefined) {
      const self = conns.find(c => c.id === from) ?? { id: from, send: () => {} };
      this.o.relay.handle(raw, self, conns);
      return;
    }
    const to = (raw as { to?: unknown }).to;
    for (const c of conns) {
      if (c.id === from) continue;
      if (typeof to === 'string' && to !== c.id) continue;
      c.send(s);
    }
  }

  private schedule(from: string, to: string, s: string) {
    if (this.loss > 0 && this.rand() < this.loss) {
      this.dropped++;
      return;
    }
    const lat = (this.o.latencyMs ?? 0) + this.rand() * (this.o.jitterMs ?? 0);
    const key = `${from}>${to}`;
    const at = Math.max(this.now + lat, this.lastAt.get(key) ?? -Infinity);
    this.lastAt.set(key, at);
    this.q.push({ at, n: this.seqN++, to, s });
  }

  /** Deliver everything due in the next `ms` (the clock moves to each delivery). */
  advance(ms: number) {
    const end = this.now + ms;
    for (;;) {
      let best = -1;
      for (let i = 0; i < this.q.length; i++) {
        const p = this.q[i];
        if (p.at > end) continue;
        const b = best < 0 ? null : this.q[best];
        if (b === null || p.at < b.at || (p.at === b.at && p.n < b.n)) best = i;
      }
      if (best < 0) break;
      const p = this.q.splice(best, 1)[0];
      this.now = Math.max(this.now, p.at);
      this.delivered++;
      this.eps.get(p.to)?.deliver(p.s);
    }
    this.now = end;
  }

  /** Messages still in flight. */
  get inFlight() {
    return this.q.length;
  }
}
