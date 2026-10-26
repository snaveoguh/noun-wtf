import type { JudgeCard, LaneNote } from '../contract';

import { describe, expect, it, vi } from 'vitest';

import {
  barsLeft,
  BreakHudStore,
  cardTotal,
  cardVotes,
  formingText,
  laneItems,
  trackItems,
  turnLeft,
} from './hudStore';

describe('rhythm lane layout', () => {
  const lane: LaneNote[] = [
    { key: 'down', beat: 7, id: 'm', move: 'windmill', i: 0, n: 4, grade: 'miss' },
    { key: 'left', beat: 8, id: 'h', move: 'windmill', i: 1, n: 4, grade: 'ok', off: -0.12 },
    { key: 'up', beat: 9, id: 'p', move: 'windmill', i: 2, n: 4 },
    { key: 'a', beat: 10, id: 'd', move: 'flare', i: 0, n: 4, dead: true },
  ];

  it('scrolls misses past the line, bursts hits, greys dead notes, labels moves', () => {
    const items = laneItems(lane, [], 8, 4, m => `<${m}>`);
    const by = (id: string) => items.find(x => x.id === id)!;
    expect(by('m')).toMatchObject({ status: 'miss', x: -0.25, label: '<WINDMILL>' });
    expect(by('m').alpha).toBeGreaterThan(0);
    expect(by('h')).toMatchObject({ status: 'hit', grade: 'ok', timing: 'EARLY', x: 0 });
    expect(by('p')).toMatchObject({ status: 'pending', x: 0.25 });
    expect(by('d').status).toBe('dead');
    expect(by('d').alpha).toBeLessThan(0.5);
    // Far enough past the line, a miss is gone
    expect(laneItems(lane, [], 8.3, 4).find(x => x.id === 'm')).toBeUndefined();
  });

  it('falls back to the prompts when the sim sends no lane', () => {
    const items = laneItems(null, [{ key: 'b', beat: 9 }], 8, 4);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ key: 'b', x: 0.25, status: 'pending' });
    expect(items[0].label).toBeUndefined();
  });

  it('names the move forming', () => {
    const f = { id: 'a', move: 'windmill' as const, got: 2, of: 4 };
    expect(formingText(f, m => m)).toBe('WINDMILL 2/4');
    expect(formingText({ ...f, got: 4, landed: true }, m => m)).toBe('WINDMILL ✓');
    expect(formingText(null, m => m)).toBe('');
  });
});

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
