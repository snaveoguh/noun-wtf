import { describe, expect, it } from 'vitest';

import { alive, fillText, orderText, pickBubbles, type Bubble, type BubbleCand } from './bubbles';
import { budgetFor, copyRings, pickRigs } from './lod';

describe('bubble text', () => {
  it('turns orders into floor shouts', () => {
    expect(orderText({ side: 'buy', good: 'FRIES', qty: 12, price: 4 })).toBe('BUY 12 FRIES @ 4');
    expect(orderText({ side: 'sell', good: 'NOGGLES', qty: 3, price: 30 }, 3)).toBe(
      'SELL NOGGLES 30!',
    );
    expect(orderText({ side: 'sell', good: 'FISH', qty: 5, price: 6 }, 2)).toBe('5 FISH AT 6!');
    expect(orderText({ side: 'buy', good: 'FISH', qty: 5, price: 6 }, 2)).toBe('6 BID FOR 5 FISH!');
    expect(orderText({ side: 'buy', good: 'PIZZA', qty: 1, price: 14.5 })).toBe(
      'BUY 1 PIZZA @ 14.5',
    );
  });

  it('turns fills into results for each side', () => {
    expect(fillText('sell', { good: 'FRIES', qty: 12, price: 4 })).toBe('FILLED +48 COIN');
    expect(fillText('buy', { good: 'FRIES', qty: 12, price: 4 })).toBe('GOT 12 FRIES −48');
  });

  it('expires', () => {
    const b: Bubble = { kind: 'buy', text: 'x', real: false, at: 10, ttl: 2 };
    expect(alive(b, 11)).toBe(true);
    expect(alive(b, 12.1)).toBe(false);
    expect(alive(null, 0)).toBe(false);
  });
});

const bub = (kind: Bubble['kind'], real = false): Bubble => ({
  kind,
  text: kind,
  real,
  at: 0,
  ttl: 5,
});
const cand = (
  i: number,
  dist: number,
  b: Bubble | null,
  more: Partial<BubbleCand> = {},
): BubbleCand => ({
  i,
  dist,
  onScreen: true,
  bubble: b,
  named: false,
  ...more,
});

describe('pickBubbles', () => {
  it('caps the count and prefers the nearest of equals', () => {
    const cs = Array.from({ length: 100 }, (_, i) => cand(i, 100 - i, bub('buy')));
    const out = pickBubbles(cs, 30, 1);
    expect(out).toHaveLength(30);
    expect(Math.min(...out)).toBe(70);
  });

  it('skips the silent, the expired and the off screen', () => {
    const out = pickBubbles(
      [
        cand(0, 1, null),
        cand(1, 1, { ...bub('buy'), at: -10 }),
        cand(2, 1, bub('buy'), { onScreen: false }),
        cand(3, 50, bub('buy')),
      ],
      10,
      1,
    );
    expect(out).toEqual([3]);
  });

  it('real fills beat nearer simulated shouts; the followed trader always shows', () => {
    const out = pickBubbles(
      [
        cand(0, 5, bub('buy')),
        cand(1, 60, bub('filled', true)),
        cand(2, 900, null, { followed: true }),
      ],
      2,
      1,
    );
    expect(out).toEqual([2, 1]);
  });

  it('named real traders keep a name tag when quiet; you rank above everyone', () => {
    const out = pickBubbles(
      [
        cand(0, 10, bub('buy')),
        cand(1, 10, null, { named: true }),
        cand(2, 80, null, { named: true, you: true }),
      ],
      2,
      1,
    );
    expect(out).toEqual([2, 1]);
  });

  it('sticks: a showing bubble survives a slightly better newcomer', () => {
    const cs = [cand(0, 10, bub('buy')), cand(1, 9, bub('buy'))];
    expect(pickBubbles(cs, 1, 1)).toEqual([1]);
    expect(pickBubbles(cs, 1, 1, new Set([0]))).toEqual([0]);
  });
});

describe('LOD', () => {
  it('budgets: hundreds on desktop, about a hundred on phones', () => {
    expect(budgetFor(false).traders).toBeGreaterThanOrEqual(300);
    expect(budgetFor(true).traders).toBeGreaterThanOrEqual(90);
    expect(budgetFor(true).traders).toBeLessThanOrEqual(130);
    expect(budgetFor(true).rigs).toBeLessThan(budgetFor(false).rigs);
    expect(budgetFor(false, { traders: 600, rigs: 0 })).toMatchObject({ traders: 600, rigs: 0 });
  });

  it('rigs the nearest, within range, up to the budget', () => {
    const d = [5, 50, 1, 20, 3, Infinity, 8];
    expect([...pickRigs(d, new Set(), 3, 30)].sort()).toEqual([0, 2, 4]);
    expect([...pickRigs(d, new Set(), 10, 30)].sort()).toEqual([0, 2, 3, 4, 6]);
    expect(pickRigs(d, new Set(), 0, 30).size).toBe(0);
  });

  it('hysteresis: a rigged trader keeps its rig against a slightly nearer one', () => {
    const d = [10, 9.5];
    expect([...pickRigs(d, new Set(), 1, 30)]).toEqual([1]);
    expect([...pickRigs(d, new Set([0]), 1, 30)]).toEqual([0]);
    // …but not against a much nearer one
    expect([...pickRigs([10, 4], new Set([0]), 1, 30)]).toEqual([1]);
    // and it holds a little past the range
    expect([...pickRigs([32], new Set([0]), 1, 30)]).toEqual([0]);
  });

  it('the followed trader is always rigged', () => {
    const d = [1, 2, 3, 40];
    expect(pickRigs(d, new Set(), 2, 30, 3).has(3)).toBe(true);
    expect(pickRigs(d, new Set(), 2, 30, 3).size).toBe(2);
  });

  it('hall copies appear only as the camera pulls out', () => {
    expect(copyRings(20, false)).toBe(0);
    expect(copyRings(200, false)).toBe(1);
    expect(copyRings(900, false)).toBe(3);
    expect(copyRings(900, true)).toBe(2);
  });
});
