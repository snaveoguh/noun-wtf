// ── Noun Golf: the shared contract ───────────────────────────────────────
//
// NOUN LINKS, a full-size 19-hole course on the mountain (the −X/+Z quadrant,
// ~3 km out, between the GO DOWN and DOWNHILL lines), with golf buggies.
// Same layout as pool/ and hoops/:
//
//   golf/course/  where it is and what it is: the site frame, the 19 holes
//                 (tees, fairways, greens, bunkers, water, trees, paths,
//                 clubhouse, range), the analytic surface (height + lie) the
//                 terrain, the sim and the view all read. Pure, no three.js.
//   golf/sim/     ball flight (launch, spin, drag, Magnus lift, wind), bounce
//                 and roll per lie, putting on sloped greens, clubs, the
//                 swing (power + accuracy), stroke-play rules, the CPU.
//                 Pure TypeScript (no three.js, no DOM, no clock), seeded,
//                 deterministic for the same inputs on the same machine.
//   golf/view/    the course meshes (fairway / green / tee / bunker
//                 overlays, water, trees, flags, paths, clubhouse, range),
//                 the ball, trails, cameras, aim line, sound.
//   golf/net/     GolfMode (the Game hook, `game.golf`), the HUD (menu,
//                 swing meter, scorecard), lockstep shots over the world
//                 room (`golf:*`, relayed by packages/nouns-party).
//
// Change this file only additively (new optional fields, new union members).
//
// Coordinates: world metres, three.js convention (y up). Yaw / heading:
// atan2(dx, dz) (0 = +Z, π/2 = +X), the same as Player / cars.

export interface V2 {
  x: number;
  z: number;
}

export interface V3 {
  x: number;
  y: number;
  z: number;
}

// ── The ground ──────────────────────────────────────────────────────────

/**
 * What the ball is lying on. `deep` = the long grass past the first cut
 * (between holes, under the trees); `ob` = outside the course boundary
 * (white stakes), `water` = in a hazard (red / yellow stakes).
 */
export type Lie =
  | 'tee'
  | 'fairway'
  | 'fringe'
  | 'green'
  | 'rough'
  | 'deep'
  | 'sand'
  | 'path'
  | 'water'
  | 'ob';

/** A closed shape on the ground. Blobs wobble: r(θ) = r·(1 + Σ k[i]·cos/sin). */
export type Shape =
  | {
      kind: 'blob';
      x: number;
      z: number;
      /** Mean radius (m) and stretch along the local x (rot) axis. */
      r: number;
      sx: number;
      rot: number;
      /** Wobble: [a2, b2, a3, b3] (cos 2θ, sin 2θ, cos 3θ, sin 3θ), |Σ| ≲ 0.25. */
      k: [number, number, number, number];
    }
  | {
      kind: 'rect';
      x: number;
      z: number;
      /** Half sizes along the local x (across) and z (along yaw). */
      hw: number;
      hl: number;
      yaw: number;
      /** Corner radius (m). */
      round: number;
    };

/** A fairway: a ribbon along a polyline, half width per point. */
export interface Ribbon {
  pts: V2[];
  half: number[];
}

export interface Bunker {
  shape: Shape;
  /** Floor depth under the surroundings (m). */
  depth: number;
}

export interface Pond {
  shapes: Shape[];
  /** Water surface height (m, world). */
  level: number;
}

export interface Tree {
  x: number;
  z: number;
  /** Trunk radius, canopy radius, canopy bottom and top (m above ground). */
  trunk: number;
  r: number;
  h0: number;
  h1: number;
  /** 0 pine, 1 broadleaf, 2 palm-ish (view only). */
  kind: 0 | 1 | 2;
  /** Ground height at the trunk. */
  y: number;
}

export interface Hole {
  /** 1..19. */
  n: number;
  par: 3 | 4 | 5;
  /** A name for the HUD ("THE NOGGLE", "ISLAND"...). */
  name: string;
  /** Stroke index (1 = hardest), for the CPU's caution. */
  hcp: number;
  /** Tee box: centre on the ground, the way it faces, size. */
  tee: Shape & { kind: 'rect' };
  /** Where the ball is teed (on the tee, centre, ground height). */
  teeSpot: V3;
  /** Centre line from tee to green (for the HUD map, the CPU and the corridor). */
  line: V2[];
  /** Length along the line (m). */
  length: number;
  fairway: Ribbon | null;
  /** The green (a union of shapes) and its pin. */
  green: Shape[];
  pin: V3;
  /** Raised or sunk, and tilted: the green's plane is y = y0 + gx·(x−cx) + gz·(z−cz) + contour. */
  greenPlane: { cx: number; cz: number; y0: number; gx: number; gz: number };
  bunkers: Bunker[];
  water: Pond[];
  /** First-cut rough: this far outside the fairway / the line (m). */
  roughHalf: number;
}

export interface Building {
  id: 'clubhouse' | 'proshop' | 'bar19' | 'rangehut' | 'starter' | 'barn';
  x: number;
  z: number;
  yaw: number;
  /** Footprint half sizes, height (m); y = the pad level. */
  hw: number;
  hl: number;
  h: number;
  y: number;
  label: string;
}

/** Where a buggy waits (parked, doors none). */
export interface BuggySpot {
  x: number;
  y: number;
  z: number;
  yaw: number;
}

export interface Range {
  /** Hitting bays along a line, facing `yaw`. */
  tee: Shape & { kind: 'rect' };
  bays: V3[];
  yaw: number;
  /** Target greens (distance markers) down the range. */
  targets: { x: number; z: number; y: number; r: number; dist: number }[];
  /** Ground the range covers (for the view's mown stripes). */
  area: Shape & { kind: 'rect' };
}

export interface CourseLayout {
  id: 'noun-links';
  name: string;
  holes: Hole[];
  par: number;
  buildings: Building[];
  /** A flat pad under the clubhouse buildings + the buggy park. */
  pads: { shape: Shape; y: number }[];
  /** The putting green by the clubhouse. */
  puttingGreen: Shape;
  range: Range;
  buggies: BuggySpot[];
  /** Cart paths (2.6 m concrete ribbons). */
  paths: Ribbon[];
  trees: Tree[];
  /** Spawn: by the 1st tee, facing down it. */
  spawn: { x: number; y: number; z: number; yaw: number };
  /** The course boundary (OB) as a world AABB of the core, and the whole terraced area. */
  core: { x0: number; z0: number; x1: number; z1: number };
  bounds: { x0: number; z0: number; x1: number; z1: number };
}

/** What sim/ needs from the ground (course/surface.ts implements it, pure). */
export interface CourseSurface {
  height(x: number, z: number): number;
  /** Upward unit normal. */
  normal(x: number, z: number, out: V3): V3;
  lie(x: number, z: number): Lie;
  /** Water surface height if (x, z) is in a hazard, else null. */
  waterLevel(x: number, z: number): number | null;
  /**
   * Trees whose trunk or canopy a segment from a to b could touch (cheap
   * broad phase; the sim does the exact test).
   */
  treesNear(x: number, z: number, r: number, out: Tree[]): Tree[];
}

// ── Clubs and the swing ─────────────────────────────────────────────────

export type ClubId =
  | 'D'
  | '3W'
  | '5W'
  | '4H'
  | '5i'
  | '6i'
  | '7i'
  | '8i'
  | '9i'
  | 'PW'
  | 'GW'
  | 'SW'
  | 'LW'
  | 'P';

export interface ClubSpec {
  id: ClubId;
  name: string;
  /** Loft (deg). */
  loft: number;
  /** Ball speed at a full, pure strike (m/s). */
  speed: number;
  /** Backspin at a full strike (rpm). */
  spin: number;
  /** Rough carry on a still day (m), for the HUD and the CPU's first guess. */
  carry: number;
}

/**
 * One swing, as the player made it. The sim turns it into a launch
 * (sim/swing.ts launchOf) and flies it (sim/physics.ts).
 */
export interface SwingInput {
  club: ClubId;
  /** Heading the player aimed (rad, world yaw). */
  aim: number;
  /** 0..1 of a full swing (up to 1.1 overswing: more speed, less control). */
  power: number;
  /** Strike accuracy: 0 pure, −1..1 off (+ = pushed / sliced right). */
  accuracy: number;
  /** Optional shaping: −1 draw … +1 fade; spin: −1 less … +1 more backspin. */
  shape?: number;
  spin?: number;
}

export interface Launch {
  /** Initial velocity (m/s, world). */
  vel: V3;
  /** Spin (rad/s) about a world axis (backspin is about the side axis). */
  spin: V3;
}

// ── A shot's result ─────────────────────────────────────────────────────

export type ShotEventKind =
  | 'land'
  | 'bounce'
  | 'tree'
  | 'pin'
  | 'lip'
  | 'holed'
  | 'water'
  | 'ob'
  | 'rest'
  | 'sand';

export interface ShotEvent {
  /** Seconds since the strike. */
  t: number;
  kind: ShotEventKind;
  at: V3;
  /** Impact speed (m/s) for sounds. */
  speed?: number;
}

export interface ShotResult {
  /** Ball positions at 30 Hz from the strike to rest (the view replays it). */
  path: V3[];
  events: ShotEvent[];
  /** Where it ended (on the ground; for water / OB, where it went in / out). */
  rest: V3;
  lie: Lie;
  holed: boolean;
  /** Carry (to first landing) and total (along the ground) distances (m). */
  carry: number;
  total: number;
  /** Highest point above the launch (m). */
  apex: number;
}

export interface Wind {
  /** m/s, world (x, z). */
  x: number;
  z: number;
}

// ── The round ───────────────────────────────────────────────────────────

export interface GolfPlayer {
  /** Connection id for humans, 'cpu:<n>' for CPUs. */
  id: string;
  name: string;
  human: boolean;
  /** CPU skill 0..1. */
  skill?: number;
  /** NounSeed key for the view. */
  seedKey?: string;
}

export interface GolfConfig {
  /** Round id: random per round. */
  gid: string;
  seed: number;
  players: GolfPlayer[];
  /** Holes to play, in order (1-based numbers; default all 19). */
  holes: number[];
  /** Wind strength 0..1 (0 = calm). */
  wind: number;
  /** Mulligans / gimmes off in a match. */
  gimme?: number;
}

export type RoundPhase = 'tee' | 'play' | 'holed' | 'over';

export interface PlayerHole {
  /** Strokes on this hole so far (penalties included). */
  strokes: number;
  /** Where the ball is (null before the tee shot). */
  ball: V3 | null;
  lie: Lie;
  holed: boolean;
  /** Picked up (max strokes, or conceded). */
  picked?: boolean;
}

export interface RoundState {
  config: GolfConfig;
  /** Index into config.holes. */
  hole: number;
  phase: RoundPhase;
  /** Per player, this hole. */
  cur: PlayerHole[];
  /** Per player, per played hole: strokes (null = not played yet). */
  card: (number | null)[][];
  /** Whose shot (index into config.players). */
  turn: number;
  /** This hole's wind (from the seed). */
  wind: Wind;
  /** Shots taken in the round (all players): the lockstep counter. */
  n: number;
  /** What the last shot did (for the HUD). */
  last: LastShot | null;
}

export interface LastShot {
  by: number;
  result: ShotResult;
  /** Penalty strokes added (water 1, OB 1 + replay). */
  penalty: number;
  /** "BIRDIE", "IN THE WATER", "HOLE IN ONE"... */
  call?: string;
  /** Where the next shot is played from (after a drop / a replay). */
  next: V3;
  nextLie: Lie;
}

// ── The Game hook ───────────────────────────────────────────────────────

/** `game.golf` (golf/net/GolfMode.ts). */
export interface GolfApi {
  /** True while a shot is being addressed / flown (owns the frame). */
  readonly active: boolean;
  /** The round in progress (also while walking / driving between shots). */
  readonly round: RoundState | null;
  /** Teleport to the 1st tee (`?play=golf`, the map); opens the menu. */
  arrive(): boolean;
  /** Leave the round (the card is kept as a local best only if complete). */
  leave(): void;
}

/**
 * Buggies (cars/, CarId 'buggy'): the course asks the car system to park
 * buggies at spots and to take them away again when you're far.
 *
 *   game.cars.parkBuggies('golf', spots)    idempotent per group
 *   game.cars.clearBuggies('golf')
 *
 * A buggy you drive off and leave is an ordinary left car (the `lc` pose
 * blob), so other players see it parked where you left it.
 */
export interface BuggyApi {
  parkBuggies(group: string, spots: BuggySpot[]): void;
  clearBuggies(group: string): void;
}

// ── Net messages (relayed by packages/nouns-party, `golf:` prefix) ──────

export interface LiveRound {
  gid: string;
  host: string;
  names: string[];
  hole: number;
}

export type GolfMsg =
  /** Presence at the course; a host advertises its live round. */
  | { type: 'golf:lobby'; from?: string; name?: string; seedKey?: string; live?: LiveRound }
  | { type: 'golf:invite'; to: string; from?: string; gid: string; name?: string }
  | { type: 'golf:reply'; to: string; from?: string; gid: string; ok: boolean }
  /** The host starts the round (to everyone in it; `to` + state: a late joiner / watcher). */
  | {
      type: 'golf:start';
      host?: string;
      config: GolfConfig;
      to?: string;
      state?: RoundState;
    }
  /** A player's swing (to the host; from the host, the accepted swing for shot n). */
  | { type: 'golf:shot'; gid: string; n: number; swing: SwingInput; from?: string }
  /** The shooter's live aim (throttled). */
  | { type: 'golf:aim'; gid: string; aim: number; club: ClubId; from?: string }
  /** The host: shot n came to rest; the round is now `state`. */
  | { type: 'golf:result'; gid: string; n: number; swing: SwingInput; state: RoundState }
  | { type: 'golf:end'; gid: string; reason?: string }
  | { type: 'golf:leave'; gid: string; id?: string };
