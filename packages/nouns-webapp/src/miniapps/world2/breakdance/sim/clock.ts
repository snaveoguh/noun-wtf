// Beat clock + the battle's running order, all on the beat grid.
//
// Beat 0 is the first downbeat after a one-bar intro, so the battle clock
// (seconds since the battle began) and the beat are
//
//     beat = t * bpm / 60 - INTRO_BEATS
//
// The schedule is fixed by the config: intro bar, then per round each
// dancer's turn (alternating crews, the crew that opens swaps every round)
// with a bar of `between` after each turn, a judging stretch after the
// round's last turn, and a final stretch before `done`.

import type { BattleConfig, BattlePhase, CrewId, HitGrade, TimingWindows } from '../contract';

export const INTRO_BEATS = 4;
export const BETWEEN_BEATS = 4;
export const JUDGING_BEATS = 8;
export const FINAL_BEATS = 8;

export const MIN_BPM = 60;
export const MAX_BPM = 200;

export interface Clock {
  bpm: number;
  /** Seconds per beat. */
  spb: number;
}

export function makeClock(bpm: number): Clock {
  const b = Number.isFinite(bpm) ? Math.min(MAX_BPM, Math.max(MIN_BPM, bpm)) : 95;
  return { bpm: b, spb: 60 / b };
}

export function beatAt(c: Clock, t: number): number {
  return t / c.spb - INTRO_BEATS;
}

export function timeOf(c: Clock, beat: number): number {
  return (beat + INTRO_BEATS) * c.spb;
}

export function isDownbeat(beat: number): boolean {
  return ((Math.round(beat) % 4) + 4) % 4 === 0;
}

/** Grade an input `off` seconds from its target. */
export function gradeOffset(off: number, w: TimingWindows): HitGrade {
  const a = Math.abs(off);
  if (a <= w.perfect) return 'perfect';
  if (a <= w.great) return 'great';
  if (a <= w.ok) return 'ok';
  return 'miss';
}

/** How much a grade is worth (timing factor, technique). */
export const GRADE_VALUE: Record<HitGrade, number> = { perfect: 1, great: 0.8, ok: 0.5, miss: 0 };

export interface TurnSlot {
  /** Index into the battle's turn list. */
  idx: number;
  id: string;
  crew: CrewId;
  round: number;
  /** Index of this turn within its round. */
  k: number;
  from: number;
  to: number;
  /** Last turn of the round (judging follows). */
  last: boolean;
}

export interface Segment {
  phase: BattlePhase;
  from: number;
  to: number;
  round: number;
  /** For 'turn' segments. */
  turn?: number;
}

export interface Schedule {
  turns: TurnSlot[];
  segments: Segment[];
  /** Beat the battle is done. */
  doneAt: number;
  rounds: number;
  turnBeats: number;
}

/**
 * Turn order for one round: crews alternate, dancer by dancer in config
 * order; crew 0 opens even rounds, crew 1 odd ones (so nobody always gets
 * the last word). Uneven crews just run out early.
 */
export function roundOrder(config: BattleConfig, round: number): { id: string; crew: CrewId }[] {
  const first: CrewId = round % 2 === 0 ? 0 : 1;
  const second: CrewId = first === 0 ? 1 : 0;
  const a = config.dancers.filter(d => d.crew === first);
  const b = config.dancers.filter(d => d.crew === second);
  const out: { id: string; crew: CrewId }[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push({ id: a[i].id, crew: first });
    if (i < b.length) out.push({ id: b[i].id, crew: second });
  }
  return out;
}

export function intOr(v: unknown, fallback: number, lo: number, hi: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.min(hi, Math.max(lo, n));
}

export function buildSchedule(config: BattleConfig): Schedule {
  const rounds = intOr(config.rounds, 3, 1, 12);
  const turnBeats = intOr(config.turnBars, 4, 1, 16) * 4;
  const turns: TurnSlot[] = [];
  const segments: Segment[] = [{ phase: 'intro', from: -INTRO_BEATS, to: 0, round: 0 }];
  let b = 0;
  for (let r = 0; r < rounds; r++) {
    const order = roundOrder(config, r);
    order.forEach((o, k) => {
      const last = k === order.length - 1;
      const slot: TurnSlot = {
        idx: turns.length,
        id: o.id,
        crew: o.crew,
        round: r,
        k,
        from: b,
        to: b + turnBeats,
        last,
      };
      turns.push(slot);
      segments.push({ phase: 'turn', from: b, to: b + turnBeats, round: r, turn: slot.idx });
      b += turnBeats;
      if (!last) {
        segments.push({ phase: 'between', from: b, to: b + BETWEEN_BEATS, round: r });
        b += BETWEEN_BEATS;
      }
    });
    segments.push({ phase: 'judging', from: b, to: b + JUDGING_BEATS, round: r });
    b += JUDGING_BEATS;
  }
  segments.push({ phase: 'final', from: b, to: b + FINAL_BEATS, round: rounds - 1 });
  b += FINAL_BEATS;
  segments.push({ phase: 'done', from: b, to: Infinity, round: rounds - 1 });
  return { turns, segments, doneAt: b, rounds, turnBeats };
}
