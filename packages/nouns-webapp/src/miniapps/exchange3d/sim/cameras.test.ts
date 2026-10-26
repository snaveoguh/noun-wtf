import { describe, expect, it } from 'vitest';

import {
  angleTo,
  CAM_MODES,
  clampOrbit,
  modeForKey,
  orbitEye,
  pan,
  preset,
  R_MAX,
  R_MIN,
  rotate,
  settled,
  stepOrbit,
  zoom,
  type Orbit,
} from './cameras';

const ctx = { pit: { x: 10, z: 5 }, follow: { x: -3, y: 0.5, z: 7 }, aspect: 16 / 9, az: 0.4 };

describe('camera presets', () => {
  it('floor < wide < vast, each sensible', () => {
    const f = preset('floor', ctx);
    const w = preset('wide', ctx);
    const v = preset('vast', ctx);
    expect(f.r).toBeLessThan(w.r);
    expect(w.r).toBeLessThan(v.r);
    expect(v.r).toBeGreaterThan(500);
    expect(orbitEye(f).y).toBeLessThan(8); // walk level
    expect([f.tx, f.tz]).toEqual([10, 5]);
    for (const m of CAM_MODES) {
      const o = preset(m, ctx);
      expect(clampOrbit(o)).toEqual(o);
    }
  });

  it('follow targets the trader; portrait screens pull back', () => {
    const o = preset('follow', ctx);
    expect([o.tx, o.tz]).toEqual([-3, 7]);
    expect(preset('wide', { ...ctx, aspect: 0.5 }).r).toBeGreaterThan(preset('wide', ctx).r);
  });

  it('keys pick modes', () => {
    expect(modeForKey('3')).toBe('vast');
    expect(modeForKey('V')).toBe('vast');
    expect(modeForKey('1')).toBe('floor');
    expect(modeForKey('x')).toBeNull();
  });
});

describe('camera motion', () => {
  const a: Orbit = { tx: 0, ty: 0, tz: 0, r: 10, az: 3, el: 0.3 };
  const b: Orbit = { tx: 100, ty: 0, tz: 0, r: 1000, az: -3, el: 1 };

  it('eases toward the target and settles, frame-rate independent', () => {
    let x = a;
    for (let i = 0; i < 600; i++) x = stepOrbit(x, b, 1 / 60);
    expect(settled(x, b)).toBe(true);
    let y = a;
    for (let i = 0; i < 60; i++) y = stepOrbit(y, b, 1 / 60);
    let z = a;
    for (let i = 0; i < 20; i++) z = stepOrbit(z, b, 1 / 20);
    expect(y.r).toBeCloseTo(z.r, 3);
  });

  it('zooms evenly in log space and turns the short way', () => {
    const half = stepOrbit(a, b, Math.log(2) / 2.6);
    expect(half.r).toBeCloseTo(100, 0); // geometric midpoint of 10 and 1000
    // 3 → −3 rad is ~0.28 rad the short way across ±π
    expect(Math.abs(angleTo(a.az, b.az))).toBeLessThan(0.3);
    expect(Math.abs(half.az)).toBeGreaterThan(3);
  });

  it('zoom, rotate and clamp', () => {
    expect(zoom(a, 1e-6).r).toBe(R_MIN);
    expect(zoom(a, 1e6).r).toBe(R_MAX);
    expect(rotate(a, 0, 1e6).el).toBeLessThan(Math.PI / 2);
    expect(rotate(a, 0, -1e6).el).toBeGreaterThan(0);
  });

  it('pans with the finger: drag right moves the target left, drag down moves it away', () => {
    const o: Orbit = { tx: 0, ty: 0, tz: 0, r: 20, az: 0, el: 0.6 };
    const right = pan(o, 100, 0, 0.9, 800);
    expect(right.tx).toBeLessThan(0);
    expect(right.tz).toBeCloseTo(0);
    const down = pan(o, 0, 100, 0.9, 800);
    // camera sits on +z looking −z: away from it is −z
    expect(down.tz).toBeLessThan(0);
  });
});
