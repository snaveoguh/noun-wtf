// Test helpers: scripted human battles.

import type { BattleConfig, BreakInput, MoveId, SimEvent } from '../contract';
import type { PlannedMove } from './planner';

import { BreakBattle } from './BattleSim';
import { buildSchedule } from './clock';
import { inputsFor, runBattle } from './harness';
import { rand } from './rng';

export const BPM = 96;

/** Two humans, h0 (crew 0) and h1 (crew 1). */
export function duelConfig(rounds = 1, extra: Partial<BattleConfig> = {}): BattleConfig {
  return {
    gid: 'duel',
    seed: 1,
    crewSize: 1,
    rounds,
    turnBars: 4,
    bpm: BPM,
    dancers: [
      { id: 'h0', name: 'Zero', crew: 0, human: true },
      { id: 'h1', name: 'One', crew: 1, human: true },
    ],
    ...extra,
  };
}

/** Moves at beats relative to the turn's first beat. */
export function seq(...moves: [MoveId, number][]): PlannedMove[] {
  return moves.map(([move, start]) => ({ move, start }));
}

export function shift(plan: readonly PlannedMove[], by: number): PlannedMove[] {
  return plan.map(p => ({ move: p.move, start: p.start + by }));
}

/**
 * Script: per dancer, one plan per turn they take (in order). Optional
 * jitter / key swaps per dancer.
 */
export interface Script {
  [id: string]: {
    turns: PlannedMove[][];
    jitter?: (i: number) => number;
    swap?: (i: number) => BreakInput['key'] | null;
  };
}

export function scriptInputs(config: BattleConfig, script: Script): BreakInput[] {
  const sched = buildSchedule(config);
  const out: BreakInput[] = [];
  for (const [id, s] of Object.entries(script)) {
    const mine = sched.turns.filter(t => t.id === id);
    s.turns.forEach((plan, k) => {
      if (k >= mine.length) return;
      const slot = mine[k];
      out.push(...inputsFor(shift(plan, slot.from), id, config.bpm, s.jitter, s.swap));
    });
  }
  return out;
}

export function playScript(config: BattleConfig, script: Script, dt = 1 / 60) {
  const sim = new BreakBattle(config);
  for (const i of scriptInputs(config, script)) sim.input(i);
  const events = runBattle(sim, dt);
  return { sim, events, state: sim.state() };
}

/** A seeded button masher for `id` over the whole battle. */
export function masher(id: string, seed: number, seconds: number, rate = 3): BreakInput[] {
  const h = { rng: seed };
  const keys = ['up', 'down', 'left', 'right', 'a', 'b'] as const;
  const out: BreakInput[] = [];
  for (let t = 0; t < seconds; t += (0.5 + rand(h)) / rate) {
    out.push({ id, key: keys[Math.floor(rand(h) * 6) % 6], t });
  }
  return out;
}

export function recordOf(sim: BreakBattle, id: string, round = 0) {
  const r = sim.records().find(x => x.id === id && x.round === round);
  if (!r || !r.cats) throw new Error(`no record for ${id} round ${round}`);
  return r as typeof r & { cats: NonNullable<typeof r.cats> };
}

export function eventsOf<K extends SimEvent['e']>(
  ev: readonly SimEvent[],
  e: K,
): Extract<SimEvent, { e: K }>[] {
  return ev.filter((x): x is Extract<SimEvent, { e: K }> => x.e === e);
}

/** Every number in a value (deep). */
export function numbers(v: unknown, out: number[] = []): number[] {
  if (typeof v === 'number') out.push(v);
  else if (Array.isArray(v)) v.forEach(x => numbers(x, out));
  else if (typeof v === 'object' && v !== null) Object.values(v).forEach(x => numbers(x, out));
  return out;
}

/** A full, flowing 16-beat set: toprock, drop, footwork, windmill, flare, baby freeze held on the last beat. */
export const SET_A = seq(
  ['indian_step', 0],
  ['drop', 4],
  ['three_step', 6],
  ['windmill', 8],
  ['flare', 12],
  ['baby_freeze', 14],
);

/** Another 16-beat set with no move in common with SET_A (bar the way down). */
export const SET_B = seq(
  ['cross_step', 0],
  ['spin_down', 4],
  ['kick_out', 6],
  ['swipe', 9],
  ['chair_freeze', 13],
);
