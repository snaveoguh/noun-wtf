// ── Following the rider (pure; the world comes in through PetWorld) ───────
//
// Beside: the pet runs to a spot beside and a bit behind the rider, checked
// from the rider's own body (a spot the rider can see into is a spot the
// pet can stand in), on the ground under it. It moves with a knee-high
// sweep and a body pushout, steps up kerbs, hops down small drops, and
// never walks off an edge it can't see the bottom of.
// Fly: the same spot up by the rider's head, checked from the head.
// Head: sat on top of the rider's head (unless a ceiling's in the way).
// Anything it can't do (stuck, left behind, a teleport, the rider landing
// 30 m below after a window jump) ends in a poof back beside the rider.

import type { Gait, PetMode } from './contract';

import { PET } from './contract';

/** Collision queries (CollisionWorld in the game, boxes in tests). */
export interface PetWorld {
  /** Highest ground at (x, z) at or below `top`, within `depth`; null = none. */
  ground(x: number, top: number, z: number, depth: number): number | null;
  /** How much of the segment a→b is clear (1 = all of it). */
  clear(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number;
  /** Horizontal push that takes a body (sphere at x, y, z, radius r) out of geometry. */
  pushout(x: number, y: number, z: number, r: number): [number, number];
}

/** The rider, this frame (world units; forward is a unit vector on the ground). */
export interface Owner {
  x: number;
  y: number;
  z: number;
  fx: number;
  fz: number;
  /** Horizontal speed (m/s). */
  speed: number;
  grounded: boolean;
  onBoard: boolean;
  /** World y of the top of the rider's head. */
  headTop: number;
}

export interface PetBody {
  x: number;
  y: number;
  z: number;
  /** Facing (three's rotation.y for a model facing +z). */
  yaw: number;
  vy: number;
  /** Horizontal speed it actually moved at (m/s), for the gait. */
  speed: number;
  grounded: boolean;
  /** Which side of the rider it runs on (+1 right, −1 left). */
  side: number;
  stuck: number;
  /** How long the rider's been standing about (s). */
  idle: number;
  /** Happy spin time left (s). */
  happy: number;
  /** How long the rider's been grounded (s), and their last position. */
  ownerGround: number;
  lastX: number;
  lastY: number;
  lastZ: number;
  hasLast: boolean;
  /** Gait cycle (0..1, by distance) and what the pose shows. */
  phase: number;
  gait: Gait;
  mode: PetMode;
  /** A poof is owed, waiting for the rider to land (never into the air). */
  owed: boolean;
}

export function newPetBody(x = 0, y = 0, z = 0): PetBody {
  return {
    x,
    y,
    z,
    yaw: 0,
    vy: 0,
    speed: 0,
    grounded: true,
    side: 1,
    stuck: 0,
    idle: 0,
    happy: 0,
    ownerGround: 0,
    lastX: 0,
    lastY: 0,
    lastZ: 0,
    hasLast: false,
    phase: 0,
    gait: 'idle',
    mode: 'beside',
    owed: false,
  };
}

// ── Which mode ──────────────────────────────────────────────────────────

/** What's going on round the rider (Game reads it each frame). */
export interface PetContext {
  /** In a car or the van. */
  vehicle: boolean;
  /** Hoops, a battle, pool, freestyle, a parkour route, mural: sit and watch. */
  busy: boolean;
  /** The Big Drop, a skydive, a cutscene: not there. */
  away: boolean;
  /** A parkour move (wall run, ledge, pole): hold on to the head. */
  parkour: boolean;
}

export type Pref = 'auto' | 'head' | 'beside' | 'fly';

export function chooseMode(
  ctx: PetContext,
  pref: Pref,
  o: Pick<Owner, 'onBoard' | 'speed'>,
): PetMode {
  if (ctx.away) return 'away';
  if (ctx.vehicle) return 'ride';
  if (ctx.busy) return 'watch';
  if (ctx.parkour) return 'head';
  if (pref !== 'auto') return pref;
  return o.onBoard && o.speed > PET.flyAbove ? 'fly' : 'beside';
}

// ── Where it wants to be ────────────────────────────────────────────────

const _t = { x: 0, y: 0, z: 0, ok: false };

/**
 * The spot beside (or, `up`, flying by the head of) the rider on `side`,
 * pulled in toward the rider until the way from their body is clear. For
 * the ground spot, `ok` = there's ground under it within a step or a hop.
 */
export function spotBeside(o: Owner, side: number, w: PetWorld, fly: boolean) {
  const rx = -o.fz * side;
  const rz = o.fx * side;
  const sideOff = fly ? PET.flySide : PET.besideSide;
  const back = fly ? PET.flyBack : PET.besideBack;
  const fromY = fly ? o.headTop - 0.25 : o.y + 0.45;
  const toY = fly ? o.headTop + PET.flyUp : o.y + 0.45;
  let tx = o.x + rx * sideOff - o.fx * back;
  let tz = o.z + rz * sideOff - o.fz * back;
  const f = w.clear(o.x, fromY, o.z, tx, toY, tz);
  if (f < 1) {
    // keep the pet's body clear of whatever stopped the sweep
    const len = Math.hypot(tx - o.x, tz - o.z);
    const k = Math.max(0, (f * len - PET.radius - 0.05) / Math.max(len, 1e-6));
    tx = o.x + (tx - o.x) * k;
    tz = o.z + (tz - o.z) * k;
  }
  _t.x = tx;
  _t.z = tz;
  if (fly) {
    _t.y = o.y + (toY - o.y) * Math.min(1, f + 0.001);
    _t.ok = true;
    return _t;
  }
  const g = w.ground(tx, o.y + 0.6, tz, 1.6);
  _t.ok = g !== null;
  _t.y = g ?? o.y;
  return _t;
}

// ── One step ────────────────────────────────────────────────────────────

export type PetEvent = 'poof' | 'hop' | 'happy' | 'sleep' | null;

const GRAV = 18;
const STEP_UP = 0.32;
/** The body's middle over the feet (the height the pushout keeps clear). */
const BODY_Y = 0.26;
const HOP_DOWN = 1.25;

/** Put the pet straight down beside the rider (a poof): always somewhere valid. */
export function poofTo(b: PetBody, o: Owner, w: PetWorld) {
  let s = spotBeside(o, b.side, w, false);
  if (!s.ok) s = spotBeside(o, -b.side, w, false);
  if (s.ok) {
    b.x = s.x;
    b.y = s.y;
    b.z = s.z;
  } else {
    // no room beside: at the rider's feet, just behind
    b.x = o.x - o.fx * 0.3;
    b.z = o.z - o.fz * 0.3;
    b.y = w.ground(b.x, o.y + 0.6, b.z, 1.6) ?? o.y;
  }
  b.vy = 0;
  b.stuck = 0;
  b.grounded = true;
  b.yaw = Math.atan2(o.fx, o.fz);
  b.happy = PET.happyFor;
}

/**
 * Advance the pet by dt for this mode (`ride` and `perch` are placed by the
 * game; `away` is hidden). Returns what happened (sounds, the poof puff).
 */
export function stepPet(b: PetBody, o: Owner, mode: PetMode, w: PetWorld, dt: number): PetEvent {
  let ev: PetEvent = null;
  const prevMode = b.mode;
  // Teleports: the rider moved further in a frame than anyone can
  const step = b.hasLast ? Math.hypot(o.x - b.lastX, o.y - b.lastY, o.z - b.lastZ) : 0;
  const jumped = step > PET.teleport;
  // the rider's speed as measured (what Player reports can lag a ride, a push)
  const ownerSpeed =
    !b.hasLast || jumped
      ? o.speed
      : Math.max(o.speed, Math.hypot(o.x - b.lastX, o.z - b.lastZ) / Math.max(dt, 1e-6));
  b.lastX = o.x;
  b.lastY = o.y;
  b.lastZ = o.z;
  b.hasLast = true;
  b.ownerGround = o.grounded ? b.ownerGround + dt : 0;
  // Idle → sit → sleep; coming back from a nap is a happy moment
  const wasAsleep = b.idle > PET.sleepAfter;
  b.idle = ownerSpeed < 0.3 ? b.idle + dt : 0;
  if (wasAsleep && b.idle === 0) {
    b.happy = PET.happyFor;
    ev = 'happy';
  }
  if (!wasAsleep && b.idle > PET.sleepAfter) ev = 'sleep';
  b.happy = Math.max(0, b.happy - dt);
  b.mode = mode;

  if (mode === 'away' || mode === 'ride' || mode === 'perch') {
    b.gait = mode === 'perch' ? 'sleep' : mode === 'ride' ? 'ride' : 'idle';
    return ev;
  }
  // Back from somewhere (away, a ride), or the rider teleported: straight
  // to them, once they're stood on something
  if (prevMode === 'away' || prevMode === 'ride' || prevMode === 'perch' || jumped) b.owed = true;
  if (b.owed && o.grounded) {
    b.owed = false;
    poofTo(b, o, w);
    return 'poof';
  }
  if (prevMode === 'watch' && mode !== 'watch') {
    b.happy = PET.happyFor;
    ev = 'happy';
  }

  if (mode === 'head') {
    // sat on the head, unless there's a ceiling right over it
    const room = w.clear(o.x, o.headTop + 0.02, o.z, o.x, o.headTop + PET.height + 0.05, o.z);
    if (room >= 1) {
      b.x = o.x;
      b.y = o.headTop;
      b.z = o.z;
      b.vy = 0;
      b.speed = o.speed;
      b.yaw = Math.atan2(o.fx, o.fz);
      b.grounded = true;
      b.stuck = 0;
      b.gait = b.happy > 0 ? 'happy' : 'perch';
      return ev;
    }
    mode = 'beside';
  }

  if (mode === 'fly') {
    const s = spotBeside(o, b.side, w, true);
    const k = 1 - Math.exp(-10 * dt);
    let nx = b.x + (s.x - b.x) * k;
    let ny = b.y + (s.y - b.y) * k;
    let nz = b.z + (s.z - b.z) * k;
    // the move itself must be clear too; if not, take the checked spot
    if (w.clear(b.x, b.y + 0.25, b.z, nx, ny + 0.25, nz) < 1) {
      nx = s.x;
      ny = s.y;
      nz = s.z;
    }
    // and keep the body off any face it's brushing
    const [px, pz] = w.pushout(nx, ny + 0.2, nz, PET.radius);
    nx += px;
    nz += pz;
    const moved = Math.hypot(nx - b.x, nz - b.z);
    b.speed = moved / Math.max(dt, 1e-6);
    if (moved > 0.01) b.yaw = Math.atan2(nx - b.x, nz - b.z);
    else b.yaw = Math.atan2(o.fx, o.fz);
    b.x = nx;
    b.y = ny;
    b.z = nz;
    b.vy = 0;
    b.grounded = false;
    b.stuck = 0;
    b.phase = (b.phase + dt * 2.6) % 1;
    b.gait = b.happy > 0 ? 'happy' : 'fly';
    if (Math.hypot(o.x - b.x, o.y - b.y, o.z - b.z) > PET.poofFar) {
      poofTo(b, o, w);
      return 'poof';
    }
    return ev;
  }

  // ── On the ground: beside, or watching from where it is ─────────────
  const watching = mode === 'watch';
  let tx = b.x;
  let tz = b.z;
  if (!watching) {
    let s = spotBeside(o, b.side, w, false);
    if (!s.ok) {
      const other = spotBeside(o, -b.side, w, false);
      if (other.ok) {
        b.side = -b.side;
        s = other;
      }
    }
    tx = s.ok ? s.x : o.x - o.fx * 0.4;
    tz = s.ok ? s.z : o.z - o.fz * 0.4;
  }
  const dx = tx - b.x;
  const dz = tz - b.z;
  const dist = Math.hypot(dx, dz);
  const cap = dist > 4 ? PET.sprint : Math.max(PET.run, ownerSpeed * 1.15);
  const sp = dist < 0.12 ? 0 : Math.min(cap, dist * 2.4 + ownerSpeed * 0.9 + 0.4);
  let mx = dist > 1e-6 ? (dx / dist) * sp * dt : 0;
  let mz = dist > 1e-6 ? (dz / dist) * sp * dt : 0;
  if (Math.hypot(mx, mz) > dist) {
    mx = dx;
    mz = dz;
  }
  // a sweep just over step height, one radius past where it's going
  // (anything lower it steps up onto)
  const knee = b.y + STEP_UP + 0.05;
  const sweep = (ax: number, az: number) => {
    const len = Math.hypot(ax, az);
    if (len < 1e-6) return true;
    const ex = ax + (ax / len) * PET.radius;
    const ez = az + (az / len) * PET.radius;
    return w.clear(b.x, knee, b.z, b.x + ex, knee, b.z + ez) >= 1;
  };
  if (!sweep(mx, mz)) {
    // slide along whatever's there
    if (Math.abs(mx) > 1e-6 && sweep(mx, 0)) mz = 0;
    else if (Math.abs(mz) > 1e-6 && sweep(0, mz)) mx = 0;
    else {
      mx = 0;
      mz = 0;
    }
  }
  let nx = b.x + mx;
  let nz = b.z + mz;
  // Ground under the new spot: a step up, a hop down, never off a cliff.
  // Probed at the centre and at the leading edge, so it's up on a kerb
  // before its middle gets there.
  const lead = Math.hypot(mx, mz);
  const groundAt = (x: number, z: number): number | null => {
    const c = w.ground(x, b.y + STEP_UP, z, HOP_DOWN + STEP_UP);
    if (c === null || lead < 1e-6) return c;
    const e = w.ground(
      x + (mx / lead) * PET.radius * 0.8,
      b.y + STEP_UP,
      z + (mz / lead) * PET.radius * 0.8,
      HOP_DOWN + STEP_UP,
    );
    return e !== null && e > c ? e : c;
  };
  let g = groundAt(nx, nz);
  if (g === null) {
    nx = b.x;
    nz = b.z;
    g = groundAt(nx, nz);
  }
  // Never inside a wall or furniture: push the body (at body height) out,
  // but never off an edge (the push is dropped if there's no floor there)
  const [px, pz] = w.pushout(nx, Math.max(b.y, g ?? b.y) + BODY_Y, nz, PET.radius);
  if (px !== 0 || pz !== 0) {
    const pg = w.ground(nx + px, Math.max(b.y, g ?? b.y) + STEP_UP, nz + pz, HOP_DOWN + STEP_UP);
    if (pg !== null) {
      nx += px;
      nz += pz;
      g = pg;
    } else {
      nx = b.x;
      nz = b.z;
    }
  }
  if (g !== null && g > b.y + 0.12 && b.grounded) ev = ev ?? 'hop';
  // fall to it (a hop down), or stand on it; with no floor in reach at all
  // it stays put (and a poof sorts it out), it never drops into the void
  if (g === null) {
    b.vy = 0;
    b.grounded = true;
  } else if (b.y > g + 0.02) {
    b.vy -= GRAV * dt;
    b.y = Math.max(g, b.y + b.vy * dt);
    b.grounded = b.y <= g + 1e-4;
    if (b.grounded) b.vy = 0;
  } else {
    b.y = g;
    b.vy = 0;
    b.grounded = true;
  }
  const moved = Math.hypot(nx - b.x, nz - b.z);
  b.speed = moved / Math.max(dt, 1e-6);
  b.phase = (b.phase + moved / strideOf(b.speed)) % 1;
  if (moved > 0.004) b.yaw = Math.atan2(nx - b.x, nz - b.z);
  else if (watching || dist < 0.3) b.yaw = Math.atan2(o.x - b.x, o.z - b.z);
  b.x = nx;
  b.z = nz;

  // stuck: far from where it wants to be and not getting closer
  const after = Math.hypot(tx - b.x, tz - b.z);
  if (!watching && dist > 2.5 && dist - after < 0.25 * dt) b.stuck += dt;
  else b.stuck = Math.max(0, b.stuck - dt * 2);

  b.gait = gaitOf(b, watching);
  if (!watching && shouldPoof(b, o)) {
    b.owed = false;
    poofTo(b, o, w);
    return 'poof';
  }
  return ev;
}

function strideOf(speed: number): number {
  return speed > 4.5 ? 0.9 : speed > 1.8 ? 0.55 : 0.32;
}

export function gaitOf(b: PetBody, watching: boolean): Gait {
  if (b.happy > 0) return 'happy';
  if (!b.grounded) return 'hop';
  if (b.speed > 4.5) return 'run';
  if (b.speed > 1.8) return 'trot';
  if (b.speed > 0.25) return 'walk';
  if (b.idle > PET.sleepAfter) return 'sleep';
  if (watching || b.idle > PET.sitAfter) return 'sit';
  return 'idle';
}

/** Left behind: too far, stuck, or stood above / below a rider who's landed. */
export function shouldPoof(b: PetBody, o: Owner): boolean {
  // never to a rider in the air (a jump, a fall): it waits till they land
  if (!o.grounded) return false;
  if (Math.hypot(o.x - b.x, o.y - b.y, o.z - b.z) > PET.poofFar) return true;
  if (b.stuck > PET.stuckFor) return true;
  return b.ownerGround > 0.4 && Math.abs(o.y - b.y) > PET.poofDrop;
}
