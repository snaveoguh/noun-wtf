import type { JudgeCard } from '../contract';

import { describe, expect, it, vi } from 'vitest';

import { barsLeft, BreakHudStore, cardTotal, cardVotes, trackItems, turnLeft } from './hudStore';

describe('beat track layout', () => {
  const prompts = [
    { key: 'left' as const, beat: 8 },
    { key: 'right' as const, beat: 9 },
    { key: 'a' as const, beat: 12 },
    { key: 'b' as const, beat: 13 },
  ];

  it('puts the next prompt at the hit line on its beat and the far end AHEAD beats out', () => {
    const at8 = trackItems(prompts, 8, 4);
    expect(at8[0]).toMatchObject({ key: 'left', x: 0 });
    expect(at8.find(i => i.key === 'a')!.x).toBeCloseTo(1);
    // Beyond the track: not drawn
    expect(at8.find(i => i.key === 'b')).toBeUndefined();
  });

  it('moves notes toward the line as the beat advances, and fades them just past it', () => {
    const a = trackItems(prompts, 7, 4).find(i => i.key === 'right')!;
    const b = trackItems(prompts, 8, 4).find(i => i.key === 'right')!;
    expect(b.x).toBeLessThan(a.x);
    const past = trackItems(prompts, 8.2, 4).find(i => i.key === 'left')!;
    expect(past.x).toBeLessThan(0);
    expect(past.alpha).toBeLessThan(1);
    expect(trackItems(prompts, 8.5, 4).find(i => i.key === 'left')).toBeUndefined();
  });

  it('marks downbeats', () => {
    expect(trackItems(prompts, 8, 4)[0].down).toBe(true);
    expect(trackItems(prompts, 8, 4)[1].down).toBe(false);
  });
});

describe('turn timer', () => {
  it('counts down the turn', () => {
    const t = { from: 0, to: 16 };
    expect(turnLeft(0, t)).toBe(1);
    expect(turnLeft(8, t)).toBe(0.5);
    expect(turnLeft(20, t)).toBe(0);
    expect(turnLeft(3, null)).toBe(0);
    expect(barsLeft(0, t)).toBe('4.0');
    expect(barsLeft(10.5, t)).toBe('1.2');
  });
});

describe('judge cards', () => {
  const card: JudgeCard = {
    votes: [0, 1, 0],
    technique: [8, 6],
    musicality: [7, 7],
    originality: [9, 5],
    power: [6, 9],
  };
  it('totals and votes', () => {
    expect(cardTotal(card, 0)).toBe(30);
    expect(cardTotal(card, 1)).toBe(27);
    expect(cardVotes(card)).toEqual([2, 1]);
  });
});

describe('BreakHudStore', () => {
  it('notifies on change, not on a no-op', () => {
    const s = new BreakHudStore();
    const fn = vi.fn();
    const off = s.subscribe(fn);
    s.set({ combo: 3 });
    expect(fn).toHaveBeenCalledTimes(1);
    s.set({ combo: 3 });
    expect(fn).toHaveBeenCalledTimes(1);
    s.set({ combo: 4, turnScore: 100 });
    expect(fn).toHaveBeenCalledTimes(2);
    expect(s.get().turnScore).toBe(100);
    off();
    s.set({ combo: 9 });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
