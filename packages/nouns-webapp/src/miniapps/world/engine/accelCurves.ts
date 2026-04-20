// ── Acceleration curves ──────────────────────────────────────────────
//
// Ease-in/out-ish approaches for velocity → target. Used by locomotion
// substates to retune ground vs. air feel without repeating the same
// `v += (target - v) * k` expression everywhere.
//
// `dt` is seconds (or frame-units at 60fps; just stay consistent). The
// `k` factor is the smoothing strength — higher = snappier.

/**
 * Exponential approach toward target over dt. Framerate-independent
 * enough for 60fps locked steps. At `k=8`, reaches ~63% of target in
 * 1/k seconds.
 */
export function expApproach(current: number, target: number, dt: number, k: number): number {
  // 1 - e^(-k*dt) is the classic framerate-independent lerp fraction.
  const t = 1 - Math.exp(-k * dt);
  return current + (target - current) * t;
}

/**
 * Ground accel. Punchy but not snap-to-target. Use for grounded move.
 * `k` defaults to 8 — roughly 0.12s to reach 63% of target speed.
 */
export function groundAccel(current: number, target: number, dt: number, k = 8): number {
  return expApproach(current, target, dt, k);
}

/**
 * Air accel. ~25% of ground authority by default (k=2). Makes jumps
 * feel committed — you can steer mid-air, but not zig-zag.
 */
export function airAccel(current: number, target: number, dt: number, k = 2): number {
  return expApproach(current, target, dt, k);
}

/**
 * Smoothstep — classic Hermite curve for [0,1] t. Used by mantle/slide
 * timing curves where we want acceleration at both ends to be zero.
 */
export function smoothstep(t: number): number {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * (3 - 2 * t);
}

/** Two-vector easing toward target. Handy for vx/vy at once. */
export function approach2(
  curX: number,
  curY: number,
  tgtX: number,
  tgtY: number,
  dt: number,
  k: number,
): { x: number; y: number } {
  return {
    x: expApproach(curX, tgtX, dt, k),
    y: expApproach(curY, tgtY, dt, k),
  };
}
