// Planning a turn: which moves, on which beats. One planner serves two
// masters: the CPU dancers (weighted-random, from their skill) and the
// beginner coach behind SimState.prompts (deterministic, argmax).
//
// A plan fills the turn exactly and ends on a freeze whose hold lands on
// the turn's last beat. A small DP over (beats left, where you're coming
// from) says which choices can still finish that way, so the greedy pick
// never paints itself into a corner.

import type { BreakInput, BreakKey, MoveId, MoveSpec, TimingWindows } from '../contract';

import { type Clock, timeOf } from './clock';
import { canFlow, type FlowFrom, isPowerish, keyBeat, MOVE_LIST, MOVES } from './moves';
import { gauss, rand, type RngHolder } from './rng';

export interface PlannedMove {
  move: MoveId;
  /** Beat the move's first key lands on. */
  start: number;
}

export interface PlanOpts {
  /** 0..1: how hard the moves are (target difficulty 1 + 4 × ambition). */
  ambition: number;
  /** Weight multiplier per earlier use of a move (lower = more variety). */
  variety: number;
  /** ≥ 1: extra weight for power moves and air freezes (answering back). */
  powerBias: number;
  /** Chance of a one-beat pause between moves (sloppy CPUs). */
  gapChance: number;
  /** null = pick the best option every time (the coach). */
  rng: RngHolder | null;
  /** How often this dancer already threw each move in earlier turns. */
  used?: ReadonlyMap<MoveId, number>;
  /** Moves anyone has already shown this battle (biting is frowned on). */
  seen?: ReadonlySet<MoveId>;
}

const MAX_BEATS = 64;
const STATES = MOVE_LIST.length + 2;

function stateIndex(f: FlowFrom): number {
  if (f === null) return 0;
  if (f === 'any') return 1;
  return 2 + MOVE_INDEX[f];
}

const MOVE_INDEX = Object.fromEntries(MOVE_LIST.map((m, i) => [m.id, i])) as Record<MoveId, number>;
const STATE_FROM: FlowFrom[] = [null, 'any', ...MOVE_LIST.map(m => m.id)];

let reachTable: boolean[][] | null = null;

/** reach[r][s]: from state s, r beats can be filled exactly, ending on a freeze. */
function reach(): boolean[][] {
  if (reachTable) return reachTable;
  const t: boolean[][] = [];
  for (let r = 0; r <= MAX_BEATS; r++) {
    const row: boolean[] = [];
    for (let s = 0; s < STATES; s++) {
      let ok = false;
      for (const m of MOVE_LIST) {
        if (m.beats > r || !canFlow(STATE_FROM[s], m)) continue;
        if (m.beats === r ? m.family === 'freeze' : t[r - m.beats][2 + MOVE_INDEX[m.id]]) {
          ok = true;
          break;
        }
      }
      row.push(ok);
    }
    t.push(row);
  }
  reachTable = t;
  return t;
}

/** Can `beats` beats starting from `from` be filled, ending on a freeze? */
export function canFinish(beats: number, from: FlowFrom): boolean {
  if (beats < 0 || beats > MAX_BEATS) return false;
  return reach()[beats][stateIndex(from)];
}

function weight(
  m: MoveSpec,
  o: PlanOpts,
  frac: number,
  prev: FlowFrom,
  inTurn: readonly MoveId[],
): number {
  const target = 1 + 4 * Math.min(1, Math.max(0, o.ambition));
  let w = Math.exp(-((m.difficulty - target) ** 2) / 2) * (0.6 + m.points / 40);
  if (m.family === 'transition') {
    // go down once the toprock's had its bar
    const fromRock = prev !== null && prev !== 'any' && MOVES[prev].family === 'toprock';
    w *= fromRock && frac >= 0.2 ? 1.5 : 0.35;
    w *= o.variety ** (inTurn.filter(x => x === m.id).length * 0.5);
    return w;
  }
  if (m.family === 'toprock' && frac >= 0.25) w *= 0.3;
  const uses = (o.used?.get(m.id) ?? 0) + 2 * inTurn.filter(x => x === m.id).length;
  w *= o.variety ** uses;
  if (m.family === 'power') w *= o.powerBias;
  else if (isPowerish(m)) w *= 1 + (o.powerBias - 1) / 2;
  if (o.seen?.has(m.id) === true && (o.used?.get(m.id) ?? 0) === 0) w *= 0.8;
  return w;
}

function pick(list: MoveSpec[], ws: number[], rng: RngHolder | null): MoveSpec {
  if (!rng) {
    let best = 0;
    for (let i = 1; i < list.length; i++) if (ws[i] > ws[best] + 1e-12) best = i;
    return list[best];
  }
  const sum = ws.reduce((a, b) => a + b, 0);
  let x = rand(rng) * sum;
  for (let i = 0; i < list.length; i++) {
    x -= ws[i];
    if (x <= 0) return list[i];
  }
  return list[list.length - 1];
}

/**
 * Plan the beats [from, to): moves back to back from `prev`, ending on a
 * freeze held on beat to - 1 whenever that's still possible.
 */
export function planTurn(from: number, to: number, prev: FlowFrom, o: PlanOpts): PlannedMove[] {
  const out: PlannedMove[] = [];
  const inTurn: MoveId[] = [];
  const len = Math.max(1, to - from);
  let s = Math.ceil(from);
  let p = prev;
  for (let guard = 0; s < to && guard < 200; guard++) {
    const r = to - s;
    if (
      o.rng &&
      o.gapChance > 0 &&
      out.length > 0 &&
      rand(o.rng) < o.gapChance &&
      canFinish(r - 1, p)
    ) {
      s += 1;
      continue;
    }
    const finishing = canFinish(r, p);
    let list = MOVE_LIST.filter(
      m =>
        m.beats <= r &&
        canFlow(p, m) &&
        (!finishing || (m.beats === r ? m.family === 'freeze' : canFinish(r - m.beats, m.id))),
    );
    if (!list.length) list = MOVE_LIST.filter(m => m.beats <= r && canFlow(p, m));
    if (!list.length) {
      s += 1; // nothing fits: vibe a beat
      continue;
    }
    const frac = (s - from) / len;
    const ws = list.map(m => weight(m, o, frac, p, inTurn));
    const m = pick(list, ws, o.rng);
    out.push({ move: m.id, start: s });
    inTurn.push(m.id);
    s += m.beats;
    p = m.id;
  }
  return out;
}

/** The beginner coach's taste: mid-difficulty, varied, no randomness. */
export function coachOpts(
  used?: ReadonlyMap<MoveId, number>,
  seen?: ReadonlySet<MoveId>,
): PlanOpts {
  return { ambition: 0.45, variety: 0.25, powerBias: 1, gapChance: 0, rng: null, used, seen };
}

/**
 * A CPU dancer's taste from its skill. `answer` (0..1) is how much power the
 * other crew just threw: they go bigger to answer it.
 */
export function cpuOpts(
  skill: number,
  answer: number,
  rng: RngHolder,
  used?: ReadonlyMap<MoveId, number>,
  seen?: ReadonlySet<MoveId>,
): PlanOpts {
  const s = Math.min(1, Math.max(0, skill));
  const a = Math.min(1, Math.max(0, answer));
  return {
    ambition: Math.min(1, 0.1 + 0.75 * s + 0.3 * a),
    variety: 0.2 + 0.55 * (1 - s),
    powerBias: 1 + 2 * a,
    gapChance: 0.25 * (1 - s),
    rng,
    used,
    seen,
  };
}

const KEYS: readonly BreakKey[] = ['up', 'down', 'left', 'right', 'a', 'b'];

/**
 * Turn a plan into the key presses a CPU dancer of `skill` actually hits:
 * timing spread, the odd wrong or skipped key, all worse on harder moves.
 */
export function cpuInputs(
  plan: readonly PlannedMove[],
  id: string,
  skill: number,
  clock: Clock,
  w: TimingWindows,
  rng: RngHolder,
): BreakInput[] {
  const s = Math.min(1, Math.max(0, skill));
  const sloppy = 1 - s;
  const out: BreakInput[] = [];
  const maxErr = 0.45 * clock.spb;
  for (const pm of plan) {
    const m = MOVES[pm.move];
    const sigma = w.perfect * 0.25 + sloppy * w.ok * 0.6 + (m.difficulty - 1) * 0.008 * sloppy;
    const pSkip = sloppy ** 1.5 * 0.025 * m.difficulty;
    const pWrong = sloppy ** 1.5 * 0.035 * m.difficulty;
    for (let i = 0; i < m.pattern.length; i++) {
      const beat = pm.start + keyBeat(m, i);
      if (rand(rng) < pSkip) continue;
      let key = m.pattern[i];
      if (rand(rng) < pWrong) {
        const others = KEYS.filter(k => k !== key);
        key = others[Math.floor(rand(rng) * others.length) % others.length];
      }
      const err = Math.max(-maxErr, Math.min(maxErr, gauss(rng) * sigma));
      out.push({ id, key, t: timeOf(clock, beat) + err });
    }
  }
  return out;
}
