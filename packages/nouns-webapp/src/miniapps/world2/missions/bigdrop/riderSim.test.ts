import type { Feature } from './contract';

import { describe, expect, it } from 'vitest';

import { coneDepth, PEAK, peakHeight } from '../peakTerrain';

import {
  RIDER,
  riderAvoid,
  riderCreate,
  riderPickPace,
  riderPopFor,
  riderShouldRecycle,
  riderSpawn,
  riderSpawnOffset,
  riderStep,
  riderTrickK,
  riderX,
  type RiderEnv,
} from './riderSim';
import { centerX, featuresIn, widthAt } from './track';

/** Deterministic [0, 1). */
function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The bare cone along the line (no moguls, no ridges). */
const cone = (_x: number, z: number) => -coneDepth(z - PEAK.pad);

function env(riderS: number, riderV: number, features: Feature[] = []): RiderEnv {
  return { height: cone, riderS, riderLat: 0, riderV, features };
}

describe('pace spread', () => {
  it('has riders to overtake, riders alongside and riders that blast past', () => {
    const r = rng(7);
    const paces = Array.from({ length: 3000 }, () => riderPickPace(r));
    const slow = paces.filter(p => p < 0.9).length / paces.length;
    const near = paces.filter(p => p >= 0.9 && p <= 1.12).length / paces.length;
    const fast = paces.filter(p => p >= 1.4).length / paces.length;
    expect(slow).toBeGreaterThan(0.25);
    expect(near).toBeGreaterThan(0.2);
    expect(fast).toBeGreaterThan(0.25);
    expect(Math.max(...paces)).toBeLessThanOrEqual(2.2);
    expect(Math.max(...paces)).toBeGreaterThan(2);
    expect(Math.min(...paces)).toBeGreaterThanOrEqual(0.55);
  });

  it('spawns slow riders ahead and fast ones behind, inside the window', () => {
    const r = rng(3);
    for (let i = 0; i < 500; i++) {
      const v = 20 + r() * 500;
      const slow = riderSpawnOffset(0.7, v, r);
      const fast = riderSpawnOffset(1.8, v, r);
      expect(slow).toBeGreaterThan(0);
      expect(fast).toBeLessThan(0);
      expect(Math.abs(slow)).toBeLessThan(RIDER.window);
      expect(Math.abs(fast)).toBeLessThan(RIDER.window);
    }
  });
});

describe('following the line', () => {
  it('rides the surface down the track, in the lane, at its pace', () => {
    const r = rng(11);
    const st = riderCreate();
    const s0 = 40_000;
    riderSpawn(st, env(s0, 60), r);
    st.powder = false;
    st.bias = 0;
    st.hopIn = 1e9;
    st.pace = 1.5;
    let riderS = s0;
    for (let i = 0; i < 600; i++) {
      riderS += 60 / 60;
      riderStep(st, 1 / 60, env(riderS, 60), r);
      if (!st.air) expect(st.y).toBeCloseTo(cone(st.x, st.s), 6);
      expect(Math.abs(st.lat)).toBeLessThan(widthAt(st.s) / 2);
      expect(Math.abs(st.x - centerX(st.s))).toBeLessThan(widthAt(st.s));
    }
    // Settles at 1.5× the player's 60 m/s
    expect(st.v).toBeGreaterThan(80);
    expect(st.v).toBeLessThan(92);
    expect(st.x).toBeCloseTo(riderX(st.s, st.lat), 6);
  });

  it('a fast rider spawned behind catches and passes the player', () => {
    const r = rng(5);
    const st = riderCreate();
    let riderS = 80_000;
    const v = 140;
    riderSpawn(st, env(riderS, v), r);
    st.pace = 2;
    st.s = riderS - 300;
    st.v = 2 * v;
    let passed = false;
    for (let i = 0; i < 60 * 6; i++) {
      riderS += v / 60;
      riderStep(st, 1 / 60, env(riderS, v), r);
      if (st.s > riderS + 20) passed = true;
    }
    expect(passed).toBe(true);
  });

  it('swerves round the player instead of riding through them', () => {
    expect(riderAvoid(100, 0.5, 100, 0)).toBeGreaterThan(0);
    expect(riderAvoid(100, -0.5, 100, 0)).toBeLessThan(0);
    expect(riderAvoid(100, 10, 100, 0)).toBe(0);
    expect(riderAvoid(130, 0.5, 100, 0)).toBe(0);
  });
});

describe('kickers', () => {
  it('flies a ballistic arc off the lip and lands back on the slope', () => {
    const r = rng(2);
    const st = riderCreate();
    const s0 = 60_000;
    riderSpawn(st, env(s0, 80), r);
    st.pace = 1;
    st.v = 80;
    st.lat = 0;
    st.latV = 0;
    st.bias = 0;
    st.powder = false;
    st.hopIn = 1e9;
    const kicker: Feature = { id: 'k', kind: 'kicker', s: s0 + 20, len: 45, size: 8, side: 1 };
    const dt = 1 / 120;
    let riderS = s0;
    let t0 = -1;
    let y0 = 0;
    let vy0 = 0;
    let airTime = 0;
    let maxGap = 0;
    let landed = false;
    for (let i = 0; i < 120 * 12 && !landed; i++) {
      riderS += 80 * dt;
      riderStep(st, dt, env(riderS, 80, [kicker]), r);
      if (st.launched) {
        t0 = i;
        y0 = st.y;
        vy0 = st.vy;
        expect(st.trick).not.toBe('none');
        expect(st.s).toBeGreaterThanOrEqual(kicker.s + kicker.len);
      }
      if (st.air && t0 >= 0) {
        const t = (i - t0) * dt;
        // A parabola under the Big Drop's gravity (semi-implicit Euler)
        expect(st.y).toBeCloseTo(y0 + vy0 * t - 0.5 * RIDER.g * t * t, 0);
        maxGap = Math.max(maxGap, st.y - cone(st.x, st.s));
        airTime = t;
        expect(riderTrickK(st)).toBeGreaterThanOrEqual(0);
      }
      if (st.landed) landed = true;
    }
    expect(t0).toBeGreaterThan(0);
    expect(landed).toBe(true);
    // A big air: seconds long, metres above the snow
    expect(airTime).toBeGreaterThan(2);
    expect(airTime).toBeLessThanOrEqual(RIDER.maxAir + 0.2);
    expect(maxGap).toBeGreaterThan(4);
    expect(st.landImpact).toBeGreaterThan(0);
    expect(st.y).toBeCloseTo(cone(st.x, st.s), 6);
  });

  it('pops for the air it wants', () => {
    expect(riderPopFor(4)).toBeCloseTo(10);
  });
});

describe('spawning window', () => {
  it('recycles riders out of the window or that the player will never see again', () => {
    const st = riderCreate();
    st.s = 10_000 + RIDER.window + 10;
    st.v = 50;
    expect(riderShouldRecycle(st, 10_000, 50)).toBe(true);
    st.s = 10_000 - 400;
    st.v = 30;
    expect(riderShouldRecycle(st, 10_000, 60)).toBe(true);
    st.v = 120;
    expect(riderShouldRecycle(st, 10_000, 60)).toBe(false);
    st.s = 10_000 + 1300;
    expect(riderShouldRecycle(st, 10_000, 60)).toBe(true);
    st.v = 30;
    expect(riderShouldRecycle(st, 10_000, 60)).toBe(false);
    st.s = 10_200;
    expect(riderShouldRecycle(st, 10_000, 60)).toBe(false);
  });

  it('keeps every spawn within the window, on the snow', () => {
    const r = rng(9);
    const st = riderCreate();
    for (let i = 0; i < 300; i++) {
      const riderS = 1000 + r() * 500_000;
      const v = r() * 600;
      riderSpawn(st, env(riderS, v), r, i % 3 === 0);
      expect(Math.abs(st.s - riderS)).toBeLessThan(RIDER.window);
      expect(st.y).toBeCloseTo(cone(st.x, st.s), 6);
      expect(riderShouldRecycle(st, riderS, v)).toBe(false);
    }
  });
});

describe('on the real mountain', () => {
  it('a pack keeps up with a 500 km/h run without leaving the window or going NaN', () => {
    const r = rng(21);
    const riders = Array.from({ length: 8 }, () => riderCreate());
    let riderS = 500;
    let v = 0;
    const features = featuresIn(0, 60_000).filter(f => f.kind !== 'marker' && f.kind !== 'gate');
    const e: RiderEnv = { height: peakHeight, riderS, riderLat: 0, riderV: v, features };
    for (const st of riders) riderSpawn(st, e, r, true);
    let airs = 0;
    for (let i = 0; i < 60 * 90; i++) {
      v = Math.min(139, v + 5 / 60);
      riderS += v / 60;
      e.riderS = riderS;
      e.riderV = v;
      for (const st of riders) {
        riderStep(st, 1 / 60, e, r);
        if (st.launched) airs++;
        if (riderShouldRecycle(st, riderS, v)) riderSpawn(st, e, r);
        expect(Number.isFinite(st.y + st.x + st.s + st.v)).toBe(true);
        expect(Math.abs(st.s - riderS)).toBeLessThanOrEqual(RIDER.window + 10);
        if (!st.air) expect(st.y).toBeCloseTo(peakHeight(st.x, st.s), 6);
      }
    }
    expect(airs).toBeGreaterThan(5);
  }, 30_000); // 90 s of riding: slow when the machine is busy
});
