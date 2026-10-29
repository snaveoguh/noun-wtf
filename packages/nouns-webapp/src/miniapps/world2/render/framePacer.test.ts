import { describe, expect, it } from 'vitest';

import { capFps, effectiveFps, makePacer, pace } from './framePacer';

/** Run `secs` of a display at `hz` (optional jitter in ms); returns the run frames' clocks. */
function display(hz: number, fps: number, secs = 10, jitter = 0, seed = 1) {
  const p = makePacer();
  const runs: number[] = [];
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const n = Math.round(hz * secs);
  for (let i = 1; i <= n; i++) {
    const t = (i * 1000) / hz + rnd() * jitter;
    if (pace(p, t, fps)) runs.push(t);
  }
  return runs;
}

const gaps = (runs: number[]) => runs.slice(1).map((t, i) => t - runs[i]);

describe('pace', () => {
  it('uncapped runs every tick', () => {
    expect(display(144, 0, 2)).toHaveLength(288);
  });

  it.each([120, 144, 165, 240])('caps a %i Hz display at 60', hz => {
    const runs = display(hz, 60);
    expect(runs.length).toBeGreaterThanOrEqual(595);
    expect(runs.length).toBeLessThanOrEqual(601);
    // never two run frames on neighbouring ticks of a fast display
    expect(Math.min(...gaps(runs))).toBeGreaterThan(1000 / hz + 0.01);
  });

  it('runs exactly every other tick at 120 Hz, even with vsync jitter', () => {
    const g = gaps(display(120, 60, 10, 0.8));
    for (const x of g) expect(Math.round(x / (1000 / 120))).toBe(2);
  });

  it('a 144 Hz display alternates 2 and 3 ticks a frame', () => {
    const ticks = new Set(gaps(display(144, 60)).map(x => Math.round(x / (1000 / 144))));
    expect([...ticks].sort()).toEqual([2, 3]);
  });

  it.each([59.94, 60, 60.4, 61])('a %f Hz display at a 60 cap runs every tick', hz => {
    const runs = display(hz, 60, 30, 1);
    expect(runs.length).toBe(Math.round(hz * 30));
  });

  it('a machine that cannot reach the cap is never held back', () => {
    // 144 Hz panel but each frame takes ~20 ms: rAF fires every 3rd vsync
    const p = makePacer();
    let n = 0;
    for (let i = 1; i <= 432; i++) if (pace(p, i * 3 * (1000 / 144), 60)) n++;
    expect(n).toBe(432);
  });

  it('30 fps caps take every other tick of 60 Hz and every 4th-5th of 144 Hz', () => {
    expect(display(60, 30).length).toBeGreaterThanOrEqual(299);
    expect(display(60, 30).length).toBeLessThanOrEqual(301);
    const g = gaps(display(60, 30));
    for (const x of g) expect(Math.round(x / (1000 / 60))).toBe(2);
    const r = display(144, 30);
    expect(r.length).toBeGreaterThanOrEqual(299);
    expect(r.length).toBeLessThanOrEqual(301);
  });

  it('a long hitch does not cause a burst of catch-up frames', () => {
    const p = makePacer();
    const runs: number[] = [];
    const tick = (t: number) => pace(p, t, 60) && runs.push(t);
    for (let i = 1; i <= 144; i++) tick((i * 1000) / 144);
    runs.length = 0;
    // 400 ms with no ticks at all (a GC, a shader link), then the display again
    for (let i = 1; i <= 144; i++) tick(1400 + (i * 1000) / 144);
    expect(Math.min(...gaps(runs))).toBeGreaterThan(1000 / 144 + 0.01);
    expect(runs.length).toBeLessThanOrEqual(61);
  });

  it('a clock that jumps back does not stall the game', () => {
    const p = makePacer();
    let n = 0;
    for (let i = 1; i <= 144; i++) pace(p, 10_000 + (i * 1000) / 144, 60);
    for (let i = 1; i <= 144; i++) if (pace(p, (i * 1000) / 144, 60)) n++;
    expect(Math.abs(n - 60)).toBeLessThanOrEqual(1);
  });

  it('switching caps takes effect at once', () => {
    const p = makePacer();
    let n60 = 0;
    let n30 = 0;
    let t = 0;
    for (let i = 0; i < 144; i++) if (pace(p, (t += 1000 / 144), 60)) n60++;
    for (let i = 0; i < 144; i++) if (pace(p, (t += 1000 / 144), 30)) n30++;
    expect(Math.abs(n60 - 60)).toBeLessThanOrEqual(1);
    expect(Math.abs(n30 - 30)).toBeLessThanOrEqual(1);
  });
});

describe('caps', () => {
  it('maps settings to fps', () => {
    expect(capFps('30')).toBe(30);
    expect(capFps('60')).toBe(60);
    expect(capFps('max')).toBe(0);
  });

  it('the lowest cap that applies wins; 0 means none', () => {
    expect(effectiveFps(60, 0, 30)).toBe(30);
    expect(effectiveFps(0, 0)).toBe(0);
    expect(effectiveFps(0, 60)).toBe(60);
  });
});
