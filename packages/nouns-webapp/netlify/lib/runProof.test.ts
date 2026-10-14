import { describe, expect, it } from 'vitest';

import { MOUNTAIN } from '../../src/miniapps/world2/world/mountain/config';

import { decimate, PHYS, proves, STRIDE, TRIM_LEVELS, trimTrace, verifyRun } from './runProof';

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

/** Terrain of the radial gradient (as runProof's baseHeight). */
function slopeY(x: number) {
  const de = Math.max(0, x - MOUNTAIN.wallZ);
  const L = MOUNTAIN.slopeEase;
  return MOUNTAIN.topY - MOUNTAIN.slope * (de - L * (1 - Math.exp(-de / L)));
}

/**
 * A long honest mountain run: down the slope from the city wall, speed from
 * the drop only (energy kept, drag on the ground), a big
 * ballistic jump every `every` s, sampled the way RunTrace samples (every
 * 1/30 s while the top speed keeps rising, so long acceleration piles up).
 * Returns the trace and the time range of the last jump.
 */
function mountainRun(minutes: number, every = 25) {
  const rows: number[][] = [];
  const dt = 1 / 60;
  let t = 0;
  let x = MOUNTAIN.wallZ;
  let y = slopeY(x);
  let v = 5;
  let st = 0;
  let vy = 0;
  let nextJump = every;
  let lastT = -Infinity;
  let lastSt = -1;
  let lastV = 0;
  let maxV = 0;
  let jump: [number, number] = [0, 0];
  let airStart = 0;
  const sample = () => {
    const gap = t - lastT;
    const jolt = Math.abs(v - lastV) > 1 + 0.1 * lastV;
    const due =
      st !== lastSt || gap >= (st === AIR ? 1 / 30 : 0.4) || ((v > maxV || jolt) && gap >= 1 / 30);
    if (!due) return;
    rows.push([t, x, y, 0, v, st]);
    lastT = t;
    lastSt = st;
    lastV = v;
    maxV = Math.max(maxV, v);
  };
  sample();
  while (t < minutes * 60) {
    t += dt;
    if (st === 0) {
      const vh = v;
      x += vh * dt;
      const y1 = slopeY(x);
      v = Math.sqrt(Math.max(0, v * v + 2 * PHYS.g * (y - y1)));
      // Drag: tops out near 900 km/h
      v -= 3.3e-5 * v * v * dt;
      y = y1;
      if (t >= nextJump && v > 20) {
        // Pop: 4 m/s up (under the ollie's allowance)
        st = AIR;
        vy = 4;
        airStart = t;
        nextJump = t + every;
      }
    } else {
      const vh = Math.sqrt(Math.max(0, v * v - vy * vy));
      x += vh * dt;
      y += vy * dt - 0.5 * PHYS.g * dt * dt;
      vy -= PHYS.g * dt;
      v = Math.hypot(vh, vy);
      if (y <= slopeY(x)) {
        // Land: the slope takes the speed along it, the rest is lost
        y = slopeY(x);
        st = 0;
        v = vh * 0.98;
        jump = [airStart, t];
      }
    }
    sample();
  }
  return { s: trace(rows), jump };
}

describe('run proof: trimming a long ride', () => {
  // 160 min down the mountain, accelerating all the way (sampled every 1/30 s)
  const cruise = mountainRun(160, Infinity);
  // 75 min of big airs every 5 s (80 % of it in the air, sampled every 1/30 s)
  const airy = mountainRun(75, 5);

  for (const [name, run] of [
    ['a 160 min straight run', cruise],
    ['75 min of big airs', airy],
  ] as const) {
    describe(name, () => {
      // Whole, it's more than the server checks: judge it at the finest
      // thinning that fits
      const full = verifyRun(decimate(run.s, TRIM_LEVELS[1][0], TRIM_LEVELS[1][1], [run.jump]));
      const airS = Math.max(0, ...full.airs.map(a => a.s));
      const claims = {
        kmh: Math.floor(full.maxV * 36) / 10,
        ...(airS > 0 ? { airS: Math.floor((run.jump[1] - run.jump[0]) * 100) / 100 } : {}),
      };

      it('is honest, and longer than the server takes whole (60k samples)', () => {
        expect(run.s.length / STRIDE).toBeGreaterThan(60_000);
        expect(verifyRun(run.s).reason).toBe('too long');
        expect(full.reason).toBeUndefined();
        expect(proves(full, claims)).toBe(true);
      });

      it('trims to the size cap and still proves the top speed and the record jump', () => {
        const trimmed = trimTrace(run.s, { maxSamples: 20_000, keep: [run.jump], claims });
        expect(trimmed.length / STRIDE).toBeLessThanOrEqual(20_000);
        const r = verifyRun(trimmed);
        expect(r.reason).toBeUndefined();
        expect(proves(r, claims)).toBe(true);
        // The start stays: a proof still begins slow
        expect(Array.from(trimmed.subarray(0, STRIDE))).toEqual(
          Array.from(run.s.subarray(0, STRIDE)),
        );
      });

      it('every thinning level still checks out and keeps the top speed', () => {
        for (const [g, a] of TRIM_LEVELS) {
          const r = verifyRun(decimate(run.s, g, a, [run.jump]));
          expect(r.reason, `level ${g}/${a}`).toBeUndefined();
          expect(r.maxV).toBe(full.maxV);
        }
      });
    });
  }

  it('a short trace is sent untouched', () => {
    const j = jump(3);
    expect(trimTrace(j, { maxSamples: 20_000 })).toBe(j);
  });

  describe('cheats stay caught after trimming', () => {
    const run = mountainRun(30, Infinity);
    const n = run.s.length / STRIDE;
    const full = verifyRun(run.s);
    const cheat = (f: (s: Float32Array) => void) => {
      const s = run.s.slice();
      f(s);
      return s;
    };
    // The cheat as sent, and as trimmed for the size cap at each level a
    // proof this size uses. (The coarsest levels space ground samples
    // seconds apart, where the streak's allowance can cover a jump like
    // this; the server already takes gaps up to 10 s from anyone, so they
    // open nothing a cheat couldn't send itself.)
    const trims = (s: Float32Array) => [
      s,
      trimTrace(s, { maxSamples: 20_000 }),
      ...TRIM_LEVELS.slice(0, 4).map(([g, a]) => decimate(s, g, a)),
    ];

    it('×1.15 speed from minute 10', () => {
      const s = cheat(s => {
        for (let i = 0; i < n; i++) if (s[i * STRIDE] > 10 * 60) s[i * STRIDE + 4] *= 1.15;
      });
      trims(s).forEach((t, i) =>
        expect(verifyRun(t).reason, `trim ${i}`).toBe('gains energy from nowhere'),
      );
    });

    it('a single speed spike', () => {
      const s = cheat(s => {
        s[Math.floor(n * 0.8) * STRIDE + 4] *= 1.5;
      });
      trims(s).forEach((t, i) => {
        const r = verifyRun(t);
        // Either refused, or the spike isn't in what it proves
        if (r.ok) expect(r.maxV, `trim ${i}`).toBeLessThanOrEqual(full.maxV);
        else expect(r.reason).toBe('gains energy from nowhere');
      });
    });

    it('starting fast', () => {
      const s = cheat(s => {
        s[4] = 60;
      });
      for (const t of trims(s)) expect(verifyRun(t).reason).toBe('starts at speed');
    });
  });
});
