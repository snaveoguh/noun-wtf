// ── Locomotion — walk / sprint / jump / climb ────────────────────────
//
// Composable movement step. Reads InputState, mutates a MovementBody.
// Combat state (attacking, dashing, stunned, etc.) lives on Player and
// is handled by combat.ts — locomotion only owns the motion math.
//
// Behavior:
//   - Accel/decel ramps rather than snap-to-target velocity.
//   - Hard caps on horizontal velocity to avoid tunneling at sprint.
//   - Movement is sub-stepped when |velocity| > radius.
//   - Circle-vs-AABB collision against tiles and registered structures.
//   - Single jump, coyote time, jump buffer, variable height (short hop
//     vs full jump), wall-jump off climb faces.
//   - Climb state activates when pressing into a registered climb face
//     while up/down is held.
//
// ───────────────────────────────────────────────────────────────────────

import type { InputState } from './input';
import type { MovementBody } from './movementBody';
import type { Tile, GroundMaterial } from './types';
import {
  PLAYER_WALK_SPEED,
  PLAYER_SPEED_FAST,
  PLAYER_ACCEL,
  PLAYER_DECEL,
  PLAYER_AIR_ACCEL,
  PLAYER_MAX_HORIZ_VEL,
  PLAYER_JUMP_VZ,
  PLAYER_JUMP_CUT_MULT,
  PLAYER_JUMPS_MAX,
  PLAYER_COYOTE_FRAMES,
  PLAYER_JUMP_BUFFER_FRAMES,
  LOCOMOTION_GRAVITY,
  PLAYER_CLIMB_SPEED,
  PLAYER_CLIMB_STRAFE,
  PLAYER_WALL_JUMP_VZ,
  PLAYER_WALL_JUMP_PUSH,
  PLAYER_CLIMB_REACH,
} from './types';
import { getMovementVector } from './input';
import { resolveWallSlide, sampleGroundHeight, clampToWorld } from './physics';
import { findClimbFace, getStructure } from './structures';

// ── Configuration & options ───────────────────────────────────────────

export interface LocomotionConfig {
  walkSpeed: number;
  sprintSpeed: number;
  accel: number;
  decel: number;
  airAccel: number;
  maxHorizVel: number;
  jumpVz: number;
  jumpCutMult: number;
  jumpsMax: number;
  coyoteFrames: number;
  jumpBufferFrames: number;
  gravity: number;
  climbSpeed: number;
  climbStrafe: number;
  wallJumpVz: number;
  wallJumpPush: number;
  climbReach: number;
}

export const DEFAULT_LOCOMOTION: LocomotionConfig = {
  walkSpeed: PLAYER_WALK_SPEED,
  sprintSpeed: PLAYER_SPEED_FAST,
  accel: PLAYER_ACCEL,
  decel: PLAYER_DECEL,
  airAccel: PLAYER_AIR_ACCEL,
  maxHorizVel: PLAYER_MAX_HORIZ_VEL,
  jumpVz: PLAYER_JUMP_VZ,
  jumpCutMult: PLAYER_JUMP_CUT_MULT,
  jumpsMax: PLAYER_JUMPS_MAX,
  coyoteFrames: PLAYER_COYOTE_FRAMES,
  jumpBufferFrames: PLAYER_JUMP_BUFFER_FRAMES,
  gravity: LOCOMOTION_GRAVITY,
  climbSpeed: PLAYER_CLIMB_SPEED,
  climbStrafe: PLAYER_CLIMB_STRAFE,
  wallJumpVz: PLAYER_WALL_JUMP_VZ,
  wallJumpPush: PLAYER_WALL_JUMP_PUSH,
  climbReach: PLAYER_CLIMB_REACH,
};

/** Per-tick inputs that the caller resolves from InputState / combat state. */
export interface LocomotionInput {
  /** Desired horizontal direction, pre-normalized and camera-relative. */
  moveX: number;
  moveY: number;
  /** Sprint modifier — typically `input.keys.has('r')`. */
  sprint: boolean;
  /** Pressed this frame: a jump input that should start a jump. */
  jumpPressed: boolean;
  /** Held across frames: jump key is still down (for variable height). */
  jumpHeld: boolean;
  /** Whether the caller wants to allow climb (false during combat/dead). */
  canClimb: boolean;
  /** Player's facing unit vector (from directionFromDelta or similar). */
  facingX: number;
  facingY: number;
}

/** Resolve a LocomotionInput from the raw InputState + camera angle. */
export function readLocomotionInput(input: InputState): LocomotionInput {
  const { dx, dy } = getMovementVector(input.keys, input.cameraAngle);
  const mag = Math.hypot(dx, dy);
  return {
    moveX: dx,
    moveY: dy,
    sprint: input.keys.has('r'),
    // Space as a buffered jump start — the locomotion system also
    // consumes justPressed to avoid double-jumping on held space.
    jumpPressed: input.justPressed.has(' '),
    jumpHeld: input.keys.has(' '),
    canClimb: true,
    facingX: mag > 0.001 ? dx / mag : 0,
    facingY: mag > 0.001 ? dy / mag : 0,
  };
}

// ── Main step ─────────────────────────────────────────────────────────

/**
 * Advance a body one tick. Call this once per frame from the game loop.
 * Does not touch Player directly — bridge via playerToBody / bodyToPlayer.
 */
export function stepLocomotion(
  body: MovementBody,
  input: LocomotionInput,
  map: Tile[][],
  config: LocomotionConfig = DEFAULT_LOCOMOTION,
): void {
  // Timers decay every frame.
  if (body.coyoteTimer > 0) body.coyoteTimer--;
  if (body.jumpBuffer > 0) body.jumpBuffer--;

  // Buffered jump: press sticks around for a few frames so a pre-ground
  // jump still fires on landing.
  if (input.jumpPressed) {
    body.jumpBuffer = config.jumpBufferFrames;
    body.jumpHeld = true;
    body.jumpCut = false;
  }
  // Track held state for variable-height cutoff.
  if (!input.jumpHeld && body.jumpHeld && body.vz > 0 && !body.jumpCut) {
    body.vz *= config.jumpCutMult;
    body.jumpCut = true;
  }
  body.jumpHeld = input.jumpHeld;

  // Branch on climb first — if we're already on a face, we stay there
  // until the player lets go, jumps off, or reaches the top/bottom.
  if (body.climb !== null) {
    stepClimb(body, input, map, config);
    return;
  }

  // Try to grab a climb face if the player is pressed into one.
  if (input.canClimb && body.z < 2 /* or near-ground / after fall-nudge */) {
    // Near-ground climb latch only — midair grabs require a different
    // control scheme. Keep it simple for the first pass.
  }
  // Midair wall-grab: if ascending/falling next to a face and pushing into it.
  if (input.canClimb && !body.grounded && (input.moveX !== 0 || input.moveY !== 0)) {
    maybeGrabClimb(body, input, config);
    if (body.climb !== null) {
      stepClimb(body, input, map, config);
      return;
    }
  }

  // Ground latch (allow latching onto a climb face when standing next
  // to it and pressing into it — but only if we're near the ground on
  // the climb face bottom, so stepping up a ladder works).
  if (input.canClimb && body.grounded && (input.moveX !== 0 || input.moveY !== 0)) {
    const contact = findClimbFace(
      body.x + input.facingX * body.radius,
      body.y + input.facingY * body.radius,
      body.z,
      input.facingX,
      input.facingY,
      config.climbReach,
    );
    // Require a deliberate push: only grab when the input is pointing
    // into the wall *and* there's a meaningful vertical intent
    // (jump queued, or wall is tall enough to be worth mounting).
    if (contact !== null && (body.jumpBuffer > 0 || contact.face.endZ > 4)) {
      startClimb(body, contact);
      stepClimb(body, input, map, config);
      return;
    }
  }

  // ── Normal horizontal motion (ground + air) ──
  applyHorizontalAccel(body, input, config);

  // Jump — coyote time + buffer.
  const canJump = body.grounded || body.coyoteTimer > 0;
  if (body.jumpBuffer > 0 && body.jumpsRemaining > 0 && canJump) {
    body.vz = config.jumpVz;
    body.grounded = false;
    body.jumpsRemaining = Math.max(0, body.jumpsRemaining - 1);
    body.coyoteTimer = 0;
    body.jumpBuffer = 0;
    body.jumpCut = false;
  }

  // Gravity.
  body.vz -= config.gravity;
  // Terminal fall velocity so we don't accelerate forever.
  if (body.vz < -18) body.vz = -18;

  // Sub-stepped horizontal motion (circle-vs-AABB slide) + vertical.
  stepHorizontal(body, map);
  stepVertical(body, map, config);

  // Clamp to world bounds after all motion resolved.
  const clamped = clampToWorld(body.x, body.y);
  body.x = clamped.x;
  body.y = clamped.y;
}

// ── Horizontal accel / decel ──────────────────────────────────────────

function applyHorizontalAccel(
  body: MovementBody,
  input: LocomotionInput,
  cfg: LocomotionConfig,
): void {
  const mag = Math.hypot(input.moveX, input.moveY);
  const target = mag > 0.001 ? (input.sprint ? cfg.sprintSpeed : cfg.walkSpeed) : 0;
  const accel = body.grounded ? cfg.accel : cfg.airAccel;
  const decel = body.grounded ? cfg.decel : cfg.airAccel;

  if (mag > 0.001) {
    const nx = input.moveX / mag;
    const ny = input.moveY / mag;
    const desiredVx = nx * target;
    const desiredVy = ny * target;
    body.vx += (desiredVx - body.vx) * accel;
    body.vy += (desiredVy - body.vy) * accel;
  } else {
    // Gentle decel toward zero.
    body.vx -= body.vx * decel;
    body.vy -= body.vy * decel;
    if (Math.abs(body.vx) < 0.01) body.vx = 0;
    if (Math.abs(body.vy) < 0.01) body.vy = 0;
  }

  // Hard cap on horizontal speed.
  const speed = Math.hypot(body.vx, body.vy);
  if (speed > cfg.maxHorizVel) {
    const k = cfg.maxHorizVel / speed;
    body.vx *= k;
    body.vy *= k;
  }
}

// ── Horizontal motion with sub-stepping ───────────────────────────────

function stepHorizontal(body: MovementBody, map: Tile[][]): void {
  const speed = Math.hypot(body.vx, body.vy);
  if (speed < 0.001) return;

  // Sub-step to prevent tunneling when |vel| > radius.
  const maxStep = Math.max(0.5, body.radius * 0.8);
  const steps = Math.max(1, Math.ceil(speed / maxStep));
  const stepVx = body.vx / steps;
  const stepVy = body.vy / steps;

  for (let i = 0; i < steps; i++) {
    const res = resolveWallSlide(body.x, body.y, stepVx, stepVy, body.radius, body.z, map);
    body.x = res.x;
    body.y = res.y;
    if (res.blockedX) body.vx = 0;
    if (res.blockedY) body.vy = 0;
    if (res.blockedX && res.blockedY) break;
  }
}

// ── Vertical motion + grounding ───────────────────────────────────────

function stepVertical(body: MovementBody, map: Tile[][], cfg: LocomotionConfig): void {
  const prevGrounded = body.grounded;
  body.z += body.vz;

  const ground = sampleGroundHeight(body.x, body.y, body.z + 0.5, map);
  body.groundZ = ground.topZ;

  // Snap up to roofs: if we're slightly inside a roof surface, resolve
  // onto it (don't fall through).
  if (body.vz <= 0 && body.z <= ground.topZ + 0.01) {
    body.z = ground.topZ;
    body.vz = 0;
    body.grounded = true;
    body.groundMaterial = ground.material;
    body.jumpsRemaining = cfg.jumpsMax;
    // Landing → burn the buffered jump window so the next coyote frame
    // doesn't immediately re-jump.
    body.coyoteTimer = 0;
  } else {
    body.grounded = false;
    body.groundMaterial = ground.material;
    // Edge-off: if we *were* grounded last frame and now aren't,
    // open the coyote window.
    if (prevGrounded && body.coyoteTimer === 0 && body.vz <= 0) {
      body.coyoteTimer = cfg.coyoteFrames;
    }
  }
}

// ── Climb state machine ───────────────────────────────────────────────

function startClimb(body: MovementBody, contact: ReturnType<typeof findClimbFace>): void {
  if (!contact) return;
  body.climb = {
    structureId: contact.structureId,
    faceId: contact.face.id,
    side: contact.face.side,
    material: contact.face.material,
  };
  // Stick to the face plane — zero horizontal velocity on grab.
  body.vx = 0;
  body.vy = 0;
  body.vz = 0;
  body.grounded = false;
}

function maybeGrabClimb(body: MovementBody, input: LocomotionInput, cfg: LocomotionConfig): void {
  const contact = findClimbFace(
    body.x,
    body.y,
    body.z,
    input.facingX,
    input.facingY,
    cfg.climbReach,
  );
  if (contact) startClimb(body, contact);
}

function stepClimb(
  body: MovementBody,
  input: LocomotionInput,
  map: Tile[][],
  cfg: LocomotionConfig,
): void {
  if (!body.climb) return;

  // Wall-jump off takes priority.
  if (body.jumpBuffer > 0) {
    const normal = climbOutwardNormal(body);
    body.vx = normal.x * cfg.wallJumpPush;
    body.vy = normal.y * cfg.wallJumpPush;
    body.vz = cfg.wallJumpVz;
    body.jumpBuffer = 0;
    body.jumpsRemaining = Math.max(1, cfg.jumpsMax); // wall-jump grants an air jump
    body.climb = null;
    return;
  }

  const structure = getStructure(body.climb.structureId);
  if (!structure) {
    body.climb = null;
    return;
  }
  const face = structure.opts.climbFaces.find(f => f.id === body.climb?.faceId);
  if (!face) {
    body.climb = null;
    return;
  }

  // Map player input to face-local axes.
  // "up" on the face = +Z. "strafe" = along the face's side.
  const outward = climbOutwardNormal(body);
  // Tangent along the face (rotate outward 90deg).
  const tx = -outward.y;
  const ty = outward.x;

  // Up/down comes from the component of moveX/moveY that points away
  // from the wall's outward normal. Pushing into the wall (facing
  // opposite of outward) keeps us latched; pulling away drops us.
  const press = -(input.moveX * outward.x + input.moveY * outward.y); // +1 = into wall
  const strafe = input.moveX * tx + input.moveY * ty;

  // Release if the player has stopped pressing into the wall.
  if (press < -0.2) {
    body.climb = null;
    // Push slightly away so we don't immediately re-grab.
    body.vx = outward.x * 0.3;
    body.vy = outward.y * 0.3;
    return;
  }

  // Climb up/down comes from the PRESS magnitude (stick forward = climb).
  // Negative moveY from getMovementVector means "forward" (camera-up).
  // We treat any "push into wall" as intent to climb up if the stick is
  // substantially engaged — and use the face's +Z axis directly.
  // This gives W=up the ladder, S=down the ladder.
  // We rely on press > 0.4 to filter out accidental brushes.
  let climbVz = 0;
  if (press > 0.4) {
    // Full-strength climb up when pressing into the wall.
    climbVz = cfg.climbSpeed;
  } else if (press < 0.1) {
    // Not actively pressing → slide down slowly.
    climbVz = -cfg.climbSpeed * 0.5;
  }

  // Movement along the face.
  body.x += tx * strafe * cfg.climbStrafe;
  body.y += ty * strafe * cfg.climbStrafe;
  body.z += climbVz;
  body.vx = 0;
  body.vy = 0;
  body.vz = 0;

  // Reached the top → pop onto the roof.
  if (body.z >= face.endZ) {
    body.z = face.endZ;
    // Nudge forward off the face onto the roof.
    body.x -= outward.x * (body.radius + 0.1);
    body.y -= outward.y * (body.radius + 0.1);
    body.vz = 0.2; // tiny hop to clear the lip
    body.climb = null;
    return;
  }

  // Reached the bottom → drop off.
  if (body.z <= face.startZ) {
    body.z = Math.max(face.startZ, 0);
    body.climb = null;
    return;
  }

  // Update ground sample for material reporting even while climbing.
  body.groundMaterial = body.climb.material;

  // Clamp to world bounds while climbing.
  const c = clampToWorld(body.x, body.y);
  body.x = c.x;
  body.y = c.y;

  void map; // map not currently consulted during climb — reserved for overhang blocking
}

/** Outward-facing normal for the current climb face, in world XY. */
function climbOutwardNormal(body: MovementBody): { x: number; y: number } {
  if (!body.climb) return { x: 0, y: 0 };
  switch (body.climb.side) {
    case 'north':
      return { x: 0, y: 1 };
    case 'south':
      return { x: 0, y: -1 };
    case 'east':
      return { x: 1, y: 0 };
    case 'west':
      return { x: -1, y: 0 };
  }
}

// ── Utility — advance a body through a disabled-control frame ─────────
//
// Used by combat.ts while the player is stunned/attacking/etc: we still
// need gravity + ground snap + wall collision, but no input-driven
// acceleration. Pass a "ghost" input with zero move vector.

export const IDLE_LOCOMOTION_INPUT: LocomotionInput = {
  moveX: 0,
  moveY: 0,
  sprint: false,
  jumpPressed: false,
  jumpHeld: false,
  canClimb: false,
  facingX: 0,
  facingY: 0,
};

/**
 * Passive physics step — gravity, ground, collision only. No input,
 * no jumps. Use during combat states that override motion (knocked,
 * attacking) but still need to fall / slide against walls.
 *
 * Climbing is forcibly released in passive mode.
 */
export function stepPassive(
  body: MovementBody,
  map: Tile[][],
  config: LocomotionConfig = DEFAULT_LOCOMOTION,
): void {
  if (body.climb !== null) body.climb = null;
  body.vz -= config.gravity;
  if (body.vz < -18) body.vz = -18;
  stepHorizontal(body, map);
  stepVertical(body, map, config);
  const c = clampToWorld(body.x, body.y);
  body.x = c.x;
  body.y = c.y;
}

/** Report the material under the body right now. */
export function currentGroundMaterial(body: MovementBody): GroundMaterial {
  return body.groundMaterial;
}
