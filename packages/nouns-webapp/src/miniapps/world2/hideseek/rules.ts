// ── Hide & Seek rules: phases, roles, tags, scores (pure) ────────────────
//
// The host runs one of these; nothing here knows about three.js, the DOM or
// the clock (the host steps it with its frame time). Everything random comes
// from the config's seed, so a game replays exactly.
//
//   Rounds      hide (HIDE_S): seekers blindfolded at the start spot (the
//               client freezes them), hiders run. seek (SEEK_S): seekers
//               tag hiders. reveal (REVEAL_S): where everyone hid, the
//               scores. After the last round: over.
//   Roles       round r's seekers are the next k players in the play order
//               (k = config.seekers), so the seeker's job rotates; everyone
//               else hides.
//   Tags        a seeker within TAG_R (and TAG_DY up or down) of a hider,
//               with a clear line between them, at most one try per TAG_CD.
//               The host checks it against its own view of where both are,
//               so a client can't tag from across the map. Infection: the
//               tagged hider seeks with the others for the rest of the
//               round (found, 'f').
//   Buildings   hiders may go inside. A seeker who walks into the same
//               building finds everyone hiding in there; a CPU seeker
//               finds them by checking the door. A hider inside for
//               INSIDE_BEACON_S straight lights its door for the seekers.
//   Abilities   hiders WHISTLE (a sound from where they are, +2 points,
//               WHISTLE_CD apart, WHISTLE_MAX a round); seekers PING (a
//               chime from a random hider, PING_CD apart).
//   Wins        seekers win the round when nobody's left hiding; hiders
//               win if anyone is when the seek clock runs out.
//   Scores      hiders: 1 per 10 s hidden in the seek phase, +5 for lasting
//               the round, +2 a whistle. Seekers: +5 a tag, +5 each for a
//               clean sweep (the round's starting seekers).
//   Drops       a player leaving is out. No seekers left: the host makes a
//               random hider the seeker. Under two players: game over.

import {
  INSIDE_BEACON_S,
  LIMITS,
  PING_CD,
  POINTS,
  REVEAL_S,
  TAG_CD,
  TAG_DY,
  TAG_R,
  WHISTLE_CD,
  WHISTLE_MAX,
  type HsConfig,
  type HsEvent,
  type HsPhase,
  type HsPlayer,
  type HsSnap,
  type HsSpot,
  type HsStanding,
} from './contract';

export interface Vec {
  x: number;
  y: number;
  z: number;
}

export interface Door {
  id: string;
  x: number;
  z: number;
}

/** What the rules need to know about the world (the host fills it in). */
export interface HsWorld {
  /** Where a player is now (null: unknown, e.g. not seen lately). */
  pos(id: string): Vec | null;
  /** A clear line between two players (eye to body). */
  los(a: Vec, b: Vec): boolean;
  /** The building a position is inside (its door), else null. */
  door(p: Vec): Door | null;
}

export interface PState {
  id: string;
  name: string;
  cpu: boolean;
  st: HsStanding;
  score: number;
  /** This round: seconds hidden in the seek phase, whistles, tags made. */
  hiddenS: number;
  whistles: number;
  tags: number;
  whistleCd: number;
  pingCd: number;
  tagCd: number;
  /** Continuous seconds inside a building (hiders), and which. */
  insideS: number;
  door: string | null;
  foundBy?: string;
}

export interface HsState {
  cfg: HsConfig;
  phase: HsPhase;
  round: number;
  /** Seconds left in the phase. */
  t: number;
  players: Map<string, PState>;
  /** Lit doors: id → where. */
  lit: Map<string, Door>;
  rng: number;
  events: HsEvent[];
  reveal: HsSpot[] | null;
  win: 'hiders' | 'seekers' | null;
}

export type TagResult =
  | 'ok'
  | 'phase'
  | 'not-seeker'
  | 'not-hider'
  | 'cooldown'
  | 'far'
  | 'wall'
  | 'unknown';

// ── Random (mulberry32: one number of state) ────────────────────────────

export function nextRand(s: { rng: number }): number {
  let t = (s.rng = (s.rng + 0x6d2b79f5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** A seeded shuffle (the default play order). */
export function shuffled<T>(xs: readonly T[], seed: number): T[] {
  const s = { rng: seed | 0 };
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(nextRand(s) * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** How many seekers a game of `n` gets (asked for `want`): 1..2, always someone left to hide. */
export function seekerCount(n: number, want: number): number {
  return Math.max(1, Math.min(2, Math.round(want), n - 1));
}

/**
 * Round `round`'s seekers: the next k present players in the play order,
 * starting at round·k (wrapping), so everyone takes a turn.
 */
export function seekersFor(
  order: readonly string[],
  round: number,
  k: number,
  present: ReadonlySet<string>,
): string[] {
  const live = order.filter(id => present.has(id));
  if (live.length === 0) return [];
  const n = Math.min(k, Math.max(1, live.length - 1));
  const out: string[] = [];
  const start = (round * k) % live.length;
  for (let i = 0; out.length < n && i < live.length; i++)
    out.push(live[(start + i) % live.length]!);
  return out;
}

// ── Making a game ───────────────────────────────────────────────────────

export function makeConfig(o: {
  gid: string;
  seed: number;
  players: HsPlayer[];
  seekers?: number;
  rounds?: number;
  hideS?: number;
  seekS?: number;
  skill?: number;
  /** Put these ids first in the play order (e.g. "I seek first"). */
  first?: string[];
  /** Put these ids last (e.g. "I hide first"). */
  last?: string[];
}): HsConfig {
  const players = o.players.slice(0, LIMITS.maxPlayers);
  const ids = players.map(p => p.id);
  let order = shuffled(ids, o.seed ^ 0x5eed);
  const first = (o.first ?? []).filter(id => ids.includes(id));
  const last = (o.last ?? []).filter(id => ids.includes(id) && !first.includes(id));
  order = [...first, ...order.filter(id => !first.includes(id) && !last.includes(id)), ...last];
  return {
    gid: o.gid,
    seed: o.seed,
    arena: 'plaza',
    players,
    seekers: seekerCount(players.length, o.seekers ?? 1),
    rounds: Math.max(1, Math.min(LIMITS.maxRounds, Math.round(o.rounds ?? 3))),
    hideS: o.hideS ?? 45,
    seekS: o.seekS ?? 210,
    order,
    skill: Math.max(0, Math.min(1, o.skill ?? 0.55)),
  };
}

export function newGame(cfg: HsConfig): HsState {
  const players = new Map<string, PState>();
  for (const p of cfg.players)
    players.set(p.id, {
      id: p.id,
      name: p.name,
      cpu: p.cpu,
      st: 'h',
      score: 0,
      hiddenS: 0,
      whistles: 0,
      tags: 0,
      whistleCd: 0,
      pingCd: 0,
      tagCd: 0,
      insideS: 0,
      door: null,
    });
  const s: HsState = {
    cfg,
    phase: 'hide',
    round: 0,
    t: cfg.hideS,
    players,
    lit: new Map(),
    rng: (cfg.seed ^ 0x9e3779b9) | 0,
    events: [],
    reveal: null,
    win: null,
  };
  startRound(s, 0);
  return s;
}

function startRound(s: HsState, round: number) {
  s.round = round;
  s.phase = 'hide';
  s.t = s.cfg.hideS;
  s.win = null;
  s.reveal = null;
  s.lit.clear();
  const seekers = new Set(seekersFor(s.cfg.order, round, s.cfg.seekers, new Set(s.players.keys())));
  for (const p of s.players.values()) {
    p.st = seekers.has(p.id) ? 's' : 'h';
    p.hiddenS = 0;
    p.whistles = 0;
    p.tags = 0;
    p.whistleCd = 0;
    // A short wait before the first ping
    p.pingCd = 8;
    p.tagCd = 0;
    p.insideS = 0;
    p.door = null;
    p.foundBy = undefined;
  }
  s.events.push({ k: 'phase', ph: 'hide', round });
}

// ── Who's who ───────────────────────────────────────────────────────────

export const isSeeker = (p: PState | undefined) =>
  p !== undefined && (p.st === 's' || p.st === 'f');
export const isHiding = (p: PState | undefined) => p !== undefined && p.st === 'h';

export function hiders(s: HsState): PState[] {
  return [...s.players.values()].filter(isHiding);
}

export function seekers(s: HsState): PState[] {
  return [...s.players.values()].filter(isSeeker);
}

/** Blindfolded right now: the round's starting seekers in the hide phase. */
export function blindfolded(s: HsState, id: string): boolean {
  return s.phase === 'hide' && s.players.get(id)?.st === 's';
}

// ── Tags ────────────────────────────────────────────────────────────────

/** Close enough to tag (positions only). */
export function inReach(a: Vec, b: Vec): boolean {
  return Math.hypot(a.x - b.x, a.z - b.z) <= TAG_R && Math.abs(a.y - b.y) <= TAG_DY;
}

/** The host's check of a tag, by what it can see. */
export function checkTag(s: HsState, by: string, id: string, w: HsWorld): TagResult {
  if (s.phase !== 'seek') return 'phase';
  const a = s.players.get(by);
  const b = s.players.get(id);
  if (!isSeeker(a)) return 'not-seeker';
  if (!isHiding(b)) return 'not-hider';
  if (a!.tagCd > 0) return 'cooldown';
  const pa = w.pos(by);
  const pb = w.pos(id);
  if (pa === null || pb === null) return 'unknown';
  if (!inReach(pa, pb)) return 'far';
  // Both in the same building: no line needed (the pocket's walls aren't
  // in the host's world)
  const da = w.door(pa);
  const db = w.door(pb);
  if (da !== null || db !== null)
    return da !== null && db !== null && da.id === db.id ? 'ok' : 'far';
  return w.los(pa, pb) ? 'ok' : 'wall';
}

/** A seeker's tag: checked, and applied when it holds. */
export function tag(s: HsState, by: string, id: string, w: HsWorld): TagResult {
  const r = checkTag(s, by, id, w);
  const a = s.players.get(by);
  if (a !== undefined && r !== 'phase' && r !== 'not-seeker' && r !== 'cooldown') a.tagCd = TAG_CD;
  if (r === 'ok') found(s, by, id, false, w);
  return r;
}

function found(s: HsState, by: string, id: string, inside: boolean, w: HsWorld | null) {
  const a = s.players.get(by)!;
  const b = s.players.get(id)!;
  b.st = 'f';
  b.foundBy = by;
  b.insideS = 0;
  a.tags++;
  a.score += POINTS.tag;
  s.events.push(inside ? { k: 'tag', by, id, inside: true } : { k: 'tag', by, id });
  checkSweep(s, w);
}

/** A CPU seeker checking a door: finds everyone hiding inside that building. */
export function checkDoor(s: HsState, by: string, doorId: string, w: HsWorld): string[] {
  if (s.phase !== 'seek' || !isSeeker(s.players.get(by))) return [];
  const out: string[] = [];
  for (const p of hiders(s)) {
    const pos = w.pos(p.id);
    if (pos === null) continue;
    if (w.door(pos)?.id === doorId) out.push(p.id);
  }
  for (const id of out) if (s.phase === 'seek') found(s, by, id, true, w);
  return out;
}

// ── Abilities ───────────────────────────────────────────────────────────

export function whistle(s: HsState, id: string): boolean {
  const p = s.players.get(id);
  if (s.phase !== 'seek' || !isHiding(p) || p!.whistleCd > 0 || p!.whistles >= WHISTLE_MAX)
    return false;
  p!.whistleCd = WHISTLE_CD;
  p!.whistles++;
  p!.score += POINTS.whistle;
  s.events.push({ k: 'whistle', id });
  return true;
}

/** A seeker's ping: a chime from a random hider (their id), or null. */
export function ping(s: HsState, by: string): string | null {
  const p = s.players.get(by);
  if (s.phase !== 'seek' || !isSeeker(p) || p!.pingCd > 0) return null;
  const hs = hiders(s);
  if (hs.length === 0) return null;
  const h = hs[Math.floor(nextRand(s) * hs.length)]!;
  p!.pingCd = PING_CD;
  s.events.push({ k: 'ping', by, id: h.id });
  return h.id;
}

// ── The clock ───────────────────────────────────────────────────────────

export function step(s: HsState, dt: number, w: HsWorld) {
  if (s.phase === 'over' || dt <= 0) return;
  for (const p of s.players.values()) {
    p.whistleCd = Math.max(0, p.whistleCd - dt);
    p.tagCd = Math.max(0, p.tagCd - dt);
    if (s.phase === 'seek') p.pingCd = Math.max(0, p.pingCd - dt);
  }
  if (s.phase === 'hide' || s.phase === 'seek') buildings(s, dt, w);
  if (s.phase === 'seek') for (const p of hiders(s)) p.hiddenS += dt;
  s.t -= dt;
  if (s.t > 0) return;
  if (s.phase === 'hide') {
    s.phase = 'seek';
    s.t = s.cfg.seekS;
    s.events.push({ k: 'phase', ph: 'seek', round: s.round });
  } else if (s.phase === 'seek') endRound(s, hiders(s).length > 0 ? 'hiders' : 'seekers', w);
  else if (s.phase === 'reveal') {
    if (s.round + 1 < s.cfg.rounds && s.players.size >= LIMITS.minPlayers)
      startRound(s, s.round + 1);
    else {
      s.phase = 'over';
      s.t = 0;
      s.events.push({ k: 'phase', ph: 'over', round: s.round });
    }
  }
}

/** Inside buildings: lit doors, and seekers walking in on hiders. */
function buildings(s: HsState, dt: number, w: HsWorld) {
  const at = new Map<string, Door>();
  for (const p of s.players.values()) {
    const pos = w.pos(p.id);
    const d = pos === null ? null : w.door(pos);
    p.door = d?.id ?? null;
    if (d !== null) at.set(d.id, d);
    if (isHiding(p)) p.insideS = d !== null ? p.insideS + dt : 0;
  }
  // A seeker in the same building finds everyone in there
  if (s.phase === 'seek')
    for (const a of seekers(s)) {
      if (a.door === null) continue;
      for (const b of hiders(s))
        if (b.door === a.door && s.phase === 'seek') found(s, a.id, b.id, true, w);
    }
  // Doors lit by a hider inside too long (until they leave or are found)
  const lit = new Map<string, Door>();
  for (const p of hiders(s))
    if (p.door !== null && p.insideS >= INSIDE_BEACON_S) {
      lit.set(p.door, at.get(p.door)!);
      if (!s.lit.has(p.door)) s.events.push({ k: 'beacon', id: p.id, door: p.door });
    }
  s.lit = lit;
}

function checkSweep(s: HsState, w: HsWorld | null) {
  if (s.phase === 'seek' && hiders(s).length === 0) endRound(s, 'seekers', w);
}

function endRound(s: HsState, side: 'hiders' | 'seekers', w: HsWorld | null) {
  for (const p of s.players.values()) {
    if (p.st === 'h' || p.st === 'f') p.score += Math.floor(p.hiddenS / 10) * POINTS.hiddenPer10s;
    if (p.st === 'h') p.score += POINTS.survived;
    if (side === 'seekers' && p.st === 's') p.score += POINTS.sweep;
  }
  s.win = side;
  s.reveal = [...s.players.values()].map(p => {
    const pos = w?.pos(p.id) ?? null;
    const spot: HsSpot = { id: p.id, x: pos?.x ?? 0, y: pos?.y ?? 0, z: pos?.z ?? 0, st: p.st };
    if (p.door !== null) spot.door = p.door;
    return spot;
  });
  s.lit.clear();
  s.phase = 'reveal';
  s.t = REVEAL_S;
  s.events.push({ k: 'win', side, round: s.round });
  s.events.push({ k: 'phase', ph: 'reveal', round: s.round });
}

// ── People leaving ──────────────────────────────────────────────────────

export function drop(s: HsState, id: string, w: HsWorld | null = null) {
  const p = s.players.get(id);
  if (p === undefined) return;
  s.players.delete(id);
  s.events.push({ k: 'drop', id });
  if (s.phase === 'over') return;
  if (s.players.size < LIMITS.minPlayers) {
    s.phase = 'over';
    s.t = 0;
    s.events.push({ k: 'phase', ph: 'over', round: s.round });
    return;
  }
  if (s.phase === 'reveal') return;
  if (seekers(s).length === 0) {
    // Nobody seeking: a random hider takes over (blindfolded, if it's still the hide phase)
    const hs = hiders(s);
    const n = hs[Math.floor(nextRand(s) * hs.length)]!;
    n.st = 's';
    s.events.push({ k: 'reassign', id: n.id });
  }
  checkSweep(s, w);
}

// ── On the wire ─────────────────────────────────────────────────────────

/** The snapshot body (the host adds the CPU poses), taking the events since the last. */
export function snapshot(s: HsState): Omit<HsSnap, 'bots'> {
  const ev = s.events;
  s.events = [];
  const snap: Omit<HsSnap, 'bots'> = {
    ph: s.phase,
    r: s.round,
    t: Math.max(0, Math.round(s.t * 10) / 10),
    st: [...s.players.values()].map(p => [p.id, p.st]),
    sc: [...s.players.values()].map(p => [p.id, p.score]),
    bc: [...s.lit.values()].map(d => [d.id, Math.round(d.x * 10) / 10, Math.round(d.z * 10) / 10]),
    ev,
    cd: seekers(s).map(p => [p.id, Math.ceil(p.pingCd)]),
  };
  if (s.reveal !== null && (s.phase === 'reveal' || s.phase === 'over')) snap.rv = s.reveal;
  if (s.win !== null) snap.win = s.win;
  return snap;
}
