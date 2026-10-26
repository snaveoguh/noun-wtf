// ── The Big Drop's loop-de-loops: the path and the ride round it (pure) ──
//
// Every 'loop' feature on the track (track.ts) becomes a loop over the line:
// a funnel apron catches the rider anywhere across the lane, a straight run
// lines them up, then a circle of radius R (one full turn, or two on a
// double loop) carries them round and drops them back on the pad. Each turn
// also shifts sideways by `w`, a gentle helix, so the way out runs beside
// the way in instead of through it.
//
// LOOP-LOCAL coordinates (everything here): X = across the line (b),
// Y = up off the pad (n, square to the pad, so on a sloped pad the loop
// leans with it), Z = down the line (t). The origin is the bottom of the
// circle, on the line. `u` is arc length along the ride: 0 = where the
// rider is caught (Z = −approach), `approach` = the circle starts.
//
// The ride conserves energy exactly: v² = v0² − 2·g·Δh, with the height
// taken in the real (peak) vertical, so a loop on a sloped pad still feels
// the slope. Too slow over the top (the track's push v²κ + g·(inward·up)
// goes negative) and the rider falls off; slower still and they roll back
// out the way they came. No three.js here.

import type { Feature } from './contract';

import { centerX } from './track';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface LoopShape {
  /** Circle radius (m). */
  R: number;
  /** Full turns: 1 = a loop, 2 = a double loop. */
  turns: 1 | 2;
  /** Sideways shift per turn (m). */
  w: number;
  /** Half width of the riding deck between the parapets (m). */
  hw: number;
  /** Straight run from the catch line to the circle (m). */
  approach: number;
  /** Straight run out after the circle (m, drawn; the ride ends at the circle). */
  runout: number;
  /** Half width of the catch line (m): grounded riders this close are taken. */
  catchHalf: number;
  /** Funnel apron drawn uphill of the catch line (m). */
  funnel: number;
}

/** A loop's frame in peak coordinates. */
export interface LoopFrame {
  /** Bottom of the circle, on the line (peak coordinates). */
  e: Vec3;
  /** Unit down the line, along the pad. */
  t: Vec3;
  /** Unit up off the pad. */
  n: Vec3;
  /** Unit across the line: n × t (so X, Y, Z = b, n, t is right-handed). */
  b: Vec3;
}

/** A point on the ride, loop-local. */
export interface LoopSample {
  /** Position on the deck surface. */
  px: number;
  py: number;
  pz: number;
  /** Unit tangent (direction of increasing u). */
  tx: number;
  ty: number;
  tz: number;
  /** Unit deck normal: the rider's up (toward the loop's axis on the circle). */
  cx: number;
  cy: number;
  cz: number;
  /** Curvature of the path (1/m): 0 on the straights. */
  kappa: number;
  /** Angle round the circle (0 at the bottom, rad); −1 on the approach, > 2π·turns after. */
  phi: number;
}

export const newSample = (): LoopSample => ({
  px: 0,
  py: 0,
  pz: 0,
  tx: 0,
  ty: 0,
  tz: 1,
  cx: 0,
  cy: 1,
  cz: 0,
  kappa: 0,
  phi: -1,
});

const TAU = Math.PI * 2;

/** Deterministic 0..1 from a feature id. */
function idHash(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** The loop built at a 'loop' feature (its `size` is the radius). */
export function loopShape(f: Feature): LoopShape {
  const R = Math.max(12, f.size);
  const hw = 3;
  // One in three is a double loop
  const turns: 1 | 2 = idHash(f.id) < 1 / 3 ? 2 : 1;
  return {
    R,
    turns,
    w: 2 * hw + 2.6,
    hw,
    approach: R + 12,
    runout: R + 10,
    catchHalf: 17,
    funnel: 26,
  };
}

/** Helix arc length per radian. */
export function loopK(sh: LoopShape): number {
  return Math.hypot(sh.R, sh.w / TAU);
}

/** Arc length of the circle part (all turns). */
export function circleLength(sh: LoopShape): number {
  return TAU * sh.turns * loopK(sh);
}

/** Arc length at which the ride hands back (the bottom of the last turn). */
export function rideLength(sh: LoopShape): number {
  return sh.approach + circleLength(sh);
}

/** Total sideways shift. */
export const loopShift = (sh: LoopShape) => sh.turns * sh.w;

/** Deck centre X at angle φ round the circle (clamped to the circle). */
export function laneAt(sh: LoopShape, phi: number): number {
  const p = Math.min(TAU * sh.turns, Math.max(0, phi));
  return -loopShift(sh) / 2 + (sh.w * p) / TAU;
}

/** The ride at arc length u (any u: before 0 and after the end it runs straight on). */
export function sampleLoop(sh: LoopShape, u: number, out: LoopSample): LoopSample {
  const A = sh.approach;
  const C = circleLength(sh);
  const W = loopShift(sh);
  if (u <= A) {
    out.px = -W / 2;
    out.py = 0;
    out.pz = u - A;
    out.tx = 0;
    out.ty = 0;
    out.tz = 1;
    out.cx = 0;
    out.cy = 1;
    out.cz = 0;
    out.kappa = 0;
    out.phi = -1;
    return out;
  }
  if (u >= A + C) {
    out.px = W / 2;
    out.py = 0;
    out.pz = u - A - C;
    out.tx = 0;
    out.ty = 0;
    out.tz = 1;
    out.cx = 0;
    out.cy = 1;
    out.cz = 0;
    out.kappa = 0;
    out.phi = TAU * sh.turns + 1e-9;
    return out;
  }
  const k = loopK(sh);
  const R = sh.R;
  const phi = (u - A) / k;
  const s = Math.sin(phi);
  const c = Math.cos(phi);
  out.px = -W / 2 + (sh.w * phi) / TAU;
  out.py = R * (1 - c);
  out.pz = R * s;
  out.tx = sh.w / TAU / k;
  out.ty = (R * s) / k;
  out.tz = (R * c) / k;
  out.cx = 0;
  out.cy = c;
  out.cz = -s;
  out.kappa = R / (k * k);
  out.phi = phi;
  return out;
}

/** Loop-local → peak coordinates. */
export function framePoint(fr: LoopFrame, x: number, y: number, z: number, out: Vec3): Vec3 {
  out.x = fr.e.x + fr.b.x * x + fr.n.x * y + fr.t.x * z;
  out.y = fr.e.y + fr.b.y * x + fr.n.y * y + fr.t.y * z;
  out.z = fr.e.z + fr.b.z * x + fr.n.z * y + fr.t.z * z;
  return out;
}

/** Loop-local direction → peak direction. */
export function frameDir(fr: LoopFrame, x: number, y: number, z: number, out: Vec3): Vec3 {
  out.x = fr.b.x * x + fr.n.x * y + fr.t.x * z;
  out.y = fr.b.y * x + fr.n.y * y + fr.t.y * z;
  out.z = fr.b.z * x + fr.n.z * y + fr.t.z * z;
  return out;
}

/** Peak coordinates → loop-local. */
export function toFrame(fr: LoopFrame, x: number, y: number, z: number, out: Vec3): Vec3 {
  const dx = x - fr.e.x;
  const dy = y - fr.e.y;
  const dz = z - fr.e.z;
  out.x = dx * fr.b.x + dy * fr.b.y + dz * fr.b.z;
  out.y = dx * fr.n.x + dy * fr.n.y + dz * fr.n.z;
  out.z = dx * fr.t.x + dy * fr.t.y + dz * fr.t.z;
  return out;
}

/**
 * A loop's frame on its pad. `padHeight(x, z)` is the snow under the loop
 * (peak coordinates): the pad is fitted as a straight ramp along the line
 * (least squares over the feature's length), so the loop sits square on
 * it whether the pad is level or runs at the fall line's grade, raised
 * clear of any bump the fit leaves under the lanes.
 */
export function loopFrame(f: Feature, padHeight: (x: number, z: number) => number): LoopFrame {
  const s0 = f.s;
  const L = Math.max(10, f.len);
  const N = 9;
  let sy = 0;
  let ss = 0;
  let sss = 0;
  let ssy = 0;
  for (let i = 0; i < N; i++) {
    const s = s0 + (L * i) / (N - 1);
    const y = padHeight(centerX(s), s);
    const r = s - s0;
    sy += y;
    ss += r;
    sss += r * r;
    ssy += r * y;
  }
  const slope = (N * ssy - ss * sy) / (N * sss - ss * ss);
  const icpt = (sy - slope * ss) / N;
  const sE = s0 + L / 2;
  // Sit on the highest snow under the lanes, never buried in a bump (on a
  // carved pad this is nothing)
  let lift = 0;
  for (let i = 0; i < N; i++) {
    const s = s0 + (L * i) / (N - 1);
    const cx = centerX(s);
    const fit = icpt + slope * (s - s0);
    for (const dx of [-6, 0, 6]) lift = Math.max(lift, padHeight(cx + dx, s) - fit);
  }
  const e = { x: centerX(sE), y: icpt + slope * (L / 2) + lift, z: sE };
  // Down the line: the chord of the (gently weaving) centre line over the pad
  const dx = (centerX(s0 + L) - centerX(s0)) / L;
  const tl = Math.hypot(dx, slope, 1);
  const t = { x: dx / tl, y: slope / tl, z: 1 / tl };
  // Up off the pad: world up, made square to t
  const n0 = { x: -t.y * t.x, y: 1 - t.y * t.y, z: -t.y * t.z };
  const nl = Math.hypot(n0.x, n0.y, n0.z);
  const n = { x: n0.x / nl, y: n0.y / nl, z: n0.z / nl };
  const b = {
    x: n.y * t.z - n.z * t.y,
    y: n.z * t.x - n.x * t.z,
    z: n.x * t.y - n.y * t.x,
  };
  return { e, t, n, b };
}

/** The funnel's narrowing at arc length u: 1 on the catch line → 0 by 80% of the approach. */
export function catchBlend(sh: LoopShape, u: number): number {
  const k = Math.min(1, Math.max(0, u / (sh.approach * 0.8)));
  return 1 - k * k * (3 - 2 * k);
}

/** The funnel at arc length u: its centre X and half width (the ride's catch zone). */
export function funnelAt(sh: LoopShape, u: number): { x: number; half: number } {
  const k = 1 - catchBlend(sh, u);
  return { x: (-loopShift(sh) / 2) * k, half: sh.catchHalf * (1 - k) + sh.hw * k };
}

// ── The ride ─────────────────────────────────────────────────────────────

export type RideStatus = 'ride' | 'exit' | 'fall' | 'back';

/**
 * One rider going round one loop. `up` is world up in loop-local axes
 * (n.y·… from the frame: (b.y, n.y, t.y)), so heights are real heights.
 */
export class LoopRide {
  /** Arc length along the ride (m). */
  u: number;
  /** Signed speed along the path (m/s). */
  v: number;
  /** Twice the energy per unit mass: v² + 2·g·h, constant. */
  readonly e2: number;
  /** Where the rider really was when caught, relative to the path (blended out on the approach). */
  readonly offX: number;
  readonly offY: number;
  status: RideStatus = 'ride';
  /** The track's push on the rider per unit mass at the last step (m/s²; < 0 = falls off). */
  push = 0;
  private s = newSample();

  constructor(
    readonly shape: LoopShape,
    private readonly upX: number,
    private readonly upY: number,
    private readonly upZ: number,
    readonly g: number,
    u0: number,
    v0: number,
    offX = 0,
    offY = 0,
  ) {
    this.u = u0;
    this.v = v0;
    this.offX = offX;
    this.offY = offY;
    sampleLoop(shape, u0, this.s);
    this.e2 = v0 * v0 + 2 * g * this.height(this.s);
  }

  /** Real height (m) of a loop-local point above the frame origin. */
  height(p: { px: number; py: number; pz: number }): number {
    return this.upX * p.px + this.upY * p.py + this.upZ * p.pz;
  }

  /** v² the energy allows at arc length u. */
  v2At(u: number): number {
    sampleLoop(this.shape, u, this.s);
    return this.e2 - 2 * this.g * this.height(this.s);
  }

  /** How much of the catch offset is still applied at arc length u (1 → 0 over the approach). */
  blend(u: number): number {
    return catchBlend(this.shape, u);
  }

  /** Advance by dt. */
  step(dt: number): RideStatus {
    if (this.status !== 'ride') return this.status;
    const s = sampleLoop(this.shape, this.u, this.s);
    const g = this.g;
    // Gravity along the path moves you on…
    const along = -g * (this.upX * s.tx + this.upY * s.ty + this.upZ * s.tz);
    this.v += along * dt;
    this.u += this.v * dt;
    // …then the speed the energy allows where that puts you (exact),
    // keeping the integrated sign so a stall rolls back naturally
    const v2 = this.v2At(this.u);
    if (Math.abs(this.v) > 0.5 && v2 > 0) this.v = Math.sign(this.v) * Math.sqrt(v2);
    const end = rideLength(this.shape);
    if (this.u >= end) return (this.status = 'exit');
    if (this.u < 0) return (this.status = 'back');
    sampleLoop(this.shape, this.u, s);
    if (s.kappa > 0) {
      const vv = Math.max(0, this.e2 - 2 * g * this.height(s));
      this.push = vv * s.kappa + g * (this.upX * s.cx + this.upY * s.cy + this.upZ * s.cz);
      if (this.push < 0) return (this.status = 'fall');
    } else this.push = g * this.upY;
    return 'ride';
  }

  /** Where the rider is now (loop-local, catch offset blended in). */
  sample(out: LoopSample): LoopSample {
    sampleLoop(this.shape, this.u, out);
    const k = this.blend(this.u);
    if (k > 0) {
      out.px += this.offX * k;
      out.py += this.offY * k;
    }
    return out;
  }
}

/** Slowest speed at the bottom of a level loop that still makes the top: √(5gR) (κ ≈ 1/R). */
export function minLoopSpeed(sh: LoopShape, g: number): number {
  const k = loopK(sh);
  // At the top: v² ≥ g / κ, plus the climb of 2R
  return Math.sqrt(g * ((k * k) / sh.R) + 4 * g * sh.R);
}
