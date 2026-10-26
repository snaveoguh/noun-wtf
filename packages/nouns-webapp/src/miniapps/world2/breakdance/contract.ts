// ── Noun Breaks: the shared contract ─────────────────────────────────────
//
// Breakdance battles in the plaza: a cypher (a ring of crowd, a DJ, three
// judges) where Nouns trade rounds on the beat. A rhythm game underneath:
// each turn the dancer strings moves together, every move is a short
// pattern of inputs that has to land on the beat; clean timing, variety,
// power and a big freeze on the last beat win the judges. Formats: solo vs
// the CPU, 1v1 online, and crew battles (2v2 / 3v3, humans + CPU fill).
//
// Three parts build against these types and nothing else (like hoops/):
//
//   breakdance/sim/   the battle itself: beat clock, move library (as data),
//                     input judging, combos, judges' scoring, round / turn
//                     flow, CPU dancers. Pure TypeScript (no three.js, no
//                     DOM, no clock), deterministic for a seed + input stream.
//   breakdance/view/  everything you see and hear: procedural breaking
//                     animation on the Noun rig (toprock, footwork, power
//                     moves, freezes, transitions), the cypher's dressing,
//                     camera, HUD (beat track, move prompts, judges' cards),
//                     the break beat music and crowd audio. Reads SimState.
//   breakdance/net/   game flow + multiplayer: the cypher spot in the plaza,
//                     mode select, CPU fill, challenges, crews, host-
//                     authoritative sync over the world room (`break:*`
//                     messages, relayed by packages/nouns-party), and the
//                     Game.ts hook in and out of break mode.
//
// Change this file only additively (new optional fields, new union members),
// and say so in your report: the other two parts compile against it.

export type CrewId = 0 | 1;
/** Dancers per crew: 1 = a 1v1 battle. */
export type CrewSize = 1 | 2 | 3;

// ── Moves ───────────────────────────────────────────────────────────────

/** The four families of breaking, plus the bits between them. */
export type MoveFamily = 'toprock' | 'footwork' | 'power' | 'freeze' | 'transition';

/**
 * Every move the game knows. The sim owns their rules (MoveSpec), the view
 * owns their animation (one procedural clip per id; anything it doesn't
 * know falls back to its family's default).
 */
export type MoveId =
  // toprock
  | 'indian_step'
  | 'salsa_rock'
  | 'cross_step'
  | 'kick_step'
  // footwork / downrock
  | 'six_step'
  | 'three_step'
  | 'cc'
  | 'pretzel'
  | 'kick_out'
  // power
  | 'windmill'
  | 'flare'
  | 'headspin'
  | 'backspin'
  | 'swipe'
  | 'turtle'
  | 'airflare'
  // freezes
  | 'baby_freeze'
  | 'chair_freeze'
  | 'headstand'
  | 'airchair'
  | 'hollowback'
  // transitions
  | 'drop'
  | 'spin_down'
  | 'get_up';

/** A player input: the four directions + two buttons. */
export type BreakKey = 'up' | 'down' | 'left' | 'right' | 'a' | 'b';

export interface MoveSpec {
  id: MoveId;
  name: string;
  family: MoveFamily;
  /** The input pattern, one key per beat (or half beat when `half`). */
  pattern: readonly BreakKey[];
  half?: boolean;
  /** Length on the beat grid (beats). */
  beats: number;
  /** 1..5: how hard it is to land (CPU skill + scoring weight). */
  difficulty: number;
  /** Base points before timing / combo / variety. */
  points: number;
  /** Moves this one can flow straight into (others need a transition). */
  flowsTo?: readonly MoveFamily[];
}

// ── Timing ──────────────────────────────────────────────────────────────

export type HitGrade = 'perfect' | 'great' | 'ok' | 'miss';

/** Judging windows (seconds either side of the beat). */
export interface TimingWindows {
  perfect: number;
  great: number;
  ok: number;
}

export const DEFAULT_WINDOWS: TimingWindows = { perfect: 0.045, great: 0.09, ok: 0.14 };

// ── Battle config ───────────────────────────────────────────────────────

export interface Dancer {
  /** Stable id: a connection id for humans, 'cpu:<n>' for CPU dancers. */
  id: string;
  name: string;
  crew: CrewId;
  human: boolean;
  /** CPU skill 0..1 (timing spread, move difficulty, variety). */
  skill?: number;
  /** Noun look (NounSeed JSON as the game stores it) for the view. */
  seed?: unknown;
}

export interface BattleConfig {
  /** Game id: random per battle (a rematch is a new id). */
  gid: string;
  seed: number;
  crewSize: CrewSize;
  dancers: Dancer[];
  /** Rounds: each round every dancer takes one turn, alternating crews. */
  rounds: number;
  /** Turn length (bars of 4 beats). */
  turnBars: number;
  bpm: number;
  windows?: TimingWindows;
}

// ── Inputs ──────────────────────────────────────────────────────────────

/** One key press, timed on the battle clock (seconds since the battle began). */
export interface BreakInput {
  /** Dancer id. */
  id: string;
  key: BreakKey;
  t: number;
}

// ── State ───────────────────────────────────────────────────────────────

export type BattlePhase = 'intro' | 'turn' | 'judging' | 'between' | 'final' | 'done';

/** What a dancer is doing right now (the view animates this). */
export interface DancerPose {
  id: string;
  /** Current move and how far through it (0..1); null = vibing on the side. */
  move: MoveId | null;
  moveT: number;
  /** In the middle of the circle (their turn) or on the edge. */
  centre: boolean;
  /** Last input's grade (for flashes), and when (battle clock). */
  lastGrade?: HitGrade;
  lastAt?: number;
  /** Bailed the current move (a stumble the view shows). */
  crashed?: boolean;
}

export interface JudgeCard {
  /** Per judge (3): which crew got the vote, and the category scores. */
  votes: CrewId[];
  technique: [number, number];
  musicality: [number, number];
  originality: [number, number];
  power: [number, number];
}

export interface SimState {
  gid: string;
  phase: BattlePhase;
  /** Battle clock (s) and beat number (fractional, beat 0 = first downbeat). */
  t: number;
  beat: number;
  round: number;
  /** Whose turn: dancer id, and the turn's start / end beat. */
  turn: { id: string; from: number; to: number } | null;
  poses: DancerPose[];
  /** Live turn score and combo of the dancer up. */
  turnScore: number;
  combo: number;
  /** Next keys the dancer up should hit (for the HUD's beat track). */
  prompts: { key: BreakKey; beat: number }[];
  /** Totals per crew so far, and the judges' card per round. */
  totals: [number, number];
  cards: JudgeCard[];
  /** Set when the battle's done. */
  winner?: CrewId | 'tie';
}

// ── Events (one frame each; for the view's fx / audio and the net's toasts) ──

export type SimEvent =
  | { e: 'beat'; beat: number; downbeat: boolean }
  | { e: 'turn'; id: string; round: number }
  | { e: 'hit'; id: string; grade: HitGrade; key: BreakKey }
  | { e: 'move'; id: string; move: MoveId; landed: boolean; points: number }
  | { e: 'crash'; id: string }
  | { e: 'freeze'; id: string; move: MoveId; onBeat: boolean }
  | { e: 'combo'; id: string; combo: number }
  | { e: 'card'; round: number; card: JudgeCard }
  | { e: 'end'; winner: CrewId | 'tie'; totals: [number, number] };

/** The sim's surface (net/ drives it; view/ reads it). */
export interface BattleSim {
  readonly config: BattleConfig;
  /** Feed inputs (any order; they're judged against the battle clock). */
  input(i: BreakInput): void;
  /** Advance the clock; returns the events that fired. */
  step(dt: number): SimEvent[];
  state(): SimState;
  /**
   * (net/, optional) A human dropped mid-battle: a CPU dancer of this skill
   * takes over their id from now on. Without it net/ plays their prompts.
   */
  setCpu?(id: string, skill: number): void;
}

export type BattleSimFactory = (config: BattleConfig) => BattleSim;

/** What the view exposes to net/ (mount a battle, show it, take it down). */
export interface BattleView {
  /** Build the cypher round a world position (the plaza spot) for these dancers. */
  mount(config: BattleConfig, at: { x: number; y: number; z: number; yaw: number }): void;
  /** Per frame, after the sim stepped. */
  update(dt: number, state: SimState, events: readonly SimEvent[]): void;
  /** The local player's dancer id (for the HUD and camera). */
  setLocal(id: string | null): void;
  unmount(): void;
}

// ── Net messages (relayed by packages/nouns-party, `break:` prefix) ─────

export type BreakMsg =
  | {
      type: 'break:lobby';
      from?: string;
      at: boolean;
      crew?: string;
      /** (net/) Name + look of the player at the cypher. */
      name?: string;
      seedKey?: string;
      /** (net/) Set by a host while its battle runs (for WATCH). */
      live?: { gid: string; crewSize: CrewSize; names: string[] };
    }
  | {
      type: 'break:challenge';
      to: string;
      from?: string;
      crewSize: CrewSize;
      /** (net/) The battle being formed, the host's name, the crew offered. */
      gid?: string;
      name?: string;
      crew?: CrewId;
    }
  | { type: 'break:reply'; to: string; from?: string; ok: boolean; gid?: string }
  | {
      type: 'break:start';
      host?: string;
      config: BattleConfig;
      to?: string;
      /** (net/) The host's battle clock when sent (negative = countdown left). */
      at?: number;
      /** (net/) Judge delay (s): the host's sim runs this far behind the battle clock. */
      lag?: number;
    }
  | { type: 'break:input'; gid: string; i: BreakInput }
  | {
      type: 'break:s';
      gid: string;
      state: SimState;
      /** (net/) Events since the last snapshot (beats left out: clients make their own). */
      e?: SimEvent[];
      /** (net/) The host's battle clock when sent. */
      a?: number;
    }
  | { type: 'break:end'; gid: string; winner: CrewId | 'tie'; totals?: [number, number] }
  | { type: 'break:watch'; gid: string; from?: string }
  | { type: 'break:leave'; gid: string; id?: string }
  /** (net/) Clock sync: a member / spectator asks the host the battle time… */
  | { type: 'break:ping'; gid: string; c: number; from?: string }
  /** (net/) …and the host answers with its battle clock `a` (s) for that `c`. */
  | { type: 'break:pong'; gid: string; to: string; c: number; a: number };
