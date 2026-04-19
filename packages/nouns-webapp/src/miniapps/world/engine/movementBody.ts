// ── MovementBody — decomposed locomotion state ───────────────────────
//
// A lean bag of numbers the locomotion system owns. The existing Player
// interface keeps all its fields (combat/animation/networking still use
// it). Bridge functions copy the motion-relevant subset in and out each
// tick so the two layers stay in sync without a hard refactor.
//
// Coordinate convention (matches Player.x/Player.y):
//   x, y      — horizontal tile-world coords (0..WORLD_SIZE)
//   z         — height in tile units. z = 0 on ground, z > 0 in air.
//               NOTE: Player.airborneY is negative-when-up; bridge flips.
//   vx, vy    — horizontal velocity (tiles/frame)
//   vz        — vertical velocity (tiles/frame, positive = rising)
//
// The body is pure data; all mutation happens in locomotion.ts.
// ───────────────────────────────────────────────────────────────────────

import type { Player, GroundMaterial } from './types';
import { GROUND_Y } from './types';

/** Climb contact state while the body is on a vertical face. */
export interface ClimbState {
  /** id of the structure being climbed */
  structureId: string;
  /** face identifier on that structure */
  faceId: string;
  /** which side of the structure (axis-aligned) the face is on */
  side: 'north' | 'south' | 'east' | 'west';
  /** material of the climb face (ladder/pipe/metal etc) */
  material: GroundMaterial;
}

/**
 * Minimal motion state. Read and mutated by stepLocomotion.
 * Everything else the game needs (combat timers, hp, animation) stays
 * on Player — the bridge keeps them in sync.
 */
export interface MovementBody {
  x: number;
  y: number;
  /** height above ground. 0 = on ground, positive = airborne */
  z: number;

  vx: number;
  vy: number;
  /** vertical velocity, positive = rising. gravity pulls it down. */
  vz: number;

  /** collision footprint radius (tile units) */
  radius: number;
  /** standing body height (tile units) — used for headroom checks */
  height: number;

  /** true this frame if we have ground contact (tile top or structure top) */
  grounded: boolean;
  /** height of the ground directly beneath the body (tile units) */
  groundZ: number;
  /** material of the surface the body is currently standing on */
  groundMaterial: GroundMaterial;

  /** jumps left before needing to touch ground again */
  jumpsRemaining: number;
  /** frames since last grounded — used for coyote time */
  coyoteTimer: number;
  /** frames remaining on a buffered jump request */
  jumpBuffer: number;
  /** true while the current jump input is still held (variable-height) */
  jumpHeld: boolean;
  /** true while vz has been dampened once for variable jump cutoff */
  jumpCut: boolean;

  /** active climb contact, or null when not climbing */
  climb: ClimbState | null;
}

export const DEFAULT_BODY_RADIUS = 5.5;
export const DEFAULT_BODY_HEIGHT = 14;

export function createMovementBody(x: number, y: number): MovementBody {
  return {
    x,
    y,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    radius: DEFAULT_BODY_RADIUS,
    height: DEFAULT_BODY_HEIGHT,
    grounded: true,
    groundZ: 0,
    groundMaterial: 'grass',
    jumpsRemaining: 1,
    coyoteTimer: 0,
    jumpBuffer: 0,
    jumpHeld: false,
    jumpCut: false,
    climb: null,
  };
}

// ── Bridge: Player <-> MovementBody ───────────────────────────────────
//
// Player.airborneY is negative-when-up in tile units; body.z is
// positive-when-up. We bridge the sign at the boundary.
// Player.airborneVy is positive-when-falling; body.vz is positive-when-rising.

/** Copy motion fields from a Player into a body (reuses body if provided). */
export function playerToBody(player: Player, out?: MovementBody): MovementBody {
  const body = out ?? createMovementBody(player.x, player.y);
  body.x = player.x;
  body.y = player.y;
  body.z = Math.max(0, GROUND_Y - player.airborneY);
  body.vx = player.vx;
  body.vy = player.vy;
  body.vz = -player.airborneVy;
  return body;
}

/** Copy motion fields from body back onto the Player. */
export function bodyToPlayer(body: MovementBody, player: Player): void {
  player.x = body.x;
  player.y = body.y;
  player.vx = body.vx;
  player.vy = body.vy;
  // Player convention: airborneY <= GROUND_Y (0), negative when aloft.
  player.airborneY = GROUND_Y - body.z;
  player.airborneVy = -body.vz;
  // Mirror jump-count so legacy code (animation, network) stays sane.
  // 0 when grounded, 1 while in a single jump arc.
  player.jumpCount = body.grounded ? 0 : Math.max(player.jumpCount, 1);
}
