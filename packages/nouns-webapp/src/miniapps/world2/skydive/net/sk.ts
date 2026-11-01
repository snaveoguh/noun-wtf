// ── Skydiving on the wire: the `sk` key in the pose blob ─────────────────
//
// `sk: [phase, posture, open, steer]` only while skydiving: phase 1
// freefall / 2 canopy, posture 0 belly / 1 dive / 2 flare / 3 track, open
// 0..1 (the canopy), steer −1..1. Older clients ignore it (they see the
// fall clip); no worker change.

import type { Posture, SkyPhase } from '../contract';

export interface SkyAnim {
  phase: SkyPhase;
  posture: Posture;
  /** Canopy open (0..1). */
  open: number;
  /** Turn input (−1..1). */
  steer: number;
}

export const NO_SKY: SkyAnim = { phase: 'off', posture: 'belly', open: 0, steer: 0 };

const POSTURES: readonly Posture[] = ['belly', 'dive', 'flare', 'track'];
const r2 = (x: number) => Math.round(x * 100) / 100;

export function encodeSk(a: SkyAnim): [number, number, number, number] | null {
  if (a.phase === 'off') return null;
  return [
    a.phase === 'freefall' ? 1 : 2,
    Math.max(0, POSTURES.indexOf(a.posture)),
    r2(Math.max(0, Math.min(1, a.open))),
    r2(Math.max(-1, Math.min(1, a.steer))),
  ];
}

export function decodeSk(v: unknown): SkyAnim | null {
  if (!Array.isArray(v) || v.length < 4) return null;
  const [ph, po, op, st] = v.map(Number);
  if (ph !== 1 && ph !== 2) return null;
  if (![po, op, st].every(Number.isFinite)) return null;
  return {
    phase: ph === 1 ? 'freefall' : 'canopy',
    posture: POSTURES[Math.max(0, Math.min(3, Math.round(po)))] ?? 'belly',
    open: Math.max(0, Math.min(1, op)),
    steer: Math.max(-1, Math.min(1, st)),
  };
}
