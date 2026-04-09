// ── Hoverboard Physics & Trick System ────────────────────────────────
//
// THPS-style "marble on surface" physics adapted for a hoverboard.
//
// Controls:
//   S near hoverboard pickup = mount/dismount
//   Space while on ground    = ollie (upward impulse, amplified at ramp lip)
//   Space while airborne     = 180 spin (+100 per 180)
//   Space + Left (airborne)  = kickflip (+200)
//   Space + Right (airborne) = heelflip (+200)
//   Space + Up (airborne)    = hardflip (+300)
//   Space + Down (airborne)  = pop shove-it (+150)
//   J while airborne         = 180 spin (+100 per 180)
//   K while airborne         = kickflip (+200)
//   Near rail (0.5 units)    = auto-snap grind (balance meter active)
//   G near rail              = manual grind start
//   Up-Up / Down-Down        = manual / nose manual (links combos on ground)
//   Shift (hold)             = crouch/pump — release on curve for speed boost
//   Left/Right while grind/manual = balance correction
//
// Core physics (Neversoft approach):
//   speed = sqrt(2 * g * heightDropped)        — energy conservation on ramps
//   y = launchY + vy*t - 0.5*g*t^2             — projectile motion in air
//   Surface normal alignment: player tilts to match ground slope
//   Momentum preservation through transitions (flat → ramp → vert → air)

// ── Types ────────────────────────────────────────────────────────────

export interface SkatingState {
  isSkating: boolean;
  speed: number;
  momentum: [number, number]; // [mx, mz] direction of travel
  onRamp: boolean;
  airborne: boolean;
  airborneVy: number;
  airborneY: number; // visual Y offset
  airborneTime: number; // seconds since launch (for projectile eq.)
  launchY: number; // world Y at launch
  launchVy: number; // initial vertical velocity at launch
  trickScore: number;
  comboScore: number; // current combo accumulator (lost on bail)
  comboMultiplier: number; // trick count in current combo
  currentTrick: string | null;
  trickTimer: number; // frames remaining for trick display
  grindTimer: number; // accumulated grind seconds
  grindActive: boolean;
  manualActive: boolean; // manual/nose manual balance mode
  manualIsNose: boolean;
  balanceMeter: number; // -1 to 1 — center is balanced
  balanceOscillation: number; // difficulty oscillation phase
  balanceDifficulty: number; // increases over time
  lastDirection: [number, number];
  ollieCooldown: number;
  crouching: boolean; // shift held — pump charging
  crouchStartSpeed: number; // speed when crouch began
  surfaceNormalY: number; // current surface tilt (0=flat, 1=vertical wall)
  surfaceSlopeDir: [number, number]; // downhill direction
  heightRef: number; // reference height for energy calc
  spinAngle: number; // accumulated spin in air (degrees)
  bailed: boolean; // ragdoll state
  bailTimer: number; // frames of bail animation remaining
  hoverHeight: number; // current hover offset (oscillates ~0.3)
}

export interface RampData {
  onRamp: boolean;
  rampNormalY: number; // upward slope component (0 = flat, 1 = vertical)
  rampSlopeDir: [number, number]; // direction the slope faces (downhill)
  atLip: boolean; // at top edge of ramp
  onRail: boolean; // on grind rail geometry
  surfaceHeight: number; // ground Y at this point on the ramp
  railDistance: number; // distance to nearest rail center (for auto-snap)
}

// ── Constants ────────────────────────────────────────────────────────

const GRAVITY = 9.81; // m/s^2 (world scale)
const GRAVITY_TICK = 0.025; // per-frame gravity for airborne (tuned for 60fps feel)
const FLAT_FRICTION = 0.998;
const AIR_FRICTION = 0.9995; // almost none in air
const RAMP_FRICTION = 0.999; // minimal on ramp surface
const GRIND_FRICTION = 0.996;
const SPEED_CAP = 4; // much lower — controllable cruising speed
const PUSH_FORCE = 0.035; // gentle WASD acceleration
const PUSH_FORCE_AIR = 0.005; // tiny air nudge
const OLLIE_FORCE = 0.3; // solid pop
const OLLIE_RAMP_BONUS = 0.25; // big boost off ramp lip
const OLLIE_SPEED_BONUS_FACTOR = 0.03; // speed → vertical conversion
const OLLIE_COOLDOWN_FRAMES = 12;
const GROUND_Y = 0;

// Pump mechanic
const PUMP_BOOST_MIN = 1.05; // minimum multiplier on release
const PUMP_BOOST_MAX = 1.35; // max multiplier when releasing on curve
// const PUMP_CHARGE_RATE = 0.02; // charge per frame while crouching (TODO: wire up)

// Hover
const HOVER_BASE = 0.3; // base hover height
const HOVER_OSCILLATION = 0.04; // gentle bob

// Trick scores
const OLLIE_SCORE = 25;
const SPIN_180_SCORE = 100;
const KICKFLIP_SCORE = 200;
const HEELFLIP_SCORE = 200;
const HARDFLIP_SCORE = 300;
const POP_SHOVE_SCORE = 150;
const GRIND_SCORE_PER_SEC = 50;
const MANUAL_SCORE_PER_SEC = 30;
const RAMP_LIP_BONUS = 75;

const TRICK_DISPLAY_FRAMES = 90; // 1.5s at 60fps

// Grind auto-snap
const GRIND_SNAP_DISTANCE = 0.5; // world units — auto-snap to rail within this range

// Balance
const BALANCE_OSCILLATION_SPEED = 2.5; // radians/sec
const BALANCE_DIFFICULTY_RAMP = 0.008; // difficulty increase per frame
const BALANCE_MAX_DIFFICULTY = 0.85;
const BALANCE_FAIL_THRESHOLD = 0.95; // meter beyond this = bail

// Bail
const BAIL_DURATION_FRAMES = 90; // 1.5s ragdoll
const BAIL_LANDING_ANGLE = 0.75; // max landing angle before bail (cos of 41 degrees)

// ── Factory ──────────────────────────────────────────────────────────

export function createSkatingState(): SkatingState {
  return {
    isSkating: false,
    speed: 0,
    momentum: [0, 0],
    onRamp: false,
    airborne: false,
    airborneVy: 0,
    airborneY: 0,
    airborneTime: 0,
    launchY: 0,
    launchVy: 0,
    trickScore: 0,
    comboScore: 0,
    comboMultiplier: 0,
    currentTrick: null,
    trickTimer: 0,
    grindTimer: 0,
    grindActive: false,
    manualActive: false,
    manualIsNose: false,
    balanceMeter: 0,
    balanceOscillation: 0,
    balanceDifficulty: 0.15,
    lastDirection: [0, 1],
    ollieCooldown: 0,
    crouching: false,
    crouchStartSpeed: 0,
    surfaceNormalY: 0,
    surfaceSlopeDir: [0, 0],
    heightRef: 0,
    spinAngle: 0,
    bailed: false,
    bailTimer: 0,
    hoverHeight: HOVER_BASE,
  };
}

// ── Mount / Dismount ─────────────────────────────────────────────────

export function mountBoard(state: SkatingState): void {
  state.isSkating = true;
  state.speed = 0;
  state.momentum = [0, 0];
  state.airborne = false;
  state.airborneY = 0;
  state.airborneVy = 0;
  state.airborneTime = 0;
  state.currentTrick = null;
  state.trickTimer = 0;
  state.grindTimer = 0;
  state.grindActive = false;
  state.manualActive = false;
  state.comboScore = 0;
  state.comboMultiplier = 0;
  state.bailed = false;
  state.bailTimer = 0;
  state.hoverHeight = HOVER_BASE;
}

export function dismountBoard(state: SkatingState): void {
  // Bank any active combo before dismounting
  if (state.comboMultiplier > 0) {
    bankCombo(state);
  }
  state.isSkating = false;
  state.speed = 0;
  state.momentum = [0, 0];
  state.airborne = false;
  state.airborneY = 0;
  state.airborneVy = 0;
  state.airborneTime = 0;
  state.onRamp = false;
  state.grindTimer = 0;
  state.grindActive = false;
  state.manualActive = false;
  state.crouching = false;
  state.bailed = false;
  state.bailTimer = 0;
}

// ── Combo System ─────────────────────────────────────────────────────

function addToCombo(state: SkatingState, name: string, basePoints: number): void {
  state.comboMultiplier++;
  state.comboScore += basePoints;
  state.currentTrick = `${name} x${state.comboMultiplier}`;
  state.trickTimer = TRICK_DISPLAY_FRAMES;
}

function bankCombo(state: SkatingState): void {
  if (state.comboMultiplier > 0) {
    const total = state.comboScore * state.comboMultiplier;
    state.trickScore += total;
    state.currentTrick = `+${total}!`;
    state.trickTimer = TRICK_DISPLAY_FRAMES;
  }
  state.comboScore = 0;
  state.comboMultiplier = 0;
}

function bail(state: SkatingState): void {
  state.bailed = true;
  state.bailTimer = BAIL_DURATION_FRAMES;
  state.comboScore = 0;
  state.comboMultiplier = 0;
  state.currentTrick = 'BAIL!';
  state.trickTimer = TRICK_DISPLAY_FRAMES;
  state.grindActive = false;
  state.manualActive = false;
  state.speed *= 0.2; // lose most speed
  state.airborne = false;
  state.airborneY = 0;
  state.airborneVy = 0;
}

// ── Trick Actions ────────────────────────────────────────────────────

/**
 * Ollie / directional trick: Space while hovering. Bonus at ramp lip.
 * If airborne + direction held, triggers a specific trick:
 *   Space alone       = Ollie (ground) or nothing (air, use dirTrick)
 *   Space + Left      = Kickflip   (+200)
 *   Space + Right     = Heelflip   (+200)
 *   Space + Up        = Hardflip   (+300)
 *   Space + Down      = Pop Shove-it (+150)
 */
export function ollie(state: SkatingState, rampData: RampData): void {
  if (!state.isSkating || state.airborne || state.ollieCooldown > 0 || state.bailed) return;

  const atLip = rampData.atLip;
  const launchForce = OLLIE_FORCE + (atLip ? OLLIE_RAMP_BONUS : 0);
  const speedBonus = Math.min(state.speed * OLLIE_SPEED_BONUS_FACTOR, 0.2);

  state.airborneVy = launchForce + speedBonus;
  state.launchVy = state.airborneVy;
  state.launchY = rampData.surfaceHeight || 0;
  state.airborne = true;
  state.airborneTime = 0;
  state.ollieCooldown = OLLIE_COOLDOWN_FRAMES;
  state.spinAngle = 0;

  // End grind/manual cleanly (links combo)
  state.grindActive = false;
  state.manualActive = false;

  const score = OLLIE_SCORE + (atLip ? RAMP_LIP_BONUS : 0);
  const name = atLip ? 'Ramp Launch!' : 'Ollie';
  addToCombo(state, name, score);
}

/**
 * Directional trick while airborne.
 * Called with the direction held when Space is pressed in air.
 */
export function airTrick(
  state: SkatingState,
  direction: 'left' | 'right' | 'up' | 'down' | null,
): void {
  if (!state.isSkating || !state.airborne || state.bailed) return;

  switch (direction) {
    case 'left':
      addToCombo(state, 'Kickflip', KICKFLIP_SCORE);
      break;
    case 'right':
      addToCombo(state, 'Heelflip', HEELFLIP_SCORE);
      break;
    case 'up':
      addToCombo(state, 'Hardflip', HARDFLIP_SCORE);
      break;
    case 'down':
      addToCombo(state, 'Pop Shove-it', POP_SHOVE_SCORE);
      break;
    default:
      // Space alone in air = spin180
      spin180(state);
      break;
  }
}

/** 180 Spin: J while airborne. +100 per 180. */
export function spin180(state: SkatingState): void {
  if (!state.isSkating || !state.airborne || state.bailed) return;
  state.spinAngle += 180;
  const spins = Math.floor(state.spinAngle / 180);
  const name = state.spinAngle >= 360 ? `${state.spinAngle} Spin` : '180';
  addToCombo(state, name, SPIN_180_SCORE * spins);
}

/** Kickflip: K while airborne. +200. */
export function kickflip(state: SkatingState): void {
  if (!state.isSkating || !state.airborne || state.bailed) return;
  addToCombo(state, 'Kickflip', KICKFLIP_SCORE);
}

/** Board grab: hold direction in air for style points */
export function boardGrab(
  state: SkatingState,
  grabType: 'indy' | 'melon' | 'nose' | 'tail' | 'method',
): void {
  if (!state.isSkating || !state.airborne || state.bailed) return;
  const names: Record<string, string> = {
    indy: 'Indy Grab',
    melon: 'Melon Grab',
    nose: 'Nose Grab',
    tail: 'Tail Grab',
    method: 'Method Air',
  };
  const scores: Record<string, number> = {
    indy: 150,
    melon: 150,
    nose: 200,
    tail: 175,
    method: 250,
  };
  addToCombo(state, names[grabType], scores[grabType]);
}

/** Start grind: G near a rail OR auto-snap when within GRIND_SNAP_DISTANCE. */
export function startGrind(state: SkatingState, rampData: RampData): void {
  if (!state.isSkating || state.bailed) return;
  if (!rampData.onRail) return;
  if (state.grindActive) return; // already grinding

  state.grindActive = true;
  state.grindTimer = 0;
  state.airborne = false;
  state.airborneY = 0;
  state.airborneVy = 0;
  state.balanceMeter = 0;
  state.balanceDifficulty = 0.15;
  state.balanceOscillation = 0;
  addToCombo(state, 'Grind', 50);
}

/**
 * Auto-snap grind: called each frame. If player is within GRIND_SNAP_DISTANCE
 * of a rail and moving fast enough, auto-start a grind.
 */
export function tryAutoGrind(state: SkatingState, rampData: RampData, railDist: number): void {
  if (!state.isSkating || state.bailed || state.grindActive) return;
  if (railDist > GRIND_SNAP_DISTANCE) return;
  if (state.speed < 0.5) return; // need some momentum to grind
  if (!rampData.onRail) return;

  startGrind(state, rampData);
}

/** Manual: up-up or down-down on ground. Links combos. */
export function startManual(state: SkatingState, isNose: boolean): void {
  if (!state.isSkating || state.airborne || state.bailed || state.grindActive) return;
  if (state.manualActive) return;

  state.manualActive = true;
  state.manualIsNose = isNose;
  state.balanceMeter = 0;
  state.balanceDifficulty = 0.15;
  state.balanceOscillation = 0;
  addToCombo(state, isNose ? 'Nose Manual' : 'Manual', 25);
}

/** Crouch/pump: hold Shift. Release on curves for speed boost. */
export function setCrouching(state: SkatingState, crouching: boolean): void {
  if (!state.isSkating || state.bailed) return;

  if (crouching && !state.crouching) {
    // Start crouch
    state.crouching = true;
    state.crouchStartSpeed = state.speed;
  } else if (!crouching && state.crouching) {
    // Release — pump boost
    state.crouching = false;
    const onCurve = state.onRamp && state.surfaceNormalY > 0.2;
    const boost = onCurve ? PUMP_BOOST_MAX : PUMP_BOOST_MIN;
    const len = Math.sqrt(state.momentum[0] ** 2 + state.momentum[1] ** 2);
    if (len > 0.001) {
      state.momentum[0] *= boost;
      state.momentum[1] *= boost;
    }
  }
}

/** Balance correction: left/right during grind or manual. */
export function balanceCorrect(state: SkatingState, direction: number): void {
  if (!state.grindActive && !state.manualActive) return;
  // Push meter toward center
  state.balanceMeter -= direction * 0.06;
  state.balanceMeter = Math.max(-1, Math.min(1, state.balanceMeter));
}

// ── Balance Meter Tick ───────────────────────────────────────────────

function tickBalance(state: SkatingState, delta: number): void {
  if (!state.grindActive && !state.manualActive) return;

  // Increase difficulty over time
  state.balanceDifficulty = Math.min(
    BALANCE_MAX_DIFFICULTY,
    state.balanceDifficulty + BALANCE_DIFFICULTY_RAMP * delta * 60,
  );

  // Oscillation pushes the meter
  state.balanceOscillation += BALANCE_OSCILLATION_SPEED * delta;
  const push = Math.sin(state.balanceOscillation) * state.balanceDifficulty * delta * 2;
  state.balanceMeter += push;

  // Clamp
  state.balanceMeter = Math.max(-1, Math.min(1, state.balanceMeter));

  // Check fail
  if (Math.abs(state.balanceMeter) > BALANCE_FAIL_THRESHOLD) {
    bail(state);
  }
}

// ── Energy Conservation Helper ───────────────────────────────────────
// speed = sqrt(2 * g * deltaHeight) — Neversoft marble physics

function energySpeed(heightDropped: number): number {
  if (heightDropped <= 0) return 0;
  return Math.sqrt(2 * GRAVITY * heightDropped);
}

// ── Main Tick ────────────────────────────────────────────────────────

/**
 * Advance hoverboard physics by one frame.
 *
 * @param state         - Mutable skating state
 * @param direction     - Normalized input [dx, dz] from WASD (0,0 if none)
 * @param delta         - Frame delta in seconds (~0.016)
 * @param terrainHeight - Ground height at player position
 * @param rampData      - Ramp/rail contact info
 *
 * @returns Movement delta { dx, dz, dy } to apply to player world position
 */
export function tickSkating(
  state: SkatingState,
  direction: [number, number],
  delta: number,
  terrainHeight: number,
  rampData: RampData,
): { dx: number; dz: number; dy: number } {
  if (!state.isSkating) return { dx: 0, dz: 0, dy: 0 };

  // ── Bail recovery
  if (state.bailed) {
    state.bailTimer--;
    if (state.bailTimer <= 0) {
      state.bailed = false;
      state.speed *= 0.5;
    }
    // Slide forward slowly during bail
    const bDx = state.momentum[0] * 0.3 * delta * 60;
    const bDz = state.momentum[1] * 0.3 * delta * 60;
    return { dx: bDx, dz: bDz, dy: 0 };
  }

  // ── Cooldowns & timers
  if (state.ollieCooldown > 0) state.ollieCooldown--;
  if (state.trickTimer > 0) {
    state.trickTimer--;
    if (state.trickTimer <= 0) state.currentTrick = null;
  }

  // ── Hover bob
  state.hoverHeight = HOVER_BASE + Math.sin(Date.now() * 0.005) * HOVER_OSCILLATION;

  // ── Track direction
  const hasInput = direction[0] !== 0 || direction[1] !== 0;
  if (hasInput) {
    state.lastDirection = [direction[0], direction[1]];
  }

  // ── Surface state
  state.onRamp = rampData.onRamp;
  state.surfaceNormalY = rampData.rampNormalY;
  state.surfaceSlopeDir = [rampData.rampSlopeDir[0], rampData.rampSlopeDir[1]];

  // ── Balance tick (grind / manual)
  tickBalance(state, delta);
  if (state.bailed) return { dx: 0, dz: 0, dy: 0 }; // balance fail mid-frame

  // ── Grind rail physics
  if (state.grindActive) {
    if (!rampData.onRail) {
      // Left the rail — end grind
      state.grindActive = false;
    } else {
      state.grindTimer += delta;
      // Score per second
      const pts = Math.floor(GRIND_SCORE_PER_SEC * delta);
      if (pts > 0) {
        state.comboScore += pts;
        state.currentTrick = `Grind ${state.grindTimer.toFixed(1)}s x${state.comboMultiplier}`;
        state.trickTimer = TRICK_DISPLAY_FRAMES;
      }
      // Grind friction
      state.momentum[0] *= GRIND_FRICTION;
      state.momentum[1] *= GRIND_FRICTION;
      // Reduce lateral drift on rail
      state.momentum[0] *= 0.95;
    }
  }

  // ── Auto-snap grind: when near a rail, auto-start grinding
  if (!state.grindActive && !state.airborne && rampData.onRamp) {
    tryAutoGrind(state, rampData, rampData.railDistance);
  }

  // ── Manual scoring
  if (state.manualActive && !state.airborne) {
    const pts = Math.floor(MANUAL_SCORE_PER_SEC * delta);
    if (pts > 0) {
      state.comboScore += pts;
    }
  }

  // ── Acceleration from input
  if (hasInput) {
    const force = state.airborne ? PUSH_FORCE_AIR : PUSH_FORCE;
    state.momentum[0] += direction[0] * force;
    state.momentum[1] += direction[1] * force;
  }

  // ── Ramp gravity: energy conservation (marble physics)
  if (rampData.onRamp && !state.airborne) {
    // Height change drives speed: accelerate downhill, decelerate uphill
    const heightDelta = state.heightRef - terrainHeight;
    if (heightDelta > 0) {
      // Going downhill — gain speed from potential energy
      const extraSpeed = energySpeed(heightDelta) * 0.05; // gentle downhill boost
      state.momentum[0] += rampData.rampSlopeDir[0] * extraSpeed;
      state.momentum[1] += rampData.rampSlopeDir[1] * extraSpeed;
    } else if (heightDelta < 0) {
      // Going uphill — lose speed (energy converts to potential)
      const dragFactor = Math.max(0.92, 1.0 + heightDelta * 0.08);
      state.momentum[0] *= dragFactor;
      state.momentum[1] *= dragFactor;
    }

    // Lip launch: at ramp lip with enough speed → automatic airborne
    if (rampData.atLip && state.speed > 2.0) {
      const verticalComponent = state.speed * rampData.rampNormalY * 0.6;
      state.airborneVy = Math.max(verticalComponent, 0.2);
      state.launchVy = state.airborneVy;
      state.launchY = terrainHeight;
      state.airborne = true;
      state.airborneTime = 0;
      state.spinAngle = 0;
      addToCombo(state, 'Air!', 50);
    }
  }
  state.heightRef = terrainHeight;

  // ── Friction
  if (state.airborne) {
    state.momentum[0] *= AIR_FRICTION;
    state.momentum[1] *= AIR_FRICTION;
  } else if (state.grindActive) {
    // already applied above
  } else if (rampData.onRamp) {
    state.momentum[0] *= RAMP_FRICTION;
    state.momentum[1] *= RAMP_FRICTION;
  } else {
    state.momentum[0] *= FLAT_FRICTION;
    state.momentum[1] *= FLAT_FRICTION;
  }

  // ── Speed calculation & cap
  state.speed = Math.sqrt(state.momentum[0] ** 2 + state.momentum[1] ** 2);
  if (state.speed > SPEED_CAP) {
    const scale = SPEED_CAP / state.speed;
    state.momentum[0] *= scale;
    state.momentum[1] *= scale;
    state.speed = SPEED_CAP;
  }

  // Kill tiny momentum
  if (state.speed < 0.001) {
    state.momentum[0] = 0;
    state.momentum[1] = 0;
    state.speed = 0;
  }

  // ── Airborne physics: projectile motion
  // y(t) = launchY + vy*t - 0.5*g*t^2
  let dy = 0;
  if (state.airborne) {
    state.airborneTime += delta;
    // Slow-mo near peak: reduce gravity when vertical velocity is near zero (peak of arc)
    const peakFactor = Math.abs(state.airborneVy) < 0.08 ? 0.4 : 1.0; // 40% gravity at peak
    state.airborneVy -= GRAVITY_TICK * peakFactor;
    state.airborneY += state.airborneVy;

    // Check landing
    const groundLevel = rampData.surfaceHeight || terrainHeight || GROUND_Y;
    if (state.airborneY <= groundLevel && state.airborneTime > 0.05) {
      // Landing check: angle between velocity and surface
      // If landing at too steep an angle → bail
      const landingAngleOk = rampData.onRamp
        ? true // ramps absorb most landings (transition)
        : Math.abs(state.airborneVy) < state.speed * (1 - BAIL_LANDING_ANGLE) + 0.5;

      if (!landingAngleOk && state.comboMultiplier > 0) {
        bail(state);
      } else {
        // Clean landing — bank combo if no manual
        if (!state.manualActive && state.comboMultiplier > 0) {
          bankCombo(state);
        }
      }

      state.airborneY = groundLevel;
      state.airborneVy = 0;
      state.airborne = false;
      state.airborneTime = 0;
      state.spinAngle = 0;
    }

    dy = state.airborneVy;
  } else {
    state.airborneY = GROUND_Y;
  }

  // ── Movement output (normalize to ~60fps baseline)
  const dx = state.momentum[0] * delta * 60;
  const dz = state.momentum[1] * delta * 60;

  return { dx, dz, dy };
}

// ── Ramp Collision Helper ────────────────────────────────────────────

export interface RampBounds {
  x: number; // ramp center X in world-space
  z: number; // ramp center Z in world-space
  length: number;
  width: number;
  height: number;
  rotation: number; // Y rotation in radians
}

/**
 * Test if a world position is on/near the mega ramp and return ramp data.
 * Uses a parametric quarter-pipe + launch ramp model.
 */
export function testRampCollision(
  worldX: number,
  worldZ: number,
  worldY: number,
  ramp: RampBounds,
): RampData {
  const noContact: RampData = {
    onRamp: false,
    rampNormalY: 0,
    rampSlopeDir: [0, 0],
    atLip: false,
    onRail: false,
    surfaceHeight: 0,
    railDistance: Infinity,
  };

  // Transform to ramp-local coords
  const cos = Math.cos(-ramp.rotation);
  const sin = Math.sin(-ramp.rotation);
  const relX = worldX - ramp.x;
  const relZ = worldZ - ramp.z;
  const localX = relX * cos - relZ * sin;
  const localZ = relX * sin + relZ * cos;

  // Check bounds (with margin)
  const halfLen = ramp.length / 2;
  const halfWid = ramp.width / 2;
  const margin = 1.0;
  if (
    Math.abs(localX) > halfWid + margin ||
    localZ < -halfLen - margin ||
    localZ > halfLen + margin
  ) {
    return noContact;
  }

  // Parametric position along ramp (0 = bottom, 1 = top)
  const t = Math.max(0, Math.min(1, (localZ + halfLen) / ramp.length));

  // Quarter-pipe curve: height = H * sin(t * PI/2)
  const surfaceY = ramp.height * Math.sin((t * Math.PI) / 2);

  // Check if player is above ramp surface (within tolerance)
  const tolerance = 1.5;
  if (worldY > surfaceY + tolerance) {
    return noContact; // too far above
  }

  // Slope angle and normal
  const slopeAngle = (t * Math.PI) / 2;
  const normalY = Math.cos(slopeAngle); // steepness: 1 at bottom, 0 at vert

  // At lip = top 8% of ramp
  const atLip = t > 0.92;

  // Grind rail detection: center strip
  const railCenterDist = Math.abs(localX); // distance to rail center line
  const railThreshold = halfWid * 0.08;
  const onRail = railCenterDist < railThreshold && t > 0.05 && t < 0.92;

  // Rail distance in world units (for auto-snap)
  const railDist = t > 0.05 && t < 0.92 ? Math.max(0, railCenterDist - railThreshold) : Infinity;

  // Slope direction in world space (downhill)
  const slopeDirLocal: [number, number] = [0, -1];
  const worldSlopeX =
    slopeDirLocal[0] * Math.cos(ramp.rotation) - slopeDirLocal[1] * Math.sin(ramp.rotation);
  const worldSlopeZ =
    slopeDirLocal[0] * Math.sin(ramp.rotation) + slopeDirLocal[1] * Math.cos(ramp.rotation);

  return {
    onRamp: true,
    rampNormalY: normalY,
    rampSlopeDir: [worldSlopeX, worldSlopeZ],
    atLip,
    onRail,
    surfaceHeight: surfaceY,
    railDistance: railDist,
  };
}

/**
 * Get ramp surface height at a given parametric position (0..1 along ramp).
 * Quarter-pipe curve: y = peakHeight * sin(t * PI/2)
 */
export function getRampHeight(t: number, peakHeight: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return peakHeight * Math.sin((clamped * Math.PI) / 2);
}

/**
 * Get surface tilt (rotation) for the hoverboard visual to match ramp slope.
 * Returns [rotX, rotZ] in radians.
 */
export function getSurfaceTilt(state: SkatingState): [number, number] {
  if (!state.isSkating || state.airborne) return [0, 0];
  // Tilt forward/back based on slope
  const tiltMagnitude = Math.asin(Math.min(1, state.surfaceNormalY));
  const rotX = state.surfaceSlopeDir[1] * tiltMagnitude;
  const rotZ = -state.surfaceSlopeDir[0] * tiltMagnitude;
  return [rotX, rotZ];
}
