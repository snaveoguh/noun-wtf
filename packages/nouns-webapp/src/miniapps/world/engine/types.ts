// ── Nouns World — Core Types ──────────────────────────────────────────

export interface Vec2 {
  x: number;
  y: number;
}

// ── Tiles ─────────────────────────────────────────────────────────────

export enum Tile {
  Water = 0,
  Sand = 1,
  Grass = 2,
  Tree = 3,
  Flower = 4,
  Path = 5,
  Rock = 6,
  Spawn = 7,
  DeepWater = 8,
  Arena = 9,
}

export const WALKABLE = new Set<Tile>([
  Tile.Sand,
  Tile.Grass,
  Tile.Flower,
  Tile.Path,
  Tile.Spawn,
  Tile.Arena,
]);

// ── Direction / State ─────────────────────────────────────────────────

export type Direction =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'up-left'
  | 'up-right'
  | 'down-left'
  | 'down-right';

/** Map facing direction to Y-axis rotation (radians). */
export const DIRECTION_ROTATION: Record<Direction, number> = {
  up: Math.PI,
  down: 0,
  left: Math.PI * 1.5,
  right: Math.PI * 0.5,
  'up-left': Math.PI * 1.25,
  'up-right': Math.PI * 0.75,
  'down-left': Math.PI * 1.75,
  'down-right': Math.PI * 0.25,
};

/** Map facing direction to a 2D unit-ish angle (used for attack aiming, spatial audio). */
export const DIRECTION_FACING_ANGLE: Record<Direction, number> = {
  up: -Math.PI / 2,
  down: Math.PI / 2,
  left: Math.PI,
  right: 0,
  'up-left': -Math.PI * 0.75,
  'up-right': -Math.PI * 0.25,
  'down-left': Math.PI * 0.75,
  'down-right': Math.PI * 0.25,
};

export type PlayerState =
  | 'idle'
  | 'walking'
  | 'attacking'
  | 'stunned'
  | 'airborne'
  | 'blocking'
  | 'dead'
  | 'respawning'
  | 'backflip'
  | 'dashing'
  | 'knocked' // combo knockdown — on the ground, auto-stand after delay
  | 'wounded'; // gunshot knee collapse — held pose

export type MoveType =
  | 'punch'
  | 'kick'
  | 'uppercut'
  | 'groundSlam'
  | 'backflip'
  | 'dash'
  | 'spinAttack'
  | 'forcePush'
  | 'block'
  | 'headbutt'
  | 'roundhouse'
  | 'meteor'
  | 'cyclone'
  | 'gunshot' // ranged — collapses target to one knee
  | 'headshot'; // instant kill variant

// ── Player ────────────────────────────────────────────────────────────

export interface Player {
  x: number;
  y: number;
  vx: number;
  vy: number;
  direction: Direction;
  state: PlayerState;
  hp: number;
  maxHp: number;
  nounId: number;
  seedKey: string;

  // Combat
  attackTimer: number; // frames remaining in attack animation
  attackType: MoveType | null;
  stunTimer: number;
  iFrames: number; // invincibility frames remaining
  airborneVy: number; // vertical velocity for juggle/jump
  airborneY: number; // visual Y offset (negative = up)
  jumpCount: number; // 0=ground, 1=jumped, 2=double, 3=triple, 4=backflip
  blockTimer: number;
  dashVx: number;
  dashVy: number;
  dashTimer: number;

  // Combo
  comboHits: number;
  comboTimer: number; // frames until combo resets
  lastMoves: MoveType[]; // last 5 moves for special combos

  // Hit reaction
  knockedTimer: number; // frames remaining in knocked-down state
  woundedTimer: number; // frames remaining in wounded (knee) state
  consecutiveGunshots: number; // gunshot hit counter for 2-shot kill

  // Visuals
  flipRotation: number; // backflip rotation angle
  scaleX: number; // -1 for facing left
  hitFlash: number; // 0-1 red flash
  deathTimer: number;
  respawnTimer: number;
}

export interface RemotePlayer {
  id: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  direction: Direction;
  state: PlayerState;
  hp: number;
  maxHp: number;
  nounId: number;
  seedKey: string;
  attackType: MoveType | null;
  attackTimer: number;
  airborneY: number;
  flipRotation: number;
  scaleX: number;
  hitFlash: number;
  lastSeen: number;
}

// ── Particles / Effects ───────────────────────────────────────────────

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
  gravity?: number;
}

export interface FloatingText {
  x: number;
  y: number;
  vy: number;
  text: string;
  color: string;
  size: number;
  life: number;
  maxLife: number;
}

export interface ForcePush {
  x: number;
  y: number;
  angle: number;
  radius: number;
  maxRadius: number;
  life: number;
  maxLife: number;
  color: string;
  isRemote: boolean;
  sourceId?: string;
  damage: number;
  hitIds: Set<string>;
}

export interface ScreenShake {
  intensity: number;
  duration: number;
  timer: number;
}

export interface SlowMo {
  factor: number; // 0.3 = 30% speed
  timer: number;
}

// ── Kill Feed ─────────────────────────────────────────────────────────

export interface KillFeedEntry {
  killer: string;
  victim: string;
  move: MoveType;
  timestamp: number;
}

// ── Camera ────────────────────────────────────────────────────────────

export interface Camera {
  x: number;
  y: number;
}

// ── Constants ─────────────────────────────────────────────────────────

export const TILE_SIZE = 16;
export const MAP_SIZE = 64;
export const WORLD_SIZE = TILE_SIZE * MAP_SIZE; // 1024
export const SPRITE_SIZE = 32;
export const PLAYER_SPEED = 0.3;
export const PLAYER_MAX_HP = 100;
export const GRAVITY = 0.25; // floaty Spider-Man style — slow descent, long hang time
export const GROUND_Y = 0; // airborneY baseline
export const RESPAWN_TIME = 180; // 3 seconds at 60fps

// Combat constants
export const PUNCH_RANGE = 28;
export const PUNCH_DAMAGE_MIN = 8;
export const PUNCH_DAMAGE_MAX = 12;
export const PUNCH_DURATION = 12;
export const KICK_RANGE = 38;
export const KICK_DAMAGE_MIN = 15;
export const KICK_DAMAGE_MAX = 20;
export const KICK_DURATION = 18;
export const KICK_KNOCKBACK = 2;
export const UPPERCUT_RANGE = 30;
export const UPPERCUT_DAMAGE = 25;
export const UPPERCUT_DURATION = 20;
export const UPPERCUT_LAUNCH_VY = -12;
export const GROUND_SLAM_DAMAGE = 30;
export const GROUND_SLAM_RADIUS = 48;
export const GROUND_SLAM_STUN = 30;
export const BACKFLIP_DURATION = 24;
export const BACKFLIP_IFRAMES = 20;
export const DASH_DURATION = 12;
export const DASH_SPEED = 8;
export const DASH_IFRAMES = 8;
export const DASH_DAMAGE = 5;
export const SPIN_ATTACK_RANGE = 40;
export const SPIN_ATTACK_DAMAGE = 20;
export const SPIN_ATTACK_DURATION = 24;
export const FORCE_PUSH_RANGE = 200;
export const FORCE_PUSH_DAMAGE = 15;
export const FORCE_PUSH_KNOCKBACK = 3;
export const FORCE_PUSH_COOLDOWN = 90;
export const FORCE_PUSH_LIFE = 30;
export const FORCE_CONE_ANGLE = Math.PI / 3;
export const BLOCK_REDUCTION = 0.5;
export const PARRY_WINDOW = 8; // frames for perfect parry
export const PARRY_REFLECT_MULT = 1.5;
export const COMBO_WINDOW = 120; // 2 seconds at 60fps
export const COMBO_3_MULT = 1.5;
export const COMBO_5_MULT = 2.0;

// Gunshot constants
export const GUNSHOT_RANGE = 120;
export const GUNSHOT_DAMAGE = 35;
export const GUNSHOT_DURATION = 15;
export const HEADSHOT_DAMAGE = 100; // instant kill
export const WOUNDED_DURATION = 60; // 1 second at 60fps — knee collapse hold
export const KNOCKED_DURATION = 120; // 2 seconds at 60fps — ground knockdown
export const GUNSHOT_RESPAWN_TIME = 180; // 3 seconds at 60fps

// Special combo sequences
export const ROUNDHOUSE_SEQ: MoveType[] = ['punch', 'punch', 'kick'];
export const ROUNDHOUSE_DAMAGE = 35;
export const METEOR_SEQ: MoveType[] = ['uppercut', 'punch', 'groundSlam'];
export const METEOR_DAMAGE = 50;
export const CYCLONE_SEQ: MoveType[] = ['backflip', 'dash', 'spinAttack'];
export const CYCLONE_DAMAGE = 40;

// Network
export const SEND_INTERVAL = 3;
export const REMOTE_STALE_MS = 5000;
export const PARTYKIT_HOST =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_PARTYKIT_HOST) ||
  'noun-wtf-saber.snaveoguh.partykit.dev';
