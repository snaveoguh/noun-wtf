// ── On-foot FPS movement against boxes + ramps ─────────────────────────
//
// Quake-ish: accelerate toward the wish velocity on the ground, light air
// control, auto step-up for kerbs and stairs, ramps as height fields.
// Collision resolves per axis (X, Z, then Y) against the AABB of the body,
// which is cheap, exact and never tunnels at our speeds (≤ 9 m/s · 1/60 s).

import type { World } from './world';

import { BODY, type PlayerInput, type PlayerState, type SimEvent } from './types';
import { rampHeight } from './world';

const EPS = 0.001;

export function bodyHeight(p: PlayerState): number {
  return p.crouched ? BODY.crouchHeight : BODY.height;
}

export function eyeHeight(p: PlayerState): number {
  return p.crouched ? BODY.crouchEye : BODY.eye;
}

/** The big Noun head: hit sphere centre (world y) + radius. */
export const HEAD_R = 0.47;
export function headY(p: PlayerState): number {
  return p.y + bodyHeight(p) * 0.75;
}

/** Torso aim point. */
export function chestY(p: PlayerState): number {
  return p.y + bodyHeight(p) * 0.45;
}

/** Unit view vector for yaw/pitch (yaw 0 → −Z, pitch + → up). */
export function viewDir(yaw: number, pitch: number): [number, number, number] {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

function approach(v: number, target: number, maxDelta: number): number {
  const d = target - v;
  if (d > maxDelta) return v + maxDelta;
  if (d < -maxDelta) return v - maxDelta;
  return target;
}

/** Push the body out of boxes along one horizontal axis (with step-up). */
function resolveAxis(world: World, p: PlayerState, axis: 0 | 2, allowStep: boolean): boolean {
  const r = BODY.radius;
  const h = bodyHeight(p);
  let blocked = false;
  for (const b of world.boxes) {
    if (
      b.maxX <= p.x - r + EPS * 0.1 ||
      b.minX >= p.x + r - EPS * 0.1 ||
      b.maxZ <= p.z - r + EPS * 0.1 ||
      b.minZ >= p.z + r - EPS * 0.1 ||
      b.maxY <= p.y + 0.01 ||
      b.minY >= p.y + h
    )
      continue;
    // Kerb / stair: hop up onto it if there's headroom
    const rise = b.maxY - p.y;
    if (
      allowStep &&
      rise <= BODY.step &&
      !world.boxBlocked(p.x - r, b.maxY + 0.01, p.z - r, p.x + r, b.maxY + h, p.z + r)
    ) {
      p.y = b.maxY;
      continue;
    }
    blocked = true;
    if (axis === 0) {
      const penL = p.x + r - b.minX;
      const penR = b.maxX - (p.x - r);
      if (penL < penR) {
        p.x -= penL + EPS;
        if (p.vx > 0) p.vx = 0;
      } else {
        p.x += penR + EPS;
        if (p.vx < 0) p.vx = 0;
      }
    } else {
      const penL = p.z + r - b.minZ;
      const penR = b.maxZ - (p.z - r);
      if (penL < penR) {
        p.z -= penL + EPS;
        if (p.vz > 0) p.vz = 0;
      } else {
        p.z += penR + EPS;
        if (p.vz < 0) p.vz = 0;
      }
    }
  }
  return blocked;
}

/** Ramp sides are walls when you're well below the surface. */
function resolveRampSides(world: World, p: PlayerState) {
  for (const rp of world.ramps) {
    if (p.x < rp.x0 || p.x > rp.x1 || p.z < rp.z0 || p.z > rp.z1) continue;
    const h = rampHeight(rp, p.x, p.z);
    if (p.y >= h - BODY.step || p.y + bodyHeight(p) < rp.y0) continue;
    // Out through the nearest edge
    const dl = p.x - rp.x0;
    const dr = rp.x1 - p.x;
    const db = p.z - rp.z0;
    const df = rp.z1 - p.z;
    const m = Math.min(dl, dr, db, df);
    if (m === dl) p.x = rp.x0 - EPS;
    else if (m === dr) p.x = rp.x1 + EPS;
    else if (m === db) p.z = rp.z0 - EPS;
    else p.z = rp.z1 + EPS;
  }
}

/** Shove the body out of anything it overlaps (after pushes / spawns). */
export function depenetrate(world: World, p: PlayerState) {
  resolveAxis(world, p, 0, false);
  resolveAxis(world, p, 2, false);
  p.x = Math.min(world.maxX - BODY.radius, Math.max(world.minX + BODY.radius, p.x));
  p.z = Math.min(world.maxZ - BODY.radius, Math.max(world.minZ + BODY.radius, p.z));
}

/**
 * One tick of movement for a living player. `frozen` = countdown (look
 * only). Pushes jump / land events.
 */
export function movePlayer(
  world: World,
  p: PlayerState,
  inp: PlayerInput,
  dt: number,
  frozen: boolean,
  firing: boolean,
  events: SimEvent[],
) {
  const r = BODY.radius;
  // Crouch (stand back up only with headroom)
  if (inp.crouch && p.grounded) p.crouched = true;
  else if (!inp.crouch && p.crouched) {
    if (!world.boxBlocked(p.x - r, p.y + 0.05, p.z - r, p.x + r, p.y + BODY.height, p.z + r))
      p.crouched = false;
  }

  let mx = frozen ? 0 : Math.max(-1, Math.min(1, inp.moveX));
  let my = frozen ? 0 : Math.max(-1, Math.min(1, inp.moveY));
  const ml = Math.hypot(mx, my);
  if (ml > 1) {
    mx /= ml;
    my /= ml;
  }
  p.sprinting = inp.sprint && my > 0.3 && !p.crouched && !p.scoped && !firing && p.grounded;
  let speed = p.crouched ? BODY.crouchSpeed : p.sprinting ? BODY.sprint : BODY.walk;
  if (p.scoped) speed *= 0.55;
  const s = Math.sin(p.yaw);
  const c = Math.cos(p.yaw);
  // forward (−sin, −cos), right (cos, −sin)
  const wishX = (c * mx - s * my) * speed;
  const wishZ = (-s * mx - c * my) * speed;
  if (p.grounded) {
    const a = (ml > 0.01 ? BODY.accel : BODY.friction * speed + 20) * dt;
    p.vx = approach(p.vx, wishX, a);
    p.vz = approach(p.vz, wishZ, a);
  } else if (ml > 0.01) {
    p.vx = approach(p.vx, wishX, BODY.airAccel * dt);
    p.vz = approach(p.vz, wishZ, BODY.airAccel * dt);
  }

  if (!frozen && inp.jump && !p.prevJump && p.grounded) {
    p.vy = BODY.jump;
    p.grounded = false;
    if (p.crouched) p.crouched = false;
    events.push({ type: 'jump', pid: p.id });
  }

  const wasGrounded = p.grounded;
  p.vy -= BODY.gravity * dt;
  if (p.vy < -40) p.vy = -40;

  const ox = p.x;
  const oz = p.z;
  p.x += p.vx * dt;
  resolveAxis(world, p, 0, wasGrounded);
  p.z += p.vz * dt;
  resolveAxis(world, p, 2, wasGrounded);
  resolveRampSides(world, p);
  p.x = Math.min(world.maxX - r, Math.max(world.minX + r, p.x));
  p.z = Math.min(world.maxZ - r, Math.max(world.minZ + r, p.z));

  // Vertical
  const vyBefore = p.vy;
  p.y += p.vy * dt;
  const h = bodyHeight(p);
  let landed = false;
  for (const b of world.boxes) {
    if (
      b.maxX <= p.x - r ||
      b.minX >= p.x + r ||
      b.maxZ <= p.z - r ||
      b.minZ >= p.z + r ||
      b.maxY <= p.y ||
      b.minY >= p.y + h
    )
      continue;
    if (p.vy <= 0 && b.maxY - p.y <= 0.7) {
      p.y = b.maxY;
      p.vy = 0;
      landed = true;
    } else if (p.vy > 0) {
      p.y = b.minY - h - EPS;
      p.vy = 0;
    }
  }
  if (p.vy <= 0) {
    for (const rp of world.ramps) {
      if (p.x < rp.x0 || p.x > rp.x1 || p.z < rp.z0 || p.z > rp.z1) continue;
      const rh = rampHeight(rp, p.x, p.z);
      const snap = wasGrounded ? 0.35 : 0.02;
      if (p.y <= rh + snap && p.y >= rh - BODY.step - 0.2) {
        p.y = rh;
        p.vy = 0;
        landed = true;
      }
    }
  }
  if (landed && !wasGrounded && vyBefore < -7.5)
    events.push({ type: 'land', pid: p.id, speed: -vyBefore });
  p.grounded = landed;
  if (p.grounded) p.stride += Math.hypot(p.x - ox, p.z - oz);
}
