import { describe, expect, it } from 'vitest';

import { seabedDepth } from './coast';
import {
  CHOP,
  OMEGA,
  SEA_WRAP,
  SWELL,
  chopAt,
  seaSample,
  setSize,
  swellAt,
  waveK,
  wrap,
  type SeaSample,
  type Swell,
} from './waves';

const sw = (): Swell => ({ phi: 0, A: 0, k: 0, Dh: 0, ratio: 0, depth: 0 });
const ss = (): SeaSample => ({
  y: 0, d0: 0, a: 0, phi: 0, A: 0, k: 0, c: 0, depth: 0, ratio: 0, broken: 0, foam: 0, flow: 0,
});

/** Crest positions (rest d) along a line a = const at time t, outward from the shore. */
function crests(a: number, t: number, max = 600): number[] {
  const out: number[] = [];
  const s = sw();
  let prev = wrap(swellAt(0, a, t, s).phi);
  for (let d = 0.25; d < max; d += 0.25) {
    const p = wrap(swellAt(d, a, t, s).phi);
    if (p < prev - Math.PI) out.push(d);
    prev = p;
  }
  return out;
}

describe('the swell', () => {
  it('crests march in toward the beach at about the shallow-water speed', () => {
    const c0 = crests(0, 100);
    const c1 = crests(0, 101);
    // the crest ~100 m out moved shoreward
    const near = (cs: number[], d: number) => cs.reduce((b, x) => (Math.abs(x - d) < Math.abs(b - d) ? x : b));
    const a = near(c0, 100);
    const b = near(c1, a);
    expect(b).toBeLessThan(a);
    const speed = a - b;
    expect(speed).toBeGreaterThan(4);
    expect(speed).toBeLessThan(9);
    expect(speed).toBeCloseTo(OMEGA / waveK(a), 0);
  });

  it('comes in in sets: big ones and small ones', () => {
    let lo = 9;
    let hi = 0;
    for (let p = 0; p < 200; p += 0.1) {
      lo = Math.min(lo, setSize(p));
      hi = Math.max(hi, setSize(p));
    }
    expect(lo).toBeLessThan(0.65);
    expect(hi).toBeGreaterThan(1.2);
  });

  it('shoals and breaks ~90–160 m out, and is broken (smaller) inside', () => {
    const s = sw();
    // every wave is broken 60 m out, none 260 m out; small ones break ~90 m
    // out, big set waves ~200 m
    for (let t = 0; t < 72; t += 0.37) {
      expect(swellAt(60, 0, t, s).ratio).toBeGreaterThan(1);
      expect(swellAt(260, 0, t, s).ratio).toBeLessThan(1);
    }
    let first = 0;
    let last = 1e9;
    for (let t = 0; t < 72; t += 0.37) {
      let d = 0;
      while (d < 300 && swellAt(d, 0, t, s).ratio > 1) d += 0.5;
      first = Math.max(first, d);
      last = Math.min(last, d);
    }
    expect(last).toBeGreaterThan(70);
    expect(last).toBeLessThan(110);
    expect(first).toBeGreaterThan(150);
    expect(first).toBeLessThan(240);
    // inside the break line the height saturates at ~γ·depth
    const inner = swellAt(30, 0, 10, s);
    expect(inner.A * 2).toBeLessThanOrEqual(SWELL.gamma * seabedDepth(30) * 1.05 + 0.2);
    // offshore it's the open swell
    const off = swellAt(800, 0, 10, s);
    expect(off.ratio).toBeLessThan(0.3);
    expect(off.A * 2).toBeGreaterThan(SWELL.H0 * 0.6);
  });

  it('peels: along the coast the same crest is further out at larger a', () => {
    const t = 33;
    const s = sw();
    // the crest nearest 120 m out at a = 0, and its continuation at a = 60
    const c0 = crests(0, t).find(d => d > 100)!;
    const phi0 = swellAt(c0, 0, t, s).phi;
    // find d at a = 60 with the same phase
    let best = 0;
    let err = 1e9;
    for (let d = 0; d < 400; d += 0.05) {
      const e = Math.abs(swellAt(d, 60, t, s).phi - phi0);
      if (e < err) {
        err = e;
        best = d;
      }
    }
    expect(best).toBeGreaterThan(c0 + 10);
  });

  it('the CPU height is the GPU vertex: a displaced vertex samples back to its own y', () => {
    const s = sw();
    const o = ss();
    let worst = 0;
    for (const t of [3, 17.5, 101]) {
      for (let d0 = 2; d0 < 400; d0 += 3.7) {
        for (const a of [-80, 0, 55]) {
          const p = swellAt(d0, a, t, s);
          const dx = d0 - p.Dh * Math.sin(p.phi);
          const y = p.A * Math.cos(p.phi);
          seaSample(0, dx, a, 0, 0, t, o);
          worst = Math.max(worst, Math.abs(o.y - chopAt(0, 0, t) - y));
        }
      }
    }
    expect(worst).toBeLessThan(0.01);
  });

  it('wraps the clock seamlessly', () => {
    const a = ss();
    const b = ss();
    for (const d of [5, 60, 130, 500]) {
      seaSample(0, d, 20, 3, -4, 0.25, a);
      seaSample(0, d, 20, 3, -4, 0.25 + SEA_WRAP, b);
      expect(b.y).toBeCloseTo(a.y, 3);
      expect(b.broken).toBeCloseTo(a.broken, 3);
    }
    for (const c of CHOP) expect(((c[3] * SEA_WRAP) / (2 * Math.PI)) % 1).toBeCloseTo(0, 6);
  });

  it('the surface is continuous (no steps for the board to trip on)', () => {
    const o = ss();
    let prev = seaSample(0, -10, 0, 0, 0, 7, o).y;
    let worst = 0;
    for (let d = -10; d < 600; d += 0.05) {
      const y = seaSample(0, d, 0, d * 0.3, 0, 7, o).y;
      worst = Math.max(worst, Math.abs(y - prev));
      prev = y;
    }
    expect(worst).toBeLessThan(0.08);
  });
});
