// ── The Big Drop's SSX boost: the meter and the burn (pure) ─────────────
//
// SSX's adrenaline: the meter fills from riding with style (air time,
// grabs, grinds, the points of every combo you land) and drains on a bail.
// Tap BOOST (Tab / gamepad X / the touch button) and a chunk of it burns:
// for a second and a bit the board drives forward (BOOST.accel) and the
// course's speed governor lets you run up to BOOST.capK × its cap. Boost
// pads on the course give a free burn. A full meter shows FULL; tapping
// then burns it all in one long TRICKY burst.

export const BOOST = {
  /** One tap burns this much of the meter … */
  cost: 0.25,
  /** … for this long (s); taps while burning stack, up to `maxBurn`. */
  burn: 1.2,
  maxBurn: 3,
  /** A full meter tapped burns it all for this long. */
  tricky: 4,
  /** A boost pad: a free burn this long, and a kick of speed (m/s). */
  padBurn: 1.4,
  padKick: 8,
  /** Drive while burning (m/s², along the board). */
  accel: 16,
  /** The governor's cap is raised this much while burning. */
  capK: 1.45,
  /** Filling: per second in the air, grabbing (on top), grinding. */
  air: 0.035,
  grab: 0.07,
  grind: 0.14,
  /** Per point of a landed combo. */
  perPoint: 1 / 3000,
  /** A bail loses this share of the meter. */
  bailLoss: 0.5,
} as const;

export interface BoostState {
  /** 0..1. */
  meter: number;
  /** Seconds of burn left. */
  burn: number;
  /** This burn is a TRICKY (a full meter in one go). */
  tricky: boolean;
}

export function createBoost(): BoostState {
  return { meter: 0, burn: 0, tricky: false };
}

export function fillBoost(b: BoostState, amount: number) {
  if (amount > 0) b.meter = Math.min(1, b.meter + amount);
}

/** Fill from one frame of riding. */
export function fillFromRiding(
  b: BoostState,
  dt: number,
  state: 'air' | 'grind' | 'ground' | 'other',
  grabbing: boolean,
) {
  if (state === 'air') fillBoost(b, (BOOST.air + (grabbing ? BOOST.grab : 0)) * dt);
  else if (state === 'grind') fillBoost(b, BOOST.grind * dt);
}

/** A combo landed for `points`. */
export function fillFromCombo(b: BoostState, points: number) {
  fillBoost(b, Math.max(0, points) * BOOST.perPoint);
}

/** Tap: burn from the meter. False if there isn't enough. */
export function tapBoost(b: BoostState): boolean {
  if (b.meter >= 0.999) {
    b.meter = 0;
    b.burn = Math.max(b.burn, BOOST.tricky);
    b.tricky = true;
    return true;
  }
  if (b.meter < BOOST.cost - 1e-9) return false;
  b.meter -= BOOST.cost;
  b.burn = Math.min(BOOST.maxBurn, b.burn + BOOST.burn);
  return true;
}

/** Rolled over a boost pad. */
export function padBoost(b: BoostState) {
  b.burn = Math.min(BOOST.maxBurn, Math.max(b.burn, BOOST.padBurn));
}

/** Bailed: lose some of the meter and any burn. */
export function bailBoost(b: BoostState) {
  b.meter *= 1 - BOOST.bailLoss;
  b.burn = 0;
  b.tricky = false;
}

/** Advance the burn. True while burning. */
export function stepBoost(b: BoostState, dt: number): boolean {
  if (b.burn <= 0) return false;
  b.burn = Math.max(0, b.burn - dt);
  if (b.burn === 0) b.tricky = false;
  return true;
}

/** The governor: how fast the excess goes (s), and the hardest it ever brakes (m/s²). */
export const GOVERN = { tau: 0.4, maxDecel: 12 } as const;

/**
 * The course's governor (m/s) for a board at `speed` under a cap: over the
 * cap the excess bleeds off (a 0.4 s time constant, so the slope's pull
 * only holds you ~1.5 m/s over it), but never harder than 12 m/s², so a
 * landing at speed eases back instead of hitting a wall. Burning raises the
 * cap. Returns the governed speed.
 */
export function governSpeed(speed: number, cap: number, burning: boolean, dt: number): number {
  const c = burning ? cap * BOOST.capK : cap;
  if (speed <= c) return speed;
  const target = c + (speed - c) * Math.exp(-dt / GOVERN.tau);
  return Math.max(target, speed - GOVERN.maxDecel * dt);
}
