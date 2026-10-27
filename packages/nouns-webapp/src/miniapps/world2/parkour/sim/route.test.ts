import { describe, expect, it } from 'vitest';

import {
  GhostRecorder,
  RunClock,
  fmtDelta,
  fmtTime,
  ghostAt,
  inCheckpoint,
  medalFor,
  unpackGhost,
  type GhostFrame,
  type RouteDef,
} from './route';

const route: RouteDef = {
  id: 't',
  name: 'TEST',
  blurb: '',
  start: { x: 0, y: 0, z: 0, yaw: 0 },
  checkpoints: [
    { x: 0, y: 1, z: 10, r: 2 },
    { x: 10, y: 1, z: 10, r: 2 },
    { x: 10, y: 4, z: 0, r: 2 },
  ],
  medals: { gold: 6, silver: 8, bronze: 12 },
};

/** Walk the route at `v` m/s through each checkpoint centre. */
function walk(c: RunClock, v: number) {
  const pts = [
    { x: 0, y: 0, z: 0 },
    ...route.checkpoints.map(p => ({ x: p.x, y: p.y - 0.9, z: p.z })),
  ];
  const dt = 1 / 60;
  const passed: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    const n = Math.ceil(len / v / dt);
    for (let k = 1; k <= n; k++) {
      const s = k / n;
      const got = c.update(dt, a.x + (b.x - a.x) * s, a.y + (b.y - a.y) * s, a.z + (b.z - a.z) * s);
      if (got >= 0) passed.push(got);
    }
  }
  return passed;
}

describe('route timing', () => {
  it('medals', () => {
    expect(medalFor(5.9, route.medals)).toBe('gold');
    expect(medalFor(6, route.medals)).toBe('gold');
    expect(medalFor(7, route.medals)).toBe('silver');
    expect(medalFor(11, route.medals)).toBe('bronze');
    expect(medalFor(12.01, route.medals)).toBeNull();
  });

  it('checkpoints count only in order, and the clock stops at the last', () => {
    const c = new RunClock(route);
    c.start();
    // Through the last one first: doesn't count
    c.update(1, 10, 3.1, 0);
    expect(c.next).toBe(0);
    c.start();
    const passed = walk(c, 5);
    expect(passed).toEqual([0, 1, 2]);
    expect(c.phase).toBe('done');
    // 10 + 10 + ~10.4 m at 5 m/s, entering each sphere ~2 m early
    expect(c.time).toBeGreaterThan(4.6);
    expect(c.time).toBeLessThan(6.1);
    expect(c.result!.medal).toBe('gold');
    expect(c.result!.best).toBe(true);
    expect(c.result!.prev).toBeNull();
    const t = c.time;
    c.update(5, 0, 0, 0);
    expect(c.time).toBe(t);
  });

  it('splits against a best run', () => {
    const first = new RunClock(route);
    first.start();
    walk(first, 5);
    const second = new RunClock(route, first.splits);
    second.start();
    walk(second, 4);
    expect(second.delta(0)!).toBeGreaterThan(0.3);
    expect(second.result!.best).toBe(false);
    expect(second.result!.prev).toBeCloseTo(first.time, 6);
    const third = new RunClock(route, first.splits);
    third.start();
    walk(third, 6);
    expect(third.delta(2)!).toBeLessThan(0);
    expect(third.result!.best).toBe(true);
  });

  it('checkpoints are a bit taller than wide', () => {
    const c = { x: 0, y: 1, z: 0, r: 1.5 };
    expect(inCheckpoint(c, 0, 0.1, 0)).toBe(true);
    expect(inCheckpoint(c, 1.4, 0.1, 0)).toBe(true);
    expect(inCheckpoint(c, 0, 2.1, 0)).toBe(true);
    expect(inCheckpoint(c, 0, 3.2, 0)).toBe(false);
    expect(inCheckpoint(c, 1.6, 0.1, 0)).toBe(false);
  });

  it('formats times', () => {
    expect(fmtTime(42.371)).toBe('0:42.37');
    expect(fmtTime(65.5)).toBe('1:05.50');
    expect(fmtDelta(-0.314)).toBe('−0.31');
    expect(fmtDelta(1.2)).toBe('+1.20');
  });
});

describe('ghosts', () => {
  it('records at 10 Hz and plays back interpolated', () => {
    const rec = new GhostRecorder();
    const dt = 1 / 60;
    for (let i = 0; i <= 120; i++) {
      const t = i * dt;
      rec.add(dt, {
        x: t * 5,
        y: 1,
        z: -t * 2,
        yaw: 3.1 + t * 0.2,
        anim: t < 1 ? 0 : 7,
        phase: (t * 1.5) % 1,
      });
    }
    expect(rec.samples).toBeGreaterThanOrEqual(20);
    expect(rec.samples).toBeLessThanOrEqual(22);
    const g = unpackGhost(JSON.parse(JSON.stringify(rec.pack())))!;
    const f: GhostFrame = { x: 0, y: 0, z: 0, yaw: 0, anim: 0, phase: 0 };
    ghostAt(g, 0.55, f);
    expect(f.x).toBeCloseTo(2.75, 1);
    expect(f.z).toBeCloseTo(-1.1, 1);
    expect(f.anim).toBe(0);
    // Yaw wraps through ±π the short way
    ghostAt(g, 0.3, f);
    expect(Math.abs(Math.sin(f.yaw) - Math.sin(3.16))).toBeLessThan(0.03);
    ghostAt(g, 1.5, f);
    expect(f.anim).toBe(7);
    expect(ghostAt(g, 50, f)).toBeNull();
  });

  it('rejects junk from storage', () => {
    expect(unpackGhost(null)).toBeNull();
    expect(unpackGhost([1, 2, 3])).toBeNull();
    expect(unpackGhost([1, 2, 3, 4, 5, 'x'])).toBeNull();
    expect(unpackGhost([1, 2, 3, 4, 5, 6])).not.toBeNull();
  });
});
