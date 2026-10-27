// ── Door timing: open, climb in, close (pure) ──────────────────────────────
//
// Getting in:  doors swing open (OPEN_S), the rider is in at the end of it,
//              then they close behind them (CLOSE_S) while you can already
//              drive (the scissor doors come down as you pull away).
// Getting out: doors open, the rider steps out once they're open, then they
//              close again after a beat (HOLD_S).
// `DoorAnim` is the per-car state; `doorAngle` maps 0..1 to each kind's
// hinge angle (radians) with an ease, so models just set one rotation.

import type { DoorKind } from './specs';

export const OPEN_S = 0.55;
export const CLOSE_S = 0.6;
/** Getting out: how long the doors stay up once you're out. */
export const HOLD_S = 0.9;

/** Fully-open hinge angle per kind (rad). */
export const DOOR_OPEN: Record<DoorKind, number> = {
  scissor: 1.25, // ~72°, straight up the A-pillar
  swing: 1.05, // ~60° out
  front: 1.3, // the bubble car's nose, up and over
  none: 0,
};

export type DoorPhase = 'shut' | 'opening' | 'open' | 'closing';

export class DoorAnim {
  /** 0 = shut, 1 = open. */
  k = 0;
  phase: DoorPhase = 'shut';
  private hold = 0;

  constructor(readonly kind: DoorKind) {}

  get angle(): number {
    return doorAngle(this.kind, this.k);
  }

  /** Swing them open and keep them open until close(). */
  open() {
    if (this.kind === 'none') return;
    this.phase = 'opening';
    this.hold = Infinity;
  }

  /** Open, wait `hold` seconds once open, then close by themselves. */
  openThenClose(hold = HOLD_S) {
    if (this.kind === 'none') return;
    this.phase = 'opening';
    this.hold = hold;
  }

  close() {
    if (this.kind === 'none' || this.phase === 'shut') return;
    this.phase = 'closing';
  }

  get shut(): boolean {
    return this.phase === 'shut';
  }

  /** Is the doorway open enough to step through? */
  get passable(): boolean {
    return this.kind === 'none' || this.k >= 0.85;
  }

  /** Advance; returns true while anything is still moving (worth a matrix update). */
  step(dt: number): boolean {
    switch (this.phase) {
      case 'opening':
        this.k = Math.min(1, this.k + dt / OPEN_S);
        if (this.k >= 1) this.phase = 'open';
        return true;
      case 'open':
        if (this.hold !== Infinity) {
          this.hold -= dt;
          if (this.hold <= 0) this.phase = 'closing';
        }
        return false;
      case 'closing':
        this.k = Math.max(0, this.k - dt / CLOSE_S);
        if (this.k <= 0) this.phase = 'shut';
        return true;
      default:
        return false;
    }
  }
}

/** Eased hinge angle for a 0..1 door position (a soft start, a little settle). */
export function doorAngle(kind: DoorKind, k: number): number {
  const t = Math.max(0, Math.min(1, k));
  const e = t * t * (3 - 2 * t);
  return DOOR_OPEN[kind] * e;
}

/**
 * Getting in: how long before you can drive (the rider is in once the
 * doors are open; no doors, a quick hop over the side).
 */
export function enterDelay(kind: DoorKind): number {
  return kind === 'none' ? 0.25 : OPEN_S;
}
