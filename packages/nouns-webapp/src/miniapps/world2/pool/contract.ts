// ── Noun Pool: the shared contract ───────────────────────────────────────
//
// 8-ball on the pool tables inside Noun World's bars, and as its own game
// (`/world?play=pool`, a pool hall). Same layout as hoops/ and breakdance/:
//
//   pool/sim/   the table, the ball physics, the 8-ball rules and the CPU.
//               Pure TypeScript (no three.js, no DOM, no clock) and
//               deterministic: the same state + shot gives the same result
//               on every machine (only + − × ÷ and sqrt in the hot loop).
//   pool/view/  the 3D table, balls, cue, players, cameras, aiming aids,
//               sound. Reads the sim.
//   pool/net/   PoolMode (the Game hook, `game.pool`), the menu, challenges,
//               and host-authoritative sync over the world room (`pool:*`
//               messages, relayed by packages/nouns-party/src/poolRelay.ts).
//
// Change this file only additively (new optional fields, new union members).
//
// ── For interiors/: playing on a bar's pool table ──────────────────────────
//
// When the player presses E at a pool table prop:
//
//   game.pool?.playAt({ x, y, z, yaw, length, width })
//
// x / y / z: the table's centre in world space, y = the FLOOR under it.
// yaw: the table's rotation about +Y (three.js convention), with the table's
// LENGTH along its local +X. length / width: the prop's outer size (m); the
// prop in interiors/build.ts is 2.3 × 1.3. Optional `height` (the prop's top,
// default 0.86) and `id` (a stable key so players at the same table can find
// each other; default: rounded x/z). It returns false if pool can't start
// (already playing, no level yet). Pool draws its own full table over the
// prop (slightly taller, so the prop's clutter balls are hidden under the
// felt), parks the player's Noun at the table, moves the camera in, keeps
// the room around you, and opens the menu (VS CPU / 1V1 / WATCH). ESC or
// LEAVE puts the camera and player back exactly where they were.
//
// `game.pool.active` is true from playAt until the player is back in the
// room (menu open included): skip your own E prompt / room camera then.

// ── Balls and the table ─────────────────────────────────────────────────

/** 0 = the cue ball, 1–7 solids, 8 the black, 9–15 stripes. */
export type BallId = number;
export const CUE = 0;
export const EIGHT = 8;
export const BALLS = 16;

export type Group = 'solids' | 'stripes';
export type Seat = 0 | 1;

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * The six pockets, sim frame (x along the length, y across):
 * 0 (−x,−y) corner, 1 (0,−y) side, 2 (+x,−y) corner,
 * 3 (+x,+y) corner, 4 (0,+y) side, 5 (−x,+y) corner.
 */
export type PocketId = 0 | 1 | 2 | 3 | 4 | 5;

// ── A shot ──────────────────────────────────────────────────────────────

export interface Shot {
  /** Aim direction on the table (sim frame, unit length; normalised anyway). */
  dx: number;
  dy: number;
  /** 0..1 of the cue's top speed. */
  power: number;
  /**
   * Where the tip meets the cue ball, as a fraction of the most you can
   * (−1..1): side = english (+ right), top = follow (+) / draw (−).
   */
  side: number;
  top: number;
}

/** Everything one turn sends: the shot, where the cue went (ball in hand), the called pocket. */
export interface ShotInput {
  shot: Shot;
  /** Ball in hand: where the shooter put the cue ball. */
  cue?: Vec2;
  /** On the 8: the pocket it's called in. */
  call?: PocketId;
}

// ── The frame (rules state) ─────────────────────────────────────────────

export type FoulKind = 'scratch' | 'no_contact' | 'wrong_first' | 'no_rail' | 'bad_break';

export type FramePhase = 'break' | 'play' | 'over';

export interface FrameState {
  /** Where each ball rests (index = BallId); null = pocketed (the cue: in hand). */
  balls: (Vec2 | null)[];
  phase: FramePhase;
  /** Whose shot. */
  turn: Seat;
  /** Each seat's group once the table's decided (null while it's open). */
  groups: [Group | null, Group | null];
  /** The shooter may place the cue: in the kitchen (behind the head string) or anywhere. */
  inHand: null | 'kitchen' | 'anywhere';
  /** Shots taken. */
  shots: number;
  fouls: [number, number];
  /** What the last shot did (for the HUD). */
  last: ShotOutcome | null;
  winner: Seat | null;
  /** Why the frame ended ('8 in the called pocket', 'scratched on the 8' …). */
  reason?: string;
}

export interface ShotOutcome {
  by: Seat;
  foul: FoulKind | null;
  /** Object balls down this shot (in the order they dropped). */
  potted: BallId[];
  scratch: boolean;
  /** Groups decided on this shot. */
  assigned: boolean;
  /** The shooter goes again. */
  again: boolean;
  /** The 8 came back up (potted on the break). */
  respotted: boolean;
}

// ── Players and the match ───────────────────────────────────────────────

export interface PoolPlayer {
  /** Connection id for humans, 'cpu' for the CPU. */
  id: string;
  name: string;
  human: boolean;
  /** CPU skill 0..1. */
  skill?: number;
  /** NounSeed key (character/NounAppearance seedKey) for the view. */
  seedKey?: string;
}

export interface PoolConfig {
  /** Game id: random per frame (a rematch is a new id). */
  gid: string;
  /** Seeds the rack. */
  seed: number;
  players: [PoolPlayer, PoolPlayer];
  /** Who breaks. */
  breaker: Seat;
  /** Short aiming guide (hard CPU / "pro"). */
  pro?: boolean;
  /** Which table (PoolTable.id), so watchers find it. */
  table?: string;
  /** Where that table is (world), so a player who accepts from across the room joins at it. */
  place?: PoolTable;
}

// ── Where it's played (world) ───────────────────────────────────────────

export interface PoolTable {
  /** Centre of the table, world; y = the floor under it. */
  x: number;
  y: number;
  z: number;
  /** Rotation about +Y; the table's length runs along its local +X. */
  yaw: number;
  /** Outer size (m), the prop's footprint. */
  length: number;
  width: number;
  /** The prop's top (m above the floor). Default 0.86. */
  height?: number;
  /** Stable key for this table. */
  id?: string;
}

/** `game.pool` (pool/net/PoolMode.ts). */
export interface PoolApi {
  /** True from playAt until you're back to walking around (menu included). */
  readonly active: boolean;
  /** Start pool on this table (opens the menu). False if it can't right now. */
  playAt(table: PoolTable): boolean;
  /** Leave the table (a forfeit mid-frame). */
  leave(): void;
}

// ── Net messages (relayed by packages/nouns-party, `pool:` prefix) ──────

export interface LiveFrame {
  gid: string;
  host: string;
  names: [string, string];
  table?: string;
}

export type PoolMsg =
  /** Presence: at a table (its key) or not; a host advertises its live frame. */
  | {
      type: 'pool:lobby';
      from?: string;
      at: string | null;
      name?: string;
      seedKey?: string;
      live?: LiveFrame;
    }
  | {
      type: 'pool:challenge';
      to: string;
      from?: string;
      gid: string;
      name?: string;
      table?: string;
      place?: PoolTable;
    }
  | { type: 'pool:reply'; to: string; from?: string; gid: string; ok: boolean }
  /** The host starts a frame (to everyone in it; with `to`, one late watcher, with the state). */
  | {
      type: 'pool:start';
      host?: string;
      config: PoolConfig;
      to?: string;
      state?: FrameState;
      n?: number;
    }
  /**
   * The shooter's shot, to the host (n = the shot number it's for). From the
   * host it's the accepted shot, to everyone in the frame: all of them play
   * it out with the same deterministic sim straight away.
   */
  | { type: 'pool:shot'; gid: string; n: number; input: ShotInput; from?: string }
  /** The shooter's live aim, for everyone watching (throttled). */
  | {
      type: 'pool:aim';
      gid: string;
      dx: number;
      dy: number;
      p: number;
      cue?: Vec2;
      from?: string;
    }
  /** The host: shot n was this, and the frame is now `state`. */
  | { type: 'pool:result'; gid: string; n: number; input: ShotInput; state: FrameState }
  | { type: 'pool:end'; gid: string; winner: Seat | null; reason?: string }
  | { type: 'pool:watch'; gid: string; from?: string }
  | { type: 'pool:leave'; gid: string; id?: string };
