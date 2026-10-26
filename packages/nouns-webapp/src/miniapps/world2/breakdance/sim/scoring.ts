// The judges. Each turn is boiled down to four category scores (0..10):
//
//   technique    timing: difficulty-weighted accuracy of every key in the
//                moves that landed, times how much of the turn was danced,
//                minus misses and crashes.
//   musicality   clean hits on downbeats, moves that start on the bar,
//                overall accuracy, and the big one: a freeze held on the
//                turn's last beat. Crashes cost.
//   originality  novelty of each move (fresh > bitten > repeated within the
//                turn > repeated from your own earlier turn; chaining the
//                same power move straight through is half-forgiven), with
//                at least four moves needed for full marks, plus a bonus
//                for mixing families. Transitions don't count either way.
//   power        power moves and air freezes, by difficulty and how clean
//                they were.
//
// A round's category scores per crew are the mean of its dancers' turns.
// Three judges with their own taste weigh the four and vote for a crew;
// the card is those votes plus the shared category scores. Totals are
// votes; the winner has more, then more points (all categories summed over
// all rounds), else it's a tie.

import type { CrewId, HitGrade, JudgeCard, MoveId } from '../contract';

import { GRADE_VALUE, isDownbeat } from './clock';
import { keyBeat, MOVES } from './moves';
import { rand, type RngHolder } from './rng';

export interface LandedMove {
  move: MoveId;
  start: number;
  grades: HitGrade[];
  /** 0..1, how fresh the move was when it landed. */
  novelty: number;
  points: number;
}

export interface TurnRecord {
  id: string;
  crew: CrewId;
  round: number;
  from: number;
  to: number;
  landed: LandedMove[];
  misses: number;
  crashes: number;
  /** Live points (the HUD's turn score). */
  score: number;
  maxCombo: number;
  cats?: Categories;
}

export interface Categories {
  technique: number;
  musicality: number;
  originality: number;
  power: number;
}

export interface Judge {
  name: string;
  /** Weights for technique, musicality, originality, power. */
  taste: [number, number, number, number];
}

export const JUDGES: readonly Judge[] = [
  { name: 'The Technician', taste: [1.35, 1.0, 0.9, 0.75] },
  { name: 'The Musician', taste: [0.95, 1.4, 1.0, 0.65] },
  { name: 'The Power Head', taste: [0.8, 0.8, 1.0, 1.4] },
];

function clamp10(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.round(Math.min(10, Math.max(0, v)) * 100) / 100;
}

const GOOD = (g: HitGrade) => g === 'perfect' || g === 'great';

/** Did this freeze's hold land on the turn's last beat? */
export function lastBeatFreeze(l: LandedMove, to: number): boolean {
  const m = MOVES[l.move];
  return m.family === 'freeze' && l.start + keyBeat(m, m.pattern.length - 1) === to - 1;
}

/** Freshness of a move as it lands. */
export function novelty(
  move: MoveId,
  inTurn: readonly MoveId[],
  ownEarlier: ReadonlySet<MoveId> | undefined,
  seen: ReadonlySet<MoveId>,
): number {
  const m = MOVES[move];
  if (m.family === 'transition') return 1;
  let n = 1;
  if (seen.has(move)) n = 0.75;
  if (ownEarlier?.has(move) === true) n = 0.3;
  if (inTurn.includes(move)) {
    const chained = inTurn[inTurn.length - 1] === move && m.family === 'power';
    n = Math.min(n, chained ? 0.6 : 0.25);
  }
  return n;
}

export function turnCategories(rec: TurnRecord): Categories {
  const turnBeats = Math.max(1, rec.to - rec.from);
  let wSum = 0;
  let accSum = 0;
  let beats = 0;
  let dbHits = 0;
  let onBar = 0;
  let counted = 0;
  let power = 0;
  let freezeBonus = 0;
  let downFreezes = 0;
  const novel: number[] = [];
  const fams = new Set<string>();
  for (const l of rec.landed) {
    const m = MOVES[l.move];
    beats += m.beats;
    const tf = l.grades.reduce((s, g) => s + GRADE_VALUE[g], 0) / Math.max(1, l.grades.length);
    l.grades.forEach((g, i) => {
      wSum += m.difficulty;
      accSum += m.difficulty * GRADE_VALUE[g];
      const b = l.start + keyBeat(m, i);
      if (Number.isInteger(b) && isDownbeat(b) && GOOD(g)) dbHits++;
    });
    if (m.family !== 'transition') {
      counted++;
      if (isDownbeat(l.start)) onBar++;
      novel.push(l.novelty);
      fams.add(m.family);
    }
    if (m.family === 'power') power += (m.difficulty - 1) * tf;
    else if (m.family === 'freeze' && m.difficulty >= 3) power += (m.difficulty - 1.5) * tf * 0.8;
    else if (m.family === 'footwork' && m.difficulty >= 3) power += 0.4 * (m.difficulty - 2) * tf;
    if (m.family === 'freeze') {
      const hold = l.grades[l.grades.length - 1];
      if (lastBeatFreeze(l, rec.to)) freezeBonus = Math.max(freezeBonus, GOOD(hold) ? 2.5 : 1.5);
      else if (isDownbeat(l.start + keyBeat(m, m.pattern.length - 1)) && GOOD(hold)) downFreezes++;
    }
  }
  const acc = wSum > 0 ? accSum / wSum : 0;
  const cov = Math.min(1, beats / (0.8 * turnBeats));
  const technique = 10 * acc * cov - 0.6 * rec.misses - 1.5 * rec.crashes;
  const musicality =
    4 * Math.min(1, dbHits / (turnBeats / 4)) +
    1.5 * (counted ? onBar / counted : 0) +
    2 * acc * cov +
    freezeBonus +
    Math.min(1, 0.5 * downFreezes) -
    rec.crashes;
  const originality = novel.length
    ? (7 * novel.reduce((a, b) => a + b, 0)) / Math.max(4, novel.length) +
      Math.min(3, fams.size - 1)
    : 0;
  return {
    technique: clamp10(technique),
    musicality: clamp10(musicality),
    originality: clamp10(originality),
    power: clamp10(power - rec.crashes),
  };
}

export function catsTotal(c: Categories): number {
  return c.technique + c.musicality + c.originality + c.power;
}

function crewMean(recs: readonly TurnRecord[], crew: CrewId): Categories {
  const mine = recs.filter(r => r.crew === crew && r.cats !== undefined);
  const out: Categories = { technique: 0, musicality: 0, originality: 0, power: 0 };
  if (!mine.length) return out;
  for (const r of mine) {
    const c = r.cats as Categories;
    out.technique += c.technique / mine.length;
    out.musicality += c.musicality / mine.length;
    out.originality += c.originality / mine.length;
    out.power += c.power / mine.length;
  }
  return {
    technique: clamp10(out.technique),
    musicality: clamp10(out.musicality),
    originality: clamp10(out.originality),
    power: clamp10(out.power),
  };
}

/** Score a judge would give a crew. */
export function judgeScore(j: Judge, c: Categories): number {
  return (
    j.taste[0] * c.technique +
    j.taste[1] * c.musicality +
    j.taste[2] * c.originality +
    j.taste[3] * c.power
  );
}

/**
 * The round's card. Dead-even judges fall back to the crews' live points,
 * then a coin from the battle's rng.
 */
export function roundCard(
  recs: readonly TurnRecord[],
  rng: RngHolder,
): { card: JudgeCard; points: [number, number] } {
  const a = crewMean(recs, 0);
  const b = crewMean(recs, 1);
  const live = [0, 1].map(c => recs.filter(r => r.crew === c).reduce((s, r) => s + r.score, 0));
  const votes: CrewId[] = JUDGES.map(j => {
    const d = judgeScore(j, a) - judgeScore(j, b);
    if (Math.abs(d) > 1e-9) return d > 0 ? 0 : 1;
    if (live[0] !== live[1]) return live[0] > live[1] ? 0 : 1;
    return rand(rng) < 0.5 ? 0 : 1;
  });
  return {
    card: {
      votes,
      technique: [a.technique, b.technique],
      musicality: [a.musicality, b.musicality],
      originality: [a.originality, b.originality],
      power: [a.power, b.power],
    },
    points: [catsTotal(a), catsTotal(b)],
  };
}

export function decideWinner(
  totals: readonly [number, number],
  points: readonly [number, number],
): CrewId | 'tie' {
  if (totals[0] !== totals[1]) return totals[0] > totals[1] ? 0 : 1;
  if (Math.abs(points[0] - points[1]) > 1e-9) return points[0] > points[1] ? 0 : 1;
  return 'tie';
}
