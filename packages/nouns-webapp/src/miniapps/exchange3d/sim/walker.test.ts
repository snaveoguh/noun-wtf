import { describe, expect, it } from 'vitest';

import { floorHeight, HALL_D, HALL_W, PITS, TOWER_CLEAR } from './layout';
import { inputDir, NO_INPUT, spawnWalker, stepWalker, WALK, walkerClip } from './walker';

const run = (w = spawnWalker(), i = NO_INPUT, az = Math.PI, secs = 2) => {
  for (let k = 0; k < secs * 60; k++) stepWalker(w, i, az, 1 / 60);
  return w;
};

describe('exchange3d walker', () => {
  it('forward goes away from the camera; right is to the right', () => {
    // Camera behind (+z side of the target, az 0) looks toward -z
    const f = inputDir({ fwd: 1, side: 0, run: false }, 0);
    expect(f.x).toBeCloseTo(0);
    expect(f.z).toBeCloseTo(-1);
    const r = inputDir({ fwd: 0, side: 1, run: false }, 0);
    expect(r.x).toBeCloseTo(1);
    expect(r.z).toBeCloseTo(0);
    // Diagonals don't go faster
    const d = inputDir({ fwd: 1, side: 1, run: false }, 0.7);
    expect(Math.hypot(d.x, d.z)).toBeCloseTo(1);
  });

  it('walks and runs at their speeds, and stops when you let go', () => {
    const w = run(spawnWalker(), { fwd: 1, side: 0, run: false }, Math.PI, 1.5);
    expect(w.speed).toBeCloseTo(WALK.walk, 1);
    expect(walkerClip(w)).toBe('walk');
    run(w, { fwd: 1, side: 0, run: true }, Math.PI, 1.5);
    expect(w.speed).toBeCloseTo(WALK.run, 1);
    expect(walkerClip(w)).toBe('run');
    run(w, NO_INPUT, Math.PI, 1);
    expect(w.speed).toBe(0);
    expect(walkerClip(w)).toBe('idle');
  });

  it('turns to face where it walks', () => {
    // az = PI: camera on the -z side, forward is +z (heading 0)
    const w = spawnWalker();
    w.heading = 2;
    run(w, { fwd: 1, side: 0, run: false }, Math.PI, 1);
    expect(Math.abs(Math.atan2(Math.sin(w.heading), Math.cos(w.heading)))).toBeLessThan(0.01);
  });

  it('stays inside the walls and out of the board tower', () => {
    const w = spawnWalker();
    run(w, { fwd: -1, side: 0, run: true }, Math.PI, 10); // straight back into the door wall
    expect(w.z).toBeGreaterThan(-HALL_D / 2);
    expect(Math.abs(w.x)).toBeLessThan(HALL_W / 2);
    expect(w.speed).toBeLessThan(0.5); // the wall took the speed
    const t = { ...spawnWalker(), x: 0, z: -TOWER_CLEAR - 3 };
    run(t, { fwd: 1, side: 0, run: true }, Math.PI, 6); // straight at the tower
    expect(Math.hypot(t.x, t.z)).toBeGreaterThanOrEqual(TOWER_CLEAR - 1e-6);
  });

  it('climbs a pit tier by tier', () => {
    const p = PITS[0]!;
    const w = { ...spawnWalker(), x: p.x, z: p.z - 14 };
    run(w, { fwd: 1, side: 0, run: false }, Math.PI, 2.4);
    expect(w.y).toBeCloseTo(floorHeight(w.x, w.z), 1);
    expect(w.y).toBeGreaterThan(0);
  });
});
