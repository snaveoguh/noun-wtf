// @vitest-environment node
// The move library's rules (the recogniser and planner rely on them).

import type { MoveFamily, MoveId } from '../contract';

import { describe, expect, it } from 'vitest';

import { canFlow, MOVE_LIST, MOVES } from './moves';
import { canFinish, planTurn, coachOpts } from './planner';

const ALL: MoveId[] = [
  'indian_step',
  'salsa_rock',
  'cross_step',
  'kick_step',
  'six_step',
  'three_step',
  'cc',
  'pretzel',
  'kick_out',
  'windmill',
  'flare',
  'headspin',
  'backspin',
  'swipe',
  'turtle',
  'airflare',
  'baby_freeze',
  'chair_freeze',
  'headstand',
  'airchair',
  'hollowback',
  'drop',
  'spin_down',
  'get_up',
];

function mean(f: MoveFamily, k: 'difficulty' | 'points'): number {
  const ms = MOVE_LIST.filter(m => m.family === f);
  return ms.reduce((s, m) => s + m[k], 0) / ms.length;
}

describe('move library', () => {
  it('has exactly one spec per MoveId', () => {
    expect(MOVE_LIST.map(m => m.id).sort()).toEqual([...ALL].sort());
    for (const id of ALL) expect(MOVES[id].id).toBe(id);
  });

  it('no pattern is a prefix of another', () => {
    for (const a of MOVE_LIST) {
      for (const b of MOVE_LIST) {
        if (a === b || a.pattern.length > b.pattern.length) continue;
        const prefix = a.pattern.every((k, i) => b.pattern[i] === k);
        expect(prefix, `${a.id} is a prefix of ${b.id}`).toBe(false);
      }
    }
  });

  it('every move is a whole number of beats, matching its pattern on the grid', () => {
    for (const m of MOVE_LIST) {
      expect(Number.isInteger(m.beats), m.id).toBe(true);
      expect(m.beats).toBe(m.pattern.length * (m.half === true ? 0.5 : 1));
    }
  });

  it('freezes end on a held button', () => {
    for (const m of MOVE_LIST.filter(x => x.family === 'freeze')) {
      expect(['a', 'b']).toContain(m.pattern[m.pattern.length - 1]);
    }
  });

  it('the windmill rolls down / left / up / right', () => {
    expect(MOVES.windmill.pattern).toEqual(['down', 'left', 'up', 'right']);
  });

  it('difficulty and points climb toward power moves and air freezes', () => {
    expect(mean('toprock', 'difficulty')).toBeLessThan(mean('footwork', 'difficulty'));
    expect(mean('footwork', 'difficulty')).toBeLessThan(mean('power', 'difficulty'));
    expect(mean('toprock', 'points')).toBeLessThan(mean('footwork', 'points'));
    expect(mean('footwork', 'points')).toBeLessThan(mean('power', 'points'));
    const hardest = [...MOVE_LIST].sort((a, b) => b.points - a.points)[0];
    expect(hardest.id).toBe('airflare');
    expect(MOVES.airchair.difficulty).toBeGreaterThan(MOVES.baby_freeze.difficulty);
    expect(MOVES.hollowback.difficulty).toBe(5);
  });

  it('flow: power needs a way down, toprock needs a way up', () => {
    expect(canFlow(null, MOVES.indian_step)).toBe(true);
    expect(canFlow(null, MOVES.windmill)).toBe(false);
    expect(canFlow(null, MOVES.get_up)).toBe(false);
    expect(canFlow('drop', MOVES.windmill)).toBe(true);
    expect(canFlow('windmill', MOVES.flare)).toBe(true);
    expect(canFlow('flare', MOVES.indian_step)).toBe(false);
    expect(canFlow('get_up', MOVES.indian_step)).toBe(true);
    expect(canFlow('any', MOVES.airflare)).toBe(true);
    for (const m of MOVE_LIST) expect(m.flowsTo?.length, m.id).toBeGreaterThan(0);
  });

  it('every move can be reached from standing, and every turn length can end on a freeze', () => {
    const reached = new Set<MoveId | null>([null]);
    for (let pass = 0; pass < 6; pass++) {
      for (const from of [...reached])
        for (const m of MOVE_LIST) if (canFlow(from, m)) reached.add(m.id);
    }
    for (const id of ALL) expect(reached.has(id), id).toBe(true);
    for (let bars = 1; bars <= 16; bars++)
      expect(canFinish(bars * 4, null), `${bars} bars`).toBe(true);
  });

  it('the coach plans a full turn that flows and ends on a freeze on the last beat', () => {
    for (const bars of [1, 2, 4, 8]) {
      const plan = planTurn(0, bars * 4, null, coachOpts());
      let prev: MoveId | null = null;
      let at = 0;
      for (const p of plan) {
        expect(p.start).toBe(at);
        expect(canFlow(prev, MOVES[p.move])).toBe(true);
        at += MOVES[p.move].beats;
        prev = p.move;
      }
      expect(at).toBe(bars * 4);
      expect(MOVES[plan[plan.length - 1].move].family).toBe('freeze');
    }
  });
});
