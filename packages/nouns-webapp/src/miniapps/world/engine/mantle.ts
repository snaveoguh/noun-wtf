// ── Mantle — auto pop-onto-ledge while falling into a wall ──────────
//
// When the body is falling with forward velocity and the wall ahead
// has a top within waist range, we ease z up to the roof over ~9
// frames while locking horizontal input. Then transition to grounded.

import type { MovementBody } from './movementBody';
import { findClimbFace } from './structures';
import { MANTLE_DURATION_FRAMES } from './types';
import { smoothstep } from './accelCurves';
import { emitMantle } from './juice';

/**
 * Can we mantle? Requires:
 *   - airborne
 *   - falling (or near apex, vz ≤ small threshold)
 *   - forward input into a wall
 *   - wall-top within waist range (body.z to body.z + height)
 */
export function canMantle(
  body: MovementBody,
  facingX: number,
  facingY: number,
  forwardInput: number,
): boolean {
  if (body.grounded) return false;
  if (body.vz > 0.5) return false; // still rising
  if (body.loco === 'mantling') return false;
  if (forwardInput < 0.5) return false;

  const contact = findClimbFace(body.x, body.y, body.z, facingX, facingY, 2.2);
  if (!contact) return false;

  // endZ is the top of the climb face. If it sits between current z
  // and head height, we can mantle.
  const top = contact.face.endZ;
  const waistLow = body.z;
  const waistHigh = body.z + body.height * 0.75;
  return top >= waistLow - 0.1 && top <= waistHigh;
}

/** Start a mantle. Records target Z and timer. */
export function startMantle(body: MovementBody, facingX: number, facingY: number): boolean {
  const contact = findClimbFace(body.x, body.y, body.z, facingX, facingY, 2.2);
  if (!contact) return false;
  body.mantleTimer = MANTLE_DURATION_FRAMES;
  body.mantleTargetZ = contact.face.endZ + 0.02;
  body.loco = 'mantling';
  body.vx = 0;
  body.vy = 0;
  body.vz = 0;
  return true;
}

/** Per-frame mantle integrator. Returns true when mantle completes. */
export function integrateMantle(body: MovementBody): boolean {
  if (body.mantleTimer <= 0) return true;

  const framesLeft = body.mantleTimer;
  const totalFrames = MANTLE_DURATION_FRAMES;
  const progress = 1 - framesLeft / totalFrames;
  const curveNow = smoothstep(progress);
  const nextProgress = 1 - Math.max(0, framesLeft - 1) / totalFrames;
  const curveNext = smoothstep(nextProgress);
  // Interpolate z — we want the *delta* this frame.
  const startZ =
    body.z - (curveNow * (body.mantleTargetZ - body.z)) / Math.max(0.0001, 1 - curveNow);
  const nextZ = startZ + curveNext * (body.mantleTargetZ - startZ);
  body.z = Math.max(body.z, Math.min(body.mantleTargetZ, nextZ));

  body.mantleTimer--;

  if (body.mantleTimer <= 0 || Math.abs(body.z - body.mantleTargetZ) < 0.02) {
    body.z = body.mantleTargetZ;
    body.mantleTimer = 0;
    body.vz = 0;
    emitMantle({ x: body.x, y: body.y, fromZ: body.z, toZ: body.mantleTargetZ });
    return true;
  }
  return false;
}
