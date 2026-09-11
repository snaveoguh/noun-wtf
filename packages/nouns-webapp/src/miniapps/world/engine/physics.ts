// ── Physics: knockback, gravity, juggle, collision ───────────────────

import type { Player, GroundMaterial } from './types';
import {
  Tile,
  WALKABLE,
  TILE_SIZE,
  MAP_SIZE,
  MAP_ORIGIN,
  WORLD_MIN_PX,
  WORLD_MAX_PX,
  GRAVITY,
  GROUND_Y,
  SPRITE_SIZE,
} from './types';
import {
  aabbCircleOverlap,
  aabbClosestPoint,
  overlappingSolids,
  raycastVertical,
  type AABB,
  type Structure,
} from './structures';

/** Simple lerp */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Distance between two points */
export function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2);
}

/** Angle between two points */
export function angleBetween(x1: number, y1: number, x2: number, y2: number): number {
  return Math.atan2(y2 - y1, x2 - x1);
}

/** Angle difference that handles wrap-around */
export function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Interpolate angles */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + angleDiff(a, b) * t;
}

/** Check if a point is inside a cone */
export function isInCone(
  originX: number,
  originY: number,
  targetX: number,
  targetY: number,
  coneAngle: number,
  coneHalfWidth: number,
  maxDist: number,
): boolean {
  const dx = targetX - originX;
  const dy = targetY - originY;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > maxDist || d < 5) return false;
  const a = Math.atan2(dy, dx);
  return Math.abs(angleDiff(coneAngle, a)) < coneHalfWidth;
}

/** Get tile at world coordinate */
export function getTileAt(worldX: number, worldY: number, map: Tile[][]): Tile {
  // ISLAND_MAP is origin-shifted: index 0 is world tile MAP_ORIGIN.
  const tx = Math.floor(worldX / TILE_SIZE) - MAP_ORIGIN;
  const ty = Math.floor(worldY / TILE_SIZE) - MAP_ORIGIN;
  if (tx < 0 || tx >= MAP_SIZE || ty < 0 || ty >= MAP_SIZE) return Tile.DeepWater;
  return map[ty]?.[tx] ?? Tile.DeepWater;
}

/** Check if a world position is walkable */
export function isWalkable(worldX: number, worldY: number, map: Tile[][]): boolean {
  return WALKABLE.has(getTileAt(worldX, worldY, map));
}

/**
 * @deprecated Legacy single-point collision. New code uses
 * `resolveWallSlide` (circle-vs-AABB with proper sliding).
 *
 * Try to move player with wall-sliding collision.
 * Returns the final position after collision resolution.
 */
export function moveWithCollision(
  x: number,
  y: number,
  vx: number,
  vy: number,
  map: Tile[][],
): { x: number; y: number } {
  const footOffset = SPRITE_SIZE * 0.4; // check from player's feet area

  // Try full movement
  if (isWalkable(x + vx, y + vy + footOffset, map)) {
    return { x: x + vx, y: y + vy };
  }
  // Try X only (slide along Y wall)
  if (isWalkable(x + vx, y + footOffset, map)) {
    return { x: x + vx, y };
  }
  // Try Y only (slide along X wall)
  if (isWalkable(x, y + vy + footOffset, map)) {
    return { x, y: y + vy };
  }
  // Can't move
  return { x, y };
}

// ── New collision primitives (circle-vs-AABB + tile aware) ────────────

/**
 * Circle-vs-AABB overlap test. Same semantics as
 * structures.aabbCircleOverlap — re-exported here so physics consumers
 * can rely on a single import site.
 */
export function aabbOverlap(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  px: number,
  py: number,
  radius: number,
): boolean {
  return aabbCircleOverlap({ x: ax, y: ay, w: aw, h: ah }, px, py, radius);
}

/**
 * Is the tile under (x,y) walkable AND is the position clear of all
 * solid registered structures whose top is above the body's feet?
 *
 * footZ = z of the player's feet (0 when on ground, higher when on a
 * roof or mid-jump). A solid only blocks if its top is above the feet.
 */
function isPositionClear(
  x: number,
  y: number,
  radius: number,
  footZ: number,
  map: Tile[][],
): boolean {
  // Tile check (sample both center and a few footprint points for
  // correctness at high speeds; a single center-point check lets
  // diagonals clip through thin walls).
  if (!isWalkable(x, y, map)) return false;
  if (!isWalkable(x + radius, y, map)) return false;
  if (!isWalkable(x - radius, y, map)) return false;
  if (!isWalkable(x, y + radius, map)) return false;
  if (!isWalkable(x, y - radius, map)) return false;

  // Structure check.
  const solids = overlappingSolids(x, y, radius);
  for (const s of solids) {
    const top = s.opts.topHeight ?? Infinity;
    // Player is below this solid's top → blocked.
    if (footZ < top - 0.01) return false;
  }
  return true;
}

export interface SlideResult {
  x: number;
  y: number;
  blockedX: boolean;
  blockedY: boolean;
}

/**
 * Resolve a horizontal movement step with proper wall-sliding against
 * tiles AND registered solid structures.
 *
 * Strategy:
 *   1. If full (x+vx, y+vy) is clear → take it.
 *   2. Otherwise probe X-only and Y-only moves. Take whichever clears.
 *   3. If neither clears, push the body out of any overlapping AABB
 *      along the shortest axis and zero the corresponding velocity.
 *
 * High-speed tunneling is prevented by the caller: split large steps
 * into sub-steps if |velocity| > radius.
 */
export function resolveWallSlide(
  x: number,
  y: number,
  vx: number,
  vy: number,
  radius: number,
  footZ: number,
  map: Tile[][],
): SlideResult {
  const tx = x + vx;
  const ty = y + vy;

  if (isPositionClear(tx, ty, radius, footZ, map)) {
    return { x: tx, y: ty, blockedX: false, blockedY: false };
  }

  const xOnlyOk = vx !== 0 && isPositionClear(tx, y, radius, footZ, map);
  const yOnlyOk = vy !== 0 && isPositionClear(x, ty, radius, footZ, map);

  if (xOnlyOk && yOnlyOk) {
    // Both axes clear independently — pick the one that keeps more speed.
    if (Math.abs(vx) >= Math.abs(vy)) {
      return { x: tx, y, blockedX: false, blockedY: true };
    }
    return { x, y: ty, blockedX: true, blockedY: false };
  }
  if (xOnlyOk) return { x: tx, y, blockedX: false, blockedY: true };
  if (yOnlyOk) return { x, y: ty, blockedX: true, blockedY: false };

  // Fully blocked. Try pushing out of any overlapping structure along
  // the shallowest axis so the body doesn't wedge inside walls.
  const push = depenetrate(x, y, radius, footZ);
  return { x: push.x, y: push.y, blockedX: true, blockedY: true };
}

/** Move the point out of any overlapping solid AABB. Single iteration. */
function depenetrate(
  x: number,
  y: number,
  radius: number,
  footZ: number,
): { x: number; y: number } {
  const solids = overlappingSolids(x, y, radius);
  if (solids.length === 0) return { x, y };

  let outX = x;
  let outY = y;

  for (const s of solids) {
    const top = s.opts.topHeight ?? Infinity;
    if (footZ >= top - 0.01) continue; // we're above this structure
    const { cx, cy, dx, dy, distSq } = aabbClosestPoint(s.aabb, outX, outY);
    if (distSq >= radius * radius) continue; // clear now

    if (distSq > 0.0001) {
      const d = Math.sqrt(distSq);
      // Push the circle center out to (radius + slack) from the nearest edge.
      outX = cx + (dx / d) * (radius + 0.1);
      outY = cy + (dy / d) * (radius + 0.1);
    } else {
      // Exactly on center — push toward the nearest face.
      const hx = s.aabb.w / 2;
      const hy = s.aabb.h / 2;
      const dxl = s.aabb.x - hx - outX;
      const dxr = s.aabb.x + hx - outX;
      const dyt = s.aabb.y - hy - outY;
      const dyb = s.aabb.y + hy - outY;
      const best = Math.min(Math.abs(dxl), Math.abs(dxr), Math.abs(dyt), Math.abs(dyb));
      if (best === Math.abs(dxl)) outX = s.aabb.x - hx - radius - 0.1;
      else if (best === Math.abs(dxr)) outX = s.aabb.x + hx + radius + 0.1;
      else if (best === Math.abs(dyt)) outY = s.aabb.y - hy - radius - 0.1;
      else outY = s.aabb.y + hy + radius + 0.1;
    }
  }
  return { x: outX, y: outY };
}

/**
 * Ground material of the tile at (x,y). Mirrors the old visual-only
 * tile palette but collapses to the GroundMaterial union.
 */
export function tileMaterialAt(x: number, y: number, map: Tile[][]): GroundMaterial {
  const tile = getTileAt(x, y, map);
  switch (tile) {
    case Tile.Sand:
      return 'sand';
    case Tile.Path:
      return 'path';
    case Tile.Water:
    case Tile.DeepWater:
    case Tile.Shallow:
      return 'water';
    case Tile.Rock:
      return 'stone';
    case Tile.Arena:
      return 'stone';
    case Tile.Grass:
    case Tile.Tree:
    case Tile.Flower:
    case Tile.Spawn:
    default:
      return 'grass';
  }
}

export interface GroundSample {
  /** Z height of the ground surface at (x,y) — tiles stay at 0. */
  topZ: number;
  /** Material of that surface. */
  material: GroundMaterial;
  /** Structure id if a registered roof provides the surface, else null. */
  structureId: string | null;
}

/**
 * Highest walkable surface at (x,y) considering both the tilemap and
 * any registered roof-bearing structure beneath the body's current z.
 * Tilemap baseline is always 0 (the existing game world is flat at z=0);
 * 3D tile heights are a visual-only concern (see WorldPage.getTerrainHeight).
 */
export function sampleGroundHeight(x: number, y: number, atZ: number, map: Tile[][]): GroundSample {
  const tileMat = tileMaterialAt(x, y, map);
  const struct = raycastVertical(x, y, atZ);

  if (struct.structureId !== null && struct.topZ > 0) {
    return { topZ: struct.topZ, material: struct.material, structureId: struct.structureId };
  }
  return { topZ: 0, material: tileMat, structureId: null };
}

// Re-export for convenience so locomotion only needs one import path.
export type { AABB, Structure };

/** Apply gravity to airborne player */
export function applyGravity(player: Player) {
  if (player.airborneY < GROUND_Y) {
    // Spider-Man hang time: heavy slow-mo near the peak
    const hangFactor = Math.abs(player.airborneVy) < 2.0 ? 0.2 : 0.7;
    player.airborneVy += GRAVITY * hangFactor;
    player.airborneY += player.airborneVy;
    if (player.airborneY >= GROUND_Y) {
      player.airborneY = GROUND_Y;
      player.airborneVy = 0;
      player.jumpCount = 0; // reset jump counter on landing
      if (player.state === 'airborne') {
        player.state = 'idle';
      }
    }
  }
}

/** Apply knockback force to a player */
export function applyKnockback(player: Player, fromX: number, fromY: number, force: number) {
  const angle = angleBetween(fromX, fromY, player.x, player.y);
  player.vx += Math.cos(angle) * force;
  player.vy += Math.sin(angle) * force;
}

/** Apply velocity friction each frame */
export function applyFriction(player: Player, friction = 0.85) {
  player.vx *= friction;
  player.vy *= friction;
  if (Math.abs(player.vx) < 0.1) player.vx = 0;
  if (Math.abs(player.vy) < 0.1) player.vy = 0;
}

/** Clamp position to world bounds */
export function clampToWorld(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.max(WORLD_MIN_PX, Math.min(WORLD_MAX_PX - 1, x)),
    y: Math.max(WORLD_MIN_PX, Math.min(WORLD_MAX_PX - 1, y)),
  };
}

/** Check if player is in deep water (ocean death zone) */
export function isInDeepWater(worldX: number, worldY: number, map: Tile[][]): boolean {
  const tile = getTileAt(worldX, worldY, map);
  return tile === Tile.DeepWater || tile === Tile.Water;
}

/** Random float in range */
export function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/** Random int in range (inclusive) */
export function randInt(min: number, max: number): number {
  return Math.floor(randRange(min, max + 1));
}
