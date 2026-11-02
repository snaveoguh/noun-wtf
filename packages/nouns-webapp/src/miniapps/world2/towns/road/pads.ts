// ── Road trip: where the side towns and stations sit (pure, no three.js) ─
//
// Two kinds of pad, both resolved from the grown line alone (the same on
// every client, whatever streamed first) and both kept off the line itself,
// so riding or driving the road never changes:
//
//   side town   a level TownFrame (towns/site.ts) `off` m beside the line,
//               its main street parallel to the line's heading at the
//               junction. site.ts levels it with the other towns' pads
//               (smaller blends: SIDE_MARGIN). A spur road runs from the
//               road edge straight across to the pad's near edge, graded
//               from the road's height to the pad's.
//   station     a forecourt from just off the road edge out to `depth`,
//               level ACROSS the road but following its grade ALONG it
//               (h = P + grade · u), so it meets the road everywhere: the
//               mountain falls ~12 m per 100 m along a line, which would
//               put a level forecourt metres above or below the road at
//               its ends.
//
// Frame (same as towns/site.ts): u down the line, v' across it with + on
// the pad's side (`side`), so the road is at v' ≈ 0 for a station and at
// v' = −off for a side town.

import type { PadFrame, TownFrame } from '../site';

import { MOUNTAIN, edgeDistance, smoothstep } from '../../world/mountain/config';
import { TRACK_STEP, tracks, type SpotSite, type Track } from '../../world/mountain/tracks';

import {
  SIDE_MARGIN,
  SIDE_TOWNS,
  SPUR,
  STATION_MARGIN,
  STATION_PAD,
  STATIONS,
  type SideTownId,
  type SideTownSite,
  type StationSite,
} from './places';

/** Natural surface (no pads), registered by site.ts. */
let natural: ((x: number, z: number) => number) | null = null;

export function setRoadNatural(fn: (x: number, z: number) => number) {
  natural = fn;
}

const _p = { x: 0, z: 0, h: 0, k: 0 };

/** Frames resolved so far, in resolution order (see refresh). */
let liveStations: StationFrame[] = [];
let liveSides: SideTownFrame[] = [];

function main(id: number): Track | null {
  return tracks.tracks.find(q => q.id === id && q.depth === 0) ?? null;
}

/** Has line `t` grown to along-track s (cheap; never grows it)? */
function grownTo(t: Track, s: number): boolean {
  return t.done || t.s0 + (t.xs.length - 1) * TRACK_STEP >= s;
}

interface Basis {
  ox: number;
  oz: number;
  fx: number;
  fz: number;
  rx: number;
  rz: number;
  yaw: number;
}

/** Tangent frame at along-track s, origin moved `back` m up the line and `off` m to the side. */
function basis(t: Track, s: number, side: number, back: number, off: number): Basis {
  const p = tracks.pointAt(t, s, _p);
  const yaw = p.h;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const rx = fz;
  const rz = -fx;
  return {
    ox: p.x - fx * back + rx * side * off,
    oz: p.z - fz * back + rz * side * off,
    fx,
    fz,
    rx,
    rz,
    yaw,
  };
}

function toWorld(
  f: Basis & { side: number },
  vp: number,
  u: number,
  out: { x: number; z: number },
) {
  const v = vp * f.side;
  out.x = f.ox + f.fx * u + f.rx * v;
  out.z = f.oz + f.fz * u + f.rz * v;
  return out;
}

function coords(f: Basis & { side: number }, x: number, z: number, out: { u: number; vp: number }) {
  const dx = x - f.ox;
  const dz = z - f.oz;
  out.u = dx * f.fx + dz * f.fz;
  out.vp = (dx * f.rx + dz * f.rz) * f.side;
  return out;
}

/** AABB of a (u, v') rectangle in world space. */
function aabb(f: Basis & { side: number }, u0: number, u1: number, v0: number, v1: number) {
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  const w = { x: 0, z: 0 };
  for (const u of [u0, u1])
    for (const vp of [v0, v1]) {
      toWorld(f, vp, u, w);
      x0 = Math.min(x0, w.x);
      z0 = Math.min(z0, w.z);
      x1 = Math.max(x1, w.x);
      z1 = Math.max(z1, w.z);
    }
  return { x0: x0 - 1, z0: z0 - 1, x1: x1 + 1, z1: z1 + 1 };
}

/** Grow every line out past this rectangle first, so `natural` sees the same lines everywhere. */
function growPast(f: Basis & { side: number }, u0: number, u1: number, v0: number, v1: number) {
  const w = { x: 0, z: 0 };
  let fd = 0;
  for (const u of [u0, u1])
    for (const vp of [v0, v1]) fd = Math.max(fd, edgeDistance(...xz(toWorld(f, vp, u, w))));
  tracks.ensure(fd + 100);
}

const xz = (w: { x: number; z: number }): [number, number] => [w.x, w.z];

// ── Side towns ──────────────────────────────────────────────────────────

/** Spur road: road edge → pad edge (world), graded from `ya` to `yb`. */
export interface Spur {
  ax: number;
  az: number;
  /** Unit direction (road → town) and length. */
  dx: number;
  dz: number;
  len: number;
  ya: number;
  yb: number;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/** A side town's frame: a TownFrame plus its spur road. */
export interface SideTownFrame extends TownFrame {
  spur: Spur;
  road: SideTownSite;
}

const sideFrames = new Map<SideTownId, SideTownFrame>();

/** Lake on Loon Lake's far side (v', u inset from the pad ends), like Puerto Noun's lagoon. */
export const PINES_LAKE = { v0: 18, v1: 28, v2: 56, v3: 64, uIn0: 26, uIn1: 42 } as const;

/**
 * A side town's frame, or null while its line hasn't grown that far.
 * `grow`: grow the line as far as needed (spawn, map, tests).
 */
export function sideTownFrame(id: SideTownId, grow = false): SideTownFrame | null {
  const hit = sideFrames.get(id);
  if (hit !== undefined) return hit;
  const st = SIDE_TOWNS.find(q => q.id === id);
  if (st === undefined || natural === null) return null;
  const t = main(st.track);
  if (t === null || (!grow && !grownTo(t, st.s + 60))) return null;
  const half = st.len / 2;
  const b = basis(t, st.s, st.side, half, st.off);
  const f0 = { ...b, side: st.side };
  growPast(
    f0,
    -SIDE_MARGIN.up,
    st.len + SIDE_MARGIN.dn,
    -st.near - SIDE_MARGIN.lat,
    st.far + SIDE_MARGIN.lat,
  );
  // Road edge at the junction, and the pad's near edge straight across
  const j = tracks.pointAt(t, st.s, _p);
  const dx = b.rx * st.side;
  const dz = b.rz * st.side;
  const ax = j.x + dx * MOUNTAIN.trackHalf;
  const az = j.z + dz * MOUNTAIN.trackHalf;
  const len = st.off - st.near - MOUNTAIN.trackHalf;
  const ya = natural(ax, az);
  // Pad level: the road's, nudged toward the ground it sits on (≤ 4 m of spur grade)
  const c = toWorld(f0, st.far / 2 - st.near / 2, half, { x: 0, z: 0 });
  const P = ya + Math.max(-4, Math.min(4, natural(c.x, c.z) - ya));
  const box = aabb(
    f0,
    -SIDE_MARGIN.up,
    st.len + SIDE_MARGIN.dn,
    -st.near - SIDE_MARGIN.lat,
    st.far + SIDE_MARGIN.lat,
  );
  const reach = SPUR.half + SPUR.blend;
  const ex = ax + dx * len;
  const ez = az + dz * len;
  const spur: Spur = {
    ax,
    az,
    dx,
    dz,
    len,
    ya,
    yb: P,
    x0: Math.min(ax, ex) - reach - 1,
    z0: Math.min(az, ez) - reach - 1,
    x1: Math.max(ax, ex) + reach + 1,
    z1: Math.max(az, ez) + reach + 1,
  };
  const site: SpotSite = { track: t, k: st.k, s: st.s, frame: null, town: st.id };
  const f: SideTownFrame = {
    id: st.id,
    site,
    ...b,
    side: st.side,
    P,
    Lf: st.len,
    vmin: -st.near,
    vmax: st.far,
    lagoon: st.id === 'pines',
    lake: st.id === 'pines' ? PINES_LAKE : undefined,
    marg: SIDE_MARGIN,
    x0: Math.min(box.x0, spur.x0),
    z0: Math.min(box.z0, spur.z0),
    x1: Math.max(box.x1, spur.x1),
    z1: Math.max(box.z1, spur.z1),
    spur,
    road: st,
  };
  site.frame = f;
  sideFrames.set(id, f);
  liveSides = [...liveSides, f];
  return f;
}

const _sc = { t: 0, d: 0 };

/** Where (x, z) is along / across a spur (t in metres from the road edge). */
function spurCoords(sp: Spur, x: number, z: number) {
  const px = x - sp.ax;
  const pz = z - sp.az;
  _sc.t = px * sp.dx + pz * sp.dz;
  _sc.d = Math.abs(px * sp.dz - pz * sp.dx);
  return _sc;
}

/** Height of the spur's surface at metres-from-the-road t. */
export function spurHeight(sp: Spur, t: number): number {
  return sp.ya + (sp.yb - sp.ya) * smoothstep(0, sp.len, t);
}

/** Grade the spur: eased in off the road edge (no step at the shoulder), full width onto the pad. */
function applySpur(sp: Spur, x: number, z: number, out: { y: number }) {
  if (x < sp.x0 || x > sp.x1 || z < sp.z0 || z > sp.z1) return;
  const c = spurCoords(sp, x, z);
  if (c.t <= 0 || c.t > sp.len + SPUR.blend) return;
  const wl = 1 - smoothstep(SPUR.half, SPUR.half + SPUR.blend, c.d);
  if (wl <= 0) return;
  // In over the first 10 m (the road edge stays the road's), out past the pad edge
  const wt = smoothstep(0, 10, c.t) * (1 - smoothstep(sp.len, sp.len + SPUR.blend, c.t));
  const w = wl * wt;
  if (w <= 0) return;
  out.y += w * (spurHeight(sp, Math.min(c.t, sp.len)) - out.y);
}

// ── Stations ────────────────────────────────────────────────────────────

/** A station's forecourt frame: PadFrame + grade (h = P + grade · u). */
export interface StationFrame extends PadFrame {
  st: StationSite;
  grade: number;
  /** Lift of the forecourt over the road's fitted grade line (m). */
  lift: number;
  /** Far-side and end blend widths (m): wider where the ground they meet is far off. */
  far: number;
  endUp: number;
  endDn: number;
}

const stationFrames = new Map<string, StationFrame>();

/** The station's frame, or null while its line hasn't grown that far (`grow` = grow it). */
export function stationFrame(id: string, grow = false): StationFrame | null {
  const hit = stationFrames.get(id);
  if (hit !== undefined) return hit;
  const st = STATIONS.find(q => q.id === id);
  if (st === undefined || natural === null) return null;
  const t = main(st.track);
  if (t === null || (!grow && !grownTo(t, st.s + 40))) return null;
  const pad = STATION_PAD[st.kind];
  const half = pad.len / 2;
  const b = basis(t, st.s, st.side, half, 0);
  const f0 = { ...b, side: st.side };
  growPast(f0, -40, pad.len + 40, -40, pad.depth + 40);
  // How far the line bows toward the forecourt along it (curves)
  let dev = 0;
  let sumU = 0;
  let sumY = 0;
  let sumUU = 0;
  let sumUY = 0;
  let n = 0;
  const cc = { u: 0, vp: 0 };
  const reach = half + STATION_MARGIN.ends + 10;
  for (let ds = -reach; ds <= reach; ds += 3) {
    const p = tracks.pointAt(t, st.s + ds, _p);
    coords(f0, p.x, p.z, cc);
    dev = Math.max(dev, cc.vp);
    if (ds < -half || ds > half) continue;
    // Road height along the forecourt: least-squares grade line
    const y = natural(p.x, p.z);
    sumU += cc.u;
    sumY += y;
    sumUU += cc.u * cc.u;
    sumUY += cc.u * y;
    n++;
  }
  const grade = (n * sumUY - sumU * sumY) / (n * sumUU - sumU * sumU);
  const P0 = (sumY - grade * sumU) / n;
  const lift = 0.12;
  const vmin = MOUNTAIN.trackHalf + dev + STATION_MARGIN.road + 0.5;
  const vmax = vmin + pad.depth;
  // Lines up to 45° off straight downhill: the slope behind the forecourt
  // can climb ~15 m, so the far blend widens to keep the cut ≲ 1 : 1
  let rise = 0;
  const ww = { x: 0, z: 0 };
  for (const u of [-STATION_MARGIN.ends, 0, pad.len / 2, pad.len, pad.len + STATION_MARGIN.ends])
    for (const dv of [0, 12, 24]) {
      toWorld(f0, vmax + dv, u, ww);
      rise = Math.max(
        rise,
        Math.abs(natural(ww.x, ww.z) - (P0 + lift + grade * u)) / (1 + dv / 24),
      );
    }
  const far = Math.min(64, Math.max(STATION_MARGIN.far, rise * 2.4));
  // Same for the ends: the ground past them needn't follow the road's grade
  const nat = natural;
  const endRise = (u: number) => {
    let r = 0;
    for (const vp of [vmin, (vmin + vmax) / 2, vmax, vmax + far / 2]) {
      toWorld(f0, vp, u, ww);
      r = Math.max(r, Math.abs(nat(ww.x, ww.z) - (P0 + lift + grade * u)));
    }
    return r;
  };
  const E = STATION_MARGIN.ends;
  const endUp = Math.min(70, Math.max(E, endRise(-E) * 2.4, endRise(-E * 2) * 1.6));
  const endDn = Math.min(
    70,
    Math.max(E, endRise(pad.len + E) * 2.4, endRise(pad.len + E * 2) * 1.6),
  );
  const box = aabb(f0, -endUp, pad.len + endDn, vmin - STATION_MARGIN.road, vmax + far);
  const f: StationFrame = {
    ...b,
    side: st.side,
    st,
    P: P0 + lift,
    grade,
    lift,
    far,
    endUp,
    endDn,
    Lf: pad.len,
    vmin,
    vmax,
    lagoon: false,
    ...box,
  };
  stationFrames.set(id, f);
  liveStations = [...liveStations, f];
  return f;
}

/** Forecourt height at u (world y). */
export function stationGround(f: StationFrame, u: number): number {
  return f.P + f.grade * u;
}

function stationWeight(f: StationFrame, u: number, vp: number): number {
  const M = STATION_MARGIN;
  const wu = smoothstep(-f.endUp, 0, u) * (1 - smoothstep(f.Lf, f.Lf + f.endDn, u));
  if (wu <= 0) return 0;
  return (
    wu * smoothstep(f.vmin - M.road, f.vmin, vp) * (1 - smoothstep(f.vmax, f.vmax + f.far, vp))
  );
}

// ── Live lists (cheap: checked on every terrain sample) ──

let mainLines: Track[] | null = null;
/** Total points on the three mains at the last look: only re-check when a main grew. */
let lastGrowth = -1;

function refresh() {
  if (liveStations.length === STATIONS.length && liveSides.length === SIDE_TOWNS.length) return;
  mainLines ??= [1, 2, 3].map(id => main(id)).filter((q): q is Track => q !== null);
  let g = 0;
  for (let i = 0; i < mainLines.length; i++) g += mainLines[i].xs.length;
  if (g === lastGrowth) return;
  lastGrowth = g;
  if (liveStations.length < STATIONS.length)
    for (const st of STATIONS) {
      if (!stationFrames.has(st.id)) stationFrame(st.id);
    }
  if (liveSides.length < SIDE_TOWNS.length)
    for (const st of SIDE_TOWNS) {
      if (!sideFrames.has(st.id)) sideTownFrame(st.id);
    }
}

/** Side towns resolved so far (site.ts folds them into its frame list). */
export function liveSideTowns(): readonly SideTownFrame[] {
  refresh();
  return liveSides;
}

/** Stations resolved so far. */
export function liveStationFrames(): readonly StationFrame[] {
  refresh();
  return liveStations;
}

const _c = { u: 0, vp: 0 };

/** terrain (via site.ts applyTownPads): the stations' forecourts and the side towns' spurs. */
export function applyRoadPads(x: number, z: number, out: { y: number }) {
  refresh();
  for (let i = 0; i < liveStations.length; i++) {
    const f = liveStations[i];
    if (x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1) continue;
    const c = coords(f, x, z, _c);
    const w = stationWeight(f, c.u, c.vp);
    if (w <= 0) continue;
    out.y += w * (stationGround(f, c.u) - out.y);
  }
  for (let i = 0; i < liveSides.length; i++) applySpur(liveSides[i].spur, x, z, out);
}

/** Keep-out for the mountain dressing: forecourts and spur roads (+ a margin). */
export function roadBlocked(x: number, z: number): boolean {
  refresh();
  for (let i = 0; i < liveStations.length; i++) {
    const f = liveStations[i];
    if (x < f.x0 || x > f.x1 || z < f.z0 || z > f.z1) continue;
    const c = coords(f, x, z, _c);
    if (c.u > -6 && c.u < f.Lf + 6 && c.vp > f.vmin - 4 && c.vp < f.vmax + 6) return true;
  }
  for (let i = 0; i < liveSides.length; i++) {
    const sp = liveSides[i].spur;
    if (x < sp.x0 || x > sp.x1 || z < sp.z0 || z > sp.z1) continue;
    const c = spurCoords(sp, x, z);
    if (c.t > -2 && c.t < sp.len + 4 && c.d < SPUR.half + 4) return true;
  }
  return false;
}

/** Station coords → world (x, z) (reused by the builders and the registry). */
export function stationToWorld(
  f: StationFrame,
  vp: number,
  u: number,
  out: { x: number; z: number },
) {
  return toWorld(f, vp, u, out);
}

/** World → station / town-style coords. */
export function padCoords(f: PadFrame, x: number, z: number, out = { u: 0, vp: 0 }) {
  return coords(f, x, z, out);
}

/**
 * `?spot=<station id>` (dev): on the road 40 m before the station, facing on
 * down the line. Null for anything else.
 */
export function stationSpawn(
  spot: string | null,
): { x: number; y: number; z: number; yaw: number } | null {
  const st = STATIONS.find(q => q.id === spot);
  if (st === undefined || natural === null) return null;
  const t = main(st.track);
  if (t === null) return null;
  const p = tracks.pointAt(t, st.s - STATION_PAD[st.kind].len / 2 - 40, _p);
  return { x: p.x, y: natural(p.x, p.z) + 0.05, z: p.z, yaw: p.h };
}
