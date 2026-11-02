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

import {
  applyRoadPads,
  liveSideTowns,
  roadBlocked,
  setRoadNatural,
  sideTownFrame,
} from './road/pads';
import { SIDE_TOWNS, isSideTown, type SideTownId } from './road/places';

/** Towns on a reserved stretch of line (TOWN_SITES). */
export type LineTown = 'cowboy' | 'beach' | 'noggle' | 'shroom' | 'neon' | 'crater';
export const LINE_TOWNS: LineTown[] = ['cowboy', 'beach', 'noggle', 'shroom', 'neon', 'crater'];
/** Every grown town: the line towns plus the road trip's side towns (road/places.ts). */
export type GrownTown = LineTown | SideTownId;
export const GROWN_TOWNS: GrownTown[] = [...LINE_TOWNS, ...SIDE_TOWNS.map(t => t.id)];

export const isGrownTown = (v: unknown): v is GrownTown =>
  typeof v === 'string' && (GROWN_TOWNS as string[]).includes(v);

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
  // The weird towns are wider: blocks two deep either side of main street
  noggle: { near: 64, far: 64, lagoon: false },
  shroom: { near: 56, far: 72, lagoon: false },
  neon: { near: 66, far: 66, lagoon: false },
  crater: { near: 60, far: 84, lagoon: false },
  // Side towns (road/places.ts SIDE_TOWNS is what places them)
  peak: { near: 40, far: 60, lagoon: false },
  pines: { near: 40, far: 70, lagoon: true },
  diesel: { near: 40, far: 60, lagoon: false },
};

/** Lagoon extent (v', and u inset from the pad ends). */
export const LAGOON = { v0: 52, v1: 72, v2: 102, v3: 114, uIn0: 14, uIn1: 34 } as const;

/** A level-pad frame in town coords: what the builders and coordinate helpers need. */
export interface PadFrame {
  /** Origin at u = 0, forward + left unit vectors, heading. */
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

/** Lagoon / lake rectangle (v', and u inset from the pad ends): LAGOON's shape. */
export interface LakeSpec {
  v0: number;
  v1: number;
  v2: number;
  v3: number;
  uIn0: number;
  uIn1: number;
}

export interface TownFrame extends PadFrame {
  id: GrownTown;
  site: SpotSite;
  /** Terrace blends (default TOWN's M_UP / M_DN / M_LAT). */
  marg?: { up: number; dn: number; lat: number };
  /** Lagoon shape when `lagoon` (default LAGOON, Puerto Noun's). */
  lake?: LakeSpec;
}

/** Natural surface (no terraces), registered by terrain.ts (avoids an import cycle). */
let natural: ((x: number, z: number) => number) | null = null;

export function setTownNatural(fn: (x: number, z: number) => number) {
  natural = fn;
  setRoadNatural(fn);
}

const resolved = new Map<GrownTown, TownFrame>();
let frameList: TownFrame[] = [];
const _pp = { x: 0, z: 0, h: 0, k: 0 };
/** Main lines with towns, and how many of their sites have been resolved. */
const TOWN_TRACK_IDS = [...new Set(TOWN_SITES.map(q => q.track as number))];

/** The resolved frame, or null while its site isn't fixed yet (never grows the network). */
export function townFrame(id: GrownTown): TownFrame | null {
  const hit = resolved.get(id);
  if (hit !== undefined) return hit;
  if (isSideTown(id)) return adopt(sideTownFrame(id));
  liveFrames();
  return resolved.get(id) ?? null;
}

/** The frame, growing its line as far as needed (spawn, map, tests). */
export function townFrameNow(id: GrownTown): TownFrame | null {
  const hit = resolved.get(id);
  if (hit !== undefined) return hit;
  if (isSideTown(id)) return adopt(sideTownFrame(id, true));
  const site = tracks.town(id);
  return site === null ? null : resolve(id, site);
}

/** A side town's frame joins the list (road/pads.ts resolves it). */
function adopt(f: TownFrame | null): TownFrame | null {
  if (f === null || resolved.has(f.id)) return f;
  resolved.set(f.id, f);
  frameList = GROWN_TOWNS.map(q => resolved.get(q)).filter((q): q is TownFrame => !!q);
  return f;
}

function resolve(id: GrownTown, site: SpotSite): TownFrame {
  if (site.frame !== null) return site.frame as TownFrame;
  const nat = natural!;
  const L = LAYOUT[id as LineTown];
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
export function townCoords(f: PadFrame, x: number, z: number): TownCoords {
  const dx = x - f.ox;
  const dz = z - f.oz;
  _c.u = dx * f.fx + dz * f.fz;
  _c.vp = (dx * f.rx + dz * f.rz) * f.side;
  return _c;
}

/** Town coords (v' across, u down the line) → world x, z. */
export function townToWorld(f: PadFrame, vp: number, u: number, out: { x: number; z: number }) {
  const v = vp * f.side;
  out.x = f.ox + f.fx * u + f.rx * v;
  out.z = f.oz + f.fz * u + f.rz * v;
  return out;
}

/** World yaw of a direction given in town coords (dv' across, du down the line). */
export function townYaw(f: PadFrame, dvp: number, du: number): number {
  const x = f.rx * f.side * dvp + f.fx * du;
  const z = f.rz * f.side * dvp + f.fz * du;
  return Math.atan2(x, z);
}

/** Terrace blend weight (0 = natural … 1 = level pad). */
function padWeight(f: TownFrame, u: number, vp: number): number {
  const up = f.marg?.up ?? TOWN.M_UP;
  const dn = f.marg?.dn ?? TOWN.M_DN;
  const lat = f.marg?.lat ?? TOWN.M_LAT;
  const wu = smoothstep(-up, 0, u) * (1 - smoothstep(f.Lf, f.Lf + dn, u));
  if (wu <= 0) return 0;
  const wv = smoothstep(f.vmin - lat, f.vmin, vp) * (1 - smoothstep(f.vmax, f.vmax + lat, vp));
  return wu * wv;
}

/** Lagoon depth under the pad at (u, v') (0 outside it). */
export function lagoonDepth(f: PadFrame & { lake?: LakeSpec }, u: number, vp: number): number {
  if (!f.lagoon) return 0;
  const L = f.lake ?? LAGOON;
  const lu = smoothstep(L.uIn0, L.uIn1, u) * (1 - smoothstep(f.Lf - L.uIn1, f.Lf - L.uIn0, u));
  if (lu <= 0) return 0;
  const lv = smoothstep(L.v0, L.v1, vp) * (1 - smoothstep(L.v2, L.v3, vp));
  return TOWN.lagoonFloor * lu * lv;
}

/** Height of the town's ground at (u, v') where the pad is at full weight. */
export function townGround(f: PadFrame & { lake?: LakeSpec }, u: number, vp: number): number {
  return f.P - lagoonDepth(f, u, vp);
}

let fixedSites = 0;
let townLines: (typeof tracks.tracks)[number][] | null = null;

/** Frames resolved so far (cheap: checked on every terrain sample). */
function liveFrames(): TownFrame[] {
  if (resolved.size === GROWN_TOWNS.length) return frameList;
  // Side towns: resolved off their line as it grows (road/pads.ts)
  const sides = liveSideTowns();
  for (let i = 0; i < sides.length; i++) if (!resolved.has(sides[i].id)) adopt(sides[i]);
  if (townLines === null) {
    const found = TOWN_TRACK_IDS.map(id => tracks.tracks.find(q => q.id === id));
    if (found.some(q => q === undefined)) return frameList;
    townLines = found as (typeof tracks.tracks)[number][];
  }
  // Only resolve when some line has fixed a new site
  let n = 0;
  for (const t of townLines) n += t.towns.length;
  if (n <= fixedSites) return frameList;
  fixedSites = n;
  for (const t of townLines) {
    for (const site of t.towns) {
      const id = site.town as GrownTown;
      if (!resolved.has(id)) resolve(id, site);
    }
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
  // Gas stations' forecourts and the side towns' spur roads
  applyRoadPads(x, z, out);
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
  return roadBlocked(x, z);
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

/** `?spot=<town>` spawn: top of main street, on the line, facing down it. */
export function townSpawn(id: GrownTown): { x: number; y: number; z: number; yaw: number } | null {
  const f = townFrameNow(id);
  if (f === null) return null;
  const p = townToWorld(f, 0, 6, { x: 0, z: 0 });
  return { x: p.x, y: f.P + 0.05, z: p.z, yaw: townYaw(f, 0, 1) };
}
