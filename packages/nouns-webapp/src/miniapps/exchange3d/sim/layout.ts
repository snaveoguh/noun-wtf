// ── 3D Grand Exchange: the hall's floor plan (pure) ──────────────────────
//
// One hall, metres, y up. The floor is z ∈ [−D/2, D/2], x ∈ [−W/2, W/2].
// Seven trading pits (one per good) sit on an ellipse around the central
// board tower. A pit is a raised octagon whose steps fall toward its middle
// (the Chicago pit shape), so traders stand on the tiers and face in.
// A mezzanine balcony runs round the walls; the door is on the −z wall.

import type { GoodId } from '../../world2/trade/contract';

export const HALL_W = 150;
export const HALL_D = 104;
export const WALL_H = 26;
/** Balcony deck height, depth (from the wall) and where spectators stand. */
export const BALCONY_Y = 8;
export const BALCONY_DEPTH = 6;
export const BALCONY_INSET = 3;

/** Central board tower: half-width (square footprint) and height. */
export const TOWER_HALF = 6;
export const TOWER_H = 24;
/** Traders keep this far from the tower's centre. */
export const TOWER_CLEAR = 9.5;

/** Pit: outer rim, inner floor, steps between them, step height. */
export const PIT_R_OUT = 9;
export const PIT_R_IN = 2.4;
export const PIT_STEPS = 4;
export const PIT_STEP_H = 0.3;

/** Ellipse the pit centres sit on. */
const RING_X = 48;
const RING_Z = 30;

/** Pits in hall order (the central board lists them the same way). */
export const PIT_GOODS: readonly GoodId[] = [
  'ICECREAM',
  'FRIES',
  'FISH',
  'DRIP',
  'NOGGLES',
  'PIZZA',
  'WATER',
];

export interface Pit {
  ix: number;
  good: GoodId;
  x: number;
  z: number;
}

export const PITS: readonly Pit[] = PIT_GOODS.map((good, ix) => {
  // Start at the back wall (+z) so no pit blocks the door's sight line
  const a = Math.PI / 2 + (ix / PIT_GOODS.length) * Math.PI * 2;
  return { ix, good, x: Math.round(Math.cos(a) * RING_X), z: Math.round(Math.sin(a) * RING_Z) };
});

export const PIT_BY_GOOD = Object.fromEntries(PITS.map(p => [p.good, p])) as Record<GoodId, Pit>;

/** The door: riders who just joined walk in from here. */
export const DOOR = { x: 0, z: -HALL_D / 2 + 2 };

/** Octagon "radius": the distance measure the pit's rings use. */
export function octR(dx: number, dz: number): number {
  const ax = Math.abs(dx);
  const az = Math.abs(dz);
  return Math.max(ax, az, (ax + az) / Math.SQRT2);
}

/** Step index (0 = pit floor … PIT_STEPS = the rim) at an octagon radius inside a pit. */
export function pitStep(r: number): number {
  if (r <= PIT_R_IN) return 0;
  const w = (PIT_R_OUT - PIT_R_IN) / PIT_STEPS;
  return Math.min(PIT_STEPS, Math.ceil((r - PIT_R_IN) / w));
}

/** The pit a point is in (null on the open floor). */
export function pitAt(x: number, z: number): Pit | null {
  for (const p of PITS) if (octR(x - p.x, z - p.z) < PIT_R_OUT) return p;
  return null;
}

/** Floor height under a point on the main floor (pit tiers rise toward the rim). */
export function floorHeight(x: number, z: number): number {
  const p = pitAt(x, z);
  if (p === null) return 0;
  return pitStep(octR(x - p.x, z - p.z)) * PIT_STEP_H;
}

/** Keep a point on the floor: inside the walls, out of the tower. */
export function clampToFloor(x: number, z: number, margin = 1.2): { x: number; z: number } {
  const hx = HALL_W / 2 - margin;
  const hz = HALL_D / 2 - margin;
  let cx = Math.min(hx, Math.max(-hx, x));
  let cz = Math.min(hz, Math.max(-hz, z));
  const d = Math.hypot(cx, cz);
  if (d < TOWER_CLEAR) {
    const k = d > 1e-6 ? TOWER_CLEAR / d : 1;
    cx = d > 1e-6 ? cx * k : TOWER_CLEAR;
    cz = d > 1e-6 ? cz * k : 0;
  }
  return { x: cx, z: cz };
}

/**
 * A spot on a pit's tiers at angle `a` (rad) and step `s` (1..PIT_STEPS);
 * steps past the rim are rings of floor round the outside of the pit.
 */
export function pitSpot(p: Pit, a: number, s: number): { x: number; z: number } {
  const w = (PIT_R_OUT - PIT_R_IN) / PIT_STEPS;
  const r =
    s > PIT_STEPS
      ? PIT_R_OUT + 0.8 + (s - PIT_STEPS - 1) * 1.3
      : PIT_R_IN + (Math.min(PIT_STEPS, Math.max(0, s)) - 0.5) * w;
  // Octagon radius r along angle a: scale the unit direction onto the octagon
  const dx = Math.cos(a);
  const dz = Math.sin(a);
  const k = r / octR(dx, dz);
  return { x: p.x + dx * k, z: p.z + dz * k };
}

/** Rings of floor outside a pit's rim that its crowd also stands on. */
export const PIT_OUTER_RINGS = 3;

// ── The balcony: a rectangle loop just inside the walls ──

const BX = HALL_W / 2 - BALCONY_INSET;
const BZ = HALL_D / 2 - BALCONY_INSET;
export const BALCONY_LEN = 4 * (BX + BZ);

/** A point on the balcony loop at arc length `s` (wraps). */
export function balconyPoint(s: number): { x: number; z: number; face: number } {
  const L = BALCONY_LEN;
  let t = ((s % L) + L) % L;
  // Four legs: +z wall (x from −BX to BX), +x wall, −z wall, −x wall
  // `face` looks into the hall (heading 0 = +z, as atan2(dx, dz))
  if (t < 2 * BX) return { x: -BX + t, z: BZ, face: Math.PI };
  t -= 2 * BX;
  if (t < 2 * BZ) return { x: BX, z: BZ - t, face: -Math.PI / 2 };
  t -= 2 * BZ;
  if (t < 2 * BX) return { x: BX - t, z: -BZ, face: 0 };
  t -= 2 * BX;
  return { x: -BX, z: -BZ + t, face: Math.PI / 2 };
}

// ── VAST: the floor goes on. Copies of the hall tile out from the real one ──

/** Offsets of the hall copies drawn in the VAST view (the real hall is 0,0). */
export function hallCopies(rings: number): { x: number; z: number; flip: boolean }[] {
  const out: { x: number; z: number; flip: boolean }[] = [];
  for (let i = -rings; i <= rings; i++)
    for (let j = -rings; j <= rings; j++) {
      if (i === 0 && j === 0) continue;
      out.push({ x: i * HALL_W, z: j * HALL_D, flip: ((i + j) & 1) === 1 });
    }
  return out;
}
