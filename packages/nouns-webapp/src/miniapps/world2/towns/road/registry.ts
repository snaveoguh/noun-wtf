// ── Road trip registry: every destination on the mountain, in one list ───
//
// For anything that wants to send you somewhere (the taxi / hitchhiker
// game, the map, signs): towns (the plaza, Noun Jersey, the line towns and
// the side towns), gas stations / truck stops / rest areas, and the wild +
// town landmarks. Read-only and deterministic: positions come from the
// grown line network, so every client gets the same numbers.
//
//   roadPlaces(grow?)       every place resolved so far (grow = true grows
//                           the lines as far as needed: menus and tests
//                           only, it can take a second the first time)
//   roadPlace(id, grow?)    one place, by id
//   placeDoors(id)          its enterable doors (interiors BuildingDoor:
//                           id, area, x/y/z, yaw, kind, name)
//
// Ids: `town:<TownId>` (city, jersey, cowboy, …, peak, pines, diesel),
// `station:<id>` (road/places.ts STATIONS), `landmark:<id>` (world/
// landmarks/sites.ts LANDMARKS). They never change.

import type { StationKind } from './places';
import type { BuildingDoor } from '../../interiors/contract';
import type { TownId, TownStyle } from '../../trade/contract';

import { njDoors, townDoors } from '../../interiors/townDoors';
import { TOWN_SPECS } from '../../trade/towns';
import { LANDMARKS, landmarkPlace } from '../../world/landmarks/sites';
import { NJ, njFrame, njFrameNow, njToWorld } from '../../world/mountain/nounJersey';
import { terrainHeight } from '../../world/mountain/terrain';
import { tracks } from '../../world/mountain/tracks';
import {
  CITY_PLACEMENT,
  GROWN_TOWNS,
  IN_TOWN_R,
  placementOf,
  townFrame,
  townFrameNow,
  type GrownTown,
} from '../site';

import { stationArea, stationDoors } from './doors';
import { sideTownFrame, stationFrame, stationGround, stationToWorld } from './pads';
import { STATIONS, isSideTown, marketNear } from './places';

export type PlaceKind = 'town' | 'station' | 'landmark';

export interface RoadPlace {
  id: string;
  kind: PlaceKind;
  /** Town style, station kind, or 'landmark'. */
  sub: TownStyle | StationKind | 'landmark';
  name: string;
  /** Trade town: the town itself, or the market a station / landmark is nearest along its line. */
  town: TownId;
  /** Main line (0 = the plaza) and along-track distance (m). */
  track: number;
  s: number;
  /** The place itself (market square, forecourt, landmark), world. */
  x: number;
  y: number;
  z: number;
  /** "You've arrived" radius (m). */
  r: number;
  /** Where to pull up: on the road (line) beside it, facing on down the line. */
  stop: { x: number; y: number; z: number; yaw: number };
  /** Interiors area its doors stream under (null: none). */
  area: string | null;
}

const _p = { x: 0, z: 0, h: 0, k: 0 };
const _w = { x: 0, z: 0 };

/** A point on main `track` at s (grows the line), on the road surface. */
function roadStop(track: number, s: number): RoadPlace['stop'] {
  const t = tracks.tracks.find(q => q.id === track && q.depth === 0)!;
  tracks.pointAt(t, s, _p);
  return { x: _p.x, y: terrainHeight(_p.x, _p.z), z: _p.z, yaw: _p.h };
}

function townPlace(id: TownId, grow: boolean): RoadPlace | null {
  const spec = TOWN_SPECS[id];
  if (id === 'city')
    return {
      id: 'town:city',
      kind: 'town',
      sub: 'city',
      name: spec.name,
      town: 'city',
      track: 0,
      s: 0,
      x: CITY_PLACEMENT.x,
      y: CITY_PLACEMENT.y,
      z: CITY_PLACEMENT.z,
      r: CITY_PLACEMENT.r,
      stop: { x: 0, y: 0, z: 0, yaw: 0 },
      area: 'plaza',
    };
  if (id === 'jersey') {
    const nj = grow ? njFrameNow() : njFrame();
    if (nj === null) return null;
    const c = njToWorld(nj, NJ.W / 2, NJ.L / 2, { x: 0, z: 0 });
    return {
      id: 'town:jersey',
      kind: 'town',
      sub: spec.style,
      name: spec.name,
      town: 'jersey',
      track: spec.track,
      s: spec.s,
      x: c.x,
      y: nj.P,
      z: c.z,
      r: 110,
      stop: roadStop(spec.track, spec.s),
      area: 'jersey',
    };
  }
  const gid = id as GrownTown;
  const f = grow ? townFrameNow(gid) : townFrame(gid);
  if (f === null) return null;
  const pl = placementOf(f);
  // Line towns: pull up on main street; side towns: at the spur junction
  const side = isSideTown(gid) ? sideTownFrame(gid, grow) : null;
  const stop =
    side !== null ? roadStop(spec.track, side.road.s) : { x: pl.x, y: pl.y, z: pl.z, yaw: f.yaw };
  return {
    id: `town:${id}`,
    kind: 'town',
    sub: spec.style,
    name: spec.name,
    town: id,
    track: spec.track,
    s: spec.s,
    x: pl.x,
    y: pl.y,
    z: pl.z,
    r: IN_TOWN_R,
    stop,
    area: `town:${id}`,
  };
}

function stationPlace(id: string, grow: boolean): RoadPlace | null {
  const st = STATIONS.find(q => q.id === id);
  if (st === undefined) return null;
  const f = stationFrame(id, grow);
  if (f === null) return null;
  const u = f.Lf / 2;
  stationToWorld(f, f.vmin + 12, u, _w);
  return {
    id: `station:${id}`,
    kind: 'station',
    sub: st.kind,
    name: st.name,
    town: marketNear(st.track, st.s),
    track: st.track,
    s: st.s,
    x: _w.x,
    y: stationGround(f, u),
    z: _w.z,
    r: Math.max(40, f.Lf * 0.6),
    stop: roadStop(st.track, st.s),
    area: stationArea(id),
  };
}

function landmarkPlaceOf(id: string, grow: boolean): RoadPlace | null {
  const def = LANDMARKS.find(q => q.id === id);
  if (def === undefined) return null;
  const p = landmarkPlace(def, grow);
  if (p === null) return null;
  const at = def.at;
  const onLine = 'track' in at;
  const spec = onLine ? null : TOWN_SPECS[at.town];
  const track = onLine ? at.track : spec!.track;
  const s = onLine ? at.s : spec!.s;
  return {
    id: `landmark:${id}`,
    kind: 'landmark',
    sub: 'landmark',
    name: def.name,
    town: onLine ? marketNear(track, s) : at.town,
    track,
    s,
    x: p.x,
    y: p.y ?? terrainHeight(p.x, p.z),
    z: p.z,
    r: p.r + 30,
    stop: onLine ? roadStop(track, s) : { x: p.x, y: p.y ?? 0, z: p.z, yaw: p.yaw },
    area: null,
  };
}

const TOWN_ORDER: TownId[] = ['city', 'jersey', ...GROWN_TOWNS];

/** Every place resolved so far (`grow`: resolve them all, growing the lines). */
export function roadPlaces(grow = false): RoadPlace[] {
  const out: RoadPlace[] = [];
  for (const id of TOWN_ORDER) {
    const p = townPlace(id, grow);
    if (p !== null) out.push(p);
  }
  for (const st of STATIONS) {
    const p = stationPlace(st.id, grow);
    if (p !== null) out.push(p);
  }
  for (const def of LANDMARKS) {
    const p = landmarkPlaceOf(def.id, grow);
    if (p !== null) out.push(p);
  }
  return out;
}

/** One place by id (`town:…`, `station:…`, `landmark:…`). */
export function roadPlace(id: string, grow = false): RoadPlace | null {
  const [kind, key] = id.split(':') as [string, string | undefined];
  if (key === undefined) return null;
  if (kind === 'town') return key in TOWN_SPECS ? townPlace(key as TownId, grow) : null;
  if (kind === 'station') return stationPlace(key, grow);
  if (kind === 'landmark') return landmarkPlaceOf(key, grow);
  return null;
}

/**
 * A place's enterable doors (door ids are stable: interiors seeds the room
 * from them). The plaza's come from the live level (game.interiors.doors()),
 * so its list here is empty.
 */
export function placeDoors(id: string): BuildingDoor[] {
  const [kind, key] = id.split(':') as [string, string | undefined];
  if (key === undefined) return [];
  if (kind === 'station') return stationDoors(key);
  if (kind !== 'town' || key === 'city') return [];
  if (key === 'jersey') {
    const nj = njFrameNow();
    return nj === null ? [] : njDoors(nj);
  }
  if (!(GROWN_TOWNS as string[]).includes(key)) return [];
  const f = townFrameNow(key as GrownTown);
  return f === null ? [] : townDoors(key as GrownTown, f);
}
