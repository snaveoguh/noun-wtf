import { describe, expect, it } from 'vitest';

// (registers the natural terrain the town frames are cut from)
import '../world/mountain/terrain';

import {
  buildCourse,
  CHECKPOINT_R,
  courseLength,
  CourseRun,
  ghostAt,
  passes,
  RING_SPACING,
  verifyCourseRun,
  type CourseAnchor,
  type Ring,
} from './course';
import { dragonCourse, dragonCourseAnchors } from './courseWorld';
import { DRAGON } from './DragonRide';

const FLAT = () => 0;
const A: CourseAnchor[] = [
  { label: 'START', x: 0, z: 0, ground: 0, alt: 16 },
  { label: 'B', x: 3000, z: 0, ground: 0, alt: 30 },
  { label: 'C', x: 3000, z: 3000, ground: 10, alt: 50 },
];

/** Fly the rings in order at `speed` m/s, stepping `dt` (a perfect run). */
function fly(rings: readonly Ring[], speed: number, dt = 1 / 30, run = new CourseRun(rings)) {
  // approach the start ring from 50 m behind
  const pts = [{ x: rings[0]!.x - 50, y: rings[0]!.y, z: rings[0]!.z }, ...rings];
  let p = { ...pts[0]! };
  for (let i = 1; i < pts.length; i++) {
    const t = pts[i]!;
    for (;;) {
      const d = Math.hypot(t.x - p.x, t.y - p.y, t.z - p.z);
      const step = speed * dt;
      const k = d <= step ? 1 : step / d;
      const q = { x: p.x + (t.x - p.x) * k, y: p.y + (t.y - p.y) * k, z: p.z + (t.z - p.z) * k };
      run.step(dt, p, q, Math.atan2(t.x - p.x, t.z - p.z));
      p = q;
      if (k === 1) break;
    }
  }
  return run;
}

describe('Dragon Run course', () => {
  it('rings: start, checkpoints, plain rings between, finish back at the start', () => {
    const r = buildCourse(A, FLAT);
    expect(r[0]!.label).toBe('START');
    expect(r[r.length - 1]!.label).toBe('FINISH');
    expect(r[r.length - 1]!.x).toBe(r[0]!.x);
    expect(r.filter(x => x.label !== null).map(x => x.label)).toEqual([
      'START',
      'B',
      'C',
      'FINISH',
    ]);
    // gaps between rings stay near the spacing
    for (let i = 1; i < r.length; i++) {
      const d = Math.hypot(r[i]!.x - r[i - 1]!.x, r[i]!.z - r[i - 1]!.z);
      expect(d).toBeLessThan(RING_SPACING * 1.6);
    }
  });

  it('never hangs a ring in a hill', () => {
    const hill = (x: number) => (x > 1000 && x < 2000 ? 300 : 0);
    const r = buildCourse(A, hill);
    for (const ring of r)
      if (ring.label === null) expect(ring.y).toBeGreaterThan(hill(ring.x) + 20);
  });

  it('is deterministic', () => {
    expect(buildCourse(A, FLAT)).toEqual(buildCourse(A, FLAT));
  });

  it('passes(): a step through the ring counts, one that misses wide does not', () => {
    const ring: Ring = { x: 0, y: 50, z: 0, r: 13, label: null };
    expect(passes(ring, -5, 50, -20, 5, 52, 20)).toBe(true);
    expect(passes(ring, 30, 50, -20, 30, 50, 20)).toBe(false);
    expect(passes(ring, 0, 50, -40, 0, 50, -20)).toBe(false); // stopped short
  });

  it('a run: starts at the start ring, splits at each ring, finishes at the end', () => {
    const rings = buildCourse(A, FLAT);
    const run = fly(rings, 60);
    expect(run.done).toBe(true);
    expect(run.splits.length).toBe(rings.length);
    expect(run.splits[0]).toBe(0);
    // time ≈ course length / speed
    expect(run.ms / 1000).toBeCloseTo(courseLength(rings) / 60, 0);
    for (let i = 1; i < run.splits.length; i++)
      expect(run.splits[i]!).toBeGreaterThanOrEqual(run.splits[i - 1]!);
  });

  it('skipping a ring holds the run until you fly back through it', () => {
    const rings = buildCourse(A, FLAT);
    const run = new CourseRun(rings);
    // through the start, then straight to ring 3 (skipping 1, 2)
    run.step(0.1, { x: -20, y: rings[0]!.y, z: 0 }, { x: 5, y: rings[0]!.y, z: 0 }, 0);
    const r3 = rings[3]!;
    run.step(0.1, { x: r3.x - 5, y: r3.y, z: r3.z }, { x: r3.x + 5, y: r3.y, z: r3.z }, 0);
    expect(run.next).toBe(1);
    expect(run.done).toBe(false);
  });

  it('ghostAt interpolates the trace and ends with it', () => {
    const tr = [0, 0, 0, 0, 0, 10, 0, 0, 0, 1000];
    const g = { x: 0, y: 0, z: 0, yaw: 0 };
    expect(ghostAt(tr, 500, g)?.x).toBeCloseTo(5);
    expect(ghostAt(tr, 1500, g)).toBeNull();
  });
});

describe('verifyCourseRun (for a future checked board)', () => {
  const rings = buildCourse(A, FLAT);
  it('accepts a real run', () => {
    const run = fly(rings, 60);
    const c = verifyCourseRun(run.trace, rings, DRAGON.boost);
    expect(c).toMatchObject({ ok: true });
    expect(Math.abs(c.ms! - run.ms)).toBeLessThan(250);
  });

  it('refuses a run faster than a dragon flies', () => {
    const run = fly(rings, 200);
    expect(verifyCourseRun(run.trace, rings, DRAGON.boost)).toMatchObject({
      ok: false,
      reason: 'faster than a dragon flies',
    });
  });

  it('refuses a run that cuts the course', () => {
    const run = fly(rings, 60);
    // drop the samples around a mid-course ring: the path skips it
    const tr = [...run.trace];
    const cut = tr.slice(0, 5 * 40).concat(tr.slice(5 * 200).map((v, i) => (i % 5 === 4 ? v : v)));
    const c = verifyCourseRun(cut, rings, DRAGON.boost);
    expect(c.ok).toBe(false);
  });

  it('refuses junk', () => {
    expect(verifyCourseRun([], rings, DRAGON.boost).ok).toBe(false);
    expect(verifyCourseRun([1, 2, 3], rings, DRAGON.boost).ok).toBe(false);
  });
});

describe('the Dragon Run in the world', () => {
  it('resolves: Roost → Noggle Arch → Crabby Light → Boom Tower → Roost', () => {
    const a = dragonCourseAnchors(FLAT);
    expect(a?.map(x => x.label)).toEqual([
      'DRAGON ROOST',
      'NOGGLE ARCH',
      'CRABBY LIGHT',
      'BOOM TOWER',
    ]);
    const r = dragonCourse(FLAT)!;
    const L = courseLength(r);
    // a couple of minutes at the dragon's top speed
    expect(L).toBeGreaterThan(4000);
    expect(L / DRAGON.maxSpeed).toBeLessThan(600);
    expect(r[0]!.r).toBe(CHECKPOINT_R);
  });
});
