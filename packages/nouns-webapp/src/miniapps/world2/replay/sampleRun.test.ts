import { describe, expect, it } from 'vitest';

import { runLength, sampleRun } from './sampleRun';

const G = 12.5;

/** Roll 2 s at 10 m/s, then a 1 s jump sampled only every 0.25 s (a trimmed proof). */
function ride() {
  const rows: number[][] = [];
  for (let t = 0; t <= 2; t += 0.4) rows.push([t, 10 * t, 0, 0, 10, 0]);
  const vy = 0.5 * G * 1; // up and back down in 1 s
  for (let a = 0; a <= 1.0001; a += 0.25) {
    rows.push([2 + a, 20 + 10 * a, vy * a - 0.5 * G * a * a, 0, Math.hypot(10, vy - G * a), 1]);
  }
  rows.push([3.05, 30.5, 0, 0, 10, 0]);
  return Float32Array.from(rows.flat());
}

describe('sampleRun', () => {
  const s = ride();

  it('knows how long the ride is', () => expect(runLength(s)).toBeCloseTo(3.05, 3));

  it('rolls in a straight line on the ground, heading along the motion', () => {
    const f = sampleRun(s, 1.0);
    expect(f.x).toBeCloseTo(10, 3);
    expect(f.state).toBe(0);
    expect(Math.atan2(f.vx, f.vz)).toBeCloseTo(Math.PI / 2, 3);
  });

  it('flies a free-fall arc between thin air samples, not the chord', () => {
    // Halfway between the samples at 0.25 s and 0.5 s into the jump
    const a = 0.375;
    const f = sampleRun(s, 2 + a);
    expect(f.state).toBe(1);
    expect(f.y).toBeCloseTo(6.25 * a - 0.5 * G * a * a, 2);
    expect(f.vy).toBeCloseTo(6.25 - G * a, 2);
    expect(f.airS).toBeCloseTo(a, 3);
    expect(f.airM).toBeGreaterThan(1.3);
  });

  it('clamps to the ends', () => {
    expect(sampleRun(s, -5).x).toBe(0);
    expect(sampleRun(s, 99).x).toBeCloseTo(30.5, 3);
  });
});
