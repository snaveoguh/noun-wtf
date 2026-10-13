// Noun Hoops net layer over an in-memory loopback running the real PartyKit
// relay (packages/nouns-party/src/hoopsRelay.ts), with simulated latency.

import type { HoopsTransport } from './transport';
import type { Game } from '../../Game';

import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HoopsRelay } from '../../../../../../nouns-party/src/hoopsRelay';
import { randomSeed } from '../../character/NounAppearance';
import {
  JERSEY_COURT,
  MODE_DEFAULTS,
  NO_INPUT,
  SIM_DT,
  type GameConfig,
  type HoopsMsg,
  type TeamSize,
} from '../contract';

import { decodeState, encodeState, snapshotBytes } from './codec';
import { testCourt } from './court';
import { HoopsMode } from './HoopsMode';
import { StubSim } from './stubSim';
import { HoopsSession } from './sync';

// ── Loopback: sockets → relay → sockets, one-way latency `lat` ms ──

let clock = 0;

class Hub {
  relay = new HoopsRelay();
  conns = new Map<string, Loop>();
  queue: { at: number; to: string; msg: string }[] = [];
  sent = new Map<string, number>();
  constructor(public lat = 40) {}
  connect(id: string) {
    const c = new Loop(this, id);
    this.conns.set(id, c);
    return c;
  }
  wire() {
    return [...this.conns.values()].map(c => ({
      id: c.id,
      send: (msg: string) => this.queue.push({ at: clock + this.lat, to: c.id, msg }),
    }));
  }
  fromClient(id: string, m: HoopsMsg) {
    const s = JSON.stringify(m);
    this.sent.set(m.type, (this.sent.get(m.type) ?? 0) + 1);
    const conns = this.wire();
    const from = conns.find(c => c.id === id)!;
    // Client → server latency, then the relay
    setTimeoutAt(clock + this.lat, () => this.relay.handle(JSON.parse(s), from, this.wire()));
  }
  close(id: string) {
    this.conns.delete(id);
    this.relay.close(id, this.wire());
  }
  pump() {
    runTimers();
    const due = this.queue.filter(q => q.at <= clock);
    this.queue = this.queue.filter(q => q.at > clock);
    for (const q of due) this.conns.get(q.to)?.onMessage?.(JSON.parse(q.msg));
  }
}

const timers: { at: number; fn: () => void }[] = [];
function setTimeoutAt(at: number, fn: () => void) {
  timers.push({ at, fn });
}
function runTimers() {
  timers.sort((a, b) => a.at - b.at);
  while (timers.length > 0 && timers[0].at <= clock) timers.shift()!.fn();
}

class Loop implements HoopsTransport {
  onMessage: ((m: HoopsMsg) => void) | null = null;
  online = true;
  constructor(
    private hub: Hub,
    readonly id: string,
  ) {}
  send(m: HoopsMsg) {
    this.hub.fromClient(this.id, m);
  }
}

function config(size: TeamSize, humans: string[]): GameConfig {
  const players = [];
  for (let i = 0; i < size * 2; i++) {
    const id = humans[i] ?? `bot:${i}`;
    players.push({
      id,
      team: (i % 2) as 0 | 1,
      bot: humans[i] === undefined,
      name: id,
      seedKey: '0-0-0-0-0',
    });
  }
  return { ...MODE_DEFAULTS[size], seed: 7, players, court: JERSEY_COURT, difficulty: 2 };
}

function run(hub: Hub, frames: number, each: (dt: number) => void) {
  const dt = 1 / 60;
  for (let i = 0; i < frames; i++) {
    clock += dt * 1000;
    hub.pump();
    each(dt);
  }
}

beforeEach(() => {
  clock = 0;
  timers.length = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock);
});
afterEach(() => vi.restoreAllMocks());

describe('codec', () => {
  it('round-trips a state within quantisation and stays small', () => {
    const cfg = config(5, ['a', 'b']);
    const sim = new StubSim(cfg);
    for (let i = 0; i < 90; i++) sim.step({ a: { ...NO_INPUT, moveX: 1, sprint: true } });
    const s = sim.state();
    const acks = cfg.players.map((_, i) => i * 7);
    const d = encodeState(s, cfg, acks);
    const back = decodeState(d, cfg)!;
    expect(back.acks).toEqual(acks);
    expect(back.state.phase).toBe(s.phase);
    expect(back.state.ball.holder).toBe(s.ball.holder);
    for (let i = 0; i < s.players.length; i++) {
      const p = s.players[i];
      const q = back.state.players[i];
      expect(q.id).toBe(p.id);
      expect(Math.abs(q.x - p.x)).toBeLessThan(0.006);
      expect(Math.abs(q.z - p.z)).toBeLessThan(0.006);
      expect(Math.abs(Math.atan2(Math.sin(q.yaw - p.yaw), Math.cos(q.yaw - p.yaw)))).toBeLessThan(
        0.02,
      );
      expect(q.hasBall).toBe(p.hasBall);
    }
    expect(snapshotBytes(2)).toBe(63);
    expect(snapshotBytes(6)).toBe(123);
    expect(snapshotBytes(10)).toBe(183);
    expect(d.length).toBe(244);
  });
});

describe('relay', () => {
  it('forwards challenges only to the named player and snapshots only to the game', () => {
    const hub = new Hub(0);
    const inbox = new Map<string, HoopsMsg[]>();
    for (const id of ['a', 'b', 'c']) {
      const l = hub.connect(id);
      inbox.set(id, []);
      l.onMessage = m => inbox.get(id)!.push(m);
    }
    hub.fromClient('a', {
      type: 'hoops:challenge',
      gid: 'g1',
      from: 'x',
      to: 'b',
      size: 1,
      fromName: 'A',
    });
    hub.pump();
    hub.pump();
    expect(inbox.get('b')!.map(m => m.type)).toEqual(['hoops:challenge']);
    expect((inbox.get('b')![0] as { from: string }).from).toBe('a'); // sender rewritten
    expect(inbox.get('c')!).toHaveLength(0);
    hub.fromClient('a', {
      type: 'hoops:start',
      gid: 'g1',
      host: 'a',
      config: config(1, ['a', 'b']),
    });
    hub.fromClient('a', { type: 'hoops:s', gid: 'g1', d: 'x' });
    hub.fromClient('c', { type: 'hoops:s', gid: 'g1', d: 'spoof' }); // not the host: dropped
    hub.fromClient('c', { type: 'hoops:input', gid: 'g1', id: 'c', seq: 1, input: NO_INPUT }); // not a member
    hub.fromClient('b', { type: 'hoops:input', gid: 'g1', id: 'zz', seq: 1, input: NO_INPUT });
    hub.pump();
    hub.pump();
    expect(inbox.get('b')!.map(m => m.type)).toEqual(['hoops:challenge', 'hoops:start', 'hoops:s']);
    expect(inbox.get('c')!).toHaveLength(0);
    const ins = inbox.get('a')!.filter(m => m.type === 'hoops:input');
    expect(ins).toHaveLength(1);
    expect((ins[0] as { id: string }).id).toBe('b');
    // A spectator joins, then the host disconnects: everyone left hears it
    hub.fromClient('c', { type: 'hoops:watch', gid: 'g1', from: 'c' });
    hub.pump();
    hub.pump();
    expect(inbox.get('a')!.some(m => m.type === 'hoops:watch')).toBe(true);
    hub.close('a');
    hub.pump();
    hub.pump();
    expect(inbox.get('b')!.at(-1)).toMatchObject({ type: 'hoops:leave', id: 'a' });
    expect(inbox.get('c')!.at(-1)).toMatchObject({ type: 'hoops:leave', id: 'a' });
    expect(hub.relay.games.size).toBe(0);
  });
});

describe('HoopsSession host + client + spectator', () => {
  it('syncs at 20 Hz, interpolates, predicts and reconciles softly', () => {
    const hub = new Hub(50);
    const cfg = config(3, ['host', 'cli']);
    const tH = hub.connect('host');
    const tC = hub.connect('cli');
    const tS = hub.connect('spec');
    const mk = (t: Loop, role: 'host' | 'client' | 'spectator', me: string | null) => {
      const s = new HoopsSession({
        gid: 'g',
        config: cfg,
        role,
        me,
        hostId: 'host',
        send: m => t.send(m),
        makeSim: c => new StubSim(c),
        now: () => clock,
      });
      t.onMessage = m => s.onMessage(m);
      return s;
    };
    hub.relay.handle(
      { type: 'hoops:start', gid: 'g', host: 'host', config: cfg },
      { id: 'host', send: () => {} },
      hub.wire(),
    );
    hub.relay.handle(
      { type: 'hoops:watch', gid: 'g', from: 'spec' },
      { id: 'spec', send: () => {} },
      hub.wire(),
    );
    hub.queue.length = 0;
    const H = mk(tH, 'host', 'host');
    const C = mk(tC, 'client', 'cli');
    const S = mk(tS, 'spectator', null);
    // 3 s: the client runs +x the whole time
    const push = { ...NO_INPUT, moveX: 1 };
    run(hub, 180, dt => {
      H.update(dt, NO_INPUT);
      C.update(dt, push);
      S.update(dt, NO_INPUT);
    });
    expect(H.stats.snapsSent).toBeGreaterThan(55);
    expect(H.stats.snapsSent).toBeLessThan(65);
    expect(C.stats.snapsRecv).toBeGreaterThan(50);
    expect(S.stats.snapsRecv).toBeGreaterThan(50);
    expect(C.stats.inputsSent).toBeGreaterThan(85);
    expect(C.stats.inputsSent).toBeLessThan(95);
    // Host applied the client's input: it moved +x on the authoritative court
    // (from x = −3; 1 s pregame, then ~2 s at 5 m/s)
    const hostCli = H.sim.state().players.find(p => p.id === 'cli')!;
    expect(hostCli.x).toBeGreaterThan(5);
    // Client prediction runs ahead of the interpolated view, and stays near the host
    const cv = C.render()!;
    const sv = S.render()!;
    const cMe = cv.players.find(p => p.id === 'cli')!;
    const sMe = sv.players.find(p => p.id === 'cli')!;
    expect(cMe.x).toBeGreaterThanOrEqual(sMe.x - 0.01);
    expect(Math.abs(cMe.x - hostCli.x)).toBeLessThan(1.2);
    // Steady state: corrections are small
    expect(C.stats.correction).toBeLessThan(0.5);
    // Spectator: everyone else interpolated close to the host (~100 ms behind)
    const hb = H.sim.state().players.find(p => p.id === 'host')!;
    const sb = sv.players.find(p => p.id === 'host')!;
    expect(Math.hypot(hb.x - sb.x, hb.z - sb.z)).toBeLessThan(1.5);

    console.log(
      `[hoops] 3v3 snapshot ${H.stats.snapBytes} B (max ${H.stats.snapBytesMax}), input ${C.stats.inputBytes} B, ` +
        `${H.stats.snapsSent} snaps / 3 s, last correction ${C.stats.correction.toFixed(3)} m`,
    );
  });

  it('the client is told when the host leaves', () => {
    const hub = new Hub(30);
    const cfg = config(1, ['host', 'cli']);
    const tH = hub.connect('host');
    const tC = hub.connect('cli');
    hub.relay.handle(
      { type: 'hoops:start', gid: 'g', host: 'host', config: cfg },
      { id: 'host', send: () => {} },
      hub.wire(),
    );
    hub.queue.length = 0;
    const C = new HoopsSession({
      gid: 'g',
      config: cfg,
      role: 'client',
      me: 'cli',
      hostId: 'host',
      send: m => tC.send(m),
      makeSim: c => new StubSim(c),
      now: () => clock,
    });
    tC.onMessage = m => C.onMessage(m);
    void tH;
    hub.close('host');
    run(hub, 10, dt => C.update(dt, NO_INPUT));
    expect(C.hostLeft).toBe(true);
    expect(C.over).toBe(true);
  });
});

// ── HoopsMode: the whole challenge flow between two players ──

function fakeGame(name: string, others: Record<string, string>) {
  const scene = new THREE.Scene();
  const me = { root: new THREE.Object3D() };
  return {
    name,
    seed: randomSeed(),
    net: {
      players: new Map(
        Object.entries(others).map(([id, n]) => [id, { id, name: n, seedKey: '1-2-3-4-5' }]),
      ),
    },
    player: { pos: new THREE.Vector3(0, 0, 0) },
    gfx: {
      camera: new THREE.PerspectiveCamera(70, 1, 0.1, 1000),
      scene,
      renderer: { domElement: document.createElement('canvas') },
      toon: false,
    },
    me,
    crew: {
      lent: 0,
      borrow(n: number) {
        this.lent = n;
        return Array.from({ length: Math.min(n, 3) }, (_, i) => ({
          name: `Crew${i}`,
          seed: randomSeed(),
        }));
      },
      giveBack() {
        this.lent = 0;
      },
    },
    mountain: null,
    assets: null,
    audio: { ctx: null },
  };
}

describe('HoopsMode challenge flow', () => {
  it('challenge → accept → teleport → play → host forfeits → client back to skating', () => {
    const hub = new Hub(40);
    const tA = hub.connect('A');
    const tB = hub.connect('B');
    const gA = fakeGame('alice', { B: 'bob' });
    const gB = fakeGame('bob', { A: 'alice' });
    gA.gfx.camera.position.set(1, 2, 3);
    gB.gfx.camera.position.set(-4, 5, -6);
    const A = new HoopsMode(gA as unknown as Game, tA);
    const B = new HoopsMode(gB as unknown as Game, tB);
    A.court = testCourt();
    B.court = testCourt();
    const both = (dt: number) => {
      for (const [h] of [[A], [B]] as const) {
        if (h.active) h.step(dt);
        else h.idle(dt);
      }
    };
    A.challenge('B', 2);
    run(hub, 10, both);
    expect(B.ui.invite).toMatchObject({ from: 'A', fromName: 'alice', size: 2 });
    B.acceptInvite();
    expect(B.ui.teleport).not.toBeNull();
    run(hub, 20, both);
    expect(A.ui.phase).toBe('teleport');
    expect(B.ui.phase).toBe('teleport');
    expect(B.ui.role).toBe('client');
    expect(gB.me.root.visible).toBe(false);
    // 2v2: 2 humans + 2 crew bots (borrowed on the host)
    const cfg = A.session!.config;
    expect(cfg.players.filter(p => p.bot).map(p => p.name)).toEqual(['Crew0', 'Crew1']);
    expect(gA.crew.lent).toBe(2);
    run(hub, 120, both);
    expect(A.ui.phase).toBe('playing');
    expect(B.ui.phase).toBe('playing');
    // B's keyboard reaches the host's sim (D = move right in camera space)
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD' }));
    const x0 = A.session!.sim.state().players.find(p => p.id === 'B')!.x;
    run(hub, 60, both);
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD' }));
    const x1 = A.session!.sim.state().players.find(p => p.id === 'B')!.x;
    const z1 = A.session!.sim.state().players.find(p => p.id === 'B')!.z;
    expect(Math.hypot(x1 - x0, z1)).toBeGreaterThan(1);
    expect(A.ui.snapBytes).toBeGreaterThan(0);
    // Host forfeits: B hears "host left" and is restored
    A.forfeit();
    expect(A.ui.phase).toBe('idle');
    expect(gA.gfx.camera.position.toArray()).toEqual([1, 2, 3]);
    expect(gA.me.root.visible).toBe(true);
    expect(gA.crew.lent).toBe(0);
    run(hub, 10, both);
    expect(B.ui.phase).toBe('idle');
    expect(B.ui.toast?.text).toContain('host left');
    expect(gB.gfx.camera.position.toArray()).toEqual([-4, 5, -6]);
    expect(gB.me.root.visible).toBe(true);
  });

  it('lone human vs bots offline: lobby → 3v3 → game over → results → back', () => {
    const t: HoopsTransport = { id: 'me', online: false, send: () => {}, onMessage: null };
    const g = fakeGame('solo', {});
    const H = new HoopsMode(g as unknown as Game, t);
    H.court = testCourt();
    g.player.pos.set(H.court.cx, 0, H.court.cz);
    H.idle(0.016);
    expect(H.ui.prompt).toEqual({ kind: 'play' });
    H.promptAction();
    expect(H.ui.phase).toBe('lobby');
    H.setMode(3);
    H.setTarget(3);
    H.startLobby();
    expect(H.ui.phase).toBe('playing');
    expect(H.session!.config.players).toHaveLength(6);
    expect(H.session!.config.players.filter(p => !p.bot)).toHaveLength(1);
    // Let the bots play it out
    for (let i = 0; i < 60 * 240 && H.ui.phase === 'playing'; i++) {
      clock += 1000 / 60;
      H.step(SIM_DT);
    }
    expect(H.ui.phase).toBe('results');
    expect(Math.max(...H.ui.results!.score)).toBeGreaterThanOrEqual(3);
    H.backToSkating();
    expect(H.ui.phase).toBe('idle');
    expect(g.me.root.visible).toBe(true);
  });
});
