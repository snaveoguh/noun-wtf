// @vitest-environment node
// Rules: scoring values, win by 2, shot clock, out of bounds, the half-court
// clear, on fire, plus the release meter end to end.

import type { SimEvent } from '../contract';

import { describe, expect, it } from 'vitest';

import { humanGame, only, RIM_Z, run, shoot, stage } from './testkit';

const scores = (ev: SimEvent[]) =>
  ev.filter((e): e is Extract<SimEvent, { type: 'score' }> => e.type === 'score');
const has = (ev: SimEvent[], type: SimEvent['type']) => ev.some(e => e.type === type);

describe('hoops rules', () => {
  it('a perfect release swishes from all over the floor (the full sim)', () => {
    for (const at of [
      [0, RIM_Z - 4.5],
      [-5, RIM_Z - 3],
      [6.5, RIM_Z - 0.8],
      [0, RIM_Z - 7.4],
      [-4.5, RIM_Z - 6],
    ] as [number, number][]) {
      const sim = humanGame(1);
      stage(sim, { holder: 'a0', at });
      const ev = shoot(sim, 'a0');
      const shot = ev.find(e => e.type === 'shot');
      expect(shot).toMatchObject({ kind: 'jumper', release: 'perfect' });
      expect(scores(ev)[0]?.how, `from ${at}`).toBe('swish');
    }
  });

  it('a late release mostly misses, and misses for real (iron / glass)', () => {
    let made = 0;
    let iron = 0;
    const n = 30;
    for (let k = 0; k < n; k++) {
      const sim = humanGame(1, { seed: 100 + k });
      stage(sim, { holder: 'a0', at: [2, RIM_Z - 6.5] });
      const ev = shoot(sim, 'a0', 1);
      expect(ev.find(e => e.type === 'shot')).toMatchObject({ release: 'late' });
      if (scores(ev).length > 0) made++;
      else if (has(ev, 'rim') || has(ev, 'backboard')) iron++;
    }
    expect(made / n).toBeLessThan(0.45);
    expect(iron).toBeGreaterThan(0);
  }, 30_000);

  it('scores 2s and 3s with nbaScoring, 1s and 2s streetball', () => {
    const cases: [boolean, [number, number], number][] = [
      [true, [0, RIM_Z - 4], 2],
      [true, [0, RIM_Z - 7.4], 3],
      [false, [0, RIM_Z - 4], 1],
      [false, [0, RIM_Z - 7.4], 2],
    ];
    for (const [nba, at, pts] of cases) {
      const sim = humanGame(1, { nbaScoring: nba });
      stage(sim, { holder: 'a0', at });
      const ev = shoot(sim, 'a0');
      expect(scores(ev)[0]?.points).toBe(pts);
      expect(sim.live.score[0]).toBe(pts);
    }
  });

  it('first to the target, win by 2', () => {
    const sim = humanGame(1, { nbaScoring: false, target: 11, winBy2: true });
    stage(sim, { holder: 'a0', at: [0, RIM_Z - 4], score: [10, 10] });
    shoot(sim, 'a0');
    expect(sim.live.score).toEqual([11, 10]);
    expect(sim.live.phase).toBe('scored');
    // Loser's ball next, then a0 again to make it 12-10.
    stage(sim, { holder: 'a0', at: [0, RIM_Z - 4] });
    const ev = shoot(sim, 'a0');
    expect(sim.live.phase).toBe('final');
    expect(ev.find(e => e.type === 'final')).toMatchObject({ winner: 0, score: [12, 10] });

    const nob2 = humanGame(1, { nbaScoring: false, target: 11, winBy2: false });
    stage(nob2, { holder: 'a0', at: [0, RIM_Z - 4], score: [10, 10] });
    shoot(nob2, 'a0');
    expect(nob2.live.phase).toBe('final');
  });

  it('after a score it is the loser’s ball (check ball)', () => {
    const sim = humanGame(1);
    stage(sim, { holder: 'a0', at: [0, RIM_Z - 4] });
    shoot(sim, 'a0');
    const ev = run(sim, 200);
    expect(ev.find(e => e.type === 'checkball')).toMatchObject({ team: 1 });
    expect(sim.live.ball.holder).toBe('b0');
  });

  it('shot clock violation turns it over', () => {
    const sim = humanGame(1);
    stage(sim, { holder: 'a0', at: [0, RIM_Z - 7] });
    const ev = run(sim, 60 * (sim.config.shotClock + 3));
    expect(ev.find(e => e.type === 'shotClock')).toMatchObject({ team: 0 });
    expect(has(ev, 'checkball')).toBe(true);
    expect(sim.live.offense).toBe(1);
  });

  it('dribbling out of bounds is a turnover', () => {
    const sim = humanGame(1);
    stage(sim, { holder: 'a0', at: [11.5, RIM_Z - 5] });
    const ev = run(sim, 90, () => only(sim, 'a0', { moveX: 1 }));
    expect(ev.find(e => e.type === 'outOfBounds')).toMatchObject({ team: 0 });
    expect(sim.live.phase === 'turnover' || sim.live.phase === 'checkball').toBe(true);
    run(sim, 120);
    expect(sim.live.offense).toBe(1);
  });

  it('half court: the backcourt is out of bounds', () => {
    const sim = humanGame(1);
    stage(sim, { holder: 'a0', at: [0, 0.6] });
    const ev = run(sim, 60, () => only(sim, 'a0', { moveZ: -1 }));
    expect(has(ev, 'outOfBounds')).toBe(true);
  });

  it('half court: an uncleared make does not count; clearing past the arc does', () => {
    const sim = humanGame(1);
    stage(sim, { holder: 'a0', at: [0, RIM_Z - 4], cleared: false, score: [3, 3] });
    expect(sim.state().mustClear).toBe(true);
    const ev = shoot(sim, 'a0');
    expect(ev.find(e => e.type === 'violation')).toMatchObject({ team: 0, kind: 'clear' });
    expect(sim.live.score).toEqual([3, 3]);

    const sim2 = humanGame(1);
    stage(sim2, { holder: 'a0', at: [0, RIM_Z - 5.5], cleared: false });
    const ev2 = run(sim2, 60, () => only(sim2, 'a0', { moveZ: -1 }));
    expect(ev2.find(e => e.type === 'cleared')).toMatchObject({ team: 0 });
    expect(sim2.state().mustClear).toBe(false);
  });

  it('three straight scores puts a player on fire; the other team scoring ends it', () => {
    const sim = humanGame(1);
    const all: SimEvent[] = [];
    for (let k = 0; k < 3; k++) {
      stage(sim, { holder: 'a0', at: [0, RIM_Z - 4] });
      all.push(...shoot(sim, 'a0'));
    }
    expect(all.find(e => e.type === 'onFire')).toMatchObject({ id: 'a0' });
    expect(sim.live.players[0].onFire).toBe(true);
    stage(sim, { holder: 'b0', at: [0, RIM_Z - 4] });
    const ev = shoot(sim, 'b0');
    expect(ev.find(e => e.type === 'fireOut')).toMatchObject({ id: 'a0' });
    expect(sim.live.players[0].onFire).toBe(false);
  });

  it('driving to the rim with speed dunks; slow and close lays it up', () => {
    const d2 = humanGame(1, {}, { a0: { dunking: 0.9 } });
    stage(d2, { holder: 'a0', at: [0, RIM_Z - 6] });
    let shot: SimEvent | undefined;
    for (let k = 0; k < 120 && shot === undefined; k++) {
      const p = d2.live.players[0];
      const near = RIM_Z - p.z < 3.2;
      const s = d2.step(only(d2, 'a0', { moveZ: 1, sprint: true, shoot: near }));
      shot = s.events.find(e => e.type === 'shot');
    }
    expect(shot).toMatchObject({ kind: 'dunk' });
    const ev = run(d2, 120);
    expect(scores(ev)[0]?.how).toBe('dunk');
    expect(d2.boxScore.a0.dunks).toBe(1);

    const lay = humanGame(1);
    stage(lay, { holder: 'a0', at: [1.2, RIM_Z - 1.6] });
    const lev = shoot(lay, 'a0');
    expect(lev.find(e => e.type === 'shot')).toMatchObject({ kind: 'layup' });
  });
});
