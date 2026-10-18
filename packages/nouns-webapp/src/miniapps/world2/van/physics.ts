// ── Drivable ice cream van: arcade raycast-vehicle physics (pure) ────────
//
// No three.js, no DOM, no clock: a rigid body (position, velocity,
// orientation quaternion, angular velocity) on four raycast wheels.
//
//   suspension   a spring + damper per wheel along the body's down axis, an
//                anti-roll bar per axle and a stiff bump stop, so the body
//                pitches under braking, squats on the throttle and rolls in
//                corners (weight transfer falls out of the loads);
//   tyres        per-wheel friction circle: lateral grip cancels sideways
//                slip, longitudinal carries drive / brakes, both capped by
//                mu × load (so a light wheel slides); rear-biased drive and a
//                handbrake that locks the rears and drops their side grip
//                make it drift;
//   arcade help  speed-sensitive steering, a yaw-rate helper toward the
//                steered line (off while drifting), downforce at speed, and
//                a gentle self-righting torque in the air so jumps land on
//                the wheels;
//   safety       wheel rays start well above the mount and a bump stop plus a
//                positional floor (body never below the ground under it) mean
//                no landing, however hard, ends under the surface.
//
// Units: metres, seconds, kilograms. Body frame: +Z forward (the cab), +Y
// up, +X to the driver's left. All per-step scratch is module-level: the
// step allocates nothing.

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}

/** A ray hit: point, unit normal (toward the ray origin), distance, grip multiplier. */
export interface GroundHit {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
  d: number;
  /** Tyre grip on this surface (1 = road). */
  grip: number;
}

/** Body-vs-wall contact from a capsule pushout. */
export interface WallPush {
  /** Correction that moves the capsule out (m). */
  x: number;
  y: number;
  z: number;
  /** Deepest contact normal (unit). */
  nx: number;
  ny: number;
  nz: number;
}

/** What the van needs from the world. Implementations must not allocate. */
export interface VanGround {
  /** Closest hit along a unit ray within `far`; fills `out`. */
  ray(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    far: number,
    out: GroundHit,
  ): boolean;
  /** Push a capsule (a→b, radius r) out of walls; fills `out`. Optional (open ground). */
  push?(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    r: number,
    out: WallPush,
  ): boolean;
}

export interface VanControls {
  /** Gas 0..1. */
  throttle: number;
  /** Brake / reverse 0..1 (held at a standstill it reverses). */
  brake: number;
  /** Steering −1..1, + = right. */
  steer: number;
  handbrake: boolean;
  boost: boolean;
}

export const VAN = {
  mass: 2200,
  gravity: 14,
  /** Centre of mass above the ground at rest, and ahead of the model's origin. */
  comH: 0.9,
  comZ: 0.2,
  wheelR: 0.37,
  restLen: 0.45,
  /** Compression where the bump stop starts. */
  travel: 0.3,
  spring: 60000,
  damper: 4600,
  antiRoll: 22000,
  /** Axles relative to the centre of mass. */
  frontZ: 1.77,
  rearZ: -1.48,
  halfTrack: 1.0,
  /** Box inertia (pitch about X, yaw about Y, roll about Z). */
  inertia: { x: 8970, y: 8875, z: 2380 },
  mu: 1.15,
  /** Kinetic / static grip once a tyre breaks loose. */
  slide: 0.82,
  /** Engine: launch accel cap and power per unit mass (m²/s³), normal and boosted. */
  accel: 8.5,
  power: 226,
  boostAccel: 10,
  boostPower: 470,
  /** Front share of the drive (the rest goes to the rear: power-oversteer). */
  frontDrive: 0.3,
  /** Air drag (per metre) and rolling resistance (× load). */
  drag: 0.0035,
  rolling: 0.012,
  brake: 12,
  reverseSpeed: 11,
  /** Max steering angle at a standstill; it shrinks with speed. */
  steerMax: 0.6,
  steerFade: 9,
  /** Steering wheel slew (rad/s of road-wheel angle, toward the input / back). */
  steerRate: 2.6,
  /** Handbrake: rear side grip multiplier and the yaw kick toward the steer. */
  hbGrip: 0.38,
  hbYaw: 1.4,
  downforce: 0.0022,
  /** Lift tyre forces this far toward the CoM (less roll-over leverage). */
  rollInfluence: 0.55,
  /** Body vs walls: two capsules along the sides. */
  bodyR: 0.78,
  bodyX: 0.46,
  bodyY: 0.45,
  bodyZ0: -2.55,
  bodyZ1: 2.45,
  /** Boost tank: drain and refill per second. */
  boostDrain: 0.12,
  boostFill: 0.1,
  /** Cosmetic gears: upper speed of each forward gear (m/s). */
  gears: [8, 15, 22, 30, 38, 60],
};

/** Raise the wheel rays' start this far above the mount, so deep landings still find the ground. */
const RAY_LIFT = 1.0;
/** Lowest the CoM may sit above the surface under it (the floor pan). */
const FLOOR_CLEAR = 0.42;
const MAX_SPEED = 75;
/** Air self-righting stiffness (N·m per unit tilt) and tumble damping. */
const AIR_LEVEL = 60000;
const AIR_DAMP = 14000;

export interface WheelState {
  /** Mount point (body frame). */
  mx: number;
  my: number;
  mz: number;
  front: boolean;
  left: boolean;
  /** Compression (m), 0 = fully extended / airborne. */
  x: number;
  prevX: number;
  contact: boolean;
  /** Load (N). */
  load: number;
  /** Wheel spin (rad) and spin rate (rad/s), for the visuals. */
  spin: number;
  spinRate: number;
  /** 0..1 how hard this tyre is sliding (screech). */
  slip: number;
  /** Surface grip under it. */
  grip: number;
}

export class VanSim {
  pos: Vec3 = { x: 0, y: 0, z: 0 };
  vel: Vec3 = { x: 0, y: 0, z: 0 };
  q: Quat = { x: 0, y: 0, z: 0, w: 1 };
  /** Angular velocity, world frame (rad/s). */
  w: Vec3 = { x: 0, y: 0, z: 0 };
  wheels: WheelState[] = [];
  /** Road-wheel steering angle (rad), + = right. */
  steerAngle = 0;
  /** Smoothed steering input −1..1. */
  steerIn = 0;
  boostTank = 1;
  boosting = false;
  reversing = false;
  /** Seconds since any wheel touched (0 while grounded). */
  airTime = 0;
  /** Wheels on the ground this step. */
  grounded = 0;
  /** Sideways slide angle of the body (rad, signed), for HUD / camera / screech. */
  slipAngle = 0;
  drifting = false;
  /** Rear grip recovering after the handbrake (0..1). */
  private rearGrip = 1;
  gear = 1;
  /** 0..1 engine revs within the gear. */
  rpm = 0;
  private shiftT = 0;
  /** Strongest wall hit (m/s into the wall) since the caller last zeroed it (sfx / shake). */
  impact = 0;
  /** Hardest touchdown (m/s down) since the caller last zeroed it. */
  landing = 0;
  /** Seconds upside down / on a side while slow (auto-righting hint). */
  stuck = 0;

  constructor() {
    for (const [front, z] of [
      [true, VAN.frontZ],
      [false, VAN.rearZ],
    ] as const) {
      for (const left of [true, false]) {
        this.wheels.push({
          mx: left ? VAN.halfTrack : -VAN.halfTrack,
          my: VAN.restLen + VAN.wheelR - staticSag() - VAN.comH,
          mz: z,
          front,
          left,
          x: 0,
          prevX: 0,
          contact: false,
          load: 0,
          spin: 0,
          spinRate: 0,
          slip: 0,
          grip: 1,
        });
      }
    }
  }

  /** Put the van at rest with its wheels on a ground point (origin = between the tyres). */
  place(x: number, groundY: number, z: number, yaw: number) {
    this.pos.x = x;
    this.pos.y = groundY + VAN.comH;
    this.pos.z = z;
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.w.x = this.w.y = this.w.z = 0;
    this.q.x = 0;
    this.q.y = Math.sin(yaw / 2);
    this.q.z = 0;
    this.q.w = Math.cos(yaw / 2);
    this.steerAngle = this.steerIn = 0;
    this.airTime = 0;
    this.stuck = 0;
    this.rearGrip = 1;
    this.reversing = false;
    for (const wh of this.wheels) {
      wh.x = wh.prevX = staticSag();
      wh.contact = true;
      wh.spinRate = 0;
      wh.slip = 0;
    }
  }

  /** Start from a parked pose (model origin + orientation), at rest. */
  placePose(ox: number, oy: number, oz: number, q: Quat) {
    this.place(0, 0, 0, 0);
    this.q.x = q.x;
    this.q.y = q.y;
    this.q.z = q.z;
    this.q.w = q.w;
    rotate(this.q, 0, VAN.comH, VAN.comZ, _m);
    this.pos.x = ox + _m.x;
    this.pos.y = oy + _m.y;
    this.pos.z = oz + _m.z;
  }

  /** Heading (rad, 0 = +Z, like the rest of the game's yaw). */
  get heading(): number {
    rotate(this.q, 0, 0, 1, _f);
    return Math.atan2(_f.x, _f.z);
  }

  get speed(): number {
    return Math.hypot(this.vel.x, this.vel.y, this.vel.z);
  }

  /** Signed speed along the nose. */
  get forwardSpeed(): number {
    rotate(this.q, 0, 0, 1, _f);
    return this.vel.x * _f.x + this.vel.y * _f.y + this.vel.z * _f.z;
  }

  /** Body up axis (world). */
  up(out: Vec3): Vec3 {
    return rotate(this.q, 0, 1, 0, out);
  }

  /** Model origin (ground level between the tyres at rest) in world space. */
  origin(out: Vec3): Vec3 {
    rotate(this.q, 0, -VAN.comH, -VAN.comZ, out);
    out.x += this.pos.x;
    out.y += this.pos.y;
    out.z += this.pos.z;
    return out;
  }

  /**
   * Flip back onto the wheels where you are (R): upright on the current
   * heading, lifted clear of the ground, at rest.
   */
  recover(ground: VanGround) {
    const yaw = this.heading;
    let gy = this.pos.y - VAN.comH;
    if (ground.ray(this.pos.x, this.pos.y + 6, this.pos.z, 0, -1, 0, 30, _hit)) gy = _hit.y;
    this.place(this.pos.x, gy + 0.6, this.pos.z, yaw);
    for (const wh of this.wheels) {
      wh.x = wh.prevX = 0;
      wh.contact = false;
    }
  }

  /** One fixed physics step. */
  step(h: number, c: VanControls, ground: VanGround) {
    const P = this.pos;
    const V = this.vel;
    const m = VAN.mass;
    rotate(this.q, 1, 0, 0, _r);
    rotate(this.q, 0, 1, 0, _u);
    rotate(this.q, 0, 0, 1, _f);
    const vFwd = V.x * _f.x + V.y * _f.y + V.z * _f.z;
    const vAbs = Math.hypot(V.x, V.y, V.z);

    // ── Driver inputs → engine / brake / steer ──
    let throttle = clamp01(c.throttle);
    let brake = clamp01(c.brake);
    // Brake held near a standstill = reverse gear; gas while rolling back = brake
    if (!this.reversing && brake > 0.1 && throttle < 0.1 && vFwd < 0.8) this.reversing = true;
    if (this.reversing && (throttle > 0.1 || vFwd > 1.5)) this.reversing = false;
    let drive = 0;
    if (this.reversing) {
      drive = vFwd > -VAN.reverseSpeed ? -brake * 0.6 * VAN.accel : 0;
      brake = throttle > 0.1 ? throttle : 0;
      throttle = 0;
    } else if (throttle > 0 && vFwd < -0.8) {
      brake = Math.max(brake, throttle);
      throttle = 0;
    }
    this.boosting = c.boost && throttle > 0.1 && this.boostTank > 0 && !this.reversing;
    if (this.boosting) this.boostTank = Math.max(0, this.boostTank - VAN.boostDrain * h);
    else this.boostTank = Math.min(1, this.boostTank + VAN.boostFill * h);
    if (throttle > 0) {
      const cap = this.boosting ? VAN.boostAccel : VAN.accel;
      const pw = this.boosting ? VAN.boostPower : VAN.power;
      drive = throttle * Math.min(cap, pw / Math.max(1, Math.abs(vFwd)));
      // A blip of no drive on each upshift (it feels like gears)
      if (this.shiftT > 0) drive *= 0.35;
    }
    this.updateGears(h, vFwd, throttle);

    // Steering: slew toward the input, max angle shrinks with speed
    const sIn = clamp(c.steer, -1, 1);
    const rate = Math.abs(sIn) > Math.abs(this.steerIn) && sIn * this.steerIn >= 0 ? 3.2 : 6;
    this.steerIn += clamp(sIn - this.steerIn, -rate * h, rate * h);
    const sMax = VAN.steerMax / (1 + Math.abs(vFwd) / VAN.steerFade);
    this.steerAngle = this.steerIn * sMax;

    // Handbrake: rears lose side grip, recovering over ~0.6 s after release
    if (c.handbrake) this.rearGrip = VAN.hbGrip;
    else this.rearGrip = Math.min(1, this.rearGrip + h * 1.1);

    // ── Forces ──
    let Fx = 0;
    let Fy = -m * VAN.gravity;
    let Fz = 0;
    let Tx = 0;
    let Ty = 0;
    let Tz = 0;
    this.grounded = 0;
    const span = VAN.restLen + VAN.wheelR;
    const mw = m / 4;

    // Suspension pass: compressions + loads
    for (let i = 0; i < 4; i++) {
      const wh = this.wheels[i];
      bodyToWorld(this.q, P, wh.mx, wh.my, wh.mz, _m);
      const ox = _m.x + _u.x * RAY_LIFT;
      const oy = _m.y + _u.y * RAY_LIFT;
      const oz = _m.z + _u.z * RAY_LIFT;
      wh.prevX = wh.x;
      wh.contact = false;
      wh.x = 0;
      if (ground.ray(ox, oy, oz, -_u.x, -_u.y, -_u.z, span + RAY_LIFT + 0.05, _hit)) {
        const d = _hit.d - RAY_LIFT;
        const x = span - d;
        // Facing the wrong way (a wall or the underside of something): ignore
        const facing = _hit.nx * _u.x + _hit.ny * _u.y + _hit.nz * _u.z;
        if (x > 0 && facing > 0.3) {
          wh.contact = true;
          wh.x = x;
          wh.grip = _hit.grip;
          const st = wheelContacts[i];
          st.x = _hit.x;
          st.y = _hit.y;
          st.z = _hit.z;
          st.nx = _hit.nx;
          st.ny = _hit.ny;
          st.nz = _hit.nz;
          // Touchdown: how hard (m/s along the body's down axis)
          if (wh.prevX <= 0) {
            const vd = -(V.x * _u.x + V.y * _u.y + V.z * _u.z);
            this.landing = Math.max(this.landing, vd);
          }
        }
      }
    }
    // Anti-roll bars: share the compression difference across each axle
    for (let a = 0; a < 2; a++) {
      const L = this.wheels[a * 2];
      const R = this.wheels[a * 2 + 1];
      const diff = (L.x - R.x) * VAN.antiRoll;
      L.load = R.load = 0;
      if (L.contact) L.load += diff;
      if (R.contact) R.load -= diff;
    }
    for (let i = 0; i < 4; i++) {
      const wh = this.wheels[i];
      if (!wh.contact) {
        wh.load = 0;
        continue;
      }
      this.grounded++;
      const xdot = (wh.x - wh.prevX) / h;
      let F = VAN.spring * wh.x + VAN.damper * clamp(xdot, -6, 6) + wh.load;
      if (wh.x > VAN.travel) {
        // Bump stop
        const over = wh.x - VAN.travel;
        F += VAN.spring * 8 * over + VAN.damper * 3 * Math.max(0, xdot);
      }
      wh.load = Math.max(0, F);
    }

    // Tyres
    const hbOn = c.handbrake;
    for (let i = 0; i < 4; i++) {
      const wh = this.wheels[i];
      if (!wh.contact) {
        wh.slip = 0;
        // Free wheels spin down; driven ones rev with the throttle
        wh.spinRate *= 1 - Math.min(1, h * 0.8);
        continue;
      }
      const st = wheelContacts[i];
      const nx = st.nx;
      const ny = st.ny;
      const nz = st.nz;
      // Wheel heading: the body's nose, steered for the fronts (+ = right = −X)
      let hx = _f.x;
      let hy = _f.y;
      let hz = _f.z;
      if (wh.front && this.steerAngle !== 0) {
        const a = -this.steerAngle;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        // up × fwd = the body's +X (left)
        hx = _f.x * ca + _r.x * sa;
        hy = _f.y * ca + _r.y * sa;
        hz = _f.z * ca + _r.z * sa;
      }
      // Into the contact plane
      const hn = hx * nx + hy * ny + hz * nz;
      hx -= nx * hn;
      hy -= ny * hn;
      hz -= nz * hn;
      const hl = Math.hypot(hx, hy, hz) || 1;
      hx /= hl;
      hy /= hl;
      hz /= hl;
      // Side axis: n × heading
      const sx = ny * hz - nz * hy;
      const sy = nz * hx - nx * hz;
      const sz = nx * hy - ny * hx;
      // Contact point velocity v + ω × r
      const rx = st.x - P.x;
      const ry = st.y - P.y;
      const rz = st.z - P.z;
      const pvx = V.x + (this.w.y * rz - this.w.z * ry);
      const pvy = V.y + (this.w.z * rx - this.w.x * rz);
      const pvz = V.z + (this.w.x * ry - this.w.y * rx);
      const vLong = pvx * hx + pvy * hy + pvz * hz;
      const vLat = pvx * sx + pvy * sy + pvz * sz;
      const N = wh.load;
      const mu = VAN.mu * wh.grip;
      let latMu = mu;
      if (!wh.front) latMu *= this.rearGrip;

      // Longitudinal: drive, brakes, handbrake lock, rolling resistance
      let FL = 0;
      const share = wh.front ? VAN.frontDrive : 1 - VAN.frontDrive;
      FL += (m * drive * share) / 2;
      const stopF = (mw * Math.abs(vLong)) / h;
      if (brake > 0) FL -= Math.sign(vLong) * Math.min(stopF, mw * VAN.brake * brake);
      if (hbOn && !wh.front) {
        FL = -Math.sign(vLong) * Math.min(stopF, mu * N * 0.9);
      }
      FL -= Math.sign(vLong) * Math.min(stopF * 0.5, VAN.rolling * N);
      // Parked on a slope: hold it (no creep) when nothing's pressed
      if (throttle === 0 && drive === 0 && Math.abs(vLong) < 0.6) FL = -(mw * vLong) / h;

      // Lateral: cancel the sideways slip (stiff), capped by the friction circle
      let FS = -(0.5 * mw * vLat) / h;
      const lim = mu * N;
      const latLim = latMu * N;
      let sliding = 0;
      if (Math.abs(FS) > latLim) {
        FS = Math.sign(FS) * latLim * VAN.slide;
        sliding = Math.min(1, Math.abs(vLat) / 6);
      }
      const tot = Math.hypot(FL, FS);
      if (tot > lim && tot > 0) {
        const k = lim / tot;
        FL *= k;
        FS *= k;
        sliding = Math.max(sliding, Math.min(1, (tot - lim) / Math.max(1, lim)));
      }
      wh.slip = sliding;

      // Apply at the contact point lifted toward the CoM (less tipping leverage)
      const lift = (1 - VAN.rollInfluence) * VAN.comH;
      const ax = st.x + _u.x * lift;
      const ay = st.y + _u.y * lift;
      const az = st.z + _u.z * lift;
      const fx = hx * FL + sx * FS;
      const fy = hy * FL + sy * FS;
      const fz = hz * FL + sz * FS;
      Fx += fx;
      Fy += fy;
      Fz += fz;
      const arx = ax - P.x;
      const ary = ay - P.y;
      const arz = az - P.z;
      Tx += ary * fz - arz * fy;
      Ty += arz * fx - arx * fz;
      Tz += arx * fy - ary * fx;
      // Suspension force along the body up, at the mount point
      const sF = N;
      const ux = _u.x * sF;
      const uy = _u.y * sF;
      const uz = _u.z * sF;
      Fx += ux;
      Fy += uy;
      Fz += uz;
      bodyToWorld(this.q, P, wh.mx, wh.my, wh.mz, _m);
      const mrx = _m.x - P.x;
      const mry = _m.y - P.y;
      const mrz = _m.z - P.z;
      Tx += mry * uz - mrz * uy;
      Ty += mrz * ux - mrx * uz;
      Tz += mrx * uy - mry * ux;

      // Visual spin: rolls with the ground (locked rears under the handbrake)
      wh.spinRate = hbOn && !wh.front ? 0 : vLong / VAN.wheelR;
      if (!wh.front && drive > 0 && sliding > 0.3) wh.spinRate += 12;
    }

    // Air drag + downforce (grounded only)
    Fx -= m * VAN.drag * V.x * vAbs;
    Fy -= m * VAN.drag * V.y * vAbs;
    Fz -= m * VAN.drag * V.z * vAbs;
    if (this.grounded >= 2) {
      const dn = m * VAN.downforce * vFwd * vFwd;
      Fx -= _u.x * dn;
      Fy -= _u.y * dn;
      Fz -= _u.z * dn;
    }

    // ── Arcade helpers (as torques about the body axes) ──
    const wUp = this.w.x * _u.x + this.w.y * _u.y + this.w.z * _u.z;
    // Body slide angle
    const vSide = V.x * _r.x + V.y * _r.y + V.z * _r.z;
    this.slipAngle = vAbs > 3 ? Math.atan2(-vSide, Math.abs(vFwd)) : 0;
    const slipNow = Math.abs(this.slipAngle);
    this.drifting =
      this.grounded >= 2 && vAbs > 8 && (slipNow > 0.22 || (hbOn && Math.abs(this.steerIn) > 0.3));
    if (this.grounded >= 2) {
      const I = VAN.inertia.y;
      if (hbOn && vAbs > 5) {
        // Handbrake turn: kick the tail out toward the steer
        const kick = -this.steerIn * VAN.hbYaw * Math.min(1, vAbs / 15);
        const k = (kick - wUp) * I * 2.2;
        Tx += _u.x * k;
        Ty += _u.y * k;
        Tz += _u.z * k;
      } else if (!this.drifting || slipNow < 0.35) {
        // Yaw-rate helper toward the steered line (keeps the van predictable)
        const L = VAN.frontZ - VAN.rearZ;
        // (never more than the tyres could hold: mu·g / v, plus a little)
        const cap = Math.min(1.6, (1.25 * VAN.mu * VAN.gravity) / Math.max(1, vAbs));
        const want = clamp((vFwd * Math.tan(-this.steerAngle)) / L, -cap, cap);
        const k = (want - wUp) * I * 2.0;
        Tx += _u.x * k;
        Ty += _u.y * k;
        Tz += _u.z * k;
      } else {
        // Drifting: hold the angle while steering into it; let go (or
        // countersteer) and it straightens up instead of spinning out
        const want = (-this.steerIn * 0.9 * vAbs) / 18 - this.slipAngle * 1.4;
        const k = (want - wUp) * I * 2.2;
        Tx += _u.x * k;
        Ty += _u.y * k;
        Tz += _u.z * k;
      }
    } else if (this.grounded === 0) {
      // In the air: ease pitch + roll back toward level so jumps land on the
      // wheels (torque along up × worldUp), and damp the tumble a touch
      if (_u.y > -0.2) {
        Tx += -_u.z * AIR_LEVEL;
        Tz += _u.x * AIR_LEVEL;
      }
      Tx -= this.w.x * AIR_DAMP;
      Tz -= this.w.z * AIR_DAMP;
    }
    // Overall rotational damping (keeps the stiff springs tame)
    Tx -= this.w.x * 900;
    Ty -= this.w.y * 900;
    Tz -= this.w.z * 900;

    // ── Integrate (semi-implicit Euler) ──
    V.x += (Fx / m) * h;
    V.y += (Fy / m) * h;
    V.z += (Fz / m) * h;
    const sp = Math.hypot(V.x, V.y, V.z);
    if (sp > MAX_SPEED) {
      const k = MAX_SPEED / sp;
      V.x *= k;
      V.y *= k;
      V.z *= k;
    }
    // Angular: torque into the body frame, through the diagonal inertia
    const tbx = Tx * _r.x + Ty * _r.y + Tz * _r.z;
    const tby = Tx * _u.x + Ty * _u.y + Tz * _u.z;
    const tbz = Tx * _f.x + Ty * _f.y + Tz * _f.z;
    const dwx = (tbx / VAN.inertia.x) * h;
    const dwy = (tby / VAN.inertia.y) * h;
    const dwz = (tbz / VAN.inertia.z) * h;
    this.w.x += _r.x * dwx + _u.x * dwy + _f.x * dwz;
    this.w.y += _r.y * dwx + _u.y * dwy + _f.y * dwz;
    this.w.z += _r.z * dwx + _u.z * dwy + _f.z * dwz;
    const wl = Math.hypot(this.w.x, this.w.y, this.w.z);
    if (wl > 9) {
      this.w.x *= 9 / wl;
      this.w.y *= 9 / wl;
      this.w.z *= 9 / wl;
    }
    P.x += V.x * h;
    P.y += V.y * h;
    P.z += V.z * h;
    integrateQuat(this.q, this.w, h);

    // Wheel spin (visual)
    for (const wh of this.wheels) wh.spin = (wh.spin + wh.spinRate * h) % (Math.PI * 2);

    this.collideWalls(ground);
    this.keepAboveGround(ground);

    this.airTime = this.grounded > 0 ? 0 : this.airTime + h;
    rotate(this.q, 0, 1, 0, _u);
    if (_u.y < 0.35 && sp < 3) this.stuck += h;
    else this.stuck = 0;
  }

  /** Body capsules vs walls: push out, bounce off, scrub speed, glance away. */
  private collideWalls(ground: VanGround) {
    if (ground.push === undefined) return;
    const P = this.pos;
    const V = this.vel;
    for (const side of [-1, 1]) {
      bodyToWorld(this.q, P, side * VAN.bodyX, VAN.bodyY, VAN.bodyZ0, _a);
      bodyToWorld(this.q, P, side * VAN.bodyX, VAN.bodyY, VAN.bodyZ1, _b);
      if (!ground.push(_a.x, _a.y, _a.z, _b.x, _b.y, _b.z, VAN.bodyR, _push)) continue;
      const nx = _push.nx;
      const ny = _push.ny;
      const nz = _push.nz;
      // Floors are the wheels' job; only resolve walls (and ceilings) here
      if (ny > 0.65) {
        // Bottomed on a kerb / ramp edge: lift out, kill the downward speed
        P.y += Math.max(0, _push.y);
        if (V.y < 0) V.y = 0;
        continue;
      }
      P.x += _push.x;
      P.y += _push.y;
      P.z += _push.z;
      const vn = V.x * nx + V.y * ny + V.z * nz;
      if (vn >= 0) continue;
      this.impact = Math.max(this.impact, -vn);
      // Bounce a little, scrub the slide along the wall
      const e = 0.25;
      V.x -= nx * vn * (1 + e);
      V.y -= ny * vn * (1 + e);
      V.z -= nz * vn * (1 + e);
      const scrub = 1 - Math.min(0.5, -vn * 0.02);
      V.x *= scrub;
      V.z *= scrub;
      // Glance: turn the nose away from the wall
      rotate(this.q, 0, 0, 1, _f);
      const into = _f.x * nx + _f.z * nz;
      const crossY = _f.z * nx - _f.x * nz;
      this.w.y += Math.sign(crossY) * Math.min(2.5, -vn * 0.12) * (1 - Math.abs(into));
    }
  }

  /** The floor pan never goes below the ground under the CoM (no tunnelling). */
  private keepAboveGround(ground: VanGround) {
    const P = this.pos;
    // From just above the CoM (inside the body: nothing else can be there),
    // so a deck overhead is never mistaken for the ground
    if (!ground.ray(P.x, P.y + 0.6, P.z, 0, -1, 0, 0.6 + VAN.comH + 0.3, _hit)) return;
    if (_hit.ny < 0.3) return;
    const floor = _hit.y + FLOOR_CLEAR;
    if (P.y >= floor) return;
    P.y = floor;
    if (this.vel.y < 0) {
      this.landing = Math.max(this.landing, -this.vel.y);
      // Keep the speed along the surface, drop the part into it
      const vn = this.vel.x * _hit.nx + this.vel.y * _hit.ny + this.vel.z * _hit.nz;
      if (vn < 0) {
        this.vel.x -= _hit.nx * vn;
        this.vel.y -= _hit.ny * vn;
        this.vel.z -= _hit.nz * vn;
      }
    }
  }

  private updateGears(h: number, vFwd: number, throttle: number) {
    this.shiftT = Math.max(0, this.shiftT - h);
    if (this.reversing) {
      this.gear = -1;
      this.rpm = clamp01(Math.abs(vFwd) / VAN.reverseSpeed);
      return;
    }
    const v = Math.max(0, vFwd);
    const G = VAN.gears;
    let g = Math.max(1, this.gear);
    // Up at the top of the band, down with some hysteresis
    while (g < G.length && v > G[g - 1]) g++;
    while (g > 1 && v < G[g - 2] * 0.82) g--;
    if (g > this.gear && this.gear >= 1 && throttle > 0.5) this.shiftT = 0.12;
    this.gear = g;
    const lo = g > 1 ? G[g - 2] * 0.7 : 0;
    const hi = G[g - 1];
    this.rpm = clamp01((v - lo) / Math.max(1, hi - lo));
  }
}

/** Static compression per wheel at rest. */
function staticSag(): number {
  return (VAN.mass * VAN.gravity) / 4 / VAN.spring;
}

// ── Allocation-free scratch + math ──

const _f: Vec3 = { x: 0, y: 0, z: 0 };
const _u: Vec3 = { x: 0, y: 0, z: 0 };
const _r: Vec3 = { x: 0, y: 0, z: 0 };
const _m: Vec3 = { x: 0, y: 0, z: 0 };
const _a: Vec3 = { x: 0, y: 0, z: 0 };
const _b: Vec3 = { x: 0, y: 0, z: 0 };
const _hit: GroundHit = { x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0, d: 0, grip: 1 };
const _push: WallPush = { x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0 };
const wheelContacts = [0, 1, 2, 3].map(() => ({ x: 0, y: 0, z: 0, nx: 0, ny: 1, nz: 0 }));

/** Rotate (x, y, z) by unit quaternion q. */
export function rotate(q: Quat, x: number, y: number, z: number, out: Vec3): Vec3 {
  // t = 2 q.xyz × v ; v' = v + w t + q.xyz × t
  const tx = 2 * (q.y * z - q.z * y);
  const ty = 2 * (q.z * x - q.x * z);
  const tz = 2 * (q.x * y - q.y * x);
  out.x = x + q.w * tx + (q.y * tz - q.z * ty);
  out.y = y + q.w * ty + (q.z * tx - q.x * tz);
  out.z = z + q.w * tz + (q.x * ty - q.y * tx);
  return out;
}

function bodyToWorld(q: Quat, p: Vec3, x: number, y: number, z: number, out: Vec3): Vec3 {
  rotate(q, x, y, z, out);
  out.x += p.x;
  out.y += p.y;
  out.z += p.z;
  return out;
}

/** q += ½ (ω, 0) ⊗ q · h, renormalised. */
function integrateQuat(q: Quat, w: Vec3, h: number) {
  const hx = w.x * h * 0.5;
  const hy = w.y * h * 0.5;
  const hz = w.z * h * 0.5;
  const x = q.x;
  const y = q.y;
  const z = q.z;
  const qw = q.w;
  q.x += hx * qw + hy * z - hz * y;
  q.y += hy * qw + hz * x - hx * z;
  q.z += hz * qw + hx * y - hy * x;
  q.w += -hx * x - hy * y - hz * z;
  const l = Math.hypot(q.x, q.y, q.z, q.w) || 1;
  q.x /= l;
  q.y /= l;
  q.z /= l;
  q.w /= l;
}

function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}

function clamp01(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Substeps for a frame: ≤ 1/120 s and ≤ 0.35 m of travel each (no tunnelling at speed). */
export function substeps(dt: number, speed: number): number {
  return Math.min(16, Math.max(1, Math.ceil(dt * 120), Math.ceil((speed * dt) / 0.35)));
}
