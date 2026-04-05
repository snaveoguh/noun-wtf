// ── Physics: knockback, gravity, juggle, collision ───────────────────

import type { Player } from './types';
import {
  Tile,
  WALKABLE,
  TILE_SIZE,
  MAP_SIZE,
  GRAVITY,
  GROUND_Y,
  SPRITE_SIZE,
} from './types';

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
export function getTileAt(
  worldX: number,
  worldY: number,
  map: Tile[][],
): Tile {
  const tx = Math.floor(worldX / TILE_SIZE);
  const ty = Math.floor(worldY / TILE_SIZE);
  if (tx < 0 || tx >= MAP_SIZE || ty < 0 || ty >= MAP_SIZE) return Tile.DeepWater;
  return map[ty]?.[tx] ?? Tile.DeepWater;
}

/** Check if a world position is walkable */
export function isWalkable(worldX: number, worldY: number, map: Tile[][]): boolean {
  return WALKABLE.has(getTileAt(worldX, worldY, map));
}

/**
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

/** Apply gravity to airborne player */
export function applyGravity(player: Player) {
  if (player.airborneY < GROUND_Y) {
    player.airborneVy += GRAVITY;
    player.airborneY += player.airborneVy;
    if (player.airborneY >= GROUND_Y) {
      player.airborneY = GROUND_Y;
      player.airborneVy = 0;
      if (player.state === 'airborne') {
        player.state = 'idle';
      }
    }
  }
}

/** Apply knockback force to a player */
export function applyKnockback(
  player: Player,
  fromX: number,
  fromY: number,
  force: number,
) {
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
  const worldPx = TILE_SIZE * MAP_SIZE;
  return {
    x: Math.max(0, Math.min(worldPx - 1, x)),
    y: Math.max(0, Math.min(worldPx - 1, y)),
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
