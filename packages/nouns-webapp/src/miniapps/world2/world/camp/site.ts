// ── CAMP: the penthouse on top of the tallest tower (pure, tested) ──────
//
// NOUNS CAMP is the top storey of the 150 m tower on the plaza's north
// side (Skyline TOWERS[0]), built in place, not in a pocket 4 km up: its
// plaza wall has a big glassless hole in it, and you see the real city.
// The tower's plaza face runs flush all the way up (no setbacks on that
// side), so a scissor fire escape (facades/escape.ts planTowerEscape)
// hangs off it from the window's walkway down to the ring roof east of
// the tower.
//
// Everything here is numbers: the storey (floor, ceiling, the wall boxes
// Skyline builds instead of the solid top storey), the window, the room
// inside (its own frame: x across, z in from the window wall), and where
// the stair goes. No three.js.

export interface Box3Like {
  min: [number, number, number];
  max: [number, number, number];
}

/** The tower CAMP sits on (it must match Skyline's TOWERS entry). */
export const CAMP_TOWER = { x: -20, z: 82.5, w: 14, d: 13, top: 150 } as const;
/** Setback insets per tier for CAMP's tower (slimmer than the others: a bigger penthouse). */
export const CAMP_INSETS = [0, 0.9, 1.8] as const;

/** The storey: floor this far under the tower's roof, ceiling slab this thick. */
const STOREY = 3.9;
const SLAB = 0.4;
/** Wall thickness of the storey's shell. */
export const WALL = 0.3;
/** The window: this much in from each side wall, this tall. */
const WIN_SIDE = 1.8;
const WIN_H = 2.85;

export interface CampSite {
  /** The top tier's footprint (world). */
  tier: { minX: number; maxX: number; minZ: number; maxZ: number };
  floorY: number;
  ceilY: number;
  /** The plaza face (the tower's −z face, flush with the ring's facade line). */
  faceZ: number;
  /** The window's span along x, and its sill / head heights. */
  window: { x0: number; x1: number; y0: number; y1: number };
  /** Inside the walls (world). */
  room: { minX: number; maxX: number; minZ: number; maxZ: number };
  /** Room frame origin (world): x = room centre, z = the window wall's inner face. */
  origin: { x: number; y: number; z: number };
  /** Room size: w across x, d from the window wall in. */
  w: number;
  d: number;
  h: number;
}

/** The site for a top tier spanning [minX, maxX] × [minZ, maxZ] up to `top`. */
export function campSite(
  tier: { minX: number; maxX: number; minZ: number; maxZ: number },
  top: number,
): CampSite {
  const floorY = top - STOREY;
  const ceilY = top - SLAB;
  const room = {
    minX: tier.minX + WALL,
    maxX: tier.maxX - WALL,
    minZ: tier.minZ + WALL,
    maxZ: tier.maxZ - WALL,
  };
  return {
    tier,
    floorY,
    ceilY,
    faceZ: tier.minZ,
    window: {
      x0: tier.minX + WIN_SIDE,
      x1: tier.maxX - WIN_SIDE,
      y0: floorY,
      y1: floorY + WIN_H,
    },
    room,
    origin: { x: (room.minX + room.maxX) / 2, y: floorY, z: room.minZ },
    w: room.maxX - room.minX,
    d: room.maxZ - room.minZ,
    h: ceilY - floorY,
  };
}

/** The top tier of CAMP's tower, from its base roof (the same sums as Skyline's tiers). */
export function campTier(base: number): {
  tier: CampSite['tier'];
  y0: number;
  top: number;
} {
  const t = CAMP_TOWER;
  const span = t.top - base;
  const inset = CAMP_INSETS[2];
  return {
    tier: {
      minX: t.x - t.w / 2 + inset,
      maxX: t.x + t.w / 2 - inset,
      // flush on the plaza side
      minZ: t.z - t.d / 2,
      maxZ: t.z + t.d / 2 - inset,
    },
    y0: base + span * 0.78,
    top: t.top,
  };
}

/**
 * The top tier as boxes, instead of one solid block: the tier under the
 * storey, the storey's four walls (the plaza wall in three pieces round
 * the window) and the roof slab. Skyline draws and collides each.
 */
export function campShellBoxes(s: CampSite, tierY0: number, top: number): Box3Like[] {
  const { minX, maxX, minZ, maxZ } = s.tier;
  const f = s.floorY;
  const c = s.ceilY;
  const w = s.window;
  const B = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) => ({
    min: [x0, y0, z0] as [number, number, number],
    max: [x1, y1, z1] as [number, number, number],
  });
  return [
    B(minX, tierY0, minZ, maxX, f, maxZ), // the tier under the storey
    B(minX, c, minZ, maxX, top, maxZ), // the roof slab
    B(minX, f, maxZ - WALL, maxX, c, maxZ), // back wall
    B(minX, f, minZ, minX + WALL, c, maxZ - WALL), // west wall
    B(maxX - WALL, f, minZ, maxX, c, maxZ - WALL), // east wall
    B(minX + WALL, f, minZ, w.x0, c, minZ + WALL), // plaza wall, left of the window
    B(w.x1, f, minZ, maxX - WALL, c, minZ + WALL), // …right of it
    B(w.x0, w.y1, minZ, w.x1, c, minZ + WALL), // …over it
  ];
}

/** Room frame → world. */
export function toWorld(s: CampSite, x: number, y: number, z: number): [number, number, number] {
  return [s.origin.x + x, s.origin.y + y, s.origin.z + z];
}

/** Is a world point inside CAMP (between its walls, floor to ceiling)? */
export function inCamp(s: CampSite, x: number, y: number, z: number, margin = 0): boolean {
  const r = s.room;
  return (
    x > r.minX - margin &&
    x < r.maxX + margin &&
    z > r.minZ - margin &&
    z < r.maxZ + margin &&
    y > s.floorY - 0.5 &&
    y < s.ceilY + 0.2
  );
}
