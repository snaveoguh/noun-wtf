import { describe, expect, it } from 'vitest';

import { herdGone, LIFE, spawnHerd, stepHerd } from './basinLifeSim';

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe('the basin wildlife', () => {
  it('spawns herds ahead and lets them go once left behind', () => {
    const r = rng(3);
    for (let i = 0; i < 40; i++) {
      const h = spawnHerd('yak', 100, 200, 0, r);
      expect(h.members.length).toBeGreaterThanOrEqual(4);
      // Ahead of a player heading +z
      expect(h.z - 200).toBeGreaterThan(0);
      expect(herdGone(h, 100, 200)).toBe(false);
      expect(herdGone(h, 100, 200 - LIFE.window * 2)).toBe(true);
    }
  });

  it('grazes calmly, then bolts from a rider coming through', () => {
    const r = rng(9);
    for (const kind of ['yak', 'hare', 'penguin'] as const) {
      const h = spawnHerd(kind, 0, 0, 0, r);
      for (let f = 0; f < 300; f++) stepHerd(h, 1 / 30, [], r);
      for (const m of h.members) expect(m.fright).toBe(0);
      // A rider at speed right through the herd's middle
      const before = h.members.map(m => Math.hypot(m.x - h.x, m.z - h.z));
      const rx = h.x;
      const rz = h.z;
      for (let f = 0; f < 60; f++) stepHerd(h, 1 / 30, [rx, rz, 40], r);
      const after = h.members.map(m => Math.hypot(m.x - rx, m.z - rz));
      const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
      expect(mean(after)).toBeGreaterThan(mean(before) + 3);
      expect(h.members.some(m => m.fright > 0)).toBe(true);
    }
  });
});
