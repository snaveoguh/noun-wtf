// ── The swing: input → launch, and the swing meter ──────────────────────
//
// launchOf turns what the player did (club, aim, power, accuracy, shaping)
// and the lie into the ball's initial velocity and spin. Conventions
// (contract.ts): yaw = atan2(dx, dz); facing the aim, the player's RIGHT is
// (−cos yaw, 0, sin yaw) (forward × up). +accuracy = a late / open strike:
// the ball starts right of the aim (push) and curves further right
// (slice); −accuracy pulls and hooks left.
//
// Spin is a world vector (rad/s). Pure backspin is about the RIGHT axis
// (ω × v points up: lift). Tilting the axis toward −up curves right.
//
// ── Driving the meter (the HUD wires inputs onto these pure functions) ──
//
// Three-click meter (keys / mouse / tap / gamepad A):
//   press 1  (Space, left click, tap the swing button, pad A): start the
//            backswing, the power bar fills 0 → 1 in METER.backTime s and on
//            to 1.1 (overswing, the red zone), auto-locking at 1.1.
//   press 2  locks power; the needle runs back down at METER.downRate / s.
//   press 3  near 0 sets accuracy: a click with the needle still above 0
//            (early) pulls / hooks (−), below 0 (late) pushes / slices (+);
//            ±METER.zone is the full ±1. Miss it and it locks at +1.
//   Call meterStart(t) / meterPress(m, t) with your own timestamps (s) and
//   meterAt(m, t) every frame to draw it (the fill, the needle, the
//   result once done). SwingMeter wraps the same thing in a class.
//
// Drag / stick (mouse drag, touch drag, gamepad right stick):
//   pull back (down the screen, or the stick down) to set power (the pull's
//   length over `full`), then push through (up). The through-stroke's angle
//   off the straight line back up sets accuracy (right of straight = +),
//   METER.dragAngle (rad) = ±1. dragSwing(back, through, full) does it from
//   the two vectors (screen pixels with y down, or stick units with y down
//   and full = 1).

import type { ClubId, Lie, Launch, SwingInput, V3 } from '../contract';

import { CLUBS } from './clubs';

export const BALL_R = 0.02134;
const DEG = Math.PI / 180;
const RPM = (2 * Math.PI) / 60;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

interface LieMod {
  speed: number;
  spin: number;
  acc: number;
  launch: number;
}

/** What a lie does to a full shot with `club`. */
export function lieMod(club: ClubId, lie: Lie): LieMod {
  const k = CLUBS[club];
  const sandWedge = club === 'SW' || club === 'LW';
  switch (lie) {
    case 'tee':
      return { speed: 1, spin: 1, acc: 1, launch: 0 };
    case 'fairway':
    case 'fringe':
    case 'green':
      return club === 'D'
        ? { speed: 0.95, spin: 1.05, acc: 1.25, launch: -2.5 }
        : { speed: 1, spin: 1, acc: 1, launch: 0 };
    case 'path':
      return { speed: 0.95, spin: 0.7, acc: 1.1, launch: -1 };
    case 'rough':
      // A flyer: the grass between face and ball kills spin, so it flies a
      // touch lower and runs out, but a little less speed and control.
      return { speed: 0.9, spin: 0.65, acc: 1.3, launch: 0.5 };
    case 'sand':
      if (sandWedge) return { speed: 0.85, spin: 0.55, acc: 1.2, launch: 3 };
      if (k.wedge || club === '9i') return { speed: 0.72, spin: 0.5, acc: 1.4, launch: 1 };
      if (k.wood) return { speed: 0.35, spin: 0.4, acc: 2, launch: -2 };
      return { speed: 0.55, spin: 0.4, acc: 1.6, launch: 0 };
    case 'deep':
    default:
      return {
        speed: k.wedge ? 0.72 : k.wood ? 0.45 : 0.6,
        spin: 0.35,
        acc: 1.8,
        launch: k.wedge ? 4 : 2,
      };
  }
}

/** The strike's effective accuracy after overswing and the lie (what curves the ball). */
export function effectiveAccuracy(swing: SwingInput, lie: Lie): number {
  const p = clamp(swing.power, 0, 1.1);
  const over = Math.max(0, p - 1);
  const a = clamp(swing.accuracy, -1, 1) * (1 + over * 8) * lieMod(swing.club, lie).acc;
  return clamp(a, -2, 2);
}

/**
 * The launch for a swing from a lie. `normal` (the ground's upward normal
 * under the ball) tilts the putter's roll into the slope plane and adds an
 * uphill / downhill lie's launch change for full shots.
 */
export function launchOf(swing: SwingInput, lie: Lie, normal?: V3): Launch {
  const k = CLUBS[swing.club];
  const p = clamp(swing.power, 0, 1.1);
  const over = Math.max(0, p - 1);
  const speedF = p <= 1 ? p : 1 + over * 0.6;
  const acc = effectiveAccuracy(swing, lie);
  const shape = clamp(swing.shape ?? 0, -1, 1);
  const spinIn = clamp(swing.spin ?? 0, -1, 1);

  if (swing.club === 'P') {
    const h = swing.aim - acc * k.push * DEG;
    const speed = k.speed * speedF * (lie === 'sand' ? 0.5 : lie === 'deep' ? 0.6 : 1);
    let vx = Math.sin(h) * speed;
    let vz = Math.cos(h) * speed;
    let vy = 0;
    if (normal) {
      // Into the slope plane: drop the normal part, keep the speed
      const d = vx * normal.x + vz * normal.z;
      vx -= d * normal.x;
      vy = -d * normal.y;
      vz -= d * normal.z;
      const s = Math.hypot(vx, vy, vz) || 1;
      vx *= speed / s;
      vy *= speed / s;
      vz *= speed / s;
    }
    // Rolling from the start: ω = (n × v) / r
    const n = normal ?? { x: 0, y: 1, z: 0 };
    return {
      vel: { x: vx, y: vy, z: vz },
      spin: {
        x: (n.y * vz - n.z * vy) / BALL_R,
        y: (n.z * vx - n.x * vz) / BALL_R,
        z: (n.x * vy - n.y * vx) / BALL_R,
      },
    };
  }

  const m = lieMod(swing.club, lie);
  const speed = k.speed * speedF * m.speed;
  // Partial swings lose spin with speed (a bit less than in proportion)
  const rpm = k.spin * m.spin * Math.pow(Math.max(speedF, 0.05), 0.7) * (1 + 0.25 * spinIn);
  const w = rpm * RPM;

  // Start line: pushes right with +accuracy; shaping starts the other way
  const h = swing.aim - (acc * k.push - shape * 1.5) * DEG;
  const fx = Math.sin(h);
  const fz = Math.cos(h);

  let launch = k.launch + m.launch - 1.5 * spinIn;
  if (normal && normal.y > 0.2) {
    // Uphill along the shot (ground rising ahead) launches higher
    const slope = -(normal.x * fx + normal.z * fz) / normal.y;
    launch += Math.atan(slope) * 0.6 * (180 / Math.PI);
  }
  launch = clamp(launch, 1, 60) * DEG;

  const ch = Math.cos(launch);
  const vel = { x: fx * ch * speed, y: Math.sin(launch) * speed, z: fz * ch * speed };
  // Spin axis: right, tilted toward −up for a slice (+), +up for a hook (−)
  const tilt = clamp((acc * k.tilt + shape * 9) * DEG, -50 * DEG, 50 * DEG);
  const rx = -fz;
  const rz = fx;
  const spin = {
    x: w * Math.cos(tilt) * rx,
    y: -w * Math.sin(tilt),
    z: w * Math.cos(tilt) * rz,
  };
  return { vel, spin };
}

// ── The three-click meter ────────────────────────────────────────────────

export const METER = {
  /** Seconds for the power bar to fill 0 → 1 (it carries on to `over`). */
  backTime: 1.0,
  /** Where the bar auto-locks (overswing). */
  over: 1.1,
  /** How fast the needle runs back down after power is locked (bar units / s). */
  downRate: 1.6,
  /** Needle distance from 0 that counts as accuracy ±1. */
  zone: 0.1,
  /** Past −zone × this, a missed third click locks accuracy at +1. */
  miss: 1.4,
  /** Drag / stick: through-stroke angle (rad) for accuracy ±1. */
  dragAngle: 0.26,
} as const;

export type MeterPhase = 'idle' | 'back' | 'down' | 'done';

export interface MeterState {
  phase: MeterPhase;
  /** Backswing start, power lock (s, the caller's clock). */
  t0: number;
  t1: number;
  power: number;
  accuracy: number;
}

export interface MeterView {
  phase: MeterPhase;
  /** The power bar (0..1.1). */
  fill: number;
  /** The needle (bar units; 0 = the strike line). Equal to fill on the backswing. */
  needle: number;
  /** Set once phase is 'done'. */
  result: { power: number; accuracy: number } | null;
}

export const meterIdle = (): MeterState => ({ phase: 'idle', t0: 0, t1: 0, power: 0, accuracy: 0 });

/** Press 1: the backswing starts at t. */
export function meterStart(t: number): MeterState {
  return { phase: 'back', t0: t, t1: 0, power: 0, accuracy: 0 };
}

/** The meter with its timeouts applied at time t (no press). */
function settle(m: MeterState, t: number): MeterState {
  let s = m;
  if (s.phase === 'back') {
    const tOver = s.t0 + METER.over * METER.backTime;
    if (t >= tOver) s = { ...s, phase: 'down', t1: tOver, power: METER.over };
  }
  if (s.phase === 'down') {
    const tMiss = s.t1 + (s.power + METER.zone * METER.miss) / METER.downRate;
    if (t >= tMiss) s = { ...s, phase: 'done', accuracy: 1 };
  }
  return s;
}

/** A press at time t: start, lock power, or set accuracy. */
export function meterPress(m: MeterState, t: number): MeterState {
  const s = settle(m, t);
  switch (s.phase) {
    case 'idle':
      return meterStart(t);
    case 'back':
      return {
        ...s,
        phase: 'down',
        t1: t,
        power: clamp((t - s.t0) / METER.backTime, 0, METER.over),
      };
    case 'down': {
      const needle = s.power - (t - s.t1) * METER.downRate;
      return { ...s, phase: 'done', accuracy: clamp(-needle / METER.zone, -1, 1) };
    }
    default:
      return s;
  }
}

/** What to draw at time t. */
export function meterAt(m: MeterState, t: number): MeterView {
  const s = settle(m, t);
  switch (s.phase) {
    case 'idle':
      return { phase: 'idle', fill: 0, needle: 0, result: null };
    case 'back': {
      const f = clamp((t - s.t0) / METER.backTime, 0, METER.over);
      return { phase: 'back', fill: f, needle: f, result: null };
    }
    case 'down':
      return {
        phase: 'down',
        fill: s.power,
        needle: s.power - (t - s.t1) * METER.downRate,
        result: null,
      };
    default:
      return {
        phase: 'done',
        fill: s.power,
        needle: -s.accuracy * METER.zone,
        result: { power: s.power, accuracy: s.accuracy },
      };
  }
}

/** The same meter as a small stateful object for a HUD. */
export class SwingMeter {
  state: MeterState = meterIdle();
  press(t: number): MeterView {
    this.state = meterPress(this.state, t);
    return meterAt(this.state, t);
  }
  view(t: number): MeterView {
    return meterAt(this.state, t);
  }
  get done(): boolean {
    return this.state.phase === 'done';
  }
  reset(): void {
    this.state = meterIdle();
  }
}

/**
 * Drag / stick swing: `back` is the pull (screen y down = back), `through`
 * the push forward afterwards. Power = |back| / full (to 1.1); accuracy =
 * the through-stroke's angle off straight back up the pull's line, right
 * positive, METER.dragAngle = ±1. A through-stroke much shorter than the
 * pull is a decel: it loses power.
 */
export function dragSwing(
  back: { x: number; y: number },
  through: { x: number; y: number },
  full: number,
): { power: number; accuracy: number } {
  const bl = Math.hypot(back.x, back.y);
  const tl = Math.hypot(through.x, through.y);
  let power = clamp(bl / Math.max(full, 1e-6), 0, METER.over);
  if (bl < 1e-6 || tl < 1e-6) return { power: 0, accuracy: 0 };
  // The ideal through-stroke is straight back along −back
  const ix = -back.x / bl;
  const iy = -back.y / bl;
  const tx = through.x / tl;
  const ty = through.y / tl;
  // Signed angle from ideal to actual; screen y is down, so a clockwise
  // turn on screen (toward the right of an upward stroke) is positive here
  const ang = Math.atan2(ix * ty - iy * tx, ix * tx + iy * ty);
  if (tl < bl * 0.5) power *= 0.6 + 0.4 * (tl / (bl * 0.5));
  return { power, accuracy: clamp(ang / METER.dragAngle, -1, 1) };
}
