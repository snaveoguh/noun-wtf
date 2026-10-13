// ── Snapshot codec: SimState ↔ a small quantised binary (base64) ─────────
//
// Players are indexed by their order in GameConfig.players (every client has
// the config from `hoops:start`), so ids and teams never go on the wire.
//
//   header  15 B  tick u32, time ms u32, phase|offense u8, phaseT cs u16,
//                 score u8 ×2, shot clock cs u16
//   ball    18 B  pos cm i16 ×3, vel cm/s i16 ×3, spin ½rad/s i8 ×3,
//                 state|value u8, holder u8, shooter u8 (255 = none)
//   player  15 B  x, z cm i16, y 2cm u8, yaw u8, vx, vz dm/s i8, action u8,
//                 actionT u8, flags u8, meter u8, stamina u8, input ack u16
//
// 1v1 = 63 B (84 chars of base64), 3v3 = 123 B, 5v5 = 183 B. Events since
// the previous snapshot ride alongside as JSON with ids → player indices.

import type {
  BallerAction,
  BallState,
  GameConfig,
  GamePhase,
  SimEvent,
  SimState,
  TeamId,
} from '../contract';

export const ACTIONS: BallerAction[] = [
  'idle',
  'run',
  'dribble',
  'crossover',
  'spin',
  'gather',
  'jumpshot',
  'layup',
  'dunk',
  'alleyoop',
  'pass',
  'catch',
  'rebound',
  'block',
  'steal',
  'defend',
  'stumble',
  'celebrate',
  'dejected',
];
const PHASES: GamePhase[] = ['pregame', 'checkball', 'live', 'scored', 'turnover', 'final'];
const BALL: BallState[] = ['held', 'air', 'loose', 'dead'];

const HEADER = 15;
const BALL_B = 18;
const PLAYER_B = 15;

export function snapshotBytes(n: number) {
  return HEADER + BALL_B + n * PLAYER_B;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const i16 = (v: number) => clamp(Math.round(v), -32768, 32767);
const i8 = (v: number) => clamp(Math.round(v), -128, 127);
const u8 = (v: number) => clamp(Math.round(v), 0, 255);
const u16 = (v: number) => clamp(Math.round(v), 0, 65535);
const TAU = Math.PI * 2;

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

/** Encode a state; `acks[i]` = the last input seq applied for player i (humans). */
export function encodeState(s: SimState, cfg: GameConfig, acks: number[]): string {
  const n = cfg.players.length;
  const buf = new Uint8Array(snapshotBytes(n));
  const v = new DataView(buf.buffer);
  const index = indexer(cfg);
  let o = 0;
  v.setUint32(o, s.tick >>> 0, true);
  v.setUint32(o + 4, Math.max(0, Math.round(s.time * 1000)) >>> 0, true);
  v.setUint8(o + 8, (Math.max(0, PHASES.indexOf(s.phase)) & 7) | ((s.offense & 1) << 3));
  v.setUint16(o + 9, u16(s.phaseT * 100), true);
  v.setUint8(o + 11, u8(s.score[0]));
  v.setUint8(o + 12, u8(s.score[1]));
  v.setUint16(o + 13, u16(s.shotClock * 100), true);
  o = HEADER;
  const b = s.ball;
  v.setInt16(o, i16(b.x * 100), true);
  v.setInt16(o + 2, i16(b.y * 100), true);
  v.setInt16(o + 4, i16(b.z * 100), true);
  v.setInt16(o + 6, i16(b.vx * 100), true);
  v.setInt16(o + 8, i16(b.vy * 100), true);
  v.setInt16(o + 10, i16(b.vz * 100), true);
  v.setInt8(o + 12, i8(b.sx * 2));
  v.setInt8(o + 13, i8(b.sy * 2));
  v.setInt8(o + 14, i8(b.sz * 2));
  v.setUint8(o + 15, (Math.max(0, BALL.indexOf(b.state)) & 3) | ((clamp(b.value, 0, 3) & 3) << 2));
  v.setUint8(o + 16, b.holder === null ? 255 : index(b.holder));
  v.setUint8(o + 17, b.shooter === null ? 255 : index(b.shooter));
  o += BALL_B;
  const byId = new Map(s.players.map(p => [p.id, p]));
  for (let i = 0; i < n; i++, o += PLAYER_B) {
    const p = byId.get(cfg.players[i].id);
    if (!p) continue;
    v.setInt16(o, i16(p.x * 100), true);
    v.setInt16(o + 2, i16(p.z * 100), true);
    v.setUint8(o + 4, u8(p.y * 50));
    v.setUint8(o + 5, Math.round((((p.yaw % TAU) + TAU) % TAU) * (256 / TAU)) & 255);
    v.setInt8(o + 6, i8(p.vx * 10));
    v.setInt8(o + 7, i8(p.vz * 10));
    v.setUint8(o + 8, Math.max(0, ACTIONS.indexOf(p.action)));
    v.setUint8(o + 9, u8(p.actionT * 255));
    v.setUint8(o + 10, (p.hasBall ? 1 : 0) | (p.onFire ? 2 : 0) | (p.meter !== undefined ? 4 : 0));
    v.setUint8(o + 11, u8((p.meter ?? 0) * 255));
    v.setUint8(o + 12, u8(p.stamina * 255));
    v.setUint16(o + 13, (acks[i] ?? 0) & 0xffff, true);
  }
  return toB64(buf);
}

export interface Decoded {
  state: SimState;
  /** Per player index: last input seq the host applied (16-bit). */
  acks: number[];
}

export function decodeState(d: string, cfg: GameConfig): Decoded | null {
  const n = cfg.players.length;
  let buf: Uint8Array;
  try {
    buf = fromB64(d);
  } catch {
    return null;
  }
  if (buf.length !== snapshotBytes(n)) return null;
  const v = new DataView(buf.buffer);
  const ph = v.getUint8(8);
  const idAt = (k: number) => (k === 255 ? null : (cfg.players[k]?.id ?? null));
  let o = HEADER;
  const st = v.getUint8(o + 15);
  const state: SimState = {
    tick: v.getUint32(0, true),
    time: v.getUint32(4, true) / 1000,
    phase: PHASES[ph & 7] ?? 'live',
    offense: ((ph >> 3) & 1) as TeamId,
    phaseT: v.getUint16(9, true) / 100,
    score: [v.getUint8(11), v.getUint8(12)],
    shotClock: v.getUint16(13, true) / 100,
    ball: {
      x: v.getInt16(o, true) / 100,
      y: v.getInt16(o + 2, true) / 100,
      z: v.getInt16(o + 4, true) / 100,
      vx: v.getInt16(o + 6, true) / 100,
      vy: v.getInt16(o + 8, true) / 100,
      vz: v.getInt16(o + 10, true) / 100,
      sx: v.getInt8(o + 12) / 2,
      sy: v.getInt8(o + 13) / 2,
      sz: v.getInt8(o + 14) / 2,
      state: BALL[st & 3],
      value: (st >> 2) & 3,
      holder: idAt(v.getUint8(o + 16)),
      shooter: idAt(v.getUint8(o + 17)),
    },
    players: [],
    events: [],
  };
  const acks: number[] = [];
  o += BALL_B;
  for (let i = 0; i < n; i++, o += PLAYER_B) {
    const flags = v.getUint8(o + 10);
    const yaw = (v.getUint8(o + 5) * TAU) / 256;
    state.players.push({
      id: cfg.players[i].id,
      team: cfg.players[i].team,
      x: v.getInt16(o, true) / 100,
      z: v.getInt16(o + 2, true) / 100,
      y: v.getUint8(o + 4) / 50,
      yaw: yaw > Math.PI ? yaw - TAU : yaw,
      vx: v.getInt8(o + 6) / 10,
      vz: v.getInt8(o + 7) / 10,
      action: ACTIONS[v.getUint8(o + 8)] ?? 'idle',
      actionT: v.getUint8(o + 9) / 255,
      hasBall: (flags & 1) !== 0,
      onFire: (flags & 2) !== 0,
      meter: (flags & 4) !== 0 ? v.getUint8(o + 11) / 255 : undefined,
      stamina: v.getUint8(o + 12) / 255,
    });
    acks.push(v.getUint16(o + 13, true));
  }
  return { state, acks };
}

function indexer(cfg: GameConfig) {
  const m = new Map(cfg.players.map((p, i) => [p.id, i]));
  return (id: string) => m.get(id) ?? 255;
}

const ID_KEYS = ['id', 'from', 'to', 'on'] as const;

/** Events → wire form (player ids → indices, floats to 2 dp). */
export function packEvents(evs: SimEvent[], cfg: GameConfig): unknown[] {
  const index = indexer(cfg);
  return evs.map(e => {
    const o: Record<string, unknown> = { ...e };
    for (const k of ID_KEYS) if (typeof o[k] === 'string') o[k] = index(o[k] as string);
    for (const k of ['strength', 'quality'])
      if (typeof o[k] === 'number') o[k] = Math.round((o[k] as number) * 100) / 100;
    return o;
  });
}

export function unpackEvents(raw: unknown, cfg: GameConfig): SimEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: SimEvent[] = [];
  for (const r of raw.slice(0, 64)) {
    if (r === null || typeof r !== 'object' || typeof (r as { type?: unknown }).type !== 'string')
      continue;
    const o: Record<string, unknown> = { ...(r as Record<string, unknown>) };
    for (const k of ID_KEYS)
      if (typeof o[k] === 'number') o[k] = cfg.players[o[k] as number]?.id ?? '';
    out.push(o as unknown as SimEvent);
  }
  return out;
}
