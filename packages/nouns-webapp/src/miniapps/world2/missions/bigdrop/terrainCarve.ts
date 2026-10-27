// ── The Big Drop: the race track carved into the snow (pure, hot) ───────
//
// peakHeight (peakTerrain.ts) asks trackCarve about every sample (~25k a
// frame): far from the line it answers NaN at once (one compare, or one
// table read), near it the carving's height relative to the bare cone:
//
//   lane     groomed, 0.6 m sunk, no moguls, soft 12 m shoulders
//   powder   rolling pillows either side of the cruise sections
//   gully    a halfpipe 48 m lip to lip: a floor 9 m down, 13–20 m walls
//   berms    the outside of every slalom turn banked up 4–9 m
//   kickers  kickerShape (track.ts): a ramp, a lip, a long landing
//   loops    an exact plane under each loop (loopBase in track.ts)
//   course   the SSX course's extras (courseSpec.ts): whoops across the
//            lane, and THE SPLIT's shortcut, a second groomed lane with
//            its rock bore's trough, a gap kicker and a crevasse
//
// It also says how much of the mountain's own detail (moguls, ridges)
// survives there (`CARVED.keep`), so peakHeight can skip computing it on
// the lane. No allocation.

import type { LineSample } from './track';

import { smoothstep, vnoise } from '../../world/mountain/config';

import {
  BRANCH,
  CAVE_TROUGH,
  CAVES,
  COURSE,
  courseBulge,
  courseBulgeSlope,
  onBranch,
  ROLLERS,
} from './courseSpec';
import {
  branchKicker,
  CARVE,
  kickerProfile,
  kickerShape,
  lineAt,
  lineNear,
  loopBase,
  TRACK,
  X_BAND,
} from './track';

/** Side outputs of the last trackCarve call. */
export const CARVED = {
  /** 0..1: how much of the mountain's own detail to add on top. */
  keep: 1,
  /** Signed lateral offset from the line (m, + toward +x) and the lane half-width. */
  lateral: 0,
  half: 0,
};

const PILLOW_SEED = 0x70696c;
const ln: LineSample = { cx: 0, dcx: 0, w: 0, gully: 0, cruise: 0, feats: [] };

/** The powder pillows' noise at (x, z), −1..1: long along the fall line, rolling across it. */
export function pillowAt(x: number, z: number): number {
  return vnoise(x / 14, z / 45, PILLOW_SEED);
}

/**
 * The track's carving at (x, z) (peak coordinates) in m relative to the
 * bare cone (whose height there is `cone`), or NaN where the track doesn't
 * reach. Sets CARVED.
 */
export function trackCarve(x: number, z: number, cone: number): number {
  if (x > X_BAND || x < -X_BAND || z < TRACK.start || z > TRACK.end || !lineNear(x, z)) return NaN;
  lineAt(z, ln);
  const lat = (x - ln.cx) / Math.sqrt(1 + ln.dcx * ln.dcx);
  const a = lat < 0 ? -lat : lat;
  const half = ln.w * 0.5;
  const main = a > half + CARVE.reach ? NaN : mainCarve(x, z, cone, lat, a, half);
  if (z > COURSE.end || !onBranch(z)) return main;
  return withBranch(x, z, main);
}

/** The main line's carving (trackCarve without THE SPLIT's shortcut). */
function mainCarve(x: number, z: number, cone: number, lat: number, a: number, half: number) {
  CARVED.lateral = lat;
  CARVED.half = half;
  // Groomed lane, then the mountain's detail back in over the shoulder
  let off = -CARVE.sink * (1 - smoothstep(half, half + CARVE.shoulder, a));
  // (the detail is up to ~8 m tall: fading it in faster than this would
  // steepen the shoulder past what's rideable)
  let keep = smoothstep(half, half + CARVE.detailFade, a);
  // Powder pillows: long along the fall line, rolling across it
  if (a > half + 2 && ln.cruise > 0.01) {
    const band =
      ln.cruise *
      smoothstep(half + 2, half + 22, a) *
      (1 - smoothstep(half + 70, half + CARVE.reach, a));
    if (band > 0) off += band * CARVE.pillow * pillowAt(x, z);
  }
  // The gully's halfpipe
  if (ln.gully > 0) {
    // Walls wide enough that wall + fall line stays ground (normal > 0.55):
    // steepest (4/3 · depth / width) where the line points straight down
    const sin = Math.abs(ln.dcx) / Math.sqrt(1 + ln.dcx * ln.dcx);
    const ww = Math.min(
      CARVE.gullyHalf - 4,
      (CARVE.gullyDepth * 4) / 3 / Math.max(0.5, CARVE.gullyWallSlope - 1.15 * sin),
    );
    const fl = CARVE.gullyHalf - ww;
    let g = -CARVE.gullyDepth;
    if (a > fl) {
      const t = Math.min(1, (a - fl) / ww);
      // Concave nearly all the way up, rounding off just under the lip
      g *= 1 - t * t * (2 - t);
    }
    off += g * ln.gully;
  }
  const feats = ln.feats;
  for (let i = 0; i < feats.length; i++) {
    const f = feats[i]!;
    const u = z - f.s;
    if (f.kind === 'kicker') {
      if (u <= 0 || u >= f.len) continue;
      const k = kickerShape(f)!;
      const q = 1 - smoothstep(k.halfW, k.halfW + k.shoulder, a);
      if (q > 0) off += kickerProfile(k, u) * q;
    } else if (f.kind === 'berm') {
      if (u <= 0 || u >= f.len) continue;
      const along = smoothstep(0, 0.45 * f.len, u) * (1 - smoothstep(0.55 * f.len, f.len, u));
      // Banked up toward the outside of the turn, rounded over the top
      const o = lat * f.side;
      if (o <= -0.2 * half) continue;
      const r = Math.min(1, (o + 0.2 * half) / (1.2 * half));
      const fall = 1 - smoothstep(half - 1, half + 4 * f.size, o);
      off += f.size * along * r * r * fall;
      // Groomed all the way over the top
      keep *= 1 - along * fall;
    } else {
      const b = loopBase(f);
      if (u <= -b.lead || u >= f.len + b.lead) continue;
      const w =
        smoothstep(-b.lead, 0, u) *
        (1 - smoothstep(f.len, f.len + b.lead, u)) *
        (1 - smoothstep(b.half, b.half + 10, a));
      if (w <= 0) continue;
      const target = b.y0 + (z - b.z0) * b.grade - cone;
      off += (target - off) * w;
      keep *= 1 - w;
    }
  }
  // The SSX course's whoops
  if (z < COURSE.end)
    for (const r of ROLLERS) {
      if (r.line !== 'main' || z <= r.s0 || z >= r.s1) continue;
      const along = smoothstep(r.s0, r.s0 + r.wave, z) * (1 - smoothstep(r.s1 - r.wave, r.s1, z));
      const lane = 1 - smoothstep(half - 2, half + 8, a);
      off += r.amp * along * lane * 0.5 * (1 - Math.cos((2 * Math.PI * (z - r.s0)) / r.wave));
    }
  CARVED.keep = keep;
  return off;
}

/**
 * Signed lateral offset (m) of (x, z) from THE SPLIT's shortcut, given the
 * main line there (`l` = lineAt(z)). Only meaningful while onBranch(z).
 */
export function branchLateral(x: number, z: number, l: LineSample): number {
  const dxB = l.dcx - courseBulgeSlope(z);
  return (x - (l.cx - courseBulge(z))) / Math.sqrt(1 + dxB * dxB);
}

/** Whether (x, z) is in THE SPLIT's crevasse (across the shortcut). */
export function inCrevasse(z: number, aB: number): boolean {
  const k = branchKicker();
  const g0 = k.s + k.lip + BRANCH.gapFrom;
  return z > g0 && z < g0 + BRANCH.gapLen && aB < BRANCH.half + 8;
}

/**
 * Blend THE SPLIT's shortcut lane into the main carving `main` (NaN where
 * the main line doesn't reach): inside the shortcut and over its shoulder
 * the ground is the shortcut's own groomed lane (plus its rock bore's
 * trough and the crevasse), then its gap kicker on top.
 */
function withBranch(x: number, z: number, main: number): number {
  const latB = branchLateral(x, z, ln);
  const aB = latB < 0 ? -latB : latB;
  const halfB = BRANCH.half;
  const k = branchKicker();
  const ku = z - k.s;
  const kq = ku > 0 && ku < k.end ? 1 - smoothstep(k.halfW, k.halfW + k.shoulder, aB) : 0;
  // (taking over from the main line's shape over the first and last 80 m)
  const w =
    (1 - smoothstep(halfB, halfB + CARVE.shoulder, aB)) *
    smoothstep(BRANCH.s0, BRANCH.s0 + 80, z) *
    (1 - smoothstep(BRANCH.s1 - 80, BRANCH.s1, z));
  const g0 = k.s + k.lip + BRANCH.gapFrom;
  const g1 = g0 + BRANCH.gapLen;
  const across = z > g0 && z < g1 ? 1 - smoothstep(halfB, halfB + 40, aB) : 0;
  if (w <= 0 && kq <= 0 && across <= 0) return main;
  const m = main === main ? main : 0;
  const mk = main === main ? CARVED.keep : 1;
  // The shortcut's own lane
  let lane = -CARVE.sink * (1 - smoothstep(halfB, halfB + CARVE.shoulder, aB));
  for (const cv of CAVES) {
    if (cv.line !== 'branch' || !cv.trough || z <= cv.s0 - 40 || z >= cv.s1 + 40) continue;
    const along = smoothstep(cv.s0 - 40, cv.s0, z) * (1 - smoothstep(cv.s1, cv.s1 + 40, z));
    const t = Math.min(1, aB / cv.R);
    lane -= CAVE_TROUGH * along * (1 - t * t);
  }
  let off = m + (lane - m) * w;
  CARVED.keep = mk * (1 - w);
  // The crevasse after the gap kicker's lip: a steep drop (you're in the
  // air over it), a gentle climb out, sides you can ride out over
  if (across > 0) {
    const d = smoothstep(g0, g0 + 15, z) * (1 - smoothstep(g1 - 22, g1, z));
    off -= BRANCH.gapDepth * d * across;
    CARVED.keep *= 1 - across;
  }
  if (kq > 0) {
    off += kickerProfile(k, ku) * kq;
    CARVED.keep *= 1 - kq;
  }
  return off;
}
