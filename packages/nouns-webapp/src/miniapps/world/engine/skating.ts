// ── Skating Physics & State ──────────────────────────────────────────
//
// S near skateboard = mount/dismount
// Space while skating = ollie (jump)
// J while airborne = kickflip (+100 pts)
// Auto-detect grind rail contact (+50 pts/sec)
//
// Momentum-based movement: player keeps rolling in last push direction.
// Friction on flat, gravity acceleration on downhill, speed cap 8 u/frame.

// ── Types ────────────────────────────────────────────────────────────

export interface SkatingState {
  isSkating: boolean;
  speed: number;
  momentum: [number, number]; // [mx, mz] direction of travel
  onRamp: boolean;
  airborne: boolean;
  airborneVy: number;
  airborneY: number; // visual Y offset (positive = up in skating space)
  trickScore: number;
  currentTrick: string | null;
  trickTimer: number; // frames remaining for trick display
  grindTimer: number; // accumulated grind frames (for scoring)
  lastDirection: [number, number]; // last non-zero input direction
  ollieCooldown: number;
}

export interface RampData {
  onRamp: boolean;
  rampNormalY: number; // upward slope component (0 = flat, 1 = vertical)
  rampSlopeDir: [number, number]; // direction the slope faces (downhill)
  atLip: boolean; // true when at the top edge of ramp
  onRail: boolean; // true when on grind rail geometry
}

// ── Constants ────────────────────────────────────────────────────────

const FLAT_FRICTION = 0.995;
const AIR_FRICTION = 0.999;
const RAMP_GRAVITY_ACCEL = 0.15; // gravity boost going downhill
const SPEED_CAP = 8;
const OLLIE_FORCE = 0.35;
const OLLIE_RAMP_BONUS = 0.15; // extra launch from ramp lip
const SKATING_GRAVITY = 0.018;
const GROUND_Y = 0;
const OLLIE_COOLDOWN_FRAMES = 15;

// Trick scores
const OLLIE_SCORE = 25;
const KICKFLIP_SCORE = 100;
const GRIND_SCORE_PER_SEC = 50;
const RAMP_LIP_OLLIE_BONUS = 50;

const TRICK_DISPLAY_FRAMES = 90; // 1.5 seconds at 60fps

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
    trickScore: 0,
    currentTrick: null,
    trickTimer: 0,
    grindTimer: 0,
    lastDirection: [0, 1],
    ollieCooldown: 0,
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
  state.currentTrick = null;
  state.trickTimer = 0;
  state.grindTimer = 0;
}

export function dismountBoard(state: SkatingState): void {
  state.isSkating = false;
  state.speed = 0;
  state.momentum = [0, 0];
  state.airborne = false;
  state.airborneY = 0;
  state.airborneVy = 0;
  state.onRamp = false;
  state.grindTimer = 0;
}

// ── Trick System ─────────────────────────────────────────────────────

function registerTrick(state: SkatingState, name: string, points: number): void {
  state.trickScore += points;
  state.currentTrick = name;
  state.trickTimer = TRICK_DISPLAY_FRAMES;
}

/** Ollie: space while skating. Bonus if on ramp lip. */
export function ollie(state: SkatingState, rampData: RampData): void {
  if (!state.isSkating || state.airborne || state.ollieCooldown > 0) return;

  const launchForce = OLLIE_FORCE + (rampData.atLip ? OLLIE_RAMP_BONUS : 0);

  // Convert some horizontal speed into vertical
  const speedBonus = Math.min(state.speed * 0.05, 0.15);
  state.airborneVy = launchForce + speedBonus;
  state.airborne = true;
  state.ollieCooldown = OLLIE_COOLDOWN_FRAMES;

  const score = OLLIE_SCORE + (rampData.atLip ? RAMP_LIP_OLLIE_BONUS : 0);
  const name = rampData.atLip ? 'Ramp Ollie!' : 'Ollie';
  registerTrick(state, name, score);
}

/** Kickflip: J while airborne. */
export function kickflip(state: SkatingState): void {
  if (!state.isSkating || !state.airborne) return;
  registerTrick(state, 'Kickflip!', KICKFLIP_SCORE);
}

/** Grind scoring: called each frame while on rail. */
function tickGrind(state: SkatingState, delta: number): void {
  state.grindTimer += delta;
  // Award points every ~1 second of grind time
  // const _secondsGrinding = state.grindTimer * delta;
  if (state.grindTimer > 0) {
    const points = Math.floor(GRIND_SCORE_PER_SEC * delta);
    if (points > 0) {
      state.trickScore += points;
      state.currentTrick = 'Grinding...';
      state.trickTimer = TRICK_DISPLAY_FRAMES;
    }
  }
}

// ── Main Tick ────────────────────────────────────────────────────────

/**
 * Advance skating physics by one frame.
 *
 * @param state      - Mutable skating state
 * @param direction  - Normalized input direction [dx, dz] from WASD (0,0 if no input)
 * @param delta      - Frame delta in seconds (typically ~0.016)
 * @param terrainHeight - Ground height at player position (for ramp elevation)
 * @param rampData   - Ramp contact info from collision detection
 *
 * @returns Movement delta { dx, dz, dy } to apply to player world position
 */
export function tickSkating(
  state: SkatingState,
  direction: [number, number],
  delta: number,
  _terrainHeight: number,
  rampData: RampData,
): { dx: number; dz: number; dy: number } {
  if (!state.isSkating) return { dx: 0, dz: 0, dy: 0 };

  // Cooldowns
  if (state.ollieCooldown > 0) state.ollieCooldown--;
  if (state.trickTimer > 0) {
    state.trickTimer--;
    if (state.trickTimer <= 0) state.currentTrick = null;
  }

  // Track last non-zero direction for momentum
  const hasInput = direction[0] !== 0 || direction[1] !== 0;
  if (hasInput) {
    state.lastDirection = [direction[0], direction[1]];
  }

  // ── Ramp state
  state.onRamp = rampData.onRamp;

  // ── Grind rail
  if (rampData.onRail && !state.airborne) {
    tickGrind(state, delta);
    // Snap to rail — reduce lateral drift
    state.momentum[0] *= 0.98;
    state.momentum[1] *= 0.98;
  } else {
    state.grindTimer = 0;
  }

  // ── Acceleration from input
  if (hasInput) {
    const pushForce = 0.08;
    state.momentum[0] += direction[0] * pushForce;
    state.momentum[1] += direction[1] * pushForce;
  }

  // ── Ramp gravity: accelerate downhill
  if (rampData.onRamp && !state.airborne) {
    state.momentum[0] += rampData.rampSlopeDir[0] * RAMP_GRAVITY_ACCEL * rampData.rampNormalY * delta;
    state.momentum[1] += rampData.rampSlopeDir[1] * RAMP_GRAVITY_ACCEL * rampData.rampNormalY * delta;
  }

  // ── Friction
  const friction = state.airborne ? AIR_FRICTION : FLAT_FRICTION;
  state.momentum[0] *= friction;
  state.momentum[1] *= friction;

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

  // ── Airborne physics (ollie / ramp launch)
  let dy = 0;
  if (state.airborne) {
    state.airborneVy -= SKATING_GRAVITY;
    state.airborneY += state.airborneVy;

    if (state.airborneY <= GROUND_Y) {
      // Landed
      state.airborneY = GROUND_Y;
      state.airborneVy = 0;
      state.airborne = false;
    }

    dy = state.airborneVy; // pass vertical delta to caller
  } else {
    state.airborneY = GROUND_Y;
  }

  // ── Movement output
  const dx = state.momentum[0] * delta * 60; // normalize to ~60fps baseline
  const dz = state.momentum[1] * delta * 60;

  return { dx, dz, dy };
}

// ── Ramp Collision Helper ────────────────────────────────────────────
//
// Simplified ramp detection based on position relative to the mega ramp.
// The MegaRamp3D component defines its own bounds; this helper tests
// whether a world-space position is on the ramp surface.

export interface RampBounds {
  x: number; // ramp center X in world-space
  z: number; // ramp center Z in world-space
  length: number; // ramp length along its main axis
  width: number; // ramp width
  height: number; // peak height
  rotation: number; // Y rotation in radians
}

/**
 * Test if a world position is on/near the mega ramp and return ramp data.
 * Uses a simple parametric model of a quarter-pipe curve.
 */
export function testRampCollision(
  worldX: number,
  worldZ: number,
  ramp: RampBounds,
): RampData {
  const noContact: RampData = {
    onRamp: false,
    rampNormalY: 0,
    rampSlopeDir: [0, 0],
    atLip: false,
    onRail: false,
  };

  // Transform to ramp-local coords
  const cos = Math.cos(-ramp.rotation);
  const sin = Math.sin(-ramp.rotation);
  const relX = worldX - ramp.x;
  const relZ = worldZ - ramp.z;
  const localX = relX * cos - relZ * sin;
  const localZ = relX * sin + relZ * cos;

  // Check bounds
  const halfLen = ramp.length / 2;
  const halfWid = ramp.width / 2;
  if (Math.abs(localX) > halfWid || localZ < -halfLen || localZ > halfLen) {
    return noContact;
  }

  // Parametric position along ramp (0 = bottom, 1 = top)
  const t = (localZ + halfLen) / ramp.length;

  // Quarter-pipe curve: height = H * sin(t * PI/2)
  const slopeAngle = t * Math.PI / 2;
  const normalY = Math.cos(slopeAngle); // steepness increases toward top

  // At lip = top 10% of ramp
  const atLip = t > 0.9;

  // Grind rail detection: center strip, narrow
  const onRail = Math.abs(localX) < halfWid * 0.1 && t > 0.1 && t < 0.9;

  // Slope direction in world space (downhill = negative Z in local = toward bottom)
  const slopeDirLocal = [0, -1] as [number, number];
  const worldSlopeX = slopeDirLocal[0] * Math.cos(ramp.rotation) - slopeDirLocal[1] * Math.sin(ramp.rotation);
  const worldSlopeZ = slopeDirLocal[0] * Math.sin(ramp.rotation) + slopeDirLocal[1] * Math.cos(ramp.rotation);

  return {
    onRamp: true,
    rampNormalY: normalY,
    rampSlopeDir: [worldSlopeX, worldSlopeZ],
    atLip,
    onRail,
  };
}

/**
 * Get ramp surface height at a given parametric position (0..1 along ramp length).
 * Quarter-pipe curve: y = peakHeight * sin(t * PI/2)
 */
export function getRampHeight(t: number, peakHeight: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return peakHeight * Math.sin(clamped * Math.PI / 2);
}
