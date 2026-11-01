// ── Skydiving: the shared contract (pure types + tuning) ────────────────
//
// A long fall (out of NOUNS CAMP's window, off any tall roof) becomes a
// skydive: freefall with drag toward a terminal velocity that depends on
// the body position, tracking (steering across the ground), yaw turns,
// and a parachute on the jump key. The sim (sim/freefall.ts) only shapes
// the rider's velocity: skate/Player still integrates, collides and lands,
// so the parkour hard landing / roll, the board's bail rules and the
// game's substeps (no tunnelling at terminal) all still apply.

/** Mutable vector (the Player's THREE.Vector3 fits). */
export interface V3 {
  x: number;
  y: number;
  z: number;
}

export type SkyPhase = 'off' | 'freefall' | 'canopy';
/**
 * Freefall body positions: belly-to-earth (the default arch), a head-down
 * dive (fast), a flare (arms and legs spread wide: slow) and a track
 * (arms back, legs straight: across the ground).
 */
export type Posture = 'belly' | 'dive' | 'flare' | 'track';

export interface SkyInput {
  /** −1..1: left / right turns (yaw). */
  moveX: number;
  /** −1..1: forward tracks, back flares (freefall); faster / brakes (canopy). */
  moveY: number;
  /** Held: dive (freefall). */
  dive: boolean;
  /** Pressed this step: pull the parachute. */
  pull: boolean;
}

export const SKY = {
  /** The game's gravity (skate/Player DEFAULT_TUNING). */
  gravity: 12.5,

  // ── Entering freefall ──
  /**
   * Clear air under the feet (m) before a fall counts as a skydive: more
   * than a jump off the ring's roofs (~20 m) ever has.
   */
  enterClear: 24,
  /** Seconds airborne first (ordinary jumps and drops never get there). */
  enterDelay: 0.35,
  /** Falling at least this fast (m/s, down). */
  enterVy: -4,
  /** Anything parkour could catch this close (m) keeps it a parkour fall. */
  catchReach: 1.25,
  /**
   * Where a board air never turns into a skydive by itself (the mountain,
   * the mega ramps: their airs are records), one this high (m of clear air)
   * offers it instead: jump takes it (and the air stops counting).
   */
  offerClear: 45,
  /** …once it's been airborne this long (s). */
  offerAirT: 0.3,

  // ── Freefall ──
  /** Terminal velocities (m/s) per body position. */
  vt: { belly: 55, dive: 75, flare: 45, track: 52 } as Record<Posture, number>,
  /** How fast the terminal velocity follows a change of position (1/s). */
  vtRate: 1.6,
  /** Tracking: top horizontal speed (m/s) and how quickly it builds (1/s). */
  trackMax: 14,
  trackRate: 0.7,
  /** No input: horizontal speed bleeds off at this rate (1/s). */
  coastRate: 0.25,
  /** A dive carries a little forward speed; a flare drifts back. */
  diveFwd: 4,
  flareBack: 2,
  /** Turn rate (rad/s). */
  yawRate: 1.7,

  // ── Parachute ──
  /** Can't pull with less clear air than this (m): it wouldn't open in time. */
  pullMin: 30,
  /** The HUD's PULL prompt shows under this height (m). */
  pullPrompt: 90,
  /** The canopy opens over this long (s). */
  openTime: 1,
  /** Descent (m/s) under canopy: normal, holding forward, braking (back). */
  canopyVy: 6,
  canopyVyFast: 7.5,
  canopyVyBrake: 4.2,
  /** Forward glide (m/s): normal, holding forward, braking. */
  glide: 5.5,
  glideFast: 8.5,
  glideBrake: 2.2,
  /** Canopy turn rate (rad/s). */
  canopyTurn: 1,
} as const;
