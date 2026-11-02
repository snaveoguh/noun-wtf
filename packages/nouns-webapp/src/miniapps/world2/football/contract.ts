// ── Noun Football: the shared contract ──────────────────────────────────
//
// Association football (soccer) in a full stadium in Noun World, as close to
// a console football game's feel as the browser allows. Like hoops/ and
// pool/, four parts build against these types and nothing else:
//
//   football/sim/    the match itself: ball physics (spin, curl, bounce,
//                    woodwork, nets), footballers, actions (first touch,
//                    passes, shots, headers, tackles), the laws (restarts,
//                    offside, fouls, cards, clock, extra time, penalties),
//                    team AI and goalkeepers. Pure TypeScript (no three.js,
//                    no DOM, no clock), deterministic for a seed + inputs,
//                    plain JSON state.
//   football/view/   everything you see and hear: the stadium (pitch,
//                    goals + nets, stands, instanced crowd, floodlights,
//                    tunnel, dugouts, big screen), footballers on the Noun
//                    rig (breakdance's PoseDriver), the ball, cameras
//                    (broadcast, player cam, goal replays), the HUD, audio.
//   football/net/    game flow + multiplayer: FootballMode (the Game.ts
//                    hook), menus, input mapping (gamepad / keys / touch),
//                    lobby, host-authoritative sync, cup, respect.
//   football/site.ts where the stadium stands in the world (pure).
//
// Change this file only additively (new optional fields, new union members).

/** Players per side. */
export type TeamSize = 5 | 7 | 11;
export type TeamId = 0 | 1;
export const TEAM_SIZES: TeamSize[] = [5, 7, 11];

// ── Pitch ───────────────────────────────────────────────────────────────
//
// Sim space is pitch-local metres: origin on the centre spot, +y up, z along
// the length (team 0 attacks +z in periods 1 and 3, −z in 2 and 4), x across
// (+x is the left touchline when facing +z... i.e. three.js: facing +z,
// +x is to your LEFT). Goal lines at z = ±length/2, touchlines at
// x = ±width/2. The view / net layers own the placement in the world
// (`StadiumFrame`).

export interface PitchSpec {
  /** Goal line to goal line (z) and touchline to touchline (x). */
  length: number;
  width: number;
  /** Inside of the posts apart, underside of the crossbar, net depth behind the line. */
  goalWidth: number;
  goalHeight: number;
  goalDepth: number;
  /** Post / crossbar radius (round woodwork). */
  postRadius: number;
  /** Penalty area: depth from the goal line, width across. */
  boxDepth: number;
  boxWidth: number;
  /** Goal area (six-yard box). */
  sixDepth: number;
  sixWidth: number;
  /** Penalty spot distance from the goal line; the arc's radius round it. */
  penaltySpot: number;
  /** Centre circle radius (also the free kick wall distance). */
  centreRadius: number;
  ballRadius: number;
}

/** A full-size pitch (and the stadium's grass is a bit bigger than this). */
export const PITCH_11: PitchSpec = {
  length: 105,
  width: 68,
  goalWidth: 7.32,
  goalHeight: 2.44,
  goalDepth: 2.2,
  postRadius: 0.06,
  boxDepth: 16.5,
  boxWidth: 40.32,
  sixDepth: 5.5,
  sixWidth: 18.32,
  penaltySpot: 11,
  centreRadius: 9.15,
  ballRadius: 0.11,
};

/** 7-a-side: a cut-down pitch across the middle of the big one, smaller goals. */
export const PITCH_7: PitchSpec = {
  length: 64,
  width: 44,
  goalWidth: 5,
  goalHeight: 2,
  goalDepth: 1.6,
  postRadius: 0.05,
  boxDepth: 11,
  boxWidth: 26,
  sixDepth: 4,
  sixWidth: 12,
  penaltySpot: 8,
  centreRadius: 6,
  ballRadius: 0.11,
};

/** 5-a-side. */
export const PITCH_5: PitchSpec = {
  length: 44,
  width: 28,
  goalWidth: 3.66,
  goalHeight: 1.83,
  goalDepth: 1.2,
  postRadius: 0.045,
  boxDepth: 7,
  boxWidth: 16,
  sixDepth: 3,
  sixWidth: 8,
  penaltySpot: 6,
  centreRadius: 4,
  ballRadius: 0.11,
};

export const PITCHES: Record<TeamSize, PitchSpec> = { 5: PITCH_5, 7: PITCH_7, 11: PITCH_11 };

/**
 * The stadium's grass (centred on the big pitch's centre spot): the full
 * pitch plus a run-off. Small-sided pitches are marked inside it.
 */
export const GRASS = { length: 105 + 2 * 7, width: 68 + 2 * 6 } as const;

// ── Teams + players ─────────────────────────────────────────────────────

export type Role = 'GK' | 'DF' | 'MF' | 'FW';

/** 0..1 ratings (bots get varied ones; humans default to 0.7). */
export interface Ratings {
  pace: number;
  shooting: number;
  passing: number;
  dribbling: number;
  defending: number;
  physical: number;
  /** Goalkeeping (reach, reflexes, handling). */
  keeping: number;
}

export interface Footballer {
  /** Stable id: `t<team>p<n>` (n = 0 is the keeper). */
  id: string;
  team: TeamId;
  name: string;
  /** Shirt number. */
  number: number;
  role: Role;
  /** NounCharacter seed key (character/NounAppearance `seedKey`), for the view. */
  seedKey: string;
  ratings?: Partial<Ratings>;
}

export interface TeamKit {
  name: string;
  /** Three-letter code for the scoreboard. */
  short: string;
  /** Shirt / shorts / socks, keeper's shirt (0xRRGGBB). */
  shirt: number;
  shorts: number;
  socks: number;
  keeper: number;
}

/** A formation as rows from the back: [DF, MF, FW] counts, keeper implied. */
export type Formation =
  | '4-4-2'
  | '4-3-3'
  | '4-2-3-1'
  | '3-5-2'
  | '5-3-2'
  // small-sided
  | '2-3-1'
  | '3-2-1'
  | '2-1-1'
  | '1-2-1';

export const FORMATIONS: Record<TeamSize, Formation[]> = {
  11: ['4-4-2', '4-3-3', '4-2-3-1', '3-5-2', '5-3-2'],
  7: ['2-3-1', '3-2-1'],
  5: ['2-1-1', '1-2-1'],
};

/** CPU skill: 1 amateur … 4 legendary. */
export type Difficulty = 1 | 2 | 3 | 4;
export const DIFFICULTY_NAMES: Record<Difficulty, string> = {
  1: 'AMATEUR',
  2: 'PRO',
  3: 'WORLD CLASS',
  4: 'LEGENDARY',
};

/** Team tactics (press height etc.), 0..1. */
export interface Tactics {
  /** Defensive line height / how high they press. */
  press: number;
  /** Width in possession. */
  width: number;
  /** Directness: long balls vs keeping it. */
  direct: number;
}

export interface MatchConfig {
  size: TeamSize;
  pitch: PitchSpec;
  /** Real seconds per half (the clock shows 45 match minutes over it). */
  halfSeconds: number;
  /** Knockout: extra time (two halves of halfSeconds / 3) then penalties if level. */
  knockout: boolean;
  /** Laws switches (all on by default). */
  offside: boolean;
  fouls: boolean;
  seed: number;
  /** Every footballer, both teams, keepers first. */
  players: Footballer[];
  kits: [TeamKit, TeamKit];
  formations: [Formation, Formation];
  tactics?: [Tactics, Tactics];
  /** CPU skill per team (the CPU runs every footballer nobody controls). */
  difficulty: [Difficulty, Difficulty];
  /** Humans: who plays, on which team (none = WATCH, CPU vs CPU). */
  humans: { id: string; name: string; team: TeamId }[];
  /** Which team kicks off first. */
  firstKick?: TeamId;
}

// ── Input ───────────────────────────────────────────────────────────────
//
// One human's pad for one sim step. Movement is already resolved into
// pitch space by the client (camera-relative stick → pitch x / z). Buttons
// are levels, not edges: the sim detects presses / releases and how long a
// button was held (pass / shot power, like a console power bar).
//
// The layout (gamepad names; keys + touch map onto the same):
//   in possession                       out of possession
//   A      ground pass (hold = power)   standing tackle
//   B      shoot (hold = power)         slide tackle
//   X      lob / cross                  second man press (hold)
//   Y      through ball                 keeper rush (hold)
//   RT     sprint                       sprint
//   LT     close control / shield       jockey
//   RB     finesse (curl) modifier      —
//   LB     —                            switch player (nearest the ball)
//   right stick                         skill move (flick dir) / switch by direction
// Headers and volleys: A / B / X while the ball is in the air near you.

export interface PadInput {
  mx: number;
  mz: number;
  sprint: boolean;
  /** A */
  pass: boolean;
  /** B */
  shoot: boolean;
  /** X */
  lob: boolean;
  /** Y */
  through: boolean;
  /** LB (switch) */
  switchP: boolean;
  /** RB (finesse modifier) */
  finesse: boolean;
  /** LT (close control / jockey) */
  jockey: boolean;
  /** Right stick, pitch space (skill flick in possession; switch by direction out of it). */
  rx: number;
  rz: number;
}

export const NO_PAD: PadInput = {
  mx: 0,
  mz: 0,
  sprint: false,
  pass: false,
  shoot: false,
  lob: false,
  through: false,
  switchP: false,
  finesse: false,
  jockey: false,
  rx: 0,
  rz: 0,
};

// ── State (what the view draws and the net layer syncs) ─────────────────

export type Action =
  | 'idle'
  | 'jog'
  | 'run'
  | 'sprint'
  | 'dribble'
  | 'trap'
  | 'pass'
  | 'lob'
  | 'shoot'
  | 'volley'
  | 'header'
  | 'tackle'
  | 'slide'
  | 'fallen'
  | 'jockey'
  | 'shield'
  | 'skill'
  | 'throw_in'
  | 'celebrate'
  | 'dejected'
  // keepers
  | 'gk_ready'
  | 'gk_dive'
  | 'gk_catch'
  | 'gk_hold'
  | 'gk_throw'
  | 'gk_kick';

export interface PlayerState {
  id: string;
  team: TeamId;
  x: number;
  /** Feet height (jumps for headers, keeper dives). */
  y: number;
  z: number;
  vx: number;
  vz: number;
  /** Facing (rad, three.js convention: forward = (sin, cos) in x / z). */
  yaw: number;
  action: Action;
  /** 0..1 through the current action (for animation). */
  actionT: number;
  /** Dive direction (−1 left / +1 right, of the keeper's facing), skill index, etc. */
  actionDir?: number;
  stamina: number;
  /** 0 none, 1 yellow; sent off players are `off: true` and stand in the tunnel. */
  yellow: number;
  off?: boolean;
  /** Human controlling this footballer right now (id), if any. */
  human?: string | null;
}

export type BallMode = 'free' | 'held' | 'dead';

export interface BallState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Spin (rad / s, world axes): y = curl (sidespin), x / z = top / back spin. */
  wx: number;
  wy: number;
  wz: number;
  /** free: in play; held: in a keeper's hands / a thrower's; dead: placed for a restart. */
  mode: BallMode;
  /** Who's holding it (keeper / thrower), or who has it at their feet (dribbling). */
  owner: string | null;
  lastTouch: string | null;
}

export type Phase =
  | 'pregame'
  | 'kickoff'
  | 'live'
  | 'restart'
  | 'goal'
  | 'halftime'
  | 'fulltime'
  | 'shootout'
  | 'final';

export type RestartKind =
  | 'kickoff'
  | 'throw_in'
  | 'corner'
  | 'goal_kick'
  | 'free_kick'
  | 'penalty'
  | 'drop_ball';

export interface Restart {
  kind: RestartKind;
  team: TeamId;
  x: number;
  z: number;
  /** Who takes it (picked by the sim; a human's selected player when theirs). */
  taker: string | null;
  /** Free kicks: direct (can score) or indirect (offside etc.). */
  direct?: boolean;
}

/** 1, 2: halves; 3, 4: extra time; 5: penalty shootout. */
export type Period = 1 | 2 | 3 | 4 | 5;

export interface Shootout {
  /** Each team's kicks in order: true = scored. */
  kicks: [boolean[], boolean[]];
  /** Whose kick is next. */
  next: TeamId;
}

export interface TeamStats {
  shots: number;
  onTarget: number;
  /** Ticks in possession (the HUD shows a %). */
  poss: number;
  passes: number;
  passesDone: number;
  tackles: number;
  fouls: number;
  corners: number;
  offsides: number;
  yellows: number;
  reds: number;
  saves: number;
}

export interface GoalRecord {
  team: TeamId;
  scorer: string;
  assist: string | null;
  /** Match minute (as the clock shows it). */
  minute: number;
  ownGoal: boolean;
  penalty: boolean;
}

export type FootballEvent =
  | {
      type: 'kick';
      id: string;
      kind: 'pass' | 'through' | 'lob' | 'shot' | 'volley' | 'clear' | 'restart';
      power: number;
    }
  | { type: 'header'; id: string; power: number }
  | { type: 'touch'; id: string; quality: number }
  | { type: 'bounce'; strength: number }
  | { type: 'woodwork'; part: 'post' | 'bar'; strength: number }
  | { type: 'net'; strength: number }
  | { type: 'goal'; team: TeamId; scorer: string; assist: string | null; ownGoal: boolean }
  | { type: 'save'; id: string; caught: boolean }
  | { type: 'tackle'; id: string; on: string; won: boolean; slide: boolean }
  | { type: 'foul'; id: string; on: string; x: number; z: number; penalty: boolean }
  | { type: 'card'; id: string; color: 'yellow' | 'red' }
  | { type: 'offside'; id: string; x: number; z: number }
  | { type: 'out'; kind: RestartKind; team: TeamId }
  | { type: 'whistle'; kind: 'short' | 'long' | 'end' }
  | { type: 'restart'; restart: Restart }
  | { type: 'period'; period: Period }
  | { type: 'shootout'; team: TeamId; id: string; scored: boolean }
  | { type: 'switch'; human: string; to: string }
  | { type: 'chance'; team: TeamId; quality: number }
  | { type: 'final'; winner: TeamId | null; score: [number, number]; pens?: [number, number] };

export interface SimState {
  tick: number;
  /** Real seconds since kick-off (the clock runs through restarts, like TV). */
  time: number;
  period: Period;
  /** Match clock in seconds as shown (0..45*60 in the first half, 45*60.. in the second, …). */
  clock: number;
  /** Stoppage time announced for this period (match seconds). */
  added: number;
  phase: Phase;
  /** Seconds left in the current pause (goal celebration → kickoff etc.). */
  phaseT: number;
  score: [number, number];
  /** Team in possession (last controlled touch). */
  poss: TeamId;
  /** Which team attacks +z this period. */
  attackPlusZ: TeamId;
  restart: Restart | null;
  players: PlayerState[];
  ball: BallState;
  shootout: Shootout | null;
  goals: GoalRecord[];
  stats: [TeamStats, TeamStats];
  /** Per human: their power bar while charging (0..1), and which kick. */
  charge: Record<string, { power: number; kind: 'pass' | 'shot' | 'lob' | 'through' } | undefined>;
  /** Events since the previous step (the view plays them once). */
  events: FootballEvent[];
  /**
   * Opaque sim internals (PRNG, timers, AI brains): plain JSON, so
   * load(state()) resumes bit-exactly. A snapshot without it still loads.
   */
  sim?: unknown;
}

/** What football/sim exports (class FootballSim implements this). */
export interface FootballSimApi {
  readonly config: MatchConfig;
  /** Advance one fixed step (SIM_DT). Inputs by human id; the CPU drives everyone else. */
  step(inputs: Record<string, PadInput>): SimState;
  state(): SimState;
  /** Replace the whole state (clients applying a host snapshot). */
  load(state: SimState): void;
}

/** Fixed sim step (s). The mode accumulates frame time and steps this. */
export const SIM_DT = 1 / 60;

/** Match minutes per real second for a given half length. */
export const clockRate = (halfSeconds: number) => (45 * 60) / halfSeconds;

// ── The stadium in the world (football/site.ts resolves it) ─────────────

/**
 * World placement of the pitch: the centre spot at (x, y, z), pitch +z
 * along world (sin yaw, cos yaw). Sim (px, py, pz) → world:
 *   wx = x + px·cos(yaw) + pz·sin(yaw)
 *   wz = z − px·sin(yaw) + pz·cos(yaw)
 *   wy = y + py
 */
export interface StadiumFrame {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export function pitchToWorld(
  f: StadiumFrame,
  px: number,
  py: number,
  pz: number,
  out: { x: number; y: number; z: number },
) {
  const c = Math.cos(f.yaw);
  const s = Math.sin(f.yaw);
  out.x = f.x + px * c + pz * s;
  out.y = f.y + py;
  out.z = f.z - px * s + pz * c;
  return out;
}

export function worldToPitch(
  f: StadiumFrame,
  wx: number,
  wz: number,
  out: { x: number; z: number },
) {
  const c = Math.cos(f.yaw);
  const s = Math.sin(f.yaw);
  const dx = wx - f.x;
  const dz = wz - f.z;
  out.x = dx * c - dz * s;
  out.z = dx * s + dz * c;
  return out;
}

/** Stadium outline (pitch-local, m): stands ring the grass out to here. */
export const STADIUM = {
  /** Outer wall half extents (x across, z along). */
  halfX: 96,
  halfZ: 116,
  /** Roof rim height over the pitch. */
  height: 34,
  /** Level pad round it (terrain), beyond the outer wall. */
  apron: 30,
} as const;

// ── The stadium shell (football/view/stadium, StadiumView) ──────────────

/** What the match view needs from the stadium (football/view/stadium builds it). */
export interface StadiumViewApi {
  /** Everything static, already placed at the StadiumFrame (pitch-local children). */
  readonly root: import('three').Object3D;
  /** Build a slice (call once a frame until true). */
  buildStep(): boolean;
  readonly built: boolean;
  /** Mark out this pitch (lines, goals + nets moved to its goal lines). */
  setPitch(spec: PitchSpec): void;
  /** Crowd colours at each end, ad boards, the big screen's team names. */
  setKits(kits: [TeamKit, TeamKit]): void;
  /** The big screen + scoreboard (call when something changes; it redraws ≤ 2 Hz). */
  board(info: {
    home: string;
    away: string;
    score: [number, number];
    clock: string;
    text?: string;
  }): void;
  /**
   * Crowd mood: 0 calm … 1 goal frenzy; `end` = whose fans are going wild
   * (null = everyone). Cheap: uniforms only.
   */
  crowd(excite: number, end: TeamId | null, dt: number): void;
  /** Net ripple when the ball hits it (pitch-local point, strength 0..1). */
  netHit?(px: number, py: number, pz: number, strength: number): void;
  /** Floodlights + crowd on (a match), or a quiet empty-ish stadium. */
  setLive(on: boolean): void;
  dispose(): void;
}

// ── The view (football/view exports createFootballView) ─────────────────

export type CamMode = 'broadcast' | 'player' | 'high' | 'replay' | 'cinematic';

export interface FootballViewOptions {
  frame: StadiumFrame;
  /** Phones / tablets on `low` (render/deviceTier): fewer crowd, LOD harder. */
  low: boolean;
}

/**
 * The view, owned by FootballMode. Building is sliced: call `buildStep()`
 * once a frame until it returns true (a Noun build is a hitch: one a frame).
 */
export interface FootballViewApi {
  /** The stadium shell (pitch, stands, crowd, lights): can stand without a match. */
  buildStep(): boolean;
  readonly built: boolean;
  /** A new match: kits, pitch markings for its size, footballers (built over frames). */
  setMatch(config: MatchConfig): void;
  /** Footballers still to build for the current match (0 = ready). */
  readonly pending: number;
  /** Draw a sim state (interpolate between `prev` and `next` by `alpha`). */
  draw(prev: SimState, next: SimState, alpha: number, dt: number): void;
  /** Play the events of a step once (sound, crowd, camera shake, replay markers). */
  events(events: FootballEvent[], state: SimState): void;
  /** Camera mode + who it follows (player cam). */
  setCamera(mode: CamMode, focus?: string | null): void;
  /** Drive the camera this frame (into the game camera). */
  camera(cam: import('three').PerspectiveCamera, dt: number, state: SimState): void;
  /** Ring buffer of recent states for goal replays (the view records them in `draw`). */
  replay(seconds: number): boolean;
  readonly replaying: boolean;
  stopReplay(): void;
  /** Crowd + floodlights on while a match is live; quiet otherwise. */
  setLive(on: boolean): void;
  /** Hide the match (players, ball) but keep the stadium. */
  clearMatch(): void;
  /**
   * Which human is on this screen (their footballer gets the tag, the power
   * bar, the radar highlight; the player cam's fallback). Defaults to the
   * config's first human.
   */
  setLocal?(human: string | null): void;
  /** Free everything (geometry, textures, materials, audio). */
  dispose(): void;
}

// ── Network (the world2 room; relayed by packages/nouns-party footballRelay.ts) ──
//
// Host-authoritative like hoops / breaks: the host runs FootballSim, other
// humans send pad inputs (~30 Hz), the host broadcasts quantised snapshots
// (~15 Hz) and clients interpolate. An old worker drops `football:*`, so
// VS CPU still works without a redeploy.

export type FootballMsg =
  /** Host → room, every ~2 s while a lobby is open or a match is live. */
  | {
      type: 'football:lobby';
      gid: string;
      host: string;
      hostName: string;
      size: TeamSize;
      live: boolean;
      score?: [number, number];
      players: { id: string; name: string; team: TeamId }[];
      /** false = closed: forget it. */
      open: boolean;
    }
  /** Player → lobby host: join a team (or `leave: true`). */
  | {
      type: 'football:join';
      gid: string;
      from: string;
      to: string;
      name: string;
      team: TeamId;
      leave?: boolean;
    }
  /** Ask another player to play (invite toast). */
  | {
      type: 'football:challenge';
      gid: string;
      from: string;
      to: string;
      size: TeamSize;
      fromName: string;
      coop?: boolean;
    }
  | { type: 'football:reply'; gid: string; from: string; to: string; accept: boolean }
  /** Host → members: config, start. With `to`: only that member / watcher. */
  | { type: 'football:start'; gid: string; host: string; config: MatchConfig; to?: string }
  /** Human → host, ~30 Hz. */
  | { type: 'football:input'; gid: string; id: string; seq: number; pad: PadInput }
  /**
   * Host → game, ~15 Hz: quantised snapshot (net/codec.ts), `e` = events
   * (net/codec.ts `packEvents`: a sequence number, then the recent events,
   * re-sent for a while so a lost snapshot loses none). `a` = the host's
   * clock (ms) at the snapshot's step.
   */
  | { type: 'football:s'; gid: string; d: string; e?: unknown[]; a?: number }
  /** Spectator → host via relay. */
  | { type: 'football:watch'; gid: string; from: string }
  | { type: 'football:leave'; gid: string; id: string }
  | {
      type: 'football:end';
      gid: string;
      winner: TeamId | null;
      score: [number, number];
      pens?: [number, number];
      reason?: FootballEndReason;
    }
  /** Member → host: clock sync (`c` = the member's clock, ms). */
  | { type: 'football:ping'; gid: string; from: string; c: number }
  /** Host → that member: `c` echoed, `a` = the host's clock (ms). */
  | { type: 'football:pong'; gid: string; to: string; c: number; a: number };

/** Why a match ended (net/sync.ts `ended`). */
export type FootballEndReason = 'final' | 'host_left' | 'left' | 'timeout';

// ── The mode (game.football) ────────────────────────────────────────────

export interface FootballApi {
  /** `/world?play=football`: to the stadium, menu open. */
  arrive(): boolean;
  /** Is a match (or the menu at the stadium) owning the frame? */
  readonly active: boolean;
  leave(): void;
}
