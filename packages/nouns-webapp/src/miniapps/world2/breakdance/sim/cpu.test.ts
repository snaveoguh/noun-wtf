// @vitest-environment node
// CPU dancers: skill shows, and they answer power with power.

import { describe, expect, it } from 'vitest';

import { BreakBattle, createBattleSim } from './BattleSim';
import { cpuConfig, runBattle } from './harness';
import { MOVES } from './moves';
import { cpuOpts, planTurn, type PlannedMove } from './planner';
import { eventsOf, scriptInputs, seq } from './testkit';

describe('CPU dancers', () => {
  it('a skill-1 CPU beats a skill-0.2 CPU most of the time', () => {
    let strongWins = 0;
    const n = 24;
    for (let seed = 1; seed <= n; seed++) {
      const strong = seed % 2 === 0 ? 0 : 1;
      const skills: [number, number] = strong === 0 ? [1, 0.2] : [0.2, 1];
      const sim = createBattleSim(cpuConfig(1, seed, skills));
      runBattle(sim, 1 / 30);
      if (sim.state().winner === strong) strongWins++;
    }
    expect(strongWins).toBeGreaterThanOrEqual(Math.ceil(n * 0.8));
  });

  it('skill shows in timing, crashes and difficulty', () => {
    const stats = (skill: number) => {
      let perfect = 0;
      let hits = 0;
      let crashes = 0;
      let diff = 0;
      let landed = 0;
      for (let seed = 1; seed <= 8; seed++) {
        const ev = runBattle(createBattleSim(cpuConfig(1, seed, [skill, skill])), 1 / 30);
        for (const h of eventsOf(ev, 'hit')) {
          hits++;
          if (h.grade === 'perfect') perfect++;
        }
        crashes += eventsOf(ev, 'crash').length;
        for (const m of eventsOf(ev, 'move')) {
          if (!m.landed) continue;
          landed++;
          diff += MOVES[m.move].difficulty;
        }
      }
      return { perfectRate: perfect / hits, crashes, diff: diff / landed };
    };
    const hi = stats(1);
    const lo = stats(0.2);
    expect(hi.perfectRate).toBeGreaterThan(0.9);
    expect(lo.perfectRate).toBeLessThan(0.6);
    expect(hi.crashes).toBeLessThan(lo.crashes);
    expect(hi.diff).toBeGreaterThan(lo.diff);
  });

  it('a CPU at full skill lands a set that ends on a last-beat freeze', () => {
    const ev = runBattle(createBattleSim(cpuConfig(1, 3, [1, 1], { rounds: 1 })), 1 / 30);
    const fr = eventsOf(ev, 'freeze').filter(f => f.id === 'cpu:0');
    expect(fr.some(f => f.onBeat)).toBe(true);
  });

  it('answers back: plans after a power-heavy turn carry more power', () => {
    const power = (answer: number) => {
      let d = 0;
      for (let seed = 1; seed <= 40; seed++) {
        for (const p of planTurn(0, 16, null, cpuOpts(0.7, answer, { rng: seed * 7919 }))) {
          if (MOVES[p.move].family === 'power') d += MOVES[p.move].difficulty;
        }
      }
      return d;
    };
    expect(power(1)).toBeGreaterThan(power(0) * 1.4);
  });

  it('answers back in a battle: after a power-heavy turn the CPU goes bigger', () => {
    const powerSet = seq(
      ['drop', 0],
      ['flare', 2],
      ['airflare', 4],
      ['headspin', 8],
      ['airchair', 13],
    );
    const rockSet = seq(
      ['indian_step', 0],
      ['salsa_rock', 4],
      ['cross_step', 8],
      ['kick_step', 12],
    );
    const cpuPower = (set: PlannedMove[]) => {
      let total = 0;
      for (let seed = 1; seed <= 24; seed++) {
        const config = cpuConfig(1, seed, [0.5, 0.75], { rounds: 1 });
        config.dancers[0] = { ...config.dancers[0], id: 'h', human: true };
        const sim = new BreakBattle(config);
        for (const i of scriptInputs(config, { h: { turns: [set] } })) sim.input(i);
        runBattle(sim, 1 / 30);
        total += sim.records().find(r => r.id === 'cpu:1')?.cats?.power ?? 0;
      }
      return total;
    };
    expect(cpuPower(powerSet)).toBeGreaterThan(cpuPower(rockSet) * 1.25);
  });
});
