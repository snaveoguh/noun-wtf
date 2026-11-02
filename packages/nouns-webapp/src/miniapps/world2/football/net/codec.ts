// ── Football snapshot codec: SimState ↔ a small quantised binary (base64) ─
//
// Footballers are indexed by their order in MatchConfig.players and humans
// by MatchConfig.humans (every client has the config from football:start),
// so ids, names and teams never go on the wire. Little-endian throughout.
//
//   header   21 B  version u8, tick u32, time ms u32, phase|period u8,
//                  clock cs u32, added ds u16, phaseT cs u16, score u8 ×2,
//                  flags u8 (poss, attackPlusZ, restart?, shootout?)
//   restart   8 B  kind|team|direct u8, x, z cm i16, taker u8   (if any)
//   ball     21 B  pos cm i16 ×3, vel cm/s i16 ×3, spin crad/s i16 ×3,
//                  mode u8, owner u8, lastTouch u8 (255 = none)
//   player   15 B  flags u8 (absent, yellows, off, dir?, human?), x, z cm
//                  i16, y 2cm u8, vx, vz cm/s i16, yaw u16 (0.0055°),
//                  action u8, actionT u8, stamina u8, [actionDir ×100 i16],
//                  [human u8]
//   human     4 B  input ack u16, charge kind|present u8, power u8
//   stats    52 B  per team: poss ticks u32, 11 × u16
//   goals  1+4g B  count, then team|own|pen u8, scorer u8, assist u8, minute u8
//   shootout       next u8, kicks u8 ×2, then the kicks as bits      (if any)
//
// An 11-a-side snapshot with two humans is 441-463 B (≤ 620 chars of
// base64; ≤ 660 B as a football:s message with its event window). `sim` (the host's internals) never goes.
//
// Events ride alongside as a compact array: [firstSeq, ev, ev, …] with
// each ev = [type code, ticks before the snapshot, …fields] (append-only
// EVENT_TYPES; ids → indices; floats to 2 dp).

import type {
  Action,
  BallMode,
  BallState,
  FootballEvent,
  FootballMsg,
  GoalRecord,
  MatchConfig,
  PadInput,
  Period,
  Phase,
  PlayerState,
  Restart,
  RestartKind,
  Shootout,
  SimState,
  TeamId,
  TeamStats,
} from '../contract';

export const CODEC_VERSION = 1;

/** Append-only: indices go on the wire. */
export const ACTIONS: Action[] = [
  'idle',
  'jog',
  'run',
  'sprint',
  'dribble',
  'trap',
  'pass',
  'lob',
  'shoot',
  'volley',
  'header',
  'tackle',
  'slide',
  'fallen',
  'jockey',
  'shield',
  'skill',
  'throw_in',
  'celebrate',
  'dejected',
  'gk_ready',
  'gk_dive',
  'gk_catch',
  'gk_hold',
  'gk_throw',
  'gk_kick',
];
export const PHASES: Phase[] = [
  'pregame',
  'kickoff',
  'live',
  'restart',
  'goal',
  'halftime',
  'fulltime',
  'shootout',
  'final',
];
export const RESTART_KINDS: RestartKind[] = [
  'kickoff',
  'throw_in',
  'corner',
  'goal_kick',
  'free_kick',
  'penalty',
  'drop_ball',
];
const BALL_MODES: BallMode[] = ['free', 'held', 'dead'];
const CHARGE_KINDS = ['pass', 'shot', 'lob', 'through'] as const;
/** TeamStats fields after `poss` (u16 each). Append-only. */
const STAT_KEYS = [
  'shots',
  'onTarget',
  'passes',
  'passesDone',
  'tackles',
  'fouls',
  'corners',
  'offsides',
  'yellows',
  'reds',
  'saves',
] as const satisfies readonly (keyof TeamStats)[];

const NONE = 255;
const TAU = Math.PI * 2;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const num = (v: number) => (Number.isFinite(v) ? v : 0);
const i16 = (v: number) => clamp(Math.round(num(v)), -32768, 32767);
const u8 = (v: number) => clamp(Math.round(num(v)), 0, 255);
const u16 = (v: number) => clamp(Math.round(num(v)), 0, 65535);
const u32 = (v: number) => clamp(Math.round(num(v)), 0, 4294967295);

// ── Bytes ──

class Writer {
  buf = new Uint8Array(1024);
  v = new DataView(this.buf.buffer);
  o = 0;
  private room(n: number) {
    if (this.o + n <= this.buf.length) return;
    const b = new Uint8Array(Math.max(this.buf.length * 2, this.o + n));
    b.set(this.buf);
    this.buf = b;
    this.v = new DataView(b.buffer);
  }
  u8(x: number) {
    this.room(1);
    this.v.setUint8(this.o, u8(x));
    this.o += 1;
  }
  i16(x: number) {
    this.room(2);
    this.v.setInt16(this.o, i16(x), true);
    this.o += 2;
  }
  u16(x: number) {
    this.room(2);
    this.v.setUint16(this.o, u16(x), true);
    this.o += 2;
  }
  u32(x: number) {
    this.room(4);
    this.v.setUint32(this.o, u32(x), true);
    this.o += 4;
  }
  bytes() {
    return this.buf.subarray(0, this.o);
  }
}

class Reader {
  o = 0;
  private v: DataView;
  constructor(private b: Uint8Array) {
    this.v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  }
  private need(n: number) {
    if (this.o + n > this.b.length) throw new Error('short');
  }
  u8() {
    this.need(1);
    return this.v.getUint8(this.o++);
  }
  i16() {
    this.need(2);
    const x = this.v.getInt16(this.o, true);
    this.o += 2;
    return x;
  }
  u16() {
    this.need(2);
    const x = this.v.getUint16(this.o, true);
    this.o += 2;
    return x;
  }
  u32() {
    this.need(4);
    const x = this.v.getUint32(this.o, true);
    this.o += 4;
    return x;
  }
}

function toB64(b: Uint8Array) {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s);
}

function fromB64(s: string) {
  const bin = atob(s);
  const b = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
  return b;
}

// ── Indices ──

export interface Indexer {
  player(id: string | null | undefined): number;
  human(id: string | null | undefined): number;
  playerId(i: number): string | null;
  humanId(i: number): string | null;
}

const indexers = new WeakMap<MatchConfig, Indexer>();

export function indexer(cfg: MatchConfig): Indexer {
  let x = indexers.get(cfg);
  if (x !== undefined) return x;
  const pm = new Map(cfg.players.map((p, i) => [p.id, i]));
  const hm = new Map(cfg.humans.map((h, i) => [h.id, i]));
  x = {
    player: id => (id == null ? NONE : (pm.get(id) ?? NONE)),
    human: id => (id == null ? NONE : (hm.get(id) ?? NONE)),
    playerId: i => (i === NONE ? null : (cfg.players[i]?.id ?? null)),
    humanId: i => (i === NONE ? null : (cfg.humans[i]?.id ?? null)),
  };
  indexers.set(cfg, x);
  return x;
}

const wrapYaw = (y: number) => ((num(y) % TAU) + TAU) % TAU;

// ── State ──

/**
 * Encode a state. `acks[h]` = the last input seq the host applied for
 * config.humans[h] (16-bit, wraps).
 */
export function encodeState(s: SimState, cfg: MatchConfig, acks: number[] = []): string {
  return toB64(encodeBytes(s, cfg, acks));
}

export function encodeBytes(s: SimState, cfg: MatchConfig, acks: number[] = []): Uint8Array {
  const w = new Writer();
  const ix = indexer(cfg);
  w.u8(CODEC_VERSION);
  w.u32(s.tick);
  w.u32(s.time * 1000);
  w.u8((Math.max(0, PHASES.indexOf(s.phase)) & 15) | ((s.period & 7) << 4));
  w.u32(s.clock * 100);
  w.u16(s.added * 10);
  w.u16(s.phaseT * 100);
  w.u8(s.score[0]);
  w.u8(s.score[1]);
  w.u8((s.poss & 1) | ((s.attackPlusZ & 1) << 1) | (s.restart ? 4 : 0) | (s.shootout ? 8 : 0));
  const r = s.restart;
  if (r) {
    w.u8(
      (Math.max(0, RESTART_KINDS.indexOf(r.kind)) & 7) |
        ((r.team & 1) << 3) |
        (r.direct !== undefined ? 16 : 0) |
        (r.direct === true ? 32 : 0),
    );
    w.i16(r.x * 100);
    w.i16(r.z * 100);
    w.u8(ix.player(r.taker));
  }
  const b = s.ball;
  w.i16(b.x * 100);
  w.i16(b.y * 100);
  w.i16(b.z * 100);
  w.i16(b.vx * 100);
  w.i16(b.vy * 100);
  w.i16(b.vz * 100);
  w.i16(b.wx * 100);
  w.i16(b.wy * 100);
  w.i16(b.wz * 100);
  w.u8(Math.max(0, BALL_MODES.indexOf(b.mode)));
  w.u8(ix.player(b.owner));
  w.u8(ix.player(b.lastTouch));

  const byId = new Map(s.players.map(p => [p.id, p]));
  for (const f of cfg.players) {
    const p = byId.get(f.id);
    if (!p) {
      w.u8(1);
      continue;
    }
    const hasDir = p.actionDir !== undefined;
    const h = p.human == null ? NONE : ix.human(p.human);
    w.u8(
      ((clamp(p.yellow | 0, 0, 3) & 3) << 1) |
        (p.off === true ? 8 : 0) |
        (hasDir ? 16 : 0) |
        (h !== NONE ? 32 : 0),
    );
    w.i16(p.x * 100);
    w.i16(p.z * 100);
    w.u8(p.y * 50);
    w.i16(p.vx * 100);
    w.i16(p.vz * 100);
    w.u16(Math.round(wrapYaw(p.yaw) * (65536 / TAU)) & 0xffff);
    w.u8(Math.max(0, ACTIONS.indexOf(p.action)));
    w.u8(clamp(p.actionT, 0, 1) * 255);
    w.u8(clamp(p.stamina, 0, 1) * 255);
    if (hasDir) w.i16(p.actionDir! * 100);
    if (h !== NONE) w.u8(h);
  }

  cfg.humans.forEach((hu, i) => {
    w.u16((acks[i] ?? 0) & 0xffff);
    const c = s.charge[hu.id];
    const k = c ? CHARGE_KINDS.indexOf(c.kind) : -1;
    w.u8(c && k >= 0 ? 128 | k : 0);
    w.u8(c ? clamp(c.power, 0, 1) * 255 : 0);
  });

  for (const t of s.stats) {
    w.u32(t.poss);
    for (const k of STAT_KEYS) w.u16(t[k]);
  }

  const goals = s.goals.slice(-255);
  w.u8(goals.length);
  for (const g of goals) {
    w.u8((g.team & 1) | (g.ownGoal ? 2 : 0) | (g.penalty ? 4 : 0));
    w.u8(ix.player(g.scorer));
    w.u8(ix.player(g.assist));
    w.u8(g.minute);
  }

  const so = s.shootout;
  if (so) {
    w.u8(so.next & 1);
    const k0 = so.kicks[0].slice(0, 255);
    const k1 = so.kicks[1].slice(0, 255);
    w.u8(k0.length);
    w.u8(k1.length);
    for (const ks of [k0, k1])
      for (let i = 0; i < ks.length; i += 8) {
        let byte = 0;
        for (let j = 0; j < 8 && i + j < ks.length; j++) if (ks[i + j]) byte |= 1 << j;
        w.u8(byte);
      }
  }
  return w.bytes();
}

export interface Decoded {
  /** Everything but `sim`; `events` is empty (they ride separately). */
  state: SimState;
  /** Per config.humans index: last input seq the host applied (16-bit). */
  acks: number[];
}

export function decodeState(d: string, cfg: MatchConfig): Decoded | null {
  let bytes: Uint8Array;
  try {
    bytes = fromB64(d);
  } catch {
    return null;
  }
  return decodeBytes(bytes, cfg);
}

export function decodeBytes(bytes: Uint8Array, cfg: MatchConfig): Decoded | null {
  try {
    return readState(new Reader(bytes), bytes.length, cfg);
  } catch {
    return null;
  }
}

function readState(r: Reader, len: number, cfg: MatchConfig): Decoded | null {
  const ix = indexer(cfg);
  if (r.u8() !== CODEC_VERSION) return null;
  const tick = r.u32();
  const time = r.u32() / 1000;
  const pp = r.u8();
  const clock = r.u32() / 100;
  const added = r.u16() / 10;
  const phaseT = r.u16() / 100;
  const score: [number, number] = [r.u8(), r.u8()];
  const flags = r.u8();
  let restart: Restart | null = null;
  if (flags & 4) {
    const k = r.u8();
    restart = {
      kind: RESTART_KINDS[k & 7] ?? 'kickoff',
      team: ((k >> 3) & 1) as TeamId,
      x: r.i16() / 100,
      z: r.i16() / 100,
      taker: ix.playerId(r.u8()),
    };
    if (k & 16) restart.direct = (k & 32) !== 0;
  }
  const ball: BallState = {
    x: r.i16() / 100,
    y: r.i16() / 100,
    z: r.i16() / 100,
    vx: r.i16() / 100,
    vy: r.i16() / 100,
    vz: r.i16() / 100,
    wx: r.i16() / 100,
    wy: r.i16() / 100,
    wz: r.i16() / 100,
    mode: BALL_MODES[r.u8()] ?? 'free',
    owner: ix.playerId(r.u8()),
    lastTouch: ix.playerId(r.u8()),
  };
  const players: PlayerState[] = [];
  for (const f of cfg.players) {
    const fl = r.u8();
    if (fl & 1) continue;
    const x = r.i16() / 100;
    const z = r.i16() / 100;
    const y = r.u8() / 50;
    const vx = r.i16() / 100;
    const vz = r.i16() / 100;
    const yw = (r.u16() * TAU) / 65536;
    const action = ACTIONS[r.u8()] ?? 'idle';
    const actionT = r.u8() / 255;
    const stamina = r.u8() / 255;
    const p: PlayerState = {
      id: f.id,
      team: f.team,
      x,
      y,
      z,
      vx,
      vz,
      yaw: yw > Math.PI ? yw - TAU : yw,
      action,
      actionT,
      stamina,
      yellow: (fl >> 1) & 3,
      human: null,
    };
    if (fl & 8) p.off = true;
    if (fl & 16) p.actionDir = r.i16() / 100;
    if (fl & 32) p.human = ix.humanId(r.u8());
    players.push(p);
  }
  const acks: number[] = [];
  const charge: SimState['charge'] = {};
  for (const hu of cfg.humans) {
    acks.push(r.u16());
    const k = r.u8();
    const power = r.u8() / 255;
    if (k & 128) charge[hu.id] = { power, kind: CHARGE_KINDS[k & 3] };
  }
  const stats = [0, 1].map(() => {
    const t = { poss: r.u32() } as TeamStats;
    for (const k of STAT_KEYS) t[k] = r.u16();
    return t;
  }) as [TeamStats, TeamStats];
  const goals: GoalRecord[] = [];
  const ng = r.u8();
  for (let i = 0; i < ng; i++) {
    const f = r.u8();
    goals.push({
      team: (f & 1) as TeamId,
      ownGoal: (f & 2) !== 0,
      penalty: (f & 4) !== 0,
      scorer: ix.playerId(r.u8()) ?? '',
      assist: ix.playerId(r.u8()),
      minute: r.u8(),
    });
  }
  let shootout: Shootout | null = null;
  if (flags & 8) {
    const next = (r.u8() & 1) as TeamId;
    const n0 = r.u8();
    const n1 = r.u8();
    const kicks: [boolean[], boolean[]] = [[], []];
    [n0, n1].forEach((n, t) => {
      for (let i = 0; i < n; i += 8) {
        const byte = r.u8();
        for (let j = 0; j < 8 && i + j < n; j++) kicks[t].push((byte & (1 << j)) !== 0);
      }
    });
    shootout = { kicks, next };
  }
  if (r.o !== len) return null;
  const state: SimState = {
    tick,
    time,
    period: clamp((pp >> 4) & 7, 1, 5) as Period,
    clock,
    added,
    phase: PHASES[pp & 15] ?? 'live',
    phaseT,
    score,
    poss: (flags & 1) as TeamId,
    attackPlusZ: ((flags >> 1) & 1) as TeamId,
    restart,
    players,
    ball,
    shootout,
    goals,
    stats,
    charge,
    events: [],
  };
  return { state, acks };
}

// ── Events ──

type FieldKind =
  | 'p' // footballer id → index
  | 'h' // human id → index
  | 'n' // number, 2 dp
  | 'i' // integer / raw JSON
  | 'b' // boolean → 1 / 0
  | 'R' // Restart
  | readonly string[]; // enum → index

type Field = readonly [key: string, kind: FieldKind, optional?: boolean];

const KICKS = ['pass', 'through', 'lob', 'shot', 'volley', 'clear', 'restart'] as const;

/** Append-only: the index is the wire code. Fields in order after [code, dtick]. */
export const EVENT_TYPES: readonly (readonly [FootballEvent['type'], readonly Field[]])[] = [
  [
    'kick',
    [
      ['id', 'p'],
      ['kind', KICKS],
      ['power', 'n'],
    ],
  ],
  [
    'header',
    [
      ['id', 'p'],
      ['power', 'n'],
    ],
  ],
  [
    'touch',
    [
      ['id', 'p'],
      ['quality', 'n'],
    ],
  ],
  ['bounce', [['strength', 'n']]],
  [
    'woodwork',
    [
      ['part', ['post', 'bar']],
      ['strength', 'n'],
    ],
  ],
  ['net', [['strength', 'n']]],
  [
    'goal',
    [
      ['team', 'i'],
      ['scorer', 'p'],
      ['assist', 'p'],
      ['ownGoal', 'b'],
    ],
  ],
  [
    'save',
    [
      ['id', 'p'],
      ['caught', 'b'],
    ],
  ],
  [
    'tackle',
    [
      ['id', 'p'],
      ['on', 'p'],
      ['won', 'b'],
      ['slide', 'b'],
    ],
  ],
  [
    'foul',
    [
      ['id', 'p'],
      ['on', 'p'],
      ['x', 'n'],
      ['z', 'n'],
      ['penalty', 'b'],
    ],
  ],
  [
    'card',
    [
      ['id', 'p'],
      ['color', ['yellow', 'red']],
    ],
  ],
  [
    'offside',
    [
      ['id', 'p'],
      ['x', 'n'],
      ['z', 'n'],
    ],
  ],
  [
    'out',
    [
      ['kind', RESTART_KINDS],
      ['team', 'i'],
    ],
  ],
  ['whistle', [['kind', ['short', 'long', 'end']]]],
  ['restart', [['restart', 'R']]],
  ['period', [['period', 'i']]],
  [
    'shootout',
    [
      ['team', 'i'],
      ['id', 'p'],
      ['scored', 'b'],
    ],
  ],
  [
    'switch',
    [
      ['human', 'h'],
      ['to', 'p'],
    ],
  ],
  [
    'chance',
    [
      ['team', 'i'],
      ['quality', 'n'],
    ],
  ],
  [
    'final',
    [
      ['winner', 'i'],
      ['score', 'i'],
      ['pens', 'i', true],
    ],
  ],
];
const CODE = new Map(EVENT_TYPES.map(([t], i) => [t, i]));

const r2 = (v: unknown) => (typeof v === 'number' ? Math.round(v * 100) / 100 : 0);

function packId(i: number, id: unknown) {
  // Unknown ids go as themselves (lossless), known ones as an index
  return i !== NONE ? i : typeof id === 'string' ? id : null;
}

function unpackId(v: unknown, toId: (i: number) => string | null) {
  if (typeof v === 'number') return toId(v);
  return typeof v === 'string' ? v.slice(0, 64) : null;
}

function packRestart(r: Restart, ix: Indexer) {
  return [
    RESTART_KINDS.indexOf(r.kind),
    r.team,
    r2(r.x),
    r2(r.z),
    packId(ix.player(r.taker), r.taker),
    r.direct === undefined ? null : r.direct ? 1 : 0,
  ];
}

function unpackRestart(v: unknown, ix: Indexer): Restart | null {
  if (!Array.isArray(v)) return null;
  const r: Restart = {
    kind: RESTART_KINDS[v[0] as number] ?? 'kickoff',
    team: (v[1] === 1 ? 1 : 0) as TeamId,
    x: typeof v[2] === 'number' ? v[2] : 0,
    z: typeof v[3] === 'number' ? v[3] : 0,
    taker: unpackId(v[4], ix.playerId),
  };
  if (v[5] === 0 || v[5] === 1) r.direct = v[5] === 1;
  return r;
}

export interface TimedEvent {
  /** Host event sequence number (0, 1, 2, … for the whole match). */
  seq: number;
  /** The sim tick it happened on. */
  tick: number;
  ev: FootballEvent;
}

/**
 * Events → wire form `[firstSeq, ev, …]`, ev = `[code, snapTick − tick, …fields]`.
 * `list` must be consecutive seqs starting at list[0].seq.
 */
export function packEvents(list: TimedEvent[], snapTick: number, cfg: MatchConfig): unknown[] {
  const ix = indexer(cfg);
  const out: unknown[] = [list.length > 0 ? list[0].seq : 0];
  for (const { tick, ev } of list) {
    const code = CODE.get(ev.type);
    if (code === undefined) {
      out.push(null); // keeps the seq numbering
      continue;
    }
    const e = ev as unknown as Record<string, unknown>;
    const a: unknown[] = [code, Math.max(0, snapTick - tick)];
    for (const [key, kind] of EVENT_TYPES[code][1]) {
      const v = e[key];
      if (kind === 'p') a.push(packId(ix.player(v as string), v));
      else if (kind === 'h') a.push(packId(ix.human(v as string), v));
      else if (kind === 'n') a.push(r2(v));
      else if (kind === 'b') a.push(v === true ? 1 : 0);
      else if (kind === 'R')
        a.push(v !== null && typeof v === 'object' ? packRestart(v as Restart, ix) : null);
      else if (kind === 'i') a.push(v === undefined ? null : v);
      else a.push(Math.max(0, kind.indexOf(v as string)));
    }
    // Trailing nulls (absent optionals) need not travel
    while (a.length > 2 && a[a.length - 1] === null) a.pop();
    out.push(a);
  }
  return out;
}

const MAX_EVENTS = 128;

/** Wire form → events with their seq + tick. Malformed entries are skipped (seq kept). */
export function unpackEvents(raw: unknown, snapTick: number, cfg: MatchConfig): TimedEvent[] {
  if (!Array.isArray(raw) || typeof raw[0] !== 'number' || !Number.isInteger(raw[0])) return [];
  const ix = indexer(cfg);
  const first = raw[0];
  const out: TimedEvent[] = [];
  const items = raw.slice(1, 1 + MAX_EVENTS);
  items.forEach((a, k) => {
    if (!Array.isArray(a) || typeof a[0] !== 'number') return;
    const spec = EVENT_TYPES[a[0]];
    if (spec === undefined) return;
    const [type, fields] = spec;
    const e: Record<string, unknown> = { type };
    fields.forEach(([key, kind, optional], j) => {
      const v = a[j + 2] ?? null;
      if (v === null && optional === true) return;
      if (kind === 'p') e[key] = unpackId(v, ix.playerId);
      else if (kind === 'h') e[key] = unpackId(v, ix.humanId);
      else if (kind === 'n') e[key] = typeof v === 'number' ? v : 0;
      else if (kind === 'b') e[key] = v === 1 || v === true;
      else if (kind === 'R') e[key] = unpackRestart(v, ix);
      else if (kind === 'i') e[key] = v;
      else e[key] = kind[typeof v === 'number' ? v : 0] ?? kind[0];
    });
    // Required ids that came back null where the contract wants a string
    if (type === 'goal' && e.scorer === null) e.scorer = '';
    const dt = typeof a[1] === 'number' && a[1] >= 0 ? a[1] : 0;
    out.push({
      seq: first + k,
      tick: Math.max(0, snapTick - dt),
      ev: e as unknown as FootballEvent,
    });
  });
  return out;
}

// ── Pads ──

const stick = (v: unknown) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0;
const BUTTONS = [
  'sprint',
  'pass',
  'shoot',
  'lob',
  'through',
  'switchP',
  'finesse',
  'jockey',
] as const satisfies readonly (keyof PadInput)[];

/** Clamp what comes off the wire into a full PadInput. */
export function sanitizePad(p: Partial<PadInput> | undefined | null): PadInput {
  const o = (p ?? {}) as Partial<PadInput>;
  return {
    mx: stick(o.mx),
    mz: stick(o.mz),
    sprint: o.sprint === true,
    pass: o.pass === true,
    shoot: o.shoot === true,
    lob: o.lob === true,
    through: o.through === true,
    switchP: o.switchP === true,
    finesse: o.finesse === true,
    jockey: o.jockey === true,
    rx: stick(o.rx),
    rz: stick(o.rz),
  };
}

/** Sticks to 2 dp, false buttons dropped (sanitizePad restores them). */
export function compactPad(p: PadInput): PadInput {
  const o: Record<string, unknown> = {};
  for (const k of ['mx', 'mz', 'rx', 'rz'] as const) {
    const v = Math.round(stick(p[k]) * 100) / 100;
    if (v !== 0) o[k] = v;
  }
  for (const k of BUTTONS) if (p[k]) o[k] = true;
  return o as unknown as PadInput;
}

/** Buttons held in any of `pads` (a backed-up queue folded so no tap is lost). */
export function mergeButtons(into: PadInput, from: PadInput): PadInput {
  const o = { ...into };
  for (const k of BUTTONS) o[k] = into[k] || from[k];
  return o;
}

// ── Messages ──

const str = (v: unknown, max = 64): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= max;
const fin = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const team = (v: unknown): v is TeamId => v === 0 || v === 1;
const pair = (v: unknown): v is [number, number] =>
  Array.isArray(v) && v.length === 2 && fin(v[0]) && fin(v[1]);
const SIZES = new Set([5, 7, 11]);

/** Check a raw `football:*` message off the socket (null = drop it). */
export function readMsg(raw: unknown): FootballMsg | null {
  if (raw === null || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  if (typeof m.type !== 'string' || !m.type.startsWith('football:')) return null;
  if (!str(m.gid)) return null;
  switch (m.type) {
    case 'football:lobby':
      if (!str(m.host) || !SIZES.has(m.size as number) || !Array.isArray(m.players)) return null;
      if (
        !m.players.every(
          (p: unknown) =>
            p !== null &&
            typeof p === 'object' &&
            str((p as { id?: unknown }).id) &&
            team((p as { team?: unknown }).team),
        )
      )
        return null;
      return {
        type: 'football:lobby',
        gid: m.gid,
        host: m.host,
        hostName: typeof m.hostName === 'string' ? m.hostName.slice(0, 32) : 'noun',
        size: m.size as 5 | 7 | 11,
        live: m.live === true,
        score: pair(m.score) ? m.score : undefined,
        players: (m.players as { id: string; name?: unknown; team: TeamId }[])
          .slice(0, 22)
          .map(p => ({
            id: p.id,
            name: typeof p.name === 'string' ? p.name.slice(0, 32) : 'noun',
            team: p.team,
          })),
        open: m.open !== false,
      };
    case 'football:join':
      if (!str(m.from) || !str(m.to) || !team(m.team)) return null;
      return {
        type: 'football:join',
        gid: m.gid,
        from: m.from,
        to: m.to,
        name: typeof m.name === 'string' ? m.name.slice(0, 32) : 'noun',
        team: m.team,
        ...(m.leave === true ? { leave: true } : {}),
      };
    case 'football:challenge':
      if (!str(m.from) || !str(m.to) || !SIZES.has(m.size as number)) return null;
      return {
        type: 'football:challenge',
        gid: m.gid,
        from: m.from,
        to: m.to,
        size: m.size as 5 | 7 | 11,
        fromName: typeof m.fromName === 'string' ? m.fromName.slice(0, 32) : 'noun',
        ...(m.coop === true ? { coop: true } : {}),
      };
    case 'football:reply':
      if (!str(m.from) || !str(m.to)) return null;
      return {
        type: 'football:reply',
        gid: m.gid,
        from: m.from,
        to: m.to,
        accept: m.accept === true,
      };
    case 'football:start': {
      const c = m.config as Partial<MatchConfig> | undefined;
      if (!str(m.host) || c === null || typeof c !== 'object') return null;
      if (!SIZES.has(c.size as number) || !Array.isArray(c.players) || !Array.isArray(c.humans))
        return null;
      if (c.players.length > 64 || c.humans.length > 22) return null;
      if (!c.players.every(p => p !== null && typeof p === 'object' && str(p.id) && team(p.team)))
        return null;
      if (!c.humans.every(h => h !== null && typeof h === 'object' && str(h.id) && team(h.team)))
        return null;
      return {
        type: 'football:start',
        gid: m.gid,
        host: m.host,
        config: c as MatchConfig,
        ...(str(m.to) ? { to: m.to } : {}),
      };
    }
    case 'football:input':
      if (!str(m.id) || !fin(m.seq)) return null;
      return {
        type: 'football:input',
        gid: m.gid,
        id: m.id,
        seq: m.seq & 0xffff,
        pad: sanitizePad(m.pad as Partial<PadInput>),
      };
    case 'football:s':
      if (typeof m.d !== 'string' || m.d.length > 12000) return null;
      return {
        type: 'football:s',
        gid: m.gid,
        d: m.d,
        ...(Array.isArray(m.e) ? { e: m.e } : {}),
        ...(fin(m.a) ? { a: m.a } : {}),
      };
    case 'football:watch':
      if (!str(m.from)) return null;
      return { type: 'football:watch', gid: m.gid, from: m.from };
    case 'football:leave':
      if (!str(m.id)) return null;
      return { type: 'football:leave', gid: m.gid, id: m.id };
    case 'football:end': {
      if (!pair(m.score)) return null;
      const reasons = ['final', 'host_left', 'left', 'timeout'];
      return {
        type: 'football:end',
        gid: m.gid,
        winner: team(m.winner) ? m.winner : null,
        score: m.score,
        ...(pair(m.pens) ? { pens: m.pens } : {}),
        ...(reasons.includes(m.reason as string)
          ? { reason: m.reason as 'final' | 'host_left' | 'left' | 'timeout' }
          : {}),
      };
    }
    case 'football:ping':
      if (!str(m.from) || !fin(m.c)) return null;
      return { type: 'football:ping', gid: m.gid, from: m.from, c: m.c };
    case 'football:pong':
      if (!str(m.to) || !fin(m.c) || !fin(m.a)) return null;
      return { type: 'football:pong', gid: m.gid, to: m.to, c: m.c, a: m.a };
    default:
      return null;
  }
}
