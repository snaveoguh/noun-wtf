// ── Hide & Seek on the wire: everything that arrives is checked here ─────
//
// `readMsg` turns a raw `hideseek:*` object into an HsMsg or null: ids and
// names are short strings, numbers are finite and in range, arrays are
// capped, unknown fields are dropped. Nothing from the room reaches the
// game without passing through it.

import type {
  HsAct,
  HsBotPose,
  HsConfig,
  HsEvent,
  HsMsg,
  HsOpenGame,
  HsPhase,
  HsPlayer,
  HsSnap,
  HsSpot,
  HsStanding,
} from '../contract';

import { BOT_ANIMS, LIMITS } from '../contract';

type R = Record<string, unknown>;

const isObj = (v: unknown): v is R => v !== null && typeof v === 'object' && !Array.isArray(v);
export const okId = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= 64 && !/[<>"'&]/.test(v);
const name = (v: unknown): string | null =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f]/g, '').slice(0, 24) : null;
const fin = (v: unknown, lo: number, hi: number): number | null =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null;
const PHASES: readonly HsPhase[] = ['hide', 'seek', 'reveal', 'over'];
const STANDINGS: readonly HsStanding[] = ['h', 's', 'f'];
const ACTS: readonly HsAct[] = ['tag', 'whistle', 'ping'];
const SEED_RE = /^\d{1,4}-\d{1,4}-\d{1,4}-\d{1,4}-\d{1,4}$/;
const MAX = LIMITS.maxPlayers;
const COORD = 1e5;

function player(v: unknown): HsPlayer | null {
  if (!isObj(v) || !okId(v.id)) return null;
  const n = name(v.name);
  if (n === null) return null;
  const p: HsPlayer = { id: v.id, name: n, cpu: v.cpu === true };
  if (typeof v.seed === 'string' && SEED_RE.test(v.seed)) p.seed = v.seed;
  return p;
}

function players(v: unknown): HsPlayer[] | null {
  if (!Array.isArray(v) || v.length > MAX) return null;
  const out: HsPlayer[] = [];
  const seen = new Set<string>();
  for (const x of v) {
    const p = player(x);
    if (p === null || seen.has(p.id)) return null;
    seen.add(p.id);
    out.push(p);
  }
  return out;
}

export function readConfig(v: unknown): HsConfig | null {
  if (!isObj(v) || !okId(v.gid)) return null;
  const ps = players(v.players);
  const seed = fin(v.seed, -(2 ** 31), 2 ** 32);
  const seekers = fin(v.seekers, 1, 2);
  const rounds = fin(v.rounds, 1, LIMITS.maxRounds);
  const hideS = fin(v.hideS, 5, 300);
  const seekS = fin(v.seekS, 10, 900);
  const skill = fin(v.skill, 0, 1);
  if (ps === null || ps.length < LIMITS.minPlayers) return null;
  if (seed === null || seekers === null || rounds === null || hideS === null || seekS === null)
    return null;
  if (skill === null || !Array.isArray(v.order) || v.order.length !== ps.length) return null;
  const ids = new Set(ps.map(p => p.id));
  const order = v.order.filter((x): x is string => okId(x) && ids.has(x));
  if (new Set(order).size !== ps.length) return null;
  return {
    gid: v.gid,
    seed: Math.floor(seed),
    arena: 'plaza',
    players: ps,
    seekers: Math.round(seekers),
    rounds: Math.round(rounds),
    hideS,
    seekS,
    order,
    skill,
  };
}

function event(v: unknown): HsEvent | null {
  if (!isObj(v)) return null;
  switch (v.k) {
    case 'phase': {
      const round = fin(v.round, 0, 99);
      return PHASES.includes(v.ph as HsPhase) && round !== null
        ? { k: 'phase', ph: v.ph as HsPhase, round }
        : null;
    }
    case 'tag':
      return okId(v.by) && okId(v.id)
        ? v.inside === true
          ? { k: 'tag', by: v.by, id: v.id, inside: true }
          : { k: 'tag', by: v.by, id: v.id }
        : null;
    case 'whistle':
      return okId(v.id) ? { k: 'whistle', id: v.id } : null;
    case 'ping':
      return okId(v.by) && okId(v.id) ? { k: 'ping', by: v.by, id: v.id } : null;
    case 'beacon':
      return okId(v.id) && okId(v.door) ? { k: 'beacon', id: v.id, door: v.door } : null;
    case 'reassign':
      return okId(v.id) ? { k: 'reassign', id: v.id } : null;
    case 'drop':
      return okId(v.id) ? { k: 'drop', id: v.id } : null;
    case 'win': {
      const round = fin(v.round, 0, 99);
      return (v.side === 'hiders' || v.side === 'seekers') && round !== null
        ? { k: 'win', side: v.side, round }
        : null;
    }
    default:
      return null;
  }
}

function pairs<T>(v: unknown, val: (x: unknown) => T | null, cap = MAX): [string, T][] | null {
  if (!Array.isArray(v) || v.length > cap) return null;
  const out: [string, T][] = [];
  for (const e of v) {
    if (!Array.isArray(e) || e.length !== 2 || !okId(e[0])) return null;
    const x = val(e[1]);
    if (x === null) return null;
    out.push([e[0], x]);
  }
  return out;
}

function spot(v: unknown): HsSpot | null {
  if (!isObj(v) || !okId(v.id)) return null;
  const x = fin(v.x, -COORD, COORD);
  const y = fin(v.y, -COORD, COORD);
  const z = fin(v.z, -COORD, COORD);
  if (x === null || y === null || z === null || !STANDINGS.includes(v.st as HsStanding))
    return null;
  const s: HsSpot = { id: v.id, x, y, z, st: v.st as HsStanding };
  if (okId(v.door)) s.door = v.door;
  return s;
}

function botPose(v: unknown): HsBotPose | null {
  if (!Array.isArray(v) || v.length !== 6 || !okId(v[0])) return null;
  const n = v
    .slice(1)
    .map((x, i) => fin(x, i === 4 ? 0 : -COORD, i === 4 ? BOT_ANIMS.length - 1 : COORD));
  if (n.some(x => x === null)) return null;
  return [v[0], n[0]!, n[1]!, n[2]!, n[3]!, Math.round(n[4]!)];
}

export function readSnap(v: unknown): HsSnap | null {
  if (!isObj(v) || !PHASES.includes(v.ph as HsPhase)) return null;
  const r = fin(v.r, 0, 99);
  const t = fin(v.t, 0, 3600);
  const st = pairs(v.st, x => (STANDINGS.includes(x as HsStanding) ? (x as HsStanding) : null));
  const sc = pairs(v.sc, x => fin(x, -1e6, 1e6));
  if (r === null || t === null || st === null || sc === null) return null;
  if (!Array.isArray(v.bc) || v.bc.length > 64 || !Array.isArray(v.bots) || v.bots.length > MAX)
    return null;
  const bc: [string, number, number][] = [];
  for (const b of v.bc) {
    if (!Array.isArray(b) || b.length !== 3 || !okId(b[0])) return null;
    const x = fin(b[1], -COORD, COORD);
    const z = fin(b[2], -COORD, COORD);
    if (x === null || z === null) return null;
    bc.push([b[0], x, z]);
  }
  const bots: HsBotPose[] = [];
  for (const b of v.bots) {
    const p = botPose(b);
    if (p === null) return null;
    bots.push(p);
  }
  if (!Array.isArray(v.ev) || v.ev.length > 64) return null;
  const ev: HsEvent[] = [];
  for (const e of v.ev) {
    const x = event(e);
    if (x !== null) ev.push(x);
  }
  const snap: HsSnap = { ph: v.ph as HsPhase, r, t, st, sc, bc, bots, ev };
  if (v.rv !== undefined) {
    if (!Array.isArray(v.rv) || v.rv.length > MAX) return null;
    const rv: HsSpot[] = [];
    for (const x of v.rv) {
      const s = spot(x);
      if (s === null) return null;
      rv.push(s);
    }
    snap.rv = rv;
  }
  if (v.win === 'hiders' || v.win === 'seekers') snap.win = v.win;
  if (v.cd !== undefined) {
    const cd = pairs(v.cd, x => fin(x, 0, 999));
    if (cd !== null) snap.cd = cd;
  }
  return snap;
}

function open(v: unknown): HsOpenGame | null {
  if (!isObj(v) || !okId(v.gid) || !okId(v.host)) return null;
  const hostName = name(v.hostName);
  const n = fin(v.n, 0, MAX);
  const max = fin(v.max, 2, MAX);
  if (hostName === null || n === null || max === null) return null;
  if (v.state !== 'lobby' && v.state !== 'live') return null;
  const names = Array.isArray(v.names)
    ? v.names
        .slice(0, MAX)
        .map(name)
        .filter((x): x is string => x !== null)
    : [];
  return { gid: v.gid, host: v.host, hostName, n, max, state: v.state, names };
}

export function readMsg(raw: unknown): HsMsg | null {
  if (!isObj(raw) || typeof raw.type !== 'string') return null;
  switch (raw.type) {
    case 'hideseek:lobby': {
      const m: HsMsg = { type: 'hideseek:lobby' };
      if (okId(raw.from)) m.from = raw.from;
      if (raw.open === null) m.open = null;
      else if (raw.open !== undefined) {
        const o = open(raw.open);
        if (o === null) return null;
        m.open = o;
      }
      if (Array.isArray(raw.hide)) m.hide = raw.hide.slice(0, MAX).filter(okId);
      return m;
    }
    case 'hideseek:join':
      return okId(raw.gid)
        ? { type: 'hideseek:join', gid: raw.gid, ...(okId(raw.from) ? { from: raw.from } : {}) }
        : null;
    case 'hideseek:roster': {
      const ps = players(raw.players);
      const cpu = fin(raw.cpu, 0, MAX);
      if (!okId(raw.gid) || ps === null || cpu === null) return null;
      return {
        type: 'hideseek:roster',
        gid: raw.gid,
        players: ps,
        cpu: Math.round(cpu),
        ...(okId(raw.host) ? { host: raw.host } : {}),
      };
    }
    case 'hideseek:start': {
      const config = readConfig(raw.config);
      if (!okId(raw.gid) || config === null || config.gid !== raw.gid) return null;
      return {
        type: 'hideseek:start',
        gid: raw.gid,
        config,
        ...(okId(raw.host) ? { host: raw.host } : {}),
      };
    }
    case 'hideseek:s': {
      const s = readSnap(raw.s);
      return okId(raw.gid) && s !== null ? { type: 'hideseek:s', gid: raw.gid, s } : null;
    }
    case 'hideseek:act': {
      if (!okId(raw.gid) || !ACTS.includes(raw.a as HsAct)) return null;
      const m: HsMsg = { type: 'hideseek:act', gid: raw.gid, a: raw.a as HsAct };
      if (okId(raw.target)) m.target = raw.target;
      if (okId(raw.from)) m.from = raw.from;
      return m;
    }
    case 'hideseek:leave':
      return okId(raw.gid)
        ? { type: 'hideseek:leave', gid: raw.gid, ...(okId(raw.id) ? { id: raw.id } : {}) }
        : null;
    case 'hideseek:end':
      return okId(raw.gid) ? { type: 'hideseek:end', gid: raw.gid } : null;
    default:
      return null;
  }
}
