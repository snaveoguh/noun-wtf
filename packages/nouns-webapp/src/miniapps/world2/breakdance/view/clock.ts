// ── Noun Breaks view: beat clocks ───────────────────────────────────────
//
// The sim's beat arrives once per sim step (every frame for a local sim,
// ~20 Hz in snapshots from a host). The view runs its own beat clock at
// the battle's bpm, phase-locked to the sim's: smooth every frame, never
// more than a few ms off, and it snaps when the sim jumps (a new battle, a
// seek). MoveTracker turns a dancer's (move, moveT) samples into "beats
// into this move" on that clock, so animation lands on the beat even
// between snapshots.

import type { MoveId } from '../contract';

import { moveInfo } from './moves';

/** Phase-locked beat clock. */
export class BeatClock {
  beat = 0;
  bpm = 100;
  private primed = false;

  /** Advance by dt (s) and pull toward the sim's beat. Returns the view beat. */
  update(dt: number, simBeat: number, bpm: number): number {
    if (!Number.isFinite(simBeat)) return this.beat;
    if (Number.isFinite(bpm) && bpm > 0) this.bpm = bpm;
    if (!this.primed) {
      this.beat = simBeat;
      this.primed = true;
      return this.beat;
    }
    this.beat += (Math.max(0, dt) * this.bpm) / 60;
    const err = simBeat - this.beat;
    // A jump (new battle, a long stall): snap. Otherwise glide onto it.
    if (Math.abs(err) > 0.75) this.beat = simBeat;
    else this.beat += err * (1 - Math.exp(-8 * Math.max(0, dt)));
    return this.beat;
  }

  reset() {
    this.primed = false;
  }

  /** Seconds per beat. */
  get spb() {
    return 60 / this.bpm;
  }
}

export interface MoveSample {
  move: MoveId | null;
  /** Beats into the move on the view clock (not clamped: power moves keep spinning). */
  b: number;
  /** Move length (beats). */
  n: number;
  /** 0..1 through it. */
  t: number;
  /** Changes whenever a new move starts (even the same move again). */
  key: number;
  startBeat: number;
}

/** Per dancer: where it is in its current move, on the view's beat clock. */
export class MoveTracker {
  move: MoveId | null = null;
  key = 0;
  startBeat = 0;
  n = 4;
  private lastT = 0;
  private known = false;
  /** Rate estimate anchor (moveT, beat) when the sim doesn't send moveBeats. */
  private estT = 0;
  private estBeat = 0;

  /** Feed a sim sample (move, moveT, moveBeats?) taken at sim beat `simBeat`. */
  observe(move: MoveId | null, moveT: number, moveBeats: number | undefined, simBeat: number) {
    const t = Number.isFinite(moveT) ? Math.min(1, Math.max(0, moveT)) : 0;
    const restarted = move === this.move && move !== null && t + 0.25 < this.lastT;
    if (move !== this.move || restarted) {
      this.move = move;
      this.key++;
      this.known = moveBeats !== undefined && moveBeats > 0;
      this.n = this.known ? moveBeats! : defaultBeats(move);
      this.startBeat = simBeat - t * this.n;
      this.estT = t;
      this.estBeat = simBeat;
    } else if (move !== null) {
      if (moveBeats !== undefined && moveBeats > 0) {
        this.known = true;
        this.n = moveBeats;
      } else if (!this.known && t > this.estT + 0.08 && simBeat > this.estBeat) {
        // Estimate the length from moveT's rate (beats per whole move)
        const est = (simBeat - this.estBeat) / (t - this.estT);
        if (Number.isFinite(est) && est > 0.25 && est < 64) this.n += (est - this.n) * 0.5;
        this.estT = t;
        this.estBeat = simBeat;
      }
      // Keep the start locked to the sim (a little smoothing for snapshot jitter)
      const s = simBeat - t * this.n;
      const err = s - this.startBeat;
      this.startBeat += Math.abs(err) > 0.5 ? err : err * 0.25;
    }
    this.lastT = t;
  }

  /** Where the dancer is at view beat `beat`. */
  sample(beat: number): MoveSample {
    const b = Math.max(0, beat - this.startBeat);
    return {
      move: this.move,
      b,
      n: this.n,
      t: Math.min(1, b / Math.max(this.n, 1e-3)),
      key: this.key,
      startBeat: this.startBeat,
    };
  }
}

export function defaultBeats(move: MoveId | null): number {
  if (move === null) return 4;
  return moveInfo(move)?.beats ?? 4;
}

/** Beats → seconds on the audio clock: when beat `beat` sounds, given an anchor. */
export function beatTime(anchorTime: number, anchorBeat: number, beat: number, spb: number) {
  return anchorTime + (beat - anchorBeat) * spb;
}
