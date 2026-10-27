// ── Freestyle on the wire: the `fs` key of the multiplayer pose blob ─────
//
// Pure. While a rider freestyles their pose blob (net/Net.ts) carries
//
//   fs: [move, seq, b, n, bpm]
//
//   move  the move's index in WIRE_MOVES (append-only: never reorder it)
//   seq   the step counter (0..999), so a repeat of the same move restarts
//   b     beats into the move when the pose was sent (2 dp), the beat phase
//   n     the move's length on the pose grid (2 dp)
//   bpm   the tempo (whole bpm)
//
// e.g. `"fs":[9,41,1.25,4,95]` (a windmill), ~24 bytes on a ~300-byte pose, only while
// dancing (absent otherwise, so nothing changes for anyone else). The move
// id and seq only change when the move does; between changes the receiver
// just re-locks its own beat clock to `b`. Older clients ignore the key.

import type { MoveId } from '../contract';

/** Wire order. Append only: an index must mean the same move forever. */
export const WIRE_MOVES: readonly MoveId[] = [
  'indian_step',
  'salsa_rock',
  'cross_step',
  'kick_step',
  'six_step',
  'three_step',
  'cc',
  'pretzel',
  'kick_out',
  'windmill',
  'flare',
  'headspin',
  'backspin',
  'swipe',
  'turtle',
  'airflare',
  'baby_freeze',
  'chair_freeze',
  'headstand',
  'airchair',
  'hollowback',
  'drop',
  'spin_down',
  'get_up',
];

export type FsWire = [number, number, number, number, number];

export interface FsState {
  move: MoveId;
  seq: number;
  /** Beats into the move. */
  b: number;
  n: number;
  bpm: number;
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export const MAX_B = 64;

export function encodeFs(s: FsState): FsWire | null {
  const i = WIRE_MOVES.indexOf(s.move);
  if (i < 0) return null;
  return [
    i,
    ((Math.round(s.seq) % 1000) + 1000) % 1000,
    r2(clamp(Number.isFinite(s.b) ? s.b : 0, 0, MAX_B)),
    r2(clamp(Number.isFinite(s.n) ? s.n : 1, 0.25, 16)),
    Math.round(clamp(Number.isFinite(s.bpm) ? s.bpm : 95, 60, 200)),
  ];
}

/** A blob's `fs` → the dancer's state (null for missing or malformed). */
export function decodeFs(v: unknown): FsState | null {
  if (!Array.isArray(v) || v.length < 5) return null;
  const [i, seq, b, n, bpm] = v as unknown[];
  if (typeof i !== 'number' || !Number.isInteger(i)) return null;
  const move = WIRE_MOVES[i];
  if (move === undefined) return null;
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0 || seq > 999) return null;
  if (typeof b !== 'number' || !Number.isFinite(b) || b < 0 || b > MAX_B) return null;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0.25 || n > 16) return null;
  if (typeof bpm !== 'number' || !Number.isFinite(bpm) || bpm < 60 || bpm > 200) return null;
  return { move, seq, b, n, bpm };
}
