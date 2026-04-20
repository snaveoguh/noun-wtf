// ── Wall-running ─────────────────────────────────────────────────────
//
// Detect a perpendicular wall contact while airborne and running
// forward with meaningful velocity → latch onto the wall and run along
// its tangent with reduced gravity. Camera reads `body.wallRun` to
// tilt accordingly.
//
// Exit conditions:
//   - timer expires (WALL_RUN_MAX_DURATION_FRAMES)
//   - input release (no forward lean)
//   - ground contact
//   - corner / loss of wall

import type { MovementBody } from './movementBody';
import { findClimbFace } from './structures';
import { WALL_RUN_GRAVITY_FACTOR, WALL_RUN_MAX_DURATION_FRAMES, LOCOMOTION_GRAVITY } from './types';
import { triggerFocus } from './timeControl';

/**
 * Probe for a wall-run anchor. Airborne only; needs forward velocity.
 * Returns { normalX, normalY } in world XY — outward from the wall —
 * or null if no eligible wall.
 */
export function probeWallForRun(
  body: MovementBody,
  facingX: number,
  facingY: number,
): { normalX: number; normalY: number } | null {
  if (body.grounded) return null;
  const horizSpeed = Math.hypot(body.vx, body.vy);
  if (horizSpeed < 0.4) return null;

  // Look for a climb face on either side of the run direction — wall-
  // runs hug walls that are perpendicular to motion, so we sample
  // left-of-motion and right-of-motion with a short reach.
  // We reuse findClimbFace because structures already expose the face
  // geometry & normals we need.
  const dirX = body.vx / horizSpeed;
  const dirY = body.vy / horizSpeed;
  const leftX = -dirY;
  const leftY = dirX;

  // Preferred: wall immediately to our left.
  const left = findClimbFace(body.x, body.y, body.z, -leftX, -leftY, 2.0);
  if (left) return { normalX: left.normalX, normalY: left.normalY };

  // Otherwise: wall to our right.
  const right = findClimbFace(body.x, body.y, body.z, leftX, leftY, 2.0);
  if (right) return { normalX: right.normalX, normalY: right.normalY };

  // Fallback — if the player's facing (not vel direction) is pushed
  // into a wall, use that.
  const forward = findClimbFace(body.x, body.y, body.z, facingX, facingY, 2.0);
  if (forward) return { normalX: forward.normalX, normalY: forward.normalY };

  return null;
}

/**
 * Latch the body onto a wall. Records normal + timer and flips loco.
 */
export function startWallRun(body: MovementBody, normalX: number, normalY: number): void {
  body.wallRun = {
    normalX,
    normalY,
    timeLeft: WALL_RUN_MAX_DURATION_FRAMES,
  };
  body.loco = 'wallRunning';
  // Kill downward velocity at latch so we don't drop before sticking.
  if (body.vz < 0) body.vz *= 0.2;
  triggerFocus('wallRunLaunch');
}

/** Release the wall with an outward kick (jump-off or timeout exit). */
export function releaseWallRun(
  body: MovementBody,
  withJump: boolean,
  jumpVz: number,
  pushMag: number,
): void {
  if (!body.wallRun) {
    body.loco = body.grounded ? 'grounded' : 'falling';
    return;
  }
  const nx = body.wallRun.normalX;
  const ny = body.wallRun.normalY;
  body.wallRun = null;
  if (withJump) {
    body.vx = nx * pushMag;
    body.vy = ny * pushMag;
    body.vz = jumpVz;
    body.loco = 'doubleJumping';
  } else {
    body.loco = body.grounded ? 'grounded' : 'falling';
  }
}

/**
 * Per-frame wall-run integrator. Lockstep with stepWallRunning but
 * reusable outside locomotion (combat could grant a free frame of
 * wall-run physics on parry, etc.).
 */
export function integrateWallRun(body: MovementBody, tangentImpulse: number): void {
  if (!body.wallRun) return;
  const nx = body.wallRun.normalX;
  const ny = body.wallRun.normalY;
  // Tangent = normal rotated 90° (CCW). Either tangent direction works;
  // we pick the one aligned with current velocity so the wall-run goes
  // forward rather than reversing.
  let tx = -ny;
  let ty = nx;
  if (body.vx * tx + body.vy * ty < 0) {
    tx = -tx;
    ty = -ty;
  }
  body.vx += tx * tangentImpulse;
  body.vy += ty * tangentImpulse;

  // Stick to the wall — cancel velocity moving away from it.
  const outward = body.vx * nx + body.vy * ny;
  if (outward > 0) {
    body.vx -= outward * nx;
    body.vy -= outward * ny;
  }

  // Reduced gravity.
  body.vz -= LOCOMOTION_GRAVITY * WALL_RUN_GRAVITY_FACTOR;

  body.wallRun.timeLeft--;
}
