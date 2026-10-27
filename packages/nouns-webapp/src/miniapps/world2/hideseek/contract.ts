// ── Noun Hide & Seek: the shared contract ────────────────────────────────
//
// Hide and seek in the plaza city (an idea from Seth). One or two seekers,
// everyone else hides. The seekers are blindfolded at the start spot while
// the hiders run, climb onto the rooftops or slip into a building; then the
// seekers hunt them down and tag them (get close, press E). A hider who's
// tagged turns seeker too (infection), so the hunt snowballs. Hiders win if
// anyone's still hidden when the clock runs out; seekers win if they find
// everyone. Roles rotate every round.
//
// The parts (house pattern, like breakdance/ and hoops/):
//
//   hideseek/rules.ts      the game itself: phases, timers, roles and their
//                          rotation, tag validation, whistles, pings,
//                          scoring, wins. Pure and deterministic.
//   hideseek/policy.ts     who sees whose name tag (pure).
//   hideseek/nav.ts        the plaza as a height grid + A* (pure); bots.ts
//                          the CPU hiders and seekers on it (pure).
//   hideseek/arena.ts      the arena box, the lobby spot, start ring (pure).
//   hideseek/net/          the lobby, host-authoritative sync over the world
//                          room (`hideseek:*`, relayed by
//                          packages/nouns-party/src/hideseekRelay.ts), the
//                          codec, the Mode class with the Game.ts hook and
//                          the React UI.
//   hideseek/view.ts       three.js: the lobby marker, the glowing arena
//                          wall, CPU avatars, reveal and door beacons, sounds.
//
// Change this file only additively.

export type HsRole = 'hider' | 'seeker';
export type HsPhase = 'hide' | 'seek' | 'reveal' | 'over';

/** Wire codes for a player's standing: hider, seeker, found (a hider tagged: now seeking). */
export type HsStanding = 'h' | 's' | 'f';

export interface HsPlayer {
  /** A connection id for humans, 'cpu:<n>' for CPU players. */
  id: string;
  name: string;
  cpu: boolean;
  /** Noun look (seed key, `a-b-c-d-e`) for CPU avatars and the scoreboard. */
  seed?: string;
}

export type HsArenaId = 'plaza';

export interface HsConfig {
  gid: string;
  /** Everything random in the game (role order, pings, bots) comes from this. */
  seed: number;
  arena: HsArenaId;
  players: HsPlayer[];
  /** Seekers per round (1 or 2; never more than players − 1). */
  seekers: number;
  rounds: number;
  hideS: number;
  seekS: number;
  /**
   * Who seeks first: the play order (round r's seekers are order[r·k … r·k+k−1],
   * wrapping), a shuffle of the player ids unless the menu fixed it.
   */
  order: string[];
  /** CPU skill 0..1 (vision range, reaction, speed). */
  skill: number;
}

export const LIMITS = {
  minPlayers: 2,
  maxPlayers: 12,
  maxRounds: 9,
} as const;

/** Defaults (seconds, metres). */
export const HIDE_S = 45;
export const SEEK_S = 210;
export const REVEAL_S = 10;
/** Tag reach: horizontal distance and height difference. */
export const TAG_R = 2.6;
export const TAG_DY = 2.4;
/** Per-seeker gap between tag attempts the host accepts. */
export const TAG_CD = 0.5;
export const PING_CD = 25;
export const WHISTLE_CD = 10;
export const WHISTLE_MAX = 6;
/** A hider inside a building this long (continuously) lights its door for the seekers. */
export const INSIDE_BEACON_S = 20;

export const POINTS = {
  /** A hider: per 10 s still hidden in the seek phase, and for lasting the round. */
  hiddenPer10s: 1,
  survived: 5,
  whistle: 2,
  /** A seeker: per tag, and every seeker when nobody's left. */
  tag: 5,
  sweep: 5,
} as const;

/** One thing that happened (snapshots carry the ones since the last). */
export type HsEvent =
  | { k: 'phase'; ph: HsPhase; round: number }
  | { k: 'tag'; by: string; id: string; inside?: boolean }
  | { k: 'whistle'; id: string }
  | { k: 'ping'; by: string; id: string }
  | { k: 'beacon'; id: string; door: string }
  | { k: 'reassign'; id: string }
  | { k: 'drop'; id: string }
  | { k: 'win'; side: 'hiders' | 'seekers'; round: number };

/** Where someone was when the seek phase ended (the reveal). */
export interface HsSpot {
  id: string;
  x: number;
  y: number;
  z: number;
  /** Their standing at the end. */
  st: HsStanding;
  /** Inside a building (its door id). */
  door?: string;
}

/** A CPU player's pose on the wire: [id, x, y, z, yaw, anim code]. */
export type HsBotPose = [string, number, number, number, number, number];

/** Animation codes for CPU poses (index into this). */
export const BOT_ANIMS = [
  'idle',
  'walk',
  'run',
  'sprint',
  'fall',
  'climb',
  'crouch',
  'wave',
] as const;
export type BotAnim = (typeof BOT_ANIMS)[number];

/** `hideseek:s` body: the host's view of the game. */
export interface HsSnap {
  ph: HsPhase;
  /** Round (0-based) and seconds left in the phase. */
  r: number;
  t: number;
  /** [id, standing] for everyone still in. */
  st: [string, HsStanding][];
  /** Scores, [id, points]. */
  sc: [string, number][];
  /** Lit doors (a hider inside too long): [door id, x, z]. */
  bc: [string, number, number][];
  /** CPU poses. */
  bots: HsBotPose[];
  ev: HsEvent[];
  /** Reveal: where everyone was (reveal and over phases only). */
  rv?: HsSpot[];
  win?: 'hiders' | 'seekers';
  /** Ping cooldowns of seekers, seconds left: [id, s]. */
  cd?: [string, number][];
}

/** What a player asks the host for. */
export type HsAct = 'tag' | 'whistle' | 'ping';

export interface HsOpenGame {
  gid: string;
  host: string;
  hostName: string;
  /** Players so far (humans + CPU fill the host plans), the max. */
  n: number;
  max: number;
  state: 'lobby' | 'live';
  names: string[];
}

export type HsMsg =
  /** Everyone: open / live games, and which ids are hiding right now (labels). */
  | {
      type: 'hideseek:lobby';
      from?: string;
      open?: HsOpenGame | null;
      /** Unfound hiders in this host's live game. */
      hide?: string[];
    }
  /** Joiner → host. */
  | { type: 'hideseek:join'; gid: string; from?: string }
  /** Host → joined: the roster so far (a joiner left out of it was turned away). */
  | { type: 'hideseek:roster'; gid: string; host?: string; players: HsPlayer[]; cpu: number }
  | { type: 'hideseek:start'; gid: string; host?: string; config: HsConfig }
  | { type: 'hideseek:s'; gid: string; s: HsSnap }
  | { type: 'hideseek:act'; gid: string; a: HsAct; target?: string; from?: string }
  | { type: 'hideseek:leave'; gid: string; id?: string }
  | { type: 'hideseek:end'; gid: string };
