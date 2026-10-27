// ── pool:* messages: checked on the way in, trimmed on the way out ──────
//
// Everything from the room is untrusted: readMsg returns a well-formed
// PoolMsg or null (unknown types, wrong shapes, silly sizes, NaNs). Ball
// positions are rounded to 10 µm before they're sent (q), and the host
// rounds its own state the same way, so everyone plays the next shot from
// bit-identical positions.

import type {
  FoulKind,
  FrameState,
  Group,
  LiveFrame,
  PocketId,
  PoolConfig,
  PoolMsg,
  PoolPlayer,
  PoolTable,
  Seat,
  ShotInput,
  ShotOutcome,
  Vec2,
} from '../contract';

const isObj = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown, lo = -1e6, hi = 1e6): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const str = (v: unknown, max = 64): v is string => typeof v === 'string' && v.length <= max;
const id = (v: unknown): v is string => str(v) && v.length > 0;
const seat = (v: unknown): v is Seat => v === 0 || v === 1;
const pocket = (v: unknown): v is PocketId =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 5;

/** Round a coordinate (10 µm). */
export function q(v: number): number {
  return Math.round(v * 1e5) / 1e5;
}

/** The state with every ball position rounded (the host keeps exactly this). */
export function quantize(s: FrameState): FrameState {
  return { ...s, balls: s.balls.map(b => (b === null ? null : { x: q(b.x), y: q(b.y) })) };
}

function vec(v: unknown): Vec2 | null {
  if (!isObj(v) || !num(v.x, -5, 5) || !num(v.y, -5, 5)) return null;
  return { x: v.x, y: v.y };
}

export function readInput(v: unknown): ShotInput | null {
  if (!isObj(v) || !isObj(v.shot)) return null;
  const s = v.shot;
  if (!num(s.dx, -2, 2) || !num(s.dy, -2, 2) || !num(s.power, 0, 1)) return null;
  if (!num(s.side, -1, 1) || !num(s.top, -1, 1)) return null;
  const out: ShotInput = { shot: { dx: s.dx, dy: s.dy, power: s.power, side: s.side, top: s.top } };
  if (v.cue !== undefined) {
    const c = vec(v.cue);
    if (c === null) return null;
    out.cue = c;
  }
  if (v.call !== undefined) {
    if (!pocket(v.call)) return null;
    out.call = v.call;
  }
  return out;
}

const FOULS: FoulKind[] = ['scratch', 'no_contact', 'wrong_first', 'no_rail', 'bad_break'];
const GROUPS: (Group | null)[] = ['solids', 'stripes', null];

function readOutcome(v: unknown): ShotOutcome | null {
  if (v === null) return null;
  if (!isObj(v) || !seat(v.by)) return null;
  if (v.foul !== null && !FOULS.includes(v.foul as FoulKind)) return null;
  if (!Array.isArray(v.potted) || v.potted.length > 16) return null;
  if (!v.potted.every(p => typeof p === 'number' && Number.isInteger(p) && p >= 0 && p < 16))
    return null;
  return {
    by: v.by,
    foul: v.foul as FoulKind | null,
    potted: v.potted as number[],
    scratch: v.scratch === true,
    assigned: v.assigned === true,
    again: v.again === true,
    respotted: v.respotted === true,
  };
}

export function readState(v: unknown): FrameState | null {
  if (!isObj(v) || !Array.isArray(v.balls) || v.balls.length !== 16) return null;
  const balls: (Vec2 | null)[] = [];
  for (const b of v.balls) {
    if (b === null) balls.push(null);
    else {
      const p = vec(b);
      if (p === null) return null;
      balls.push(p);
    }
  }
  if (v.phase !== 'break' && v.phase !== 'play' && v.phase !== 'over') return null;
  if (!seat(v.turn)) return null;
  if (!Array.isArray(v.groups) || v.groups.length !== 2) return null;
  if (!v.groups.every(g => GROUPS.includes(g as Group | null))) return null;
  if (v.inHand !== null && v.inHand !== 'kitchen' && v.inHand !== 'anywhere') return null;
  if (!num(v.shots, 0, 10000)) return null;
  if (!Array.isArray(v.fouls) || v.fouls.length !== 2 || !v.fouls.every(f => num(f, 0, 10000)))
    return null;
  if (v.winner !== null && !seat(v.winner)) return null;
  const last = v.last === undefined ? null : readOutcome(v.last);
  if (v.last !== null && v.last !== undefined && last === null) return null;
  const out: FrameState = {
    balls,
    phase: v.phase,
    turn: v.turn,
    groups: v.groups as [Group | null, Group | null],
    inHand: v.inHand as FrameState['inHand'],
    shots: v.shots,
    fouls: v.fouls as [number, number],
    last,
    winner: v.winner as Seat | null,
  };
  if (str(v.reason, 80)) out.reason = v.reason;
  return out;
}

function readPlayer(v: unknown): PoolPlayer | null {
  if (!isObj(v) || !id(v.id) || !str(v.name, 40) || typeof v.human !== 'boolean') return null;
  const p: PoolPlayer = { id: v.id, name: v.name, human: v.human };
  if (v.skill !== undefined) {
    if (!num(v.skill, 0, 1)) return null;
    p.skill = v.skill;
  }
  if (str(v.seedKey, 80)) p.seedKey = v.seedKey;
  return p;
}

export function readTable(v: unknown): PoolTable | null {
  if (!isObj(v)) return null;
  if (!num(v.x) || !num(v.y, -1e4, 1e5) || !num(v.z) || !num(v.yaw, -100, 100)) return null;
  if (!num(v.length, 0.5, 6) || !num(v.width, 0.3, 4)) return null;
  const t: PoolTable = { x: v.x, y: v.y, z: v.z, yaw: v.yaw, length: v.length, width: v.width };
  if (v.height !== undefined) {
    if (!num(v.height, 0.2, 2)) return null;
    t.height = v.height;
  }
  if (str(v.id, 64)) t.id = v.id;
  return t;
}

export function readConfig(v: unknown): PoolConfig | null {
  if (!isObj(v) || !id(v.gid) || !num(v.seed, 0, 2 ** 32)) return null;
  if (!Array.isArray(v.players) || v.players.length !== 2) return null;
  const a = readPlayer(v.players[0]);
  const b = readPlayer(v.players[1]);
  if (a === null || b === null || !seat(v.breaker)) return null;
  const c: PoolConfig = { gid: v.gid, seed: v.seed >>> 0, players: [a, b], breaker: v.breaker };
  if (v.pro === true) c.pro = true;
  if (str(v.table, 64)) c.table = v.table;
  if (v.place !== undefined) {
    const t = readTable(v.place);
    if (t !== null) c.place = t;
  }
  return c;
}

function readLive(v: unknown): LiveFrame | null {
  if (!isObj(v) || !id(v.gid) || !id(v.host)) return null;
  if (!Array.isArray(v.names) || v.names.length !== 2 || !v.names.every(n => str(n, 40)))
    return null;
  const l: LiveFrame = { gid: v.gid, host: v.host, names: v.names as [string, string] };
  if (str(v.table, 64)) l.table = v.table;
  return l;
}

/** A raw room message → a checked PoolMsg (or null). */
export function readMsg(raw: unknown): PoolMsg | null {
  if (!isObj(raw) || typeof raw.type !== 'string') return null;
  const from = id(raw.from) ? raw.from : undefined;
  switch (raw.type) {
    case 'pool:lobby': {
      if (raw.at !== null && !str(raw.at, 64)) return null;
      const m: Extract<PoolMsg, { type: 'pool:lobby' }> = {
        type: 'pool:lobby',
        at: raw.at as string | null,
        from,
      };
      if (str(raw.name, 40)) m.name = raw.name;
      if (str(raw.seedKey, 80)) m.seedKey = raw.seedKey;
      if (raw.live !== undefined) {
        const l = readLive(raw.live);
        if (l !== null) m.live = l;
      }
      return m;
    }
    case 'pool:challenge': {
      if (!id(raw.to) || !id(raw.gid)) return null;
      const m: Extract<PoolMsg, { type: 'pool:challenge' }> = {
        type: 'pool:challenge',
        to: raw.to,
        gid: raw.gid,
        from,
      };
      if (str(raw.name, 40)) m.name = raw.name;
      if (str(raw.table, 64)) m.table = raw.table;
      if (raw.place !== undefined) {
        const t = readTable(raw.place);
        if (t !== null) m.place = t;
      }
      return m;
    }
    case 'pool:reply':
      if (!id(raw.to) || !id(raw.gid) || typeof raw.ok !== 'boolean') return null;
      return { type: 'pool:reply', to: raw.to, gid: raw.gid, ok: raw.ok, from };
    case 'pool:start': {
      const config = readConfig(raw.config);
      if (config === null) return null;
      const m: Extract<PoolMsg, { type: 'pool:start' }> = { type: 'pool:start', config };
      if (id(raw.host)) m.host = raw.host;
      if (id(raw.to)) m.to = raw.to;
      if (raw.state !== undefined) {
        const s = readState(raw.state);
        if (s === null) return null;
        m.state = s;
      }
      if (num(raw.n, 0, 10000)) m.n = raw.n;
      return m;
    }
    case 'pool:shot': {
      if (!id(raw.gid) || !num(raw.n, 0, 10000)) return null;
      const input = readInput(raw.input);
      if (input === null) return null;
      return { type: 'pool:shot', gid: raw.gid, n: raw.n, input, from };
    }
    case 'pool:aim': {
      if (!id(raw.gid) || !num(raw.dx, -2, 2) || !num(raw.dy, -2, 2) || !num(raw.p, 0, 1))
        return null;
      const m: Extract<PoolMsg, { type: 'pool:aim' }> = {
        type: 'pool:aim',
        gid: raw.gid,
        dx: raw.dx,
        dy: raw.dy,
        p: raw.p,
        from,
      };
      if (raw.cue !== undefined) {
        const c = vec(raw.cue);
        if (c !== null) m.cue = c;
      }
      return m;
    }
    case 'pool:result': {
      if (!id(raw.gid) || !num(raw.n, 0, 10000)) return null;
      const input = readInput(raw.input);
      const state = readState(raw.state);
      if (input === null || state === null) return null;
      return { type: 'pool:result', gid: raw.gid, n: raw.n, input, state };
    }
    case 'pool:end':
      if (!id(raw.gid) || (raw.winner !== null && !seat(raw.winner))) return null;
      return {
        type: 'pool:end',
        gid: raw.gid,
        winner: raw.winner as Seat | null,
        ...(str(raw.reason, 80) ? { reason: raw.reason } : {}),
      };
    case 'pool:watch':
      if (!id(raw.gid)) return null;
      return { type: 'pool:watch', gid: raw.gid, from };
    case 'pool:leave':
      if (!id(raw.gid)) return null;
      return { type: 'pool:leave', gid: raw.gid, ...(id(raw.id) ? { id: raw.id } : {}) };
    default:
      return null;
  }
}

/** A message ready to send (positions rounded). */
export function writeMsg(m: PoolMsg): PoolMsg {
  switch (m.type) {
    case 'pool:result':
      return { ...m, state: quantize(m.state) };
    case 'pool:start':
      return m.state === undefined ? m : { ...m, state: quantize(m.state) };
    case 'pool:aim':
      return { ...m, dx: q(m.dx), dy: q(m.dy), p: Math.round(m.p * 1000) / 1000 };
    default:
      return m;
  }
}
