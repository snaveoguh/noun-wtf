import { describe, expect, it } from 'vitest';

import {
  fogDensityAt,
  JOURNEY,
  journeySpan,
  SkyState,
  skyAt,
  snowfallAt,
  stormAt,
} from './journey';
import { LAYERS, liftAt, ridgeAt } from './ranges';

describe('the Big Drop sky over the descent', () => {
  it('has keyframes in depth order, summit to snowfield', () => {
    expect(JOURNEY[0]!.depth).toBe(0);
    expect(JOURNEY[JOURNEY.length - 1]!.depth).toBe(1_000_000);
    for (let i = 1; i < JOURNEY.length; i++)
      expect(JOURNEY[i]!.depth).toBeGreaterThan(JOURNEY[i - 1]!.depth);
  });

  it('storms on the summit and is clear sky within ~1.5 km', () => {
    expect(stormAt(0)).toBe(1);
    expect(stormAt(1500)).toBe(0);
    expect(snowfallAt(0)).toBe(1);
    expect(snowfallAt(20_000)).toBe(0);
    // Thick fog in the storm, light after: the 7 km grid edge is ~95% haze
    expect(fogDensityAt(0)).toBeGreaterThan(0.003);
    const d = fogDensityAt(5000);
    expect(1 - Math.exp(-((d * 6200) ** 2))).toBeCloseTo(0.95, 2);
    expect(1 - Math.exp(-((d * 8000) ** 2))).toBeGreaterThan(0.99);
    expect(1 - Math.exp(-((d * 1000) ** 2))).toBeLessThan(0.1);
  });

  it('blends continuously and the light never comes from below the horizon', () => {
    const s = new SkyState();
    let prevEl = Infinity;
    for (let depth = 0; depth <= 1_000_000; depth += 5000) {
      skyAt(depth, s);
      expect(s.lightDir.y).toBeLessThan(-0.1); // the sunlight points down onto the snow
      expect(Math.abs(s.toSun.length() - 1)).toBeLessThan(1e-9);
      expect(s.sunEl).toBeLessThanOrEqual(prevEl + 1e-9); // the sun sinks as you descend
      prevEl = s.sunEl;
    }
    expect(journeySpan(-5).t).toBe(0);
    expect(journeySpan(2e6).t).toBe(1);
    // Clear day, sunset, aurora night
    expect(skyAt(10_000, s).aurora).toBe(0);
    expect(skyAt(220_000, s).sunEl).toBeLessThan(4);
    expect(skyAt(800_000, s).aurora).toBe(1);
  });

  it('ranges: periodic ridgelines that rise as you descend', () => {
    for (const l of LAYERS) {
      expect(ridgeAt(l, 0)).toBeCloseTo(ridgeAt(l, Math.PI * 2), 6);
      for (let a = 0; a < 6.28; a += 0.05) expect(ridgeAt(l, a)).toBeGreaterThan(-35);
    }
    expect(liftAt(0)).toBe(0);
    expect(liftAt(1_000_000)).toBeCloseTo(1, 9);
    expect(liftAt(50_000)).toBeGreaterThan(0.2);
  });
});
