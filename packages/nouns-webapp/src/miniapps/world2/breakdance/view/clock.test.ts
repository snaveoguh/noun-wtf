import { describe, expect, it } from 'vitest';

import { beatTime, BeatClock, MoveTracker } from './clock';

describe('BeatClock', () => {
  it('runs at the bpm and locks onto the sim beat', () => {
    const c = new BeatClock();
    c.update(0, 0, 120);
    // 120 bpm = 2 beats a second; sim and view agree
    for (let i = 1; i <= 60; i++) c.update(1 / 60, i / 30, 120);
    expect(c.beat).toBeCloseTo(2, 3);
  });

  it('stays smooth between 20 Hz snapshots', () => {
    const c = new BeatClock();
    c.update(0, 0, 100);
    let last = 0;
    let maxStep = 0;
    for (let f = 1; f <= 300; f++) {
      const t = f / 60;
      // A snapshot every 3 frames, carrying the sim beat it was taken at
      const sim = Math.floor(f / 3) * (3 / 60) * (100 / 60);
      const b = c.update(1 / 60, sim, 100);
      maxStep = Math.max(maxStep, b - last);
      last = b;
      expect(Math.abs(b - (t * 100) / 60)).toBeLessThan(0.12);
    }
    // Never jumps more than ~one frame of beats (+ a correction)
    expect(maxStep).toBeLessThan((100 / 60 / 60) * 1.6);
  });

  it('snaps on a jump (new battle / seek)', () => {
    const c = new BeatClock();
    c.update(0, 10, 100);
    c.update(1 / 60, -8, 100);
    expect(c.beat).toBe(-8);
  });
});

describe('MoveTracker', () => {
  it('uses moveBeats when the sim gives it', () => {
    const m = new MoveTracker();
    m.observe('windmill', 0.25, 4, 11); // started at beat 10
    expect(m.startBeat).toBeCloseTo(10);
    const s = m.sample(12);
    expect(s.b).toBeCloseTo(2);
    expect(s.t).toBeCloseTo(0.5);
  });

  it('estimates the length from moveT when it does not', () => {
    const m = new MoveTracker();
    for (let b = 0; b <= 3; b += 0.05) m.observe('flare', b / 3, undefined, b);
    expect(m.n).toBeGreaterThan(2.7);
    expect(m.n).toBeLessThan(3.3);
  });

  it('a new move (or the same one again) gets a new key', () => {
    const m = new MoveTracker();
    m.observe('six_step', 0.1, 3, 0.3);
    const k0 = m.key;
    m.observe('six_step', 0.9, 3, 2.7);
    expect(m.key).toBe(k0);
    m.observe('six_step', 0.05, 3, 3.15); // restarted
    expect(m.key).toBe(k0 + 1);
    m.observe('windmill', 0, 4, 6);
    expect(m.key).toBe(k0 + 2);
    m.observe(null, 0, undefined, 10);
    expect(m.move).toBe(null);
  });

  it('beatTime places beats on the audio clock', () => {
    expect(beatTime(5, 0, 4, 0.5)).toBe(7);
    expect(beatTime(5, 2, 2, 0.5)).toBe(5);
  });
});
