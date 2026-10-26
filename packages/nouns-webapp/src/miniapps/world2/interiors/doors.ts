// ── Doors: every building's way in (pure, tested) ────────────────────────
//
// Input is a set of building footprints in some flat 2D frame (world x/z
// for the plaza; town coords v'/u for the mountain towns), each an axis-
// aligned rectangle. For every building:
//   1. each of its four walls gets its EXPOSED stretches: the wall minus
//      wherever a neighbouring building (or a tall blocker) stands right
//      outside it, so a party wall or a wall hard against a kiosk never
//      gets a door;
//   2. the walls are ranked by how squarely they face the street (a point
//      the caller gives per building: the plaza's centre, the town's main
//      street);
//   3. down that ranking, the first spot (closest to the middle of the
//      wall) that fits a door and whose approach is clear (the caller's
//      `clear`, e.g. a collision probe) gets it.
// The door sits on the wall's outer face, facing out; ids come from the
// footprint's own key, so they're the same every load.

import type { BuildingDoor, InteriorKind } from './contract';

import { identify } from './names';

export interface Rect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface Footprint extends Rect {
  /** Stable per building (rounded coords): the door id is `${area}:${key}`. */
  key: string;
  /** Height of the building (m). */
  height: number;
  /** World y of the ground in front of it (the door's sill). */
  ground: number;
  /** What its sign says, if anything (names it and suggests its kind). */
  sign?: string;
  kind?: InteriorKind;
}

/** A frame's way to world space (identity for the plaza). */
export interface DoorFrame {
  toWorld(x: number, z: number): { x: number; z: number };
  /** World yaw of a frame direction (dx, dz): three's yaw maps local +Z to (sin, cos). */
  yaw(dx: number, dz: number): number;
}

export const IDENTITY_FRAME: DoorFrame = {
  toWorld: (x, z) => ({ x, z }),
  yaw: (dx, dz) => Math.atan2(dx, dz),
};

export interface ExtractOptions {
  area: string;
  /** The street this building opens onto (a point in the frame). */
  street(fp: Footprint): { x: number; z: number };
  /** Other things standing outside walls (kiosks, porches…): rects in the frame. */
  blockers?: readonly Rect[];
  /**
   * Is the approach to a door at (x, z) on a wall facing (nx, nz) walkable?
   * (frame coords). Defaults to yes.
   */
  clear?(x: number, z: number, nx: number, nz: number, fp: Footprint): boolean;
  frame?: DoorFrame;
  /** Door width (m) and the least a squeezed one may have. */
  width?: number;
  minWidth?: number;
  /** Depth of the strip outside a wall that must be free for it to count as exposed. */
  approach?: number;
  /** Pushes the door this far out from the wall (sign and frame stand proud of it). */
  proud?: number;
}

export interface Wall {
  /** Outward normal (axis-aligned). */
  nx: number;
  nz: number;
  /** The wall's fixed coordinate (x for ±X walls, z for ±Z walls). */
  at: number;
  /** Span along the wall. */
  from: number;
  to: number;
}

export interface DoorSpot {
  x: number;
  z: number;
  nx: number;
  nz: number;
  width: number;
  /** True when no wall had a clear spot and the best exposed one was used anyway. */
  forced: boolean;
}

const EPS = 0.05;
/** Keep doors this far from a wall's ends (corners, neighbours). */
const CORNER = 0.35;
const STEP = 0.5;

export function walls(r: Rect): Wall[] {
  return [
    { nx: 0, nz: 1, at: r.maxZ, from: r.minX, to: r.maxX },
    { nx: 0, nz: -1, at: r.minZ, from: r.minX, to: r.maxX },
    { nx: 1, nz: 0, at: r.maxX, from: r.minZ, to: r.maxZ },
    { nx: -1, nz: 0, at: r.minX, from: r.minZ, to: r.maxZ },
  ];
}

/** The strip of ground just outside a wall, `depth` deep. */
export function stripOutside(w: Wall, depth: number): Rect {
  if (w.nz !== 0) {
    const z0 = w.nz > 0 ? w.at : w.at - depth;
    return { minX: w.from, maxX: w.to, minZ: z0, maxZ: z0 + depth };
  }
  const x0 = w.nx > 0 ? w.at : w.at - depth;
  return { minX: x0, maxX: x0 + depth, minZ: w.from, maxZ: w.to };
}

export function overlaps(a: Rect, b: Rect, eps = EPS): boolean {
  return (
    a.minX < b.maxX - eps && a.maxX > b.minX + eps && a.minZ < b.maxZ - eps && a.maxZ > b.minZ + eps
  );
}

/** The wall's stretches with nothing standing right outside them. */
export function exposed(w: Wall, others: readonly Rect[], depth: number): [number, number][] {
  const strip = stripOutside(w, depth);
  const cuts: [number, number][] = [];
  for (const o of others) {
    if (!overlaps(strip, o)) continue;
    cuts.push(w.nz !== 0 ? [o.minX, o.maxX] : [o.minZ, o.maxZ]);
  }
  cuts.sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  let from = w.from;
  for (const [c0, c1] of cuts) {
    if (c0 > from) out.push([from, Math.min(c0, w.to)]);
    from = Math.max(from, c1);
    if (from >= w.to) break;
  }
  if (from < w.to) out.push([from, w.to]);
  return out.filter(([a, b]) => b - a > EPS);
}

/** How squarely a wall faces the street point (−1 … 1). */
export function facing(w: Wall, street: { x: number; z: number }): number {
  const mid = (w.from + w.to) / 2;
  const cx = w.nz !== 0 ? mid : w.at;
  const cz = w.nz !== 0 ? w.at : mid;
  const dx = street.x - cx;
  const dz = street.z - cz;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return 0;
  return (w.nx * dx + w.nz * dz) / d;
}

/** Corner margin for a stretch: the full CORNER when there's room, less on a narrow one. */
function cornerFor(len: number, minWidth: number): number {
  return Math.min(CORNER, Math.max(0.05, (len - minWidth) / 2));
}

/** Candidate door centres along an exposed stretch, middle first. */
function candidates(a: number, b: number, half: number, corner: number): number[] {
  const lo = a + half + corner;
  const hi = b - half - corner;
  if (hi < lo - 1e-9) return [];
  const mid = (lo + hi) / 2;
  const out = [mid];
  for (let k = 1; mid - k * STEP >= lo || mid + k * STEP <= hi; k++) {
    if (mid - k * STEP >= lo) out.push(mid - k * STEP);
    if (mid + k * STEP <= hi) out.push(mid + k * STEP);
  }
  return out;
}

/** Find one building's door spot (frame coords), or null if it's walled in on every side. */
export function doorSpot(
  fp: Footprint,
  others: readonly Rect[],
  opts: ExtractOptions,
): DoorSpot | null {
  const width = opts.width ?? 1.4;
  const minWidth = opts.minWidth ?? 0.9;
  const depth = opts.approach ?? 1.4;
  const street = opts.street(fp);
  const ranked = walls(fp)
    .map(w => ({ w, score: facing(w, street), open: exposed(w, others, depth) }))
    .filter(r => r.open.length > 0)
    .sort((a, b) => b.score - a.score);
  let fallback: DoorSpot | null = null;
  for (const { w, open } of ranked) {
    // Widest stretch first, then the rest
    const stretches = [...open].sort((p, q) => q[1] - q[0] - (p[1] - p[0]));
    for (const [a, b] of stretches) {
      const corner = cornerFor(b - a, minWidth);
      const fit = Math.min(width, b - a - 2 * corner);
      if (fit < minWidth - 1e-9) continue;
      for (const t of candidates(a, b, fit / 2, corner)) {
        const x = w.nz !== 0 ? t : w.at;
        const z = w.nz !== 0 ? w.at : t;
        const spot: DoorSpot = { x, z, nx: w.nx, nz: w.nz, width: fit, forced: false };
        if (opts.clear === undefined || opts.clear(x, z, w.nx, w.nz, fp)) return spot;
        fallback ??= { ...spot, forced: true };
      }
    }
  }
  return fallback;
}

/** World AABB of a frame rect. */
function worldBox(r: Rect, frame: DoorFrame) {
  let minX = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxZ = -Infinity;
  for (const [x, z] of [
    [r.minX, r.minZ],
    [r.maxX, r.minZ],
    [r.minX, r.maxZ],
    [r.maxX, r.maxZ],
  ] as const) {
    const w = frame.toWorld(x, z);
    minX = Math.min(minX, w.x);
    maxX = Math.max(maxX, w.x);
    minZ = Math.min(minZ, w.z);
    maxZ = Math.max(maxZ, w.z);
  }
  return { minX, minZ, maxX, maxZ };
}

/** Length two rects share along a common wall (0 when they don't touch). */
export function sharedWall(a: Rect, b: Rect, eps = 0.1): number {
  const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const oz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
  if (Math.abs(ox) <= eps && oz > 0) return oz;
  if (Math.abs(oz) <= eps && ox > 0) return ox;
  return 0;
}

export interface DoorPlan {
  doors: BuildingDoor[];
  /**
   * Buildings with no wall you can reach (a corner block hidden behind its
   * neighbours): key → the door of the neighbour they're part of.
   */
  absorbed: Map<string, string>;
  /** Buildings that got a door although no spot passed the approach check. */
  forced: string[];
}

/**
 * Doors for every footprint: one each, on the best clear spot. A building
 * with no clear spot anywhere joins the neighbour it shares the longest
 * wall with (its door is theirs); with no such neighbour it keeps its best
 * exposed spot anyway (listed in `forced`).
 */
export function planDoors(fps: readonly Footprint[], opts: ExtractOptions): DoorPlan {
  const frame = opts.frame ?? IDENTITY_FRAME;
  const proud = opts.proud ?? 0.06;
  const blockers = opts.blockers ?? [];
  const spots = new Map<Footprint, DoorSpot>();
  for (const fp of fps) {
    const others: Rect[] = [...blockers];
    for (const o of fps) if (o !== fp) others.push(o);
    const s = doorSpot(fp, others, opts);
    if (s !== null) spots.set(fp, s);
  }
  const doors: BuildingDoor[] = [];
  const ids = new Map<Footprint, string>();
  const seen = new Set<string>();
  const forced: string[] = [];
  const orphans: Footprint[] = [];
  const emit = (fp: Footprint, s: DoorSpot): string => {
    let id = `${opts.area}:${fp.key}`;
    for (let k = 2; seen.has(id); k++) id = `${opts.area}:${fp.key}#${k}`;
    seen.add(id);
    const w = frame.toWorld(s.x + s.nx * proud, s.z + s.nz * proud);
    const fw = (fp.maxX - fp.minX) * (fp.maxZ - fp.minZ);
    const who = identify(id, opts.area, fw, fp.sign, fp.kind);
    doors.push({
      id,
      area: opts.area,
      x: w.x,
      y: fp.ground,
      z: w.z,
      yaw: frame.yaw(s.nx, s.nz),
      width: s.width,
      footprint: { ...worldBox(fp, frame), height: fp.height },
      kind: who.kind,
      name: who.name,
    });
    return id;
  };
  for (const fp of fps) {
    const s = spots.get(fp);
    if (s === undefined || s.forced) orphans.push(fp);
    else ids.set(fp, emit(fp, s));
  }
  const absorbed = new Map<string, string>();
  for (const fp of orphans) {
    let best: Footprint | null = null;
    let len = 0.9;
    for (const o of fps) {
      if (!ids.has(o)) continue;
      const l = sharedWall(fp, o);
      if (l > len) {
        len = l;
        best = o;
      }
    }
    if (best !== null) {
      absorbed.set(fp.key, ids.get(best)!);
      continue;
    }
    const s = spots.get(fp);
    if (s === undefined) continue;
    forced.push(fp.key);
    ids.set(fp, emit(fp, s));
  }
  return { doors, absorbed, forced };
}

/** The doors of planDoors (absorbed buildings share their neighbour's). */
export function extractDoors(fps: readonly Footprint[], opts: ExtractOptions): BuildingDoor[] {
  return planDoors(fps, opts).doors;
}

/**
 * Split a long block into roughly `target`-metre buildings along its
 * longer side (a terrace of shops reads as several buildings, each with a
 * door). Keys get a part suffix.
 */
export function splitLong(fp: Footprint, target = 16, maxLen = 24): Footprint[] {
  const lx = fp.maxX - fp.minX;
  const lz = fp.maxZ - fp.minZ;
  const long = Math.max(lx, lz);
  if (long <= maxLen) return [fp];
  const n = Math.max(2, Math.round(long / target));
  const out: Footprint[] = [];
  for (let i = 0; i < n; i++) {
    const a = i / n;
    const b = (i + 1) / n;
    out.push(
      lx >= lz
        ? {
            ...fp,
            key: `${fp.key}.${i}`,
            minX: fp.minX + lx * a,
            maxX: fp.minX + lx * b,
          }
        : {
            ...fp,
            key: `${fp.key}.${i}`,
            minZ: fp.minZ + lz * a,
            maxZ: fp.minZ + lz * b,
          },
    );
  }
  return out;
}

/**
 * Where you can walk to from `from` without passing through a building
 * (footprints grown by `clearance`, the player's girth) inside `bounds`
 * (a rect, or |x|, |z| ≤ n): a flood fill on a `cell`-metre grid. Backs of
 * blocks that only face a sliver behind a row of others come out
 * unreachable.
 */
export function reachable(
  rects: readonly Rect[],
  bounds: Rect | number,
  from: { x: number; z: number },
  opts: { cell?: number; clearance?: number; open?: (x: number, z: number) => boolean } = {},
): (x: number, z: number) => boolean {
  const b: Rect =
    typeof bounds === 'number'
      ? { minX: -bounds, maxX: bounds, minZ: -bounds, maxZ: bounds }
      : bounds;
  const cell = opts.cell ?? 0.5;
  const cl = opts.clearance ?? 0.35;
  const nx = Math.ceil((b.maxX - b.minX) / cell);
  const nz = Math.ceil((b.maxZ - b.minZ) / cell);
  const blocked = new Uint8Array(nx * nz);
  const ix = (v: number) => Math.floor((v - b.minX) / cell);
  const iz = (v: number) => Math.floor((v - b.minZ) / cell);
  for (const r of rects) {
    const x0 = Math.max(0, ix(r.minX - cl));
    const x1 = Math.min(nx - 1, ix(r.maxX + cl));
    const z0 = Math.max(0, iz(r.minZ - cl));
    const z1 = Math.min(nz - 1, iz(r.maxZ + cl));
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) blocked[j * nx + i] = 1;
  }
  if (opts.open !== undefined)
    for (let i = 0; i < nx; i++)
      for (let j = 0; j < nz; j++)
        if (!opts.open(b.minX + (i + 0.5) * cell, b.minZ + (j + 0.5) * cell))
          blocked[j * nx + i] = 1;
  const seen = new Uint8Array(nx * nz);
  const queue: number[] = [];
  const si = ix(from.x);
  const sj = iz(from.z);
  if (si >= 0 && sj >= 0 && si < nx && sj < nz && blocked[sj * nx + si] === 0) {
    seen[sj * nx + si] = 1;
    queue.push(sj * nx + si);
  }
  for (let q = 0; q < queue.length; q++) {
    const k = queue[q]!;
    const i = k % nx;
    const j = (k - i) / nx;
    for (const [di, dj] of NEIGHBOURS) {
      const a = i + di;
      const c = j + dj;
      if (a < 0 || c < 0 || a >= nx || c >= nz) continue;
      const kk = c * nx + a;
      if (seen[kk] === 1 || blocked[kk] === 1) continue;
      seen[kk] = 1;
      queue.push(kk);
    }
  }
  return (x, z) => {
    const i = ix(x);
    const j = iz(z);
    return i >= 0 && j >= 0 && i < nx && j < nz && seen[j * nx + i] === 1;
  };
}

const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

/** Stable key for a rect: rounded to 10 cm. */
export function rectKey(r: Rect): string {
  const q = (v: number) => Math.round(v * 10) / 10;
  return `${q((r.minX + r.maxX) / 2)},${q((r.minZ + r.maxZ) / 2)}`;
}

/** Distance from a point to a door's centre and whether it's on the door's outer side. */
export function doorReach(
  d: Pick<BuildingDoor, 'x' | 'z' | 'yaw'>,
  px: number,
  pz: number,
): { dist: number; front: number } {
  const dx = px - d.x;
  const dz = pz - d.z;
  return { dist: Math.hypot(dx, dz), front: dx * Math.sin(d.yaw) + dz * Math.cos(d.yaw) };
}
