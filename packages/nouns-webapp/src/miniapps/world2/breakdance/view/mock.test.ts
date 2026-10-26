import type { BattlePhase, MoveId, SimEvent } from '../contract';

import { describe, expect, it } from 'vitest';

import { createMockBattle, ROUTINES } from './mock';
import { MOVE_IDS } from './moves';

function runAll(o: Parameters<typeof createMockBattle>[0] = {}, dt = 1 / 30) {
  const m = createMockBattle(o);
  const events: SimEvent[] = [];
  const phases: BattlePhase[] = [];
  const moves = new Set<MoveId>();
  let guard = 0;
  while (m.state().phase !== 'done' && guard++ < 20000) {
    events.push(...m.step(dt));
    const s = m.state();
    if (phases[phases.length - 1] !== s.phase) phases.push(s.phase);
    for (const p of s.poses) if (p.move !== null) moves.add(p.move);
    // State sanity every frame
    expect(Number.isFinite(s.beat)).toBe(true);
    for (const p of s.poses) {
      expect(p.moveT).toBeGreaterThanOrEqual(0);
      expect(p.moveT).toBeLessThanOrEqual(1);
    }
    for (let i = 1; i < s.prompts.length; i++)
      expect(s.prompts[i].beat).toBeGreaterThanOrEqual(s.prompts[i - 1].beat);
  }
  return { m, events, phases, moves };
}

describe('mock battle', () => {
  it('routines are a turn long and use every move', () => {
    for (const r of ROUTINES) expect(r.reduce((a, [, n]) => a + n, 0)).toBe(16);
    const used = new Set(ROUTINES.flat().map(([m]) => m));
    expect([...used].sort()).toEqual([...MOVE_IDS].sort());
  });

  it('runs a whole 2v2 battle: turns, hits, moves, a crash, cards, a winner', () => {
    const { events, phases, moves, m } = runAll({ crewSize: 2, rounds: 2, human: null });
    expect(phases[0]).toBe('intro');
    expect(phases).toContain('turn');
    expect(phases).toContain('between');
    expect(phases).toContain('judging');
    expect(phases[phases.length - 1]).toBe('done');
    const kinds = new Set(events.map(e => e.e));
    for (const k of ['beat', 'turn', 'hit', 'move', 'crash', 'freeze', 'card', 'end'] as const)
      expect(kinds.has(k), k).toBe(true);
    expect(events.filter(e => e.e === 'turn')).toHaveLength(8);
    expect(events.filter(e => e.e === 'card')).toHaveLength(2);
    // 8 turns cover routines 0..4 and wrap: every move shows up
    expect(moves.size).toBe(MOVE_IDS.length);
    const s = m.state();
    expect(s.winner === 0 || s.winner === 1).toBe(true);
    expect(s.totals[0] + s.totals[1]).toBeGreaterThan(0);
    expect(s.cards).toHaveLength(2);
    // Downbeats every fourth beat
    const beats = events.filter((e): e is Extract<SimEvent, { e: 'beat' }> => e.e === 'beat');
    for (const b of beats) expect(b.downbeat).toBe(((b.beat % 4) + 4) % 4 === 0);
  });

  it('judges a human dancer against the prompts', () => {
    const m = createMockBattle({ human: 'me', crewSize: 1 });
    // Into the first turn (mine: crew 0 goes first)
    let s = m.state();
    let guard = 0;
    while (s.phase !== 'turn' && guard++ < 1000) {
      m.step(1 / 60);
      s = m.state();
    }
    expect(s.turn?.id).toBe('me');
    const graded: string[] = [];
    // Hit the next prompts dead on
    for (let i = 0; i < 4; i++) {
      const p = m.state().prompts[0];
      while (m.beat < p.beat)
        graded.push(
          ...m
            .step(1 / 240)
            .filter(e => e.e === 'hit')
            .map(e => (e as { grade: string }).grade),
        );
      m.input({ id: 'me', key: p.key, t: (p.beat + 8) * m.spb });
      graded.push(
        ...m
          .step(1 / 240)
          .filter(e => e.e === 'hit')
          .map(e => (e as { grade: string }).grade),
      );
    }
    expect(graded.filter(g => g === 'perfect').length).toBeGreaterThanOrEqual(3);
    // Then stop pressing: the next prompts are missed
    const misses: string[] = [];
    for (let i = 0; i < 120; i++)
      misses.push(
        ...m
          .step(1 / 60)
          .filter(e => e.e === 'hit')
          .map(e => (e as { grade: string }).grade),
      );
    expect(misses).toContain('miss');
    expect(m.state().combo).toBe(0);
  });

  it('hold() pins a move in the middle', () => {
    const m = createMockBattle();
    m.step(0.5);
    m.hold('headspin');
    m.step(1);
    const s = m.state();
    expect(s.phase).toBe('turn');
    const p = s.poses.find(x => x.centre)!;
    expect(p.move).toBe('headspin');
    expect(p.moveBeats).toBe(4);
  });
});
