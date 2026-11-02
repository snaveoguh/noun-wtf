// ── Surfing on the wire: the `sf` key in the pose blob ───────────────────
//
// `sf: [phase, board, lean, crouch, stroke, sit, t]` only while in the sea
// (wading, swimming, surfing): phase 1 wade … 8 wipeout, board 0 none /
// 1 foamie / 2 longboard / 3 shortboard, lean −1..1, crouch 0..1, stroke
// (the paddling / swimming cycle, rad, wrapped), sit 0..1, t = seconds in
// the phase (the pop and the tumble). Older clients ignore it (they see a
// walking Noun on the water); no worker change.

import type { BoardId } from '../surf/boards';
import type { WaterPhase } from '../surf/sim';

export interface SurfAnim {
  phase: WaterPhase;
  board: BoardId | null;
  lean: number;
  crouch: number;
  stroke: number;
  sit: number;
  t: number;
}

export const NO_SURF: SurfAnim = {
  phase: 'off',
  board: null,
  lean: 0,
  crouch: 0,
  stroke: 0,
  sit: 0,
  t: 0,
};

/** Wire order (append-only). */
export const WIRE_PHASES: readonly WaterPhase[] = [
  'off',
  'wade',
  'swim',
  'paddle',
  'duck',
  'pop',
  'ride',
  'air',
  'wipeout',
];
const WIRE_BOARDS: readonly (BoardId | null)[] = [null, 'foamie', 'longboard', 'shortboard'];

const r2 = (x: number) => Math.round(x * 100) / 100;
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const TAU = Math.PI * 2;

export function encodeSf(a: SurfAnim): number[] | null {
  if (a.phase === 'off') return null;
  return [
    WIRE_PHASES.indexOf(a.phase),
    Math.max(0, WIRE_BOARDS.indexOf(a.board)),
    r2(clamp(a.lean, -1, 1)),
    r2(clamp(a.crouch, 0, 1)),
    r2(a.stroke - TAU * Math.floor(a.stroke / TAU)),
    r2(clamp(a.sit, 0, 1)),
    r2(clamp(a.t, 0, 60)),
  ];
}

export function decodeSf(v: unknown): SurfAnim | null {
  if (!Array.isArray(v) || v.length < 7) return null;
  const n = v.slice(0, 7).map(Number);
  if (!n.every(Number.isFinite)) return null;
  const ph = Math.round(n[0]);
  if (ph < 1 || ph >= WIRE_PHASES.length) return null;
  return {
    phase: WIRE_PHASES[ph],
    board: WIRE_BOARDS[clamp(Math.round(n[1]), 0, WIRE_BOARDS.length - 1)],
    lean: clamp(n[2], -1, 1),
    crouch: clamp(n[3], 0, 1),
    stroke: clamp(n[4], 0, TAU),
    sit: clamp(n[5], 0, 1),
    t: clamp(n[6], 0, 60),
  };
}
