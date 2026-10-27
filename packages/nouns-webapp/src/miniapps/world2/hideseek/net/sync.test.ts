// Hide & seek over a loopback through the real relay: the lobby (host,
// join, start), then HideSeekSessions on both ends: snapshots, the host
// checking tags against its own positions, whistles, CPU players, drops
// and the host leaving.

import type { HsConfig, HsMsg } from '../contract';
import type { Vec } from '../rules';

import { beforeEach, describe, expect, it } from 'vitest';

import { HideSeekRelay, type RelayConn } from '../../../../../../nouns-party/src/hideseekRelay';
import { makeGrid } from '../nav';

import { readMsg } from './codec';
import { HideSeekLobby } from './lobby';
import { HideSeekSession, HOST_LOST_MS } from './sync';

let now = 0;
let relay: HideSeekRelay;
let conns: RelayConn[];
const queues = new Map<string, HsMsg[]>();

function connect(id: string) {
  queues.set(id, []);
  conns.push({
    id,
    send: s => {
      const m = readMsg(JSON.parse(s));
      if (m !== null) queues.get(id)!.push(m);
    },
  });
}
const sender = (id: string) => (m: HsMsg) =>
  relay.handle(JSON.parse(JSON.stringify(m)), conns.find(c => c.id === id)!, conns);

function lobbyFor(id: string, name: string) {
  return new HideSeekLobby({
    myId: () => id,
    myName: () => name,
    mySeed: () => '1-1-1-1-1',
    nameOf: x => x.toUpperCase(),
    seedOf: () => undefined,
    cpuSeed: () => '2-2-2-2-2',
    send: sender(id),
    now: () => now,
  });
}

/** Deliver everything queued for `id` to a handler. */
function deliver(id: string, fn: (m: HsMsg) => void) {
  const q = queues.get(id)!;
  while (q.length > 0) fn(q.shift()!);
}

const pos: Record<string, Vec> = {};
/** A flat yard with a wall at x = 10 to hide behind. */
const GRID = makeGrid(-20, -20, 21, 21, 2, x => (Math.abs(x - 10) < 1 ? 3 : 0));

function session(id: string, role: 'host' | 'client', config: HsConfig, hostId = 'h') {
  return new HideSeekSession({
    config,
    role,
    me: id,
    hostId,
    send: sender(id),
    pos: x => pos[x] ?? null,
    los: () => true,
    door: () => null,
    blending: () => false,
    grid: () => GRID,
    slot: (i, n) => ({ x: i * 3 - n, y: 0, z: 0, yaw: 0 }),
    lobby: { x: 0, y: 0, z: 0 },
    now: () => now,
  });
}

beforeEach(() => {
  now = 0;
  relay = new HideSeekRelay();
  conns = [];
  queues.clear();
  for (const id of ['h', 'a', 'b', 'x']) connect(id);
  for (const k of Object.keys(pos)) delete pos[k];
});

/** Host h, joiners a and b: through the lobby to START. Returns both ends' configs. */
function startGame(o: { cpu?: number } = {}) {
  const lh = lobbyFor('h', 'Hana');
  const la = lobbyFor('a', 'Abe');
  const lb = lobbyFor('b', 'Bo');
  lh.host({ cpu: o.cpu ?? 0, seekers: 1, rounds: 2, gid: 'g1' });
  // a and b hear the announcement, join
  deliver('a', m => la.onMessage(m));
  deliver('b', m => lb.onMessage(m));
  expect(la.open.get('g1')?.hostName).toBe('Hana');
  expect(la.join('g1')).toBe(true);
  expect(lb.join('g1')).toBe(true);
  deliver('h', m => lh.onMessage(m));
  const ra = [] as unknown[];
  deliver('a', m => ra.push(la.onMessage(m)));
  deliver('b', m => lb.onMessage(m));
  expect(ra).toContainEqual({ kind: 'joined', gid: 'g1', host: 'h' });
  expect(lh.hosting!.players.map(p => p.id)).toEqual(['h', 'a', 'b']);
  const cfg = lh.start({ seed: 5, skill: 0.5, first: ['h'], hideS: 5, seekS: 30 })!;
  let ca: HsConfig | null = null;
  let cb: HsConfig | null = null;
  deliver('a', m => {
    const r = la.onMessage(m);
    if (r?.kind === 'start') ca = r.config;
  });
  deliver('b', m => {
    const r = lb.onMessage(m);
    if (r?.kind === 'start') cb = r.config;
  });
  expect(ca).toEqual(cfg);
  expect(cb).toEqual(cfg);
  // The bystander heard about the game but never got the start
  expect(queues.get('x')!.every(m => m.type === 'hideseek:lobby')).toBe(true);
  return { cfg, lh, la, lb };
}

function tickAll(secs: number, ss: Record<string, HideSeekSession>) {
  for (let t = 0; t < secs - 1e-9; t += 0.05) {
    now += 50;
    for (const [id, s] of Object.entries(ss)) {
      deliver(id, m => s.onMessage(m));
      s.update(0.05);
    }
  }
  for (const [id, s] of Object.entries(ss)) deliver(id, m => s.onMessage(m));
}

describe('hide & seek over the relay', () => {
  it('lobby → start → snapshots: everyone sees the same roles and clock', () => {
    const { cfg } = startGame();
    const H = session('h', 'host', cfg);
    const A = session('a', 'client', cfg);
    const B = session('b', 'client', cfg);
    tickAll(1, { h: H, a: A, b: B });
    expect(H.view.st.get('h')).toBe('s');
    expect(A.view.st).toEqual(H.view.st);
    expect(B.myStanding()).toBe('h');
    expect(Math.abs(A.view.t - H.view.t)).toBeLessThan(0.5);
    tickAll(4.5, { h: H, a: A, b: B });
    expect(A.view.phase).toBe('seek');
    expect(H.stats.snapBytes).toBeGreaterThan(0);
    expect(H.stats.snapBytes).toBeLessThan(4000);
  });

  it('the host decides tags from its own view of the positions', () => {
    const { cfg } = startGame();
    pos.h = { x: 0, y: 0, z: 0 };
    pos.a = { x: 20, y: 0, z: 0 };
    pos.b = { x: -20, y: 0, z: 0 };
    const H = session('h', 'host', cfg);
    const A = session('a', 'client', cfg);
    const B = session('b', 'client', cfg);
    tickAll(5.2, { h: H, a: A, b: B });
    expect(H.view.phase).toBe('seek');
    // Far away: nothing happens
    H.act('tag', 'a');
    tickAll(0.6, { h: H, a: A, b: B });
    expect(A.myStanding()).toBe('h');
    // Close: found, and the found hider seeks
    pos.h = { x: 19, y: 0, z: 0 };
    H.act('tag', 'a');
    tickAll(0.3, { h: H, a: A, b: B });
    expect(A.myStanding()).toBe('f');
    expect(B.view.st.get('a')).toBe('f');
    // a (now seeking) claims to tag b from across the map: the host says no
    A.act('tag', 'b');
    tickAll(0.6, { h: H, a: A, b: B });
    expect(B.myStanding()).toBe('h');
    expect(H.stats.rejected).toBeGreaterThan(0);
    // a really gets there: found; everyone found → seekers win
    pos.a = { x: -21, y: 0, z: 1 };
    A.act('tag', 'b');
    tickAll(0.3, { h: H, a: A, b: B });
    expect(B.view.win).toBe('seekers');
    expect(B.view.phase).toBe('reveal');
    expect(B.view.reveal?.find(r => r.id === 'b')).toMatchObject({ x: -20, st: 'f' });
  });

  it("a hider can't tag, nobody can act as someone else", () => {
    const { cfg } = startGame();
    pos.h = { x: 0, y: 0, z: 0 };
    pos.a = { x: 1, y: 0, z: 0 };
    pos.b = { x: 1.5, y: 0, z: 0 };
    const H = session('h', 'host', cfg);
    const A = session('a', 'client', cfg);
    const B = session('b', 'client', cfg);
    tickAll(5.2, { h: H, a: A, b: B });
    B.act('tag', 'a');
    // Forged: the relay rewrites `from` to the real sender
    sender('b')({ type: 'hideseek:act', gid: 'g1', a: 'tag', target: 'a', from: 'h' });
    tickAll(0.5, { h: H, a: A, b: B });
    expect(A.myStanding()).toBe('h');
  });

  it('whistles reach everyone as events', () => {
    const { cfg } = startGame();
    const H = session('h', 'host', cfg);
    const A = session('a', 'client', cfg);
    const B = session('b', 'client', cfg);
    const heard: string[] = [];
    B.onEvent = e => {
      if (e.k === 'whistle') heard.push(e.id);
    };
    tickAll(5.2, { h: H, a: A, b: B });
    A.act('whistle');
    tickAll(0.5, { h: H, a: A, b: B });
    expect(heard).toEqual(['a']);
    expect(A.view.scores.get('a')).toBe(2);
  });

  it('CPU players are run by the host and drawn by the clients', () => {
    const { cfg } = startGame({ cpu: 2 });
    expect(cfg.players.filter(p => p.cpu)).toHaveLength(2);
    const H = session('h', 'host', cfg);
    const A = session('a', 'client', cfg);
    tickAll(3, { h: H, a: A });
    const hb = H.botPoses();
    const ab = A.botPoses();
    expect(hb).toHaveLength(2);
    expect(ab.map(b => b.id).sort()).toEqual(['cpu:0', 'cpu:1']);
    // Hiding bots are on the move
    expect(
      hb.some(b => Math.hypot(b.x - (cfg.players.findIndex(p => p.id === b.id) * 3 - 5), b.z) > 1),
    ).toBe(true);
  });

  it('a seeker dropping: the host picks a new one', () => {
    const { cfg } = startGame();
    // a seeks first this time
    const c2 = { ...cfg, order: ['a', 'h', 'b'] };
    const H = session('h', 'host', c2);
    const A = session('a', 'client', c2);
    const B = session('b', 'client', c2);
    tickAll(0.5, { h: H, a: A, b: B });
    expect(H.view.st.get('a')).toBe('s');
    relay.close('a', conns);
    tickAll(0.5, { h: H, b: B });
    const sk = [...B.view.st].filter(([, s]) => s === 's').map(([id]) => id);
    expect(sk).toHaveLength(1);
    expect(['h', 'b']).toContain(sk[0]);
    expect(B.view.st.has('a')).toBe(false);
  });

  it('the host leaving ends the game for everyone', () => {
    const { cfg } = startGame();
    const H = session('h', 'host', cfg);
    const A = session('a', 'client', cfg);
    tickAll(1, { h: H, a: A });
    H.leave();
    tickAll(0.2, { a: A });
    expect(A.ended).toBe('hostLeft');
  });

  it('a host that goes quiet is given up on', () => {
    const { cfg } = startGame();
    const A = session('a', 'client', cfg);
    now += HOST_LOST_MS + 100;
    A.update(0.05);
    expect(A.ended).toBe('hostLost');
  });
});
