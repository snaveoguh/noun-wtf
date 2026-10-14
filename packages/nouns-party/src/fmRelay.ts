// ── NOUN FM relay (world v2 room, `fm:` messages) ───────────────────────
//
// Holds the station: open queue, now playing, today's DJ sets. Clients
// play the audio themselves from the shared timeline (fmStation.ts); this
// only keeps the state, applies the rules and tells everyone when it
// changes. World / hoops / warfare traffic never comes through here.
//
// Client → server
//   fm:hello  {key}                      identify (private per-browser key) → fm:state
//   fm:ping   {t}                        → fm:pong {t, s: server ms} (clock sync)
//   fm:add    {track, by}                queue a track
//   fm:remove {id} / fm:move {id, dir}   your own entries only
//   fm:skip   {token?}                   end the current queue track (its owner, or admin token)
//   fm:set    {dj, name, startAt, tracks} book (or replace) your set for today
//   fm:unset  {id, token?}               cancel your set (or any, with the admin token)
// Server → client
//   fm:state  {s, now}                   public state (owner keys swapped for tags)
//   fm:err    {op, msg}                  to the sender only
//   fm:ok     {op}
//
// Every connection is rate- and size-limited. Pure (no partykit imports):
// the webapp's tests and its offline mode (?offline=1) run it in memory.

import {
  addEntry,
  addSet,
  advance,
  cancelSet,
  emptyFmState,
  loadState,
  moveEntry,
  nextChange,
  ownerTag,
  removeEntry,
  skipCurrent,
  type FmState,
} from './fmStation';

export interface FmConn {
  id: string;
  send(msg: string): void;
}

export const FM_MAX_MSG = 3_000;
export const FM_MAX_SET_MSG = 24_000;
const RATE = 4; // msgs / s sustained
const BURST = 12;
const KEY_RE = /^[\w-]{16,64}$/;

// Timers exist in workers and browsers; the party tsconfig has no DOM lib
const timers = globalThis as unknown as {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(h: unknown): void;
};

export interface FmRelayOptions {
  /** Every open connection (for broadcasts). */
  conns: () => Iterable<FmConn>;
  now?: () => number;
  /** Optional owner/admin token (env FM_ADMIN_TOKEN): skip anything, cancel any set. */
  adminToken?: string;
  /** Persist a snapshot (PartyKit storage). */
  save?: (snapshot: FmState) => void;
  /** Timers (injectable for tests); default setTimeout / clearTimeout. */
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (h: unknown) => void;
}

export class FmRelay {
  state: FmState = emptyFmState();
  private keys = new Map<string, string>();
  private buckets = new Map<string, { tokens: number; at: number }>();
  private seq = 0;
  private timer: unknown = null;
  private now: () => number;
  private o: FmRelayOptions;

  constructor(o: FmRelayOptions) {
    this.o = o;
    this.now = o.now ?? Date.now;
  }

  /** Restore a stored snapshot (validated). */
  load(snapshot: unknown) {
    const s = loadState(snapshot);
    if (s !== null) this.state = s;
    advance(this.state, this.now());
    this.schedule();
  }

  /** Public view: owner keys replaced by their tags. */
  publicState(): FmState {
    const s = this.state;
    return {
      freeAt: s.freeAt,
      queue: s.queue.map(e => ({ ...e, owner: ownerTag(e.owner) })),
      current:
        s.current === null
          ? null
          : {
              startAt: s.current.startAt,
              entry: { ...s.current.entry, owner: ownerTag(s.current.entry.owner) },
            },
      sets: s.sets.map(x => ({ ...x, owner: ownerTag(x.owner) })),
    };
  }

  private stateMsg(): string {
    return JSON.stringify({ type: 'fm:state', s: this.publicState(), now: this.now() });
  }

  private broadcast() {
    const m = this.stateMsg();
    for (const c of this.o.conns()) if (this.keys.has(c.id)) c.send(m);
  }

  private allow(id: string): boolean {
    const t = this.now();
    const b = this.buckets.get(id) ?? { tokens: BURST, at: t };
    b.tokens = Math.min(BURST, b.tokens + ((t - b.at) / 1000) * RATE);
    b.at = t;
    this.buckets.set(id, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  private admin(token: unknown): boolean {
    const a = this.o.adminToken;
    return typeof a === 'string' && a.length >= 12 && token === a;
  }

  /**
   * One `fm:*` message (already parsed, `size` = raw length). Returns false
   * when it was dropped before handling (size / rate / shape).
   */
  handle(d: Record<string, unknown>, size: number, from: FmConn): boolean {
    const type = d.type;
    if (typeof type !== 'string') return false;
    if (size > (type === 'fm:set' ? FM_MAX_SET_MSG : FM_MAX_MSG)) return false;
    if (!this.allow(from.id)) return false;
    const now = this.now();
    const err = (msg: string) => from.send(JSON.stringify({ type: 'fm:err', op: type, msg }));
    if (type === 'fm:ping') {
      const t = Number(d.t);
      if (Number.isFinite(t)) from.send(JSON.stringify({ type: 'fm:pong', t, s: now }));
      return true;
    }
    if (type === 'fm:hello') {
      if (typeof d.key !== 'string' || !KEY_RE.test(d.key)) {
        err('bad key');
        return true;
      }
      this.keys.set(from.id, d.key);
      advance(this.state, now);
      from.send(this.stateMsg());
      return true;
    }
    // Every client message carries its key too, so a connection the relay
    // has forgotten (room restart, eviction) re-identifies itself in place
    if (!this.keys.has(from.id) && typeof d.key === 'string' && KEY_RE.test(d.key))
      this.keys.set(from.id, d.key);
    const key = this.keys.get(from.id);
    if (key === undefined) {
      err('say fm:hello first');
      return true;
    }
    const id = () => `${now.toString(36)}${(this.seq++).toString(36)}`;
    let e: string | null;
    switch (type) {
      case 'fm:add':
        e = addEntry(this.state, d.track, key, d.by, now, id());
        break;
      case 'fm:remove':
        e = typeof d.id === 'string' ? removeEntry(this.state, d.id, key) : 'bad id';
        break;
      case 'fm:move':
        e = typeof d.id === 'string' ? moveEntry(this.state, d.id, key, Number(d.dir)) : 'bad id';
        break;
      case 'fm:skip':
        e = skipCurrent(this.state, this.admin(d.token) ? null : key, now);
        break;
      case 'fm:set':
        e = addSet(this.state, d, key, now, id());
        break;
      case 'fm:unset':
        e =
          typeof d.id === 'string'
            ? cancelSet(this.state, d.id, this.admin(d.token) ? null : key, now)
            : 'bad id';
        break;
      default:
        return false;
    }
    if (e !== null) {
      err(e);
      return true;
    }
    from.send(JSON.stringify({ type: 'fm:ok', op: type }));
    this.changed();
    return true;
  }

  /** Raw text in (size check before parsing). */
  message(raw: string, from: FmConn): boolean {
    if (raw.length > FM_MAX_SET_MSG) return false;
    let d: unknown;
    try {
      d = JSON.parse(raw);
    } catch {
      return false;
    }
    if (typeof d !== 'object' || d === null) return false;
    return this.handle(d as Record<string, unknown>, raw.length, from);
  }

  close(id: string) {
    this.keys.delete(id);
    this.buckets.delete(id);
  }

  private changed() {
    this.o.save?.(this.state);
    this.broadcast();
    this.schedule();
  }

  /** Move the timeline on (timer); broadcasts + saves if anything changed. */
  tick() {
    this.timer = null;
    if (advance(this.state, this.now())) this.changed();
    else this.schedule();
  }

  private schedule() {
    const clear = this.o.clearTimer ?? ((h: unknown) => timers.clearTimeout(h));
    const set = this.o.setTimer ?? ((fn: () => void, ms: number) => timers.setTimeout(fn, ms));
    if (this.timer !== null) clear(this.timer);
    this.timer = null;
    const now = this.now();
    const at = nextChange(this.state, now);
    if (at === null) return;
    this.timer = set(() => this.tick(), Math.min(2 ** 31 - 1, Math.max(250, at - now + 50)));
  }

  dispose() {
    if (this.timer !== null)
      (this.o.clearTimer ?? ((h: unknown) => timers.clearTimeout(h)))(this.timer);
    this.timer = null;
  }
}
