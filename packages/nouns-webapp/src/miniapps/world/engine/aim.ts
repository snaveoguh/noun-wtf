// ── Aim — Camera-ray + soft lock-on ──────────────────────────────────
//
// Replaces the 8-way facing-direction aim with a continuous aim angle
// read from the camera orbit, plus an optional soft lock-on that snaps
// to the nearest enemy within a cone.
//
// Coordinates: tile-world (same as Player.x/Player.y). Camera angle uses
// the same convention as getMovementVector in input.ts (0 = looking north,
// angle rotates clockwise in XY plane).

import type { Player, RemotePlayer } from './types';

export interface AimOptions {
  /** Maximum range to consider an enemy lockable (tile-world units). */
  lockRange?: number;
  /** Half-angle (radians) of the lock-on cone centered on camera direction. */
  lockCone?: number;
  /** Whether to apply lock-on at all. Defaults true. */
  enableLockOn?: boolean;
}

export interface AimResult {
  /** Final aim angle (radians), ready to use in cos/sin for direction. */
  angle: number;
  /** Target world position to aim at (useful for bullets/attacks). */
  targetX: number;
  targetY: number;
  /** If we locked onto a remote player, their id. Null otherwise. */
  lockedId: string | null;
  /** Distance to the lock target (undefined if no lock). */
  lockDistance?: number;
}

const DEFAULTS: Required<AimOptions> = {
  lockRange: 120,
  lockCone: Math.PI / 9, // 20° cone half-angle
  enableLockOn: true,
};

/**
 * Convert cameraAngle (from InputState) into an aim angle the attack system
 * understands. The camera orbit uses 0 = looking -Z (north); our attack
 * system uses atan2(dy, dx) in world XY where +X is east, +Y is south.
 *
 * cameraAngle = 0 → player looks toward -Z in three.js → "up" in tile-world
 *   which is -Y direction → atan2 angle = -π/2
 * So world-aim-angle = cameraAngle - π/2
 */
function cameraAngleToWorldAim(cameraAngle: number): number {
  return cameraAngle - Math.PI / 2;
}

/** Normalized angle difference in [-π, π]. */
function angleDiff(a: number, b: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * Main aim resolver. Call every frame before firing/attacking.
 *
 * Camera-first: aim direction follows where the player is looking.
 * Lock-on: if any living remote player sits inside a cone around the camera
 * direction AND within lockRange, snap to the closest one and return
 * their id so the UI can highlight the reticle.
 */
export function computeAim(
  player: Player,
  cameraAngle: number,
  remotes: Iterable<RemotePlayer>,
  opts: AimOptions = {},
): AimResult {
  const { lockRange, lockCone, enableLockOn } = { ...DEFAULTS, ...opts };
  const baseAngle = cameraAngleToWorldAim(cameraAngle);

  let best: { id: string; dist: number; angle: number; x: number; y: number } | null = null;

  if (enableLockOn) {
    for (const r of remotes) {
      if (r.hp <= 0) continue;
      if (r.state === 'dead' || r.state === 'respawning') continue;
      const dx = r.x - player.x;
      const dy = r.y - player.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > lockRange || dist < 1) continue;
      const toTarget = Math.atan2(dy, dx);
      const coneErr = Math.abs(angleDiff(baseAngle, toTarget));
      if (coneErr > lockCone) continue;
      // Score: prefer closer + more centered. Centered weight is ~30u.
      const score = dist + coneErr * 30;
      if (!best || score < best.dist + best.angle * 30) {
        best = { id: r.id, dist, angle: coneErr, x: r.x, y: r.y };
      }
    }
  }

  if (best) {
    return {
      angle: Math.atan2(best.y - player.y, best.x - player.x),
      targetX: best.x,
      targetY: best.y,
      lockedId: best.id,
      lockDistance: best.dist,
    };
  }

  // No lock — aim straight along the camera direction.
  const RANGE = 80;
  return {
    angle: baseAngle,
    targetX: player.x + Math.cos(baseAngle) * RANGE,
    targetY: player.y + Math.sin(baseAngle) * RANGE,
    lockedId: null,
  };
}

/**
 * Shared reactive slot so the HUD crosshair can tint when locked.
 * The aim system writes here each frame; <Crosshair /> reads it.
 */
export interface AimHudSlot {
  lockedId: string | null;
  lockDistance: number | null;
}

export function createAimHudSlot(): AimHudSlot {
  return { lockedId: null, lockDistance: null };
}
