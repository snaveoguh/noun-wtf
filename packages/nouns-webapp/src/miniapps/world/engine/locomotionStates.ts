// ── Locomotion leaf-state step handlers ──────────────────────────────
//
// `stepLocomotion` in locomotion.ts dispatches to the right leaf each
// frame based on body.loco. Each leaf is a pure function that mutates
// the body and returns an optional next-substate + bullet-time cue.
//
// We intentionally keep the existing grounded/climb/jump logic inside
// locomotion.ts — the leaves here cover the new substates (dash, slide,
// wall-run, mantle, double-jump, falling).

import type { MovementBody, LocoSubstate } from './movementBody';
import type { Tile } from './types';
import {
  LOCOMOTION_GRAVITY,
  PLAYER_MAX_HORIZ_VEL,
  PLAYER_JUMP_VZ,
  PLAYER_WALL_JUMP_PUSH,
  HARD_LANDING_VZ,
} from './types';
import { finishDash } from './dash';
import { integrateWallRun, releaseWallRun } from './wallRun';
import { integrateMantle } from './mantle';
import { resolveWallSlide, sampleGroundHeight, clampToWorld } from './physics';

/** Bullet-time cue a leaf can bubble up to the dispatcher. */
export type BulletTimeTrigger = 'dash' | 'doubleJump' | 'wallRunLaunch' | 'hardLanding' | null;

export interface LeafResult {
  /** If set, switch body.loco to this before next frame. */
  nextLoco?: LocoSubstate;
  /** Optional bullet-time cue to forward to timeControl.triggerFocus. */
  bulletTimeTrigger?: BulletTimeTrigger;
}

/** Shared input contract — matches LocomotionInput in locomotion.ts. */
export interface LeafInput {
  moveX: number;
  moveY: number;
  sprint: boolean;
  jumpPressed: boolean;
  jumpHeld: boolean;
  canClimb: boolean;
  facingX: number;
  facingY: number;
}

// ── Shared physics helpers ────────────────────────────────────────────

function substepHorizontal(body: MovementBody, map: Tile[][]): void {
  const speed = Math.hypot(body.vx, body.vy);
  if (speed < 0.001) return;
  const maxStep = Math.max(0.5, body.radius * 0.8);
  const steps = Math.max(1, Math.ceil(speed / maxStep));
  const sx = body.vx / steps;
  const sy = body.vy / steps;
  for (let i = 0; i < steps; i++) {
    const res = resolveWallSlide(body.x, body.y, sx, sy, body.radius, body.z, map);
    body.x = res.x;
    body.y = res.y;
    if (res.blockedX) body.vx = 0;
    if (res.blockedY) body.vy = 0;
    if (res.blockedX && res.blockedY) break;
  }
  const c = clampToWorld(body.x, body.y);
  body.x = c.x;
  body.y = c.y;
}

/** Vertical integration + grounding. Returns landing impact (|vz|) if just landed. */
function substepVertical(body: MovementBody, map: Tile[][]): { landed: boolean; impact: number } {
  const prevGrounded = body.grounded;
  const prevVz = body.vz;
  body.z += body.vz;
  const ground = sampleGroundHeight(body.x, body.y, body.z + 0.5, map);
  body.groundZ = ground.topZ;
  if (body.vz <= 0 && body.z <= ground.topZ + 0.01) {
    body.z = ground.topZ;
    body.vz = 0;
    body.grounded = true;
    body.groundMaterial = ground.material;
    const landed = !prevGrounded;
    const impact = landed ? Math.abs(prevVz) : 0;
    if (landed) body.landingImpact = impact;
    return { landed, impact };
  }
  body.grounded = false;
  body.groundMaterial = ground.material;
  return { landed: false, impact: 0 };
}

// ── Leaves ────────────────────────────────────────────────────────────

/**
 * Grounded leaf. The existing grounded logic still lives inline in
 * locomotion.ts; this entrypoint is here for symmetry and so future
 * refactors can migrate the body. For now it's a thin pass-through —
 * locomotion.ts will only call it when body.loco === 'grounded' and
 * use the existing math.
 */

export function stepGrounded(body: MovementBody, input: LeafInput, map: Tile[][]): LeafResult {
  // Thin pass-through — locomotion.ts runs the grounded math inline.
  // Params kept on the signature so future refactors can migrate here.
  void body;
  void input;
  void map;
  return {};
}

/** Rising phase of a single jump. Transitions to falling when vz ≤ 0. */
export function stepJumping(body: MovementBody, _input: LeafInput, map: Tile[][]): LeafResult {
  body.vz -= LOCOMOTION_GRAVITY;
  if (body.vz < -18) body.vz = -18;
  substepHorizontal(body, map);
  const { landed, impact } = substepVertical(body, map);
  if (landed) {
    // Raised from > HARD_LANDING_VZ (10) so *regular* jumps don't trigger
    // slo-mo every landing — only real falls do.
    const cue: BulletTimeTrigger = impact > HARD_LANDING_VZ * 1.6 ? 'hardLanding' : null;
    return { nextLoco: 'grounded', bulletTimeTrigger: cue };
  }
  if (body.vz <= 0) return { nextLoco: 'falling' };
  return {};
}

/** Free-fall after jump apex or walking off a ledge. */
export function stepFalling(body: MovementBody, _input: LeafInput, map: Tile[][]): LeafResult {
  body.vz -= LOCOMOTION_GRAVITY;
  if (body.vz < -18) body.vz = -18;
  substepHorizontal(body, map);
  const { landed, impact } = substepVertical(body, map);
  if (landed) {
    // Raised from > HARD_LANDING_VZ (10) so *regular* jumps don't trigger
    // slo-mo every landing — only real falls do.
    const cue: BulletTimeTrigger = impact > HARD_LANDING_VZ * 1.6 ? 'hardLanding' : null;
    return { nextLoco: 'grounded', bulletTimeTrigger: cue };
  }
  return {};
}

/** Second jump already in progress. Same as falling after its vz goes negative. */
export function stepDoubleJumping(
  body: MovementBody,
  _input: LeafInput,
  map: Tile[][],
): LeafResult {
  body.vz -= LOCOMOTION_GRAVITY;
  if (body.vz < -18) body.vz = -18;
  substepHorizontal(body, map);
  const { landed, impact } = substepVertical(body, map);
  if (landed) {
    // Raised from > HARD_LANDING_VZ (10) so *regular* jumps don't trigger
    // slo-mo every landing — only real falls do.
    const cue: BulletTimeTrigger = impact > HARD_LANDING_VZ * 1.6 ? 'hardLanding' : null;
    return { nextLoco: 'grounded', bulletTimeTrigger: cue };
  }
  if (body.vz <= 0) return { nextLoco: 'falling' };
  return {};
}

/** Dashing — ignore gravity for a few frames, no input. */
export function stepDashing(body: MovementBody, _input: LeafInput, map: Tile[][]): LeafResult {
  body.vx = body.dashVx;
  body.vy = body.dashVy;
  body.vz = 0;
  substepHorizontal(body, map);
  // Minimal vertical update so ground state stays accurate.
  substepVertical(body, map);
  body.dashTimer--;
  if (body.dashTimer <= 0) {
    finishDash(body, 0.6);
    return { nextLoco: body.grounded ? 'grounded' : 'falling' };
  }
  return {};
}

/** Sliding along the ground with capped horizontal friction + gravity. */
export function stepSliding(body: MovementBody, input: LeafInput, map: Tile[][]): LeafResult {
  // Slight friction. Scale slows by ~0.98/frame (still slick).
  body.vx *= 0.985;
  body.vy *= 0.985;
  // Cap speed defensively — a slide shouldn't exceed sprint cap much.
  const spd = Math.hypot(body.vx, body.vy);
  const cap = PLAYER_MAX_HORIZ_VEL * 1.2;
  if (spd > cap) {
    const k = cap / spd;
    body.vx *= k;
    body.vy *= k;
  }
  body.vz -= LOCOMOTION_GRAVITY;
  substepHorizontal(body, map);
  const { landed } = substepVertical(body, map);

  body.slideTimer--;
  const wantExit =
    body.slideTimer <= 0 ||
    input.jumpPressed ||
    Math.hypot(body.vx, body.vy) < 0.2 ||
    !body.grounded;
  if (wantExit) {
    // Jumping out of slide cancels the slide cleanly.
    if (input.jumpPressed && body.grounded) {
      body.vz = PLAYER_JUMP_VZ;
      body.grounded = false;
      return { nextLoco: 'jumping' };
    }
    return { nextLoco: landed || body.grounded ? 'grounded' : 'falling' };
  }
  return {};
}

/** Wall-running — momentum along tangent, dampened gravity, optional jump-off. */
export function stepWallRunning(body: MovementBody, input: LeafInput, map: Tile[][]): LeafResult {
  if (!body.wallRun) return { nextLoco: 'falling' };

  // Jump-off kicks us outward + upward.
  if (input.jumpPressed) {
    releaseWallRun(body, true, PLAYER_JUMP_VZ, PLAYER_WALL_JUMP_PUSH);
    return { nextLoco: 'doubleJumping' };
  }

  // Small tangent boost so we keep moving along the wall.
  integrateWallRun(body, 0.05);
  substepHorizontal(body, map);
  const { landed } = substepVertical(body, map);

  // Exits: timeout, ground contact, or input release.
  const inputMag = Math.hypot(input.moveX, input.moveY);
  if (!body.wallRun || body.wallRun.timeLeft <= 0 || landed || body.grounded || inputMag < 0.1) {
    releaseWallRun(body, false, 0, 0);
    return { nextLoco: body.grounded ? 'grounded' : 'falling' };
  }
  return {};
}

/** Mantling — lerp z toward roof; no input authority. */
export function stepMantling(body: MovementBody, _input: LeafInput, map: Tile[][]): LeafResult {
  const done = integrateMantle(body);
  // Hold horizontal position — no wall-slide needed, vx/vy are zero.
  substepHorizontal(body, map);
  if (done) {
    body.vz = 0;
    body.grounded = true;
    return { nextLoco: 'grounded' };
  }
  return {};
}
