// ── Noun Warfare: pure game-state types ─────────────────────────────────
//
// Everything here is plain JSON-able data. The sim mutates a SimState from
// (state, inputs) → state + events at a fixed 60 Hz; nothing in sim/ knows
// about three.js, the DOM or wall-clock time. Phase 2 netcode can run the
// exact same step on a host (PartyKit room) and ship snapshots / events.

import type { DamageSource, WeaponId } from './weapons';

export type ModeId = 'tdm' | 'elim' | 'turf' | 'ffa';
export type MapId = 'nouncity' | 'warehouse';
export type Difficulty = 0 | 1 | 2;
export type TeamSize = 2 | 4 | 6;
/** 0 red, 1 blue, -1 free-for-all (everyone is an enemy). */
export type Team = 0 | 1 | -1;

export const DT = 1 / 60;

export const TEAM_COLORS: [number, number] = [0xe8352b, 0x2f7bff];
export const TEAM_NAMES: [string, string] = ['RED NOGGLES', 'BLUE NOGGLES'];
/** FFA paint colours (one per player slot). */
export const FFA_COLORS = [
  0xe8352b, 0x2f7bff, 0xffc20e, 0x2bd96b, 0xc04dff, 0xff7a1a, 0x18d6d6, 0xff4fa3, 0x9be22d,
  0xf5f5f5, 0x8a5cff, 0x00b38f,
];

/** Player body (sim units = metres). */
export const BODY = {
  radius: 0.38,
  height: 1.8,
  crouchHeight: 1.2,
  eye: 1.52,
  crouchEye: 1.0,
  step: 0.55,
  walk: 6.2,
  sprint: 8.8,
  crouchSpeed: 3.2,
  accel: 70,
  airAccel: 14,
  friction: 11,
  jump: 6.9,
  gravity: 20,
  maxHp: 100,
  /** Seconds without damage before regen kicks in. */
  regenDelay: 4.5,
  regenRate: 30,
  spawnProtect: 1.6,
};

export interface PlayerInput {
  /** Strafe right (+) / left (−), −1..1. */
  moveX: number;
  /** Forward (+) / back (−), −1..1. */
  moveY: number;
  /** Absolute view angles (radians). yaw 0 looks down −Z; pitch + is up. */
  yaw: number;
  pitch: number;
  fire: boolean;
  jump: boolean;
  crouch: boolean;
  sprint: boolean;
  reload: boolean;
  /** Hold to scope (Long-Splat) / steady aim. */
  scope: boolean;
  /** Throw a paint grenade (edge-triggered). */
  grenade: boolean;
  /** Desired weapon (or null = keep). */
  weapon: WeaponId | null;
}

export function emptyInput(yaw = 0, pitch = 0): PlayerInput {
  return {
    moveX: 0,
    moveY: 0,
    yaw,
    pitch,
    fire: false,
    jump: false,
    crouch: false,
    sprint: false,
    reload: false,
    scope: false,
    grenade: false,
    weapon: null,
  };
}

export interface PlayerStats {
  kills: number;
  deaths: number;
  assists: number;
  headshots: number;
  /** Mode score contribution (captures, round wins…). */
  score: number;
  streak: number;
  bestStreak: number;
  shots: number;
  hits: number;
  damage: number;
  captures: number;
}

export interface PlayerState {
  id: number;
  name: string;
  team: Team;
  /** Paint colour (team colour, or a unique FFA colour). */
  color: number;
  bot: boolean;
  /** Noun look (`seedKey` format) — the renderer turns this into a head. */
  look: string;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  grounded: boolean;
  crouched: boolean;
  sprinting: boolean;
  scoped: boolean;
  hp: number;
  alive: boolean;
  /** Sim time a dead player may respawn (Infinity = not this round). */
  respawnAt: number;
  protectedUntil: number;
  lastDamageAt: number;
  diedAt: number;
  killerId: number;
  weapon: WeaponId;
  weapons: WeaponId[];
  mags: Record<WeaponId, number>;
  /** Sim time the current reload finishes (0 = not reloading). */
  reloadUntil: number;
  nextFireAt: number;
  /** Weapon swap lock-out. */
  swapUntil: number;
  bloom: number;
  grenades: number;
  grenadeRegenAt: number;
  nextGrenadeAt: number;
  /** Previous-tick held buttons for edge detection. */
  prevFire: boolean;
  prevJump: boolean;
  prevGrenade: boolean;
  /** Recent damage dealers (for assists). */
  damagers: { id: number; dmg: number; t: number }[];
  /** Multi-kill window. */
  multi: number;
  lastKillAt: number;
  stats: PlayerStats;
  /** Metres walked (footsteps / animation phase). */
  stride: number;
}

export type ProjectileKind = 'ball' | 'bomb' | 'grenade';

export interface Projectile {
  id: number;
  owner: number;
  source: DamageSource;
  kind: ProjectileKind;
  color: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  gravity: number;
  radius: number;
  born: number;
  /** Grenade fuse (sim time), 0 = impact. */
  fuseAt: number;
  dmg: number;
  headMult: number;
  bounces: number;
}

export interface ZoneState {
  id: string;
  x: number;
  y: number;
  z: number;
  r: number;
  /** −1 (fully red) … +1 (fully blue). */
  progress: number;
  owner: Team;
  contested: boolean;
  /** Bitmask of teams present this tick (1 red, 2 blue). */
  present: number;
}

export type MatchPhase = 'countdown' | 'live' | 'roundEnd' | 'matchEnd';

export interface MatchState {
  mode: ModeId;
  phase: MatchPhase;
  /** Sim time the phase ends (countdown / roundEnd). */
  phaseUntil: number;
  /** Team scores (TDM splats / Turf points / Elim round wins). */
  scores: [number, number];
  /** Score to win (splats, points or rounds). */
  target: number;
  /** Seconds of live play allowed (per round in Elimination). */
  timeLimit: number;
  /** Sim time the current round/match went live. */
  liveAt: number;
  round: number;
  /** Winner team (0/1), player id in FFA (as 100+id), −1 draw, null = undecided. */
  winner: number | null;
  /** Last round's winner (Elimination), for the banner. */
  roundWinner: Team | null;
  /** Turf scoring accumulator. */
  turfTick: number;
}

export interface MatchConfig {
  mode: ModeId;
  map: MapId;
  teamSize: TeamSize;
  difficulty: Difficulty;
  seed: number;
  /** Human players (index 0 is the local player in phase 1). */
  humans: { name: string; look: string; weapons: WeaponId[] }[];
  /** Override score target / time (tests). */
  target?: number;
  timeLimit?: number;
}

export interface SimState {
  tick: number;
  time: number;
  rngState: number;
  nextId: number;
  match: MatchState;
  players: PlayerState[];
  projectiles: Projectile[];
  zones: ZoneState[];
}

// ── Events (what the renderer / audio / HUD react to) ───────────────────

export type SimEvent =
  | {
      type: 'fire';
      pid: number;
      weapon: WeaponId;
      x: number;
      y: number;
      z: number;
      dx: number;
      dy: number;
      dz: number;
    }
  | {
      type: 'splat';
      x: number;
      y: number;
      z: number;
      nx: number;
      ny: number;
      nz: number;
      color: number;
      size: number;
      /** Player id when the paint landed on a player. */
      on: number;
    }
  | {
      type: 'hit';
      attacker: number;
      victim: number;
      dmg: number;
      head: boolean;
      source: DamageSource;
      x: number;
      y: number;
      z: number;
      /** Direction the paint came from (attacker → victim, normalised xz). */
      fromX: number;
      fromZ: number;
    }
  | {
      type: 'kill';
      attacker: number;
      victim: number;
      source: DamageSource;
      head: boolean;
      assist: number;
    }
  | { type: 'callout'; pid: number; text: string; tier: number }
  | { type: 'spawn'; pid: number }
  | { type: 'reload'; pid: number; weapon: WeaponId }
  | { type: 'swap'; pid: number; weapon: WeaponId }
  | { type: 'jump'; pid: number }
  | { type: 'land'; pid: number; speed: number }
  | { type: 'throw'; pid: number }
  | { type: 'bounce'; x: number; y: number; z: number }
  | {
      type: 'explode';
      x: number;
      y: number;
      z: number;
      nx: number;
      ny: number;
      nz: number;
      color: number;
      radius: number;
      owner: number;
    }
  | { type: 'zone'; zone: string; owner: Team; prev: Team }
  | { type: 'round'; winner: Team | -1; round: number }
  | { type: 'phase'; phase: MatchPhase }
  | { type: 'match'; winner: number };
