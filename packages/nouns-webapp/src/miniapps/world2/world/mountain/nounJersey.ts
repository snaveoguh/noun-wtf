// ── Noun Jersey: the secret spot's terrace, frame + speed governor ──────
//
// One hidden neighbourhood skatepark in the whole world, ~19 km down the +Z
// DOWNHILL main (site: tracks.ts → SPOT_SITE; build: NounJerseyPark.ts).
// Pure + deterministic like terrain.ts (no three.js here).
//
// Frame: u runs along the (reserved, dead straight) line from the top of
// the level pad, v across it along r = (fz, −fx) — which points to the LEFT
// of travel — and v' = v · side is "into the park". The park
// itself lives in its own 2D coords: a = v' − V0 (across, from the kerb of
// Main St), b = u − U0 (downhill).
//
//        lane  verge   Main St  shops / houses / school / lot / park …
//   v' = 0     6.5      16 (a = 0) ………………………………………… 136 (a = W)
//
// The terrace is the mega ramp terrace again (terrain.ts → MEGA_PAD): a
// level pad at P, the natural height of the line at the pad's downhill end
// (u = Lf), blended into the hillside with smoothsteps. Along the line the
// surface therefore only ever goes down (a steep bit into the cut, level
// beside the park, then the slope again), so riding straight past costs a
// little speed on the flat but never blocks the line.

import { MOUNTAIN, edgeDistance, smoothstep } from './config';
import { SPOT_SITE, tracks, type SpotSite } from './tracks';

export const NJ = {
  /** Core (the neighbourhood): v' of its kerb edge, u of its top, size. */
  V0: 16,
  U0: 40,
  W: 120,
  L: 150,
  /** Level pad: lateral reach beyond the line / beyond the core (m). */
  vNear: MOUNTAIN.trackHalf + 4,
  sideClear: 10,
  /** Pad length (u) before / after nudging past any rise beyond it. */
  minLen: 235,
  maxLen: 250,
  /** Blend widths: uphill cut wall, downhill lip, sides (wider than a mega terrace's: a bigger cut). */
  M_UP: 90,
  M_DN: 50,
  M_LAT: 75,
  /** Speed governor: off the lane, braking down to the city's top speed in the core. */
  laneEdge: MOUNTAIN.trackHalf + 1.5,
  parkSpeed: 17,
  brake: 16,
} as const;

export interface NjFrame {
  site: SpotSite;
  /** Line centre at u = 0, forward + right unit vectors, heading. */
  ox: number;
  oz: number;
  fx: number;
  fz: number;
  rx: number;
  rz: number;
  yaw: number;
  /** +1: park on the r side (left of travel riding down), −1: the other side. */
  side: number;
  /** Pad level and the pad's downhill end (u). */
  P: number;
  Lf: number;
  /** Lateral (v') range of the level pad. */
  vmin: number;
  vmax: number;
  /** World AABB of everything the terrace touches (cheap reject). */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** Natural surface (no terraces), registered by terrain.ts (avoids an import cycle). */
let natural: ((x: number, z: number) => number) | null = null;

export function setNjNatural(fn: (x: number, z: number) => number) {
  natural = fn;
}

const _pp = { x: 0, z: 0, h: 0, k: 0 };

/** Cached once resolved (applyNjPad runs on every terrain sample). */
let resolved: NjFrame | null = null;

/**
 * The resolved frame, or null while the site isn't fixed yet (it always is
 * by the time anything within reach of it gets sampled: sampling there
 * grows every line well past SPOT_SITE.trigger).
 */
export function njFrame(): NjFrame | null {
  if (resolved !== null) return resolved;
  const t = tracks.tracks.find(q => q.id === SPOT_SITE.track);
  const site = t?.spots[0];
  if (site === undefined) return null;
  return resolve(site);
}

/** The frame, growing the line as far as needed (spawn, decorator). */
export function njFrameNow(): NjFrame | null {
  const site = tracks.spot();
  return site === null ? null : resolve(site);
}

function resolve(site: SpotSite): NjFrame {
  if (site.frame !== null) return site.frame as NjFrame;
  const nat = natural!;
  const o = tracks.pointAt(site.track, site.s, _pp);
  const ox = o.x;
  const oz = o.z;
  const yaw = o.h;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const rx = fz;
  const rz = -fx;
  const vmaxP = NJ.V0 + NJ.W + NJ.sideClear;
  // Side: hashed, flipped when another line passes within reach of that side
  const pref = (site.track.id * 7 + 3) % 2 === 0 ? 1 : -1;
  let side = pref;
  if (otherLineNear(site, ox, oz, fx, fz, pref, vmaxP)) {
    if (!otherLineNear(site, ox, oz, fx, fz, -pref, vmaxP)) side = -pref;
    else console.warn('[world2] noun jersey: lines on both sides, keeping', pref);
  }
  const at = (u: number, vp: number) =>
    nat(ox + fx * u + rx * vp * side, oz + fz * u + rz * vp * side);
  // Pad end: nudged on until the line beyond it never rises above the pad
  let Lf: number = NJ.minLen;
  let P = at(Lf, 0);
  for (let u = Lf + 5; u <= Lf + NJ.M_DN && Lf < NJ.maxLen; u += 5) {
    const n = at(u, 0);
    if (n > P) {
      Lf = Math.min(NJ.maxLen, u);
      P = at(Lf, 0);
    }
  }
  const vmin = -NJ.vNear;
  const vmax = vmaxP;
  // World AABB of the terrace incl. its blends
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const u of [-NJ.M_UP, Lf + NJ.M_DN])
    for (const vp of [vmin - NJ.M_LAT, vmax + NJ.M_LAT]) {
      const x = ox + fx * u + rx * vp * side;
      const z = oz + fz * u + rz * vp * side;
      x0 = Math.min(x0, x);
      z0 = Math.min(z0, z);
      x1 = Math.max(x1, x);
      z1 = Math.max(z1, z);
    }
  const f: NjFrame = {
    site,
    ox,
    oz,
    fx,
    fz,
    rx,
    rz,
    yaw,
    side,
    P,
    Lf,
    vmin,
    vmax,
    x0: x0 - 1,
    z0: z0 - 1,
    x1: x1 + 1,
    z1: z1 + 1,
  };
  site.frame = f;
  resolved = f;
  return f;
}

/**
 * Does another dirt line come within reach of this side's terrace? Checked
 * on the network grown out past the terrace (lines only move away from the
 * city, so this is the same on every client whatever was streamed first).
 */
function otherLineNear(
  site: SpotSite,
  ox: number,
  oz: number,
  fx: number,
  fz: number,
  side: number,
  vmax: number,
): boolean {
  const clear = 40;
  const u0 = -SPOT_SITE.pre - NJ.M_UP - clear;
  const u1 = NJ.maxLen + NJ.M_DN + clear;
  const va = -NJ.vNear - NJ.M_LAT - clear;
  const vb = vmax + NJ.M_LAT + clear;
  let far = 0;
  for (const u of [u0, u1])
    for (const vp of [va, vb])
      far = Math.max(far, edgeDistance(ox + fx * u + fz * vp * side, oz + fz * u - fx * vp * side));
  tracks.ensure(far);
  for (const t of tracks.tracks) {
    if (t === site.track) continue;
    for (let i = 0; i < t.xs.length; i++) {
      const dx = t.xs[i] - ox;
      const dz = t.zs[i] - oz;
      const u = dx * fx + dz * fz;
      const vp = (dx * fz - dz * fx) * side;
      if (u > u0 && u < u1 && vp > va && vp < vb) return true;
    }
  }
  return false;
}

export interface NjCoords {
  /** Along the line from the top of the pad, and into the park. */
  u: number;
  vp: number;
}

const _c: NjCoords = { u: 0, vp: 0 };

/** World → frame coords (reused object). */
export function njCoords(f: NjFrame, x: number, z: number): NjCoords {
  const dx = x - f.ox;
  const dz = z - f.oz;
  _c.u = dx * f.fx + dz * f.fz;
  _c.vp = (dx * f.rx + dz * f.rz) * f.side;
  return _c;
}

/** Park coords (a across from Main St's kerb line, b downhill) → world x, z. */
export function njToWorld(f: NjFrame, a: number, b: number, out: { x: number; z: number }) {
  const u = b + NJ.U0;
  const vp = (a + NJ.V0) * f.side;
  out.x = f.ox + f.fx * u + f.rx * vp;
  out.z = f.oz + f.fz * u + f.rz * vp;
  return out;
}

/** World yaw of a direction given in park coords (da across, db downhill). */
export function njYaw(f: NjFrame, da: number, db: number): number {
  // Park +a is world r · side, +b is world f; three's yaw maps local +Z to (sin, cos)
  const x = f.rx * f.side * da + f.fx * db;
  const z = f.rz * f.side * da + f.fz * db;
  return Math.atan2(x, z);
}

/** Terrace blend weight (0 = natural … 1 = level pad). */
function padWeight(f: NjFrame, u: number, vp: number): number {
  const wu = smoothstep(-NJ.M_UP, 0, u) * (1 - smoothstep(f.Lf, f.Lf + NJ.M_DN, u));
  if (wu <= 0) return 0;
  const wv =
    smoothstep(f.vmin - NJ.M_LAT, f.vmin, vp) * (1 - smoothstep(f.vmax, f.vmax + NJ.M_LAT, vp));
  return wu * wv;
}

/** terrain.ts → sampleTerrain: level the pad (after the mega ramp terraces). */
export function applyNjPad(x: number, z: number, out: { y: number; track: number }) {
  const f = njFrame();
  if (f === null || x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1) return;
  const c = njCoords(f, x, z);
  const w = padWeight(f, c.u, c.vp);
  if (w <= 0) return;
  out.y += w * (f.P - out.y);
}

/** Inside the neighbourhood itself (Main St to the back fence), grown by `margin`. */
export function njInCore(x: number, z: number, margin = 0): boolean {
  const f = njFrame();
  if (f === null || x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1) return false;
  const c = njCoords(f, x, z);
  const a = c.vp - NJ.V0;
  const b = c.u - NJ.U0;
  return a >= -margin && a <= NJ.W + margin && b >= -margin && b <= NJ.L + margin;
}

/** Keep-out for the mountain dressing: the level pad (plus the on-ramp), with a margin. */
export function njBlocked(x: number, z: number): boolean {
  const f = njFrame();
  if (f === null || x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1) return false;
  const c = njCoords(f, x, z);
  // Hand-painted sign + on-ramp come in from up the line, beside the lane
  if (c.u >= -110 && c.u < 0 && c.vp >= MOUNTAIN.trackHalf && c.vp <= NJ.V0 + 20) return true;
  return c.u >= -8 && c.u <= f.Lf + 8 && c.vp >= f.vmin && c.vp <= f.vmax + 8;
}

/**
 * Speed governor (m/s, Infinity = none). The mountain has no top speed, the
 * park is built for the city's 17 m/s: off the dirt lane (the line itself
 * is never governed) the cap brakes at `brake` m/s² down to the city's top
 * speed at the edge of the neighbourhood, so a rider peeling off the line
 * at 40 m/s at the top of the terrace rolls onto Main St at skatepark
 * speed (Jersey barriers keep the rest of the lane side closed). Like the
 * mega ramp, wherever it's finite the board rides with city physics.
 */
export function njSpeedLimit(x: number, _y: number, z: number): number {
  const f = njFrame();
  if (f === null || x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1) return Infinity;
  const c = njCoords(f, x, z);
  if (c.vp < NJ.laneEdge || c.u < -NJ.M_UP || c.u > f.Lf + NJ.M_DN) return Infinity;
  if (c.vp > f.vmax + NJ.M_LAT) return Infinity;
  // Fades in across the verge, so drifting to the edge of the lane at
  // speed is never caught by it (∞ at the lane edge, full at the kerb line)
  const t = smoothstep(NJ.laneEdge, NJ.V0 - 2, c.vp);
  if (t <= 0) return Infinity;
  const a = c.vp - NJ.V0;
  const b = c.u - NJ.U0;
  const da = a < 0 ? -a : a > NJ.W ? a - NJ.W : 0;
  const db = b < 0 ? -b : b > NJ.L ? b - NJ.L : 0;
  const d = Math.hypot(da, db);
  return Math.sqrt(NJ.parkSpeed * NJ.parkSpeed + 2 * NJ.brake * d) / t;
}

/** `?spot=nj` spawn: top of Main St, facing down it. */
export function njSpawn(): { x: number; y: number; z: number; yaw: number } | null {
  const f = njFrameNow();
  if (f === null) return null;
  const p = njToWorld(f, 6, 2, { x: 0, z: 0 });
  return { x: p.x, y: f.P + 0.05, z: p.z, yaw: njYaw(f, 0, 1) };
}
