// ── Interior layouts: door → a furnished room (pure, seeded, tested) ─────
//
// `generateLayout(door id, kind, footprint)` → the room: its size, walls,
// windows, a partition (homes get a bedroom), furniture placements, seats,
// the spots residents walk between, and wall decor. Same input, same room.
//
// Room frame: x across (−w/2 … w/2), z inward from the door wall (0 … d),
// y up from the floor. The door is in the z = 0 wall at x = door.x. An
// item's own frame has its front facing +z; `rot` turns it by quarter
// turns (yaw = rot · π/2, so rot 2 faces −z, back to the far wall).
//
// Placement: each kind has a list of "sets" (a lounge, a dining table and
// chairs, a counter with stools…), each a small cluster of items in its own
// frame, placed whole: against a wall (back to it) or free-standing, picked
// and repeated by weight and floor area. A set goes in only where it
// overlaps nothing solid, keeps out of the doorway, and leaves every seat
// and spot (old and new) reachable from the door on an occupancy grid
// grown by the player's girth. Rugs and mats are flat (walk-over).

import type { InteriorKind } from './contract';

import { hash32, int, mulberry32, pick, type Rng } from './rng';

// ── Types ────────────────────────────────────────────────────────────────

export type ItemType =
  | 'sofa'
  | 'armchair'
  | 'coffee_table'
  | 'tv'
  | 'rug'
  | 'dining_table'
  | 'chair'
  | 'kitchen'
  | 'fridge'
  | 'stove'
  | 'bed'
  | 'nightstand'
  | 'bookshelf'
  | 'plant'
  | 'floor_lamp'
  | 'counter'
  | 'back_shelf'
  | 'stool'
  | 'cafe_table'
  | 'pastry_case'
  | 'shelf'
  | 'gondola'
  | 'drinks_fridge'
  | 'booth_bench'
  | 'booth_table'
  | 'pool_table'
  | 'jukebox'
  | 'decks'
  | 'speaker'
  | 'record_crate'
  | 'record_shelf'
  | 'mic'
  | 'plinth'
  | 'bench'
  | 'desk'
  | 'cabinet'
  | 'claw'
  | 'barber_chair'
  | 'washer'
  | 'dryer'
  | 'folding_table'
  | 'vending'
  | 'treadmill'
  | 'weight_bench'
  | 'dumbbell_rack'
  | 'mat'
  | 'water_cooler'
  | 'side_table'
  | 'wardrobe'
  | 'bag';

export type Wall = 'n' | 'e' | 's' | 'w';

export interface Item {
  type: ItemType;
  /** Centre (room frame), quarter turns, size in its own frame (w across, d deep, h tall). */
  x: number;
  z: number;
  rot: 0 | 1 | 2 | 3;
  w: number;
  d: number;
  h: number;
  /** Blocks walking (rugs and mats don't). */
  solid: boolean;
  /** Seed for its look (colours, clutter, which goods). */
  seed: number;
}

export interface Seat {
  x: number;
  z: number;
  /** Facing when sat (yaw). */
  yaw: number;
  /** Seat height. */
  h: number;
  /** Where you stand to sit down. */
  ax: number;
  az: number;
  /** Index of the item it belongs to. */
  item: number;
}

export interface Spot {
  x: number;
  z: number;
  yaw: number;
  kind: 'stand' | 'counter' | 'work' | 'look';
  /** The owner's place (behind the counter): nobody else stands there. */
  owner?: boolean;
}

export type DecorType =
  | 'poster'
  | 'frame'
  | 'menu'
  | 'mirror'
  | 'neon'
  | 'clock'
  | 'wall_shelf'
  | 'window'
  | 'upper_cabinets';

export interface Decor {
  type: DecorType;
  wall: Wall;
  /** Centre along the wall (room frame x for n/s walls, z for e/w), centre height, size. */
  at: number;
  y: number;
  w: number;
  h: number;
  seed: number;
}

export interface Region {
  name: 'main' | 'bedroom' | 'back';
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Partition {
  /** A wall along x = at (from z0 to z1) or z = at (from x0 to x1), with a doorway gap. */
  axis: 'x' | 'z';
  at: number;
  from: number;
  to: number;
  gap: [number, number];
}

export interface Palette {
  wall: number;
  wall2: number;
  floor: number;
  floor2: number;
  trim: number;
  ceiling: number;
  wood: number;
  fabric: number;
  accent: number;
  metal: number;
}

export interface Layout {
  id: string;
  kind: InteriorKind;
  seed: number;
  w: number;
  d: number;
  h: number;
  door: { x: number; width: number };
  palette: Palette;
  floorStyle: 'planks' | 'tiles' | 'checker' | 'concrete' | 'carpet';
  regions: Region[];
  partitions: Partition[];
  items: Item[];
  seats: Seat[];
  spots: Spot[];
  decor: Decor[];
  /** Ceiling lights (room frame x, z). */
  lights: { x: number; z: number; kind: 'pendant' | 'panel' | 'bulb' | 'neon' }[];
}

export interface LayoutInput {
  id: string;
  kind: InteriorKind;
  /** The building's frontage (along the door wall) and depth, and its height, in m. */
  frontage?: number;
  depth?: number;
  height?: number;
}

// ── Geometry helpers ─────────────────────────────────────────────────────

export interface Box2 {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/** An item's footprint in the room frame. */
export function itemBox(it: Pick<Item, 'x' | 'z' | 'rot' | 'w' | 'd'>): Box2 {
  const odd = it.rot % 2 === 1;
  const hw = (odd ? it.d : it.w) / 2;
  const hd = (odd ? it.w : it.d) / 2;
  return { minX: it.x - hw, maxX: it.x + hw, minZ: it.z - hd, maxZ: it.z + hd };
}

export function boxesOverlap(a: Box2, b: Box2, pad = 0): boolean {
  return (
    a.minX < b.maxX + pad && a.maxX > b.minX - pad && a.minZ < b.maxZ + pad && a.maxZ > b.minZ - pad
  );
}

/** Rotate a local (x, z) offset by quarter turns (three's yaw convention). */
export function turn(x: number, z: number, rot: number): [number, number] {
  switch (((rot % 4) + 4) % 4) {
    case 1:
      return [z, -x];
    case 2:
      return [-x, -z];
    case 3:
      return [-z, x];
    default:
      return [x, z];
  }
}

export const yawOf = (rot: number) => (rot * Math.PI) / 2;

// ── Occupancy grid (walkability) ─────────────────────────────────────────

/** Player girth the grid keeps clear of solids (m). */
export const GIRTH = 0.3;
const CELL = 0.2;

export class Grid {
  readonly nx: number;
  readonly nz: number;
  readonly blocked: Uint8Array;

  constructor(
    readonly w: number,
    readonly d: number,
    /** Clearance kept from walls and solids (the player's girth by default). */
    readonly girth = GIRTH,
  ) {
    this.nx = Math.ceil(w / CELL);
    this.nz = Math.ceil(d / CELL);
    this.blocked = new Uint8Array(this.nx * this.nz);
    // Walls: the outer ring of cells within the girth of the walls
    for (let i = 0; i < this.nx; i++)
      for (let j = 0; j < this.nz; j++) {
        const x = -w / 2 + (i + 0.5) * CELL;
        const z = (j + 0.5) * CELL;
        if (x < -w / 2 + girth || x > w / 2 - girth || z < girth || z > d - girth)
          this.blocked[j * this.nx + i] = 1;
      }
  }

  cellOf(x: number, z: number): [number, number] {
    return [Math.floor((x + this.w / 2) / CELL), Math.floor(z / CELL)];
  }

  centre(i: number, j: number): [number, number] {
    return [-this.w / 2 + (i + 0.5) * CELL, (j + 0.5) * CELL];
  }

  /** Mark a box (grown by the girth) blocked; returns the cells it newly blocked. */
  block(b: Box2, grow = this.girth): number[] {
    const out: number[] = [];
    const [i0, j0] = this.cellOf(b.minX - grow, b.minZ - grow);
    const [i1, j1] = this.cellOf(b.maxX + grow, b.maxZ + grow);
    for (let i = Math.max(0, i0); i <= Math.min(this.nx - 1, i1); i++)
      for (let j = Math.max(0, j0); j <= Math.min(this.nz - 1, j1); j++) {
        const [cx, cz] = this.centre(i, j);
        // Cell centre within the grown box
        if (cx < b.minX - grow || cx > b.maxX + grow || cz < b.minZ - grow || cz > b.maxZ + grow)
          continue;
        const k = j * this.nx + i;
        if (this.blocked[k] === 0) {
          this.blocked[k] = 1;
          out.push(k);
        }
      }
    return out;
  }

  unblock(cells: number[]) {
    for (const k of cells) this.blocked[k] = 0;
  }

  free(x: number, z: number): boolean {
    const [i, j] = this.cellOf(x, z);
    return i >= 0 && j >= 0 && i < this.nx && j < this.nz && this.blocked[j * this.nx + i] === 0;
  }

  /** Cells reachable from (x, z). */
  flood(x: number, z: number): Uint8Array {
    const seen = new Uint8Array(this.nx * this.nz);
    const [si, sj] = this.cellOf(x, z);
    if (!this.free(x, z)) return seen;
    const q = [sj * this.nx + si];
    seen[q[0]!] = 1;
    for (let h = 0; h < q.length; h++) {
      const k = q[h]!;
      const i = k % this.nx;
      const j = (k - i) / this.nx;
      if (i > 0) this.visit(k - 1, seen, q);
      if (i < this.nx - 1) this.visit(k + 1, seen, q);
      if (j > 0) this.visit(k - this.nx, seen, q);
      if (j < this.nz - 1) this.visit(k + this.nx, seen, q);
    }
    return seen;
  }

  private visit(k: number, seen: Uint8Array, q: number[]) {
    if (seen[k] === 1 || this.blocked[k] === 1) return;
    seen[k] = 1;
    q.push(k);
  }

  reached(seen: Uint8Array, x: number, z: number): boolean {
    const [i, j] = this.cellOf(x, z);
    return i >= 0 && j >= 0 && i < this.nx && j < this.nz && seen[j * this.nx + i] === 1;
  }

  /**
   * Shortest walk from a to b (4-connected BFS, then pulled straight where
   * the line is clear): waypoints after `a`, ending at b. Null if b can't
   * be reached.
   */
  path(ax: number, az: number, bx: number, bz: number): [number, number][] | null {
    const [si, sj] = this.cellOf(ax, az);
    const [ti, tj] = this.cellOf(bx, bz);
    if (ti < 0 || tj < 0 || ti >= this.nx || tj >= this.nz) return null;
    const start =
      Math.max(0, Math.min(this.nz - 1, sj)) * this.nx + Math.max(0, Math.min(this.nx - 1, si));
    const target = tj * this.nx + ti;
    const prev = new Int32Array(this.nx * this.nz).fill(-1);
    prev[start] = start;
    const q = [start];
    for (let h = 0; h < q.length && prev[target] === -1; h++) {
      const k = q[h]!;
      const i = k % this.nx;
      const j = (k - i) / this.nx;
      const nb = [
        i > 0 ? k - 1 : -1,
        i < this.nx - 1 ? k + 1 : -1,
        j > 0 ? k - this.nx : -1,
        j < this.nz - 1 ? k + this.nx : -1,
      ];
      for (const kk of nb) {
        if (kk < 0 || prev[kk] !== -1) continue;
        // The target may sit in a blocked cell (a seat's edge): allow stepping onto it
        if (this.blocked[kk] === 1 && kk !== target) continue;
        prev[kk] = k;
        q.push(kk);
      }
    }
    if (prev[target] === -1) return null;
    const cells: number[] = [];
    for (let k = target; k !== start; k = prev[k]!) cells.push(k);
    cells.reverse();
    // String-pull: keep a waypoint only where the straight line from the last one is blocked
    const pts = cells.map(k => this.centre(k % this.nx, Math.floor(k / this.nx)));
    const out: [number, number][] = [];
    let from: [number, number] = [ax, az];
    for (let i = 0; i < pts.length; i++) {
      const next = pts[i + 1];
      if (next !== undefined && this.lineFree(from, next)) continue;
      out.push(pts[i]!);
      from = pts[i]!;
    }
    out.push([bx, bz]);
    return out;
  }

  private lineFree(a: [number, number], b: [number, number]): boolean {
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / (CELL * 0.5));
    for (let s = 1; s < n; s++) {
      const t = s / n;
      if (!this.free(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t)) return false;
    }
    return true;
  }
}

// ── Item catalogue ───────────────────────────────────────────────────────

const SIZE: Record<ItemType, [number, number, number]> = {
  sofa: [2.2, 0.9, 0.85],
  armchair: [0.95, 0.9, 0.85],
  coffee_table: [1.1, 0.6, 0.42],
  tv: [1.5, 0.45, 1.35],
  rug: [2.6, 1.8, 0.02],
  dining_table: [1.5, 0.9, 0.76],
  chair: [0.5, 0.5, 0.92],
  kitchen: [2.8, 0.65, 0.92],
  fridge: [0.8, 0.75, 1.9],
  stove: [0.75, 0.65, 0.92],
  bed: [1.6, 2.1, 0.62],
  nightstand: [0.45, 0.4, 0.55],
  bookshelf: [1.0, 0.36, 1.9],
  plant: [0.55, 0.55, 1.25],
  floor_lamp: [0.42, 0.42, 1.65],
  counter: [3.0, 0.75, 1.05],
  back_shelf: [3.0, 0.45, 2.1],
  stool: [0.42, 0.42, 0.76],
  cafe_table: [0.75, 0.75, 0.76],
  pastry_case: [1.3, 0.6, 1.15],
  shelf: [2.0, 0.5, 1.95],
  gondola: [2.4, 0.9, 1.45],
  drinks_fridge: [0.85, 0.72, 1.95],
  booth_bench: [1.6, 0.6, 1.0],
  booth_table: [1.3, 0.7, 0.76],
  pool_table: [2.3, 1.3, 0.86],
  jukebox: [0.85, 0.55, 1.5],
  decks: [1.9, 0.75, 0.95],
  speaker: [0.55, 0.5, 1.15],
  record_crate: [0.8, 0.42, 0.45],
  record_shelf: [1.6, 0.4, 1.85],
  mic: [0.4, 0.4, 1.6],
  plinth: [0.65, 0.65, 1.0],
  bench: [1.7, 0.48, 0.46],
  desk: [1.5, 0.7, 0.76],
  cabinet: [0.85, 0.85, 1.85],
  claw: [1.1, 1.1, 2.05],
  barber_chair: [0.75, 0.8, 1.1],
  washer: [0.7, 0.7, 0.95],
  dryer: [0.7, 0.7, 1.9],
  folding_table: [1.7, 0.75, 0.9],
  vending: [0.95, 0.78, 1.95],
  treadmill: [0.85, 1.9, 1.35],
  weight_bench: [0.55, 1.35, 0.5],
  dumbbell_rack: [1.7, 0.5, 0.85],
  mat: [1.1, 2.0, 0.02],
  water_cooler: [0.42, 0.42, 1.25],
  side_table: [0.5, 0.5, 0.55],
  wardrobe: [1.2, 0.6, 2.0],
  bag: [0.6, 0.6, 1.9],
};

const FLAT = new Set<ItemType>(['rug', 'mat']);

/** One item of a set in the set's own frame (front +z, back against z = 0). */
interface Part {
  type: ItemType;
  x: number;
  z: number;
  rot?: 0 | 1 | 2 | 3;
  /** Override size. */
  w?: number;
  d?: number;
  h?: number;
}

interface SetSeat {
  /** Seat point (set frame), facing (quarter turns, set frame), height, access point. */
  x: number;
  z: number;
  rot: number;
  h: number;
  ax: number;
  az: number;
  part: number;
}

interface SetSpot {
  x: number;
  z: number;
  rot: number;
  kind: Spot['kind'];
  owner?: boolean;
}

interface SetDecor {
  type: DecorType;
  /** Along the wall (set frame x), centre height, size. Only for wall sets. */
  x: number;
  y: number;
  w: number;
  h: number;
}

interface SetDef {
  parts: Part[];
  seats?: SetSeat[];
  spots?: SetSpot[];
  /** Decor on the wall behind (wall sets only). */
  decor?: SetDecor[];
  /** Back against a wall, or free-standing. */
  wall: boolean;
  /** Regions it may go in. */
  region?: Region['name'];
}

/** Seats along a straight bench/sofa: n points, set frame, facing +z (rot 0). */
function benchSeats(part: number, cx: number, z: number, w: number, n: number, h: number, rot = 0) {
  const out: SetSeat[] = [];
  for (let i = 0; i < n; i++) {
    const x = cx - w / 2 + (w * (i + 0.5)) / n;
    const [fx, fz] = turn(0, 0.8, rot);
    out.push({ x, z, rot, h, ax: x + fx, az: z + fz, part });
  }
  return out;
}

/**
 * A seat on a part (set frame), facing `rot`. You walk up to it from in
 * front (sofas, armchairs, beds) or from behind (chairs and stools pulled
 * up to a table or a counter, a barber's chair facing its mirror).
 */
function seatAround(
  part: number,
  px: number,
  pz: number,
  rot: number,
  h: number,
  from: 'front' | 'behind' | 'left' | 'right' = 'front',
): SetSeat {
  const off: [number, number] =
    from === 'front'
      ? [0, 0.8]
      : from === 'behind'
        ? [0, -0.85]
        : from === 'left'
          ? [0.85, 0]
          : [-0.85, 0];
  const [fx, fz] = turn(off[0], off[1], rot);
  return { x: px, z: pz, rot, h, ax: px + fx, az: pz + fz, part };
}

// ── The sets ─────────────────────────────────────────────────────────────

type Maker = (rnd: Rng) => SetDef;

const lounge: Maker = rnd => {
  const w = pick(rnd, [2.0, 2.2, 2.4]);
  const tv = rnd() < 0.85;
  const parts: Part[] = [
    { type: 'sofa', x: 0, z: 0.45, w },
    { type: 'rug', x: 0, z: 1.9, w: w + 0.6, d: 2.2 },
    { type: 'coffee_table', x: 0, z: 1.95 },
  ];
  if (tv) parts.push({ type: 'tv', x: 0, z: 3.45, rot: 2 });
  const seats = benchSeats(0, 0, 0.5, w - 0.3, w > 2.1 ? 3 : 2, 0.45);
  const spots: SetSpot[] = [];
  if (rnd() < 0.6) {
    parts.push({ type: 'side_table', x: w / 2 + 0.35, z: 0.35 });
    if (rnd() < 0.5) parts.push({ type: 'floor_lamp', x: -w / 2 - 0.3, z: 0.3 });
  }
  return {
    parts,
    seats,
    spots,
    wall: true,
    region: 'main',
    decor: [{ type: rnd() < 0.5 ? 'poster' : 'frame', x: 0, y: 1.75, w: 1.2, h: 0.9 }],
  };
};

const armchairNook: Maker = rnd => ({
  parts: [
    { type: 'armchair', x: 0, z: 0.5 },
    { type: 'side_table', x: 0.75, z: 0.35 },
    ...(rnd() < 0.7 ? [{ type: 'floor_lamp' as const, x: -0.7, z: 0.3 }] : []),
  ],
  seats: [seatAround(0, 0, 0.55, 0, 0.45)],
  wall: true,
  decor: [{ type: 'frame', x: 0, y: 1.6, w: 0.7, h: 0.9 }],
});

const dining: Maker = rnd => {
  const n = rnd() < 0.5 ? 4 : 2;
  const parts: Part[] = [{ type: 'dining_table', x: 0, z: 0 }];
  const seats: SetSeat[] = [];
  const at: [number, number, 0 | 1 | 2 | 3][] =
    n === 4
      ? [
          [-0.4, -0.75, 0],
          [0.4, -0.75, 0],
          [-0.4, 0.75, 2],
          [0.4, 0.75, 2],
        ]
      : [
          [0, -0.75, 0],
          [0, 0.75, 2],
        ];
  for (const [x, z, r] of at) {
    parts.push({ type: 'chair', x, z, rot: r });
    seats.push(seatAround(parts.length - 1, x, z, r, 0.46, 'behind'));
  }
  return { parts, seats, wall: false, region: 'main' };
};

const kitchen: Maker = rnd => {
  const w = pick(rnd, [2.4, 2.8, 3.2]);
  return {
    parts: [
      { type: 'kitchen', x: 0, z: 0.33, w },
      { type: 'fridge', x: w / 2 + 0.45, z: 0.38 },
    ],
    spots: [
      { x: -0.4, z: 1.0, rot: 2, kind: 'work' },
      { x: w / 2 + 0.45, z: 1.15, rot: 2, kind: 'work' },
    ],
    decor: [
      { type: 'upper_cabinets', x: -0.2, y: 1.95, w: w - 0.4, h: 0.7 },
      ...(rnd() < 0.6 ? [{ type: 'clock' as const, x: w / 2 - 0.3, y: 2.55, w: 0.4, h: 0.4 }] : []),
    ],
    wall: true,
    region: 'main',
  };
};

const bedroom: Maker = rnd => ({
  parts: [
    { type: 'bed', x: 0, z: 1.05 },
    { type: 'nightstand', x: -1.1, z: 0.22 },
    { type: 'nightstand', x: 1.1, z: 0.22 },
    { type: 'rug', x: 0, z: 1.5, w: 2.4, d: 1.6 },
  ],
  seats: [seatAround(0, 0.35, 1.9, 0, 0.55)],
  spots: [],
  decor: [{ type: rnd() < 0.5 ? 'poster' : 'frame', x: 0, y: 1.6, w: 1.1, h: 0.8 }],
  wall: true,
  region: 'bedroom',
});

const wardrobe: Maker = () => ({
  parts: [{ type: 'wardrobe', x: 0, z: 0.3 }],
  spots: [{ x: 0, z: 1.0, rot: 2, kind: 'look' }],
  wall: true,
  region: 'bedroom',
});

const books: Maker = rnd => ({
  parts: [
    { type: 'bookshelf', x: 0, z: 0.18 },
    ...(rnd() < 0.5 ? [{ type: 'plant' as const, x: 0.85, z: 0.3 }] : []),
  ],
  spots: [{ x: 0, z: 0.85, rot: 2, kind: 'look' }],
  wall: true,
});

const plantCorner: Maker = () => ({ parts: [{ type: 'plant', x: 0, z: 0.3 }], wall: true });

const lampCorner: Maker = () => ({ parts: [{ type: 'floor_lamp', x: 0, z: 0.25 }], wall: true });

/** Counter with a back shelf behind it and the owner between (cafes, bars, shops). */
function counterSet(stools: number, backDecor: DecorType, case_?: ItemType): Maker {
  return rnd => {
    const w = pick(rnd, [2.6, 3.0, 3.4]);
    // The counter is shorter than the shelf behind it, leaving a way round
    // the end for the staff
    const cw = w - 0.9;
    const parts: Part[] = [
      { type: 'back_shelf', x: 0, z: 0.23, w },
      { type: 'counter', x: -0.45, z: 1.75, w: cw },
    ];
    const seats: SetSeat[] = [];
    for (let i = 0; i < stools; i++) {
      const x = -0.45 - cw / 2 + (cw * (i + 0.5)) / stools;
      parts.push({ type: 'stool', x, z: 2.5, rot: 2 });
      seats.push(seatAround(parts.length - 1, x, 2.5, 2, 0.76, 'behind'));
    }
    if (case_ !== undefined) parts.push({ type: case_, x: -0.45 - cw / 2 - 0.75, z: 1.7 });
    return {
      parts,
      seats,
      spots: [
        { x: -0.6, z: 0.95, rot: 0, kind: 'counter', owner: true },
        { x: w / 2 - 0.4, z: 1.3, rot: 0, kind: 'work' },
      ],
      decor: [{ type: backDecor, x: 0, y: 2.55, w: Math.min(2.4, w - 0.4), h: 0.75 }],
      wall: true,
      region: 'main',
    };
  };
}

const cafeTable: Maker = rnd => {
  const two = rnd() < 0.7;
  const parts: Part[] = [
    { type: 'cafe_table', x: 0, z: 0 },
    { type: 'chair', x: 0, z: -0.65 },
  ];
  const seats = [seatAround(1, 0, -0.65, 0, 0.46, 'behind')];
  if (two) {
    parts.push({ type: 'chair', x: 0, z: 0.65, rot: 2 });
    seats.push(seatAround(2, 0, 0.65, 2, 0.46, 'behind'));
  }
  return { parts, seats, wall: false, region: 'main' };
};

const shopShelf: Maker = rnd => ({
  parts: [{ type: 'shelf', x: 0, z: 0.25, w: pick(rnd, [1.8, 2.0, 2.4]) }],
  spots: [{ x: 0, z: 0.95, rot: 2, kind: 'look' }],
  wall: true,
  region: 'main',
});

const gondola: Maker = () => ({
  parts: [{ type: 'gondola', x: 0, z: 0 }],
  spots: [
    { x: 0, z: 0.95, rot: 2, kind: 'look' },
    { x: 0, z: -0.95, rot: 0, kind: 'look' },
  ],
  wall: false,
  region: 'main',
});

const drinksFridge: Maker = () => ({
  parts: [{ type: 'drinks_fridge', x: 0, z: 0.36 }],
  spots: [{ x: 0, z: 1.1, rot: 2, kind: 'look' }],
  wall: true,
});

const booth: Maker = () => ({
  parts: [
    { type: 'booth_bench', x: 0, z: 0.3 },
    { type: 'booth_table', x: 0, z: 0.95 },
    { type: 'booth_bench', x: 0, z: 1.6, rot: 2 },
  ],
  // In from the open ends of the benches
  seats: [
    { ...seatAround(0, -0.4, 0.4, 0, 0.46), ax: -1.3, az: 0.4 },
    { ...seatAround(0, 0.4, 0.4, 0, 0.46), ax: 1.3, az: 0.4 },
    { ...seatAround(2, -0.4, 1.5, 2, 0.46), ax: -1.3, az: 1.5 },
    { ...seatAround(2, 0.4, 1.5, 2, 0.46), ax: 1.3, az: 1.5 },
  ],
  wall: true,
  region: 'main',
});

const poolTable: Maker = () => ({
  parts: [{ type: 'pool_table', x: 0, z: 0 }],
  spots: [
    { x: 0, z: 1.15, rot: 2, kind: 'stand' },
    { x: 1.55, z: 0, rot: 3, kind: 'stand' },
  ],
  wall: false,
  region: 'main',
});

const jukebox: Maker = () => ({
  parts: [{ type: 'jukebox', x: 0, z: 0.3 }],
  spots: [{ x: 0, z: 1.0, rot: 2, kind: 'look' }],
  decor: [{ type: 'neon', x: 0, y: 2.2, w: 1.4, h: 0.5 }],
  wall: true,
});

const decks: Maker = rnd => ({
  parts: [
    { type: 'decks', x: 0, z: 1.1 },
    { type: 'speaker', x: -1.35, z: 0.3 },
    { type: 'speaker', x: 1.35, z: 0.3 },
    ...(rnd() < 0.7 ? [{ type: 'mic' as const, x: 1.4, z: 1.9 }] : []),
  ],
  spots: [{ x: 0, z: 0.35, rot: 0, kind: 'counter', owner: true }],
  decor: [{ type: 'neon', x: 0, y: 2.3, w: 1.8, h: 0.55 }],
  wall: true,
  region: 'main',
});

const records: Maker = rnd => ({
  parts: [
    { type: 'record_shelf', x: 0, z: 0.2 },
    { type: 'record_crate', x: rnd() < 0.5 ? -0.4 : 0.4, z: 0.75 },
  ],
  spots: [{ x: 0, z: 1.4, rot: 2, kind: 'look' }],
  decor: [{ type: 'poster', x: 0, y: 2.35, w: 0.9, h: 0.55 }],
  wall: true,
});

const crates: Maker = () => ({
  parts: [
    { type: 'record_crate', x: -0.45, z: 0.25 },
    { type: 'record_crate', x: 0.45, z: 0.25 },
  ],
  spots: [{ x: 0, z: 0.95, rot: 2, kind: 'look' }],
  decor: [{ type: 'poster', x: 0, y: 1.5, w: 1.0, h: 1.0 }],
  wall: true,
});

const plinth: Maker = () => ({
  parts: [{ type: 'plinth', x: 0, z: 0 }],
  spots: [{ x: 0, z: 0.95, rot: 2, kind: 'look' }],
  wall: false,
  region: 'main',
});

const galleryRug: Maker = rnd => ({
  parts: [{ type: 'rug', x: 0, z: 0, w: pick(rnd, [2.6, 3.2]), d: pick(rnd, [1.8, 2.2]) }],
  wall: false,
  region: 'main',
});

const galleryBench: Maker = () => ({
  parts: [{ type: 'bench', x: 0, z: 0 }],
  seats: benchSeats(0, 0, 0, 1.4, 2, 0.46),
  wall: false,
  region: 'main',
});

const deskSet: Maker = () => ({
  parts: [
    { type: 'desk', x: 0, z: 0.9 },
    { type: 'chair', x: 0, z: 0.25 },
  ],
  spots: [{ x: 0, z: 0.25, rot: 0, kind: 'counter', owner: true }],
  wall: true,
  region: 'main',
});

const cabinetRow: Maker = rnd => {
  const n = int(rnd, 2, 4);
  const parts: Part[] = [];
  const seats: SetSeat[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i - (n - 1) / 2) * 0.95;
    parts.push({ type: 'cabinet', x, z: 0.43 });
  }
  for (let i = 0; i < n; i += 2) {
    const x = (i - (n - 1) / 2) * 0.95;
    parts.push({ type: 'stool', x, z: 1.35, rot: 2 });
    seats.push(seatAround(parts.length - 1, x, 1.35, 2, 0.76, 'behind'));
  }
  return { parts, seats, wall: true, region: 'main' };
};

const claw: Maker = () => ({
  parts: [{ type: 'claw', x: 0, z: 0 }],
  spots: [{ x: 0, z: 1.0, rot: 2, kind: 'stand' }],
  wall: false,
  region: 'main',
});

const barberStation: Maker = () => ({
  parts: [{ type: 'barber_chair', x: 0, z: 1.05, rot: 2 }],
  seats: [seatAround(0, 0, 1.05, 2, 0.6, 'behind')],
  spots: [{ x: 0.75, z: 1.25, rot: 3, kind: 'work' }],
  decor: [{ type: 'mirror', x: 0, y: 1.45, w: 0.9, h: 1.1 }],
  wall: true,
  region: 'main',
});

const waitingBench: Maker = () => ({
  parts: [{ type: 'bench', x: 0, z: 0.3 }],
  seats: benchSeats(0, 0, 0.3, 1.5, 3, 0.46),
  decor: [{ type: 'poster', x: 0, y: 1.6, w: 1.2, h: 0.8 }],
  wall: true,
});

const washers: Maker = rnd => {
  const n = int(rnd, 3, 5);
  const parts: Part[] = [];
  for (let i = 0; i < n; i++)
    parts.push({ type: i % 2 === 0 ? 'washer' : 'dryer', x: (i - (n - 1) / 2) * 0.74, z: 0.36 });
  return {
    parts,
    spots: [{ x: 0, z: 1.15, rot: 2, kind: 'work' }],
    decor: [{ type: 'wall_shelf', x: 0, y: 2.25, w: Math.min(2.4, n * 0.7), h: 0.3 }],
    wall: true,
    region: 'main',
  };
};

const foldingTable: Maker = () => ({
  parts: [{ type: 'folding_table', x: 0, z: 0 }],
  spots: [{ x: 0, z: 0.85, rot: 2, kind: 'work' }],
  wall: false,
  region: 'main',
});

const vending: Maker = () => ({
  parts: [{ type: 'vending', x: 0, z: 0.4 }],
  spots: [{ x: 0, z: 1.2, rot: 2, kind: 'look' }],
  wall: true,
});

const treadmill: Maker = rnd => {
  // A row of one to three, side by side, with room to step on at the back
  const n = 1 + Math.floor(rnd() * 3);
  const parts: Part[] = [];
  for (let i = 0; i < n; i++) parts.push({ type: 'treadmill', x: (i - (n - 1) / 2) * 1.15, z: 0 });
  return {
    parts,
    spots: [{ x: 0, z: -1.35, rot: 0, kind: 'work' }],
    wall: false,
    region: 'main',
  };
};

const punchBag: Maker = () => ({
  parts: [
    { type: 'mat', x: 0, z: 0, w: 1.8, d: 1.8 },
    { type: 'bag', x: 0, z: 0 },
  ],
  spots: [{ x: 0, z: 1.0, rot: 2, kind: 'work' }],
  wall: false,
  region: 'main',
});

const yogaMats: Maker = rnd => ({
  parts: [0, 1, 2].slice(0, 2 + Math.floor(rnd() * 2)).map(i => ({
    type: 'mat' as const,
    x: (i - 1) * 1.0,
    z: 0,
    w: 0.7,
    d: 1.8,
  })),
  wall: false,
  region: 'main',
});

const weights: Maker = () => ({
  parts: [
    { type: 'mat', x: 0, z: 1.2, w: 1.6, d: 2.2 },
    { type: 'weight_bench', x: 0, z: 1.2 },
    { type: 'dumbbell_rack', x: 0, z: 0.25 },
  ],
  seats: [seatAround(1, 0, 1.2, 1, 0.5)],
  decor: [{ type: 'mirror', x: 0, y: 1.4, w: 1.6, h: 1.4 }],
  wall: true,
  region: 'main',
});

const cooler: Maker = () => ({
  parts: [{ type: 'water_cooler', x: 0, z: 0.25 }],
  spots: [{ x: 0, z: 0.95, rot: 2, kind: 'look' }],
  wall: true,
});

/** Each kind's sets: [maker, weight, max count, required]. */
const SETS: Record<InteriorKind, [Maker, number, number, boolean][]> = {
  home: [
    [lounge, 1, 1, true],
    [kitchen, 1, 1, true],
    [bedroom, 1, 1, true],
    [dining, 1, 1, false],
    [books, 0.8, 2, false],
    [armchairNook, 0.6, 1, false],
    [wardrobe, 0.6, 1, false],
    [plantCorner, 1, 3, false],
    [lampCorner, 0.5, 1, false],
  ],
  cafe: [
    [counterSet(3, 'menu', 'pastry_case'), 1, 1, true],
    [cafeTable, 1.2, 5, true],
    [plantCorner, 1, 3, false],
    [books, 0.3, 1, false],
    [armchairNook, 0.4, 1, false],
    [drinksFridge, 0.5, 1, false],
  ],
  shop: [
    [counterSet(0, 'menu', 'drinks_fridge'), 1, 1, true],
    [shopShelf, 1.5, 5, true],
    [waitingBench, 0.5, 1, true],
    [gondola, 1, 2, false],
    [drinksFridge, 0.6, 2, false],
    [plantCorner, 0.6, 2, false],
  ],
  bar: [
    [counterSet(4, 'neon'), 1, 1, true],
    [booth, 1, 2, false],
    [poolTable, 0.8, 1, false],
    [jukebox, 0.8, 1, false],
    [cafeTable, 0.8, 3, false],
    [plantCorner, 0.4, 2, false],
  ],
  studio: [
    [decks, 1, 1, true],
    [records, 1.2, 3, true],
    [crates, 1, 2, false],
    [lounge, 0.8, 1, true],
    [armchairNook, 0.5, 1, true],
    [plantCorner, 0.6, 2, false],
  ],
  gallery: [
    [deskSet, 1, 1, true],
    [plinth, 1.2, 6, true],
    [galleryBench, 1, 2, true],
    [galleryRug, 0.8, 1, false],
    [crates, 0.5, 1, false],
    [armchairNook, 0.4, 1, false],
    [plantCorner, 0.8, 3, false],
    [lampCorner, 0.5, 2, false],
  ],
  arcade: [
    [counterSet(0, 'neon'), 1, 1, true],
    [cabinetRow, 1.5, 4, true],
    [claw, 0.8, 1, false],
    [vending, 0.6, 1, false],
  ],
  barber: [
    [counterSet(0, 'mirror'), 0.6, 1, false],
    [barberStation, 1.5, 3, true],
    [shopShelf, 0.6, 1, false],
    [armchairNook, 0.4, 1, false],
    [lampCorner, 0.4, 1, false],
    [waitingBench, 1, 1, true],
    [plantCorner, 0.8, 2, false],
    [books, 0.3, 1, false],
  ],
  laundromat: [
    [washers, 1.5, 3, true],
    [foldingTable, 1, 2, true],
    [waitingBench, 1, 1, true],
    [vending, 0.7, 1, false],
    [plantCorner, 0.5, 1, false],
  ],
  gym: [
    [deskSet, 1, 1, true],
    [weights, 1.2, 2, true],
    [treadmill, 1.2, 2, true],
    [punchBag, 1, 2, false],
    [yogaMats, 0.8, 1, false],
    [shopShelf, 0.5, 1, false],
    [waitingBench, 0.6, 1, false],
    [cooler, 0.7, 1, false],
    [plantCorner, 0.6, 2, false],
  ],
};

// ── Palettes ─────────────────────────────────────────────────────────────

const PALETTES: Record<InteriorKind, Palette[]> = {
  home: [
    {
      wall: 0xf1e3c8,
      wall2: 0xd99a6c,
      floor: 0xb07a4a,
      floor2: 0x8f5f36,
      trim: 0xfaf6ee,
      ceiling: 0xf6efe2,
      wood: 0x9b6a40,
      fabric: 0x4f7cac,
      accent: 0xe8543f,
      metal: 0x9aa3ad,
    },
    {
      wall: 0xdfe9e1,
      wall2: 0x8fb8a0,
      floor: 0xc49a6c,
      floor2: 0xa67c50,
      trim: 0xffffff,
      ceiling: 0xf4f4ef,
      wood: 0x7c5233,
      fabric: 0xd9a23f,
      accent: 0x3f6fb0,
      metal: 0x8f969e,
    },
    {
      wall: 0xf3d6d1,
      wall2: 0xb85c5c,
      floor: 0x9c6b47,
      floor2: 0x7e5233,
      trim: 0xfff8f0,
      ceiling: 0xf8efea,
      wood: 0x6f4a2d,
      fabric: 0x5a8f6a,
      accent: 0xf2c94c,
      metal: 0xa0a0a8,
    },
  ],
  cafe: [
    {
      wall: 0xf4e7d3,
      wall2: 0x2f5e4e,
      floor: 0x3a3a3a,
      floor2: 0xf0ece4,
      trim: 0x2b2b2b,
      ceiling: 0xefe6d6,
      wood: 0xa8744a,
      fabric: 0xc0533a,
      accent: 0xf2b134,
      metal: 0xb8bcc2,
    },
    {
      wall: 0xe9f0f2,
      wall2: 0xd96c4f,
      floor: 0xb8875a,
      floor2: 0x9a6c42,
      trim: 0x223344,
      ceiling: 0xf6f6f2,
      wood: 0x6d4a30,
      fabric: 0x2f7a8c,
      accent: 0xffd166,
      metal: 0x9aa0a6,
    },
  ],
  shop: [
    {
      wall: 0xf7f4ea,
      wall2: 0xf3322c,
      floor: 0xd6d2c8,
      floor2: 0xbab5aa,
      trim: 0x2b2b2b,
      ceiling: 0xffffff,
      wood: 0xc49a6c,
      fabric: 0x3f6fb0,
      accent: 0xffd400,
      metal: 0xaab0b8,
    },
    {
      wall: 0xe7f1ec,
      wall2: 0x2c6fb0,
      floor: 0xcfc6b4,
      floor2: 0xb0a690,
      trim: 0x1f2a33,
      ceiling: 0xf7f7f7,
      wood: 0xa57a4f,
      fabric: 0xe0563f,
      accent: 0x2fbf71,
      metal: 0x9ea6ae,
    },
  ],
  bar: [
    {
      wall: 0x3a2430,
      wall2: 0x6b2f3a,
      floor: 0x4a3024,
      floor2: 0x3a241a,
      trim: 0xc9a14a,
      ceiling: 0x241820,
      wood: 0x6a3f24,
      fabric: 0x8a2433,
      accent: 0xff3d8b,
      metal: 0xc9a14a,
    },
    {
      wall: 0x22303a,
      wall2: 0x2f5e6e,
      floor: 0x3d2d22,
      floor2: 0x2e2018,
      trim: 0xd9b45a,
      ceiling: 0x1a2228,
      wood: 0x5c3820,
      fabric: 0x1f6f6a,
      accent: 0x2af0ff,
      metal: 0xb08d4a,
    },
  ],
  studio: [
    {
      wall: 0x2b2b3a,
      wall2: 0x4a3f6b,
      floor: 0x5b4636,
      floor2: 0x463426,
      trim: 0x111111,
      ceiling: 0x1f1f28,
      wood: 0x6b4a33,
      fabric: 0x7a4ab0,
      accent: 0xff7a1a,
      metal: 0x8f96a0,
    },
    {
      wall: 0xe8e2d6,
      wall2: 0x1f1f1f,
      floor: 0x8a6a4a,
      floor2: 0x6e5236,
      trim: 0x1f1f1f,
      ceiling: 0xf0ebe0,
      wood: 0x5c4030,
      fabric: 0xd94c3a,
      accent: 0x2fbf71,
      metal: 0x9aa0a6,
    },
  ],
  gallery: [
    {
      wall: 0xfafaf7,
      wall2: 0xf0efe9,
      floor: 0xd8d3c8,
      floor2: 0xc9c3b6,
      trim: 0xe8e6e0,
      ceiling: 0xffffff,
      wood: 0xb79a76,
      fabric: 0x2b2b2b,
      accent: 0xf3322c,
      metal: 0x9a9a9a,
    },
  ],
  arcade: [
    {
      wall: 0x1a1430,
      wall2: 0x3b1f6b,
      floor: 0x241d3d,
      floor2: 0x15102a,
      trim: 0xff3d8b,
      ceiling: 0x120e22,
      wood: 0x3a2a5a,
      fabric: 0x2af0ff,
      accent: 0xffe14d,
      metal: 0x8a8aa0,
    },
  ],
  barber: [
    {
      wall: 0xf3efe6,
      wall2: 0x1f3b6b,
      floor: 0xf0f0f0,
      floor2: 0x1f1f1f,
      trim: 0xc8102e,
      ceiling: 0xffffff,
      wood: 0x7a5232,
      fabric: 0x8a2a2a,
      accent: 0xc8102e,
      metal: 0xc0c4ca,
    },
  ],
  laundromat: [
    {
      wall: 0xdff1f6,
      wall2: 0x5fb3c9,
      floor: 0xe6e6e0,
      floor2: 0x9fc9d6,
      trim: 0x2c6fb0,
      ceiling: 0xffffff,
      wood: 0xc9a27a,
      fabric: 0xf2c94c,
      accent: 0xff7a59,
      metal: 0xd6dadf,
    },
  ],
  gym: [
    {
      wall: 0x4a5059,
      wall2: 0xf2c94c,
      floor: 0x50565e,
      floor2: 0x3a3f46,
      trim: 0xf2c94c,
      ceiling: 0x2b2f34,
      wood: 0x8a6a4a,
      fabric: 0xc23a2b,
      accent: 0xf2c94c,
      metal: 0xa8b0b8,
    },
  ],
};

const FLOORS: Record<InteriorKind, Layout['floorStyle'][]> = {
  home: ['planks', 'planks', 'carpet'],
  cafe: ['checker', 'planks', 'tiles'],
  shop: ['tiles', 'concrete'],
  bar: ['planks'],
  studio: ['planks', 'carpet'],
  gallery: ['concrete', 'planks'],
  arcade: ['carpet', 'checker'],
  barber: ['checker'],
  laundromat: ['tiles'],
  gym: ['concrete'],
};

// ── Sizing ───────────────────────────────────────────────────────────────

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

/** Room size for a kind and a building (interiors are a bit smaller than outside). */
export function roomSize(i: LayoutInput, rnd: Rng): { w: number; d: number; h: number } {
  const big = i.kind === 'gym' || i.kind === 'gallery' || i.kind === 'arcade' || i.kind === 'bar';
  const minW = i.kind === 'home' ? 8.5 : big ? 9 : 7;
  const minD = i.kind === 'home' ? 8.5 : big ? 8 : 6.5;
  const maxW = big ? 13 : 11;
  const maxD = big ? 11 : 10;
  const wf = i.frontage ?? 9 + rnd() * 4;
  const df = i.depth ?? 8 + rnd() * 4;
  const w = Math.round(clamp(wf * 0.82, minW, maxW) * 2) / 2;
  const d = Math.round(clamp(df * 0.82, minD, maxD) * 2) / 2;
  const tall = i.kind === 'gallery' || i.kind === 'gym';
  const h = tall ? 4.0 : clamp(Math.round((i.height ?? 3.4) * 2) / 2, 3.0, 3.4);
  return { w, d, h };
}

// ── Generator ────────────────────────────────────────────────────────────

/** Where the door opens and what must stay clear in front of it. */
export function doorKeepOut(l: Pick<Layout, 'door'>): Box2 {
  return {
    minX: l.door.x - l.door.width / 2 - 0.45,
    maxX: l.door.x + l.door.width / 2 + 0.45,
    minZ: 0,
    maxZ: 1.8,
  };
}

/** Where you stand on coming in (just inside the door). */
export function entryPoint(l: Pick<Layout, 'door'>): [number, number] {
  return [l.door.x, 1.0];
}

interface Placed {
  item: number;
  cells: number[];
}

export function generateLayout(input: LayoutInput): Layout {
  const seed = hash32(`room:${input.id}:${input.kind}`);
  const rnd = mulberry32(seed);
  const { w, d, h } = roomSize(input, rnd);
  const palette = pick(rnd, PALETTES[input.kind]);
  const floorStyle = pick(rnd, FLOORS[input.kind]);
  // Door: off-centre in a third of the wall, homes and shops alike
  const doorW = 1.2;
  const doorX = Math.round((rnd() - 0.5) * (w - 3) * 0.6 * 10) / 10;
  const layout: Layout = {
    id: input.id,
    kind: input.kind,
    seed,
    w,
    d,
    h,
    door: { x: doorX, width: doorW },
    palette,
    floorStyle,
    regions: [{ name: 'main', minX: -w / 2, maxX: w / 2, minZ: 0, maxZ: d }],
    partitions: [],
    items: [],
    seats: [],
    spots: [],
    decor: [],
    lights: [],
  };
  const grid = new Grid(w, d);
  // Homes: a bedroom behind a partition along the back, with a doorway
  if (input.kind === 'home') {
    const split = Math.round((d - Math.max(3.2, d * 0.38)) * 10) / 10;
    const gx = Math.round(clamp((rnd() - 0.5) * (w - 2.4), -w / 2 + 1.1, w / 2 - 2.1) * 10) / 10;
    layout.partitions.push({ axis: 'z', at: split, from: -w / 2, to: w / 2, gap: [gx, gx + 1.0] });
    layout.regions = [
      { name: 'main', minX: -w / 2, maxX: w / 2, minZ: 0, maxZ: split },
      { name: 'bedroom', minX: -w / 2, maxX: w / 2, minZ: split, maxZ: d },
    ];
    grid.block({ minX: -w / 2, maxX: gx, minZ: split - 0.06, maxZ: split + 0.06 });
    grid.block({ minX: gx + 1.0, maxX: w / 2, minZ: split - 0.06, maxZ: split + 0.06 });
  }
  const keep = doorKeepOut(layout);
  const [ex, ez] = entryPoint(layout);

  // Windows first (decor reserves wall space): on the door wall either
  // side of the door, and on a side or back wall
  addWindows(layout, rnd);

  // Sets: required ones first, then by weight while there's floor
  const defs = SETS[input.kind];
  const area = w * d;
  const budget = Math.round(area / (input.kind === 'home' ? 7 : 6.5));
  const counts = new Map<Maker, number>();
  // Required sets get several goes (each go is a fresh variant), first
  const required = defs.filter(s => s[3]).map(s => s[0]);
  let attempts = 0;
  for (const maker of required)
    for (let go = 0; go < 6; go++) {
      attempts++;
      const set = maker(mulberry32(hash32(`${input.id}:set:${attempts}`)));
      if (placeSet(layout, grid, set, rnd, keep, ex, ez, 60) !== null) {
        counts.set(maker, (counts.get(maker) ?? 0) + 1);
        break;
      }
    }
  for (let n = 0, placedN = 0; n < budget * 4 && placedN < budget; n++) {
    const open = defs.filter(s => (counts.get(s[0]) ?? 0) < s[2]);
    if (open.length === 0) break;
    let total = 0;
    for (const s of open) total += s[1];
    let r = rnd() * total;
    let maker = open[open.length - 1]![0];
    for (const s of open) {
      r -= s[1];
      if (r < 0) {
        maker = s[0];
        break;
      }
    }
    attempts++;
    const set = maker(mulberry32(hash32(`${input.id}:set:${attempts}`)));
    if (placeSet(layout, grid, set, rnd, keep, ex, ez, 26) !== null) {
      counts.set(maker, (counts.get(maker) ?? 0) + 1);
      placedN++;
    }
  }

  // Free-standing spots for residents to mill about (open floor, reachable)
  const seen = grid.flood(ex, ez);
  for (let k = 0; k < 6; k++) {
    for (let t = 0; t < 12; t++) {
      const x = -w / 2 + 0.8 + rnd() * (w - 1.6);
      const z = 1.6 + rnd() * (d - 2.4);
      if (!grid.reached(seen, x, z) || inBox(keep, x, z)) continue;
      layout.spots.push({ x, z, yaw: rnd() * Math.PI * 2, kind: 'stand' });
      break;
    }
  }

  // Wall decor: posters and frames on bare wall
  addWallArt(layout, rnd);

  // Lights: a grid of ceiling fixtures
  const kindLight: Layout['lights'][number]['kind'] =
    input.kind === 'arcade' || input.kind === 'bar'
      ? 'neon'
      : input.kind === 'gym' || input.kind === 'laundromat' || input.kind === 'shop'
        ? 'panel'
        : input.kind === 'gallery'
          ? 'panel'
          : 'pendant';
  const nx = w > 9 ? 3 : 2;
  const nz = d > 8 ? 2 : 1;
  for (let i = 0; i < nx; i++)
    for (let j = 0; j < nz; j++)
      layout.lights.push({
        x: -w / 2 + (w * (i + 0.5)) / nx,
        z: (d * (j + 0.5)) / nz + (nz === 1 ? 0.3 : 0),
        kind: kindLight,
      });
  return layout;
}

function inBox(b: Box2, x: number, z: number) {
  return x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ;
}

/** Wall length and the room-frame mapping for a wall-hugging set. */
function wallFrame(l: Layout, wall: Wall) {
  // rot: the set's front (+z) turned to face into the room
  switch (wall) {
    case 'n':
      return {
        len: l.w,
        rot: 2 as const,
        at: (a: number, o: number): [number, number] => [-a, l.d - o],
      };
    case 's':
      return { len: l.w, rot: 0 as const, at: (a: number, o: number): [number, number] => [a, o] };
    case 'e':
      return {
        len: l.d,
        rot: 3 as const,
        at: (a: number, o: number): [number, number] => [l.w / 2 - o, l.d / 2 + a],
      };
    default:
      return {
        len: l.d,
        rot: 1 as const,
        at: (a: number, o: number): [number, number] => [-l.w / 2 + o, l.d / 2 - a],
      };
  }
}

/**
 * Room-frame decor position (x on the n/s walls, z on e/w) of a point `a`
 * along a wall set's own x axis.
 */
function decorAlong(wall: Wall, a: number, l: Layout): number {
  switch (wall) {
    case 'n':
      return -a;
    case 's':
      return a;
    case 'e':
      return l.d / 2 + a;
    default:
      return l.d / 2 - a;
  }
}

/** Set extents in its own frame. */
function setBounds(set: SetDef) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const p of set.parts) {
    const [sw, sd] = SIZE[p.type];
    const pw = p.w ?? sw;
    const pd = p.d ?? sd;
    const odd = (p.rot ?? 0) % 2 === 1;
    const hw = (odd ? pd : pw) / 2;
    const hd = (odd ? pw : pd) / 2;
    minX = Math.min(minX, p.x - hw);
    maxX = Math.max(maxX, p.x + hw);
    minZ = Math.min(minZ, p.z - hd);
    maxZ = Math.max(maxZ, p.z + hd);
  }
  return { minX, maxX, minZ, maxZ };
}

/**
 * Try to place a set: candidates along the walls (wall sets) or on the
 * open floor (free sets), first one that fits wins. Returns what it
 * placed, or null.
 */
function placeSet(
  l: Layout,
  grid: Grid,
  set: SetDef,
  rnd: Rng,
  keep: Box2,
  ex: number,
  ez: number,
  goes: number,
): Placed[] | null {
  const region = l.regions.find(r => r.name === (set.region ?? 'main')) ?? l.regions[0]!;
  const sb = setBounds(set);
  const tries: { ox: number; oz: number; rot: 0 | 1 | 2 | 3; wall?: Wall; along?: number }[] = [];
  if (set.wall) {
    const walls: Wall[] = ['n', 'e', 'w', 's'];
    for (let t = 0; t < goes; t++) {
      const wall = walls[Math.floor(rnd() * walls.length)]!;
      const f = wallFrame(l, wall);
      const half = (sb.maxX - sb.minX) / 2;
      const span = f.len / 2 - half - 0.05;
      if (span < 0) continue;
      const along = (rnd() * 2 - 1) * span - (sb.minX + sb.maxX) / 2;
      const [ox, oz] = f.at(along, 0.02 - sb.minZ * 0);
      tries.push({ ox, oz, rot: f.rot, wall, along });
    }
  } else {
    for (let t = 0; t < goes; t++) {
      const rot = (rnd() < 0.5 ? 0 : 1) as 0 | 1;
      const ox = region.minX + 1.0 + rnd() * (region.maxX - region.minX - 2.0);
      const oz = region.minZ + 1.0 + rnd() * (region.maxZ - region.minZ - 2.0);
      tries.push({ ox, oz, rot });
    }
  }
  for (const tr of tries) {
    const items: Item[] = set.parts.map((p, i) => {
      const [sw, sd, sh] = SIZE[p.type];
      const [dx, dz] = turn(p.x, p.z, tr.rot);
      return {
        type: p.type,
        x: tr.ox + dx,
        z: tr.oz + dz,
        rot: (((p.rot ?? 0) + tr.rot) % 4) as Item['rot'],
        w: p.w ?? sw,
        d: p.d ?? sd,
        h: p.h ?? sh,
        solid: !FLAT.has(p.type),
        seed: hash32(`${l.id}:item:${l.items.length + i}:${p.type}`),
      };
    });
    // Inside the region (and the room), clear of the doorway, overlapping nothing solid
    let fits = true;
    for (const it of items) {
      const b = itemBox(it);
      if (
        b.minX < region.minX + 0.02 ||
        b.maxX > region.maxX - 0.02 ||
        b.minZ < region.minZ + 0.02 ||
        b.maxZ > region.maxZ - 0.02
      ) {
        // Wall sets snug to the wall may touch the region edge exactly
        if (
          b.minX < -l.w / 2 - 1e-6 ||
          b.maxX > l.w / 2 + 1e-6 ||
          b.minZ < -1e-6 ||
          b.maxZ > l.d + 1e-6 ||
          b.minX < region.minX - 1e-6 ||
          b.maxX > region.maxX + 1e-6 ||
          b.minZ < region.minZ - 1e-6 ||
          b.maxZ > region.maxZ + 1e-6
        ) {
          fits = false;
          break;
        }
      }
      if (boxesOverlap(b, keep)) {
        fits = false;
        break;
      }
      // Nothing tall standing in front of a window
      if (it.solid && blocksWindow(l, b, it.h)) {
        fits = false;
        break;
      }
      for (const p of l.partitions) {
        const pb: Box2 =
          p.axis === 'z'
            ? { minX: p.from, maxX: p.to, minZ: p.at - 0.08, maxZ: p.at + 0.08 }
            : { minX: p.at - 0.08, maxX: p.at + 0.08, minZ: p.from, maxZ: p.to };
        if (boxesOverlap(b, pb)) {
          fits = false;
          break;
        }
        // Keep the partition's doorway clear too
        const gap: Box2 =
          p.axis === 'z'
            ? { minX: p.gap[0] - 0.2, maxX: p.gap[1] + 0.2, minZ: p.at - 1.1, maxZ: p.at + 1.1 }
            : { minX: p.at - 1.1, maxX: p.at + 1.1, minZ: p.gap[0] - 0.2, maxZ: p.gap[1] + 0.2 };
        if (boxesOverlap(b, gap)) {
          fits = false;
          break;
        }
      }
      if (!fits) break;
      for (const o of l.items) {
        if (!o.solid && !it.solid) {
          if (boxesOverlap(b, itemBox(o), -0.05)) {
            fits = false;
            break;
          }
          continue;
        }
        if (!o.solid || !it.solid) continue;
        if (boxesOverlap(b, itemBox(o), 0.02)) {
          fits = false;
          break;
        }
      }
      if (!fits) break;
    }
    if (!fits) continue;
    // Wall decor of the set must fit the wall (no window there)
    const decor: Decor[] = [];
    if (set.wall && tr.wall !== undefined && set.decor !== undefined) {
      for (const sd of set.decor) {
        const along = decorAlong(tr.wall, (tr.along ?? 0) + sd.x, l);
        const dd: Decor = {
          type: sd.type,
          wall: tr.wall,
          at: along,
          y: Math.min(sd.y, l.h - sd.h / 2 - 0.15),
          w: sd.w,
          h: sd.h,
          seed: hash32(`${l.id}:decor:${l.decor.length + decor.length}`),
        };
        if (decorClash(l, dd)) continue;
        decor.push(dd);
      }
    }
    // Block it on the grid, check every seat and spot (old and new) is still reachable
    const cells: number[][] = [];
    for (const it of items) if (it.solid) cells.push(grid.block(itemBox(it)));
    const base = l.items.length;
    const seats: Seat[] = (set.seats ?? []).map(s => {
      const [sx, sz] = turn(s.x, s.z, tr.rot);
      const [ax, az] = turn(s.ax, s.az, tr.rot);
      return {
        x: tr.ox + sx,
        z: tr.oz + sz,
        yaw: yawOf((s.rot + tr.rot) % 4),
        h: s.h,
        ax: tr.ox + ax,
        az: tr.oz + az,
        item: base + s.part,
      };
    });
    const spots: Spot[] = (set.spots ?? []).map(s => {
      const [sx, sz] = turn(s.x, s.z, tr.rot);
      return {
        x: tr.ox + sx,
        z: tr.oz + sz,
        yaw: yawOf((s.rot + tr.rot) % 4),
        kind: s.kind,
        owner: s.owner,
      };
    });
    const seen = grid.flood(ex, ez);
    let reach = grid.reached(seen, ex, ez);
    for (const s of [...l.seats, ...seats]) if (!grid.reached(seen, s.ax, s.az)) reach = false;
    // (the owner's place behind a counter is the staff's, not the public's)
    for (const s of [...l.spots, ...spots])
      if (s.owner !== true && !grid.reached(seen, s.x, s.z)) reach = false;
    if (!reach) {
      for (const c of cells) grid.unblock(c);
      continue;
    }
    l.items.push(...items);
    l.seats.push(...seats);
    l.spots.push(...spots);
    l.decor.push(...decor);
    return items.map((_, i) => ({ item: base + i, cells: cells[i] ?? [] }));
  }
  return null;
}

/** Wall decor overlapping a window, another decor, or the door. */
function decorClash(l: Layout, dd: Decor): boolean {
  const pad = 0.15;
  if (
    dd.wall === 's' &&
    Math.abs(dd.at - l.door.x) < dd.w / 2 + l.door.width / 2 + 0.3 &&
    dd.y - dd.h / 2 < 2.6
  )
    return true;
  const half = dd.wall === 'n' || dd.wall === 's' ? l.w / 2 : l.d / 2;
  const mid = dd.wall === 'e' || dd.wall === 'w' ? l.d / 2 : 0;
  if (Math.abs(dd.at - mid) + dd.w / 2 > half - 0.1) return true;
  for (const o of l.decor) {
    if (o.wall !== dd.wall) continue;
    if (
      Math.abs(o.at - dd.at) < (o.w + dd.w) / 2 + pad &&
      Math.abs(o.y - dd.y) < (o.h + dd.h) / 2 + pad
    )
      return true;
  }
  return false;
}

function addWindows(l: Layout, rnd: Rng) {
  const shopfront = l.kind !== 'home' && l.kind !== 'gym' && l.kind !== 'studio';
  // Door wall: a window either side of the door (shop windows run wide and low)
  for (const side of [-1, 1]) {
    const edge = side < 0 ? -l.w / 2 : l.w / 2;
    const doorEdge = l.door.x + (side * l.door.width) / 2;
    const room = Math.abs(edge - doorEdge) - 0.7;
    if (room < 1.0) continue;
    const ww = Math.min(shopfront ? 3.2 : 1.6, room);
    const at = doorEdge + side * (0.45 + ww / 2);
    const wh = shopfront ? 1.7 : 1.3;
    const y = shopfront ? 1.45 : 1.55;
    const dd: Decor = {
      type: 'window',
      wall: 's',
      at,
      y,
      w: ww,
      h: wh,
      seed: hash32(`${l.id}:win:${side}`),
    };
    l.decor.push(dd);
  }
  // A side or back wall window or two
  const walls: Wall[] = ['e', 'w', 'n'];
  const n = 1 + (rnd() < 0.5 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const wall = walls[Math.floor(rnd() * walls.length)]!;
    const len = wall === 'n' ? l.w : l.d;
    const ww = 1.4 + rnd() * 0.6;
    const at0 = (rnd() - 0.5) * (len - ww - 1.4);
    const at = wall === 'n' ? at0 : l.d / 2 + at0;
    const dd: Decor = {
      type: 'window',
      wall,
      at,
      y: 1.6,
      w: ww,
      h: 1.3,
      seed: hash32(`${l.id}:win2:${i}`),
    };
    if (!decorClash(l, dd)) l.decor.push(dd);
  }
}

/** Posters, frames, clocks, wall shelves on what bare wall is left. */
function addWallArt(l: Layout, rnd: Rng) {
  const types: DecorType[] =
    l.kind === 'gallery'
      ? ['frame', 'frame', 'frame']
      : l.kind === 'home'
        ? ['poster', 'frame', 'wall_shelf', 'clock']
        : l.kind === 'studio' || l.kind === 'arcade'
          ? ['poster', 'poster', 'neon']
          : ['poster', 'frame', 'clock'];
  const n = l.kind === 'gallery' ? 14 : 7;
  for (let k = 0, placed = 0; k < n * 6 && placed < n; k++) {
    const wall = pick(rnd, ['n', 'e', 'w', 'n', 's'] as Wall[]);
    const type = pick(rnd, types);
    // One clock is plenty
    if (type === 'clock' && l.decor.some(q => q.type === 'clock')) continue;
    const big = l.kind === 'gallery' ? 0.9 + rnd() * 0.9 : 0.6 + rnd() * 0.5;
    const w = type === 'clock' ? 0.45 : type === 'wall_shelf' ? 1.2 : type === 'neon' ? 1.4 : big;
    const h =
      type === 'clock'
        ? 0.45
        : type === 'wall_shelf'
          ? 0.3
          : type === 'neon'
            ? 0.5
            : big * (type === 'poster' ? 1.35 : 1.0);
    const len = wall === 'n' || wall === 's' ? l.w : l.d;
    const a = (rnd() - 0.5) * (len - w - 0.6);
    const at = wall === 'n' || wall === 's' ? a : l.d / 2 + a;
    const y =
      type === 'clock'
        ? Math.min(l.h - 0.5, 2.55)
        : Math.min(l.h - h / 2 - 0.25, 1.55 + rnd() * 0.3);
    const dd: Decor = { type, wall, at, y, w, h, seed: hash32(`${l.id}:art:${k}`) };
    if (decorClash(l, dd)) continue;
    // Not behind something tall standing against that wall
    if (tallAgainst(l, dd)) continue;
    l.decor.push(dd);
    placed++;
  }
}

/** Would something of height `h` at `b` stand in front of a window? */
function blocksWindow(l: Layout, b: Box2, h: number): boolean {
  for (const w of l.decor) {
    if (w.type !== 'window' || h < w.y - w.h / 2 + 0.05) continue;
    const near =
      w.wall === 'n'
        ? b.maxZ > l.d - 1.0
        : w.wall === 's'
          ? b.minZ < 1.0
          : w.wall === 'e'
            ? b.maxX > l.w / 2 - 1.0
            : b.minX < -l.w / 2 + 1.0;
    if (!near) continue;
    const [a0, a1] = w.wall === 'n' || w.wall === 's' ? [b.minX, b.maxX] : [b.minZ, b.maxZ];
    if (a1 > w.at - w.w / 2 && a0 < w.at + w.w / 2) return true;
  }
  return false;
}

/** Is there a tall item against `dd`'s wall where it would hang? */
function tallAgainst(l: Layout, dd: Decor): boolean {
  for (const it of l.items) {
    if (!it.solid) continue;
    const b = itemBox(it);
    const near =
      dd.wall === 'n'
        ? b.maxZ > l.d - 0.9
        : dd.wall === 's'
          ? b.minZ < 0.9
          : dd.wall === 'e'
            ? b.maxX > l.w / 2 - 0.9
            : b.minX < -l.w / 2 + 0.9;
    if (!near) continue;
    const [a0, a1] = dd.wall === 'n' || dd.wall === 's' ? [b.minX, b.maxX] : [b.minZ, b.maxZ];
    if (a1 < dd.at - dd.w / 2 || a0 > dd.at + dd.w / 2) continue;
    if (it.h > dd.y - dd.h / 2 - 0.1) return true;
  }
  return false;
}

/** The occupancy grid of a finished layout (for residents' paths and tests). */
export function layoutGrid(l: Layout, girth = GIRTH): Grid {
  const g = new Grid(l.w, l.d, girth);
  for (const p of l.partitions) {
    if (p.axis === 'z') {
      g.block({ minX: p.from, maxX: p.gap[0], minZ: p.at - 0.06, maxZ: p.at + 0.06 });
      g.block({ minX: p.gap[1], maxX: p.to, minZ: p.at - 0.06, maxZ: p.at + 0.06 });
    } else {
      g.block({ minX: p.at - 0.06, maxX: p.at + 0.06, minZ: p.from, maxZ: p.gap[0] });
      g.block({ minX: p.at - 0.06, maxX: p.at + 0.06, minZ: p.gap[1], maxZ: p.to });
    }
  }
  for (const it of l.items) if (it.solid) g.block(itemBox(it));
  return g;
}

/** Stealable things: goods on shelves, records, plates… (item indices). */
export function stealables(l: Layout): number[] {
  const out: number[] = [];
  l.items.forEach((it, i) => {
    if (
      it.type === 'shelf' ||
      it.type === 'gondola' ||
      it.type === 'pastry_case' ||
      it.type === 'record_crate' ||
      it.type === 'record_shelf' ||
      it.type === 'plinth' ||
      it.type === 'bookshelf' ||
      it.type === 'drinks_fridge' ||
      it.type === 'kitchen' ||
      it.type === 'side_table'
    )
      out.push(i);
  });
  return out;
}

/** Item size table (for the builder). */
export function itemSize(t: ItemType): [number, number, number] {
  return SIZE[t];
}
