// ── Skydiving physics (pure, no three.js) ────────────────────────────────
//
// Shapes the rider's velocity once per physics step, before skate/Player's
// own step (which then adds gravity, moves, collides and lands):
//
//   freefall  quadratic drag: vy += g·(vy / vt)²·dt, so with the Player's
//             −g·dt the fall settles at vt (belly 55, dive 75, flare 45,
//             track 52 m/s); vt eases between positions. Tracking pushes
//             the horizontal speed toward the heading (up to 14 m/s) with
//             momentum; no input lets it bleed off. Left / right turn.
//   canopy    pulled above SKY.pullMin: over ~1 s the descent relaxes from
//             whatever it was to ~6 m/s (front-loaded, the opening shock),
//             then glides forward ~5.5 m/s; forward = faster, back = brakes,
//             left / right turn. Lands under the parkour roll threshold.

import { SKY, type Posture, type SkyInput, type SkyPhase, type V3 } from '../contract';

export interface SkyState {
  phase: SkyPhase;
  posture: Posture;
  /** Terminal velocity right now (m/s, eased toward the posture's). */
  vt: number;
  /** Canopy: 0 (just pulled) → 1 (fully open). */
  open: number;
  /** Seconds in this phase. */
  t: number;
  /** Smoothed turn input (−1..1), for the poses. */
  steer: number;
}

export function newSky(): SkyState {
  return { phase: 'off', posture: 'belly', vt: SKY.vt.belly, open: 0, t: 0, steer: 0 };
}

/** Which body position the input asks for (freefall). */
export function postureOf(i: SkyInput): Posture {
  if (i.dive) return 'dive';
  if (i.moveY > 0.3) return 'track';
  if (i.moveY < -0.3) return 'flare';
  return 'belly';
}

export interface EnterCheck {
  /** Off the ground, not climbing / hanging / on a parkour move. */
  airborne: boolean;
  /** Vertical speed (m/s, + up). */
  vy: number;
  /** Seconds airborne. */
  airT: number;
  /** Clear air under the feet (m; Infinity = nothing found). */
  clear: number;
  /** A ledge / wall / pole parkour could catch is within reach. */
  catchable: boolean;
}

/**
 * Does this fall become a skydive? Only well above the ground, past a short
 * delay, falling, and with nothing in reach parkour could catch (a fall
 * down a facade stays a parkour fall: ledges and walls keep priority).
 */
export function shouldEnter(c: EnterCheck): boolean {
  return (
    c.airborne &&
    c.vy <= SKY.enterVy &&
    c.airT >= SKY.enterDelay &&
    c.clear >= SKY.enterClear &&
    !c.catchable
  );
}

export interface OfferCheck {
  /** On a board where freefall doesn't start by itself (the mountain, mega ramps). */
  offered: boolean;
  airborne: boolean;
  airT: number;
  clear: number;
  catchable: boolean;
}

/**
 * Offer a skydive on a big air where one wouldn't start by itself: high
 * enough that there's still room to pull after taking it, and nothing in
 * reach parkour could catch.
 */
export function shouldOffer(c: OfferCheck): boolean {
  return (
    c.offered && c.airborne && c.airT >= SKY.offerAirT && c.clear >= SKY.offerClear && !c.catchable
  );
}

/** Start freefall (keeps the speed the rider already has). */
export function enter(s: SkyState, vy: number) {
  s.phase = 'freefall';
  s.posture = 'belly';
  // Pick the drag up from where the fall already is: a rider already past
  // belly terminal (a long ballistic drop) slows into it, not jolts
  s.vt = Math.max(SKY.vt.belly, Math.min(SKY.vt.dive, -vy));
  s.open = 0;
  s.t = 0;
  s.steer = 0;
}

/** Can the parachute open from `clear` m up? */
export function canPull(s: SkyState, clear: number): boolean {
  return s.phase === 'freefall' && clear >= SKY.pullMin;
}

export function pull(s: SkyState) {
  s.phase = 'canopy';
  s.open = 0;
  s.t = 0;
}

export function end(s: SkyState) {
  s.phase = 'off';
  s.open = 0;
  s.t = 0;
  s.steer = 0;
}

const relax = (cur: number, target: number, rate: number, dt: number) =>
  target + (cur - target) * Math.exp(-rate * dt);

/**
 * One physics step: shapes `vel` (call before the Player's own step, which
 * adds −g·dt) and returns the new yaw. Does nothing while off.
 */
export function stepSky(s: SkyState, vel: V3, yaw: number, i: SkyInput, dt: number): number {
  if (s.phase === 'off') return yaw;
  s.t += dt;
  s.steer = relax(s.steer, Math.max(-1, Math.min(1, i.moveX)), 6, dt);
  const g = SKY.gravity;
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);

  if (s.phase === 'freefall') {
    yaw -= i.moveX * SKY.yawRate * dt;
    s.posture = postureOf(i);
    s.vt = relax(s.vt, SKY.vt[s.posture], SKY.vtRate, dt);
    // Drag: balances gravity at vt (capped, so a flare from a dive slows
    // hard but never flips the fall)
    if (vel.y < 0) {
      const r = vel.y / s.vt;
      vel.y += Math.min(4 * g, g * r * r) * dt;
    }
    let tx = 0;
    let tz = 0;
    let rate: number = SKY.coastRate;
    if (s.posture === 'track') {
      const k = SKY.trackMax * Math.min(1, i.moveY);
      tx = fx * k;
      tz = fz * k;
      rate = SKY.trackRate;
    } else if (s.posture === 'dive') {
      tx = fx * SKY.diveFwd;
      tz = fz * SKY.diveFwd;
      rate = 0.5;
    } else if (s.posture === 'flare') {
      const k = -SKY.flareBack * Math.min(1, -i.moveY);
      tx = fx * k;
      tz = fz * k;
      rate = 0.6;
    }
    vel.x = relax(vel.x, tx, rate, dt);
    vel.z = relax(vel.z, tz, rate, dt);
    return yaw;
  }

  // Canopy
  yaw -= i.moveX * SKY.canopyTurn * dt;
  s.open = Math.min(1, s.open + dt / SKY.openTime);
  const fast = Math.max(0, i.moveY);
  const brake = Math.max(0, -i.moveY);
  const vyT = -(
    SKY.canopyVy +
    (SKY.canopyVyFast - SKY.canopyVy) * fast -
    (SKY.canopyVy - SKY.canopyVyBrake) * brake
  );
  const gl = SKY.glide + (SKY.glideFast - SKY.glide) * fast - (SKY.glide - SKY.glideBrake) * brake;
  // Front-loaded: most of the speed goes in the first half second. The +g·dt
  // cancels the Player's gravity this step, so the descent is exactly this.
  vel.y = relax(vel.y, vyT, 2 + 6 * s.open, dt) + g * dt;
  const hr = 0.8 + 1.5 * s.open;
  vel.x = relax(vel.x, fx * gl, hr, dt);
  vel.z = relax(vel.z, fz * gl, hr, dt);
  return yaw;
}
