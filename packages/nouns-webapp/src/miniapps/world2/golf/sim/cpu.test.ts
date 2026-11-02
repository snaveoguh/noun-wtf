import type { GolfConfig, RoundState, CourseSurface } from '../contract';

import { describe, expect, it } from 'vitest';

import { cpuSwing, cpuThink } from './cpu';
import { simulateShot } from './physics';
import { mulberry32 } from './rng';
import {
  applyShot,
  ballOf,
  currentHole,
  newRound,
  nextHole,
  toPar,
  totals,
  type HoleInfo,
} from './rules';
import { launchOf } from './swing';
import { makeSurface, testHoles, type TestHoleSpec } from './testCourse';

function playRound(
  surface: CourseSurface,
  holes: HoleInfo[],
  skill: number,
  seed: number,
  wind = 0,
): { state: RoundState; shots: { lie: string; club: string; d: number }[] } {
  const config: GolfConfig = {
    gid: 't',
    seed,
    players: [{ id: 'cpu:1', name: 'CPU', human: false, skill }],
    holes: holes.map(h => h.n),
    wind,
  };
  let s = newRound(config, holes);
  const rng = mulberry32(seed);
  const shots: { lie: string; club: string; d: number }[] = [];
  let guard = 0;
  while (s.phase !== 'over' && guard++ < 200) {
    if (s.phase === 'holed') {
      s = nextHole(s, holes);
      continue;
    }
    const info = currentHole(s, holes)!;
    const by = s.turn;
    const swing = cpuSwing(surface, s, by, info, rng, skill);
    const from = ballOf(s, by, info);
    const lie = s.cur[by].ball ? s.cur[by].lie : 'tee';
    const n = surface.normal(from.x, from.z, { x: 0, y: 1, z: 0 });
    const r = simulateShot(surface, from, lie, launchOf(swing, lie, n), s.wind, info.pin, {
      seed: s.n,
    });
    shots.push({ lie, club: swing.club, d: Math.hypot(from.x - info.pin.x, from.z - info.pin.z) });
    s = applyShot(s, by, r, info);
  }
  return { state: s, shots };
}

describe('cpu', () => {
  it('a skill-1 CPU plays the test course close to par', () => {
    const { surface, holes } = testHoles();
    const par = holes.reduce((a, h) => a + h.par, 0);
    let sum = 0;
    const N = 4;
    for (let k = 0; k < N; k++) {
      const { state } = playRound(surface, holes, 1, 100 + k);
      expect(state.phase).toBe('over');
      sum += totals(state)[0];
      expect(Math.abs(toPar(state, holes)[0])).toBeLessThanOrEqual(5);
    }
    const avg = sum / N;
    expect(Math.abs(avg - par)).toBeLessThanOrEqual(2.5);
  });

  it('a weak CPU scores worse than a strong one, and still finishes', () => {
    const { surface, holes } = testHoles();
    let strong = 0;
    let weak = 0;
    for (let k = 0; k < 3; k++) {
      strong += totals(playRound(surface, holes, 1, 7 + k).state)[0];
      const w = playRound(surface, holes, 0.1, 7 + k).state;
      expect(w.phase).toBe('over');
      weak += totals(w)[0];
    }
    expect(weak).toBeGreaterThan(strong);
  });

  it('copes with wind', () => {
    const { surface, holes } = testHoles();
    const { state } = playRound(surface, holes, 1, 3, 1);
    const par = holes.reduce((a, h) => a + h.par, 0);
    expect(state.phase).toBe('over');
    expect(totals(state)[0]).toBeLessThanOrEqual(par + 6);
  });

  it('lays up short of water at driver distance', () => {
    // A par 5 with a pond across the line 230–270 m out
    const spec: TestHoleSpec[] = [{ par: 5, length: 470, pond: { at: 250, r: 22 } }];
    const { surface, holes } = testHoles(spec);
    const s = newRound(
      {
        gid: 'w',
        seed: 1,
        players: [{ id: 'cpu:1', name: 'C', human: false, skill: 1 }],
        holes: [1],
        wind: 0,
      },
      holes,
    );
    for (let k = 0; k < 4; k++) {
      const swing = cpuSwing(surface, s, 0, holes[0], mulberry32(1 + k), 1);
      // Not a full driver: that runs into the pond
      expect(swing.club !== 'D' || swing.power < 0.95).toBe(true);
      const r = simulateShot(
        surface,
        holes[0].teeSpot,
        'tee',
        launchOf(swing, 'tee'),
        s.wind,
        holes[0].pin,
      );
      expect(r.lie).not.toBe('water');
      expect(r.rest.z).toBeLessThan(228);
    }
  });

  it('reads a sloped green: holes most short putts', () => {
    const surface = makeSurface({
      base: 'green',
      planes: [{ x: 0, z: 0, r: 60, y0: 0, gx: 0.025, gz: 0 }],
    });
    const pin = { x: 0, y: surface.height(0, 6), z: 6 };
    const info: HoleInfo = { n: 1, par: 4, teeSpot: { x: 0, y: 0, z: 0 }, pin, surface };
    let s = newRound(
      { gid: 'p', seed: 2, players: [{ id: 'c', name: 'C', human: false }], holes: [1], wind: 0 },
      [info],
    );
    const from = { x: 0, y: surface.height(0, 0), z: 0 };
    s = { ...s, phase: 'play', cur: [{ strokes: 1, ball: from, lie: 'green', holed: false }] };
    // The search, with no noise (skill 1 is nearly noise free; check the plan holes it)
    const g = cpuThink(surface, s, 0, info, mulberry32(5), 1);
    let steps = 0;
    let res = g.next();
    while (res.done !== true) {
      steps++;
      res = g.next();
    }
    expect(steps).toBeGreaterThanOrEqual(1);
    const swing = res.value;
    expect(swing.club).toBe('P');
    // Aimed uphill of the hole (the slope falls toward −x, so aim toward +x: yaw > 0)
    expect(swing.aim).toBeGreaterThan(0.005);
    // The plan itself (no noise) holes it
    {
      const sw = cpuSwing(surface, s, 0, info, mulberry32(1), 1, { noise: false });
      const n = surface.normal(0, 0, { x: 0, y: 1, z: 0 });
      expect(
        simulateShot(surface, from, 'green', launchOf(sw, 'green', n), { x: 0, z: 0 }, pin).holed,
      ).toBe(true);
    }
    let holed = 0;
    for (let k = 0; k < 10; k++) {
      const sw = cpuSwing(surface, s, 0, info, mulberry32(50 + k), 1);
      const n = surface.normal(0, 0, { x: 0, y: 1, z: 0 });
      const r = simulateShot(surface, from, 'green', launchOf(sw, 'green', n), { x: 0, z: 0 }, pin);
      if (r.holed) holed++;
      else expect(Math.hypot(r.rest.x - pin.x, r.rest.z - pin.z)).toBeLessThan(1.6);
    }
    expect(holed).toBeGreaterThanOrEqual(3);
  });

  it('a putt decision is quick', () => {
    const surface = makeSurface({
      base: 'green',
      planes: [{ x: 0, z: 0, r: 60, y0: 0, gx: 0.02, gz: 0.01 }],
    });
    const pin = { x: 0, y: surface.height(0, 12), z: 12 };
    const info: HoleInfo = { n: 1, par: 4, teeSpot: { x: 0, y: 0, z: 0 }, pin, surface };
    let s = newRound(
      { gid: 'p', seed: 2, players: [{ id: 'c', name: 'C', human: false }], holes: [1], wind: 0 },
      [info],
    );
    s = {
      ...s,
      phase: 'play',
      cur: [
        { strokes: 1, ball: { x: 0, y: surface.height(0, 0), z: 0 }, lie: 'green', holed: false },
      ],
    };
    cpuSwing(surface, s, 0, info, mulberry32(1), 1); // warm up the JIT
    const t0 = performance.now();
    cpuSwing(surface, s, 0, info, mulberry32(1), 1);
    expect(performance.now() - t0).toBeLessThan(60);
  });
});
