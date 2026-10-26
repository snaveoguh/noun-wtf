// Battle runners for tests, attract mode and the net layer's CPU-only cyphers.

import type { BattleConfig, BattleSim, BreakInput, CrewSize, Dancer, SimEvent } from '../contract';
import type { PlannedMove } from './planner';

import { type Clock, makeClock, timeOf } from './clock';
import { keyBeat, MOVES } from './moves';

/** A battle of CPU dancers; `skills[crew]` sets each crew's skill. */
export function cpuConfig(
  crewSize: CrewSize,
  seed: number,
  skills: [number, number] = [0.6, 0.6],
  extra: Partial<BattleConfig> = {},
): BattleConfig {
  const dancers: Dancer[] = [];
  for (const crew of [0, 1] as const) {
    for (let k = 0; k < crewSize; k++) {
      const n = crew * crewSize + k;
      dancers.push({
        id: `cpu:${n}`,
        name: `B-Noun ${n}`,
        crew,
        human: false,
        skill: skills[crew],
      });
    }
  }
  return { gid: `g${seed}`, seed, crewSize, dancers, rounds: 3, turnBars: 4, bpm: 96, ...extra };
}

/**
 * The key presses for a list of moves; `jitter(i)` (seconds) is added to the
 * i-th press, `swap(i)` can replace its key.
 */
export function inputsFor(
  plan: readonly PlannedMove[],
  id: string,
  bpmOrClock: number | Clock,
  jitter: (i: number) => number = () => 0,
  swap?: (i: number) => BreakInput['key'] | null,
): BreakInput[] {
  const clock = typeof bpmOrClock === 'number' ? makeClock(bpmOrClock) : bpmOrClock;
  const out: BreakInput[] = [];
  for (const pm of plan) {
    const m = MOVES[pm.move];
    m.pattern.forEach((key, k) => {
      const i = out.length;
      out.push({
        id,
        key: swap?.(i) ?? key,
        t: timeOf(clock, pm.start + keyBeat(m, k)) + jitter(i),
      });
    });
  }
  return out;
}

/** Run a battle to the end (fixed dt), returning every event. */
export function runBattle(sim: BattleSim, dt = 1 / 60, maxSeconds = 3600): SimEvent[] {
  const out: SimEvent[] = [];
  for (let t = 0; t < maxSeconds; t += dt) {
    out.push(...sim.step(dt));
    if (sim.state().phase === 'done') break;
  }
  return out;
}
