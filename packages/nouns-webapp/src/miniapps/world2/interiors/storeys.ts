// ── Upstairs: how many floors a building has, what they're for, the stairs ─
//
// Pure. A building gets about one storey per 3.5 m of its real height (at
// most 3); the bigger shops, cafes, homes, studios and galleries get at least
// two. Every floor shares the ground floor's plan (w × d) and sits one
// storey (ceiling + SLAB) above the last. A straight flight runs along a
// side wall from front to back, rising STAIR_SLOPE (it's a ramp underfoot,
// steps to look at); flights alternate sides, so a floor's stairwell (the
// hole you came up through) and its next flight up never share a footprint.
// Each flight keeps a landing clear at its foot and at its head.

import type { InteriorKind } from './contract';

import { hash32, mulberry32 } from './rng';

/** Floor slab between storeys (m). */
export const SLAB = 0.3;
/** Ceilings of multi-storey buildings stop here (a storey = this + SLAB). */
export const MULTI_CEILING = 3.4;
/** Stair width, rise per run (≈ 39°: the foot controller walks up to ~56°), landings. */
export const STAIR_W = 1.1;
export const STAIR_SLOPE = 0.8;
export const LANDING = 1.3;
/** Clear of the side wall (the stringer). */
const WALL_GAP = 0.05;

export type UpperUse = 'bedroom' | 'office' | 'storeroom' | 'lounge' | 'rehearsal' | 'gameroom';

export const USE_LABEL: Record<UpperUse, string> = {
  bedroom: 'Bedrooms',
  office: 'Office',
  storeroom: 'Storeroom',
  lounge: 'Lounge',
  rehearsal: 'Rehearsal room',
  gameroom: 'Game room',
};

/** A flight of stairs from one floor (its base) to the next, in the room frame. */
export interface StairPlan {
  /** Which side wall it runs along. */
  side: 'e' | 'w';
  x0: number;
  x1: number;
  /** Foot (z0, on the lower floor) to head (z1, arriving on the upper floor). */
  z0: number;
  z1: number;
  rise: number;
  steps: number;
}

/** Storeys for a building of `height` m whose room is w × d (1–3). */
export function storeyCount(
  kind: InteriorKind,
  height: number | undefined,
  w: number,
  d: number,
): number {
  const h = height ?? 0;
  let n = Math.max(1, Math.min(3, Math.round(h / 3.5)));
  const big = w * d >= 70;
  if (
    big &&
    (kind === 'shop' ||
      kind === 'cafe' ||
      kind === 'home' ||
      kind === 'studio' ||
      kind === 'gallery')
  )
    n = Math.max(n, 2);
  return n;
}

/** Storey height for a room `ceiling` m high. */
export function storeyHeight(ceiling: number): number {
  return Math.min(ceiling, MULTI_CEILING) + SLAB;
}

/**
 * The flight from floor `level` to `level + 1` in a w × d room with its
 * door at `doorX`, or null when it doesn't fit (with its landings).
 */
export function stairPlan(
  w: number,
  d: number,
  storey: number,
  level: number,
  seed: string,
): StairPlan | null {
  const rise = storey;
  const run = rise / STAIR_SLOPE;
  // The ground flight starts clear of the door; upper ones as far forward as they can
  const z0 = level === 0 ? 1.9 : LANDING + 0.3;
  const z1 = z0 + run;
  if (z1 + LANDING + 0.2 > d) return null;
  // Side: seeded for the first flight, then alternating
  const first = mulberry32(hash32(`stairs:${seed}`))() < 0.5 ? 'e' : 'w';
  const side: 'e' | 'w' = level % 2 === 0 ? first : first === 'e' ? 'w' : 'e';
  const x1 = side === 'e' ? w / 2 - WALL_GAP : -w / 2 + WALL_GAP + STAIR_W;
  const x0 = x1 - STAIR_W;
  return {
    side,
    x0,
    x1,
    z0,
    z1,
    rise,
    steps: Math.max(8, Math.round(rise / 0.19)),
  };
}

/** What upper floor `level` (1, 2) of a `kind` building is for. */
export function upperUse(kind: InteriorKind, level: number, seed: string): UpperUse {
  const r = mulberry32(hash32(`use:${seed}:${level}`))();
  // Some buildings keep a game room (a pool table) up top
  if (level >= 2 || r < 0.22) {
    if (r < 0.5) return 'gameroom';
  }
  switch (kind) {
    case 'home':
      return 'bedroom';
    case 'shop':
      return r < 0.6 ? 'storeroom' : 'office';
    case 'cafe':
    case 'bar':
      return 'lounge';
    case 'studio':
      return 'rehearsal';
    case 'gallery':
      return 'office';
    case 'arcade':
      return 'gameroom';
    default:
      return r < 0.5 ? 'storeroom' : 'office';
  }
}

/** A floor plan's stairs: the flight arriving from below (a hole), the one leaving upward. */
export interface FloorStairs {
  /** Base height of this floor above the ground floor. */
  base: number;
  /** The flight up from this floor (null on the top floor). */
  up: StairPlan | null;
  /** The flight up from the floor below (its hole is in this floor; null on the ground floor). */
  down: StairPlan | null;
}

/**
 * The stairs of a building, floor by floor (fewer floors when a flight
 * doesn't fit). `ceiling` is the room's ceiling height.
 */
export function buildingStairs(
  kind: InteriorKind,
  height: number | undefined,
  w: number,
  d: number,
  ceiling: number,
  seed: string,
): FloorStairs[] {
  const want = storeyCount(kind, height, w, d);
  const storey = storeyHeight(ceiling);
  const floors: FloorStairs[] = [{ base: 0, up: null, down: null }];
  for (let level = 0; level < want - 1; level++) {
    const plan = stairPlan(w, d, storey, level, seed);
    if (plan === null) break;
    floors[level]!.up = plan;
    floors.push({ base: (level + 1) * storey, up: null, down: plan });
  }
  return floors;
}
