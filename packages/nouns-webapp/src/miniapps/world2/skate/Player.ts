// ── Player controller — on-foot movement + skateboard physics ───────────
//
// Kinematic controller over the static BVH. The board is a point on the
// surface with an orientation frame (fwd, up). Grounded motion follows the
// surface (incl. quarter-pipe transitions), lips turn into vert airs, rails
// snap into grinds, and landings are judged on flip completion + alignment.

import type { InputFrame, TrickInput } from '../core/Input';
import type { CollisionWorld } from '../physics/Collision';
import type { Rail, RailSet } from '../physics/Rails';

import * as THREE from 'three';

import {
  FLIPS,
  addRunning,
  addTrick,
  airTrickName,
  chainedFlipName,
  bailCombo,
  bankCombo,
  createCombo,
  grindName,
  spinPoints,
  type ComboState,
} from './Tricks';

export type PlayerMode = 'foot' | 'board';
export type BoardState = 'ground' | 'air' | 'grind' | 'manual' | 'bail';

export type PlayerEvent =
  | { type: 'pop'; strength: number }
  | { type: 'land'; impact: number; clean: boolean }
  | { type: 'push' }
  | { type: 'grindStart'; railType: string }
  | { type: 'grindEnd' }
  | { type: 'bail'; impact: number }
  | { type: 'flip' }
  | { type: 'footJump' }
  | { type: 'footLand'; impact: number }
  | { type: 'boardOn' }
  | { type: 'boardOff' }
  | { type: 'climbStart' }
  | { type: 'mantle' }
  | { type: 'wallJump' }
  | { type: 'trick'; name: string; points: number };

export interface PlayerTuning {
  gravity: number;
  pushAccel: number;
  maxPushSpeed: number;
  maxSpeed: number;
  rollingFriction: number;
  drag: number;
  turnRate: number;
  popSpeed: number;
  grip: number;
  walkSpeed: number;
  runSpeed: number;
  jumpSpeed: number;
}

/** What the player needs from the endless terrain. */
export interface PlayerTerrain {
  height(x: number, z: number): number;
  inDomain(x: number, z: number): boolean;
  surface(x: number, z: number): 'track' | 'grass' | 'alley' | null;
  /**
   * Speed governor (m/s) for a rider rolling at (x, y, z), Infinity = none.
   * Where it's finite (set pieces built for the city, i.e. the mega ramps)
   * the board also rides with the city's friction and drag, no streak.
   */
  speedLimit?(x: number, y: number, z: number): number;
}

/**
 * Mountain speed model (see Player.run): air drag ∝ v² divided by
 * (1 + run / RUN_DRAG_K), so terminal velocity keeps rising the longer you
 * ride without bailing. No hard top speed.
 */
const RUN_DRAG_K = 400;
/** Extra acceleration (m/s²) per minute of unbroken mountain riding. */
const STREAK_ACCEL = 0.35;

export const DEFAULT_TUNING: PlayerTuning = {
  gravity: 12.5,
  pushAccel: 5.2,
  maxPushSpeed: 8.6,
  maxSpeed: 17,
  rollingFriction: 0.18,
  drag: 0.0035,
  turnRate: 2.5,
  popSpeed: 4.3,
  grip: 14,
  walkSpeed: 1.9,
  runSpeed: 5.2,
  jumpSpeed: 5.0,
};

const UP = new THREE.Vector3(0, 1, 0);
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();

const BODY_RADIUS = 0.32;
const PUSH_CYCLE = 0.9;

// ── Climbing ──
/** Horizontal gap kept between the player's origin and the wall face. */
const CLIMB_DIST = 0.52;
/** Probe heights above the feet: chest (stick) + hands (top-out). */
const CLIMB_CHEST = 1.05;
const CLIMB_HANDS = 1.75;
const CLIMB_UP = 2.5;
const CLIMB_UP_FAST = 3.6;
const CLIMB_DOWN = 3.2;
const CLIMB_SIDE = 2.1;
const MANTLE_TIME = 0.55;
/** Seconds of walking into a wall before you grab it (jumping in is instant). */
const WALL_PUSH_GRAB = 0.12;

export interface ClimbState {
  /** Horizontal unit wall normal (points out of the wall, toward the player). */
  normal: THREE.Vector3;
  /** Gait phase (radians) — advances with distance climbed. */
  phase: number;
  /** 0..1 how fast we're moving on the wall (for anim). */
  moving: number;
  /** Active top-out: start + end positions and progress (s). */
  mantle: { from: THREE.Vector3; to: THREE.Vector3; t: number } | null;
}

export interface FlipState {
  trick: TrickInput;
  t: number;
  duration: number;
  roll: number;
  spin: number;
}

export interface GrindState {
  rail: Rail;
  s: number;
  dir: 1 | -1;
  speed: number;
  type: 'fiftyfifty' | 'fivezero' | 'nosegrind' | 'boardslide' | 'lipslide' | 'crooked';
  /** Board yaw offset relative to the rail tangent (0 = parallel, ±π/2 = slide). */
  yawOffset: number;
  time: number;
}

export class Player {
  mode: PlayerMode = 'board';
  state: BoardState = 'ground';
  tuning: PlayerTuning = { ...DEFAULT_TUNING };

  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  /** Board nose direction (unit, tangent to surface when grounded). */
  fwd = new THREE.Vector3(0, 0, 1);
  /** Board up / surface normal. */
  up = new THREE.Vector3(0, 1, 0);
  /** On-foot facing yaw. */
  footYaw = 0;
  footGrounded = true;

  crouch = 0;
  pushTimer = -1;
  pushQueued = false;
  powerslide = 0;
  manualBalance = 0;
  manualPitch = 0;
  lean = 0;
  airTime = 0;
  airYaw = 0;
  popKind: 'ollie' | 'nollie' = 'ollie';
  takeoffFakie = false;
  flip: FlipState | null = null;
  flipDone: TrickInput | null = null;
  /** Every flip completed this jump, in order (double/triple kickflips…). */
  private airFlips: TrickInput[] = [];
  /** Flips pressed while one is still turning: each starts as the last ends. */
  private queuedFlips: TrickInput[] = [];
  grab: string | null = null;
  grabTime = 0;
  grind: GrindState | null = null;
  grindCooldown = 0;
  bailTimer = 0;
  /** Loose board (during bail): position, velocity, rotation. */
  looseBoard = {
    pos: new THREE.Vector3(),
    vel: new THREE.Vector3(),
    quat: new THREE.Quaternion(),
    spin: new THREE.Vector3(),
  };
  /** Board visual offsets (relative to the rider frame). */
  boardFlipQuat = new THREE.Quaternion();
  boardLift = 0;
  /** Seconds since last landing — used for land anim. */
  sinceLand = 10;
  lastLandImpact = 0;
  vertLip = false;
  fakie = false;
  /** Visual kickturn/revert spin remaining (radians), decays to 0. */
  kickturn = 0;
  emote = 0;
  emoteTimer = 0;

  /** Non-null while stuck to a wall (always on foot). */
  climb: ClimbState | null = null;
  private climbCooldown = 0;
  private wallPush = 0;
  /** |x|, |z| clamp for the play area (replaces invisible boundary walls). */
  softBounds = Infinity;
  /**
   * Endless mountain all round the city: where the clamp lets you through
   * the ring (the alley corridors), and the |x| / |z| past which you're out
   * on the slope (no clamp).
   */
  mountain: { inCorridor: (x: number, z: number) => boolean; minZ: number } | null = null;
  /** Analytic ground (mountain) for fall-out checks, rescue + surface friction. */
  terrain: PlayerTerrain | null = null;
  /**
   * Distance (m) ridden on the mountain since you last fell off. Air drag
   * eases off as it grows, so the longer you stay on, the faster you go —
   * with no top speed. Reset by bails, respawns and stepping off the board.
   */
  run = 0;
  /** Seconds ridden on the mountain since you last fell off. */
  runTime = 0;
  /** Surface under the board right now (for HUD / audio). */
  surface: 'track' | 'grass' | 'alley' | null = null;

  combo: ComboState = createCombo();
  events: PlayerEvent[] = [];
  /** Last safe grounded spot for respawn after bails / falling out. */
  safePos = new THREE.Vector3();
  safeFwd = new THREE.Vector3(0, 0, 1);

  constructor(
    private world: CollisionWorld,
    private rails: RailSet,
  ) {}

  spawn(p: THREE.Vector3, yaw: number) {
    this.pos.copy(p);
    this.vel.set(0, 0, 0);
    this.fwd.set(Math.sin(yaw), 0, Math.cos(yaw));
    this.up.copy(UP);
    this.footYaw = yaw;
    this.state = 'ground';
    this.grind = null;
    this.flip = null;
    this.climb = null;
    this.crouch = 0;
    this.safePos.copy(p);
    this.safeFwd.copy(this.fwd);
    // Settle onto ground
    const hit = this.world.raycast(_v.copy(p).addScaledVector(UP, 2), _v2.set(0, -1, 0), 10);
    if (hit) this.pos.copy(hit.point);
  }

  get speed() {
    return this.vel.length();
  }

  /** Signed speed along the board's nose direction. */
  get forwardSpeed() {
    return this.vel.dot(this.fwd);
  }

  get side() {
    return _v3.crossVectors(this.up, this.fwd).normalize();
  }

  // ── Frame update ────────────────────────────────────────────────────

  update(dt: number, input: InputFrame, camYaw: number, now: number) {
    this.events.length = 0;
    this.grindCooldown = Math.max(0, this.grindCooldown - dt);
    this.climbCooldown = Math.max(0, this.climbCooldown - dt);
    this.sinceLand += dt;
    if (this.emoteTimer > 0) {
      this.emoteTimer -= dt;
      if (this.emoteTimer <= 0) this.emote = 0;
    }

    if (
      input.boardTogglePressed &&
      this.state !== 'bail' &&
      this.state !== 'air' &&
      this.state !== 'grind' &&
      this.climb === null
    ) {
      this.toggleBoard();
    }

    if (this.mode === 'foot') {
      if (this.climb !== null) this.updateClimb(dt, input);
      else this.updateFoot(dt, input, camYaw);
      this.clampBounds();
      this.terrainRescue();
      if (this.fellOut()) this.respawnSafe();
      if (input.respawnPressed) this.respawnHome();
      return;
    }

    switch (this.state) {
      case 'ground':
      case 'manual':
        this.updateGround(dt, input, now);
        break;
      case 'air':
        this.updateAir(dt, input, now);
        break;
      case 'grind':
        this.updateGrind(dt, input, now);
        break;
      case 'bail':
        this.updateBail(dt);
        break;
    }

    // Ride streak on the mountain (anything but a bail keeps it going)
    if (
      this.state !== 'bail' &&
      this.terrain !== null &&
      this.terrain.inDomain(this.pos.x, this.pos.z)
    ) {
      this.run += this.speed * dt;
      this.runTime += dt;
    }

    // Board flip visuals
    this.updateFlipVisual(dt);

    this.clampBounds();
    this.terrainRescue();
    // Fell out of the world → respawn
    if (this.fellOut()) this.respawnSafe();
    if (input.respawnPressed) this.respawnHome();
  }

  /** Lowest walkable floor under (x, z): the terrain on the mountain, else the plaza. */
  floorAt(x: number, z: number): number {
    const t = this.terrain;
    if (t !== null && t.inDomain(x, z)) return Math.min(0, t.height(x, z));
    return 0;
  }

  /** Out of the world = well below whatever ground is under you (not a fixed y). */
  private fellOut() {
    return this.pos.y < this.floorAt(this.pos.x, this.pos.z) - 30;
  }

  /**
   * Never end up inside the mountain (e.g. a huge-speed step skimming a
   * crest): pop back onto the surface, keeping the tangential speed.
   */
  private terrainRescue() {
    const t = this.terrain;
    if (t === null || this.climb !== null) return;
    const p = this.pos;
    if (!t.inDomain(p.x, p.z)) return;
    const h = t.height(p.x, p.z);
    if (p.y < h - 0.25) {
      p.y = h;
      if (this.vel.y < 0) this.vel.y = 0;
      if (this.mode === 'foot') this.footGrounded = true;
    }
  }

  toggleBoard() {
    if (this.mode === 'board') {
      this.mode = 'foot';
      this.footYaw = Math.atan2(this.fwd.x, this.fwd.z);
      // Hop off — keep a bit of momentum
      this.vel.multiplyScalar(0.4);
      this.vel.y = 0;
      this.up.copy(UP);
      this.state = 'ground';
      this.run = 0;
      this.runTime = 0;
      bankCombo(this.combo, performance.now());
      this.events.push({ type: 'boardOff' });
    } else {
      this.mode = 'board';
      this.state = 'ground';
      this.fwd.set(Math.sin(this.footYaw), 0, Math.cos(this.footYaw));
      const hv = _v.copy(this.vel).setY(0);
      this.vel.copy(this.fwd).multiplyScalar(Math.max(0, hv.dot(this.fwd)));
      this.events.push({ type: 'boardOn' });
    }
  }

  /** Landmarks R takes you back to (noggles fountain, ice cream van). */
  homeSpots: { pos: THREE.Vector3; yaw: number }[] = [];

  /** R: back to the nearest landmark, or the last safe spot if none. */
  respawnHome() {
    let best: { pos: THREE.Vector3; yaw: number } | null = null;
    for (const h of this.homeSpots)
      if (best === null || h.pos.distanceToSquared(this.pos) < best.pos.distanceToSquared(this.pos))
        best = h;
    if (best !== null) {
      this.safePos.copy(best.pos);
      this.safeFwd.set(Math.sin(best.yaw), 0, Math.cos(best.yaw));
    }
    this.respawnSafe();
  }

  respawnSafe() {
    this.mode = 'board';
    this.state = 'ground';
    this.climb = null;
    this.pos.copy(this.safePos);
    this.vel.set(0, 0, 0);
    this.run = 0;
    this.runTime = 0;
    this.fwd.copy(this.safeFwd);
    this.up.copy(UP);
    this.grind = null;
    this.flip = null;
    this.bailTimer = 0;
    this.combo.entries = [];
    this.combo.running = 0;
    this.combo.total = 0;
    this.combo.multiplier = 0;
  }

  // ── On foot ─────────────────────────────────────────────────────────

  private updateFoot(dt: number, input: InputFrame, camYaw: number) {
    const t = this.tuning;
    const mag = Math.min(1, Math.hypot(input.moveX, input.moveY));
    const target = _v.set(0, 0, 0);
    if (mag > 0.05) {
      // Camera-relative: forward = camera look direction projected on ground
      const fx = Math.sin(camYaw);
      const fz = Math.cos(camYaw);
      target
        .set(fx * input.moveY - fz * input.moveX, 0, fz * input.moveY + fx * input.moveX)
        .normalize();
      const speed = (input.sprint ? t.runSpeed * 1.25 : mag > 0.7 ? t.runSpeed : t.walkSpeed) * mag;
      target.multiplyScalar(speed);
      const desiredYaw = Math.atan2(target.x, target.z);
      this.footYaw = lerpAngle(this.footYaw, desiredYaw, 1 - Math.exp(-12 * dt));
    }
    const accel = this.footGrounded ? 18 : 5;
    const hv = _v2.set(this.vel.x, 0, this.vel.z);
    // Airborne with no stick input keeps its momentum (wall jumps carry)
    if (this.footGrounded || mag > 0.05) hv.lerp(target, 1 - Math.exp(-accel * dt * 0.6));
    this.vel.x = hv.x;
    this.vel.z = hv.z;

    if (this.footGrounded && input.jumpPressed) {
      this.vel.y = t.jumpSpeed;
      this.footGrounded = false;
      this.events.push({ type: 'footJump' });
    }
    this.vel.y -= t.gravity * dt;
    this.pos.addScaledVector(this.vel, dt);

    // Walls — walk or jump into one to grab it
    const wantX = target.x;
    const wantZ = target.z;
    const wall = this.resolveBody(1.4);
    if (wall !== null && mag > 0.3) {
      const into = -(wantX * wall.x + wantZ * wall.z) / Math.max(1e-4, Math.hypot(wantX, wantZ));
      if (into > 0.55) this.wallPush += dt;
      else this.wallPush = 0;
      if (
        (!this.footGrounded || this.wallPush > WALL_PUSH_GRAB) &&
        into > 0.55 &&
        this.tryStartClimb(wall)
      )
        return;
    } else {
      this.wallPush = 0;
    }

    // Ground
    const wasGrounded = this.footGrounded;
    const hit = this.world.raycast(
      _v.copy(this.pos).addScaledVector(UP, 0.6),
      _v2.set(0, -1, 0),
      0.6 + (wasGrounded ? 0.35 : 0.05),
    );
    if (hit && hit.normal.y > 0.55 && this.vel.y <= 0.5) {
      if (!wasGrounded && this.vel.y < -3)
        this.events.push({ type: 'footLand', impact: -this.vel.y });
      this.pos.y = hit.point.y;
      this.vel.y = 0;
      this.footGrounded = true;
      this.safePos.copy(this.pos);
      this.safeFwd.set(Math.sin(this.footYaw), 0, Math.cos(this.footYaw));
    } else {
      this.footGrounded = false;
    }
    if (input.emotePressed) {
      this.emote = input.emotePressed;
      this.emoteTimer = 4;
    }
    if (mag > 0.05 || !this.footGrounded) {
      this.emote = 0;
      this.emoteTimer = 0;
    }
  }

  // ── Climbing ────────────────────────────────────────────────────────

  private clampBounds() {
    const b = this.softBounds;
    if (!Number.isFinite(b)) return;
    const p = this.pos;
    const m = this.mountain;
    if (m !== null) {
      // Out on the slopes: free to roam (the city wall keeps you off its back)
      if (Math.max(Math.abs(p.x), Math.abs(p.z)) >= m.minZ) return;
      // Through an alley corridor (its walls are real geometry)
      if (m.inCorridor(p.x, p.z)) return;
      // Between the ring and the slope, outside a corridor: back to the
      // nearer side (the plaza, or down onto the mountain)
      const mid = (b + m.minZ) / 2;
      if (Math.abs(p.x) > b) {
        p.x = Math.sign(p.x) * (Math.abs(p.x) > mid ? m.minZ : b);
        this.vel.x = 0;
      }
      if (Math.abs(p.z) > b) {
        p.z = Math.sign(p.z) * (Math.abs(p.z) > mid ? m.minZ : b);
        this.vel.z = 0;
      }
      return;
    }
    if (Math.abs(p.x) > b) {
      p.x = Math.sign(p.x) * b;
      this.vel.x = 0;
    }
    if (Math.abs(p.z) > b) {
      p.z = Math.sign(p.z) * b;
      this.vel.z = 0;
    }
  }

  /**
   * Steep wall hit looking into -n from `at` + height (+ optional sideways
   * offset along the wall). Null when there's no wall-like surface there.
   */
  private wallProbe(at: THREE.Vector3, n: THREE.Vector3, height: number, side = 0) {
    const o = _v.copy(at).addScaledVector(UP, height).addScaledVector(n, 0.55);
    if (side !== 0) o.addScaledVector(_v3.set(n.z, 0, -n.x), side);
    const hit = this.world.raycast(o, _v2.copy(n).negate(), CLIMB_DIST + 1.1);
    if (hit === null || Math.abs(hit.normal.y) > 0.45) return null;
    return hit;
  }

  /** A flat-enough, tall-enough wall to climb in front of us along -n? */
  private canClimb(wallN: THREE.Vector3) {
    if (this.climbCooldown > 0 || Math.abs(wallN.y) > 0.3) return false;
    const n = new THREE.Vector3(wallN.x, 0, wallN.z);
    if (n.lengthSq() < 1e-4) return false;
    n.normalize();
    // Needs wall at chest and above the head (a knee-high ledge isn't a
    // climb), and flat across the shoulders (poles, trunks and lamp posts
    // aren't walls).
    const chest = this.wallProbe(this.pos, n, CLIMB_CHEST);
    if (chest === null) return false;
    const cn = chest.normal.clone();
    if (this.wallProbe(this.pos, n, 2.2) === null) return false;
    const l = this.wallProbe(this.pos, n, CLIMB_CHEST, -0.32);
    if (l === null || l.normal.dot(cn) < 0.85) return false;
    const r = this.wallProbe(this.pos, n, CLIMB_CHEST, 0.32);
    return r !== null && r.normal.dot(cn) > 0.85;
  }

  private tryStartClimb(wallN: THREE.Vector3): boolean {
    if (!this.canClimb(wallN)) return false;
    const n = new THREE.Vector3(wallN.x, 0, wallN.z).normalize();
    const hit = this.wallProbe(this.pos, n, CLIMB_CHEST);
    if (hit === null) return false;
    n.set(hit.normal.x, 0, hit.normal.z).normalize();
    this.climb = { normal: n, phase: 0, moving: 0, mantle: null };
    this.pos.x = hit.point.x + n.x * CLIMB_DIST;
    this.pos.z = hit.point.z + n.z * CLIMB_DIST;
    if (this.footGrounded) this.pos.y += 0.12;
    this.vel.set(0, 0, 0);
    this.footGrounded = false;
    this.wallPush = 0;
    this.footYaw = Math.atan2(-n.x, -n.z);
    this.emote = 0;
    this.emoteTimer = 0;
    this.events.push({ type: 'climbStart' });
    return true;
  }

  /** Let go of the wall with a velocity. */
  private releaseClimb(vel: THREE.Vector3, cooldown = 0.3) {
    this.climb = null;
    this.vel.copy(vel);
    this.footGrounded = false;
    this.climbCooldown = cooldown;
  }

  private updateClimb(dt: number, input: InputFrame) {
    const c = this.climb!;
    const n = c.normal;

    // Top-out: up over the lip, then in onto the roof
    if (c.mantle !== null) {
      const m = c.mantle;
      m.t += dt;
      const k = Math.min(1, m.t / MANTLE_TIME);
      const ky = easeInOut(Math.min(1, k / 0.6));
      const kh = easeInOut(Math.max(0, (k - 0.45) / 0.55));
      this.pos.set(
        THREE.MathUtils.lerp(m.from.x, m.to.x, kh),
        THREE.MathUtils.lerp(m.from.y, m.to.y, ky),
        THREE.MathUtils.lerp(m.from.z, m.to.z, kh),
      );
      c.phase += dt * 9;
      c.moving = 1;
      this.vel.set(0, 0, 0);
      if (k >= 1) {
        this.climb = null;
        this.footGrounded = true;
        this.climbCooldown = 0.25;
        this.safePos.copy(this.pos);
        this.safeFwd.set(Math.sin(this.footYaw), 0, Math.cos(this.footYaw));
      }
      return;
    }

    // Let go (board key) / wall jump
    if (input.boardTogglePressed) {
      this.releaseClimb(new THREE.Vector3().copy(n).multiplyScalar(1.5), 0.45);
      return;
    }
    if (input.jumpPressed) {
      this.releaseClimb(
        new THREE.Vector3().copy(n).multiplyScalar(6.2).addScaledVector(UP, 6.4),
        0.35,
      );
      this.footYaw = Math.atan2(n.x, n.z);
      this.events.push({ type: 'wallJump' });
      this.events.push({ type: 'footJump' });
      return;
    }

    const right = new THREE.Vector3(n.z, 0, -n.x);
    const upSpeed = input.moveY > 0 ? (input.sprint ? CLIMB_UP_FAST : CLIMB_UP) : CLIMB_DOWN;
    const dy = input.moveY * upSpeed * dt;
    const dx = input.moveX * CLIMB_SIDE * dt;
    const start = this.pos.clone();
    const next = this.pos.clone().addScaledVector(UP, dy).addScaledVector(right, dx);

    // Bottom: climbing down onto the ground hops you off
    if (dy < 0) {
      const g = this.world.raycast(_v.copy(next).addScaledVector(UP, 0.4), _v2.set(0, -1, 0), 0.42);
      if (g !== null && g.normal.y > 0.55) {
        this.pos.copy(next);
        this.pos.y = g.point.y;
        this.climb = null;
        this.footGrounded = true;
        this.vel.set(0, 0, 0);
        this.pos.addScaledVector(n, 0.06);
        this.climbCooldown = 0.5;
        this.events.push({ type: 'footLand', impact: 1 });
        return;
      }
    }

    // Inner corner: a wall right where we're shuffling → turn onto it
    if (Math.abs(dx) > 1e-5) {
      const side = this.world.raycast(
        _v.copy(next).addScaledVector(UP, CLIMB_CHEST),
        _v2.copy(right).multiplyScalar(Math.sign(dx)),
        CLIMB_DIST + 0.05,
      );
      if (side !== null && Math.abs(side.normal.y) < 0.45) {
        n.set(side.normal.x, 0, side.normal.z).normalize();
        next.copy(start);
      }
    }

    // Stick: chest probe
    let chest = this.wallProbe(next, n, CLIMB_CHEST);
    if (chest === null && Math.abs(dx) > 1e-5) {
      // Outer corner: wrap around onto the side face
      const dir = Math.sign(dx);
      const o = _v
        .copy(next)
        .addScaledVector(UP, CLIMB_CHEST)
        .addScaledVector(n, -(CLIMB_DIST + 0.35));
      const wrap = this.world.raycast(o, _v2.copy(right).multiplyScalar(-dir), 1.2);
      if (wrap !== null && Math.abs(wrap.normal.y) < 0.45) {
        n.set(wrap.normal.x, 0, wrap.normal.z).normalize();
        next.set(wrap.point.x, next.y, wrap.point.z).addScaledVector(n, CLIMB_DIST);
        chest = this.wallProbe(next, n, CLIMB_CHEST);
      }
      if (chest === null) {
        // No wrap: block the sideways move instead
        next.copy(start).addScaledVector(UP, dy);
        chest = this.wallProbe(next, n, CLIMB_CHEST);
      }
    }
    const hands = this.wallProbe(next, n, CLIMB_HANDS);

    // Top: hands over the lip while climbing up → mantle onto the roof
    if (hands === null && dy > 0) {
      const inside = _v
        .copy(next)
        .addScaledVector(n, -(CLIMB_DIST + 0.65))
        .addScaledVector(UP, CLIMB_HANDS + 1.2);
      const roof = this.world.raycast(inside, _v2.set(0, -1, 0), CLIMB_HANDS + 1.6);
      if (roof !== null && roof.normal.y > 0.7 && roof.point.y > next.y + 0.3) {
        const to = roof.point.clone();
        // Headroom on top?
        const clear = this.world.raycast(_v.copy(to).addScaledVector(UP, 0.1), UP, 1.6);
        if (clear === null) {
          c.mantle = { from: next.clone(), to, t: 0 };
          this.footYaw = Math.atan2(-n.x, -n.z);
          this.events.push({ type: 'mantle' });
          return;
        }
      }
    }
    if (chest === null && hands === null) {
      // Wall ran out (top with no roof, or a gap) → fall
      this.pos.copy(next);
      this.releaseClimb(new THREE.Vector3().copy(n).multiplyScalar(0.8), 0.4);
      return;
    }
    if (chest === null) {
      // Only hands on the wall: hold position instead of sliding off
      next.copy(start);
      chest = this.wallProbe(next, n, CLIMB_CHEST);
    }
    // Closest surface wins so cornices / trim bands push us out
    let stick = chest ?? hands!;
    if (hands !== null && chest !== null && hands.distance < chest.distance) stick = hands;
    const tn = new THREE.Vector3(stick.normal.x, 0, stick.normal.z);
    if (tn.lengthSq() > 1e-4) n.lerp(tn.normalize(), 1 - Math.exp(-14 * dt)).normalize();
    next.x = stick.point.x + n.x * CLIMB_DIST;
    next.z = stick.point.z + n.z * CLIMB_DIST;

    // Ceiling / overhang above the head blocks upward motion
    if (dy > 0) {
      const head = this.world.raycast(_v.copy(start).addScaledVector(UP, 1.5), UP, 0.45 + dy);
      if (head !== null && head.normal.y < -0.5) next.y = start.y;
    }

    this.pos.copy(next);
    this.vel.subVectors(next, start).divideScalar(Math.max(dt, 1e-4));
    this.footYaw = lerpAngle(this.footYaw, Math.atan2(-n.x, -n.z), 1 - Math.exp(-16 * dt));
    const moved = start.distanceTo(next);
    c.phase += moved * 3.4;
    c.moving = THREE.MathUtils.lerp(c.moving, moved > 1e-4 ? 1 : 0, 1 - Math.exp(-10 * dt));
  }

  /** Capsule pushout against walls. Returns the wall normal hit (if any). */
  private resolveBody(height: number): THREE.Vector3 | null {
    const up = this.mode === 'board' ? this.up : UP;
    const a = _v.copy(this.pos).addScaledVector(up, BODY_RADIUS + 0.28);
    const b = _v2.copy(this.pos).addScaledVector(up, height - BODY_RADIUS);
    const n = new THREE.Vector3();
    const corr = this.world.capsulePushout(a, b, BODY_RADIUS, n);
    if (corr.lengthSq() > 1e-8) {
      // Ignore floor-ish contacts here: the ground probe owns those.
      if (Math.abs(n.dot(up)) > 0.7) return null;
      this.pos.add(corr);
      const into = this.vel.dot(n);
      if (into < 0) this.vel.addScaledVector(n, -into);
      return n;
    }
    return null;
  }

  // ── Board: grounded ─────────────────────────────────────────────────

  private probeGround(maxDist: number) {
    // Centre probe along -up, plus nose/tail probes to smooth normals across edges.
    const origin = _v.copy(this.pos).addScaledVector(this.up, 0.5);
    const dir = _v2.copy(this.up).negate();
    const center = this.world.raycast(origin, dir, 0.5 + maxDist);
    if (!center) return null;
    const n = center.normal.clone();
    let count = 1;
    for (const off of [0.32, -0.32]) {
      const o = _v.copy(this.pos).addScaledVector(this.up, 0.5).addScaledVector(this.fwd, off);
      const h = this.world.raycast(o, dir, 0.5 + maxDist + 0.2);
      if (h && h.normal.dot(center.normal) > 0.6) {
        n.add(h.normal);
        count++;
      }
    }
    n.divideScalar(count).normalize();
    return { point: center.point, normal: n, raw: center.normal, distance: center.distance - 0.5 };
  }

  private updateGround(dt: number, input: InputFrame, now: number) {
    const t = this.tuning;
    const speed = this.speed;

    // Surface follow
    const snap = 0.08 + Math.min(0.35, speed * 0.03);
    const ground = this.probeGround(snap);
    // Convex edge (coping, kicker lip, ledge drop): if we're moving away
    // from the next surface we launch instead of wrapping around it.
    const launching =
      ground !== null && ground.raw.dot(this.up) < 0.93 && this.vel.dot(ground.raw) > 0.6;
    if (ground === null || ground.normal.dot(this.up) < 0.35 || launching) {
      this.leaveGround(now);
      return;
    }
    this.pos.copy(ground.point);
    const align = 1 - Math.exp(-22 * dt);
    this.up.lerp(ground.normal, align).normalize();
    // Re-orthonormalise fwd to the new up
    this.fwd.addScaledVector(this.up, -this.fwd.dot(this.up)).normalize();

    // Gravity along the surface
    const g = _v.set(0, -t.gravity, 0);
    g.addScaledVector(this.up, -g.dot(this.up));
    this.vel.addScaledVector(g, dt);
    // Keep velocity tangent
    this.vel.addScaledVector(this.up, -this.vel.dot(this.up));

    // Steering — carve the board and its velocity together.
    const steer = input.moveX;
    const sp = Math.max(0.5, speed);
    const turn =
      -steer *
      t.turnRate *
      (1.15 - Math.min(0.55, sp / 22)) *
      dt *
      (this.state === 'manual' ? 0.6 : 1);
    this.lean = THREE.MathUtils.lerp(
      this.lean,
      steer * Math.min(1, speed / 5),
      1 - Math.exp(-6 * dt),
    );
    if (Math.abs(turn) > 0) {
      _q.setFromAxisAngle(this.up, turn);
      this.fwd.applyQuaternion(_q);
      this.vel.applyQuaternion(_q);
    }

    // Wheel grip: lateral velocity bleeds off (powerslide reduces grip)
    const side = this.side;
    const lat = this.vel.dot(side);
    const brake = input.brake && this.state !== 'manual';
    const sliding = brake && speed > 3;
    this.powerslide = THREE.MathUtils.lerp(
      this.powerslide,
      sliding ? 1 : 0,
      1 - Math.exp(-10 * dt),
    );
    const grip = t.grip * (1 - this.powerslide * 0.85);
    this.vel.addScaledVector(side, -lat * (1 - Math.exp(-grip * dt)));

    // Fakie tracking: which way are we rolling relative to the nose?
    let fs = this.forwardSpeed;
    // Auto kickturn: whenever we end up rolling backwards (stalled on a ramp,
    // pushed back off a wall, slow zero-crossing over several frames…) spin
    // the board 180 so the rider always faces the way they're travelling.
    if (this.state === 'ground' && fs < -0.3) {
      this.fwd.negate();
      this.kickturn = Math.PI;
      fs = -fs;
    }
    if (Math.abs(fs) > 0.4) this.fakie = fs < 0;

    // Push
    const canPush = this.state === 'ground' && this.crouch < 0.2 && !brake;
    if (input.push && canPush && this.pushTimer < 0) {
      this.pushTimer = 0;
      this.events.push({ type: 'push' });
    }
    if (this.pushTimer >= 0) {
      this.pushTimer += dt;
      const ph = this.pushTimer / PUSH_CYCLE;
      if (ph > 0.25 && ph < 0.6 && Math.abs(fs) < t.maxPushSpeed) {
        const dir = this.fakie ? -1 : 1;
        // Standstill push still needs a direction
        this.vel.addScaledVector(this.fwd, dir * t.pushAccel * 2.6 * dt);
      }
      if (this.pushTimer >= PUSH_CYCLE) {
        this.pushTimer = input.push && canPush ? 0 : -1;
        if (this.pushTimer === 0) this.events.push({ type: 'push' });
      }
    }

    // Friction / braking. On the mountain the drag eases off the longer the
    // run (no hard top speed — it keeps building), grass is slower than the
    // dirt line, and brakes scale with speed so stopping still works at 60 m/s.
    const terr = this.terrain;
    const onMountain = terr !== null && terr.inDomain(this.pos.x, this.pos.z);
    this.surface = onMountain ? terr.surface(this.pos.x, this.pos.z) : null;
    // Set pieces built for the city's physics (the mega ramps) bring them
    // along on the mountain: city friction + drag, no streak, and their own
    // speed governor in place of the city's top speed
    const limit =
      onMountain && terr.speedLimit !== undefined
        ? terr.speedLimit(this.pos.x, this.pos.y, this.pos.z)
        : Infinity;
    const cityRide = !onMountain || limit < Infinity;
    let friction = t.rollingFriction;
    let drag = t.drag;
    let brakeK = 1;
    if (!cityRide) {
      // Ride streak: drag eases off with distance ridden, and a push from
      // behind grows with time on (+0.35 m/s² per minute), both since the
      // last bail. No top speed — only the emergent drag terminal velocity,
      // which keeps rising as the streak does.
      if (!brake && speed > 3) {
        const boost = STREAK_ACCEL * (this.runTime / 60);
        this.vel.addScaledVector(this.vel, (boost * dt) / speed);
      }
      drag = t.drag / (1 + this.run / RUN_DRAG_K);
      friction = 0.1;
      if (this.surface === 'grass') {
        friction += 1.1;
        drag *= 2.2;
      }
      brakeK = 1 + speed / 30;
    }
    const decel =
      friction +
      drag * speed * speed +
      (sliding ? 7.5 : brake ? 4.5 : 0) * brakeK +
      this.powerslide * 2 * brakeK;
    const newSpeed = Math.max(0, this.speed - decel * dt);
    if (this.speed > 1e-4) this.vel.multiplyScalar(newSpeed / this.speed);
    // The city keeps its top speed; the mountain has none (bar governed set pieces)
    const cap = onMountain ? limit : t.maxSpeed;
    if (this.speed > cap) this.vel.multiplyScalar(cap / this.speed);

    // Crouch (ollie load)
    this.crouch = THREE.MathUtils.lerp(this.crouch, input.crouch ? 1 : 0, 1 - Math.exp(-14 * dt));

    // Manual
    const wantManual = (input.manual || input.noseManual) && speed > 1.2 && !input.crouch;
    if (wantManual && this.state === 'ground') {
      this.state = 'manual';
      this.manualBalance = (Math.random() - 0.5) * 0.15;
      addTrick(this.combo, input.noseManual ? 'Nose Manual' : 'Manual', 100);
      this.pushTimer = -1;
    } else if (this.state === 'manual') {
      if (!wantManual) {
        this.state = 'ground';
        this.manualPitch = 0;
      } else {
        // Balance: drifts away from centre; player counters with moveY
        this.manualBalance += (this.manualBalance * 1.6 + (Math.random() - 0.5) * 0.4) * dt;
        this.manualBalance -= input.moveY * 1.4 * dt;
        addRunning(this.combo, 60 * dt);
        if (Math.abs(this.manualBalance) > 1) {
          this.doBail(now, 3);
          return;
        }
      }
    }
    const targetPitch = this.state === 'manual' ? (input.noseManual ? -0.22 : 0.24) : 0;
    this.manualPitch = THREE.MathUtils.lerp(this.manualPitch, targetPitch, 1 - Math.exp(-12 * dt));

    // Integrate
    this.pos.addScaledVector(this.vel, dt);

    // Walls — slam into them fast and you bail
    const wall = this.resolveBody(1.45);
    if (wall) {
      const impact = -this.vel.dot(wall);
      if (impact > 6.5) {
        this.doBail(now, impact);
        return;
      }
    }

    // Pop
    for (const tr of input.tricks) {
      if (this.state === 'ground' || this.state === 'manual') {
        this.pop(tr, now);
        return;
      }
    }

    // Safe spot for respawn (on the mountain at any speed: it's all safe ground)
    if (this.up.y > 0.95 && (speed < 9 || onMountain)) {
      this.safePos.copy(this.pos);
      this.safeFwd.copy(this.fwd).setY(0).normalize();
    }

    // Combo ends when we roll out cleanly (not manualling)
    if (this.state === 'ground' && this.combo.entries.length && this.sinceLand > 0.6) {
      bankCombo(this.combo, now);
    }
  }

  private pop(trick: TrickInput, now: number) {
    const t = this.tuning;
    const strength = 0.75 + 0.25 * Math.max(this.crouch, 0.6);
    this.popKind = trick === 'nollie' ? 'nollie' : 'ollie';
    this.vel.addScaledVector(this.up, t.popSpeed * strength);
    // A little speed loss converted to height on steep transitions
    this.state = 'air';
    this.airTime = 0;
    this.airYaw = 0;
    this.airFlips = [];
    this.queuedFlips = [];
    this.takeoffFakie = this.fakie;
    this.flipDone = null;
    this.grab = null;
    this.grabTime = 0;
    this.crouch = 0;
    this.pushTimer = -1;
    this.grindCooldown = 0.12;
    this.pos.addScaledVector(this.up, 0.03);
    this.events.push({ type: 'pop', strength });
    if (trick !== 'ollie' && trick !== 'nollie') this.startFlip(trick);
    void now;
  }

  private startFlip(trick: TrickInput) {
    if (this.flip) return;
    const def = FLIPS[trick];
    if (def.duration <= 0) return;
    this.flip = { trick, t: 0, duration: def.duration, roll: def.roll, spin: def.spin };
    this.events.push({ type: 'flip' });
  }

  private leaveGround(now: number) {
    // Off a lip on a steep transition → vert air: kill the horizontal
    // component that would carry us over the deck so we come back down.
    this.vertLip = this.up.y < 0.45;
    if (this.vertLip) {
      const nh = _v.set(this.up.x, 0, this.up.z).normalize();
      const into = this.vel.dot(nh);
      this.vel.addScaledVector(nh, -into);
      // Slight pull back toward the ramp face so we re-enter it
      this.vel.addScaledVector(nh, 0.35);
    }
    this.state = 'air';
    this.popKind = 'ollie';
    this.airTime = 0;
    this.airYaw = 0;
    this.airFlips = [];
    this.queuedFlips = [];
    this.takeoffFakie = this.fakie;
    this.flipDone = null;
    this.grab = null;
    this.grabTime = 0;
    this.pushTimer = -1;
    if (this.combo.entries.length === 0 && !this.vertLip) {
      // Rolling off a drop isn't a trick, but airtime still counts once a trick is added.
    }
    void now;
  }

  // ── Board: airborne ─────────────────────────────────────────────────

  private updateAir(dt: number, input: InputFrame, now: number) {
    const t = this.tuning;
    this.airTime += dt;
    this.vel.y -= t.gravity * dt;

    // Flips while airborne chain for as long as you're up there: press
    // again mid-flip and the next one starts the moment this one ends.
    for (const tr of input.tricks) {
      if (tr === 'ollie' || tr === 'nollie') continue;
      if (this.flip === null) this.startFlip(tr);
      else if (this.queuedFlips.length < 8) this.queuedFlips.push(tr);
    }

    // Spin with the left stick
    const spinRate = 6.2;
    const spin = -input.moveX * spinRate * dt;
    if (Math.abs(spin) > 0) {
      _q.setFromAxisAngle(this.vertLip ? this.up : UP, spin);
      this.fwd.applyQuaternion(_q);
      this.airYaw += spin;
    }

    // Grabs
    const grabbing = (input.grabL || input.grabR) && !this.flip;
    if (grabbing) {
      if (!this.grab) this.grab = input.grabL ? 'Melon' : 'Indy';
      this.grabTime += dt;
      addRunning(this.combo, 90 * dt);
    }

    // Auto-level toward the predicted landing surface
    const prev = _v3.copy(this.pos);
    this.pos.addScaledVector(this.vel, dt);
    const look = this.world.raycast(
      _v.copy(this.pos),
      _v2.set(0, -1, 0).addScaledVector(this.vel, 0.05).normalize(),
      6,
    );
    const targetUp = look && look.normal.y > 0.2 ? look.normal : UP;
    if (!this.vertLip || this.vel.y < 0) {
      this.up.lerp(targetUp, 1 - Math.exp(-(this.vertLip ? 2.5 : 4) * dt)).normalize();
    }
    this.fwd.addScaledVector(this.up, -this.fwd.dot(this.up)).normalize();

    // Walls — hold W into a wall mid-air to step off the board and grab it
    const wall = this.resolveBody(1.45);
    if (wall !== null && input.moveY > 0.5 && this.canClimb(wall)) {
      this.mode = 'foot';
      this.state = 'ground';
      this.flip = null;
      this.grab = null;
      this.up.copy(UP);
      bankCombo(this.combo, now);
      this.events.push({ type: 'boardOff' });
      this.tryStartClimb(wall);
      return;
    }

    // Grind snap (falling or level, near a rail)
    if (this.grindCooldown <= 0 && this.vel.y < 2.5 && this.tryStartGrind(now)) return;

    // Landing: sweep from previous to current position
    const motion = _v.subVectors(this.pos, prev);
    const dist = motion.length();
    const from = _v2.copy(prev).addScaledVector(this.up, 0.25);
    const downDir =
      this.vel.y <= 0
        ? motion
            .clone()
            .addScaledVector(this.up, (-0.25 / Math.max(dt, 1e-3)) * dt)
            .normalize()
        : null;
    let hit = downDir ? this.world.raycast(from, downDir, dist + 0.3) : null;
    if (!hit && this.vel.dot(this.up) <= 0.5) {
      hit = this.world.raycast(
        _v2.copy(this.pos).addScaledVector(this.up, 0.3),
        _v3.copy(this.up).negate(),
        0.32,
      );
    }
    if (hit && hit.normal.dot(this.vel) < 0 && hit.normal.y > -0.2) {
      this.land(hit.point, hit.normal, now);
    }
  }

  private land(point: THREE.Vector3, normal: THREE.Vector3, now: number) {
    const impact = -this.vel.dot(normal);
    this.pos.copy(point);
    // Judge the landing
    const upOk = this.up.dot(normal) > 0.62;
    const flipOk = !this.flip || this.flip.t >= this.flip.duration * 0.82;
    // Heading vs travel: land rolling forward or fakie; sideways = bail
    const tangentVel = _v.copy(this.vel).addScaledVector(normal, -this.vel.dot(normal));
    const tv = tangentVel.length();
    let headingOk = true;
    if (tv > 2.2) {
      const fwdT = _v2.copy(this.fwd).addScaledVector(normal, -this.fwd.dot(normal)).normalize();
      const c = Math.abs(fwdT.dot(tangentVel.clone().normalize()));
      headingOk = c > 0.62;
    }
    const grabOk = !this.grab || true;
    // Fast mountain landings come in hot: impact is already measured along
    // the landing slope's normal, and the tolerance grows with the speed
    // carried along the slope (the city keeps its 15 m/s limit)
    const onMountain = this.terrain !== null && this.terrain.inDomain(point.x, point.z);
    const maxImpact = onMountain ? Math.max(18, tv * 0.8) : 15;
    const clean = upOk && flipOk && headingOk && grabOk && impact < maxImpact;

    this.up.copy(normal);
    this.fwd.addScaledVector(this.up, -this.fwd.dot(this.up)).normalize();
    if (!clean) {
      this.doBail(now, impact);
      return;
    }
    // Snap the board to the travel line (keeps fakie if landed backwards)
    if (tv > 0.5) {
      const dir = tangentVel.normalize();
      const sign = this.fwd.dot(dir) >= 0 ? 1 : -1;
      this.fwd.copy(dir).multiplyScalar(sign);
      this.fakie = sign < 0;
    }
    // Landed rolling backwards → revert so we always ride out forward
    // (still scores as the air trick it was).
    if (this.fakie) {
      this.fwd.negate();
      this.fakie = false;
      this.kickturn = Math.PI;
    }
    // (a clean mountain landing keeps all its speed: the streak is the point)
    this.vel.copy(this.fwd).multiplyScalar(tv * (this.fakie ? -1 : 1) * (onMountain ? 1 : 0.97));

    // Score the air trick
    const yawDeg = THREE.MathUtils.radToDeg(this.airYaw);
    const spun = Math.abs(yawDeg) >= 150;
    const didSomething =
      this.popKind === 'nollie' ||
      this.flipDone !== null ||
      spun ||
      this.grab !== null ||
      this.airTime > 0.45 ||
      this.flip !== null;
    if (didSomething && (this.airTime > 0.18 || this.flipDone !== null)) {
      const flipTrick = this.flipDone ?? (this.flip ? this.flip.trick : null);
      const flips = this.airFlips.length > 0 ? this.airFlips : flipTrick ? [flipTrick] : [];
      const baseName = airTrickName({
        flip: flipTrick,
        pop: this.popKind,
        fakie: this.takeoffFakie,
        yawDeg,
        grab: this.grab,
        frontside: yawDeg < 0,
      });
      const name =
        flips.length > 1 && flipTrick
          ? baseName.replace(FLIPS[flipTrick].name, chainedFlipName(flips))
          : baseName;
      // Each extra flip in the chain is worth more than the last
      const flipPts = flips.reduce((sum, f, i) => sum + FLIPS[f].points * (1 + i * 0.5), 0);
      let pts =
        (flips.length > 0 ? flipPts : this.popKind === 'nollie' ? 120 : 100) + spinPoints(yawDeg);
      if (this.takeoffFakie) pts *= 1.1;
      pts += Math.round(this.airTime * 80);
      if (this.grab) pts += 150 + Math.round(this.grabTime * 100);
      pts = Math.round(pts);
      addTrick(this.combo, name, pts);
      this.events.push({ type: 'trick', name, points: pts });
    }
    this.flip = null;
    this.flipDone = null;
    this.airFlips = [];
    this.queuedFlips = [];
    this.grab = null;
    this.state = 'ground';
    this.vertLip = false;
    this.sinceLand = 0;
    this.lastLandImpact = impact;
    this.events.push({ type: 'land', impact, clean: true });
  }

  private updateFlipVisual(dt: number) {
    if (this.kickturn > 0) this.kickturn = Math.max(0, this.kickturn - dt * 11);
    if (this.flip) {
      this.flip.t += dt;
      if (this.flip.t >= this.flip.duration) {
        this.flipDone = this.flip.trick;
        if (this.state === 'air') this.airFlips.push(this.flip.trick);
        this.flip = null;
        const next = this.state === 'air' ? this.queuedFlips.shift() : undefined;
        if (next !== undefined) this.startFlip(next);
      }
    }
    if (this.flip && this.flip.t < this.flip.duration) {
      const k = easeInOut(Math.min(1, this.flip.t / this.flip.duration));
      const rollA = this.flip.roll * Math.PI * 2 * k;
      const spinA = this.flip.spin * Math.PI * k;
      // Roll about the board's long axis (local Z), spin about local Y
      _q.setFromAxisAngle(_v.set(0, 1, 0), spinA);
      this.boardFlipQuat.setFromAxisAngle(_v2.set(0, 0, 1), rollA).premultiply(_q);
      this.boardLift = Math.sin(k * Math.PI) * 0.32;
    } else {
      this.boardFlipQuat.identity();
      this.boardLift = THREE.MathUtils.lerp(this.boardLift, 0, 1 - Math.exp(-20 * dt));
    }
  }

  // ── Grinds ──────────────────────────────────────────────────────────

  private tryStartGrind(now: number): boolean {
    // Mid-flip you can't lock on — the board has to come back under your feet
    if (this.flip !== null && this.flip.t < this.flip.duration * 0.75) return false;
    const q = this.rails.nearest(this.pos, 0.42);
    if (!q) return false;
    // Must be above (or level with) the rail, not under it
    const dy = this.pos.y - q.point.y;
    if (dy < -0.12 || dy > 0.42) return false;
    const hv = _v.set(this.vel.x, 0, this.vel.z);
    const speed = hv.length();
    if (speed < 1.2) return false;
    hv.divideScalar(speed);
    const tan = _v2.set(q.tangent.x, 0, q.tangent.z).normalize();
    const along = hv.dot(tan);
    // Moving roughly along the rail?
    if (Math.abs(along) < 0.42) return false;
    const dir: 1 | -1 = along >= 0 ? 1 : -1;
    // Board angle relative to the rail decides the grind
    const boardH = _v3.set(this.fwd.x, 0, this.fwd.z).normalize();
    const c = Math.abs(boardH.dot(tan));
    let type: GrindState['type'];
    let yawOffset = 0;
    if (c > 0.72) {
      type = 'fiftyfifty';
    } else if (c < 0.45) {
      type = 'boardslide';
      // Keep the board perpendicular, on whichever side it already was
      const cross = tan.x * boardH.z - tan.z * boardH.x;
      yawOffset = cross > 0 ? Math.PI / 2 : -Math.PI / 2;
    } else {
      type = 'crooked';
      const cross = tan.x * boardH.z - tan.z * boardH.x;
      yawOffset = cross > 0 ? 0.45 : -0.45;
    }
    const railSpeed = Math.max(2, speed * Math.abs(along) * 0.95 + 0.6);
    this.grind = { rail: q.rail, s: q.s, dir, speed: railSpeed, type, yawOffset, time: 0 };
    this.state = 'grind';
    if (this.flip !== null) this.flipDone = this.flip.trick;
    this.flip = null;
    this.grab = null;
    // Flip/air trick into a grind still scores the air part
    if (this.flipDone !== null) {
      addTrick(this.combo, FLIPS[this.flipDone].name, FLIPS[this.flipDone].points);
      this.flipDone = null;
    }
    const name = grindName(type, q.rail.type);
    addTrick(this.combo, name, 150);
    this.events.push({ type: 'grindStart', railType: q.rail.type });
    void now;
    return true;
  }

  private updateGrind(dt: number, input: InputFrame, now: number) {
    const g = this.grind!;
    const t = this.tuning;
    g.time += dt;
    const p = new THREE.Vector3();
    const tan = new THREE.Vector3();
    this.rails.sample(g.rail, g.s, p, tan);
    const dirTan = tan.clone().multiplyScalar(g.dir);
    // Gravity along the rail + friction
    g.speed += -t.gravity * dirTan.y * dt;
    g.speed -= (g.type === 'boardslide' ? 1.4 : 0.9) * dt;
    g.s += g.speed * g.dir * dt;

    // Lean on the stick: nose / tail variants for 50-50s
    if (g.type === 'fiftyfifty' || g.type === 'fivezero' || g.type === 'nosegrind') {
      const prevType = g.type;
      g.type = input.moveY > 0.5 ? 'nosegrind' : input.moveY < -0.5 ? 'fivezero' : 'fiftyfifty';
      if (g.type !== prevType && g.time > 0.15)
        addTrick(this.combo, grindName(g.type, g.rail.type), 120);
    }
    addRunning(this.combo, (g.type === 'boardslide' ? 75 : 60) * dt);

    this.rails.sample(g.rail, g.s, p, tan);
    this.pos.copy(p);
    this.vel.copy(tan).multiplyScalar(g.speed * g.dir);
    // Board frame: up = world up tilted slightly by the rail, fwd along rail (+offset)
    this.up.lerp(UP, 1 - Math.exp(-15 * dt)).normalize();
    const base = _v.copy(dirTan);
    if (this.fwd.dot(base) < 0 && g.yawOffset === 0) base.negate();
    if (g.yawOffset !== 0) base.applyAxisAngle(UP, g.yawOffset);
    this.fwd.lerp(base, 1 - Math.exp(-20 * dt)).normalize();
    this.fwd.addScaledVector(this.up, -this.fwd.dot(this.up)).normalize();
    this.lean = THREE.MathUtils.lerp(
      this.lean,
      Math.sin(g.time * 3.1) * 0.25,
      1 - Math.exp(-4 * dt),
    );

    const ended = g.s <= 0 || g.s >= g.rail.total || g.speed < 0.6;
    const popped = input.tricks.length > 0;
    if (ended || popped) {
      this.state = 'air';
      this.grind = null;
      this.vertLip = false;
      this.airTime = 0;
      this.airYaw = 0;
      this.airFlips = [];
      this.queuedFlips = [];
      this.flipDone = null;
      this.grindCooldown = 0.35;
      this.takeoffFakie = this.fakie;
      this.events.push({ type: 'grindEnd' });
      if (popped) {
        this.vel.y += t.popSpeed * 0.85;
        this.events.push({ type: 'pop', strength: 0.85 });
        const tr = input.tricks[0];
        this.popKind = tr === 'nollie' ? 'nollie' : 'ollie';
        if (tr !== 'ollie' && tr !== 'nollie') this.startFlip(tr);
      } else {
        this.vel.y += 0.6;
      }
      // Board straightens out of a slide
      if (g.yawOffset !== 0) {
        const h = _v.set(this.vel.x, 0, this.vel.z).normalize();
        if (h.lengthSq() > 0.5) this.fwd.copy(h);
      }
      this.pos.y += 0.04;
    }
    void now;
  }

  // ── Bails ───────────────────────────────────────────────────────────

  private doBail(now: number, impact: number) {
    this.state = 'bail';
    this.bailTimer = 0;
    this.run = 0;
    this.runTime = 0;
    this.flip = null;
    this.grind = null;
    this.grab = null;
    this.crouch = 0;
    bailCombo(this.combo, now);
    // Launch the board loose
    this.looseBoard.pos.copy(this.pos).addScaledVector(this.up, 0.1);
    this.looseBoard.vel
      .copy(this.vel)
      .multiplyScalar(1.1)
      .add(new THREE.Vector3((Math.random() - 0.5) * 2, 2.5, (Math.random() - 0.5) * 2));
    _m.lookAt(new THREE.Vector3(), this.fwd, this.up);
    this.looseBoard.quat.setFromRotationMatrix(_m);
    this.looseBoard.spin.set(
      (Math.random() - 0.5) * 18,
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 18,
    );
    this.events.push({ type: 'bail', impact });
  }

  private updateBail(dt: number) {
    this.bailTimer += dt;
    // Rider tumbles/slides along the ground
    this.vel.y -= this.tuning.gravity * dt;
    const hv = _v.set(this.vel.x, 0, this.vel.z);
    hv.multiplyScalar(Math.exp(-2.2 * dt));
    this.vel.x = hv.x;
    this.vel.z = hv.z;
    this.pos.addScaledVector(this.vel, dt);
    this.resolveBody(0.9);
    const hit = this.world.raycast(
      _v.copy(this.pos).addScaledVector(UP, 0.8),
      _v2.set(0, -1, 0),
      1.2,
    );
    if (hit && this.pos.y <= hit.point.y + 0.02) {
      this.pos.y = hit.point.y;
      if (this.vel.y < 0) this.vel.y = 0;
    }
    this.up.lerp(UP, 1 - Math.exp(-6 * dt)).normalize();
    const hf = _v.set(this.fwd.x, 0, this.fwd.z);
    if (hf.lengthSq() > 1e-4) this.fwd.copy(hf.normalize());

    // Loose board physics
    const lb = this.looseBoard;
    lb.vel.y -= this.tuning.gravity * dt;
    lb.pos.addScaledVector(lb.vel, dt);
    const bh = this.world.raycast(_v.copy(lb.pos).addScaledVector(UP, 0.5), _v2.set(0, -1, 0), 0.6);
    if (bh && lb.pos.y < bh.point.y + 0.04) {
      lb.pos.y = bh.point.y + 0.04;
      if (lb.vel.y < 0) lb.vel.y *= -0.35;
      lb.vel.x *= 0.8;
      lb.vel.z *= 0.8;
      lb.spin.multiplyScalar(0.7);
    }
    const ang = lb.spin.length() * dt;
    if (ang > 1e-5) {
      _q.setFromAxisAngle(_v.copy(lb.spin).normalize(), ang);
      lb.quat.premultiply(_q);
    }

    if (this.bailTimer > 2.6) {
      // Get back up on the board where we stopped
      this.state = 'ground';
      this.vel.set(0, 0, 0);
      this.up.copy(UP);
      this.sinceLand = 0;
      this.lastLandImpact = 0;
      if (this.fellOut()) this.respawnSafe();
    }
  }

  // ── Board world transform helpers for rendering ─────────────────────

  /** Rider frame: origin on the surface, Y = up, Z = nose. */
  getRiderQuaternion(out: THREE.Quaternion) {
    const z = _v.copy(this.fwd);
    const y = _v2.copy(this.up);
    const x = _v3.crossVectors(y, z).normalize();
    z.crossVectors(x, y).normalize();
    _m.makeBasis(x, y, z);
    out.setFromRotationMatrix(_m);
    return out;
  }
}

function easeInOut(t: number) {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

export function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
