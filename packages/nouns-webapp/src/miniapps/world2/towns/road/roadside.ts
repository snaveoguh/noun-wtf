// ── Roadside: distance signs, km posts, billboards along the mains (pure) ─
//
// Placed from the grown main lines alone, like everything else out there:
// a nominal along-track spot per item, nudged on (60 m at a time) past
// anything it would sit in (a town's or mega ramp's reserved stretch, a
// launch ramp's run-in and landing, a station's forecourt, a side town's
// junction, another line passing close), so every client puts every sign
// in the same place.
//
//   km      a little green post every km on the right (riding out): "KM 12"
//   dist    a green highway sign every 4 km on the right, facing riders
//           heading out: the next three places down the line and how far
//   back    every 8 km on the left, facing riders heading home: the plaza
//           and the last town passed
//   bb      a billboard every ~2.6 km, alternating sides, 26 m out
//
// Distances are along the line (what you'll actually ride), in km.

import type { TownId } from '../../trade/contract';

import { TOWN_SPECS } from '../../trade/towns';
import { MOUNTAIN } from '../../world/mountain/config';
import {
  BOWL_SITE,
  MEGA_SITE,
  SPOT_SITE,
  TOWN_SITE,
  TOWN_SITES,
  TRACK_STEP,
  tracks,
  type Track,
} from '../../world/mountain/tracks';

import { SIDE_TOWNS, STATIONS, STATION_PAD } from './places';

export type RoadsideKind = 'km' | 'dist' | 'back' | 'bb';

export interface RoadsideItem {
  /** Stable id: `<kind>:<track>:<n>`. */
  id: string;
  kind: RoadsideKind;
  track: number;
  /** Along-track spot (after nudging), its nominal spot, and which side (+1 = left riding out). */
  s: number;
  s0: number;
  side: 1 | -1;
  /** Lateral offset from the line's centre (m). */
  off: number;
  /** World position (on the line's frame; height from the terrain at build time). */
  x: number;
  z: number;
  /** World yaw the face looks along (toward the traffic that reads it). */
  yaw: number;
  /** Sign text rows (km / dist / back) or the billboard design key (bb). */
  rows: string[];
}

/** How far out the roadside goes (m along each main). */
export const ROADSIDE_MAX = 60_000;

const KM_STEP = 1000;
const DIST_STEP = 4000;
const DIST_FIRST = 2000;
const BACK_STEP = 8000;
const BACK_FIRST = 6000;
const BB_STEP = 2600;
const BB_FIRST = 1800;
const NUDGE = 60;
const TRIES = 6;

/** Billboard designs (road/signs.ts paints them). */
export const BILLBOARDS = [
  'bb-gas',
  'bb-icecream',
  'bb-noggles',
  'bb-fm',
  'bb-memevalue',
  'bb-respect',
  'bb-peak',
  'bb-lake',
  'bb-motel',
  'bb-daily',
  'bb-bowl',
  'bb-diesel',
] as const;

export interface Destination {
  name: string;
  /** Along-track distance of the place on its line. */
  s: number;
  kind: 'town' | 'station' | 'spot';
}

/** Places down each main, in along-track order (for the distance signs). */
export function destinations(track: number): Destination[] {
  const out: Destination[] = [];
  for (const ts of TOWN_SITES)
    if (ts.track === track)
      out.push({ name: TOWN_SPECS[ts.town as TownId].name, s: ts.at + 120, kind: 'town' });
  for (const st of SIDE_TOWNS)
    if (st.track === track) out.push({ name: TOWN_SPECS[st.id].name, s: st.s, kind: 'town' });
  for (const st of STATIONS)
    if (st.track === track)
      out.push({
        name: st.kind === 'gas' ? 'GAS' : st.kind === 'truckstop' ? 'TRUCK STOP' : 'REST AREA',
        s: st.s,
        kind: 'station',
      });
  if (track === SPOT_SITE.track)
    out.push({ name: 'Noun Jersey', s: TOWN_SPECS.jersey.s, kind: 'spot' });
  if (track === BOWL_SITE.track)
    out.push({ name: 'Noggle Bowl', s: BOWL_SITE.at + 60, kind: 'spot' });
  return out.sort((a, b) => a.s - b.s);
}

const km = (m: number) => Math.max(1, Math.round(m / 1000));

/** Rows for a distance sign at s: the next three places (stations only if nothing else is closer). */
export function distRows(track: number, s: number): string[] {
  const ahead = destinations(track).filter(d => d.s > s + 300);
  const firstStation = ahead.find(d => d.kind === 'station');
  const list = ahead.filter(d => d.kind !== 'station').slice(0, 3);
  // The next station too, if it comes before the third place
  if (firstStation !== undefined && firstStation.s - s < 6000) {
    list.splice(2, 1);
    list.push(firstStation);
  }
  const rows = list
    .sort((a, b) => a.s - b.s)
    .map(d => `${d.kind === 'station' ? d.name : d.name.toUpperCase()}  ${km(d.s - s)} KM`);
  return rows.length > 0 ? rows : ['NEXT TOWN  —'];
}

/** Rows for a homeward sign at s: the plaza, and the last town passed. */
export function backRows(track: number, s: number): string[] {
  const behind = destinations(track)
    .filter(d => d.kind !== 'station' && d.s < s - 300)
    .reverse();
  const rows = [`THE PLAZA  ${km(s)} KM`];
  if (behind[0] !== undefined)
    rows.unshift(`${behind[0].name.toUpperCase()}  ${km(s - behind[0].s)} KM`);
  return rows;
}

// ── Placement ──

const _p = { x: 0, z: 0, h: 0, k: 0 };
const _nt = { track: null as Track | null, d: 0, side: 0, s: 0, k: 0, weight: 0 };

/** Is along-track s on line t (with `off`, `side`) somewhere a sign can't go? */
function blocked(t: Track, s: number, side: number, off: number): boolean {
  tracks.ensureS(t, s + 400);
  for (const m of t.towns)
    if (s > m.s - TOWN_SITE.pre - 20 && s < m.s + TOWN_SITE.post + 20) return true;
  for (const m of t.megas)
    if (s > m.s - MEGA_SITE.pre - 20 && s < m.s + MEGA_SITE.post + 20) return true;
  for (const m of t.spots)
    if (s > m.s - SPOT_SITE.pre - 20 && s < m.s + SPOT_SITE.post + 20) return true;
  for (const m of t.bowls)
    if (s > m.s - BOWL_SITE.pre - 20 && s < m.s + BOWL_SITE.post + 20) return true;
  for (const r of t.ramps)
    if (s > r.s - r.spec.length - 60 && s < r.s + r.spec.land + 30) return true;
  for (const st of STATIONS)
    if (st.track === t.id && Math.abs(s - st.s) < STATION_PAD[st.kind].len / 2 + 40) return true;
  for (const st of SIDE_TOWNS) if (st.track === t.id && Math.abs(s - st.s) < 50) return true;
  // Another line passing close to where it would stand
  tracks.pointAt(t, s, _p);
  const rx = Math.cos(_p.h) * side;
  const rz = -Math.sin(_p.h) * side;
  const x = _p.x + rx * off;
  const z = _p.z + rz * off;
  tracks.nearest(x, z, _nt);
  for (let q = 0; q < tracks.nearCount; q++) {
    const e = tracks.near[q];
    if (e.track !== t && e.d < off + 14) return true;
  }
  return false;
}

function place(
  t: Track,
  kind: RoadsideKind,
  n: number,
  s0: number,
  side: 1 | -1,
  off: number,
  facing: 1 | -1,
  rows: string[],
): RoadsideItem | null {
  let s = s0;
  for (let i = 0; i < TRIES && blocked(t, s, side, off); i++) s += NUDGE;
  if (blocked(t, s, side, off)) return null;
  const p = tracks.pointAt(t, s, _p);
  const rx = Math.cos(p.h) * side;
  const rz = -Math.sin(p.h) * side;
  // facing −1: the face looks back up the line, at riders heading out
  const fx = Math.sin(p.h) * facing;
  const fz = Math.cos(p.h) * facing;
  return {
    id: `${kind}:${t.id}:${n}`,
    kind,
    track: t.id,
    s,
    s0,
    side,
    off,
    x: p.x + rx * off,
    z: p.z + rz * off,
    yaw: Math.atan2(fx, fz),
    rows,
  };
}

/**
 * A nominal spot for an item: everything but where exactly it ends up. Its
 * text comes from the nominal spot (a nudge of up to 360 m never changes a
 * km figure much), so a segment's atlas is known without placing anything.
 */
export interface RoadsideSlot {
  id: string;
  kind: RoadsideKind;
  track: number;
  n: number;
  s0: number;
  side: 1 | -1;
  off: number;
  facing: 1 | -1;
  rows: string[];
}

const slotCache = new Map<number, RoadsideSlot[]>();

/** Every slot on main `track` (pure, cheap: no line growth). */
export function roadsideSlots(track: number): readonly RoadsideSlot[] {
  const hit = slotCache.get(track);
  if (hit !== undefined) return hit;
  const out: RoadsideSlot[] = [];
  const edge = MOUNTAIN.trackHalf;
  const slot = (
    kind: RoadsideKind,
    n: number,
    s0: number,
    side: 1 | -1,
    off: number,
    facing: 1 | -1,
    rows: string[],
  ) => out.push({ id: `${kind}:${track}:${n}`, kind, track, n, s0, side, off, facing, rows });
  for (let s = KM_STEP; s <= ROADSIDE_MAX; s += KM_STEP)
    slot('km', s / KM_STEP, s, -1, edge + 2.2, -1, [`${km(s)}`]);
  for (let s = DIST_FIRST, n = 0; s <= ROADSIDE_MAX; s += DIST_STEP, n++)
    slot('dist', n, s, -1, edge + 4, -1, distRows(track, s));
  for (let s = BACK_FIRST, n = 0; s <= ROADSIDE_MAX; s += BACK_STEP, n++)
    slot('back', n, s, 1, edge + 4, 1, backRows(track, s));
  for (let s = BB_FIRST, n = 0; s <= ROADSIDE_MAX; s += BB_STEP, n++)
    slot('bb', n, s, n % 2 === 0 ? -1 : 1, 26, -1, [
      BILLBOARDS[(n * 7 + track * 3) % BILLBOARDS.length]!,
    ]);
  out.sort((a, b) => a.s0 - b.s0);
  slotCache.set(track, out);
  return out;
}

/** Placed items by slot id (null: no room for it anywhere near its spot). */
const placed = new Map<string, RoadsideItem | null>();

function mainLine(track: number): Track | undefined {
  return tracks.tracks.find(q => q.id === track && q.depth === 0);
}

/** Place one slot (cached; the result never depends on when it's asked). */
export function resolveSlot(sl: RoadsideSlot): RoadsideItem | null {
  if (placed.has(sl.id)) return placed.get(sl.id)!;
  const t = mainLine(sl.track);
  if (t === undefined) return null;
  const it = place(t, sl.kind, sl.n, sl.s0, sl.side, sl.off, sl.facing, sl.rows);
  placed.set(sl.id, it);
  return it;
}

const _q = { x: 0, z: 0, h: 0, k: 0 };

/**
 * Items that can stand in the box (chunk). Only slots whose nominal spot is
 * within reach of it are placed, so a chunk never grows the network far
 * ahead of where it is. `sMax`: along-track bound (the line's s at the box
 * is ≤ ~1.45 × its edge distance).
 */
export function roadsideIn(
  track: number,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  sMin: number,
  sMax: number,
): RoadsideItem[] {
  const t = mainLine(track);
  if (t === undefined) return [];
  const out: RoadsideItem[] = [];
  const reach = NUDGE * TRIES + 40;
  // Slots past what the line has grown can't be by this box: the network is
  // always grown out past anything being built (never grow it from here)
  const grown = t.done ? Infinity : t.s0 + (t.xs.length - 2) * TRACK_STEP;
  for (const sl of roadsideSlots(track)) {
    if (sl.s0 < sMin || sl.s0 > sMax || sl.s0 > grown) continue;
    tracks.pointAt(t, sl.s0, _q);
    if (_q.x < x0 - reach || _q.x > x1 + reach || _q.z < z0 - reach || _q.z > z1 + reach) continue;
    const it = resolveSlot(sl);
    if (it !== null && it.x >= x0 && it.x < x1 && it.z >= z0 && it.z < z1) out.push(it);
  }
  return out;
}

/** Every roadside item on main `track` with a nominal spot ≤ upTo (tests; grows the line). */
export function roadsideItems(track: number, upTo: number): RoadsideItem[] {
  const out: RoadsideItem[] = [];
  for (const sl of roadsideSlots(track)) {
    if (sl.s0 > upTo) continue;
    const it = resolveSlot(sl);
    if (it !== null) out.push(it);
  }
  return out.sort((a, b) => a.s - b.s);
}

/** Signs are painted per 10 km segment of a line (one small atlas each, built when needed). */
export const SEGMENT = 10_000;

export const segmentOf = (s: number) => Math.floor(s / SEGMENT);

/** A segment's text signs (km / dist / back) by nominal spot, for its atlas (no placing). */
export function segmentSlots(track: number, seg: number): RoadsideSlot[] {
  return roadsideSlots(track).filter(sl => sl.kind !== 'bb' && segmentOf(sl.s0) === seg);
}
