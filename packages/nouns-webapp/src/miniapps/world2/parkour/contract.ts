// ── Parkour: the shared contract (pure types + tuning) ──────────────────
//
// The parkour engine runs the rider on foot whenever a move is on: wall
// runs, the vertical run up a wall (tic-tac), ledge hangs, poles, slides,
// rolls and stumbles. Plain walking, jumping, the wall climb and the
// vault stay in skate/Player.ts; the engine starts those through
// `PkBody.startClimb` / `startVault` and only animates them.
//
//   sim/    pure + deterministic: world queries through `PkWorld` (no
//           three.js), detection, the move state machine, landing rules,
//           route timing. Tested against box levels.
//   view/   pose specs for every move on the Noun rig (breakdance's
//           PoseDriver applies them), the camera feel.
//   net/    the compact `pk` key in the multiplayer blob.
//   game/   NOUN PARKOUR: rooftop time trials, checkpoints, ghosts, HUD.
//
// World space: +Y up. A wall normal points out of the wall, toward the
// rider. Yaw 0 faces +Z: forward = (sin yaw, 0, cos yaw), left = (cos yaw,
// 0, −sin yaw) (+X at yaw 0, the glTF convention). "side" +1 = left.

export interface V3 {
  x: number;
  y: number;
  z: number;
}

/** A ray hit. Implementations may reuse the object: copy what you keep. */
export interface PkHit {
  x: number;
  y: number;
  z: number;
  /** Surface normal, facing the ray's origin. */
  nx: number;
  ny: number;
  nz: number;
  d: number;
}

/** What the engine needs from the collision world. */
export interface PkWorld {
  /** Closest hit along the unit ray (dx, dy, dz) within `far`, or null. */
  ray(
    ox: number,
    oy: number,
    oz: number,
    dx: number,
    dy: number,
    dz: number,
    far: number,
  ): PkHit | null;
  /**
   * Push a capsule (segment a→b, radius r) out of the geometry. Returns the
   * correction (zero when clear). Implementations may reuse the result.
   */
  push(ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number): V3;
}

/** The rider as the engine sees it (skate/Player on foot, via an adapter). */
export interface PkBody {
  pos: V3;
  vel: V3;
  /** Facing (rad). */
  yaw: number;
  grounded: boolean;
  /** The Player's own wall climb / vault are running (the engine just watches). */
  readonly climbing: boolean;
  readonly vaulting: boolean;
  /** Bumped on every respawn / teleport: the engine drops whatever it was doing. */
  readonly respawns: number;
  /** Start the Player's wall climb on the wall with this normal (false if it can't). */
  startClimb(nx: number, nz: number): boolean;
  /** Start the Player's vault over / onto the obstacle with this normal. */
  startVault(nx: number, nz: number, carry: number): boolean;
  /** Sound / camera / HUD events. */
  emit(e: PkEvent): void;
}

export interface PkInput {
  /** Stick / keys: x = right, y = forward (rider-relative). */
  moveX: number;
  moveY: number;
  /** World-space wished direction of travel (0 length = none). */
  wishX: number;
  wishZ: number;
  sprint: boolean;
  jump: boolean;
  jumpHeld: boolean;
  /** Q / gamepad B / touch DUCK: slide, roll, drop. */
  duck: boolean;
  duckPressed: boolean;
  /** F / gamepad Y: let go. */
  release: boolean;
}

export type PkEventType =
  | 'wallrun'
  | 'walljump'
  | 'wallup'
  | 'tictac'
  | 'grab'
  | 'pullup'
  | 'drop'
  | 'leap'
  | 'pole'
  | 'poleLaunch'
  | 'slide'
  | 'roll'
  | 'stumble'
  | 'stick'
  | 'gap'
  | 'vault'
  | 'step';

export interface PkEvent {
  type: PkEventType;
  /** 0..1 how big (camera shake, sound level). */
  power: number;
}

// ── The moves ───────────────────────────────────────────────────────────

export interface WallRun {
  k: 'wallrun';
  /** +1 wall on the rider's left, −1 on the right. */
  side: 1 | -1;
  nx: number;
  nz: number;
  /** Unit run direction along the wall. */
  tx: number;
  tz: number;
  speed: number;
  t: number;
  phase: number;
}

export interface WallUp {
  k: 'wallup';
  nx: number;
  nz: number;
  t: number;
  phase: number;
}

export interface Hang {
  k: 'hang';
  nx: number;
  nz: number;
  /** The lip under the hands (world). */
  lx: number;
  ly: number;
  lz: number;
  /** Shimmy speed now (m/s, + = rider's right). */
  shimmy: number;
  phase: number;
  t: number;
  /** Can stand on top (pull up), else only shimmy / leap / drop. */
  top: boolean;
}

export interface PullUp {
  k: 'pullup';
  from: V3;
  to: V3;
  nx: number;
  nz: number;
  t: number;
  dur: number;
}

/** A leap between ledges (or up onto one): an arc that catches the next lip. */
export interface Leap {
  k: 'leap';
  from: V3;
  to: Hang;
  t: number;
  dur: number;
  /** Arc height over the straight line (m). */
  arc: number;
  /** Rider-relative direction of the leap (for the pose): x right, y up. */
  dx: number;
  dy: number;
}

export interface Pole {
  k: 'pole';
  cx: number;
  cz: number;
  /** Pole radius (m) and its top / bottom (world y). */
  r: number;
  top: number;
  base: number;
  /** Angle of the rider around the pole (rad, atan2 of rider − centre: x, z). */
  ang: number;
  /** Angular speed (rad/s, + = counter-clockwise seen from above). */
  spin: number;
  vy: number;
  t: number;
}

export interface Slide {
  k: 'slide';
  dx: number;
  dz: number;
  speed: number;
  t: number;
}

export interface Roll {
  k: 'roll';
  dx: number;
  dz: number;
  speed: number;
  t: number;
}

export interface Stumble {
  k: 'stumble';
  t: number;
  dur: number;
}

export type PkMove = WallRun | WallUp | Hang | PullUp | Leap | Pole | Slide | Roll | Stumble;
export type PkMoveKind = PkMove['k'];

// ── Animation keys (also what goes on the wire) ─────────────────────────

/**
 * What the rig shows. Codes are the wire format: append only, never
 * renumber (older clients show anything unknown as their plain clip).
 */
export const ANIM = {
  none: 0,
  wallrun: 1,
  wallup: 2,
  climb: 3,
  mantle: 4,
  hang: 5,
  pullup: 6,
  pole: 7,
  vault: 8,
  slide: 9,
  roll: 10,
  stumble: 11,
  flip: 12,
  balance: 13,
  leap: 14,
  stick: 15,
} as const;
export type AnimKind = keyof typeof ANIM;
export const ANIM_BY_CODE: readonly AnimKind[] = (Object.keys(ANIM) as AnimKind[]).sort(
  (a, b) => ANIM[a] - ANIM[b],
);

export interface PkAnim {
  kind: AnimKind;
  /** Gait phase (cycles, 0..1) or progress through the move (0..1). */
  phase: number;
  /** ±1: wall side, shimmy / spin direction, vault style. */
  side: 1 | -1;
  /** 0..1 move-specific: climb speed, slide speed, reach, pole slide. */
  amt: number;
}

export const NO_ANIM: PkAnim = { kind: 'none', phase: 0, side: 1, amt: 0 };

// ── Tuning ──────────────────────────────────────────────────────────────

export const PK = {
  gravity: 12.5,
  /** Body capsule (matches skate/Player). */
  radius: 0.32,
  height: 1.4,

  // Wall run
  wallRunMinSpeed: 3.6,
  wallRunMaxSpeed: 8.6,
  /** How far the wall may be from the rider's centre to start / keep running. */
  wallRunReach: 1.05,
  wallRunDist: 0.58,
  wallRunTime: 1.6,
  /** Fraction of gravity while the run is fresh, and after `wallRunFresh` s. */
  wallRunGrav: 0.32,
  wallRunGravLate: 0.85,
  wallRunFresh: 0.85,
  wallRunLift: 3.2,
  wallJumpOut: 5.0,
  wallJumpUp: 6.0,

  // Vertical run (tic-tac)
  wallUpMinSpeed: 2.8,
  wallUpReach: 1.25,
  wallUpDist: 0.5,
  wallUpTime: 0.62,
  wallUpSpeed: 6.4,
  ticTacOut: 4.8,
  ticTacUp: 6.2,

  // Ledges
  /**
   * Rider feet sit this far under the lip, this far out from the face. The
   * Noun's arms are ~0.42 m and its head a 0.85 m deep cube: hands on the
   * lip put the head's face right on the wall (peeking over the edge).
   */
  hangDrop: 1.22,
  hangDist: 0.52,
  /** Lip heights (above the feet) a reach can catch. */
  grabMin: 1.0,
  grabMax: 2.25,
  shimmySpeed: 1.35,
  pullUpTime: 0.72,
  leapTime: 0.42,
  leapMaxSide: 2.6,
  leapMaxUp: 2.4,
  regrabDelay: 0.5,

  // Poles
  poleMaxR: 0.3,
  poleReach: 0.95,
  /** Rider centre to pole surface while holding on. */
  poleGap: 0.42,
  poleSlide: 3.4,
  poleSlideFast: 7.5,
  poleClimb: 1.7,
  poleSpinMax: 5.5,
  poleLaunchOut: 4.6,
  poleLaunchUp: 5.8,

  // Ground moves
  slideMinSpeed: 4.2,
  slideTime: 0.85,
  slideFriction: 3.4,
  slideHeight: 0.8,
  rollTime: 0.62,
  /** Landing speeds (m/s down): a roll (~3 m), a hard landing (~9 m, needs the timed duck). */
  rollImpact: 9,
  hardImpact: 15,
  duckWindow: 0.4,
  stumbleTime: 0.95,
  stumbleHardTime: 1.5,
  autoVaultSpeed: 3.6,

  /** Standing precision jump: horizontal speed (m/s) and take-off (≈ 3.6 m on the level). */
  precisionSpeed: 4.2,
  precisionJump: 5.4,

  // Gap jumps
  gapCheck: 1.4,
  gapDrop: 2.0,
  gapJump: 5.7,
  gapSpeed: 7.2,
} as const;
