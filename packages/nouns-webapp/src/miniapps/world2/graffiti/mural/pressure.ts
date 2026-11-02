// ── Pen feel: pressure curve, tilt, finger "pressure", stabiliser ───────
//
// Pure (no DOM, no three.js). Mural mode turns every pointer sample into a
// nozzle radius on the wall (mm) with penRadius(), smooths the line with a
// Stabiliser (a "pulled string": the brush trails the pen by up to a few
// pixels, so hand wobble never reaches the wall) and the pressure with a
// short low-pass so a jittery pen doesn't cut a stroke into dozens of runs.

import { MAX_RADIUS_MM, MIN_RADIUS_MM } from '../strokes';

export interface PenFeel {
  /** -1 soft (a light touch is already wide) … 0 linear … +1 firm (press hard for width). */
  curve: number;
  /** Width at the lightest touch, as a fraction of the nozzle (0.05..1). */
  minSize: number;
  /** How much a tilted pen widens the spray (0 off .. 1 = up to 1.8×). */
  tilt: number;
  /** Line smoothing 0 (raw) .. 1 (heavy). */
  smoothing: number;
  /** Fingers paint with contact size as pressure (else a steady width). */
  fingerPressure: boolean;
}

export const DEFAULT_FEEL: PenFeel = {
  curve: 0,
  minSize: 0.2,
  tilt: 0.5,
  smoothing: 0.35,
  fingerPressure: true,
};

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : Number.isFinite(x) ? x : 0);

/** Pressure 0..1 through the curve: γ = 2^(1.6·curve), so 0 is linear. */
export function curvePressure(p: number, curve: number): number {
  const c = Math.max(-1, Math.min(1, curve));
  return Math.pow(clamp01(p), Math.pow(2, 1.6 * c));
}

/**
 * Nozzle radius (mm) for one sample: the tool's radius scaled between
 * minSize (lightest) and 1 (full press), widened by tilt like a can held
 * at an angle, clamped to what the wire can carry.
 */
export function penRadius(base: number, pressure: number, tilt01: number, feel: PenFeel): number {
  const lo = Math.max(0.05, Math.min(1, feel.minSize));
  const k = curvePressure(pressure, feel.curve);
  let r = base * (lo + (1 - lo) * k);
  const t = clamp01(tilt01);
  r *= 1 + 0.8 * clamp01(feel.tilt) * t * t;
  return Math.max(MIN_RADIUS_MM, Math.min(MAX_RADIUS_MM, r));
}

/**
 * How far the pen leans: 0 upright … 1 flat on the glass. Uses the pointer
 * event's altitudeAngle when there is one (Safari / new Chrome), else tiltX
 * / tiltY (degrees).
 */
export function tiltOf(e: { altitudeAngle?: number; tiltX?: number; tiltY?: number }): number {
  if (typeof e.altitudeAngle === 'number' && Number.isFinite(e.altitudeAngle))
    return clamp01(1 - e.altitudeAngle / (Math.PI / 2));
  const tx = ((e.tiltX ?? 0) * Math.PI) / 180;
  const ty = ((e.tiltY ?? 0) * Math.PI) / 180;
  if (tx === 0 && ty === 0) return 0;
  const a = Math.atan(Math.hypot(Math.tan(tx), Math.tan(ty)));
  return clamp01(a / (Math.PI / 2));
}

/**
 * A finger's "pressure" from its contact size (CSS px, as iPadOS reports
 * it: 2 × the contact radius): a light fingertip ~30 px → 0.15, a pad
 * pressed flat ~75 px → 1. Null when the browser doesn't report a real
 * size (emulators and some browsers send 1–2 px).
 */
export function touchPressure(width: number, height: number): number | null {
  const d = Math.max(width, height);
  if (!(d >= 6)) return null;
  return clamp01(0.15 + ((d - 30) / 45) * 0.85);
}

/** Press-and-hold "pressure" (the size pad): grows over about a second. */
export function holdPressure(ms: number): number {
  return clamp01(1 - Math.exp(-Math.max(0, ms) / 600));
}

/**
 * The pen pressure a pointer sample stands for: the pen's own, a finger's
 * contact size, or 1 (mouse / no data: the nozzle as set).
 */
export function samplePressure(
  type: string,
  pressure: number,
  width: number,
  height: number,
  feel: PenFeel,
): number {
  if (type === 'pen') return pressure > 0 ? clamp01(pressure) : 0.5;
  if (type === 'touch' && feel.fingerPressure) return touchPressure(width, height) ?? 1;
  return 1;
}

/**
 * Lazy-string stabiliser. The brush (x, y) trails the pen on a string of
 * `len` px: it only moves once the pen pulls the string tight, and then
 * along the pen's line. len 0 = raw. No allocation per sample.
 */
export class Stabiliser {
  x = 0;
  y = 0;
  private len = 0;

  /** Max string length (px) at smoothing 1. */
  static readonly MAX_LEN = 26;

  reset(x: number, y: number, smoothing: number) {
    this.x = x;
    this.y = y;
    this.len = clamp01(smoothing) * Stabiliser.MAX_LEN;
  }

  /** Feed a pen position; true if the brush moved. */
  push(px: number, py: number): boolean {
    const dx = px - this.x;
    const dy = py - this.y;
    const d = Math.hypot(dx, dy);
    if (d <= this.len) return this.len === 0 && d > 0 ? this.snap(px, py) : false;
    const k = (d - this.len) / d;
    this.x += dx * k;
    this.y += dy * k;
    return true;
  }

  private snap(px: number, py: number) {
    this.x = px;
    this.y = py;
    return true;
  }
}

/** Exponential smoothing of pressure, by time (ms), dt-independent. */
export class PressureFilter {
  v = 0;
  private t = 0;
  private on = false;

  constructor(private tauMs = 14) {}

  reset(p: number, t: number) {
    this.v = p;
    this.t = t;
    this.on = true;
  }

  push(p: number, t: number): number {
    if (!this.on) {
      this.reset(p, t);
      return p;
    }
    const dt = Math.max(0, t - this.t);
    this.t = t;
    const k = 1 - Math.exp(-dt / this.tauMs);
    this.v += (p - this.v) * k;
    return this.v;
  }
}
