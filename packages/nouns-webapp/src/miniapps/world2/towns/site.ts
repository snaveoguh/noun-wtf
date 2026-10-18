// ── Noun Trade towns: terrace, frame, keep-outs (pure, no three.js) ──────
//
// Dry Gulch and Puerto Noun sit ON a main line (sites: tracks.ts →
// TOWN_SITES), the way Noun Jersey sits beside one: the line's stretch is
// reserved (dead straight, no launch ramps, no forks, no mega ramp) and a
// level pad is cut into the slope around it, so the dirt line itself is
// the town's main street and stays rideable / drivable straight through.
//
// Frame (same as nounJersey.ts): u runs down the line from the top of the
// pad, v across it along r = (fz, −fx) (LEFT of travel), v' = v · side.
// The +v' side is the town's "far" side (Dry Gulch's saloon row, Puerto
// Noun's beach + lagoon); −v' is the near side (shops / shacks).
//
//      near side      street (the line)        far side
//   v' = −46 …… −10   −6.5 ……… 0 ……… 6.5    10 …… 46 (cowboy) / 118 (beach)
//
// Puerto Noun's pad also has a shallow lagoon cut into its far side (floor
// 1.7 m under the pad, water at 0.7 m), rimmed by sand at pad level, so its
// water plane (build.ts) is hidden under the rim everywhere it ends.
//
// Run proofs (netlify/lib/runProof.ts) only bound ground samples to a band
// around the radial gradient: a level pad 240 m long is ~30 m under the
// slope at its top end, well inside it, and riding down the line the
// surface only ever goes down or stays level (the pad end is nudged past
// any rise beyond it, exactly like Noun Jersey's), so no free energy.

import type { TownPlacement } from '../trade/contract';

import { MOUNTAIN, edgeDistance, smoothstep } from '../world/mountain/config';
import { TOWN_SITES, tracks, type SpotSite } from '../world/mountain/tracks';

export type GrownTown = 'cowboy' | 'beach';
export const GROWN_TOWNS: GrownTown[] = ['cowboy', 'beach'];

export const TOWN = {
  /** Uphill cut wall, downhill lip, side blends (m). */
  M_UP: 90,
  M_DN: 50,
  M_LAT: 60,
  /** Pad length (u) before / after nudging past any rise beyond it. */
  minLen: 235,
  maxLen: 250,
  /** Lagoon (beach): floor and water level under the pad (m). */
  lagoonFloor: 1.7,
  waterDown: 0.7,
} as const;

/** Lateral reach of the level pad: near side (−v') and far side (+v'). */
export const LAYOUT: Record<GrownTown, { near: number; far: number; lagoon: boolean }> = {
  cowboy: { near: 46, far: 46, lagoon: false },
  beach: { near: 44, far: 118, lagoon: true },
};

/** Lagoon extent (v', and u inset from the pad ends). */
export const LAGOON = { v0: 52, v1: 72, v2: 102, v3: 114, uIn0: 14, uIn1: 34 } as const;

export interface TownFrame {
  id: GrownTown;
  site: SpotSite;
  /** Line centre at u = 0, forward + left unit vectors, heading. */
  ox: number;
  oz: number;
  fx: number;
  fz: number;
  rx: number;
  rz: number;
  yaw: number;
  /** +1: far side on r (left of travel riding down), −1: on the right. */
  side: number;
  /** Pad level and the pad's downhill end (u). */
  P: number;
  Lf: number;
  /** v' range of the level pad. */
  vmin: number;
  vmax: number;
  lagoon: boolean;
  /** World AABB of everything the terrace touches. */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** Natural surface (no terraces), registered by terrain.ts (avoids an import cycle). */
let natural: ((x: number, z: number) => number) | null = null;

export function setTownNatural(fn: (x: number, z: number) => number) {
  natural = fn;
}

const resolved = new Map<GrownTown, TownFrame>();
let frameList: TownFrame[] = [];
const _pp = { x: 0, z: 0, h: 0, k: 0 };
let townTrack: (typeof tracks.tracks)[number] | null = null;

/** The resolved frame, or null while its site isn't fixed yet (never grows the network). */
export function townFrame(id: GrownTown): TownFrame | null {
  const hit = resolved.get(id);
  if (hit !== undefined) return hit;
  liveFrames();
  return resolved.get(id) ?? null;
}

/** The frame, growing its line as far as needed (spawn, map, tests). */
export function townFrameNow(id: GrownTown): TownFrame | null {
  const hit = resolved.get(id);
  if (hit !== undefined) return hit;
  const site = tracks.town(id);
  return site === null ? null : resolve(id, site);
}

function resolve(id: GrownTown, site: SpotSite): TownFrame {
  if (site.frame !== null) return site.frame as TownFrame;
  const nat = natural!;
  const L = LAYOUT[id];
  const o = tracks.pointAt(site.track, site.s, _pp);
  const ox = o.x;
  const oz = o.z;
  const yaw = o.h;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const rx = fz;
  const rz = -fx;
  // Far side: hashed, flipped when another line passes within reach of it
  const pref = (site.track.id * 5 + site.k) % 2 === 0 ? 1 : -1;
  let side = pref;
  if (otherLineNear(site, ox, oz, fx, fz, pref, L.near, L.far)) {
    if (!otherLineNear(site, ox, oz, fx, fz, -pref, L.near, L.far)) side = -pref;
    else console.warn('[world2] town', id, ': lines on both sides, keeping', pref);
  }
  const at = (u: number) => nat(ox + fx * u, oz + fz * u);
  // Pad end: nudged on until the line beyond it never rises above the pad
  let Lf: number = TOWN.minLen;
  let P = at(Lf);
  for (let u = Lf + 5; u <= Lf + TOWN.M_DN && Lf < TOWN.maxLen; u += 5) {
    const n = at(u);
    if (n > P) {
      Lf = Math.min(TOWN.maxLen, u);
      P = at(Lf);
    }
  }
  const vmin = -L.near;
  const vmax = L.far;
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const u of [-TOWN.M_UP, Lf + TOWN.M_DN])
    for (const vp of [vmin - TOWN.M_LAT, vmax + TOWN.M_LAT]) {
      const x = ox + fx * u + rx * vp * side;
      const z = oz + fz * u + rz * vp * side;
      x0 = Math.min(x0, x);
      z0 = Math.min(z0, z);
      x1 = Math.max(x1, x);
      z1 = Math.max(z1, z);
    }
  const f: TownFrame = {
    id,
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
    lagoon: L.lagoon,
    x0: x0 - 1,
    z0: z0 - 1,
    x1: x1 + 1,
    z1: z1 + 1,
  };
  site.frame = f;
  resolved.set(id, f);
  frameList = GROWN_TOWNS.map(q => resolved.get(q)).filter((q): q is TownFrame => !!q);
  return f;
}

/**
 * Does another dirt line come within reach of the terrace (with this far
 * side)? Checked on the network grown out past the terrace, so it's the
 * same on every client whatever streamed first (see nounJersey.ts).
 */
function otherLineNear(
  site: SpotSite,
  ox: number,
  oz: number,
  fx: number,
  fz: number,
  side: number,
  near: number,
  far: number,
): boolean {
  // The terrace's footprint (cut, pad, blends) plus a margin: lines further
  // off never touch it (a branch alongside the reserved run-in is fine)
  const clear = 20;
  const u0 = -TOWN.M_UP - clear;
  const u1 = TOWN.maxLen + TOWN.M_DN + clear;
  const va = -near - TOWN.M_LAT - clear;
  const vb = far + TOWN.M_LAT + clear;
  let fd = 0;
  for (const u of [u0, u1])
    for (const vp of [va, vb])
      fd = Math.max(fd, edgeDistance(ox + fx * u + fz * vp * side, oz + fz * u - fx * vp * side));
  tracks.ensure(fd);
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

export interface TownCoords {
  /** Down the line from the top of the pad, and across (+ = far side). */
  u: number;
  vp: number;
}

const _c: TownCoords = { u: 0, vp: 0 };

/** World → town coords (reused object). */
export function townCoords(f: TownFrame, x: number, z: number): TownCoords {
  const dx = x - f.ox;
  const dz = z - f.oz;
  _c.u = dx * f.fx + dz * f.fz;
  _c.vp = (dx * f.rx + dz * f.rz) * f.side;
  return _c;
}

/** Town coords (v' across, u down the line) → world x, z. */
export function townToWorld(f: TownFrame, vp: number, u: number, out: { x: number; z: number }) {
  const v = vp * f.side;
  out.x = f.ox + f.fx * u + f.rx * v;
  out.z = f.oz + f.fz * u + f.rz * v;
  return out;
}

/** World yaw of a direction given in town coords (dv' across, du down the line). */
export function townYaw(f: TownFrame, dvp: number, du: number): number {
  const x = f.rx * f.side * dvp + f.fx * du;
  const z = f.rz * f.side * dvp + f.fz * du;
  return Math.atan2(x, z);
}

/** Terrace blend weight (0 = natural … 1 = level pad). */
function padWeight(f: TownFrame, u: number, vp: number): number {
  const wu = smoothstep(-TOWN.M_UP, 0, u) * (1 - smoothstep(f.Lf, f.Lf + TOWN.M_DN, u));
  if (wu <= 0) return 0;
  const wv =
    smoothstep(f.vmin - TOWN.M_LAT, f.vmin, vp) * (1 - smoothstep(f.vmax, f.vmax + TOWN.M_LAT, vp));
  return wu * wv;
}

/** Lagoon depth under the pad at (u, v') (0 outside it). */
export function lagoonDepth(f: TownFrame, u: number, vp: number): number {
  if (!f.lagoon) return 0;
  const lu =
    smoothstep(LAGOON.uIn0, LAGOON.uIn1, u) *
    (1 - smoothstep(f.Lf - LAGOON.uIn1, f.Lf - LAGOON.uIn0, u));
  if (lu <= 0) return 0;
  const lv = smoothstep(LAGOON.v0, LAGOON.v1, vp) * (1 - smoothstep(LAGOON.v2, LAGOON.v3, vp));
  return TOWN.lagoonFloor * lu * lv;
}

/** Height of the town's ground at (u, v') where the pad is at full weight. */
export function townGround(f: TownFrame, u: number, vp: number): number {
  return f.P - lagoonDepth(f, u, vp);
}

/** Frames resolved so far (cheap: checked on every terrain sample). */
function liveFrames(): TownFrame[] {
  if (resolved.size === GROWN_TOWNS.length) return frameList;
  townTrack ??= tracks.tracks.find(q => q.id === TOWN_SITES[0].track) ?? null;
  // (both towns sit on one line: only resolve when it has fixed a new site)
  if (townTrack === null || townTrack.towns.length <= resolved.size) return frameList;
  for (const site of townTrack.towns) {
    const id = site.town as GrownTown;
    if (!resolved.has(id)) resolve(id, site);
  }
  return frameList;
}

/** terrain.ts → sampleTerrain: level the towns' pads (last: may re-query the network). */
export function applyTownPads(x: number, z: number, out: { y: number }) {
  const list = liveFrames();
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    if (x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1) continue;
    const c = townCoords(f, x, z);
    const w = padWeight(f, c.u, c.vp);
    if (w <= 0) continue;
    out.y += w * (townGround(f, c.u, c.vp) - out.y);
  }
}

/** Keep-out for the mountain dressing (trees, rocks, ponds, hill houses): the pad + entrance sign. */
export function townBlocked(x: number, z: number): boolean {
  const list = liveFrames();
  for (let i = 0; i < list.length; i++) {
    const f = list[i];
    if (x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1) continue;
    const c = townCoords(f, x, z);
    if (c.u >= -40 && c.u < 0 && Math.abs(c.vp) <= 16) return true;
    if (c.u >= -10 && c.u <= f.Lf + 10 && c.vp >= f.vmin - 8 && c.vp <= f.vmax + 8) return true;
  }
  return false;
}

// ── Placements (TownsApi) ──

/** "In town" radius around the market square (middle of main street). */
export const IN_TOWN_R = 140;

const _w = { x: 0, z: 0 };

export function placementOf(f: TownFrame): TownPlacement {
  const c = townToWorld(f, 0, f.Lf / 2, _w);
  return { id: f.id, x: c.x, z: c.z, y: f.P, r: IN_TOWN_R };
}

/** The city plaza: the summit square inside the ring of buildings. */
export const CITY_PLACEMENT: TownPlacement = { id: 'city', x: 0, z: 0, y: 0, r: MOUNTAIN.wallZ };

/** `?spot=cowboy` / `?spot=beach` spawn: top of main street, on the line, facing down it. */
export function townSpawn(id: GrownTown): { x: number; y: number; z: number; yaw: number } | null {
  const f = townFrameNow(id);
  if (f === null) return null;
  const p = townToWorld(f, 0, 6, { x: 0, z: 0 });
  return { x: p.x, y: f.P + 0.05, z: p.z, yaw: townYaw(f, 0, 1) };
}
