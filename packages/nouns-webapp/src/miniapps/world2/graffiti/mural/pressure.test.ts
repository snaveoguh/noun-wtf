import { describe, expect, it } from 'vitest';

import { MAX_RADIUS_MM, MIN_RADIUS_MM } from '../strokes';

import {
  curvePressure,
  DEFAULT_FEEL,
  holdPressure,
  penRadius,
  PressureFilter,
  samplePressure,
  Stabiliser,
  tiltOf,
  touchPressure,
} from './pressure';

describe('pressure curve', () => {
  it('is linear at 0, softer below, firmer above, monotonic, ends fixed', () => {
    expect(curvePressure(0.5, 0)).toBeCloseTo(0.5);
    expect(curvePressure(0.5, -1)).toBeGreaterThan(0.5);
    expect(curvePressure(0.5, 1)).toBeLessThan(0.5);
    for (const c of [-1, -0.4, 0, 0.6, 1]) {
      expect(curvePressure(0, c)).toBe(0);
      expect(curvePressure(1, c)).toBe(1);
      let prev = -1;
      for (let p = 0; p <= 1.0001; p += 0.05) {
        const v = curvePressure(p, c);
        expect(v).toBeGreaterThanOrEqual(prev);
        prev = v;
      }
    }
  });

  it('clamps junk input', () => {
    expect(curvePressure(NaN, 0)).toBe(0);
    expect(curvePressure(2, 0)).toBe(1);
    expect(curvePressure(-1, 0)).toBe(0);
  });
});

describe('penRadius', () => {
  const feel = { ...DEFAULT_FEEL, minSize: 0.2, tilt: 0 };
  it('runs from minSize × nozzle (light) to the nozzle (full press)', () => {
    expect(penRadius(50, 0, 0, feel)).toBeCloseTo(10);
    expect(penRadius(50, 1, 0, feel)).toBeCloseTo(50);
    expect(penRadius(50, 0.5, 0, feel)).toBeCloseTo(30);
  });
  it('tilt widens, up to 1.8× flat on the glass', () => {
    const t = { ...feel, tilt: 1 };
    expect(penRadius(50, 1, 1, t)).toBeCloseTo(90);
    expect(penRadius(50, 1, 0.5, t)).toBeGreaterThan(50);
  });
  it('stays inside what the wire carries', () => {
    expect(penRadius(1, 0, 0, feel)).toBe(MIN_RADIUS_MM);
    expect(penRadius(400, 1, 1, { ...feel, tilt: 1 })).toBe(MAX_RADIUS_MM);
  });
});

describe('tilt and finger pressure', () => {
  it('reads altitudeAngle first, else tiltX/Y', () => {
    expect(tiltOf({ altitudeAngle: Math.PI / 2 })).toBe(0);
    expect(tiltOf({ altitudeAngle: 0 })).toBe(1);
    expect(tiltOf({ tiltX: 0, tiltY: 0 })).toBe(0);
    expect(tiltOf({ tiltX: 45, tiltY: 0 })).toBeCloseTo(0.5);
  });
  it('contact size maps to 0.15..1, null when unreported', () => {
    expect(touchPressure(1, 1)).toBeNull();
    expect(touchPressure(10, 10)).toBeCloseTo(0.15);
    expect(touchPressure(34, 30)).toBeCloseTo(1);
    expect(touchPressure(80, 80)).toBe(1);
  });
  it('hold time ramps 0 → ~1 over about a second', () => {
    expect(holdPressure(0)).toBe(0);
    expect(holdPressure(600)).toBeCloseTo(0.632, 2);
    expect(holdPressure(3000)).toBeGreaterThan(0.99);
  });
  it('samplePressure: pen as reported, finger by size, mouse full', () => {
    expect(samplePressure('pen', 0.3, 1, 1, DEFAULT_FEEL)).toBe(0.3);
    expect(samplePressure('pen', 0, 1, 1, DEFAULT_FEEL)).toBe(0.5);
    expect(samplePressure('touch', 0.5, 34, 34, DEFAULT_FEEL)).toBeCloseTo(1);
    expect(samplePressure('touch', 0.5, 1, 1, DEFAULT_FEEL)).toBe(1);
    expect(samplePressure('touch', 0.5, 10, 10, { ...DEFAULT_FEEL, fingerPressure: false })).toBe(
      1,
    );
    expect(samplePressure('mouse', 0.5, 1, 1, DEFAULT_FEEL)).toBe(1);
  });
});

describe('Stabiliser', () => {
  it('raw at smoothing 0', () => {
    const s = new Stabiliser();
    s.reset(0, 0, 0);
    expect(s.push(3, 4)).toBe(true);
    expect([s.x, s.y]).toEqual([3, 4]);
  });
  it('ignores wobble inside the string, follows a pull along the line', () => {
    const s = new Stabiliser();
    s.reset(0, 0, 1);
    const L = Stabiliser.MAX_LEN;
    // Jitter within the string length: the brush stays put
    for (const [x, y] of [
      [3, -2],
      [-4, 1],
      [2, 5],
    ])
      expect(s.push(x, y)).toBe(false);
    expect([s.x, s.y]).toEqual([0, 0]);
    // A real pull: the brush trails by exactly L
    s.push(100, 0);
    expect(s.x).toBeCloseTo(100 - L);
    expect(s.y).toBeCloseTo(0);
  });
  it('a smoothed zigzag comes out flatter than it went in', () => {
    const s = new Stabiliser();
    s.reset(0, 0, 0.6);
    let maxY = 0;
    for (let i = 1; i < 200; i++) {
      s.push(i * 4, i % 2 === 0 ? 6 : -6);
      maxY = Math.max(maxY, Math.abs(s.y));
    }
    expect(maxY).toBeLessThan(3);
  });
});

describe('PressureFilter', () => {
  it('smooths by time, not by sample count', () => {
    const a = new PressureFilter(14);
    a.reset(0, 0);
    a.push(1, 14);
    const b = new PressureFilter(14);
    b.reset(0, 0);
    for (let t = 1; t <= 14; t++) b.push(1, t);
    expect(a.v).toBeCloseTo(b.v, 5);
    expect(a.v).toBeCloseTo(1 - Math.exp(-1), 5);
  });
});
