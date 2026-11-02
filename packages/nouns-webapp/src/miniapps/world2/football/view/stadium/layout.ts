// ── NOUN STADIUM: the shape of the bowl (pure, pitch-local metres) ───────
//
// Everything the stadium build, its colliders, the crowd and the tests
// share. Pitch-local: origin on the centre spot at the pitch surface, z
// along the pitch, x across (contract.ts). The main stand is at −x (the
// uphill, city side: football/site.ts), with the players' tunnel and the
// main entrance on the halfway line; the big screen hangs under the −z end
// stand's roof.
//
//            +x  far stand (two tiers)
//      ┌──────────────────────────────┐
//      │ C │      far stand       │ C │      C = corner blocks + floodlights
//      │───┼──────────────────────┼───│
//   −z │ E │        grass         │ E │ +z   E = end stands (one tier)
//      │ N │ ┌──────────────────┐ │ N │
//      │ D │ │      pitch       │ │ D │
//      │───┼──────────────────────┼───│
//      │ C │  main stand ─tunnel─ │ C │
//      └──────────────┬┬──────────────┘
//            −x       ││ main entrance (to the city)

import { GRASS, STADIUM } from '../../contract';

/** A stand's row profile, measured from its front edge (r, back from the pitch). */
export interface Tier {
  /** Row depth and rise (m). */
  depth: number;
  rise: number;
  rows: number;
  /** r of the first row's front, height of its tread. */
  r0: number;
  y0: number;
}

export interface StandDef {
  id: 'main' | 'far' | 'west' | 'east';
  /** Long side (x = side · front) or end (z = side · front). */
  axis: 'x' | 'z';
  side: 1 | -1;
  /** Distance of the front wall from the centre line, and of the back (the facade's inner face). */
  front: number;
  back: number;
  /** Extent along the stand (the other axis), centred. */
  half: number;
  tiers: Tier[];
  /** Roof: height at the front edge and the back, and how far it reaches over the pitch (r < 0). */
  roofFront: number;
  roofBack: number;
  roofReach: number;
}

/** Front wall (hoarding) height in front of the first row. */
export const FRONT_WALL = 1.2;
/** Seat spacing along a row (one fan per seat). */
export const SEAT_W = 0.55;
/** Stair aisles: every AISLE_EVERY m along a stand, AISLE_W wide. */
export const AISLE_EVERY = 22;
export const AISLE_W = 1.4;

const SIDE_FRONT = GRASS.width / 2 + 4; // 44
const END_FRONT = GRASS.length / 2 + 3.5; // 63
const BACK_X = STADIUM.halfX - 1.2;
const BACK_Z = STADIUM.halfZ - 1.2;
const SIDE_HALF = END_FRONT + 3; // 66
const END_HALF = SIDE_FRONT; // 44

const LOWER: Tier = { depth: 0.8, rise: 0.38, rows: 29, r0: 0, y0: FRONT_WALL };
/** Upper tier: hangs over the lower tier's back rows, above the concourse. */
const UPPER: Tier = { depth: 0.8, rise: 0.46, rows: 32, r0: 24.6, y0: 16.6 };
const END: Tier = { depth: 0.8, rise: 0.4, rows: 62, r0: 0, y0: FRONT_WALL };

export const STANDS: StandDef[] = [
  {
    id: 'main',
    axis: 'x',
    side: -1,
    front: SIDE_FRONT,
    back: BACK_X,
    half: SIDE_HALF,
    tiers: [LOWER, UPPER],
    roofFront: STADIUM.height,
    roofBack: STADIUM.height + 4,
    roofReach: 3,
  },
  {
    id: 'far',
    axis: 'x',
    side: 1,
    front: SIDE_FRONT,
    back: BACK_X,
    half: SIDE_HALF,
    tiers: [LOWER, UPPER],
    roofFront: STADIUM.height,
    roofBack: STADIUM.height + 4,
    roofReach: 3,
  },
  {
    id: 'west',
    axis: 'z',
    side: -1,
    front: END_FRONT,
    back: BACK_Z,
    half: END_HALF,
    tiers: [END],
    roofFront: STADIUM.height - 2,
    roofBack: STADIUM.height,
    roofReach: 2,
  },
  {
    id: 'east',
    axis: 'z',
    side: 1,
    front: END_FRONT,
    back: BACK_Z,
    half: END_HALF,
    tiers: [END],
    roofFront: STADIUM.height - 2,
    roofBack: STADIUM.height,
    roofReach: 2,
  },
];

/** Height of a tier's last tread. */
export const tierTop = (t: Tier) => t.y0 + (t.rows - 1) * t.rise;
/** r of a tier's back edge. */
export const tierBack = (t: Tier) => t.r0 + t.rows * t.depth;

/** The concourse floor under the upper tier: the lower tier's back (r) to the facade. */
export const LOWER_BACK = tierBack(LOWER);

/** The players' tunnel through the main stand's lower tier, on the halfway line. */
export const TUNNEL = {
  /** Half width (z) and clear height. */
  half: 2.6,
  height: 3.4,
  /** Ceiling slab thickness; rows over it start where the rake clears it. */
  slab: 0.4,
  wall: 0.3,
} as const;

/** Rows of the main stand's lower tier over the tunnel start here (first tread above the slab). */
export const TUNNEL_ROW0 = Math.ceil((TUNNEL.height + TUNNEL.slab + 0.3 - LOWER.y0) / LOWER.rise);

/** The main entrance: a gap in the facade at the tunnel's end. */
export const ENTRANCE = { half: 4, height: 5 } as const;

/** Facade height along each side (above the stands' last rows). */
export const FACADE = {
  side: tierTop(UPPER) + 2.4,
  end: tierTop(END) + 2.4,
  thick: 1.2,
} as const;

/** Corner blocks (between the stands) + the floodlight pylons on them. */
export const CORNER = {
  height: 14,
  pylon: 58,
  /** Lamp head: width, height. */
  headW: 11,
  headH: 6,
} as const;

/** Dugouts in the main side's run-off, either side of the halfway line. */
export const DUGOUT = {
  x: -(GRASS.width / 2 - 1.6),
  z0: 6,
  z1: 17,
  depth: 2.4,
  height: 2.3,
} as const;

/** Ad boards ring the grass. */
export const ADS = {
  sideX: GRASS.width / 2 + 1.2,
  endZ: GRASS.length / 2 + 1.2,
  height: 0.95,
  /** The main side leaves the dugouts + tunnel clear. */
  mainGap: 20,
  sideHalf: 56,
  endHalf: 33,
} as const;

/** The big screen under the west (−z) end's roof, facing the pitch. */
export const SCREEN = { z: -(END_FRONT + 2.5), y: 24.5, w: 16, h: 8 } as const;

/** Highest place you can stand (the back row of the upper tiers; the roofs have no collider). */
export const STANDABLE_TOP = Math.max(tierTop(UPPER), tierTop(END)) + 0.5;

/** Seat tread height of row i of tier t (top surface). */
export const rowY = (t: Tier, i: number) => t.y0 + i * t.rise;
/** r of row i's front edge. */
export const rowR = (t: Tier, i: number) => t.r0 + i * t.depth;

/** Pitch-local position of a stand-frame point: r back from the front, `a` along the stand. */
export function standToPitch(s: StandDef, r: number, a: number, out: { x: number; z: number }) {
  const d = s.front + r;
  if (s.axis === 'x') {
    out.x = s.side * d;
    out.z = a;
  } else {
    out.x = a;
    out.z = s.side * d;
  }
  return out;
}

/** Is `a` (along a stand) in a stair aisle? */
export function inAisle(a: number, half: number): boolean {
  const k = Math.round(a / AISLE_EVERY);
  return Math.abs(k) * AISLE_EVERY < half - 2 && Math.abs(a - k * AISLE_EVERY) < AISLE_W / 2;
}

/** Who sits here: fans of team 0 at the west end, team 1 at the east, mixed along the sides. */
export function fanEnd(_px: number, pz: number, rnd: number): 0 | 1 | 2 {
  // neutral sprinkle everywhere
  if (rnd < 0.12) return 2;
  if (Math.abs(pz) > END_FRONT - 1) return pz < 0 ? 0 : 1;
  // sides: by half, a soft boundary near halfway
  const t = Math.tanh(pz / 18) * 0.5 + 0.5;
  return rnd < 0.12 + 0.88 * t ? 1 : 0;
}

/** Wave coordinate (0..1 round the bowl). */
export const waveCoord = (px: number, pz: number) => Math.atan2(px, pz) / (Math.PI * 2) + 0.5;
