import type { Feature } from './contract';

import { describe, expect, it } from 'vitest';

import { peakHeight } from '../peakTerrain';

import {
  LoopRide,
  circleLength,
  framePoint,
  laneAt,
  loopFrame,
  loopShape,
  minLoopSpeed,
  newSample,
  rideLength,
  sampleLoop,
  toFrame,
  type LoopShape,
} from './loopPath';
import { SECTIONS, sectionFeatures } from './track';

const G = 5;
const single: LoopShape = {
  R: 25,
  turns: 1,
  w: 8.6,
  hw: 3,
  approach: 37,
  runout: 35,
  catchHalf: 17,
  funnel: 26,
};

/** Ride a level loop from the catch line at v0 until it hands back. */
function ride(sh: LoopShape, v0: number, up = { x: 0, y: 1, z: 0 }, dt = 1 / 240) {
  const r = new LoopRide(sh, up.x, up.y, up.z, G, 0, v0);
  const s = newSample();
  let topUpY = 0;
  let maxPhi = 0;
  for (let i = 0; i < 200_000 && r.step(dt) === 'ride'; i++) {
    sampleLoop(sh, r.u, s);
    if (s.phi > maxPhi) {
      maxPhi = s.phi;
      if (Math.abs(s.phi - Math.PI) < 0.05) topUpY = s.cy;
    }
  }
  return { r, topUpY, maxPhi };
}

describe('loop path', () => {
  it('is continuous and unit-tangent all the way round', () => {
    for (const sh of [single, { ...single, turns: 2 as const }]) {
      const a = newSample();
      const b = newSample();
      const end = rideLength(sh) + 10;
      for (let u = -5; u < end; u += 0.25) {
        sampleLoop(sh, u, a);
        sampleLoop(sh, u + 0.25, b);
        const d = Math.hypot(b.px - a.px, b.py - a.py, b.pz - a.pz);
        expect(d).toBeLessThan(0.2501);
        expect(d).toBeGreaterThan(0.24);
        expect(Math.hypot(a.tx, a.ty, a.tz)).toBeCloseTo(1, 6);
        // The rider's up is square to the direction of travel
        expect(Math.abs(a.tx * a.cx + a.ty * a.cy + a.tz * a.cz)).toBeLessThan(1e-9);
      }
    }
  });

  it('goes over the top upside down and comes out beside the way in', () => {
    const s = sampleLoop(single, single.approach + circleLength(single) / 2, newSample());
    expect(s.py).toBeCloseTo(2 * single.R, 6);
    expect(s.cy).toBeCloseTo(-1, 6);
    expect(s.tz).toBeLessThan(-0.99);
    // Way in and way out are a deck width and a gap apart
    const gap = laneAt(single, 2 * Math.PI) - laneAt(single, 0);
    expect(gap).toBeGreaterThan(2 * single.hw + 2);
  });
});

describe('loop ride', () => {
  it('conserves energy: v² = v0² − 2·g·h everywhere', () => {
    const r = new LoopRide(single, 0, 1, 0, G, 0, 40);
    const s = newSample();
    for (let i = 0; i < 2000 && r.step(1 / 120) === 'ride'; i++) {
      r.sample(s);
      expect(r.v * r.v).toBeCloseTo(40 * 40 - 2 * G * s.py, 3);
    }
  });

  it('carries a fast rider round and hands back at the entry speed', () => {
    const { r, topUpY, maxPhi } = ride(single, 40);
    expect(r.status).toBe('exit');
    expect(maxPhi).toBeGreaterThan(2 * Math.PI - 0.01);
    expect(topUpY).toBeLessThan(-0.99);
    expect(r.v).toBeCloseTo(40, 6);
  });

  it('keeps the speed of a 500 km/h rider (and a double loop too)', () => {
    const v = 500 / 3.6;
    expect(ride(single, v).r.v).toBeCloseTo(v, 6);
    const d = ride({ ...single, turns: 2 }, v);
    expect(d.r.status).toBe('exit');
    expect(d.r.v).toBeCloseTo(v, 6);
  });

  it('just makes it at the minimum speed, and falls off just under it', () => {
    const vmin = minLoopSpeed(single, G);
    expect(ride(single, vmin * 1.01).r.status).toBe('exit');
    const slow = ride(single, vmin * 0.97);
    expect(slow.r.status).toBe('fall');
    // Off in the top half, still moving
    expect(slow.maxPhi).toBeGreaterThan(Math.PI / 2);
    expect(slow.maxPhi).toBeLessThan((3 * Math.PI) / 2);
    expect(slow.r.push).toBeLessThan(0);
  });

  it('rolls a crawling rider back out the way they came', () => {
    const { r, maxPhi } = ride(single, 9);
    expect(r.status).toBe('back');
    expect(maxPhi).toBeLessThan(Math.PI / 2);
    expect(r.v).toBeLessThan(-8.9);
  });

  it('feels the slope: down a 40° pad the exit is faster than the entry by the drop', () => {
    const a = (40 * Math.PI) / 180;
    // World up in loop-local axes for a pad falling away down +Z
    const up = { x: 0, y: Math.cos(a), z: -Math.sin(a) };
    const { r } = ride(single, 60, up);
    expect(r.status).toBe('exit');
    const drop = (single.approach + r.u - rideLength(single)) * Math.sin(a);
    expect(r.v * r.v).toBeCloseTo(60 * 60 + 2 * G * drop, 2);
  });

  it('blends a rider caught off the line onto it before the circle', () => {
    const r = new LoopRide(single, 0, 1, 0, G, 0, 50, 12, -2);
    const s = r.sample(newSample());
    expect(s.px).toBeCloseTo(laneAt(single, 0) + 12, 6);
    expect(s.py).toBeCloseTo(-2, 6);
    while (r.u < single.approach) r.step(1 / 240);
    r.sample(s);
    const path = sampleLoop(single, r.u, newSample());
    expect(s.px).toBeCloseTo(path.px, 6);
    expect(s.py).toBeCloseTo(path.py, 6);
  });
});

describe('loop frames on the track', () => {
  const loops: Feature[] = [];
  for (let i = 0; i < SECTIONS.length && loops.length < 6; i++)
    for (const f of sectionFeatures(i)) if (f.kind === 'loop') loops.push(f);

  it('there are loops, some of them doubles', () => {
    expect(loops.length).toBeGreaterThan(3);
    const shapes = [];
    for (let i = 0; i < SECTIONS.length; i++)
      for (const f of sectionFeatures(i)) if (f.kind === 'loop') shapes.push(loopShape(f));
    expect(shapes.some(s => s.turns === 2)).toBe(true);
    expect(shapes.some(s => s.turns === 1)).toBe(true);
    for (const s of shapes) {
      expect(s.R).toBeGreaterThanOrEqual(22);
      expect(s.R).toBeLessThanOrEqual(30);
    }
  });

  it('sits square on its pad, and maps to and from peak coordinates', () => {
    for (const f of loops) {
      const fr = loopFrame(f, peakHeight);
      const { t, n, b } = fr;
      expect(Math.hypot(t.x, t.y, t.z)).toBeCloseTo(1, 9);
      expect(Math.hypot(n.x, n.y, n.z)).toBeCloseTo(1, 9);
      expect(t.x * n.x + t.y * n.y + t.z * n.z).toBeCloseTo(0, 9);
      expect(Math.abs(b.y)).toBeLessThan(1e-9);
      expect(n.y).toBeGreaterThan(0);
      expect(t.z).toBeGreaterThan(0);
      const p = framePoint(fr, 3, 4, 5, { x: 0, y: 0, z: 0 });
      const q = toFrame(fr, p.x, p.y, p.z, { x: 0, y: 0, z: 0 });
      expect(q.x).toBeCloseTo(3, 6);
      expect(q.y).toBeCloseTo(4, 6);
      expect(q.z).toBeCloseTo(5, 6);
      // On a level pad the frame is level
      const flat = loopFrame(f, () => -1234);
      expect(flat.e.y).toBeCloseTo(-1234, 6);
      expect(flat.n.y).toBeGreaterThan(0.97);
    }
  });
});
