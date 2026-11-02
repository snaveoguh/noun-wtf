// ── Doors at the gas stations, truck stops and rest areas ────────────────
//
// Same recipe as the towns' (interiors/townDoors.ts): the station's whole
// build runs into a recorder on a level copy of its frame, building-sized
// parts get doors facing the road (v' = 0), named by their signs (NOUN-MART
// → a shop, DINER → a cafe, MOTOR INN → a home…). Door heights then follow
// the forecourt's grade. Area id `road:<station id>`; computed once a
// session, the first time you come near.

import type { BuildingDoor } from '../../interiors/contract';

import { lookDoorPlanLocal, planToWorld, recordLook } from '../../interiors/townDoors';

import { buildAll } from './look';
import { stationFrame, stationGround } from './pads';
import { STATIONS } from './places';
import { stationLook } from './stations';

const cache = new Map<string, BuildingDoor[]>();

/** Interiors area id of a station. */
export const stationArea = (id: string) => `road:${id}`;

/** A station's doors in world space (null id / unresolvable → none). */
export function stationDoors(id: string): BuildingDoor[] {
  const hit = cache.get(id);
  if (hit !== undefined) return hit;
  const st = STATIONS.find(q => q.id === id);
  const f = st === undefined ? null : stationFrame(id, true);
  if (st === undefined || f === null) return [];
  const look = stationLook(st);
  const rec = recordLook({ signs: look.signs, build: b => buildAll(look, b) }, f);
  const plan = lookDoorPlanLocal(stationArea(id), f, rec);
  const out = planToWorld(plan, f, u => stationGround(f, u));
  cache.set(id, out);
  return out;
}
