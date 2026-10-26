// Latency calibration: the median lateness, robust to a stray tap.

import { describe, expect, it } from 'vitest';

import { CALIB_KEY, calibrate, loadCalib, saveCalib } from './calibrate';

const clicks = Array.from({ length: 8 }, (_, i) => 1000 + i * 600);

describe('calibrate', () => {
  it('finds a steady lateness', () => {
    const taps = clicks.map((c, i) => c + 42 + (i % 2 === 0 ? 5 : -5));
    expect(calibrate(taps, clicks)).toEqual({ offsetMs: 42, spreadMs: 5, n: 8 });
  });

  it('early tappers get a negative offset; a stray tap and a missed click are fine', () => {
    const taps = clicks.filter((_, i) => i !== 3).map(c => c - 30);
    taps.push(clicks[5] + 290); // a double tap near the next click's half-way
    const r = calibrate(taps, clicks)!;
    expect(r.offsetMs).toBe(-30);
    expect(r.n).toBe(7);
  });

  it('needs at least 5 taps on the clicks', () => {
    expect(calibrate([1000, 1600, 2200], clicks)).toBeNull();
    expect(calibrate([], clicks)).toBeNull();
  });

  it('clamps nonsense and stores per browser', () => {
    const taps = clicks.map(c => c + 280);
    expect(calibrate(taps, clicks)!.offsetMs).toBe(250);
    saveCalib(37);
    expect(window.localStorage.getItem(CALIB_KEY)).toBe('37');
    expect(loadCalib()).toBe(37);
    saveCalib(0);
    expect(loadCalib()).toBe(0);
  });
});
