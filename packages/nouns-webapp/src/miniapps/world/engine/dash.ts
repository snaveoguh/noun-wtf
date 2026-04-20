// ── Dash — ground / air dash with double-tap detection ───────────────
//
// Shared dash implementation. Called from two places:
//   - locomotion (double-tap WASD triggers dash, steered by player facing)
//   - combat (dash move from the move list — triggered via combo.ts)
// Both routes end up calling `startDash`, so velocity + bullet-time
// triggers stay in one place.

import type { MovementBody } from './movementBody';
import { DASH_SPEED as LOCO_DASH_SPEED, DASH_DURATION_FRAMES, DASH_IFRAMES_FRAMES } from './types';
import { triggerFocus } from './timeControl';
import { emitDash } from './juice';

/** Window (ms) during which a second tap in the same direction counts as a dash. */
export const DASH_DOUBLE_TAP_WINDOW_MS = 220;

/** Start a dash toward (dirX, dirY). Must be unit-ish; caller normalizes. */
export function startDash(
  body: MovementBody,
  dirX: number,
  dirY: number,
  opts?: { speed?: number; durationFrames?: number; iFrames?: number; kind?: 'ground' | 'air' },
): void {
  const speed = opts?.speed ?? LOCO_DASH_SPEED;
  const dur = opts?.durationFrames ?? DASH_DURATION_FRAMES;
  const iFr = opts?.iFrames ?? DASH_IFRAMES_FRAMES;

  const mag = Math.hypot(dirX, dirY);
  if (mag < 0.001) return;
  const nx = dirX / mag;
  const ny = dirY / mag;

  body.dashVx = nx * speed;
  body.dashVy = ny * speed;
  body.vx = body.dashVx;
  body.vy = body.dashVy;
  body.dashTimer = dur;
  body.iFrames = Math.max(body.iFrames, iFr);
  body.loco = 'dashing';

  triggerFocus('dash');
  emitDash({ x: body.x, y: body.y, z: body.z, dirX: nx, dirY: ny });
}

/**
 * Register an input tap for double-tap detection. Returns true if this
 * tap closes a double-tap combo and a dash should fire.
 *
 * Caller passes `nowMs` (so tests can mock) and the current input vector
 * (already normalized). Same-direction-within-window = dash.
 */
export function registerDirTap(
  body: MovementBody,
  tapX: number,
  tapY: number,
  nowMs: number,
  windowMs = DASH_DOUBLE_TAP_WINDOW_MS,
): boolean {
  const mag = Math.hypot(tapX, tapY);
  if (mag < 0.001) return false;
  const nx = tapX / mag;
  const ny = tapY / mag;

  const prev = body.lastDirTapVec;
  const prevTime = body.lastDirTapTime;
  // Always record this tap for the next comparison.
  body.lastDirTapTime = nowMs;
  body.lastDirTapVec = [nx, ny];

  if (!prev) return false;
  if (nowMs - prevTime > windowMs) return false;

  // Same-ish direction (dot > 0.7 ~= 45°).
  const dot = prev[0] * nx + prev[1] * ny;
  if (dot < 0.7) return false;

  // Consume the tap so the same pair can't re-trigger.
  body.lastDirTapVec = null;
  body.lastDirTapTime = 0;
  return true;
}

/** Scale velocity to the Matrix-slide-out feel at dash exit. */
export function finishDash(body: MovementBody, exitScale = 0.6): void {
  body.vx = body.dashVx * exitScale;
  body.vy = body.dashVy * exitScale;
  body.dashTimer = 0;
  body.dashVx = 0;
  body.dashVy = 0;
  // Caller picks next loco (grounded / falling) — we don't know ground state.
}
