import { describe, expect, it } from 'vitest';

import {
  coneDepth,
  coneHeight,
  PEAK,
  PEAK_LIPSCHITZ,
  peakHeight,
  peakNormal,
  raycastHeight,
} from './peakTerrain';

const n = { x: 0, y: 0, z: 0 };

describe('the Big Drop', () => {
  it('has a flat summit pad', () => {
    expect(peakHeight(0, 0)).toBe(0);
    expect(peakHeight(10, -15)).toBe(0);
  });

  it('drops 1,000 km, then eases out onto the snowfield', () => {
    const r = PEAK.pad + PEAK.drop / PEAK.grade;
    expect(peakHeight(r * 0.5, 0)).toBeLessThan(-450_000);
    // The cone bottoms out (the basin's valleys and kickers sit on top of it)
    expect(coneHeight(0, r + 20_000)).toBeCloseTo(-PEAK.drop, 0);
    expect(Math.abs(peakHeight(-(r + 50_000), 0) + PEAK.drop)).toBeLessThan(400);
    // The cone itself only ever goes down
    let prev = 0;
    for (let s = 0; s < r + 10_000; s += 997) {
      const d = coneDepth(s);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
  });

  it('is steep (about 49°) but stays rideable ground everywhere', () => {
    let steepest = 1;
    let sum = 0;
    let count = 0;
    for (let i = 0; i < 4000; i++) {
      const a = i * 2.399;
      const r = 500 + ((i * 7919) % 400_000);
      peakNormal(Math.cos(a) * r, Math.sin(a) * r, n);
      steepest = Math.min(steepest, n.y);
      sum += n.y;
      count++;
    }
    // The board only counts ground with a normal above 0.55
    expect(steepest).toBeGreaterThan(0.55);
    expect(sum / count).toBeLessThan(0.7);
  });

  it('never slopes faster than the ray marcher assumes', () => {
    const e = 0.25;
    for (let i = 0; i < 3000; i++) {
      const a = i * 1.618;
      const r = 30 + ((i * 104729) % 200_000);
      const x = Math.cos(a) * r;
      const z = Math.sin(a) * r;
      const gx = (peakHeight(x + e, z) - peakHeight(x - e, z)) / (2 * e);
      const gz = (peakHeight(x, z + e) - peakHeight(x, z - e)) / (2 * e);
      expect(Math.hypot(gx, gz)).toBeLessThan(PEAK_LIPSCHITZ);
    }
  });

  it('ray-marches onto the surface from above and along the slope', () => {
    // Straight down onto the slope 2 km out
    const x = 2000;
    const z = 300;
    const top = peakHeight(x, z) + 50;
    const t = raycastHeight(peakHeight, PEAK_LIPSCHITZ, x, top, z, 0, -1, 0, 100);
    expect(top - t).toBeCloseTo(peakHeight(x, z), 2);
    // A low ray skimming downhill must not tunnel through a kicker
    const ox = 10_000;
    const oy = peakHeight(ox, 0) + 0.8;
    const dx = 1 / Math.hypot(1, PEAK.grade);
    const dy = -PEAK.grade * dx;
    const hit = raycastHeight(peakHeight, PEAK_LIPSCHITZ, ox, oy, 0, dx, dy, 0, 3000);
    if (hit >= 0) {
      const hx = ox + dx * hit;
      expect(oy + dy * hit).toBeCloseTo(peakHeight(hx, 0), 1);
    }
    // Starting underground pointing down: a hit at 0
    expect(raycastHeight(peakHeight, PEAK_LIPSCHITZ, x, top - 100, z, 0, -1, 0, 10)).toBe(0);
  });
});
