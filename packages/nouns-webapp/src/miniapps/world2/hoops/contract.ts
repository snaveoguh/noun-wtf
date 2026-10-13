// ── Noun Hoops: the shared contract ──────────────────────────────────────
//
// Arcade basketball (NBA Jam / NBA Street energy, not a sim) on the Noun
// Jersey court. Three parts build against these types and nothing else:
//
//   hoops/sim/   the game itself: ball physics, actions, rules, bot AI.
//                Pure TypeScript (no three.js, no DOM), deterministic for a
//                given seed + input stream, so the host can run it and
//                clients can predict / replay it.
//   hoops/view/  everything you see and hear: court dressing, ball, nets,
//                animated Noun players, cameras, HUD, audio. Reads SimState.
//   hoops/net/   game flow + multiplayer: court lobby, mode select, NPC
//                fill, challenges between players, host-authoritative sync,
//                and the Game.ts hook into and out of hoops mode.
//
// Change this file only additively (new optional fields, new union members),
// and say so in your report: the other two parts compile against it.

/** Players per side. */
export type TeamSize = 1 | 2 | 3 | 5;
export type TeamId = 0 | 1;

// ── Court ───────────────────────────────────────────────────────────────
//
// Sim space is court-local metres: origin at the centre of the floor, +y
// up, z along the court's length (team 0 attacks the +z basket in the first
// half), x across. The view / net layers own the world placement.

export interface CourtSpec {
  /** Playing surface: full length (z) and width (x). */
  length: number;
  width: number;
  /** Rim centre: height, and distance from each baseline (along z). */
  rimHeight: number;
  rimFromBaseline: number;
  rimRadius: number;
  /** Backboard: width, height, its face's distance from the baseline, its bottom edge height. */
  boardWidth: number;
  boardHeight: number;
  boardFromBaseline: number;
  boardBottom: number;
  /** Three-point arc radius (from the rim centre) and the key's width / length. */
  threeRadius: number;
  keyWidth: number;
  keyLength: number;
  ballRadius: number;
}

/**
 * The Noun Jersey court (world/mountain/NounJerseyPark.ts): park coords
 * a 46–72 × b 6–30. In sim space: length 24 (park b), width 26 (park a),
 * rims 1.15 m inside each baseline, i.e. at park (59, 7.15) and (59, 28.85),
 * 3.05 m up. (The park's original hoops stood with their rims just outside
 * the baselines; hoops/view rebuilds them to these numbers.)
 */
export const JERSEY_COURT: CourtSpec = {
  length: 24,
  width: 26,
  rimHeight: 3.05,
  rimFromBaseline: 1.15,
  rimRadius: 0.23,
  boardWidth: 1.8,
  boardHeight: 1.1,
  boardFromBaseline: 0.8,
  boardBottom: 2.9,
  threeRadius: 6.75,
  keyWidth: 4.9,
  keyLength: 5.8,
  ballRadius: 0.12,
};

/** Park coords of the court (for the view / net layers placing it in the world). */
export const JERSEY_COURT_PARK = { a0: 46, a1: 72, b0: 6, b1: 30 } as const;

// ── Setup ───────────────────────────────────────────────────────────────

export interface Baller {
  /** Stable id: a net player id, or `bot:<n>` for NPCs. */
  id: string;
  team: TeamId;
  bot: boolean;
  name: string;
  /** NounCharacter seed key (see character/NounAppearance), for the view. */
  seedKey: string;
  /** Arcade ratings 0..1 (bots get varied ones; humans default to 0.6). */
  ratings?: Partial<Record<'speed' | 'shooting' | 'dunking' | 'defense' | 'passing', number>>;
}

export interface GameConfig {
  size: TeamSize;
  /**
   * Half court (1v1, 2v2, 3v3 streetball) or full court (5v5). Half court:
   * both teams attack the +z basket and z < 0 is out of bounds. Full court:
   * team 0 attacks +z, team 1 attacks -z.
   */
  halfCourt: boolean;
  /** First to this many points (win by 2 if `winBy2`). */
  target: number;
  winBy2: boolean;
  /** Seconds; 0 = no shot clock. */
  shotClock: number;
  /** Twos and threes (true) or ones and twos, streetball-style (false). */
  nbaScoring: boolean;
  seed: number;
  players: Baller[];
  court: CourtSpec;
  /** 1 easy … 3 hard (bot skill). */
  difficulty?: 1 | 2 | 3;
}

/** Sensible defaults per mode (the lobby offers these). */
export const MODE_DEFAULTS: Record<TeamSize, Omit<GameConfig, 'seed' | 'players' | 'court'>> = {
  1: { size: 1, halfCourt: true, target: 11, winBy2: true, shotClock: 12, nbaScoring: false },
  2: { size: 2, halfCourt: true, target: 15, winBy2: true, shotClock: 14, nbaScoring: false },
  3: { size: 3, halfCourt: true, target: 21, winBy2: true, shotClock: 14, nbaScoring: true },
  5: { size: 5, halfCourt: false, target: 31, winBy2: false, shotClock: 24, nbaScoring: true },
};

// ── Input ───────────────────────────────────────────────────────────────

/**
 * One baller's controls for one sim step. Movement is already resolved
 * into court space by the client (camera-relative stick → court x / z).
 * Buttons are levels, not edges: the sim detects presses / releases.
 */
export interface BallerInput {
  moveX: number;
  moveZ: number;
  sprint: boolean;
  /** Offense: hold to gather + rise, release at the top for a perfect shot (meter). Defense: jump / contest / block. */
  shoot: boolean;
  /** Offense: pass (to `passTo`, else the best-placed teammate). Defense: switch / call for help. */
  pass: boolean;
  passTo?: string;
  /** Offense: crossover / spin move. Defense: steal attempt. */
  move: boolean;
  /** Offense, off the ball: call for it (bots pass more). Alley-oop: hold pass + shoot. */
  call: boolean;
}

export const NO_INPUT: BallerInput = {
  moveX: 0,
  moveZ: 0,
  sprint: false,
  shoot: false,
  pass: false,
  move: false,
  call: false,
};

// ── State (what the view draws and the net layer syncs) ─────────────────

export type BallerAction =
  | 'idle'
  | 'run'
  | 'dribble'
  | 'crossover'
  | 'spin'
  | 'gather'
  | 'jumpshot'
  | 'layup'
  | 'dunk'
  | 'alleyoop'
  | 'pass'
  | 'catch'
  | 'rebound'
  | 'block'
  | 'steal'
  | 'defend'
  | 'stumble'
  | 'celebrate'
  | 'dejected';

export interface BallerState {
  id: string;
  team: TeamId;
  x: number;
  y: number;
  z: number;
  /** Facing (rad, three.js convention: forward = (sin, cos) in x / z). */
  yaw: number;
  vx: number;
  vz: number;
  action: BallerAction;
  /** 0..1 through the current action (for animation). */
  actionT: number;
  hasBall: boolean;
  /** 0..1 while gathering a shot; the sweet spot is SHOT_SWEET. */
  meter?: number;
  /** While dunking (action 'dunk' / 'alleyoop'): which slam the view should play. */
  dunkStyle?: DunkStyle;
  /** NBA Jam: three straight scores. */
  onFire: boolean;
  stamina: number;
}

/** Arcade dunk styles (hoops/sim picks one by situation). */
export type DunkStyle = 'two-hand' | 'tomahawk' | 'windmill' | 'reverse' | '360';

/** How a jump-shot release landed on the meter (for the HUD callout). */
export type ShotRelease = 'perfect' | 'good' | 'early' | 'late';

/** Per-baller box score (SimState.stats). */
export interface BallerStats {
  pts: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  reb: number;
  oreb: number;
  ast: number;
  stl: number;
  blk: number;
  dunks: number;
  tov: number;
}

/** Shot-meter value for a perfect release. */
export const SHOT_SWEET = 0.86;

export type BallState = 'held' | 'air' | 'loose' | 'dead';

export interface BallSimState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Spin for the view (rad / s about x, y, z). */
  sx: number;
  sy: number;
  sz: number;
  state: BallState;
  holder: string | null;
  /** While in the air from a shot: who shot it and what it's worth. */
  shooter: string | null;
  value: number;
}

export type GamePhase = 'pregame' | 'checkball' | 'live' | 'scored' | 'turnover' | 'final';

export type SimEvent =
  | { type: 'dribble'; id: string }
  | {
      type: 'shot';
      id: string;
      value: number;
      quality: number;
      kind: 'jumper' | 'layup' | 'dunk' | 'alleyoop';
      /** Jumpers: how the release landed on the meter. */
      release?: ShotRelease;
      /** Dunks / alley-oops: the slam style. */
      style?: DunkStyle;
      /** Beyond the arc (worth the higher value). */
      three?: boolean;
    }
  | {
      type: 'score';
      team: TeamId;
      id: string;
      points: number;
      how: 'swish' | 'rim' | 'bank' | 'dunk' | 'layup' | 'alleyoop';
    }
  | { type: 'miss'; id: string }
  | { type: 'rim'; strength: number }
  | { type: 'backboard'; strength: number }
  | { type: 'bounce'; strength: number }
  | { type: 'net' }
  | { type: 'pass'; from: string; to: string }
  | { type: 'steal'; id: string; from: string }
  | { type: 'block'; id: string; on: string }
  | { type: 'rebound'; id: string; offensive: boolean }
  | { type: 'crossover'; id: string; ankles: boolean }
  | { type: 'onFire'; id: string }
  | { type: 'fireOut'; id: string }
  | { type: 'shotClock'; team: TeamId }
  | { type: 'outOfBounds'; team: TeamId }
  | { type: 'checkball'; team: TeamId }
  | { type: 'final'; winner: TeamId; score: [number, number] }
  /** Defender touched a ball on its way down to the rim: the basket counts. */
  | { type: 'goaltend'; id: string; team: TeamId }
  /** Half court: the new offense took the ball past the arc. */
  | { type: 'cleared'; team: TeamId }
  /**
   * Dead-ball turnover other than shot clock / out of bounds: a basket made
   * without clearing, or a held / stalled ball. `team` loses the ball.
   */
  | { type: 'violation'; team: TeamId; kind: 'clear' | 'held' }
  /** A dunk slam (the moment the ball is thrown down, made or not). */
  | { type: 'slam'; id: string; style: DunkStyle; made: boolean };

export interface SimState {
  tick: number;
  /** Seconds since tip-off. */
  time: number;
  phase: GamePhase;
  /** Seconds left in the current phase pause (scored → checkball etc.). */
  phaseT: number;
  score: [number, number];
  /** Team with the ball (or due to check it). */
  offense: TeamId;
  shotClock: number;
  players: BallerState[];
  ball: BallSimState;
  /** Events since the previous step (the view plays them once). */
  events: SimEvent[];
  /** Box score per baller id. */
  stats?: Record<string, BallerStats>;
  /** Half court: the offense still has to take the ball past the arc. */
  mustClear?: boolean;
  /**
   * Opaque sim internals (PRNG, action timers, bot brains): plain JSON, so
   * load(state()) resumes bit-exactly. A snapshot without it still loads
   * (internals are rebuilt), it just won't replay exactly.
   */
  sim?: unknown;
}

/** What hoops/sim exports (class HoopsSim implements this). */
export interface HoopsSimApi {
  readonly config: GameConfig;
  /** Advance one fixed step (SIM_DT). Inputs for humans; bots drive themselves. */
  step(inputs: Record<string, BallerInput>): SimState;
  state(): SimState;
  /** Replace the whole state (clients applying a host snapshot). */
  load(state: SimState): void;
}

/** Fixed sim step (s). */
export const SIM_DT = 1 / 60;

// ── Network (PartyKit, the world2 room; see net/Net.ts) ─────────────────
//
// Host-authoritative: the challenger (or the lone human) hosts and runs
// HoopsSim; other humans send inputs; the host broadcasts snapshots. A game
// is identified by `gid`.

export type HoopsMsg =
  /** Ask another player in the world to play (they get an invite toast). */
  | {
      type: 'hoops:challenge';
      gid: string;
      from: string;
      to: string;
      size: TeamSize;
      fromName: string;
    }
  | { type: 'hoops:reply'; gid: string; from: string; to: string; accept: boolean }
  /** Host → everyone in the game: roster + config, start (clients teleport to the court). */
  | { type: 'hoops:start'; gid: string; host: string; config: GameConfig }
  /** Human → host, ~30 Hz. */
  | { type: 'hoops:input'; gid: string; id: string; seq: number; input: BallerInput }
  /** Host → game, ~20 Hz (quantised state). */
  | { type: 'hoops:snap'; gid: string; state: SimState }
  | { type: 'hoops:leave'; gid: string; id: string }
  | { type: 'hoops:end'; gid: string; winner: TeamId; score: [number, number] };
