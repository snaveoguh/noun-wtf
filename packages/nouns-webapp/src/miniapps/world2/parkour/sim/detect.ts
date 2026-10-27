// ── Parkour detection: what's around the rider, from the real collision ──
//
// Every query is a handful of rays against the level (the same BVH the
// rider collides with), so ledges, poles and wall-runnable walls come from
// whatever geometry is there: roof edges, parapets, window sills, lamp
// posts, sign poles, railings, fire escapes. Nothing is tagged by hand.
// Hits from `PkWorld` may be reused objects, so values are copied out.
//
// Costs (rays): sideWall 4, frontWall 2, findLedge ≤ 9, poleAlong ≤ 8 per
// direction (plus a cached top), lowObstacle 2, gapAhead 2, narrowUnder 4.

import { PK, type PkWorld } from '../contract';

export interface WallHit {
  x: number;
  y: number;
  z: number;
  /** Horizontal unit normal, out of the wall. */
  nx: number;
  nz: number;
  d: number;
}

/** A steep surface along horizontal (dx, dz) from (x, y, z), or null. */
export function wallAt(
  w: PkWorld,
  x: number,
  y: number,
  z: number,
  dx: number,
  dz: number,
  far: number,
): WallHit | null {
  const h = w.ray(x, y, z, dx, 0, dz, far);
  if (h === null || Math.abs(h.ny) > 0.35) return null;
  const l = Math.hypot(h.nx, h.nz);
  if (l < 1e-4) return null;
  return { x: h.x, y: h.y, z: h.z, nx: h.nx / l, nz: h.nz / l, d: h.d };
}

/** Height of the first walkable surface straight down from (x, y, z) within `far`, or null. */
export function floorAt(w: PkWorld, x: number, y: number, z: number, far: number): number | null {
  const h = w.ray(x, y, z, 0, -1, 0, far);
  if (h === null || h.ny < 0.55) return null;
  return h.y;
}

// ── Walls to run along / up ─────────────────────────────────────────────

export interface SideWall extends WallHit {
  /** +1 wall on the rider's left, −1 on the right. */
  side: 1 | -1;
}

/**
 * A tall wall beside a rider heading (tx, tz): checked at chest and head
 * height, and again half a metre ahead (a wall that's about to end isn't
 * worth starting on). The nearer side wins.
 */
export function sideWall(
  w: PkWorld,
  x: number,
  y: number,
  z: number,
  tx: number,
  tz: number,
  reach: number = PK.wallRunReach,
): SideWall | null {
  let best: SideWall | null = null;
  for (const side of [1, -1] as const) {
    // left = (tz, 0, −tx)
    const lx = tz * side;
    const lz = -tx * side;
    const chest = wallAt(w, x, y + 1.0, z, lx, lz, reach);
    if (chest === null || (best !== null && chest.d >= best.d)) continue;
    // The wall faces us (not a corner edge we brush past)
    if (chest.nx * -lx + chest.nz * -lz < 0.55) continue;
    if (wallAt(w, x, y + 1.75, z, lx, lz, reach + 0.2) === null) continue;
    if (wallAt(w, x + tx * 0.6, y + 1.0, z + tz * 0.6, lx, lz, reach + 0.3) === null) continue;
    best = { ...chest, side };
  }
  return best;
}

/**
 * A tall wall straight ahead along (dx, dz): at chest and above the head,
 * so it's a wall to run up, not a low wall to vault.
 */
export function frontWall(
  w: PkWorld,
  x: number,
  y: number,
  z: number,
  dx: number,
  dz: number,
  reach: number,
): WallHit | null {
  const chest = wallAt(w, x, y + 0.95, z, dx, dz, reach);
  if (chest === null) return null;
  if (wallAt(w, x, y + 1.9, z, dx, dz, reach + 0.4) === null) return null;
  return chest;
}

// ── Ledges ──────────────────────────────────────────────────────────────

export interface Ledge {
  /** Lip: on the face line, at the top surface's height. */
  x: number;
  y: number;
  z: number;
  /** Horizontal unit normal of the face (out, toward the hanging rider). */
  nx: number;
  nz: number;
  /** There's room to stand on top (pull up), not just a sill to hang from. */
  top: boolean;
  /** Where a pull-up stands (a parapet's lip pulls you over onto the roof behind it). */
  sx: number;
  sy: number;
  sz: number;
}

/** Can a standing body fit with its feet at (x, y, z)? */
export function bodyFits(w: PkWorld, x: number, y: number, z: number): boolean {
  const r = PK.radius - 0.04;
  const c = w.push(x, y + r + 0.3, z, x, y + PK.height - r, z, r);
  return c.x * c.x + c.y * c.y + c.z * c.z < 0.03 * 0.03;
}

/**
 * A lip the hands can hold on the wall in front of a rider at (x, y, z)
 * facing −n: a flat top between `minH` and `maxH` above the feet, either
 * on the face line (a roof edge, a wall top) or sticking out of it (a
 * sill, a rail), with room above it for the hands.
 */
export function findLedge(
  w: PkWorld,
  x: number,
  y: number,
  z: number,
  nx: number,
  nz: number,
  minH: number = PK.grabMin,
  maxH: number = PK.grabMax,
): Ledge | null {
  // The face: at the chest, else wherever the reach band meets the wall
  let face: WallHit | null = null;
  for (const h of [0.9, 1.4, 0.4, (minH + maxH) / 2]) {
    face = wallAt(w, x, y + h, z, -nx, -nz, 1.4);
    if (face !== null) break;
  }
  if (face === null) return null;
  const fnx = face.nx;
  const fnz = face.nz;
  // Tops along the face: just inside it (a roof edge) and just out of it
  // (a sill / rail sticking out); the highest one in reach wins
  const y0 = y + maxH + 0.3;
  const len = maxH - minH + 0.3;
  let ly = -Infinity;
  for (const depth of [-0.14, 0.1]) {
    const px = face.x - fnx * depth;
    const pz = face.z - fnz * depth;
    const h = w.ray(px, y0, pz, 0, -1, 0, len);
    if (h === null || h.ny < 0.7 || h.d < 0.02) continue;
    const hy = h.y;
    if (hy > ly) ly = hy;
  }
  if (!Number.isFinite(ly) || ly < y + minH || ly > y + maxH) return null;
  // Room for the hands over the lip
  if (w.ray(face.x + fnx * 0.12, ly + 0.03, face.z + fnz * 0.12, 0, 1, 0, 0.32) !== null)
    return null;
  // Standable on top: a floor a body length in, at the lip or down behind
  // a parapet, with room to stand
  const tx = face.x - fnx * 0.6;
  const tz = face.z - fnz * 0.6;
  const fl = floorAt(w, tx, ly + 0.6, tz, 1.75);
  const top = fl !== null && fl > ly - 1.1 && fl < ly + 0.3 && bodyFits(w, tx, fl, tz);
  return { x: face.x, y: ly, z: face.z, nx: fnx, nz: fnz, top, sx: tx, sy: fl ?? ly, sz: tz };
}

/** Rider feet position for hanging from `l`. */
export function hangSpot(l: { x: number; y: number; z: number; nx: number; nz: number }) {
  return {
    x: l.x + l.nx * PK.hangDist,
    y: l.y - PK.hangDrop,
    z: l.z + l.nz * PK.hangDist,
  };
}

/**
 * Another lip to leap to from a hang on lip `l`: along the face (side =
 * ±1, rider's right = +1) and/or up. Searches a few spots in reach and
 * returns the nearest one that holds.
 */
export function findLeapTarget(w: PkWorld, l: Ledge, side: number, up: number): Ledge | null {
  // Rider's right while facing the wall (−n): (n.z, −n.x)
  const rx = l.nz;
  const rz = -l.nx;
  const steps: [number, number][] = [];
  if (side !== 0) {
    // Sideways: across the gap where this lip ends (along it is a shimmy)
    let end = 0;
    while (
      end < PK.leapMaxSide &&
      lipAt(w, l, l.x + rx * side * (end + 0.3), l.z + rz * side * (end + 0.3)) !== null
    )
      end += 0.3;
    if (up <= 0 && end >= PK.leapMaxSide) return null;
    for (const s of [0.6, 1.0, 1.5, 2.0, PK.leapMaxSide]) steps.push([(end + s) * side, 0]);
  }
  if (up > 0) for (const u of [0.8, 1.3, 1.8, PK.leapMaxUp]) steps.push([side * 0.6, u]);
  for (const [s, u] of steps) {
    const sx = l.x + rx * s;
    const sz = l.z + rz * s;
    const spot = hangSpot({ x: sx, y: l.y + u, z: sz, nx: l.nx, nz: l.nz });
    // Search a band round the expected height (lips aren't all level)
    const hit = findLedge(
      w,
      spot.x,
      spot.y,
      spot.z,
      l.nx,
      l.nz,
      PK.hangDrop - 0.6,
      PK.hangDrop + 0.6,
    );
    if (hit === null) continue;
    // Not the lip we're already on
    if (Math.abs(hit.y - l.y) < 0.2 && Math.hypot(hit.x - l.x, hit.z - l.z) < 0.5) continue;
    return hit;
  }
  return null;
}

/** Does the same lip carry on at (x, z) (shimmy)? Its height there, or null. */
export function lipAt(w: PkWorld, l: Ledge, x: number, z: number): Ledge | null {
  const s = hangSpot({ x, y: l.y, z, nx: l.nx, nz: l.nz });
  const hit = findLedge(w, s.x, s.y, s.z, l.nx, l.nz, PK.hangDrop - 0.3, PK.hangDrop + 0.3);
  if (hit === null) return null;
  // Same face (a corner turns it: stop there)
  if (hit.nx * l.nx + hit.nz * l.nz < 0.8) return null;
  return hit;
}

// ── Poles ───────────────────────────────────────────────────────────────

export interface PoleHit {
  cx: number;
  cz: number;
  r: number;
  top: number;
  base: number;
}

/**
 * A thin upright (lamp post, sign pole, a rail upright, a tree trunk) along
 * (dx, dz) from hip height: the ray hits it, rays a hand-width either
 * side miss it, and it's still there a metre up and down. Measured from
 * both sides for its centre and radius.
 */
export function poleAlong(
  w: PkWorld,
  x: number,
  y: number,
  z: number,
  dx: number,
  dz: number,
  reach: number,
): PoleHit | null {
  // At the hips: you catch a pole with your hands up to its top, so the
  // body can be level with it (or above the top of a short one)
  const cy = y + 0.75;
  const f = w.ray(x, cy, z, dx, 0, dz, reach);
  if (f === null || Math.abs(f.ny) > 0.3) return null;
  const fx = f.x;
  const fz = f.z;
  const fd = f.d;
  // Thin: offset rays pass either side
  const px = -dz;
  const pz = dx;
  for (const s of [-1, 1]) {
    const o = PK.poleMaxR + 0.06;
    const side = w.ray(x + px * o * s, cy, z + pz * o * s, dx, 0, dz, fd + 0.8);
    if (side !== null && side.d < fd + 0.7) return null;
  }
  // Back face → diameter
  const back = 2 * PK.poleMaxR + 0.15;
  const b = w.ray(fx + dx * back, cy, fz + dz * back, -dx, 0, -dz, back);
  if (b === null || b.d < 0.02) return null;
  const diam = back - b.d;
  if (diam < 0.03 || diam > 2 * PK.poleMaxR) return null;
  const r = diam / 2;
  const cx = fx + dx * r;
  const cz = fz + dz * r;
  // Upright: still there lower down (poles run to the ground; checking above
  // would miss a jump near the top of one)
  for (const dy of [-0.45, -0.9]) {
    const h = w.ray(cx - dx * (r + 0.5), cy + dy, cz - dz * (r + 0.5), dx, 0, dz, 0.8);
    if (h === null || Math.abs(h.d - 0.5) > 0.12) return null;
  }
  // Top: climb the pole in 0.2 m steps until it ends (≤ 14 m)
  let top = cy;
  for (let k = 0; k < 70; k++) {
    const ty = top + 0.2;
    const h = w.ray(cx - dx * (r + 0.5), ty, cz - dz * (r + 0.5), dx, 0, dz, 0.8);
    if (h === null || Math.abs(h.d - 0.5) > 0.15) break;
    top = ty;
  }
  const fl = floorAt(w, cx - dx * (r + 0.25), y + 0.6, cz - dz * (r + 0.25), 30);
  return { cx, cz, r, top, base: fl ?? y };
}

// ── Ground features ─────────────────────────────────────────────────────

/** A knee-to-waist obstacle ahead (bench, low wall, railing): its face normal, or null. */
export function lowObstacle(
  w: PkWorld,
  x: number,
  y: number,
  z: number,
  dx: number,
  dz: number,
  reach: number,
): WallHit | null {
  const knee = wallAt(w, x, y + 0.42, z, dx, dz, reach);
  if (knee === null) return null;
  // Clear at chest height a bit past the face: low enough to go over
  if (w.ray(x, y + 1.45, z, dx, 0, dz, knee.d + 1.1) !== null) return null;
  return knee;
}

/** A drop of at least `drop` (or nothing at all) `ahead` metres along (dx, dz)? */
export function gapAhead(
  w: PkWorld,
  x: number,
  y: number,
  z: number,
  dx: number,
  dz: number,
  ahead: number = PK.gapCheck,
  drop: number = PK.gapDrop,
): boolean {
  // Not a wall in the way (the floor "behind" a facade is no gap)
  if (w.ray(x, y + 1.0, z, dx, 0, dz, ahead + 0.4) !== null) return false;
  return floorAt(w, x + dx * ahead, y + 0.5, z + dz * ahead, drop + 0.5) === null;
}

/**
 * Standing on something narrow (a rail, a post top, a wall top)? Counts the
 * probes a body-width out on each side that find no floor near the feet.
 */
export function narrowUnder(w: PkWorld, x: number, y: number, z: number): boolean {
  let open = 0;
  const o = 0.34;
  for (const [ox, oz] of [
    [o, 0],
    [-o, 0],
    [0, o],
    [0, -o],
  ]) {
    const f = floorAt(w, x + ox, y + 0.3, z + oz, 0.65);
    if (f === null || f < y - 0.3) open++;
  }
  return open >= 2;
}

/**
 * Standing at a drop-off along (dx, dz): no floor just past the toes, and
 * the face under the edge facing out. Returns the edge as a lip to hang
 * from (normal pointing away from where the rider stands).
 */
export function edgeBelow(
  w: PkWorld,
  x: number,
  y: number,
  z: number,
  dx: number,
  dz: number,
): Ledge | null {
  if (floorAt(w, x + dx * 0.75, y + 0.3, z + dz * 0.75, 2.2) !== null) return null;
  // Look back at the face from out past the edge, below the lip
  const face = wallAt(w, x + dx * 1.3, y - 0.5, z + dz * 1.3, -dx, -dz, 1.4);
  if (face === null || face.nx * dx + face.nz * dz < 0.6) return null;
  const top = floorAt(w, face.x - face.nx * 0.14, y + 0.4, face.z - face.nz * 0.14, 0.8);
  if (top === null || Math.abs(top - y) > 0.35) return null;
  return {
    x: face.x,
    y: top,
    z: face.z,
    nx: face.nx,
    nz: face.nz,
    top: true,
    sx: face.x - face.nx * 0.6,
    sy: top,
    sz: face.z - face.nz * 0.6,
  };
}
