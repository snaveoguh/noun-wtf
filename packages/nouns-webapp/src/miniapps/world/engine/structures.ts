// ── StructureRegistry — 3D-aware collision & climb surfaces ──────────
//
// Scene objects (apartments, offices, ramps, paintable walls) register
// themselves here with axis-aligned bounds + optional climb faces and
// roof heights. Locomotion queries this registry to:
//   - Collide against building footprints (circle-vs-AABB)
//   - Walk on top of roofs / ramps / platforms
//   - Grab a climb face when the player pushes against a ladder/pipe
//
// Coordinates are tile-world (same as Player.x/Player.y):
//   TILE_SIZE = 16, MAP_SIZE = 64, WORLD_SIZE = 1024.
// If your component defines itself in Three.js world units (e.g. 80, 51.2),
// divide by WORLD_SCALE (0.1) when registering.
//
// Vertical is in tile units too, measured up from ground (z=0).
//
// Usage example:
//
//   import { registerStructure } from './structures';
//
//   // NYCApartmentBlock.tsx, inside a useEffect:
//   registerStructure(
//     'apt-1',
//     { x: 858, y: 512, w: 40, h: 30 },  // tile-world AABB (footprint)
//     {
//       topHeight: 140,                   // stand on the roof at z=140
//       topMaterial: 'stone',
//       climbFaces: [
//         { id: 'fire-escape', side: 'west', startZ: 0, endZ: 140, material: 'metal' },
//       ],
//     },
//   );
//
//   // Return a cleanup that calls unregisterStructure('apt-1').
//
// ───────────────────────────────────────────────────────────────────────

import type { GroundMaterial } from './types';

/** Axis-aligned rectangle in the XY plane (tile-world coords). */
export interface AABB {
  /** center x */
  x: number;
  /** center y */
  y: number;
  /** full width along x */
  w: number;
  /** full height along y (Z-in-3D is "up", so this is depth on the ground) */
  h: number;
}

/** A vertical climbable strip on one side of a structure. */
export interface ClimbFace {
  /** stable id, unique within the parent structure */
  id: string;
  /** which axis-aligned face this climb is attached to */
  side: 'north' | 'south' | 'east' | 'west';
  /** bottom of the climbable region (tile units) */
  startZ: number;
  /** top of the climbable region (tile units) */
  endZ: number;
  /** material shown to the player while climbing */
  material: GroundMaterial;
  /**
   * Optional along-face start/end. If omitted, the face spans the full
   * width of the structure on its side. Used for partial fire escapes
   * that don't run the full facade.
   */
  tMin?: number;
  tMax?: number;
}

export interface StructureOpts {
  /** Height of the top (roof) surface in tile units. Absent = not walkable on top. */
  topHeight?: number;
  /** Material reported by groundMaterial when standing on top. */
  topMaterial?: GroundMaterial;
  /** Climb surfaces attached to this structure's faces. */
  climbFaces?: ClimbFace[];
  /**
   * If true, the footprint blocks walking (solid wall). Default true.
   * Set false for props that just define a climb face without blocking.
   */
  solid?: boolean;
}

export interface Structure {
  id: string;
  aabb: AABB;
  opts: Required<Omit<StructureOpts, 'topHeight' | 'topMaterial' | 'climbFaces'>> & {
    topHeight?: number;
    topMaterial?: GroundMaterial;
    climbFaces: ClimbFace[];
  };
}

// ── Registry ──────────────────────────────────────────────────────────
//
// Module-level map. Structures are expected to register on mount and
// unregister on unmount. Lookups are rare (per-frame player collision),
// and the number of structures is small (< 50), so a flat Map is fine.

const registry = new Map<string, Structure>();

export function registerStructure(id: string, aabb: AABB, opts: StructureOpts = {}): void {
  registry.set(id, {
    id,
    aabb: { ...aabb },
    opts: {
      solid: opts.solid ?? true,
      topHeight: opts.topHeight,
      topMaterial: opts.topMaterial,
      climbFaces: opts.climbFaces ?? [],
    },
  });
}

export function unregisterStructure(id: string): void {
  registry.delete(id);
}

export function clearStructures(): void {
  registry.clear();
}

export function getStructure(id: string): Structure | undefined {
  return registry.get(id);
}

/** Iterate over all registered structures. */
export function allStructures(): Iterable<Structure> {
  return registry.values();
}

// ── Geometry helpers ──────────────────────────────────────────────────

/** Bounding rect (half-extents). */
export function aabbHalf(a: AABB): { hx: number; hy: number } {
  return { hx: a.w / 2, hy: a.h / 2 };
}

/**
 * Closest point on an AABB to a circle center, and signed distance.
 * If the circle is inside the AABB, distance is negative.
 */
export function aabbClosestPoint(
  a: AABB,
  px: number,
  py: number,
): { cx: number; cy: number; dx: number; dy: number; distSq: number } {
  const { hx, hy } = aabbHalf(a);
  const cx = Math.max(a.x - hx, Math.min(px, a.x + hx));
  const cy = Math.max(a.y - hy, Math.min(py, a.y + hy));
  const dx = px - cx;
  const dy = py - cy;
  return { cx, cy, dx, dy, distSq: dx * dx + dy * dy };
}

/** Does a circle (px,py,r) overlap an AABB? */
export function aabbCircleOverlap(a: AABB, px: number, py: number, r: number): boolean {
  const { distSq } = aabbClosestPoint(a, px, py);
  return distSq < r * r;
}

/** Is point (px,py) strictly inside the AABB footprint? */
export function aabbContains(a: AABB, px: number, py: number): boolean {
  const { hx, hy } = aabbHalf(a);
  return px >= a.x - hx && px <= a.x + hx && py >= a.y - hy && py <= a.y + hy;
}

// ── Queries used by locomotion ────────────────────────────────────────

export interface VerticalSample {
  /** Top surface height (tile units) at (x,y). 0 if no structure underfoot. */
  topZ: number;
  /** Material of the top surface. */
  material: GroundMaterial;
  /** The structure providing the surface, if any. */
  structureId: string | null;
}

/**
 * Raycast downward through structures at (x,y). Returns the highest roof
 * the player would stand on, assuming the player is at or above that
 * roof (z >= topZ). Non-solid tiles below are ignored — use
 * sampleGroundHeight in physics.ts to combine with the tilemap.
 */
export function raycastVertical(x: number, y: number, atZ: number): VerticalSample {
  let bestZ = 0;
  let bestMaterial: GroundMaterial = 'grass';
  let bestId: string | null = null;

  for (const s of registry.values()) {
    if (s.opts.topHeight === undefined) continue;
    if (!aabbContains(s.aabb, x, y)) continue;
    const top = s.opts.topHeight;
    // Player is at-or-above this roof, and this roof is higher than our current pick.
    if (top <= atZ + 0.01 && top >= bestZ) {
      bestZ = top;
      bestMaterial = s.opts.topMaterial ?? 'stone';
      bestId = s.id;
    }
  }

  return { topZ: bestZ, material: bestMaterial, structureId: bestId };
}

/** All structures whose footprint contains the point (x,y). */
export function getStructuresAt(x: number, y: number): Structure[] {
  const hits: Structure[] = [];
  for (const s of registry.values()) {
    if (aabbContains(s.aabb, x, y)) hits.push(s);
  }
  return hits;
}

/** All solid structures whose footprint overlaps a circle at (x,y,radius). */
export function overlappingSolids(x: number, y: number, r: number): Structure[] {
  const hits: Structure[] = [];
  for (const s of registry.values()) {
    if (!s.opts.solid) continue;
    if (aabbCircleOverlap(s.aabb, x, y, r)) hits.push(s);
  }
  return hits;
}

// ── Climb face resolution ─────────────────────────────────────────────

export interface ClimbContact {
  structureId: string;
  face: ClimbFace;
  /** Point on the face's line nearest to the body (world coords). */
  anchorX: number;
  anchorY: number;
  /** Outward normal from the face. */
  normalX: number;
  normalY: number;
}

/**
 * Given a body at (x,y,z) facing (facingX, facingY), return a climb face
 * the player is pressed against. Requires the body to be within `reach`
 * of the face and the face's Z range to contain z (with some slack).
 */
export function findClimbFace(
  x: number,
  y: number,
  z: number,
  facingX: number,
  facingY: number,
  reach: number,
): ClimbContact | null {
  let best: ClimbContact | null = null;
  let bestDist = Infinity;

  for (const s of registry.values()) {
    const { hx, hy } = aabbHalf(s.aabb);
    for (const face of s.opts.climbFaces) {
      // Must be vertically within the face range (small slack below lets
      // the player grab from the ground).
      if (z < face.startZ - 0.5 || z > face.endZ + 0.5) continue;

      // Compute face line endpoints + outward normal in world space.
      let fx0: number, fy0: number, fx1: number, fy1: number;
      let nx: number, ny: number;
      switch (face.side) {
        case 'north': // +y
          fy0 = fy1 = s.aabb.y + hy;
          fx0 = s.aabb.x - hx;
          fx1 = s.aabb.x + hx;
          nx = 0;
          ny = 1;
          break;
        case 'south': // -y
          fy0 = fy1 = s.aabb.y - hy;
          fx0 = s.aabb.x - hx;
          fx1 = s.aabb.x + hx;
          nx = 0;
          ny = -1;
          break;
        case 'east': // +x
          fx0 = fx1 = s.aabb.x + hx;
          fy0 = s.aabb.y - hy;
          fy1 = s.aabb.y + hy;
          nx = 1;
          ny = 0;
          break;
        case 'west': // -x
          fx0 = fx1 = s.aabb.x - hx;
          fy0 = s.aabb.y - hy;
          fy1 = s.aabb.y + hy;
          nx = -1;
          ny = 0;
          break;
      }

      // Optional along-face sub-range (partial climbs).
      if (face.tMin !== undefined || face.tMax !== undefined) {
        const t0 = face.tMin ?? 0;
        const t1 = face.tMax ?? 1;
        const ax = fx0 + (fx1 - fx0) * t0;
        const ay = fy0 + (fy1 - fy0) * t0;
        const bx = fx0 + (fx1 - fx0) * t1;
        const by = fy0 + (fy1 - fy0) * t1;
        fx0 = ax;
        fy0 = ay;
        fx1 = bx;
        fy1 = by;
      }

      // Project the body onto the face segment.
      const dx = fx1 - fx0;
      const dy = fy1 - fy0;
      const lenSq = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - fx0) * dx + (y - fy0) * dy) / lenSq));
      const ax = fx0 + dx * t;
      const ay = fy0 + dy * t;

      // How far from the face's plane, and what side?
      const px = x - ax;
      const py = y - ay;
      const planarDist = Math.sqrt(px * px + py * py);
      if (planarDist > reach) continue;

      // Player must be pushing *into* the face (facing opposite to its normal).
      const pressing = facingX * -nx + facingY * -ny;
      if (pressing < 0.3) continue;

      if (planarDist < bestDist) {
        bestDist = planarDist;
        best = {
          structureId: s.id,
          face,
          anchorX: ax,
          anchorY: ay,
          normalX: nx,
          normalY: ny,
        };
      }
    }
  }

  return best;
}
