// ── Road trip: the towns and stops beside the main lines (pure data) ─────
//
// Everything here stands BESIDE a main dirt line, never on it: no stretch of
// line is reserved, so the network (and every older town, ramp and spot on
// it) stays exactly where it was. Spots were searched on the grown network
// (pads.test.ts re-checks them): no other line, launch ramp, mega ramp,
// town or landmark within reach.
//
//   side towns   a level pad `off` m to one side of the line, its own main
//                street parallel to it, joined to the line by a graded spur
//                road (pads.ts). They're full Noun Trade towns (trade/
//                towns.ts, TownSystem, doors, customers).
//   stations     gas stations, truck stops and rest areas right at the road
//                edge, on a forecourt that follows the road's grade.
//
// Coordinates: `track` is the main line id (1 = +Z DOWNHILL, 2 = +X MOUNTAIN,
// 3 = −X GO DOWN), `s` the along-track distance (m, 0 = the city), `side`
// +1 = left of travel riding out of town, −1 = right.
//
// Parallel sites kept clear: the golf course (−X, a few km out: nothing on
// line 3 before 15 km), the Puerto Noun ocean extension (line 2 between
// ~24 and ~31 km), the stadium (−Z: no main line goes there).

import type { TownId } from '../../trade/contract';

import { TOWN_SPECS } from '../../trade/towns';

export type SideTownId = 'peak' | 'pines' | 'diesel';

export interface SideTownSite {
  id: SideTownId;
  track: 1 | 2 | 3;
  /** Along-track distance of the spur junction (the middle of the town). */
  s: number;
  side: 1 | -1;
  /** Main street's offset from the line (m). */
  off: number;
  /** Pad reach either side of main street (near = toward the line). */
  near: number;
  far: number;
  /** Pad length along main street (m). */
  len: number;
  /** Hash salt (TownFrame.site.k), distinct from TOWN_SITES'. */
  k: number;
}

export const SIDE_TOWNS: readonly SideTownSite[] = [
  // Powder Peak: the ski village, only 3.6 km out (the highest town)
  { id: 'peak', track: 2, s: 3600, side: 1, off: 120, near: 40, far: 60, len: 180, k: 400 },
  // Loon Lake: pines round a lake, between the city and Noun Jersey
  { id: 'pines', track: 1, s: 14600, side: -1, off: 120, near: 40, far: 70, len: 180, k: 401 },
  // Diesel Flats: the desert truck-stop town, halfway down the long −X road
  { id: 'diesel', track: 3, s: 20500, side: -1, off: 120, near: 40, far: 60, len: 180, k: 402 },
];

export const SIDE_TOWN_IDS: SideTownId[] = SIDE_TOWNS.map(t => t.id);

export const isSideTown = (v: unknown): v is SideTownId =>
  typeof v === 'string' && (SIDE_TOWN_IDS as string[]).includes(v);

/** Terrace blends round a side town (smaller than the on-line towns'). */
export const SIDE_MARGIN = { up: 80, dn: 50, lat: 42 } as const;

/** Spur road from the line to a side town: width and side blend (m). */
export const SPUR = { half: 4.5, blend: 10 } as const;

// ── Stations ──

export type StationKind = 'gas' | 'truckstop' | 'rest';

export interface StationSite {
  id: string;
  kind: StationKind;
  name: string;
  track: 1 | 2 | 3;
  /** Along-track distance of the forecourt's middle. */
  s: number;
  side: 1 | -1;
}

export const STATIONS: readonly StationSite[] = [
  // +Z DOWNHILL
  { id: 'gas-1-5', kind: 'gas', name: 'Noun Gas', track: 1, s: 5600, side: 1 },
  { id: 'rest-1-8', kind: 'rest', name: 'Pixel Pines Rest Area', track: 1, s: 8000, side: -1 },
  {
    id: 'truck-1-23',
    kind: 'truckstop',
    name: 'Big Head Truck Stop',
    track: 1,
    s: 23400,
    side: -1,
  },
  { id: 'gas-1-34', kind: 'gas', name: 'Noun Gas', track: 1, s: 34200, side: 1 },
  // +X MOUNTAIN
  { id: 'gas-2-7', kind: 'gas', name: 'Last Chance Gas', track: 2, s: 7900, side: -1 },
  { id: 'truck-2-16', kind: 'truckstop', name: 'Noggle Truck Stop', track: 2, s: 16200, side: 1 },
  { id: 'rest-2-20', kind: 'rest', name: 'Halfway Rest Area', track: 2, s: 20500, side: -1 },
  { id: 'gas-2-43', kind: 'gas', name: 'Noun Gas', track: 2, s: 43500, side: 1 },
  // −X GO DOWN
  { id: 'gas-3-15', kind: 'gas', name: 'Noun Gas', track: 3, s: 15800, side: -1 },
  { id: 'rest-3-25', kind: 'rest', name: 'Dust Bowl Rest Area', track: 3, s: 25500, side: 1 },
  { id: 'truck-3-33', kind: 'truckstop', name: 'Lil Rig Truck Stop', track: 3, s: 33100, side: -1 },
  { id: 'gas-3-45', kind: 'gas', name: 'Noun Gas', track: 3, s: 45300, side: 1 },
];

/** Forecourt: length along the road, and how far it reaches from the line. */
export const STATION_PAD: Record<StationKind, { len: number; depth: number }> = {
  gas: { len: 56, depth: 40 },
  truckstop: { len: 96, depth: 56 },
  rest: { len: 60, depth: 36 },
};

/** Forecourt blends: road side (to the road edge), far side, ends (m). */
export const STATION_MARGIN = { road: 3, far: 26, ends: 16 } as const;

/** The trade town on main `track` nearest along-track s (the plaza when nothing is nearer). */
export function marketNear(track: number, s: number): TownId {
  let best: TownId = 'city';
  let d = s;
  for (const spec of Object.values(TOWN_SPECS))
    if (spec.track === track && Math.abs(spec.s - s) < d) {
      d = Math.abs(spec.s - s);
      best = spec.id;
    }
  return best;
}

/** The market a station's shops trade as (interiors' spend, the registry). */
export function stationMarket(id: string): TownId {
  const st = STATIONS.find(q => q.id === id);
  return st === undefined ? 'city' : marketNear(st.track, st.s);
}
