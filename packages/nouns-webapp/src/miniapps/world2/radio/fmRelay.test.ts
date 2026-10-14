// NOUN FM PartyKit relay (packages/nouns-party/src/fmRelay.ts) in memory:
// hello, limits, ownership via tags, admin token, timers, persistence, and
// the offline transport running the same relay.

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  FM_MAX_MSG,
  FM_MAX_SET_MSG,
  FmRelay,
  type FmConn,
} from '../../../../../nouns-party/src/fmRelay';
import { FM_GAP_MS, ownerTag, type FmTrack } from '../../../../../nouns-party/src/fmStation';

import { localTransport } from './transport';

const T0 = Date.UTC(2026, 9, 14, 18, 0, 0);
const KA = 'alice_key_0123456789abcdef';
const KB = 'bob_key_0123456789abcdefgh';

const track = (name: string, dur = 90): FmTrack => ({
  src: { kind: 'direct', url: `https://cdn.example.org/${name}.mp3` },
  title: name,
  artist: 'x',
  dur,
});

function rig(opts: { adminToken?: string } = {}) {
  let now = T0;
  const timers: { at: number; fn: () => void }[] = [];
  const saved: unknown[] = [];
  const conns: (FmConn & { inbox: Record<string, unknown>[] })[] = [];
  const relay = new FmRelay({
    conns: () => conns,
    now: () => now,
    adminToken: opts.adminToken,
    save: s => saved.push(JSON.parse(JSON.stringify(s))),
    setTimer: (fn, ms) => {
      const t = { at: now + ms, fn };
      timers.push(t);
      return t;
    },
    clearTimer: h => {
      const i = timers.indexOf(h as (typeof timers)[number]);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  const join = (id: string) => {
    const c = {
      id,
      inbox: [] as Record<string, unknown>[],
      send(m: string) {
        c.inbox.push(JSON.parse(m) as Record<string, unknown>);
      },
    };
    conns.push(c);
    return c;
  };
  const say = (c: FmConn, m: Record<string, unknown>) => relay.message(JSON.stringify(m), c);
  const last = (c: { inbox: Record<string, unknown>[] }, type: string) =>
    [...c.inbox].reverse().find(m => m.type === type);
  const advanceTo = (t: number) => {
    now = t;
    for (;;) {
      timers.sort((a, b) => a.at - b.at);
      const next = timers[0];
      if (next === undefined || next.at > now) break;
      timers.shift();
      next.fn();
    }
  };
  return { relay, join, say, last, saved, timers, advanceTo, setNow: (t: number) => (now = t) };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('FmRelay', () => {
  it('needs a hello with a sane key before anything else', () => {
    const r = rig();
    const a = r.join('a');
    r.say(a, { type: 'fm:add', track: track('x'), by: 'alice' });
    expect(r.last(a, 'fm:err')?.msg).toMatch(/hello/);
    r.say(a, { type: 'fm:hello', key: 'short' });
    expect(r.last(a, 'fm:err')?.msg).toMatch(/bad key/);
    r.say(a, { type: 'fm:hello', key: KA });
    expect(r.last(a, 'fm:state')).toBeDefined();
  });

  it('broadcasts state with owner tags, never the private keys', () => {
    const r = rig();
    const a = r.join('a');
    const b = r.join('b');
    r.say(a, { type: 'fm:hello', key: KA });
    r.say(b, { type: 'fm:hello', key: KB });
    r.say(a, { type: 'fm:add', track: track('one'), by: '<i>alice</i>' });
    expect(r.last(a, 'fm:ok')?.op).toBe('fm:add');
    const st = r.last(b, 'fm:state') as {
      s: { current: { entry: { owner: string; by: string } } };
      now: number;
    };
    expect(st.s.current.entry.owner).toBe(ownerTag(KA));
    expect(st.s.current.entry.by).toBe('ialicei');
    expect(st.now).toBe(T0);
    expect(JSON.stringify(b.inbox)).not.toContain(KA);
    // bob can't remove alice's entry
    r.say(a, { type: 'fm:add', track: track('two'), by: 'alice' });
    const id = (r.last(b, 'fm:state') as { s: { queue: { id: string }[] } }).s.queue[0]!.id;
    r.say(b, { type: 'fm:remove', id });
    expect(r.last(b, 'fm:err')?.msg).toMatch(/own/);
    r.say(a, { type: 'fm:remove', id });
    expect(r.last(a, 'fm:ok')?.op).toBe('fm:remove');
  });

  it('rejects bad tracks: rippers, unknown hosts, over-long', () => {
    const r = rig();
    const a = r.join('a');
    r.say(a, { type: 'fm:hello', key: KA });
    r.say(a, {
      type: 'fm:add',
      track: { ...track('x'), src: { kind: 'direct', url: 'https://x.googlevideo.com/v.mp3' } },
    });
    expect(r.last(a, 'fm:err')?.msg).toMatch(/not allowed/);
    r.say(a, {
      type: 'fm:add',
      track: { ...track('x'), src: { kind: 'direct', url: 'https://example.org/page' } },
    });
    expect(r.last(a, 'fm:err')?.msg).toMatch(/not allowed/);
    r.say(a, { type: 'fm:add', track: track('long', 4000) });
    expect(r.last(a, 'fm:err')?.msg).toMatch(/capped/);
  });

  it('size-limits messages (bigger allowance for a set) and drops non-JSON', () => {
    const r = rig();
    const a = r.join('a');
    r.say(a, { type: 'fm:hello', key: KA });
    const big = 'x'.repeat(FM_MAX_MSG);
    expect(r.say(a, { type: 'fm:add', track: track('x'), by: big })).toBe(false);
    expect(r.relay.handle({ type: 'fm:set' }, FM_MAX_SET_MSG + 1, a)).toBe(false);
    expect(r.relay.message('{nope', a)).toBe(false);
    expect(r.relay.message('x'.repeat(FM_MAX_SET_MSG + 1), a)).toBe(false);
    expect(r.say(a, { type: 'fm:what' })).toBe(false);
  });

  it('rate-limits each connection (burst, then a few a second)', () => {
    const r = rig();
    const a = r.join('a');
    const b = r.join('b');
    let ok = 0;
    for (let i = 0; i < 40; i++) if (r.say(a, { type: 'fm:ping', t: i })) ok++;
    expect(ok).toBe(12);
    // another rider is unaffected
    expect(r.say(b, { type: 'fm:ping', t: 1 })).toBe(true);
    // refills over time
    r.setNow(T0 + 1000);
    let more = 0;
    for (let i = 0; i < 10; i++) if (r.say(a, { type: 'fm:ping', t: i })) more++;
    expect(more).toBe(4);
  });

  it('ping → pong carries the server clock', () => {
    const r = rig();
    const a = r.join('a');
    r.say(a, { type: 'fm:ping', t: 123 });
    expect(r.last(a, 'fm:pong')).toEqual({ type: 'fm:pong', t: 123, s: T0 });
  });

  it('wakes at each track boundary and tells everyone', () => {
    const r = rig();
    const a = r.join('a');
    r.say(a, { type: 'fm:hello', key: KA });
    r.say(a, { type: 'fm:add', track: track('one', 60), by: 'a' });
    r.say(a, { type: 'fm:add', track: track('two', 60), by: 'a' });
    const before = a.inbox.length;
    r.advanceTo(T0 + FM_GAP_MS + 60_000 + 100);
    const st = r.last(a, 'fm:state') as { s: { current: { entry: { title: string } } } };
    expect(a.inbox.length).toBeGreaterThan(before);
    expect(st.s.current.entry.title).toBe('two');
  });

  it('admin token skips anyone and cancels any set; weak or missing token does nothing', () => {
    const r = rig({ adminToken: 'super-secret-token' });
    const a = r.join('a');
    const m = r.join('m');
    r.say(a, { type: 'fm:hello', key: KA });
    r.say(m, { type: 'fm:hello', key: KB });
    r.say(a, { type: 'fm:add', track: track('one'), by: 'a' });
    r.say(m, { type: 'fm:skip', token: 'wrong' });
    expect(r.last(m, 'fm:err')?.msg).toMatch(/only whoever/);
    r.say(m, { type: 'fm:skip', token: 'super-secret-token' });
    expect(r.last(m, 'fm:ok')?.op).toBe('fm:skip');
    expect(r.relay.state.current).toBeNull();
    // no admin at all when the env token is short / unset
    const r2 = rig({ adminToken: 'short' });
    const c = r2.join('c');
    r2.say(c, { type: 'fm:hello', key: KA });
    r2.say(c, { type: 'fm:skip', token: 'short' });
    expect(r2.last(c, 'fm:err')).toBeDefined();
  });

  it('books a set and persists every change; a fresh relay loads it back', () => {
    const r = rig();
    const a = r.join('a');
    r.say(a, { type: 'fm:hello', key: KA });
    r.say(a, {
      type: 'fm:set',
      dj: 'DJ A',
      name: 'tea time',
      startAt: T0 + 3600_000,
      tracks: [track('s1'), track('s2')],
    });
    expect(r.last(a, 'fm:ok')?.op).toBe('fm:set');
    expect(r.saved.length).toBe(1);
    const fresh = new FmRelay({
      conns: () => [],
      now: () => T0,
      setTimer: () => 0,
      clearTimer: () => undefined,
    });
    fresh.load(r.saved[0]);
    expect(fresh.state.sets[0]).toMatchObject({ dj: 'DJ A', name: 'tea time', owner: KA });
    expect(fresh.publicState().sets[0]!.owner).toBe(ownerTag(KA));
  });

  it('forgets a closed connection (it must hello again)', () => {
    const r = rig();
    const a = r.join('a');
    r.say(a, { type: 'fm:hello', key: KA });
    r.relay.close('a');
    r.say(a, { type: 'fm:add', track: track('x'), by: 'a' });
    expect(r.last(a, 'fm:err')?.msg).toMatch(/hello/);
  });
});

describe('offline transport', () => {
  it('runs the relay in this tab, no sockets, and keeps the station in localStorage', async () => {
    localStorage.clear();
    const t = localTransport();
    const got: Record<string, unknown>[] = [];
    t.onMessage = m => got.push(m);
    expect(t.ready).toBe(true);
    expect(t.offline).toBe(true);
    t.send({ type: 'fm:hello', key: KA });
    t.send({ type: 'fm:add', track: track('local'), by: 'me' });
    await Promise.resolve();
    await Promise.resolve();
    expect(got.some(m => m.type === 'fm:ok')).toBe(true);
    t.dispose();
    const t2 = localTransport();
    expect(t2.relay.state.current?.entry.title ?? t2.relay.state.queue[0]?.title).toBe('local');
    t2.dispose();
  });
});
