// @vitest-environment node
// Determinism, all-bot games and performance.

import type { BallerInput, TeamSize } from '../contract';

import { describe, expect, it } from 'vitest';

import { botConfig, runBotGame, teamTotals } from './harness';
import { HoopsSim } from './HoopsSim';
import { rand } from './rng';

function hash(v: unknown): string {
  const s = JSON.stringify(v);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(16)}:${s.length}`;
}

/** A 3v3 with one human (a seeded button masher) and five bots. */
function mixedConfig(seed: number) {
  const cfg = botConfig(3, seed);
  cfg.players[0] = { ...cfg.players[0], id: 'human', bot: false };
  return cfg;
}

function masher(seed: number): () => Record<string, BallerInput> {
  const h = { rng: seed };
  let hold = { shoot: false, pass: false, move: false };
  return () => {
    if (rand(h) < 0.08) hold = { shoot: rand(h) < 0.3, pass: rand(h) < 0.2, move: rand(h) < 0.2 };
    const a = rand(h) * Math.PI * 2;
    return {
      human: {
        moveX: Math.sin(a),
        moveZ: Math.cos(a),
        sprint: rand(h) < 0.5,
        ...hold,
        call: rand(h) < 0.1,
      },
    };
  };
}

describe('hoops determinism', () => {
  it('same seed + inputs → identical state after 5000 steps', () => {
    const a = new HoopsSim(mixedConfig(7));
    const b = new HoopsSim(mixedConfig(7));
    const ia = masher(99);
    const ib = masher(99);
    for (let k = 0; k < 5000; k++) {
      a.step(ia());
      b.step(ib());
    }
    expect(hash(a.state())).toBe(hash(b.state()));
    expect(a.live.tick).toBe(5000);
    // A different seed plays out differently.
    const c = new HoopsSim(mixedConfig(8));
    const ic = masher(99);
    for (let k = 0; k < 5000; k++) c.step(ic());
    expect(hash(c.state())).not.toBe(hash(a.state()));
  }, 30_000);

  it('load(state()) resumes bit-exactly (via JSON, like a snapshot)', () => {
    const a = new HoopsSim(mixedConfig(11));
    const ia = masher(5);
    for (let k = 0; k < 2500; k++) a.step(ia());
    const b = new HoopsSim(mixedConfig(11));
    b.load(JSON.parse(JSON.stringify(a.state())));
    const ib = masher(5);
    for (let k = 0; k < 2500; k++) ib(); // same input stream position
    for (let k = 0; k < 2500; k++) {
      const inp = ia();
      ib();
      a.step(inp);
      b.step(inp);
    }
    expect(hash(b.state())).toBe(hash(a.state()));
  }, 30_000);

  it('state() is plain JSON and a copy', () => {
    const a = new HoopsSim(mixedConfig(3));
    for (let k = 0; k < 600; k++) a.step({});
    const s = a.state();
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
    s.players[0].x = 999;
    expect(a.live.players[0].x).not.toBe(999);
  });
});

describe('hoops bot games', () => {
  const modes: [TeamSize, number][] = [
    [1, 60_000],
    [2, 90_000],
    [3, 120_000],
    [5, 160_000],
  ];
  const all = { dunks: 0, tpm: 0, stl: 0, blk: 0 };
  for (const [size, maxSteps] of modes) {
    it(`${size}v${size} all-bot games finish with plausible box scores`, () => {
      let fgm = 0;
      let fga = 0;
      for (const seed of [1, 2, 3]) {
        const r = runBotGame(botConfig(size, seed * 101), maxSteps);
        expect(r.finished, `seed ${seed} finished`).toBe(true);
        expect(r.longestStall, 'stuck (no shot / pass / steal / rebound)').toBeLessThan(15);
        expect(r.clearViolations).toBe(0);
        // Nobody swarms the ball: never more than a transition's worth of
        // everyone-on-the-ball, and not most of the time.
        expect(r.crowdedRun, 'crowded stretch (s)').toBeLessThan(4);
        expect(r.crowded).toBeLessThan(0.35);
        const s = r.sim.live;
        const [a, b] = s.score;
        expect(Math.max(a, b)).toBeGreaterThanOrEqual(r.sim.config.target);
        for (const team of [0, 1] as const) {
          const t = teamTotals(r.sim, team);
          fgm += t.fgm;
          fga += t.fga;
          all.dunks += t.dunks;
          all.tpm += t.tpm;
          all.stl += t.stl;
          all.blk += t.blk;
          expect(t.pts).toBe(s.score[team]);
        }
      }
      const pct = fgm / fga;
      expect(pct).toBeGreaterThan(0.35);
      expect(pct).toBeLessThan(0.65);
    }, 60_000);
  }
  it('across modes: dunks, threes, steals and blocks all happen', () => {
    expect(all.dunks).toBeGreaterThan(0);
    expect(all.tpm).toBeGreaterThan(0);
    expect(all.stl).toBeGreaterThan(0);
    expect(all.blk).toBeGreaterThan(0);
  });
});

describe('hoops performance', () => {
  it('a 5v5 step (10 bots, state snapshot included) averages under 0.3 ms', () => {
    const sim = new HoopsSim(botConfig(5, 4242));
    for (let k = 0; k < 1200; k++) sim.step({});
    const n = 6000;
    const t0 = performance.now();
    for (let k = 0; k < n; k++) {
      sim.step({});
      if (sim.live.phase === 'final') break;
    }
    const per = (performance.now() - t0) / n;
    expect(per).toBeLessThan(0.3);
  }, 30_000);
});
