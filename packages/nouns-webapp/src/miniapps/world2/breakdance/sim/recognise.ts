// Move recognition: freestyle in, moves out.
//
// The dancer never picks a move. Their first key, snapped to the nearest
// beat, opens an attempt holding every move whose pattern starts with that
// key (and that fits in what's left of the turn). Each further key keeps
// the candidates whose next key it is, landing within the `ok` window of
// where that candidate wants it (full- and half-beat moves want it at
// different times, so timing tells them apart as well as keys). No pattern
// is a prefix of another, so the moment a candidate's pattern is complete
// it IS the move.
//
// Forgiveness: once a move is two keys in, it survives ONE slip (a wrong
// key near the right time, a key outside the window, or a key that never
// came), graded a miss, as long as the move's last key is hit cleanly.
// A key that fits a candidate cleanly always beats a slip (if your typo
// spells another move, that's the move you're doing).
//
// A key that fits nothing, or a candidate out of time and slips, ends the
// attempt; the sim decides what that costs.

import type { BreakKey, HitGrade, MoveFamily, MoveId, TimingWindows } from '../contract';

import { type Clock, GRADE_VALUE, gradeOffset, timeOf } from './clock';
import { canFlow, type FlowFrom, grid, keyBeat, MOVE_LIST, MOVES } from './moves';

export interface Candidate {
  move: MoveId;
  /** Grade of each key so far ('miss' = a slip). */
  grades: HitGrade[];
  slips: number;
}

export interface Attempt {
  /** Beat the first key landed on. */
  start: number;
  cands: Candidate[];
}

/** Slips a move survives. */
export const MAX_SLIPS = 1;

const RANK: Record<HitGrade, number> = { perfect: 3, great: 2, ok: 1, miss: 0 };

export function betterGrade(a: HitGrade, b: HitGrade): HitGrade {
  return RANK[a] >= RANK[b] ? a : b;
}

/** Open an attempt with a key at `beat`; null + 'miss' when it's off the beat. */
export function startAttempt(
  key: BreakKey,
  beat: number,
  clock: Clock,
  w: TimingWindows,
  turnTo: number,
): { grade: HitGrade; attempt: Attempt | null } {
  const start = Math.round(beat);
  const grade = gradeOffset((beat - start) * clock.spb, w);
  if (grade === 'miss') return { grade, attempt: null };
  const cands = MOVE_LIST.filter(m => m.pattern[0] === key && start + m.beats <= turnTo + 1e-9).map(
    (m): Candidate => ({ move: m.id, grades: [grade], slips: 0 }),
  );
  if (!cands.length) return { grade: 'miss', attempt: null };
  return { grade, attempt: { start, cands } };
}

/** Keys the attempt has got through (the furthest candidate). */
export function progress(a: Attempt): number {
  let p = 0;
  for (const c of a.cands) p = Math.max(p, c.grades.length);
  return p;
}

/** Beat a candidate wants its next key on. */
export function expectedBeat(a: Attempt, c: Candidate): number {
  return a.start + keyBeat(MOVES[c.move], c.grades.length);
}

/** Latest battle-clock time a candidate's next key can still land. */
export function deadline(a: Attempt, c: Candidate, clock: Clock, w: TimingWindows): number {
  return timeOf(clock, expectedBeat(a, c)) + w.ok;
}

export function nextDeadline(a: Attempt, clock: Clock, w: TimingWindows): number {
  let d = Infinity;
  for (const c of a.cands) d = Math.min(d, deadline(a, c, clock, w));
  return d;
}

function canSlip(c: Candidate): boolean {
  const len = MOVES[c.move].pattern.length;
  return c.slips < MAX_SLIPS && c.grades.length >= 2 && c.grades.length < len - 1;
}

function slip(c: Candidate): Candidate {
  return { move: c.move, grades: [...c.grades, 'miss'], slips: c.slips + 1 };
}

/**
 * Time `t` has come: candidates whose next key is overdue (deadline < t)
 * slip it if they can, else drop out. Returns false (leaving the attempt
 * untouched, for the sim to judge what was abandoned) when none survive.
 */
export function expire(a: Attempt, t: number, clock: Clock, w: TimingWindows): boolean {
  let cands = a.cands;
  for (let pass = 0; pass <= MAX_SLIPS + 1; pass++) {
    let changed = false;
    const next: Candidate[] = [];
    for (const c of cands) {
      if (deadline(a, c, clock, w) >= t) next.push(c);
      else {
        changed = true;
        if (canSlip(c)) next.push(slip(c));
      }
    }
    cands = next;
    if (!changed) break;
  }
  if (!cands.length) return false;
  a.cands = cands;
  return true;
}

/**
 * Feed the next key. Returns the grade it earned (null = it fits no
 * candidate; the attempt is left untouched) and the candidate it completed.
 */
export function advance(
  a: Attempt,
  key: BreakKey,
  beat: number,
  clock: Clock,
  w: TimingWindows,
): { grade: HitGrade | null; done: Candidate | null } {
  const clean: Candidate[] = [];
  const slipped: Candidate[] = [];
  let best: HitGrade | null = null;
  for (const c of a.cands) {
    const m = MOVES[c.move];
    const exp = expectedBeat(a, c);
    const g = gradeOffset((beat - exp) * clock.spb, w);
    if (m.pattern[c.grades.length] === key && g !== 'miss') {
      clean.push({ move: c.move, grades: [...c.grades, g], slips: c.slips });
      best = best ? betterGrade(best, g) : g;
    } else if (canSlip(c) && Math.abs(beat - exp) <= 0.5 * grid(m)) {
      slipped.push(slip(c));
    }
  }
  const keep = clean.length ? clean : slipped;
  if (!keep.length) return { grade: null, done: null };
  a.cands = keep;
  const done = keep.find(c => c.grades.length === MOVES[c.move].pattern.length) ?? null;
  return { grade: clean.length ? best : 'miss', done };
}

/**
 * The candidate to show (pose, prompts): the one the plan expects if it's
 * still alive, else the first that flows from where the dancer is, else the
 * first (table order, so the simplest).
 */
export function leading(a: Attempt, prev: FlowFrom, prefer?: MoveId | null): Candidate | null {
  if (!a.cands.length) return null;
  if (prefer) {
    const p = a.cands.find(c => c.move === prefer);
    if (p) return p;
  }
  return a.cands.find(c => canFlow(prev, MOVES[c.move])) ?? a.cands[0];
}

/**
 * Was the dancer committed to something dangerous? Two keys in, and every
 * move they could still have been doing is a power move or a freeze.
 */
export function committedFamily(a: Attempt): MoveFamily | null {
  if (progress(a) < 2 || !a.cands.length) return null;
  const fams = new Set(a.cands.map(c => MOVES[c.move].family));
  for (const f of fams) if (f !== 'power' && f !== 'freeze') return null;
  return MOVES[a.cands[0].move].family;
}

/** Mean grade value of a move's keys (its timing factor). */
export function timingFactor(grades: readonly HitGrade[]): number {
  if (!grades.length) return 0;
  return grades.reduce((s, g) => s + GRADE_VALUE[g], 0) / grades.length;
}
