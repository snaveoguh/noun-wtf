import { describe, expect, it } from 'vitest';

import { PHYS, STRIDE, verifyRun } from './runProof';

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
