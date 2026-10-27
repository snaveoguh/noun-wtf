// ── Freestyle: key patterns → moves ─────────────────────────────────────
//
// Pure. The battle's move table (sim/moves.ts MOVE_LIST: a windmill is
// ↓ ← ↑ →, a headspin ↑ → ↓ ←, …) read the way the sim's recogniser
// (sim/recognise.ts) reads it, minus the battle's strictness: the first key
// opens an attempt holding every move whose pattern starts with it, each
// further key keeps the ones it continues, and since no pattern is a prefix
// of another the first one completed IS the move. A key that continues
// nothing starts a fresh attempt from itself; a gap of more than MAX_GAP
// beats drops the attempt.
//
// Timing never decides anything here (there's no battle to lose), but it's
// graded against the beat with the sim's own windows, so a pattern played
// on the beat comes back `clean` (the HUD says "nice!").

import type { BreakKey, HitGrade, MoveId } from '../contract';

import { DEFAULT_WINDOWS } from '../contract';
import { gradeOffset } from '../sim/clock';
import { grid, MOVE_LIST, MOVES } from '../sim/moves';

/** Beats between keys before an attempt is dropped. */
export const MAX_GAP = 2;

export interface KeyedMove {
  move: MoveId;
  /** Every key landed within the sim's `ok` window of where the move wants it. */
  clean: boolean;
  grades: HitGrade[];
}

const startsWith = (pattern: readonly BreakKey[], keys: readonly BreakKey[]) =>
  keys.length <= pattern.length && keys.every((k, i) => pattern[i] === k);

/** Moves whose pattern starts with `keys`. */
export function candidates(keys: readonly BreakKey[]): MoveId[] {
  if (keys.length === 0) return [];
  return MOVE_LIST.filter(m => startsWith(m.pattern, keys)).map(m => m.id);
}

/** Grade each key of `move` (played at `beats`) against its place on the beat grid. */
export function gradeKeys(move: MoveId, beats: readonly number[], spb: number): HitGrade[] {
  const m = MOVES[move];
  const g = grid(m);
  // Anchor the pattern on the beat nearest its first key
  const start = Math.round(beats[0] ?? 0);
  return beats.map((b, i) => gradeOffset((b - (start + i * g)) * spb, DEFAULT_WINDOWS));
}

export class MoveKeys {
  private keys: BreakKey[] = [];
  private beats: number[] = [];

  /** Keys typed so far in the open attempt. */
  get pending(): readonly BreakKey[] {
    return this.keys;
  }

  /** Moves the open attempt could still become. */
  get open(): MoveId[] {
    return candidates(this.keys);
  }

  reset() {
    this.keys = [];
    this.beats = [];
  }

  /** Forget a stale attempt (call with the beat now). */
  expire(beat: number) {
    const last = this.beats.at(-1);
    if (last !== undefined && beat - last > MAX_GAP) this.reset();
  }

  /**
   * A key at `beat` (`spb` = seconds per beat, for grading). Returns the
   * move it completes, or null while the attempt is still open.
   */
  press(key: BreakKey, beat: number, spb: number): KeyedMove | null {
    this.expire(beat);
    let keys = [...this.keys, key];
    let beats = [...this.beats, beat];
    if (candidates(keys).length === 0) {
      keys = [key];
      beats = [beat];
    }
    const done = MOVE_LIST.find(
      m => m.pattern.length === keys.length && startsWith(m.pattern, keys),
    );
    if (done !== undefined) {
      this.reset();
      const grades = gradeKeys(done.id, beats, spb);
      return { move: done.id, grades, clean: grades.every(g => g !== 'miss') };
    }
    this.keys = keys;
    this.beats = beats;
    return null;
  }
}
