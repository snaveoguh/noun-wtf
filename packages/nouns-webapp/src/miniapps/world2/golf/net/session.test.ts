// GolfSession: swings via the host, results adopted by clients, CPUs on the host.

import type { GolfConfig, GolfMsg, RoundState, ShotResult, SwingInput } from '../contract';

import { describe, expect, it } from 'vitest';

import { GolfSession, wireState, type GolfTransport, type SessionDeps } from './session';

const config: GolfConfig = {
  gid: 'g1',
  seed: 7,
  holes: [1],
  wind: 0,
  players: [
    { id: 'h', name: 'H', human: true },
    { id: 'c', name: 'C', human: true },
    { id: 'cpu:1', name: 'CPU', human: false, skill: 0.5 },
  ],
};

function state(): RoundState {
  return {
    config,
    hole: 0,
    phase: 'play',
    cur: config.players.map(() => ({ strokes: 0, ball: null, lie: 'tee' as const, holed: false })),
    card: config.players.map(() => [null]),
    turn: 0,
    wind: { x: 0, z: 0 },
    n: 0,
    last: null,
  };
}

const result = (x: number): ShotResult => ({
  path: [
    { x: 0, y: 0, z: 0 },
    { x, y: 0, z: 0 },
  ],
  events: [],
  rest: { x, y: 0, z: 0 },
  lie: 'fairway',
  holed: false,
  carry: x,
  total: x,
  apex: 10,
});

const deps: SessionDeps = {
  simulate: (_s, _by, sw) => result(sw.power * 100),
  apply: (s, by, r) => ({
    ...s,
    n: s.n + 1,
    turn: (s.turn + 1) % s.config.players.length,
    cur: s.cur.map((c, i) =>
      i === by ? { ...c, strokes: c.strokes + 1, ball: r.rest, lie: r.lie } : c,
    ),
  }),
  cpu: () => ({ club: '7i', aim: 0, power: 0.5, accuracy: 0 }),
};

function net() {
  const sent: { from: string; m: GolfMsg }[] = [];
  const t = (id: string): GolfTransport => ({
    id,
    online: true,
    send: m => sent.push({ from: id, m }),
  });
  return { sent, t };
}

const swing: SwingInput = { club: 'D', aim: 0, power: 1, accuracy: 0 };

describe('GolfSession', () => {
  it('the host plays its own swing and sends the swing + state', () => {
    const n = net();
    const host = new GolfSession(config, state(), 'h', n.t('h'), deps);
    const ev: string[] = [];
    host.onEvent = e => ev.push(e.kind);
    expect(host.myTurn).toBe(true);
    host.swing(swing);
    expect(ev).toEqual(['shot', 'state']);
    expect(n.sent.map(s => s.m.type)).toEqual(['golf:shot', 'golf:result']);
    expect(host.state.turn).toBe(1);
  });

  it("a player's swing goes to the host, comes back, and the client adopts the host's state", () => {
    const n = net();
    const host = new GolfSession(config, state(), 'h', n.t('h'), deps);
    const cli = new GolfSession(config, state(), 'h', n.t('c'), deps);
    host.swing(swing);
    // Deliver the host's messages to the client
    const ev: string[] = [];
    cli.onEvent = e => ev.push(e.kind);
    for (const s of n.sent.splice(0)) cli.handle(s.m, s.from);
    expect(ev).toEqual(['shot', 'state']);
    expect(cli.state.turn).toBe(1);
    expect(cli.myTurn).toBe(true);
    cli.swing({ ...swing, power: 0.5 });
    expect(cli.waiting).toBe(true);
    const toHost = n.sent.splice(0);
    expect(toHost[0].m.type).toBe('golf:shot');
    for (const s of toHost) host.handle(s.m, s.from);
    expect(host.state.turn).toBe(2);
    for (const s of n.sent.splice(0)) cli.handle(s.m, s.from);
    expect(cli.waiting).toBe(false);
    expect(cli.state.cur[1].ball?.x).toBe(50);
  });

  it('refuses out-of-turn swings and stale shot numbers', () => {
    const n = net();
    const host = new GolfSession(config, state(), 'h', n.t('h'), deps);
    host.handle({ type: 'golf:shot', gid: 'g1', n: 0, swing }, 'c');
    expect(host.state.n).toBe(0);
    host.swing(swing);
    host.handle({ type: 'golf:shot', gid: 'g1', n: 0, swing }, 'c');
    expect(host.state.n).toBe(1);
  });

  it('the host plays the CPU once per shot', () => {
    const n = net();
    const s0 = { ...state(), turn: 2 };
    const host = new GolfSession(config, s0, 'h', n.t('h'), deps);
    expect(host.cpuTurn).toBe(true);
    host.playCpu();
    host.playCpu();
    expect(host.state.n).toBe(1);
  });

  it('wire state drops the path and rounds positions', () => {
    const s = deps.apply(state(), 0, result(123.45678));
    const w = wireState({
      ...s,
      last: {
        by: 0,
        result: result(1),
        penalty: 0,
        next: { x: 0, y: 0, z: 0 },
        nextLie: 'fairway',
      },
    });
    expect(w.last?.result.path.length).toBe(0);
    expect(w.cur[0].ball?.x).toBe(123.457);
  });
});
