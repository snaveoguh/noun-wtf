import { describe, expect, it } from 'vitest';

import { PEAK_LIPSCHITZ, peakHeight } from '../peakTerrain';

import {
  BASIN,
  basinBrake,
  basinKickersNear,
  basinRelief,
  basinWeight,
  kickerHeightAt,
} from './terrainBasin';
import { PEAK } from './terrainPeak';

/** A point `s` m out from the pad's edge, roughly down the race line (+z). */
const at = (s: number, x = 0) => ({ x, z: Math.sqrt((s + PEAK.pad) ** 2 - x * x) });
const slope = (x: number, z: number) => {
  const e = 0.5;
  const gx = (peakHeight(x + e, z) - peakHeight(x - e, z)) / (2 * e);
  const gz = (peakHeight(x, z + e) - peakHeight(x, z - e)) / (2 * e);
  return Math.hypot(gx, gz);
};

describe('the Big Drop basin', () => {
  it('leaves the mountain alone and grows in on the snowfield', () => {
    expect(basinWeight(BASIN.start - 10_000)).toBe(0);
    expect(basinWeight(BASIN.start + 40_000)).toBe(1);
    const p = at(BASIN.start - 20_000, 30);
    expect(basinRelief(p.x, p.z, BASIN.start - 20_000)).toBe(0);
    // It isn't flat any more: hundreds of metres of relief over a few km
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < 400; k++) {
      const q = at(BASIN.start + 20_000 + k * 25, 300 + k * 7);
      const h = peakHeight(q.x, q.z);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
    expect(hi - lo).toBeGreaterThan(40);
  });

  it('stays rideable and inside the ray marcher bound', () => {
    let steep = 0;
    let lip = 0;
    for (let k = 0; k < 6000; k++) {
      const q = at(BASIN.start + 3_000 + k * 9.7, ((k * 131) % 4000) - 2000);
      const g = slope(q.x, q.z);
      lip = Math.max(lip, g);
      // Kickers' short back faces aside, all of it is ground (normal.y > 0.55)
      const s = Math.hypot(q.x, q.z) - PEAK.pad;
      let onKicker = false;
      for (const kk of basinKickersNear(q.x, q.z, 300))
        if (kickerHeightAt(kk, q.x, q.z) > 0) onKicker = true;
      if (!onKicker) steep = Math.max(steep, g);
      expect(s).toBeGreaterThan(0);
    }
    expect(steep).toBeLessThan(1.52);
    expect(lip).toBeLessThan(PEAK_LIPSCHITZ);
  });

  it('scatters kickers that face out from the summit and kick up at the lip', () => {
    const q = at(BASIN.start + 30_000);
    const ks = basinKickersNear(q.x, q.z, 3000);
    expect(ks.length).toBeGreaterThan(40);
    for (const k of ks) {
      const out = (k.x * k.dx + k.z * k.dz) / Math.hypot(k.x, k.z);
      expect(out).toBeGreaterThan(0.9);
      const sh = k.shape;
      expect(sh.h).toBeGreaterThan(3);
      expect(sh.h).toBeLessThan(40);
      // At the lip the surface turns down by far more than the board's 21.6°
      const before = Math.atan(sh.pt);
      const after = -Math.atan(sh.pb1);
      expect((before - after) * (180 / Math.PI)).toBeGreaterThan(30);
      // And it's there in the real surface
      expect(kickerHeightAt(k, k.x, k.z)).toBeCloseTo(sh.h, 1);
    }
  });

  it('bleeds the arrival speed off in the runout, then leaves it alone', () => {
    let v = 3700;
    let s = BASIN.start + BASIN.brakeFrom;
    let t = 0;
    while (v > BASIN.cruise * 1.2 && t < 120) {
      v = basinBrake(v, s, 1 / 60);
      s += v / 60;
      t += 1 / 60;
    }
    expect(t).toBeLessThan(20);
    expect(s - BASIN.start).toBeLessThan(BASIN.rampTo);
    expect(basinBrake(40, BASIN.start + 50_000, 1)).toBe(40);
    expect(basinBrake(500, BASIN.start - 50_000, 1)).toBe(500);
  });

  it('is deterministic', () => {
    const q = at(BASIN.start + 25_000, 123);
    expect(peakHeight(q.x, q.z)).toBe(peakHeight(q.x, q.z));
  });
});
