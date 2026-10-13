// Test helpers: all-human games we can stage exactly (only used by specs).

import type { SimInternal } from './types';

import {
  type Baller,
  type BallerInput,
  type GameConfig,
  JERSEY_COURT,
  MODE_DEFAULTS,
  NO_INPUT,
  SHOT_SWEET,
  SIM_DT,
  type SimEvent,
  type SimState,
  type TeamSize,
} from '../contract';

import { HOOPS, HoopsSim } from './HoopsSim';

export const RIM_Z = JERSEY_COURT.length / 2 - JERSEY_COURT.rimFromBaseline;

/** A game of humans only (nobody moves unless told to). Ids: a0, a1… (team 0), b0, b1… (team 1). */
export function humanGame(
  size: TeamSize = 1,
  over: Partial<GameConfig> = {},
  ratings: Record<string, Baller['ratings']> = {},
): HoopsSim {
  const players: Baller[] = [];
  for (const team of [0, 1] as const) {
    for (let k = 0; k < size; k++) {
      const id = `${team === 0 ? 'a' : 'b'}${k}`;
      players.push({ id, team, bot: false, name: id, seedKey: id, ratings: ratings[id] });
    }
  }
  return new HoopsSim({ ...MODE_DEFAULTS[size], seed: 42, court: JERSEY_COURT, players, ...over });
}

export interface Stage {
  holder: string;
  at: [number, number];
  /** Everyone else's spot (default: far away in the backcourt corners). */
  others?: Record<string, [number, number]>;
  score?: [number, number];
  cleared?: boolean;
}

/** Skip to live play and stage a possession exactly. */
export function stage(sim: HoopsSim, st: Stage): void {
  for (let i = 0; i < 600 && sim.live.phase !== 'live'; i++) sim.step({});
  const s: SimState = sim.state();
  const I = s.sim as SimInternal;
  const holder = s.players.find(p => p.id === st.holder);
  if (holder === undefined) throw new Error(`no ${st.holder}`);
  s.phase = 'live';
  s.offense = holder.team;
  s.shotClock = sim.config.shotClock;
  if (st.score !== undefined) s.score = [...st.score];
  s.ball.state = 'held';
  s.ball.holder = holder.id;
  s.ball.shooter = null;
  I.cleared = st.cleared ?? true;
  I.shot = null;
  I.pass = null;
  I.holdBy = holder.id;
  I.heldT = 0;
  let far = 0;
  for (const p of s.players) {
    const q = I.players.find(x => x.id === p.id);
    if (q !== undefined) {
      q.act = 'idle';
      q.dur = 0;
      q.jdur = 0;
      q.btn = 0;
    }
    p.vx = 0;
    p.vz = 0;
    p.y = 0;
    if (p.id === holder.id) {
      [p.x, p.z] = st.at;
    } else if (st.others?.[p.id] !== undefined) {
      [p.x, p.z] = st.others[p.id];
    } else {
      p.x = far % 2 === 0 ? -11 : 11;
      p.z = 0.5 + Math.floor(far / 2);
      far++;
    }
    p.yaw = Math.atan2(-p.x, RIM_Z - p.z);
  }
  sim.load(s);
}

/** Inputs for everyone (humans): `id` gets `inp`, the rest stand still. */
export function only(
  sim: HoopsSim,
  id: string,
  inp: Partial<BallerInput>,
): Record<string, BallerInput> {
  const out: Record<string, BallerInput> = {};
  for (const p of sim.config.players) out[p.id] = p.id === id ? { ...NO_INPUT, ...inp } : NO_INPUT;
  return out;
}

/**
 * Hold shoot and release at `meter` (default: the sweet spot). Steps until
 * the possession ends or `maxSteps`; returns every event seen.
 */
export function shoot(sim: HoopsSim, id: string, meter = SHOT_SWEET, maxSteps = 400): SimEvent[] {
  const events: SimEvent[] = [];
  let first = true;
  for (let k = 0; k < maxSteps; k++) {
    const p = sim.live.players.find(x => x.id === id);
    const m = p?.meter ?? 0;
    const hold = first || (p?.action === 'gather' && m + SIM_DT / HOOPS.meterTime < meter);
    first = false;
    const s = sim.step(only(sim, id, { shoot: hold }));
    events.push(...s.events);
    if (s.phase !== 'live') break;
  }
  return events;
}

/** Step `n` times with the given inputs, collecting events. */
export function run(
  sim: HoopsSim,
  n: number,
  inputs: () => Record<string, BallerInput> = () => ({}),
): SimEvent[] {
  const events: SimEvent[] = [];
  for (let k = 0; k < n; k++) events.push(...sim.step(inputs()).events);
  return events;
}
