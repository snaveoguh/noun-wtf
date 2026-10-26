// ── The Big Drop's NPC hoverboarders: the riding itself (pure, no three.js) ──
//
// Each NPC rides the race line in track coordinates: `s` (peak z, the
// distance down the line), `lat` (metres off the centre line, + toward +x)
// and its peak-coordinate height `y`, sampled from the real surface every
// frame. Its pace is a multiple of the player's own speed down the line, so
// at any speed there are riders to overtake and riders that blast past at
// twice yours. They carve side to side across the lane (up the berms, the
// gully walls, round the loops, a few out in the powder), and fly ballistic
// arcs (gravity RIDER.g) off the kickers with a grab, a spin or a flip.
// Spawning keeps them within RIDER.window m of the player down the line:
// slow ones appear ahead (you catch them), fast ones behind (they catch you).
// riders.ts draws them.

import type { Feature, SectionKind } from './contract';

import { coneDepth, PEAK } from '../peakTerrain';

import { centerX, sectionAt, TRACK, widthAt } from './track';

export const RIDER = {
  /** Never further than this down / up the line from the player (m). */
  window: 1500,
  /** Gravity inside the Big Drop (40% of the player's 12.5 m/s²). */
  g: 5,
  /** Slowest an NPC rides (m/s down the line), even with the player stood still. */
  minSpeed: 14,
  /** How fast speed follows its target (1/s) and the most it changes (m/s²). */
  speedRate: 0.9,
  maxAccel: 60,
  /** Lateral spring (1/s²); damping is critical. */
  latK: 3.2,
  /** Kicker airs last this long (s) at most, whatever the speed. */
  maxAir: 8,
  /** Gap kept from the player (m): a gentle swerve, never a collision. */
  avoid: 3.2,
} as const;

export type RiderTrick = 'none' | 'grab' | 'spin' | 'flip' | 'backflip' | 'cork';

export interface RiderState {
  /** Track distance (peak z, m). */
  s: number;
  /** Signed offset from the centre line (m, + toward +x). */
  lat: number;
  latV: number;
  /** Lateral acceleration this frame (m/s², for the lean). */
  latA: number;
  /** Speed down the line (m/s of peak z). */
  v: number;
  /** Multiple of the player's speed this rider holds. */
  pace: number;
  /** Peak coordinates: x of the board, y of the board's underside. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  air: boolean;
  airT: number;
  /** Estimated length of this air (s), from the take-off. */
  airDur: number;
  /** Seconds since the last landing, and how hard it was (m/s into the snow). */
  sinceLand: number;
  landImpact: number;
  /** Carving: phase (rad), rate (rad/s), amplitude (0..1 of the half-lane), lane bias (m). */
  phase: number;
  rate: number;
  amp: number;
  bias: number;
  /** Rides out in the powder beside the lane. */
  powder: boolean;
  trick: RiderTrick;
  /** Total spin (rad) for spins and corks; flips are one turn. */
  spin: number;
  /** Seconds to the next hop on the flat. */
  hopIn: number;
  /** Seconds since it (re)spawned. */
  age: number;
  /** One-frame events. */
  launched: boolean;
  landed: boolean;
  /**
   * Free-riding the basin (basinStep) instead of the line: heading (rad,
   * atan2(dx, dz)), speed over the snow (m/s), and the kicker it's lining
   * up for (its ramp foot and facing), re-picked every `aimT` s.
   */
  free: boolean;
  hd: number;
  sp: number;
  aiming: boolean;
  aimX: number;
  aimZ: number;
  aimDx: number;
  aimDz: number;
  aimT: number;
}

export interface RiderEnv {
  /** Surface height at (x, z), peak coordinates. */
  height(x: number, z: number): number;
  /** The player in track coordinates, and their speed down the line (m/s). */
  riderS: number;
  riderLat: number;
  riderV: number;
  /** Kickers, berms, loops near here (any order). */
  features: readonly Feature[];
}

/** A random source in [0, 1). */
export type Rng = () => number;

export function riderCreate(): RiderState {
  return {
    s: 0,
    lat: 0,
    latV: 0,
    latA: 0,
    v: RIDER.minSpeed,
    pace: 1,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    air: false,
    airT: 0,
    airDur: 0,
    sinceLand: 9,
    landImpact: 0,
    phase: 0,
    rate: 1,
    amp: 0.5,
    bias: 0,
    powder: false,
    trick: 'none',
    spin: 0,
    hopIn: 8,
    age: 0,
    launched: false,
    landed: false,
    free: false,
    hd: 0,
    sp: RIDER.minSpeed,
    aiming: false,
    aimX: 0,
    aimZ: 0,
    aimDx: 0,
    aimDz: 1,
    aimT: 0,
  };
}

/** Scale between a lateral offset (perpendicular, m) and x at `s`. */
function latScale(s: number): number {
  const dx = (centerX(s + 1) - centerX(s - 1)) / 2;
  return Math.hypot(dx, 1);
}

/** Peak x of a point `lat` m off the centre line at `s`. */
export function riderX(s: number, lat: number): number {
  return centerX(s) + lat * latScale(s);
}

/** The bare cone's fall rate (m of height per m of z) under the line at `s`. */
export function riderSlope(s: number): number {
  const r = Math.max(0.5, s) - PEAK.pad;
  return coneDepth(r + 0.5) - coneDepth(r - 0.5);
}

/**
 * The pace bands: slow riders you catch, riders alongside you, and fast
 * ones that blast past at up to ~2.2× your speed.
 */
export function riderPickPace(rng: Rng): number {
  const u = rng();
  if (u < 0.36) return 0.55 + rng() * 0.33;
  if (u < 0.64) return 0.94 + rng() * 0.16;
  return 1.45 + rng() * 0.75;
}

/** Where a respawn goes, relative to the player down the line (m). */
export function riderSpawnOffset(pace: number, riderV: number, rng: Rng): number {
  const v = Math.max(0, riderV);
  if (pace < 0.92) {
    // Ahead, far enough that it takes a while to catch them
    if (v < 6) return 80 + rng() * 520;
    return Math.min(1200, Math.max(140, v * (1 - pace) * (6 + rng() * 10)));
  }
  if (pace < 1.12) return rng() < 0.5 ? 70 + rng() * 180 : -(50 + rng() * 120);
  // Behind (out of the camera's view), close enough to arrive soon
  if (v < 6) return -(40 + rng() * 120);
  return -Math.min(1000, Math.max(60, v * (pace - 1) * (3 + rng() * 5)));
}

/** (Re)spawn a rider somewhere round the player. `initial` spreads them out ahead. */
export function riderSpawn(
  r: RiderState,
  env: Pick<RiderEnv, 'height' | 'riderS' | 'riderV'>,
  rng: Rng,
  initial = false,
): RiderState {
  r.free = false;
  r.pace = riderPickPace(rng);
  const off = initial ? 30 + rng() * 700 : riderSpawnOffset(r.pace, env.riderV, rng);
  r.s = Math.min(TRACK.end - 10, Math.max(TRACK.start + 30, env.riderS + off));
  const half = widthAt(r.s) / 2;
  r.powder = rng() < 0.2;
  r.bias = r.powder
    ? (rng() < 0.5 ? -1 : 1) * (half + 6 + rng() * 20)
    : (rng() * 2 - 1) * half * 0.35;
  r.lat = r.bias;
  r.latV = 0;
  r.latA = 0;
  r.amp = 0.35 + rng() * 0.5;
  // A turn every 1.6–3.4 s
  r.rate = (2 * Math.PI) / (3.2 + rng() * 3.6);
  r.phase = rng() * Math.PI * 2;
  r.v = Math.max(RIDER.minSpeed, env.riderV * r.pace);
  r.x = riderX(r.s, r.lat);
  r.y = env.height(r.x, r.s);
  r.vx = 0;
  r.vy = -riderSlope(r.s) * r.v;
  r.air = false;
  r.airT = 0;
  r.airDur = 0;
  r.sinceLand = 9;
  r.landImpact = 0;
  r.trick = 'none';
  r.spin = 0;
  r.hopIn = 4 + rng() * 12;
  r.age = 0;
  r.launched = false;
  r.landed = false;
  return r;
}

/**
 * Should this rider be recycled? Out of the window, or somewhere the player
 * will never see it again (a slow one far behind, a fast one far ahead).
 */
export function riderShouldRecycle(r: RiderState, riderS: number, riderV: number): boolean {
  const ds = r.s - riderS;
  if (Math.abs(ds) > RIDER.window) return true;
  if (r.s >= TRACK.end - 20) return true;
  const rel = r.v - Math.max(0, riderV);
  if (ds < -260 && rel <= 0.5) return true;
  if (ds > 1200 && rel > 0.5) return true;
  return false;
}

/** Where on the lane a rider wants to be (m off the centre line). */
export function riderLaneTarget(
  r: RiderState,
  kind: SectionKind,
  half: number,
  features: readonly Feature[],
): number {
  const s = r.s;
  // Berms and loops override the carve
  for (const f of features) {
    if (s < f.s - 40 || s > f.s + f.len + 10) continue;
    if (f.kind === 'berm' && !r.powder) return f.side * (half - 1.5);
    if (f.kind === 'loop') return (r.bias >= 0 ? 1 : -1) * Math.max(4, half - 3);
  }
  const wave = Math.sin(r.phase);
  if (r.powder) return r.bias + wave * 9 * r.amp;
  // Gully: up one wall and the other; slalom: the line itself weaves, so
  // carve less; cruise: big wide turns
  const k = kind === 'gully' ? 0.95 : kind === 'slalom' ? 0.35 : kind === 'jumps' ? 0.45 : r.amp;
  const t = r.bias + wave * (half - 2) * k;
  return Math.max(-(half - 1), Math.min(half - 1, t));
}

/** A lateral nudge (m) away from the player when close: a swerve, not a crash. */
export function riderAvoid(s: number, lat: number, riderS: number, riderLat: number): number {
  const ds = Math.abs(s - riderS);
  if (ds > 8) return 0;
  const dl = lat - riderLat;
  if (Math.abs(dl) >= RIDER.avoid) return 0;
  const side = dl >= 0 ? 1 : -1;
  return side * (RIDER.avoid - Math.abs(dl)) * (1 - ds / 8) * 1.6;
}

/** Pick an air trick for an air of `dur` seconds. */
export function riderPickTrick(dur: number, rng: Rng): { trick: RiderTrick; spin: number } {
  const u = rng();
  if (dur < 1.6)
    return u < 0.55 ? { trick: 'grab', spin: 0 } : { trick: 'spin', spin: Math.PI * 2 };
  if (dur < 3.2) {
    if (u < 0.35) return { trick: 'grab', spin: 0 };
    if (u < 0.75) return { trick: 'spin', spin: Math.PI * (rng() < 0.5 ? 2 : 3) };
    return { trick: 'flip', spin: 0 };
  }
  // Big air: the big tricks
  if (u < 0.25) return { trick: 'grab', spin: 0 };
  if (u < 0.55) return { trick: 'spin', spin: Math.PI * (4 + Math.floor(rng() * 3)) };
  if (u < 0.8) return { trick: 'backflip', spin: 0 };
  return { trick: 'cork', spin: Math.PI * (3 + Math.floor(rng() * 2) * 2) };
}

/** 0..1 through the air trick (it finishes before the landing). */
export function riderTrickK(r: RiderState): number {
  if (!r.air || r.airDur <= 0) return 0;
  const k = Math.min(1, r.airT / (r.airDur * 0.78));
  return k * k * (3 - 2 * k);
}

/** Vertical take-off speed relative to the slope for an air of `dur` s. */
export const riderPopFor = (dur: number) => (RIDER.g * dur) / 2;

/** Take off: `relVy` m/s up off a slope falling at `slopeVy`, with a trick to fit the air. */
export function riderLaunch(r: RiderState, relVy: number, slopeVy: number, rng: Rng) {
  const rel = Math.min(riderPopFor(RIDER.maxAir), Math.max(0.5, relVy));
  r.air = true;
  r.airT = 0;
  r.vy = slopeVy + rel;
  r.airDur = (2 * rel) / RIDER.g;
  const t = riderPickTrick(r.airDur, rng);
  r.trick = t.trick;
  r.spin = t.spin;
  r.launched = true;
}

/** One frame of riding. */
export function riderStep(r: RiderState, dt: number, env: RiderEnv, rng: Rng): void {
  r.launched = false;
  r.landed = false;
  r.age += dt;
  r.sinceLand += dt;
  // Pace: a multiple of the player's speed down the line
  const want = Math.max(RIDER.minSpeed, Math.max(0, env.riderV) * r.pace);
  const dv = (want - r.v) * (1 - Math.exp(-RIDER.speedRate * dt));
  r.v += Math.max(-RIDER.maxAccel * dt, Math.min(RIDER.maxAccel * dt, dv));
  const s0 = r.s;
  r.s = Math.min(TRACK.end, s0 + r.v * dt);
  // Carve across the lane (a damped spring toward the target)
  r.phase += r.rate * dt;
  const half = widthAt(r.s) / 2;
  const kind = sectionAt(r.s).kind;
  const target =
    riderLaneTarget(r, kind, half, env.features) + riderAvoid(r.s, r.lat, env.riderS, env.riderLat);
  if (!r.air) {
    const k = RIDER.latK;
    r.latA = k * (target - r.lat) - 2 * Math.sqrt(k) * r.latV;
    r.latV += r.latA * dt;
  } else r.latA *= Math.exp(-4 * dt);
  r.lat += r.latV * dt;
  const x0 = r.x;
  r.x = riderX(r.s, r.lat);
  r.vx = dt > 0 ? (r.x - x0) / dt : 0;
  const h = env.height(r.x, r.s);
  const slopeVy = -riderSlope(r.s) * r.v;
  if (r.air) {
    r.airT += dt;
    r.vy -= RIDER.g * dt;
    r.y += r.vy * dt;
    if (r.y <= h) {
      // Into the snow at the slope's own fall rate: the rest is the impact
      r.landImpact = Math.max(0, slopeVy - r.vy) * 0.66;
      r.y = h;
      r.vy = slopeVy;
      r.air = false;
      r.trick = 'none';
      r.spin = 0;
      r.sinceLand = 0;
      r.landed = true;
      r.hopIn = Math.max(r.hopIn, 2 + rng() * 6);
    }
    return;
  }
  // On the snow: kicker lips throw you, so does ground falling away
  // faster than gravity can follow (the player's own rule: the snap)
  const prevVy = r.vy;
  const groundVy = dt > 0 ? (h - r.y) / dt : slopeVy;
  for (const f of env.features) {
    if (f.kind !== 'kicker') continue;
    const lip = f.s + f.len;
    if (s0 < lip && r.s >= lip && Math.abs(r.lat) < half + 3) {
      const dur = Math.min(RIDER.maxAir, Math.max(2.4, 1.6 + f.size * 0.36) * (0.85 + rng() * 0.3));
      riderLaunch(r, Math.max(riderPopFor(dur), prevVy - slopeVy), slopeVy, rng);
      r.y = Math.max(r.y, h);
      return;
    }
  }
  const speed3 = Math.hypot(r.v, r.vx, prevVy);
  const snap = 0.08 + Math.min(0.35, speed3 * 0.03);
  const ballistic = r.y + prevVy * dt - 0.5 * RIDER.g * dt * dt;
  if (h < ballistic - snap && prevVy - slopeVy > 0.5) {
    riderLaunch(r, prevVy - slopeVy, slopeVy, rng);
    r.y = ballistic;
    return;
  }
  // The odd hop on the flat, with a grab or a 360
  r.hopIn -= dt;
  if (r.hopIn <= 0 && r.sinceLand > 1.5) {
    r.hopIn = 6 + rng() * 14;
    riderLaunch(r, riderPopFor(1.1 + rng() * 0.6), slopeVy, rng);
    r.y = h;
    return;
  }
  r.y = h;
  r.vy = groundVy;
}
