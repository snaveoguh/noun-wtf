// ── The Big Drop's SSX course: the timed run (pure) ─────────────────────
//
// Ride off the summit pad through the START gate and the clock runs; pass
// every checkpoint gate (between its posts) and through the FINISH arch.
// Each checkpoint gives a split against your best run's. Miss a gate and
// the run's off (R takes you back to the top for another go); back on the
// pad, a fresh run is armed. Your best time and its splits stay on this
// device (stats are suspended on the Big Drop, so nothing goes to the
// server: like NOUN PARKOUR's local bests).

import { CHECKPOINTS, COURSE } from './courseSpec';

export type RunPhase = 'ready' | 'running' | 'finished' | 'missed';

export interface CourseBest {
  time: number;
  splits: number[];
  at: number;
}

export interface RunState {
  phase: RunPhase;
  /** Seconds since the START gate. */
  t: number;
  /** Index of the next checkpoint (CHECKPOINTS.length = the finish is next). */
  next: number;
  splits: number[];
  /** Track distance last frame. */
  lastS: number;
  best: CourseBest | null;
  /** The last split's difference from the best run's (s; NaN if none). */
  delta: number;
  /** Set on the finish: whether it beat the best. */
  newBest: boolean;
  /** Name of the gate that was missed. */
  missed: string;
}

export type RunEvent =
  | { type: 'start' }
  | { type: 'checkpoint'; index: number; t: number; delta: number }
  | { type: 'missed'; name: string }
  | { type: 'finish'; t: number; newBest: boolean; delta: number }
  | { type: 'reset' };

export function createRun(best: CourseBest | null): RunState {
  return {
    phase: 'ready',
    t: 0,
    next: 0,
    splits: [],
    lastS: -Infinity,
    best,
    delta: NaN,
    newBest: false,
    missed: '',
  };
}

/** Back above the START gate (a respawn, or riding back up): a fresh run. */
function reset(r: RunState) {
  r.phase = 'ready';
  r.t = 0;
  r.next = 0;
  r.splits = [];
  r.delta = NaN;
  r.newBest = false;
  r.missed = '';
}

/**
 * One frame: the rider is at track distance `s`. `through(gateS)` says
 * whether they're between a gate's posts as they cross it. Pushes what
 * happened into `out`.
 */
export function stepRun(
  r: RunState,
  dt: number,
  s: number,
  through: (gateS: number) => boolean,
  out: RunEvent[],
) {
  const prev = r.lastS;
  r.lastS = s;
  if (s < COURSE.start - 2 && r.phase !== 'ready') {
    reset(r);
    out.push({ type: 'reset' });
    return;
  }
  if (r.phase === 'ready') {
    if (
      prev < COURSE.start &&
      s >= COURSE.start &&
      s < COURSE.start + 200 &&
      through(COURSE.start)
    ) {
      r.phase = 'running';
      // The part of the frame spent past the line
      r.t = 0;
      out.push({ type: 'start' });
    }
    return;
  }
  if (r.phase !== 'running') return;
  r.t += dt;
  // Gates crossed this frame (a fast frame can cross more than one)
  while (true) {
    const isFinish = r.next >= CHECKPOINTS.length;
    const gs = isFinish ? COURSE.finish : CHECKPOINTS[r.next]!.s;
    if (!(prev < gs && s >= gs)) break;
    // Interpolate the crossing time inside the frame
    const k = s > prev ? (s - gs) / (s - prev) : 0;
    const at = Math.max(0, r.t - dt * k);
    if (!through(gs)) {
      r.phase = 'missed';
      r.missed = isFinish ? 'FINISH' : CHECKPOINTS[r.next]!.name;
      out.push({ type: 'missed', name: r.missed });
      return;
    }
    if (isFinish) {
      r.t = at;
      r.phase = 'finished';
      const b = r.best;
      r.delta = b !== null ? at - b.time : NaN;
      r.newBest = b === null || at < b.time;
      if (r.newBest) r.best = { time: at, splits: r.splits.slice(), at: Date.now() };
      out.push({ type: 'finish', t: at, newBest: r.newBest, delta: r.delta });
      return;
    }
    r.splits.push(at);
    const bs = r.best?.splits[r.next];
    r.delta = bs !== undefined ? at - bs : NaN;
    out.push({ type: 'checkpoint', index: r.next, t: at, delta: r.delta });
    r.next++;
  }
}

/** m:ss.cc */
export function formatTime(t: number): string {
  if (!Number.isFinite(t)) return '--:--.--';
  const cs = Math.max(0, Math.round(t * 100));
  const m = Math.floor(cs / 6000);
  const sec = Math.floor((cs % 6000) / 100);
  const c = cs % 100;
  return `${m}:${String(sec).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
}

/** +1.23 / −0.45 */
export function formatDelta(d: number): string {
  if (!Number.isFinite(d)) return '';
  return `${d < 0 ? '−' : '+'}${Math.abs(d).toFixed(2)}`;
}

// ── Your best (this device only) ────────────────────────────────────────

const KEY = 'noun-bigdrop-ssx-v1';

export function loadCourseBest(): CourseBest | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === null) return null;
    const v = JSON.parse(raw) as Partial<CourseBest>;
    if (typeof v.time !== 'number' || !Number.isFinite(v.time) || v.time <= 0) return null;
    const splits = Array.isArray(v.splits)
      ? v.splits.filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
      : [];
    return { time: v.time, splits, at: Number(v.at) || 0 };
  } catch {
    return null;
  }
}

export function saveCourseBest(b: CourseBest) {
  try {
    localStorage.setItem(KEY, JSON.stringify(b));
  } catch {
    // Full or blocked storage: the run still counts on screen
  }
}
