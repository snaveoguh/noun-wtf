// ── ROADSTAR's thrusters: simple, fun arcade flight (pure) ─────────────────
//
// No three.js. Once the roadster is going fast enough on the ground, X fires
// the thrusters: it pops up and hovers. In the air:
//   W / S       thrust forward / air brake (and back off, gently, in reverse)
//   A / D       yaw (it banks into the turn, for the look)
//   SPACE / Q   climb / sink
//   SHIFT       boost
// With nothing held it holds its height and eases to a hover. It never goes
// below `HOVER_MIN` over the ground under it unless you're sinking, and it
// lands (hands back to the wheels) when you sink to the ground.

import type { FlightParams } from './specs';

export interface FlightControls {
  throttle: number;
  brake: number;
  steer: number;
  up: boolean;
  down: boolean;
  boost: boolean;
}

/** Lowest hover (m) over the ground while not sinking. */
export const HOVER_MIN = 1.6;
/** Below this height while sinking, it's landed. */
export const LAND_HEIGHT = 0.55;
/** Upward pop on take-off (m/s). */
export const LIFT_POP = 6;

export class FlightSim {
  x = 0;
  y = 0;
  z = 0;
  vx = 0;
  vy = 0;
  vz = 0;
  /** Nose heading (rad, 0 = +Z). */
  yaw = 0;
  /** Visual bank / pitch (rad). */
  roll = 0;
  pitch = 0;
  /** Seconds in the air this flight. */
  airTime = 0;
  /** 0..1 thruster output, for the glow + sound. */
  thrust = 0;

  constructor(readonly P: FlightParams) {}

  /** Lift off from the ground at (x, y, z) with this velocity and heading. */
  takeOff(x: number, y: number, z: number, vx: number, vz: number, yaw: number) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.vx = vx;
    this.vz = vz;
    this.vy = LIFT_POP;
    this.yaw = yaw;
    this.roll = this.pitch = 0;
    this.airTime = 0;
    this.thrust = 1;
  }

  get speed(): number {
    return Math.hypot(this.vx, this.vz);
  }

  /** Forward speed along the nose (m/s). */
  get forwardSpeed(): number {
    return this.vx * Math.sin(this.yaw) + this.vz * Math.cos(this.yaw);
  }

  /**
   * One step. `ground(x, z)` is the surface height under a point. Returns
   * true when it has landed (the caller hands it back to the wheels).
   */
  step(h: number, c: FlightControls, ground: (x: number, z: number) => number): boolean {
    const P = this.P;
    this.airTime += h;
    // Yaw: a touch quicker when slow (hover-spins are fun)
    const fwd = this.forwardSpeed;
    const steer = clamp(c.steer, -1, 1);
    const yawRate = P.yawRate * (1.25 - 0.45 * Math.min(1, Math.abs(fwd) / P.maxSpeed));
    this.yaw -= steer * yawRate * h;
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    // Thrust along the nose; the air brake bleeds speed; nothing held: ease to cruise or hover
    const top = c.boost ? P.boostSpeed : P.maxSpeed;
    let a = 0;
    if (c.throttle > 0.05) a = c.throttle * P.thrust * (c.boost ? 1.6 : 1) * (fwd < top ? 1 : 0);
    else if (c.brake > 0.05) a = fwd > -6 ? -c.brake * P.airBrake : 0;
    // Velocity → along the nose (it flies where it points, arcade style)
    let along = fwd + a * h;
    if (c.throttle <= 0.05 && c.brake <= 0.05) along -= along * Math.min(1, 0.35 * h);
    if (along > top) along += (top - along) * Math.min(1, 2 * h);
    const side = this.vx * fz - this.vz * fx;
    const sideKeep = Math.max(0, 1 - 5 * h);
    this.vx = fx * along + fz * side * sideKeep;
    this.vz = fz * along - fx * side * sideKeep;
    // Vertical: climb / sink toward a target rate, else hold height
    const wantVy = c.up ? P.climb : c.down ? -P.sink : 0;
    this.vy += (wantVy - this.vy) * Math.min(1, 3 * h);
    this.thrust = clamp(
      0.35 + (Math.max(0, a) / P.thrust) * 0.5 + (c.up ? 0.3 : 0) + (c.boost ? 0.3 : 0),
      0,
      1,
    );
    this.x += this.vx * h;
    this.y += this.vy * h;
    this.z += this.vz * h;
    // Ground and ceiling (a little look-ahead so hills lift it early)
    const g = Math.max(
      ground(this.x, this.z),
      ground(this.x + this.vx * 0.4, this.z + this.vz * 0.4),
    );
    const floor = g + (c.down ? 0 : HOVER_MIN);
    if (this.y < floor) {
      if (c.down && this.y <= g + LAND_HEIGHT && this.airTime > 0.4) {
        this.y = g;
        return true;
      }
      // Cushion up to the hover height
      this.y += (floor - this.y) * Math.min(1, 6 * h);
      if (this.vy < 0) this.vy *= 0.5;
    }
    if (this.y > g + P.ceiling) {
      this.y = g + P.ceiling;
      if (this.vy > 0) this.vy = 0;
    }
    // Look: bank into turns (roll = rotation about +Z: + lifts the left side,
    // i.e. leans right), pitch = rotation about +X (− is nose up)
    const bank = steer * 0.45 * Math.min(1, Math.abs(along) / 12 + 0.3);
    this.roll += (bank - this.roll) * Math.min(1, 4 * h);
    const pitch = clamp(-this.vy / 30 + (a > 0 ? -0.05 : a < 0 ? 0.08 : 0), -0.4, 0.4);
    this.pitch += (pitch - this.pitch) * Math.min(1, 3 * h);
    return false;
  }
}

/** Can the roadster lift off now? (Fast enough, on its wheels.) */
export function canLiftOff(P: FlightParams, groundSpeed: number, grounded: number): boolean {
  return groundSpeed >= P.liftSpeed && grounded >= 2;
}

function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}
