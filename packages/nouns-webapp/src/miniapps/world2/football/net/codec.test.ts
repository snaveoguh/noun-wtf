import { describe, expect, it } from 'vitest';

import { NO_PAD, type FootballEvent, type SimState } from '../contract';

import {
  ACTIONS,
  compactPad,
  decodeState,
  encodeBytes,
  encodeState,
  packEvents,
  readMsg,
  sanitizePad,
  unpackEvents,
  type TimedEvent,
} from './codec';
import { StubSim, stubConfig } from './stubSim';

const cfg = stubConfig(11, [
  ['alice', 0],
  ['bob', 1],
]);

/** A busy 11-a-side state: every field set to something awkward. */
function busyState(): SimState {
  const sim = new StubSim(cfg);
  for (let i = 0; i < 30; i++) sim.step({ alice: { ...NO_PAD, mx: 1, sprint: true } });
  const s = sim.state();
  s.players.forEach((p, i) => {
    p.x = -50.123 + i * 4.567;
    p.z = 33.333 - i * 2.71;
    p.y = (i % 5) * 0.37;
    p.vx = -8.4 + i * 0.77;
    p.vz = 9.99 - i * 0.9;
    p.yaw = -Math.PI + i * 0.31;
    p.action = ACTIONS[i % ACTIONS.length];
    p.actionT = (i * 0.137) % 1;
    p.stamina = 1 - i * 0.04;
    p.yellow = i % 2;
    if (i === 3) p.off = true;
    if (i === 5) p.actionDir = -1;
    if (i === 6) p.actionDir = 2.5;
  });
  s.clock = 5432.1;
  s.added = 180;
  s.phase = 'restart';
  s.phaseT = 2.34;
  s.score = [3, 2];
  s.poss = 1;
  s.attackPlusZ = 1;
  s.restart = { kind: 'free_kick', team: 1, x: 12.3, z: -40.4, taker: 't1p9', direct: false };
  Object.assign(s.ball, {
    x: 30.1,
    y: 4.56,
    z: -51.2,
    vx: 22.2,
    vy: -3.3,
    vz: 31.4,
    wx: 1.5,
    wy: -12.5,
    wz: 0.25,
    mode: 'free',
    owner: null,
    lastTouch: 't1p9',
  });
  s.charge = { alice: { power: 0.62, kind: 'through' } };
  s.goals = [
    { team: 0, scorer: 't0p9', assist: 't0p7', minute: 12, ownGoal: false, penalty: false },
    { team: 1, scorer: 't0p2', assist: null, minute: 77, ownGoal: true, penalty: false },
    { team: 0, scorer: 't0p10', assist: null, minute: 89, ownGoal: false, penalty: true },
  ];
  s.shootout = {
    kicks: [
      [true, false, true, true, true, false, true, true, true],
      [true, true],
    ],
    next: 1,
  };
  s.stats[0].poss = 81234;
  s.stats[1].shots = 9;
  s.stats[1].saves = 4;
  return s;
}

describe('football codec', () => {
  it('roundtrips a state within the quantisation bounds', () => {
    const s = busyState();
    const dec = decodeState(encodeState(s, cfg, [65535, 12]), cfg)!;
    expect(dec).not.toBeNull();
    const d = dec.state;
    expect(dec.acks).toEqual([65535, 12]);
    expect(d.tick).toBe(s.tick);
    expect(d.time).toBeCloseTo(s.time, 3);
    expect(d.clock).toBeCloseTo(s.clock, 2);
    expect(d.added).toBeCloseTo(s.added, 1);
    expect(d.phase).toBe('restart');
    expect(d.period).toBe(s.period);
    expect(d.phaseT).toBeCloseTo(2.34, 2);
    expect(d.score).toEqual([3, 2]);
    expect(d.poss).toBe(1);
    expect(d.attackPlusZ).toBe(1);
    expect(d.restart).toEqual({
      kind: 'free_kick',
      team: 1,
      x: 12.3,
      z: -40.4,
      taker: 't1p9',
      direct: false,
    });
    for (const k of ['x', 'y', 'z', 'vx', 'vy', 'vz', 'wx', 'wy', 'wz'] as const)
      expect(Math.abs(d.ball[k] - s.ball[k])).toBeLessThanOrEqual(0.005 + 1e-9);
    expect(d.ball.mode).toBe('free');
    expect(d.ball.owner).toBeNull();
    expect(d.ball.lastTouch).toBe('t1p9');
    expect(d.players.length).toBe(22);
    s.players.forEach((p, i) => {
      const q = d.players[i];
      expect(q.id).toBe(p.id);
      expect(q.team).toBe(p.team);
      expect(Math.abs(q.x - p.x)).toBeLessThanOrEqual(0.005 + 1e-9);
      expect(Math.abs(q.z - p.z)).toBeLessThanOrEqual(0.005 + 1e-9);
      expect(Math.abs(q.y - p.y)).toBeLessThanOrEqual(0.01 + 1e-9);
      expect(Math.abs(q.vx - p.vx)).toBeLessThanOrEqual(0.005 + 1e-9);
      expect(Math.abs(q.vz - p.vz)).toBeLessThanOrEqual(0.005 + 1e-9);
      let dy = Math.abs(q.yaw - p.yaw) % (Math.PI * 2);
      if (dy > Math.PI) dy = Math.PI * 2 - dy;
      expect(dy).toBeLessThan((0.5 * Math.PI) / 180);
      expect(q.action).toBe(p.action);
      expect(Math.abs(q.actionT - p.actionT)).toBeLessThanOrEqual(0.5 / 255 + 1e-9);
      expect(Math.abs(q.stamina - p.stamina)).toBeLessThanOrEqual(0.5 / 255 + 1e-9);
      expect(q.yellow).toBe(p.yellow);
      expect(q.off === true).toBe(p.off === true);
      expect(q.actionDir).toBe(p.actionDir);
      expect(q.human ?? null).toBe(p.human ?? null);
    });
    expect(d.charge.alice!.kind).toBe('through');
    expect(Math.abs(d.charge.alice!.power - 0.62)).toBeLessThan(0.003);
    expect(d.charge.bob).toBeUndefined();
    expect(d.goals).toEqual(s.goals);
    expect(d.shootout).toEqual(s.shootout);
    expect(d.stats).toEqual(s.stats);
    expect(d.sim).toBeUndefined();
    expect(d.events).toEqual([]);
  });

  it('keeps an 11-a-side snapshot under budget', () => {
    const s = busyState();
    const bytes = encodeBytes(s, cfg, [1, 2]).length;
    const b64 = encodeState(s, cfg, [1, 2]).length;
    const plain = new StubSim(cfg).state();
    const plainBytes = encodeBytes(plain, cfg).length;

    console.log(`11-a-side snapshot: ${plainBytes} B plain, ${bytes} B busy, ${b64} chars base64`);
    expect(b64).toBeLessThan(1200);
    expect(bytes).toBeLessThan(900);
  });

  it('rejects junk and wrong configs', () => {
    expect(decodeState('!!!', cfg)).toBeNull();
    expect(decodeState('', cfg)).toBeNull();
    const d = encodeState(busyState(), cfg);
    expect(decodeState(d.slice(0, d.length - 8), cfg)).toBeNull();
    expect(decodeState(d, stubConfig(5))).toBeNull();
  });

  it('packs events compactly and back, with seq + tick', () => {
    const evs: FootballEvent[] = [
      { type: 'kick', id: 't0p9', kind: 'through', power: 0.734 },
      { type: 'goal', team: 1, scorer: 't1p10', assist: null, ownGoal: false },
      { type: 'restart', restart: { kind: 'corner', team: 0, x: 34, z: 52.5, taker: 't0p7' } },
      { type: 'switch', human: 'bob', to: 't1p4' },
      { type: 'foul', id: 't1p2', on: 't0p9', x: 1.234, z: -3.5, penalty: true },
      { type: 'final', winner: null, score: [2, 2], pens: [4, 3] },
      { type: 'final', winner: 0, score: [1, 0] },
      { type: 'woodwork', part: 'bar', strength: 0.5 },
      { type: 'touch', id: 'nobody-known', quality: 0.3 },
    ];
    const list: TimedEvent[] = evs.map((ev, i) => ({ seq: 40 + i, tick: 100 + i, ev }));
    const wire = packEvents(list, 110, cfg);
    expect(wire[0]).toBe(40);
    const back = unpackEvents(JSON.parse(JSON.stringify(wire)), 110, cfg);
    expect(back.map(e => e.seq)).toEqual(list.map(e => e.seq));
    expect(back.map(e => e.tick)).toEqual(list.map(e => e.tick));
    expect(back[0].ev).toEqual({ type: 'kick', id: 't0p9', kind: 'through', power: 0.73 });
    expect(back[1].ev).toEqual(evs[1]);
    expect(back[2].ev).toEqual(evs[2]);
    expect(back[3].ev).toEqual(evs[3]);
    expect(back[4].ev).toEqual({ ...evs[4], x: 1.23 });
    expect(back[5].ev).toEqual(evs[5]);
    expect(back[6].ev).toEqual(evs[6]);
    expect(back[7].ev).toEqual(evs[7]);
    expect(back[8].ev).toEqual(evs[8]);
    expect(JSON.stringify(wire).length).toBeLessThan(JSON.stringify(evs).length / 2);
    expect(unpackEvents('nope', 0, cfg)).toEqual([]);
    expect(unpackEvents([3, [999, 0], 'x', [0]], 5, cfg).length).toBe(1);
  });

  it('pads: compact on the wire, sanitised off it', () => {
    const p = { ...NO_PAD, mx: 0.123456, mz: -2, shoot: true };
    const c = compactPad(p);
    expect(c).toEqual({ mx: 0.12, mz: -1, shoot: true });
    expect(sanitizePad(c)).toEqual({ ...NO_PAD, mx: 0.12, mz: -1, shoot: true });
    expect(sanitizePad({ mx: NaN, pass: 'yes' } as never)).toEqual(NO_PAD);
  });

  it('readMsg checks shapes', () => {
    expect(readMsg({ type: 'football:s', gid: 'g', d: 'AA' })).toMatchObject({ d: 'AA' });
    expect(readMsg({ type: 'football:s', d: 'AA' })).toBeNull();
    expect(readMsg({ type: 'pool:s', gid: 'g' })).toBeNull();
    expect(
      readMsg({ type: 'football:input', gid: 'g', id: 'a', seq: 70000, pad: { mx: 3 } }),
    ).toEqual({
      type: 'football:input',
      gid: 'g',
      id: 'a',
      seq: 70000 & 0xffff,
      pad: { ...NO_PAD, mx: 1 },
    });
    expect(readMsg({ type: 'football:start', gid: 'g', host: 'h', config: cfg })).not.toBeNull();
    expect(
      readMsg({ type: 'football:start', gid: 'g', host: 'h', config: { size: 3 } }),
    ).toBeNull();
    expect(
      readMsg({ type: 'football:end', gid: 'g', score: [1, 2], winner: 1, reason: 'bogus' }),
    ).toEqual({
      type: 'football:end',
      gid: 'g',
      score: [1, 2],
      winner: 1,
    });
  });
});
