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
//
// It also says how much of the mountain's own detail (moguls, ridges)
// survives there (`CARVED.keep`), so peakHeight can skip computing it on
// the lane. No allocation.

import type { LineSample } from './track';

import { smoothstep, vnoise } from '../../world/mountain/config';

import {
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
  if (a > half + CARVE.reach) return NaN;
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
  CARVED.keep = keep;
  return off;
}
