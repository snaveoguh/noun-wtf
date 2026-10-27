import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createRun,
  formatDelta,
  formatTime,
  loadCourseBest,
  type RunEvent,
  type RunState,
  saveCourseBest,
  stepRun,
} from './courseRun';
import { CHECKPOINTS, COURSE } from './courseSpec';

const yes = () => true;

/** Ride straight down at `v` m of s per second from `from` to `to`, 60 fps. */
function ride(r: RunState, from: number, to: number, v: number, through = yes) {
  const ev: RunEvent[] = [];
  const dt = 1 / 60;
  for (let s = from; s <= to; s += v * dt) stepRun(r, dt, s, through, ev);
  return ev;
}

describe('the SSX course run', () => {
  it('starts at the START gate, splits at every checkpoint, stops at the FINISH', () => {
    const r = createRun(null);
    expect(r.phase).toBe('ready');
    const ev = ride(r, 0, COURSE.finish + 50, 30);
    expect(ev[0]!.type).toBe('start');
    expect(ev.filter(e => e.type === 'checkpoint').length).toBe(CHECKPOINTS.length);
    const fin = ev.find(e => e.type === 'finish');
    expect(fin).toBeDefined();
    expect(r.phase).toBe('finished');
    // 30 m of s a second from the start gate to the finish
    expect(r.t).toBeCloseTo((COURSE.finish - COURSE.start) / 30, 1);
    expect(r.splits.length).toBe(CHECKPOINTS.length);
    for (let i = 0; i < CHECKPOINTS.length; i++)
      expect(r.splits[i]).toBeCloseTo((CHECKPOINTS[i]!.s - COURSE.start) / 30, 1);
    // A first run is a best
    expect(r.newBest).toBe(true);
    expect(r.best!.time).toBe(r.t);
  });

  it('times the crossing inside the frame, even crossing two gates in one step', () => {
    const r = createRun(null);
    const ev: RunEvent[] = [];
    stepRun(r, 0.1, COURSE.start - 1, yes, ev);
    stepRun(r, 0.1, COURSE.start + 1, yes, ev);
    expect(r.phase).toBe('running');
    const a = CHECKPOINTS[0]!.s;
    const b = CHECKPOINTS[1]!.s;
    stepRun(r, 1, a - 10, yes, ev);
    // One huge step over both
    stepRun(r, 1, b + 10, yes, ev);
    const cps = ev.filter(e => e.type === 'checkpoint');
    expect(cps.length).toBe(2);
    expect(r.next).toBe(2);
    // The first was crossed early in the step, the second late
    expect(r.splits[0]!).toBeLessThan(r.splits[1]!);
    expect(r.splits[1]!).toBeLessThanOrEqual(r.t);
  });

  it('splits against the best run, and only saves a faster one', () => {
    const r1 = createRun(null);
    ride(r1, 0, COURSE.finish + 50, 30);
    const best = r1.best!;
    // Slower: behind at every split, no new best
    const r2 = createRun(best);
    const ev = ride(r2, 0, COURSE.finish + 50, 25);
    for (const e of ev) if (e.type === 'checkpoint') expect(e.delta).toBeGreaterThan(0);
    const fin = ev.find(e => e.type === 'finish') as Extract<RunEvent, { type: 'finish' }>;
    expect(fin.newBest).toBe(false);
    expect(fin.delta).toBeGreaterThan(0);
    expect(r2.best).toBe(best);
    // Faster: ahead, and the new best
    const r3 = createRun(best);
    const ev3 = ride(r3, 0, COURSE.finish + 50, 40);
    for (const e of ev3) if (e.type === 'checkpoint') expect(e.delta).toBeLessThan(0);
    expect(r3.newBest).toBe(true);
    expect(r3.best!.time).toBeLessThan(best.time);
  });

  it('calls the run off if you go round a gate', () => {
    const r = createRun(null);
    const cp = CHECKPOINTS[1]!.s;
    const ev = ride(r, 0, COURSE.finish + 50, 30, () => true);
    expect(ev.some(e => e.type === 'missed')).toBe(false);
    const r2 = createRun(null);
    const ev2 = ride(r2, 0, COURSE.finish + 50, 30, () => r2.lastS < cp);
    const miss = ev2.find(e => e.type === 'missed') as Extract<RunEvent, { type: 'missed' }>;
    expect(miss.name).toBe(CHECKPOINTS[1]!.name);
    expect(r2.phase).toBe('missed');
    expect(ev2.some(e => e.type === 'finish')).toBe(false);
  });

  it('never starts unless you go through the START gate from the top', () => {
    const r = createRun(null);
    ride(r, 0, 300, 30, () => false);
    expect(r.phase).toBe('ready');
    // Dropping in below the gate doesn't start it either
    const r2 = createRun(null);
    ride(r2, COURSE.start + 300, 1000, 30);
    expect(r2.phase).toBe('ready');
  });

  it('arms a fresh run when you are back on the summit pad', () => {
    const r = createRun(null);
    ride(r, 0, 1500, 30);
    expect(r.phase).toBe('running');
    const ev: RunEvent[] = [];
    // R: back at the top
    stepRun(r, 1 / 60, 0, yes, ev);
    expect(ev[0]!.type).toBe('reset');
    expect(r.phase).toBe('ready');
    expect(r.t).toBe(0);
    expect(r.splits).toEqual([]);
    expect(ride(r, 0, 200, 30)[0]!.type).toBe('start');
  });

  it('formats times and splits', () => {
    expect(formatTime(0)).toBe('0:00.00');
    expect(formatTime(83.456)).toBe('1:23.46');
    expect(formatTime(NaN)).toBe('--:--.--');
    expect(formatDelta(1.234)).toBe('+1.23');
    expect(formatDelta(-0.5)).toBe('−0.50');
    expect(formatDelta(NaN)).toBe('');
  });
});

describe('the SSX course best (this device)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the best time and splits, and shrugs off junk', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    });
    expect(loadCourseBest()).toBeNull();
    saveCourseBest({ time: 151.2, splits: [30, 60, 90, 120], at: 1 });
    expect(loadCourseBest()).toEqual({ time: 151.2, splits: [30, 60, 90, 120], at: 1 });
    store.set('noun-bigdrop-ssx-v1', '{"time":-3}');
    expect(loadCourseBest()).toBeNull();
    store.set('noun-bigdrop-ssx-v1', 'not json');
    expect(loadCourseBest()).toBeNull();
  });
});
