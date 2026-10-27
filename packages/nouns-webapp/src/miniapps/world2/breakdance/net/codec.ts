// ── Noun Breaks wire format: validate everything that comes off the socket ─
//
// Messages travel as JSON (the contract's BreakMsg shapes). Snapshots are the
// SimState itself with every float rounded to 3 dp (a millisecond on the
// battle clock), so a 3v3 state is ~1.5 KB at 10 Hz. Unknown extra fields
// the sim may add later pass through (rounded); the known ones are checked
// and clamped, so a bad peer can't crash the view or the sim.

import type {
  BattleConfig,
  BattlePhase,
  BreakInput,
  BreakKey,
  BreakMsg,
  CrewId,
  CrewSize,
  Dancer,
  DancerPose,
  HitGrade,
  JudgeCard,
  LaneNote,
  MoveId,
  SimEvent,
  SimState,
} from '../contract';

export const KEYS: readonly BreakKey[] = ['up', 'down', 'left', 'right', 'a', 'b'];
const PHASES: readonly BattlePhase[] = ['intro', 'turn', 'judging', 'between', 'final', 'done'];
const GRADES: readonly HitGrade[] = ['perfect', 'great', 'ok', 'miss'];
const EVENTS = ['beat', 'turn', 'hit', 'move', 'crash', 'freeze', 'combo', 'card', 'end'];

export const MAX_DANCERS = 6;
const MAX_POSES = 8;
const MAX_PROMPTS = 64;
const MAX_LANE = 48;
const MAX_CARDS = 32;
const MAX_EVENTS = 64;

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export const okId = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= 64;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const crewOf = (v: unknown): CrewId | null => (v === 0 || v === 1 ? v : null);
const sizeOf = (v: unknown): CrewSize | null => (v === 1 || v === 2 || v === 3 ? v : null);
const winnerOf = (v: unknown): CrewId | 'tie' | null => (v === 'tie' ? 'tie' : crewOf(v));
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');

/** Deep copy with floats rounded to 3 dp; undefined and non-JSON values dropped. */
export function compact<T>(v: T, depth = 0): T {
  if (typeof v === 'number') return (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : 0) as T;
  if (v === null || typeof v !== 'object' || depth > 8) return v;
  if (Array.isArray(v)) return v.map(x => compact(x, depth + 1)) as T;
  const o: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
    if (x === undefined || typeof x === 'function') continue;
    o[k] = compact(x, depth + 1);
  }
  return o as T;
}

// ── Pieces ──

export function readInput(v: unknown): BreakInput | null {
  if (!isObj(v) || !okId(v.id) || !num(v.t)) return null;
  const key = KEYS.find(k => k === v.key);
  if (key === undefined) return null;
  return { id: v.id, key, t: v.t };
}

export function readConfig(v: unknown): BattleConfig | null {
  if (!isObj(v) || !okId(v.gid) || !num(v.seed)) return null;
  const crewSize = sizeOf(v.crewSize);
  if (crewSize === null || !Array.isArray(v.dancers)) return null;
  const dancers: Dancer[] = [];
  const seen = new Set<string>();
  for (const d of v.dancers.slice(0, MAX_DANCERS)) {
    if (!isObj(d) || !okId(d.id) || seen.has(d.id)) return null;
    const crew = crewOf(d.crew);
    if (crew === null) return null;
    seen.add(d.id);
    dancers.push({
      id: d.id,
      name: str(d.name, 24) || 'noun',
      crew,
      human: d.human === true,
      ...(num(d.skill) ? { skill: clamp(d.skill, 0, 1) } : {}),
      ...(d.seed !== undefined && JSON.stringify(d.seed).length < 400 ? { seed: d.seed } : {}),
    });
  }
  if (dancers.length < 2) return null;
  const cfg: BattleConfig = {
    gid: v.gid,
    seed: Math.floor(v.seed),
    crewSize,
    dancers,
    rounds: num(v.rounds) ? clamp(Math.round(v.rounds), 1, 10) : 2,
    turnBars: num(v.turnBars) ? clamp(Math.round(v.turnBars), 1, 16) : 4,
    bpm: num(v.bpm) ? clamp(v.bpm, 60, 200) : 100,
  };
  if (v.chart === 'strict') cfg.chart = 'strict';
  if (typeof v.track === 'string' && /^[\da-z][\d_a-z-]{0,39}$/.test(v.track)) cfg.track = v.track;
  const w = v.windows;
  if (isObj(w) && num(w.perfect) && num(w.great) && num(w.ok))
    cfg.windows = {
      perfect: clamp(w.perfect, 0.005, 0.5),
      great: clamp(w.great, 0.005, 0.5),
      ok: clamp(w.ok, 0.005, 0.5),
    };
  return cfg;
}

function readPose(v: unknown): DancerPose | null {
  if (!isObj(v) || !okId(v.id)) return null;
  const p: DancerPose = {
    ...(v as object),
    id: v.id,
    move: typeof v.move === 'string' && v.move.length <= 32 ? (v.move as DancerPose['move']) : null,
    moveT: num(v.moveT) ? clamp(v.moveT, 0, 1) : 0,
    centre: v.centre === true,
  };
  const g = GRADES.find(x => x === v.lastGrade);
  if (g !== undefined) p.lastGrade = g;
  else delete p.lastGrade;
  if (!num(v.lastAt)) delete p.lastAt;
  if (typeof v.crashed !== 'boolean') delete p.crashed;
  return p;
}

const moveOf = (v: unknown): MoveId | null =>
  typeof v === 'string' && /^[_a-z]{1,24}$/.test(v) ? (v as MoveId) : null;

function readLaneNote(v: unknown): LaneNote | null {
  if (!isObj(v) || !num(v.beat) || typeof v.id !== 'string' || v.id.length > 64) return null;
  const key = KEYS.find(k => k === v.key);
  const move = moveOf(v.move);
  if (key === undefined || move === null) return null;
  const n: LaneNote = {
    key,
    beat: v.beat,
    id: v.id,
    move,
    i: num(v.i) ? clamp(Math.round(v.i), 0, 16) : 0,
    n: num(v.n) ? clamp(Math.round(v.n), 1, 16) : 1,
  };
  const g = GRADES.find(x => x === v.grade);
  if (g !== undefined) n.grade = g;
  if (num(v.off)) n.off = clamp(v.off, -1, 1);
  if (v.dead === true) n.dead = true;
  return n;
}

function readForming(v: unknown): SimState['forming'] | null {
  if (!isObj(v) || !okId(v.id) || !num(v.got) || !num(v.of)) return null;
  const move = moveOf(v.move);
  if (move === null) return null;
  const of = clamp(Math.round(v.of), 1, 16);
  return {
    id: v.id,
    move,
    got: clamp(Math.round(v.got), 0, of),
    of,
    ...(v.landed === true ? { landed: true } : {}),
  };
}

const pair = (v: unknown): [number, number] =>
  Array.isArray(v) && num(v[0]) && num(v[1]) ? [v[0], v[1]] : [0, 0];

function readCard(v: unknown): JudgeCard | null {
  if (!isObj(v) || !Array.isArray(v.votes)) return null;
  const votes = v.votes
    .slice(0, 5)
    .map(crewOf)
    .filter((c): c is CrewId => c !== null);
  return {
    ...(v as object),
    votes,
    technique: pair(v.technique),
    musicality: pair(v.musicality),
    originality: pair(v.originality),
    power: pair(v.power),
  };
}

/** A snapshot's state, checked (null when it's not one). */
export function readState(v: unknown): SimState | null {
  if (!isObj(v) || !okId(v.gid) || !num(v.t) || !num(v.beat)) return null;
  const phase = PHASES.find(p => p === v.phase);
  if (phase === undefined) return null;
  const t = v.turn;
  const turn =
    isObj(t) && okId(t.id) && num(t.from) && num(t.to)
      ? { id: t.id, from: t.from, to: t.to }
      : null;
  const poses = (Array.isArray(v.poses) ? v.poses.slice(0, MAX_POSES) : [])
    .map(readPose)
    .filter((p): p is DancerPose => p !== null);
  const prompts = (Array.isArray(v.prompts) ? v.prompts.slice(0, MAX_PROMPTS) : []).flatMap(p => {
    if (!isObj(p) || !num(p.beat)) return [];
    const key = KEYS.find(k => k === p.key);
    return key === undefined ? [] : [{ key, beat: p.beat }];
  });
  const cards = (Array.isArray(v.cards) ? v.cards.slice(0, MAX_CARDS) : [])
    .map(readCard)
    .filter((c): c is JudgeCard => c !== null);
  const s: SimState = {
    ...(v as object),
    gid: v.gid,
    phase,
    t: v.t,
    beat: v.beat,
    round: num(v.round) ? Math.max(0, Math.round(v.round)) : 0,
    turn,
    poses,
    turnScore: num(v.turnScore) ? v.turnScore : 0,
    combo: num(v.combo) ? Math.max(0, Math.round(v.combo)) : 0,
    prompts,
    totals: pair(v.totals),
    cards,
  };
  const w = winnerOf(v.winner);
  if (w !== null) s.winner = w;
  else delete s.winner;
  if (Array.isArray(v.lane))
    s.lane = v.lane
      .slice(0, MAX_LANE)
      .map(readLaneNote)
      .filter((n): n is LaneNote => n !== null);
  else delete s.lane;
  const f = readForming(v.forming);
  if (f) s.forming = f;
  else delete s.forming;
  return s;
}

export function readEvents(v: unknown): SimEvent[] {
  if (!Array.isArray(v)) return [];
  const out: SimEvent[] = [];
  for (const e of v.slice(0, MAX_EVENTS)) {
    if (!isObj(e) || typeof e.e !== 'string' || !EVENTS.includes(e.e)) continue;
    if ('id' in e && !okId(e.id)) continue;
    out.push(e as unknown as SimEvent);
  }
  return out;
}

// ── Messages ──

/** One message off the socket, checked; null when it's malformed. */
export function readMsg(raw: unknown): BreakMsg | null {
  if (!isObj(raw) || typeof raw.type !== 'string') return null;
  const from = okId(raw.from) ? raw.from : undefined;
  const gid = okId(raw.gid) ? raw.gid : null;
  switch (raw.type) {
    case 'break:lobby': {
      const m: Extract<BreakMsg, { type: 'break:lobby' }> = {
        type: 'break:lobby',
        at: raw.at === true,
      };
      if (from) m.from = from;
      if (typeof raw.name === 'string') m.name = str(raw.name, 24);
      if (typeof raw.seedKey === 'string') m.seedKey = str(raw.seedKey, 40);
      if (typeof raw.crew === 'string') m.crew = str(raw.crew, 24);
      const l = raw.live;
      if (isObj(l) && okId(l.gid) && sizeOf(l.crewSize) !== null)
        m.live = {
          gid: l.gid,
          crewSize: sizeOf(l.crewSize)!,
          names: (Array.isArray(l.names) ? l.names : []).slice(0, MAX_DANCERS).map(n => str(n, 24)),
        };
      return m;
    }
    case 'break:challenge': {
      const crewSize = sizeOf(raw.crewSize);
      if (!okId(raw.to) || crewSize === null) return null;
      return {
        type: 'break:challenge',
        to: raw.to,
        crewSize,
        ...(from ? { from } : {}),
        ...(gid ? { gid } : {}),
        ...(typeof raw.name === 'string' ? { name: str(raw.name, 24) } : {}),
        ...(crewOf(raw.crew) !== null ? { crew: crewOf(raw.crew)! } : {}),
      };
    }
    case 'break:reply':
      if (!okId(raw.to)) return null;
      return {
        type: 'break:reply',
        to: raw.to,
        ok: raw.ok === true,
        ...(from ? { from } : {}),
        ...(gid ? { gid } : {}),
      };
    case 'break:start': {
      const config = readConfig(raw.config);
      if (config === null) return null;
      return {
        type: 'break:start',
        config,
        ...(okId(raw.host) ? { host: raw.host } : {}),
        ...(okId(raw.to) ? { to: raw.to } : {}),
        ...(num(raw.at) ? { at: clamp(raw.at, -30, 36000) } : {}),
        ...(num(raw.lag) ? { lag: clamp(raw.lag, 0, 0.5) } : {}),
      };
    }
    case 'break:input': {
      const i = readInput(raw.i);
      return gid && i ? { type: 'break:input', gid, i } : null;
    }
    case 'break:s': {
      const state = readState(raw.state);
      if (!gid || state === null) return null;
      return {
        type: 'break:s',
        gid,
        state,
        ...(raw.e !== undefined ? { e: readEvents(raw.e) } : {}),
        ...(num(raw.a) ? { a: raw.a } : {}),
      };
    }
    case 'break:end': {
      const winner = winnerOf(raw.winner);
      if (!gid || winner === null) return null;
      return {
        type: 'break:end',
        gid,
        winner,
        ...(Array.isArray(raw.totals) ? { totals: pair(raw.totals) } : {}),
      };
    }
    case 'break:watch':
      return gid ? { type: 'break:watch', gid, ...(from ? { from } : {}) } : null;
    case 'break:leave':
      return gid ? { type: 'break:leave', gid, ...(okId(raw.id) ? { id: raw.id } : {}) } : null;
    case 'break:ping':
      return gid && num(raw.c)
        ? { type: 'break:ping', gid, c: raw.c, ...(from ? { from } : {}) }
        : null;
    case 'break:pong':
      return gid && okId(raw.to) && num(raw.c) && num(raw.a)
        ? { type: 'break:pong', gid, to: raw.to, c: raw.c, a: raw.a }
        : null;
    default:
      return null;
  }
}

/** The host's snapshot message: state rounded, beats left out of the events. */
export function snapMsg(
  gid: string,
  state: SimState,
  events: readonly SimEvent[],
  a: number,
): BreakMsg {
  const e = events.filter(x => x.e !== 'beat');
  return {
    type: 'break:s',
    gid,
    state: compact(state),
    ...(e.length > 0 ? { e: compact(e.slice(-MAX_EVENTS)) } : {}),
    a: Math.round(a * 1000) / 1000,
  };
}
