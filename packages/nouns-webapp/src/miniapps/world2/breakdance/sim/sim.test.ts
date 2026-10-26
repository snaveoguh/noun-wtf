// @vitest-environment node
// Determinism, turn order, phases, prompts, and battles always finishing clean.

import type { BattleConfig, BreakInput, CrewSize, SimEvent } from '../contract';

import { describe, expect, it } from 'vitest';

import { BreakBattle, createBattleSim } from './BattleSim';
import { beatAt, buildSchedule, INTRO_BEATS, timeOf } from './clock';
import { cpuConfig, runBattle } from './harness';
import { rand } from './rng';
import { BPM, duelConfig, eventsOf, masher, numbers, playScript, SET_A } from './testkit';

function hash(v: unknown): string {
  const s = JSON.stringify(v);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${h.toString(16)}:${s.length}`;
}

/** A crew battle with one human masher per crew, the rest CPU. */
function mixed(size: CrewSize, seed: number): { config: BattleConfig; inputs: BreakInput[] } {
  const config = cpuConfig(size, seed, [0.3 + 0.1 * (seed % 7), 0.9 - 0.1 * (seed % 5)], {
    rounds: 2,
  });
  config.dancers[0] = { ...config.dancers[0], id: 'human:a', human: true };
  config.dancers[size] = { ...config.dancers[size], id: 'human:b', human: true };
  const secs = timeOf({ bpm: config.bpm, spb: 60 / config.bpm }, buildSchedule(config).doneAt);
  return {
    config,
    inputs: [...masher('human:a', seed, secs), ...masher('human:b', seed + 99, secs, 5)],
  };
}

function play(
  config: BattleConfig,
  inputs: BreakInput[],
  dts: number[],
): { events: SimEvent[]; state: unknown } {
  const sim = createBattleSim(config);
  for (const i of inputs) sim.input(i);
  const events: SimEvent[] = [];
  for (let k = 0; k < 200_000 && sim.state().phase !== 'done'; k++)
    events.push(...sim.step(dts[k % dts.length]));
  return { events, state: sim.state() };
}

describe('breakdance determinism', () => {
  it('same config + inputs → identical events and state', () => {
    const { config, inputs } = mixed(3, 7);
    const a = play(config, inputs, [1 / 60]);
    const b = play(config, inputs, [1 / 60]);
    expect(hash(a.events)).toBe(hash(b.events));
    expect(hash(a.state)).toBe(hash(b.state));
    expect(eventsOf(a.events, 'hit').length).toBeGreaterThan(50);
  });

  it('how the clock is chopped (or the order inputs arrive in) never changes the battle', () => {
    const { config, inputs } = mixed(2, 3);
    const shuffled = [...inputs];
    const h = { rng: 5 };
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rand(h) * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const base = play(config, inputs, [1 / 60]);
    const chunky = play(config, shuffled, [1 / 7, 0.013, 0.5, 1 / 144]);
    const once = play(config, inputs, [10_000]);
    const strip = (s: unknown) => ({ ...(s as object), t: 0, beat: 0, prompts: [], poses: [] });
    expect(hash(chunky.events)).toBe(hash(base.events));
    expect(hash(once.events)).toBe(hash(base.events));
    expect(hash(strip(chunky.state))).toBe(hash(strip(base.state)));
  });

  it('different seeds give different CPU battles', () => {
    const a = play(cpuConfig(1, 1), [], [1 / 30]);
    const b = play(cpuConfig(1, 2), [], [1 / 30]);
    expect(hash(a.events)).not.toBe(hash(b.events));
  });
});

describe('beat clock', () => {
  it('beat 0 is the first downbeat after a one-bar intro', () => {
    const sim = new BreakBattle(duelConfig());
    expect(sim.state().phase).toBe('intro');
    expect(sim.state().beat).toBe(-INTRO_BEATS);
    const spb = 60 / BPM;
    const ev = sim.step(INTRO_BEATS * spb + 1e-6);
    const beats = eventsOf(ev, 'beat');
    expect(beats.map(b => b.beat)).toEqual([-4, -3, -2, -1, 0]);
    expect(beats.map(b => b.downbeat)).toEqual([true, false, false, false, true]);
    expect(sim.state().phase).toBe('turn');
    expect(sim.state().beat).toBeCloseTo(0, 5);
    expect(beatAt(sim.clock, timeOf(sim.clock, 7.5))).toBeCloseTo(7.5, 9);
  });
});

describe('turn order', () => {
  const order = (size: CrewSize, rounds: number) =>
    eventsOf(
      runBattle(createBattleSim(cpuConfig(size, 1, [0.5, 0.5], { rounds })), 1 / 20),
      'turn',
    ).map(t => `${t.round}:${t.id}`);

  it('1v1: crews alternate, and the crew that opens swaps each round', () => {
    expect(order(1, 3)).toEqual(['0:cpu:0', '0:cpu:1', '1:cpu:1', '1:cpu:0', '2:cpu:0', '2:cpu:1']);
  });

  it('2v2: every dancer goes once a round, crews alternating', () => {
    expect(order(2, 2)).toEqual([
      '0:cpu:0',
      '0:cpu:2',
      '0:cpu:1',
      '0:cpu:3',
      '1:cpu:2',
      '1:cpu:0',
      '1:cpu:3',
      '1:cpu:1',
    ]);
  });

  it('3v3: every dancer goes once a round, crews alternating', () => {
    expect(order(3, 1)).toEqual(['0:cpu:0', '0:cpu:3', '0:cpu:1', '0:cpu:4', '0:cpu:2', '0:cpu:5']);
    const two = order(3, 2).slice(6);
    expect(two).toEqual(['1:cpu:3', '1:cpu:0', '1:cpu:4', '1:cpu:1', '1:cpu:5', '1:cpu:2']);
  });

  it('runs intro → turn → between → … → judging → final → done, one card per round', () => {
    const sim = createBattleSim(cpuConfig(2, 4, [0.5, 0.5], { rounds: 2 }));
    const phases: string[] = [sim.state().phase];
    const events: SimEvent[] = [];
    for (let k = 0; k < 100_000 && sim.state().phase !== 'done'; k++) {
      events.push(...sim.step(1 / 30));
      const p = sim.state().phase;
      if (phases[phases.length - 1] !== p) phases.push(p);
    }
    expect(phases).toEqual([
      'intro',
      'turn',
      'between',
      'turn',
      'between',
      'turn',
      'between',
      'turn',
      'judging',
      'turn',
      'between',
      'turn',
      'between',
      'turn',
      'between',
      'turn',
      'judging',
      'final',
      'done',
    ]);
    expect(eventsOf(events, 'card').map(c => c.round)).toEqual([0, 1]);
    expect(eventsOf(events, 'end')).toHaveLength(1);
    expect(sim.state().cards).toHaveLength(2);
  });

  it('state.turn carries the dancer up and their beats', () => {
    const sim = createBattleSim(cpuConfig(1, 1));
    sim.step(timeOf({ bpm: 96, spb: 60 / 96 }, 3));
    expect(sim.state().turn).toEqual({ id: 'cpu:0', from: 0, to: 16 });
    expect(sim.state().poses.find(p => p.id === 'cpu:0')?.centre).toBe(true);
    expect(sim.state().poses.find(p => p.id === 'cpu:1')?.centre).toBe(false);
  });
});

describe('battles always finish clean', () => {
  it('every size and seed ends with a winner or a tie, and no NaN anywhere', () => {
    for (const size of [1, 2, 3] as const) {
      for (let seed = 1; seed <= 8; seed++) {
        const { config, inputs } = mixed(size, seed);
        const r = play(config, inputs, [1 / 30]);
        const st = r.state as ReturnType<BreakBattle['state']>;
        expect(st.phase).toBe('done');
        expect(st.winner === 0 || st.winner === 1 || st.winner === 'tie').toBe(true);
        expect(st.totals[0] + st.totals[1]).toBe(3 * config.rounds);
        for (const n of [...numbers(r.events), ...numbers(st)])
          expect(Number.isFinite(n)).toBe(true);
        for (const c of st.cards) {
          for (const k of ['technique', 'musicality', 'originality', 'power'] as const) {
            for (const v of c[k]) expect(v >= 0 && v <= 10).toBe(true);
          }
        }
      }
    }
  });

  it('survives junk: bad keys, NaN times, unknown dancers, CPU impersonation, bad config numbers', () => {
    const config = cpuConfig(1, 9, [0.5, 0.5], {
      bpm: Number.NaN,
      turnBars: 0,
      rounds: -2,
      windows: { perfect: -1, great: Number.NaN, ok: 0 },
    });
    config.dancers[0] = { ...config.dancers[0], id: 'h', human: true };
    const sim = createBattleSim(config);
    sim.input({ id: 'h', key: 'up', t: Number.NaN });
    sim.input({ id: 'nobody', key: 'up', t: 3 });
    sim.input({ id: 'cpu:1', key: 'up', t: 3 });
    sim.input({ id: 'h', key: 'x' as never, t: 3 });
    for (const i of masher('h', 3, 60)) sim.input(i);
    const ev = runBattle(sim, 1 / 30);
    expect(sim.state().phase).toBe('done');
    expect(sim.state().winner).toBeDefined();
    for (const n of [...numbers(ev), ...numbers(sim.state())])
      expect(Number.isFinite(n)).toBe(true);
  });

  it('an empty battle (nobody moves) still finishes', () => {
    const { state } = playScript(duelConfig(2), {});
    expect(state.phase).toBe('done');
    expect(state.winner).toBeDefined();
  });
});

describe('prompts', () => {
  it('lead in before the turn, then guide the dancer up; following them lands a full set', () => {
    const config = duelConfig(1);
    const sim = new BreakBattle(config);
    const pressed = new Set<string>();
    let lead = false;
    const events: SimEvent[] = [];
    const dt = 1 / 120;
    for (let k = 0; k < 100_000 && sim.state().phase !== 'done'; k++) {
      const st = sim.state();
      if (st.phase === 'intro' && st.prompts.length && st.promptsFor === 'h0') lead = true;
      if (st.promptsFor === 'h0') {
        for (const p of st.prompts) {
          const at = timeOf(sim.clock, p.beat);
          const tag = `${p.beat}`;
          if (at <= st.t + dt && !pressed.has(tag)) {
            pressed.add(tag);
            sim.input({ id: 'h0', key: p.key, t: at });
          }
        }
      }
      events.push(...sim.step(dt));
    }
    expect(lead).toBe(true);
    const mine = events.filter(e => 'id' in e && e.id === 'h0');
    expect(eventsOf(mine, 'crash')).toHaveLength(0);
    expect(eventsOf(mine, 'hit').every(h => h.grade === 'perfect')).toBe(true);
    const moves = eventsOf(mine, 'move');
    expect(moves.length).toBeGreaterThanOrEqual(4);
    expect(moves.every(m => m.landed)).toBe(true);
    const fr = eventsOf(mine, 'freeze');
    expect(fr[fr.length - 1]?.onBeat).toBe(true);
  });

  it('a scripted set lands every move, with combo events and a last-beat freeze', () => {
    const { events, sim } = playScript(duelConfig(1), { h0: { turns: [SET_A] } });
    const moves = eventsOf(events, 'move').filter(m => m.id === 'h0');
    expect(moves.map(m => m.move)).toEqual(SET_A.map(p => p.move));
    expect(moves.every(m => m.landed && m.points > 0)).toBe(true);
    expect(
      eventsOf(events, 'combo')
        .filter(c => c.id === 'h0')
        .pop()?.combo,
    ).toBe(6);
    expect(eventsOf(events, 'freeze')).toEqual([
      { e: 'freeze', id: 'h0', move: 'baby_freeze', onBeat: true },
    ]);
    expect(sim.records()[0].crashes).toBe(0);
  });
});
