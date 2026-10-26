import { describe, expect, it } from 'vitest';

import {
  SPRAY_MACH,
  sprayBoom,
  sprayCarveRate,
  sprayIntensity,
  sprayLandCount,
  sprayMistRate,
  sprayTake,
  sprayVapour,
  sprayWindAmount,
  type SprayInput,
} from './sprayRules';

const base: SprayInput = { speed: 40, carve: 0, slide: 0, surface: 'groomed', grounded: true };

describe('spray emission', () => {
  it('sprays when carving hard, powersliding or braking, not riding straight', () => {
    expect(sprayCarveRate(base)).toBe(0);
    expect(sprayCarveRate({ ...base, carve: 0.15 })).toBe(0);
    expect(sprayCarveRate({ ...base, carve: 0.9 })).toBeGreaterThan(100);
    expect(sprayCarveRate({ ...base, slide: 1 })).toBeGreaterThan(
      sprayCarveRate({ ...base, carve: 0.6 }),
    );
  });

  it('throws far more in powder, less on ice, none off the snow or in the air', () => {
    const hard = { ...base, carve: 1 };
    const groomed = sprayCarveRate(hard);
    expect(sprayCarveRate({ ...hard, surface: 'powder' })).toBeGreaterThan(groomed * 2);
    expect(sprayCarveRate({ ...hard, surface: 'ice' })).toBeLessThan(groomed * 0.5);
    expect(sprayCarveRate({ ...hard, surface: 'off' })).toBe(0);
    expect(sprayCarveRate({ ...hard, grounded: false })).toBe(0);
    expect(sprayIntensity({ ...hard, speed: 1 })).toBe(0);
  });

  it('grows with speed but stays within budget', () => {
    const hard = { ...base, carve: 1, surface: 'powder' as const };
    expect(sprayCarveRate({ ...hard, speed: 300 })).toBeGreaterThan(
      sprayCarveRate({ ...hard, speed: 20 }),
    );
    expect(sprayCarveRate({ ...hard, speed: 5000 })).toBeLessThanOrEqual(1100);
  });

  it('mists at speed, thicker in powder', () => {
    expect(sprayMistRate(10, 'groomed', true)).toBe(0);
    expect(sprayMistRate(200, 'groomed', true)).toBeGreaterThan(0);
    expect(sprayMistRate(200, 'powder', true)).toBeGreaterThan(sprayMistRate(200, 'groomed', true));
    expect(sprayMistRate(200, 'powder', false)).toBe(0);
  });

  it('bursts on landing, bigger the harder it hits', () => {
    expect(sprayLandCount(0.5, 'groomed')).toBe(0);
    const soft = sprayLandCount(3, 'groomed');
    const hard = sprayLandCount(15, 'groomed');
    expect(soft).toBeGreaterThan(0);
    expect(hard).toBeGreaterThan(soft);
    expect(sprayLandCount(15, 'powder')).toBeGreaterThan(hard);
    expect(sprayLandCount(1000, 'powder')).toBeLessThanOrEqual(320 * 2);
  });

  it('turns a rate into whole particles without losing any', () => {
    const acc = { a: 0 };
    let n = 0;
    for (let i = 0; i < 60; i++) n += sprayTake(acc, 90, 1 / 60);
    expect(n).toBe(90);
  });
});

describe('speed effects', () => {
  it('streaks the wind only at very high speed', () => {
    expect(sprayWindAmount(100)).toBe(0);
    expect(sprayWindAmount(200)).toBeGreaterThan(0);
    expect(sprayWindAmount(400)).toBe(1);
  });

  it('booms once through each barrier, and again after slowing back under it', () => {
    const armed = { next: 1 };
    expect(sprayBoom(300, armed)).toBe(0);
    expect(sprayBoom(SPRAY_MACH + 1, armed)).toBe(1);
    expect(sprayBoom(SPRAY_MACH + 5, armed)).toBe(0);
    expect(sprayBoom(SPRAY_MACH - 1, armed)).toBe(0);
    expect(sprayBoom(SPRAY_MACH + 2, armed)).toBe(0);
    expect(sprayBoom(SPRAY_MACH * 0.9, armed)).toBe(0);
    expect(sprayBoom(SPRAY_MACH * 1.01, armed)).toBe(1);
    expect(sprayBoom(SPRAY_MACH * 2.05, armed)).toBe(2);
    expect(sprayBoom(SPRAY_MACH * 2.1, armed)).toBe(0);
  });

  it('shows the vapour cone right at the barrier', () => {
    expect(sprayVapour(SPRAY_MACH)).toBeCloseTo(1);
    expect(sprayVapour(SPRAY_MACH * 0.5)).toBe(0);
    expect(sprayVapour(SPRAY_MACH * 1.5)).toBe(0);
  });
});
