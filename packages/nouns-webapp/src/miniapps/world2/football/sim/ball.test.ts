import type { BallState } from '../contract';

import { describe, expect, it } from 'vitest';

import { PITCH_11 } from '../contract';

import { lobVelocity, newHits, predictBall, rollSpeedFor, stepBall, type BallCtx } from './ball';

const P = PITCH_11;
const R = P.ballRadius;

function ball(over: Partial<BallState> = {}): BallState {
  return {
    x: 0,
    y: R,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    wx: 0,
    wy: 0,
    wz: 0,
    mode: 'free',
    owner: null,
    lastTouch: null,
    ...over,
  };
}

function run(b: BallState, T: number, ctx: BallCtx = { inGoal: 0 }, dt = 1 / 60) {
  const hits = newHits();
  const all = newHits();
  for (let t = 0; t < T; t += dt) {
    stepBall(b, P, ctx, dt, hits);
    for (const k of Object.keys(all) as (keyof typeof all)[]) all[k] = Math.max(all[k], hits[k]);
  }
  return all;
}

describe('football ball physics', () => {
  it('a ground pass rolls and stops, further when harder', () => {
    const a = ball({ vz: 10 });
    const b = ball({ vz: 20 });
    run(a, 15);
    run(b, 15);
    expect(a.vz).toBeLessThan(0.01);
    expect(a.z).toBeGreaterThan(15);
    expect(a.z).toBeLessThan(45);
    expect(b.z).toBeGreaterThan(a.z * 1.5);
    expect(a.y).toBeCloseTo(R, 3);
  });

  it('rollSpeedFor lands a pass where it was aimed', () => {
    for (const d of [8, 15, 25, 35]) {
      const v = rollSpeedFor(d, 0);
      const b = ball({ vz: v });
      run(b, 20);
      expect(Math.abs(b.z - d)).toBeLessThan(d * 0.08 + 0.5);
    }
  });

  it('a lob lands near its target', () => {
    for (const d of [15, 30, 45]) {
      const v = lobVelocity(0, R, 0, 0, d, 8, { vx: 0, vy: 0, vz: 0 });
      const b = ball({ ...v });
      // first bounce
      const hits = newHits();
      let landed = -1;
      for (let i = 0; i < 600 && landed < 0; i++) {
        stepBall(b, P, { inGoal: 0 }, 1 / 60, hits);
        if (hits.bounce > 0) landed = b.z;
      }
      expect(Math.abs(landed - d)).toBeLessThan(d * 0.12 + 1);
    }
  });

  it('sidespin curls a shot (and the other way with the other spin)', () => {
    const l = ball({ y: 0.3, vz: 25, vy: 3, wy: 40 });
    const r = ball({ y: 0.3, vz: 25, vy: 3, wy: -40 });
    const s = ball({ y: 0.3, vz: 25, vy: 3 });
    for (let i = 0; i < 60; i++) {
      stepBall(l, P, { inGoal: 0 }, 1 / 60, newHits());
      stepBall(r, P, { inGoal: 0 }, 1 / 60, newHits());
      stepBall(s, P, { inGoal: 0 }, 1 / 60, newHits());
    }
    expect(l.x).toBeGreaterThan(1);
    expect(r.x).toBeLessThan(-1);
    expect(Math.abs(s.x)).toBeLessThan(1e-9);
  });

  it('topspin dips, backspin floats', () => {
    const top = ball({ y: 1, vz: 22, vy: 6, wx: 50 });
    const back = ball({ y: 1, vz: 22, vy: 6, wx: -50 });
    for (let i = 0; i < 40; i++) {
      stepBall(top, P, { inGoal: 0 }, 1 / 60, newHits());
      stepBall(back, P, { inGoal: 0 }, 1 / 60, newHits());
    }
    expect(top.y).toBeLessThan(back.y - 0.5);
  });

  it('bounces lower each time, then rolls', () => {
    const b = ball({ y: 5 });
    const peaks: number[] = [];
    let prevVy = 0;
    const hits = newHits();
    for (let i = 0; i < 600; i++) {
      stepBall(b, P, { inGoal: 0 }, 1 / 60, hits);
      if (prevVy > 0 && b.vy <= 0) peaks.push(b.y);
      prevVy = b.vy;
    }
    expect(peaks.length).toBeGreaterThan(2);
    for (let i = 1; i < peaks.length; i++) expect(peaks[i]).toBeLessThan(peaks[i - 1]);
    expect(b.y).toBeCloseTo(R, 3);
  });

  it('hits the post and comes back out, never through it', () => {
    const px = P.goalWidth / 2 + P.postRadius;
    // straight at the post, very hard
    const b = ball({ x: px, y: 1, z: P.length / 2 - 12, vz: 34 });
    const ctx: BallCtx = { inGoal: 0 };
    const hits = run(b, 0.6, ctx);
    expect(hits.post).toBeGreaterThan(20);
    expect(b.z).toBeLessThan(P.length / 2);
    expect(ctx.inGoal).toBe(0);
  });

  it('hits the bar', () => {
    const b = ball({ x: 0, y: P.goalHeight + P.postRadius, z: P.length / 2 - 10, vz: 30, vy: 0 });
    // fly level (cancel gravity's effect over the short hop by aiming slightly up)
    b.vy = 2.6;
    b.y -= 1.3;
    const hits = run(b, 0.6);
    expect(hits.bar + hits.net).toBeGreaterThan(0);
  });

  it('the net catches a goal: the ball stays in the goal and slows right down', () => {
    const b = ball({ x: 1, y: 1, z: P.length / 2 - 11, vz: 30, vy: 1.5 });
    const ctx: BallCtx = { inGoal: 0 };
    const hits = run(b, 3, ctx);
    expect(hits.net).toBeGreaterThan(10);
    expect(ctx.inGoal).toBe(1);
    expect(b.z).toBeGreaterThan(P.length / 2);
    expect(b.z).toBeLessThan(P.length / 2 + P.goalDepth);
    expect(Math.hypot(b.vx, b.vz)).toBeLessThan(2);
  });

  it('the side netting keeps a ball out from outside', () => {
    const half = P.length / 2;
    const b = ball({ x: P.goalWidth / 2 + 3, y: 0.5, z: half + 1, vx: -12 });
    const ctx: BallCtx = { inGoal: 0 };
    run(b, 1, ctx);
    expect(ctx.inGoal).toBe(0);
    expect(b.x).toBeGreaterThan(P.goalWidth / 2);
  });

  it('predictBall matches stepping', () => {
    const b = ball({ vz: 14, vx: 3 });
    const pts = predictBall(b, P, { inGoal: 0 }, 2, 1 / 30);
    const c = { ...b };
    run(c, 2, { inGoal: 0 }, 1 / 30);
    const last = pts[pts.length - 1];
    expect(last.z).toBeCloseTo(c.z, 6);
    expect(b.vz).toBe(14);
  });

  it('is identical at any substep pattern for the same dt sequence', () => {
    const a = ball({ vz: 28, vy: 4, wy: 20, y: 0.4 });
    const b = { ...a };
    run(a, 2);
    run(b, 2);
    expect(a).toEqual(b);
  });
});
