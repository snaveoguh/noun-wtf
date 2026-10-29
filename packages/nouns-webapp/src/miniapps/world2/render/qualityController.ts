// ── Adaptive quality: step the render down (and back up) from frame times ──
//
// One controller for every auto tier (pure; Game feeds it and applies the
// rung it picks through Graphics.applyLite):
//   - phones ('low' on auto): render scale down to MIN_SCALE, then shadows
//     off, then the ink pass off (deviceTier.stepDown's ladder);
//   - desktop (medium / high): render scale in 0.25 steps down to a floor
//     (1.25 on a Retina screen: lower read as blurry), then SMAA off, then
//     a half-size shadow map. None of those relinks a material, so the
//     controller can step back up through all of them.
// It reads frame-time percentiles, not an average: the median catches a
// device that is simply too slow, the p95 one that keeps stuttering, and a
// lone hitch (a shader link, a GC) moves neither for long enough to count.
// It steps back up a rung after a long run of headroom, only where the
// rung above differs in render scale alone (turning shadows back on
// relinks every lit material: a hitch to dodge), and stops stepping up if
// it starts flip-flopping.

import type { LiteState } from './deviceTier';

import { percentile } from '../perf/perfStats';

import { stepDown } from './deviceTier';

export interface QualityTuning {
  /** Median frame ms above this is "too slow". */
  slowMs: number;
  /** p95 frame ms above this is "stuttering". */
  stutterMs: number;
  /** p95 frame ms under this is headroom (a rung back up would fit). */
  roomMs: number;
}

/**
 * Phones: under ~26 fps (not 30: iPhones in Low Power Mode cap at 30 and
 * that's playable, not a reason to strip the look).
 */
export const PHONE_TUNING: QualityTuning = { slowMs: 1000 / 26, stutterMs: 70, roomMs: 22 };
/** Desktop: under ~40 fps. */
export const DESKTOP_TUNING: QualityTuning = { slowMs: 25, stutterMs: 50, roomMs: 13 };

/** Seconds of bad frames before a step down (quicker while probing the first 20 s). */
export function downAfter(age: number): number {
  return age < 20 ? 2 : 4;
}
/** Seconds of headroom before a step back up. */
export const UP_AFTER = 12;
/** A step down this soon (s) after a step up counts as a flip. */
export const FLIP_WINDOW = 30;
/** Flips before stepping up stops for good. */
export const MAX_FLIPS = 2;

export interface QualityController {
  /** rungs[0] is the boot state; each next one is lighter. */
  rungs: LiteState[];
  at: number;
  tuning: QualityTuning;
  /** Seconds of bad / good windows in a row. */
  bad: number;
  good: number;
  /** Seconds since play started. */
  age: number;
  lastUp: number;
  flips: number;
  /** No more steps up (it was flip-flopping). */
  noUp: boolean;
  /** Scripts / tests: hold still. */
  frozen: boolean;
}

/** The phone ladder from `boot` (deviceTier.stepDown, rung by rung). */
export function phoneRungs(boot: LiteState): LiteState[] {
  const out = [boot];
  for (let s = stepDown(boot); s !== null; s = stepDown(s)) out.push(s);
  return out;
}

/**
 * Desktop: render scale in 0.25 steps down to the floor, then SMAA off,
 * then the shadow map at half size (not under 2048). Shadows and the ink
 * pass stay.
 */
export function desktopRungs(boot: LiteState, dpr: number): LiteState[] {
  const floor = dpr >= 2 ? 1.25 : 1;
  const out = [boot];
  let s = boot.scale;
  while (s - 0.25 >= floor - 1e-6) {
    s = +(s - 0.25).toFixed(2);
    out.push({ ...boot, scale: s });
  }
  let last = out[out.length - 1];
  if (boot.aa === true) out.push((last = { ...last, aa: false }));
  if (boot.shadowMap !== undefined && boot.shadowMap > 2048)
    out.push({ ...last, shadowMap: boot.shadowMap / 2 });
  return out;
}

/**
 * The tuning under a frame cap of `capFps` (0 = none). Frames come no
 * faster than the cap, so headroom means holding it (a 144 Hz display
 * alternates 2 and 3 vsyncs a frame at 60: up to ~21 ms), and a 30 fps cap
 * is no reason to step down.
 */
export function pacedTuning(t: QualityTuning, capFps: number): QualityTuning {
  if (!(capFps > 0)) return t;
  const iv = 1000 / capFps;
  return {
    slowMs: Math.max(t.slowMs, iv * 1.25),
    stutterMs: Math.max(t.stutterMs, iv * 2),
    roomMs: Math.max(t.roomMs, iv * 1.3),
  };
}

export function makeController(rungs: LiteState[], tuning: QualityTuning): QualityController {
  return {
    rungs,
    at: 0,
    tuning,
    bad: 0,
    good: 0,
    age: 0,
    lastUp: -Infinity,
    flips: 0,
    noUp: false,
    frozen: false,
  };
}

export interface FrameWindow {
  p50: number;
  p95: number;
}

/** p50 / p95 of a window of frame intervals (ms). */
export function frameWindow(ms: readonly number[]): FrameWindow {
  const s = [...ms].sort((a, b) => a - b);
  return { p50: percentile(s, 50), p95: percentile(s, 95) };
}

/** Rungs a and b differ only in what switches without relinking a material. */
function cheapSwitch(a: LiteState, b: LiteState): boolean {
  return a.shadows === b.shadows && a.post === b.post;
}

/**
 * Feed one window of frames covering `dt` seconds. Returns the rung to
 * apply now, or null to stay.
 */
export function qualityTick(c: QualityController, w: FrameWindow, dt: number): LiteState | null {
  c.age += dt;
  if (c.frozen) return null;
  const t = c.tuning;
  const bad = w.p50 > t.slowMs || w.p95 > t.stutterMs;
  const room = w.p95 < t.roomMs;
  c.bad = bad ? c.bad + dt : 0;
  c.good = room ? c.good + dt : 0;
  if (c.bad >= downAfter(c.age) && c.at < c.rungs.length - 1) {
    c.at++;
    c.bad = 0;
    c.good = 0;
    if (c.age - c.lastUp < FLIP_WINDOW && ++c.flips >= MAX_FLIPS) c.noUp = true;
    return c.rungs[c.at];
  }
  if (!c.noUp && c.at > 0 && c.good >= UP_AFTER && cheapSwitch(c.rungs[c.at], c.rungs[c.at - 1])) {
    c.at--;
    c.good = 0;
    c.bad = 0;
    c.lastUp = c.age;
    return c.rungs[c.at];
  }
  return null;
}
