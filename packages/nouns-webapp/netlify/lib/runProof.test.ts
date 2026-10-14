import { describe, expect, it } from 'vitest';

import { MOUNTAIN } from '../../src/miniapps/world2/world/mountain/config';

import { MAX_V, PHYS, STRIDE, verifyRun } from './runProof';

const AIR = 1;
/** A trace from samples [t, x, y, z, v, state]. */
const trace = (rows: number[][]) => Float32Array.from(rows.flat());

/**
 * Ride flat, pop off a lip and fly `T` s. `bumpAt`: clip something then (the
 * vertical speed drops to `bumpVy`). `kick`: a fake upward push at every bump.
 */
function jump(T: number, opts: { bumpAt?: number[]; bumpVy?: number; kick?: number } = {}) {
  const rows: number[][] = [];
  const vx = 5;
  let vy = 0.5 * PHYS.g * T; // lands back at take-off height after T
  // Drop in from high enough to leave the lip at that speed (energy kept)
  const V = Math.hypot(vx, vy);
  const H = (V * V - 100) / (2 * PHYS.g);
  let t = 0;
  for (let k = 0; k <= 40; k++, t += 0.4) {
    const y = H * (1 - k / 40);
    rows.push([t, 0, y, 0, Math.sqrt(100 + 2 * PHYS.g * (H - y)), 0]);
  }
  const t0 = t;
  let y = 0;
  const bumps = [...(opts.bumpAt ?? [])];
  for (let a = 0; a <= T; a += 1 / 30) {
    if (bumps.length > 0 && a >= bumps[0]!) {
      bumps.shift();
      vy = opts.kick !== undefined ? Math.max(vy, 0) + opts.kick : Math.min(vy, opts.bumpVy ?? 0);
    }
    rows.push([t0 + a, vx * a, y, 0, Math.hypot(vx, vy), AIR]);
    y += vy / 30 - (0.5 * PHYS.g) / 900;
    vy -= PHYS.g / 30;
  }
  rows.push([t0 + T + 1 / 30, vx * (T + 1 / 30), y, 0, vx, 0]);
  return trace(rows);
}

describe('run proof: hang time', () => {
  it('credits a clean 10 s air', () => {
    const r = verifyRun(jump(10));
    expect(r.reason).toBeUndefined();
    expect(Math.max(...r.airs.map(a => a.s))).toBeGreaterThan(9.9);
  });

  it('credits a 10 s air that clips a tree on the way', () => {
    const r = verifyRun(jump(10, { bumpAt: [3.2, 6.1], bumpVy: -5 }));
    expect(r.ok).toBe(true);
    expect(Math.max(0, ...r.airs.map(a => a.s))).toBeGreaterThan(5);
  });

  it("doesn't credit a hover made of small upward kicks", () => {
    const kicks = Array.from({ length: 30 }, (_, i) => 0.5 + i * 0.3);
    const r = verifyRun(jump(10, { bumpAt: kicks, kick: 1.2 }));
    expect(Math.max(0, ...r.airs.map(a => a.s))).toBeLessThan(1);
  });

  it('STRIDE matches the sample layout', () => expect(STRIDE).toBe(6));
});

/** Terrain gradient (terrain.ts baseHeight) and its slope, for honest fixtures. */
const base = (de: number) =>
  MOUNTAIN.topY - MOUNTAIN.slope * (de - MOUNTAIN.slopeEase * (1 - Math.exp(-de / MOUNTAIN.slopeEase)));
const baseSlope = (de: number) => MOUNTAIN.slope * (1 - Math.exp(-de / MOUNTAIN.slopeEase));

/**
 * An unbroken mountain run straight down the +Z line, simulated with the
 * game's rules: gravity along the slope, the streak's push (+0.35 m/s² per
 * minute), rolling friction and the run-thinned air drag. Sampled like
 * RunTrace (every 0.4 s on the ground) until it reaches `vTop` m/s.
 */
function longRun(vTop: number) {
  const rows: number[][] = [];
  const h = 0.02;
  let t = 0;
  let de = 200;
  let v = 0;
  let run = 0;
  let next = 0;
  while (v < vTop) {
    if (t >= next) {
      rows.push([t, 0, base(de), MOUNTAIN.wallZ + de, v, 0]);
      next += 0.4;
    }
    const k = baseSlope(de);
    const sin = k / Math.hypot(1, k);
    const cos = 1 / Math.hypot(1, k);
    const a =
      PHYS.g * sin +
      (v > 3 ? PHYS.streak * (t / 60) : 0) -
      0.65 * (0.1 + (0.0035 / (1 + run / 400)) * v * v);
    v = Math.max(0, v + a * h);
    de += v * h * cos;
    run += v * h;
    t += h;
  }
  rows.push([t, 0, base(de), MOUNTAIN.wallZ + de, v, 0]);
  return rows;
}

describe('run proof: top speed', () => {
  const rows = longRun(2800);

  it('credits an honest ~16 minute streak to 2,800 m/s (over 10,000 km/h)', () => {
    expect(rows.length).toBeLessThan(60_000);
    const r = verifyRun(trace(rows));
    expect(r.reason).toBeUndefined();
    expect(r.maxV * 3.6).toBeGreaterThan(10_000);
  });

  it('refuses the same ride with every speed ×1.15', () => {
    const r = verifyRun(trace(rows.map(([t, x, y, z, v, st]) => [t, x, y, z, v * 1.15, st])));
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('gains energy from nowhere');
  });

  it('refuses a sped-up tail (the last 5% of samples ×1.15)', () => {
    const cut = Math.floor(rows.length * 0.95);
    const r = verifyRun(
      trace(rows.map(([t, x, y, z, v, st], i) => [t, x, y, z, i >= cut ? v * 1.15 : v, st])),
    );
    expect(r.ok).toBe(false);
  });

  it('refuses a spike at the top (one sample ×1.15)', () => {
    const i = rows.length - 2;
    const r = verifyRun(
      trace(rows.map(([t, x, y, z, v, st], k) => [t, x, y, z, k === i ? v * 1.15 : v, st])),
    );
    expect(r.ok).toBe(false);
  });

  it('still refuses speeds past the sanity ceiling', () => {
    const r = verifyRun(trace([[0, 0, 0, 0, 0, 0], [1, 0, 0, MAX_V + 10, MAX_V + 10, 0]]));
    expect(r.reason).toBe('impossible speed');
  });
});
