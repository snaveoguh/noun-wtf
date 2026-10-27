// ── The `pk` key in the multiplayer pose blob ────────────────────────────
//
//   pk: [code, phase, side, amt]   only while a parkour pose is showing
//
// code = ANIM (contract.ts, append-only), phase 0..1 (3 dp), side ±1, amt
// 0..1 (2 dp). ~20 bytes. The relay passes the blob through untouched and
// older clients ignore the key (they see the plain clip, as before).

import { ANIM, ANIM_BY_CODE, type PkAnim } from '../contract';

const r = (v: number, k: number) => Math.round(v * k) / k;

export function encodePk(a: PkAnim): [number, number, number, number] | null {
  if (a.kind === 'none') return null;
  return [
    ANIM[a.kind],
    r(Math.min(1, Math.max(0, a.phase)), 1000),
    a.side,
    r(Math.min(1, Math.max(0, a.amt)), 100),
  ];
}

/** A blob's `pk` → the anim (null for missing / malformed / unknown codes). */
export function decodePk(v: unknown): PkAnim | null {
  if (!Array.isArray(v) || v.length < 4) return null;
  const [code, phase, side, amt] = v as unknown[];
  if (typeof code !== 'number' || !Number.isInteger(code)) return null;
  const kind = ANIM_BY_CODE[code];
  if (kind === undefined || kind === 'none') return null;
  if (typeof phase !== 'number' || !Number.isFinite(phase)) return null;
  if (typeof amt !== 'number' || !Number.isFinite(amt)) return null;
  return {
    kind,
    phase: Math.min(1, Math.max(0, phase)),
    side: side === -1 ? -1 : 1,
    amt: Math.min(1, Math.max(0, amt)),
  };
}

/** Cyclic anims (gait phases wrap), vs progress through a move. */
const CYCLIC = new Set<PkAnim['kind']>(['wallrun', 'wallup', 'climb', 'hang', 'pole', 'balance']);

/**
 * Smooths a remote rider's parkour phase between 15 Hz updates: advances it
 * at the rate the samples imply and eases toward each new sample.
 */
export class PkSmoother {
  anim: PkAnim | null = null;
  private rate = 0;
  private lastPhase = 0;
  private lastAt = 0;

  /** A sample arrived (or the same one again: ignored). */
  feed(a: PkAnim | null, now: number) {
    if (a === null) {
      this.anim = null;
      return;
    }
    const cur = this.anim;
    if (cur === null || cur.kind !== a.kind) {
      this.anim = { ...a };
      this.rate = 0;
      this.lastPhase = a.phase;
      this.lastAt = now;
      return;
    }
    if (a.phase === this.lastPhase && a.side === cur.side && a.amt === cur.amt) return;
    const dt = Math.max(0.03, (now - this.lastAt) / 1000);
    let dp = a.phase - this.lastPhase;
    if (CYCLIC.has(a.kind)) dp -= Math.round(dp);
    this.rate = dp / dt;
    this.lastPhase = a.phase;
    this.lastAt = now;
    cur.side = a.side;
    cur.amt = a.amt;
    // Ease toward the sample (wrapping for gaits)
    let d = a.phase - cur.phase;
    if (CYCLIC.has(a.kind)) d -= Math.round(d);
    cur.phase += d * 0.5;
  }

  step(dt: number) {
    const a = this.anim;
    if (a === null) return null;
    a.phase += this.rate * dt;
    a.phase = CYCLIC.has(a.kind)
      ? a.phase - Math.floor(a.phase)
      : Math.min(1, Math.max(0, a.phase));
    return a;
  }
}
