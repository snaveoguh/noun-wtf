// Noun Breaks wire format: every message round-trips through JSON + readMsg,
// and anything malformed is refused or clamped.

import type { BattleConfig, BreakMsg, SimState } from '../contract';

import { describe, expect, it } from 'vitest';

import { compact, readConfig, readMsg, readState, snapMsg } from './codec';
import { StubSim } from './stubSim';

const CFG: BattleConfig = {
  gid: 'g1',
  seed: 42,
  crewSize: 1,
  dancers: [
    { id: 'a', name: 'Alpha', crew: 0, human: true, seed: { head: 3 } },
    { id: 'cpu:0', name: 'Lil Flare', crew: 1, human: false, skill: 0.6 },
  ],
  rounds: 2,
  turnBars: 4,
  bpm: 100,
};

const wire = (m: BreakMsg) => readMsg(JSON.parse(JSON.stringify(m)));

function playedState(): { state: SimState; sim: StubSim } {
  const sim = new StubSim(CFG);
  for (let i = 0; i < 400; i++) {
    sim.step(1 / 60);
    if (i % 20 === 0) {
      const s = sim.state();
      const p = s.prompts[0];
      if (p !== undefined) sim.input({ id: 'a', key: p.key, t: (p.beat * 60) / 100 + 0.013 });
    }
  }
  return { state: sim.state(), sim };
}

describe('codec', () => {
  it('round-trips every message type', () => {
    const { state } = playedState();
    const msgs: BreakMsg[] = [
      {
        type: 'break:lobby',
        at: true,
        from: 'x',
        name: 'Noun',
        seedKey: '1-2-3-4-5',
        live: { gid: 'g1', crewSize: 2, names: ['a', 'b'] },
      },
      {
        type: 'break:challenge',
        to: 'b',
        from: 'a',
        crewSize: 3,
        gid: 'g1',
        name: 'Alpha',
        crew: 0,
      },
      { type: 'break:reply', to: 'a', from: 'b', ok: true, gid: 'g1' },
      { type: 'break:start', host: 'a', config: CFG, at: -3, lag: 0.15 },
      { type: 'break:input', gid: 'g1', i: { id: 'b', key: 'left', t: 12.345 } },
      {
        type: 'break:s',
        gid: 'g1',
        state: compact(state),
        a: 8.2,
        e: [{ e: 'hit', id: 'a', grade: 'great', key: 'up' }],
      },
      { type: 'break:end', gid: 'g1', winner: 'tie', totals: [10, 10] },
      { type: 'break:watch', gid: 'g1', from: 'c' },
      { type: 'break:leave', gid: 'g1', id: 'b' },
      { type: 'break:ping', gid: 'g1', c: 1234.5, from: 'b' },
      { type: 'break:pong', gid: 'g1', to: 'b', c: 1234.5, a: 3.21 },
    ];
    for (const m of msgs) expect(wire(m)).toEqual(m);
  });

  it('snapshots: rounded to the millisecond, beats left off, small', () => {
    const { state } = playedState();
    state.t += 0.000_123_4;
    const m = snapMsg(
      'g1',
      state,
      [
        { e: 'beat', beat: 3, downbeat: false },
        { e: 'combo', id: 'a', combo: 4 },
      ],
      9.87654,
    );
    if (m.type !== 'break:s') throw new Error('not a snapshot');
    expect(m.e).toEqual([{ e: 'combo', id: 'a', combo: 4 }]);
    expect(m.a).toBe(9.877);
    expect(m.state.t).toBe(Math.round(state.t * 1000) / 1000);
    const back = wire(m);
    expect(back).toEqual(m);
    expect(JSON.stringify(m).length).toBeLessThan(1200);
  });

  it('refuses malformed messages', () => {
    const bad: unknown[] = [
      null,
      'break:lobby',
      { type: 'break:nope' },
      { type: 'break:challenge', to: 'b', crewSize: 4 },
      { type: 'break:challenge', crewSize: 1 },
      { type: 'break:input', gid: 'g', i: { id: 'b', key: 'jump', t: 1 } },
      { type: 'break:input', gid: 'g', i: { id: 'b', key: 'a', t: 'soon' } },
      { type: 'break:input', i: { id: 'b', key: 'a', t: 1 } },
      { type: 'break:s', gid: 'g', state: { gid: 'g', phase: 'party', t: 1, beat: 1 } },
      { type: 'break:s', gid: 'g', state: { gid: 'g', phase: 'turn', t: Infinity, beat: 1 } },
      { type: 'break:end', gid: 'g', winner: 2 },
      { type: 'break:start', config: { ...CFG, dancers: [CFG.dancers[0]] } },
      { type: 'break:start', config: { ...CFG, crewSize: 5 } },
      { type: 'break:start', config: { ...CFG, dancers: [CFG.dancers[0], CFG.dancers[0]] } },
      { type: 'break:pong', gid: 'g', to: 'b', c: 1 },
      { type: 'break:ping', gid: 'x'.repeat(65), c: 1 },
    ];
    for (const b of bad) expect(readMsg(b), JSON.stringify(b)).toBeNull();
  });

  it('clamps what it keeps', () => {
    const cfg = readConfig({
      ...CFG,
      rounds: 99,
      bpm: 999,
      dancers: [
        { id: 'a', name: 'x'.repeat(80), crew: 0, human: true },
        { id: 'b', crew: 1, human: 'yes', skill: 7 },
      ],
      windows: { perfect: -1, great: 0.1, ok: 9 },
    })!;
    expect(cfg.rounds).toBe(10);
    expect(cfg.bpm).toBe(200);
    expect(cfg.dancers[0].name.length).toBe(24);
    expect(cfg.dancers[1]).toEqual({ id: 'b', name: 'noun', crew: 1, human: false, skill: 1 });
    expect(cfg.windows).toEqual({ perfect: 0.005, great: 0.1, ok: 0.5 });

    const s = readState({
      gid: 'g',
      phase: 'turn',
      t: 1,
      beat: 2,
      poses: [
        { id: 'a', move: 'windmill', moveT: 3, centre: 1, lastGrade: 'amazing' },
        { nope: 1 },
      ],
      prompts: [
        { key: 'up', beat: 3 },
        { key: 'fly', beat: 4 },
      ],
      totals: ['x', 3],
      cards: [{ votes: [0, 1, 7], technique: [1, 2] }],
      winner: 'nobody',
      extra: { kept: 1.23456 },
    })!;
    expect(s.poses).toEqual([{ id: 'a', move: 'windmill', moveT: 1, centre: false }]);
    expect(s.prompts).toEqual([{ key: 'up', beat: 3 }]);
    expect(s.totals).toEqual([0, 0]);
    expect(s.cards[0].votes).toEqual([0, 1]);
    expect(s.cards[0].power).toEqual([0, 0]);
    expect(s.winner).toBeUndefined();
    expect(s.turn).toBeNull();
    // Fields a future sim adds pass through
    expect((s as unknown as { extra: unknown }).extra).toEqual({ kept: 1.23456 });
  });

  it('checks the rhythm lane, the move forming and the track id', () => {
    const s = readState({
      gid: 'g',
      phase: 'turn',
      t: 1,
      beat: 2,
      poses: [],
      prompts: [],
      totals: [0, 0],
      cards: [],
      lane: [
        {
          key: 'up',
          beat: 3,
          id: '0.2.windmill.2',
          move: 'windmill',
          i: 2,
          n: 4,
          grade: 'ok',
          off: 0.12,
        },
        { key: 'a', beat: 4, id: 'x', move: 'flare', i: 99, n: 4, off: 9, dead: true },
        { key: 'fly', beat: 4, id: 'y', move: 'flare' },
        { key: 'up', beat: 4, id: 'z', move: '<script>' },
        'nope',
      ],
      forming: { id: 'a', move: 'windmill', got: 9, of: 4 },
    })!;
    expect(s.lane).toEqual([
      {
        key: 'up',
        beat: 3,
        id: '0.2.windmill.2',
        move: 'windmill',
        i: 2,
        n: 4,
        grade: 'ok',
        off: 0.12,
      },
      { key: 'a', beat: 4, id: 'x', move: 'flare', i: 16, n: 4, off: 1, dead: true },
    ]);
    expect(s.forming).toEqual({ id: 'a', move: 'windmill', got: 4, of: 4 });
    expect(readState({ ...s, forming: { id: 'a' }, lane: 'x' })).not.toHaveProperty('lane');
    expect(readConfig({ ...CFG, track: 'boom-bap_01' })?.track).toBe('boom-bap_01');
    expect(readConfig({ ...CFG, track: '../../etc/passwd' })).not.toHaveProperty('track');
  });
});
