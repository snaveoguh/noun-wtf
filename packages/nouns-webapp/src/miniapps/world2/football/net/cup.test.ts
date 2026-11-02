import { describe, expect, it } from 'vitest';

import {
  fixtureWinner,
  myFixture,
  newCup,
  opponentDifficulty,
  recordMine,
  roundName,
  table,
} from './cup';

describe('football cup + season', () => {
  it('a cup is 8 clubs, you play quarter, semi and final when you keep winning', () => {
    let c = newCup('cup', 7, 2, 11, 2);
    expect(c.clubs).toHaveLength(8);
    expect(new Set(c.clubs).size).toBe(8);
    expect(c.clubs[0]).toBe(2);
    expect(roundName(c)).toBe('QUARTER-FINAL');
    for (const name of ['QUARTER-FINAL', 'SEMI-FINAL', 'FINAL']) {
      expect(roundName(c)).toBe(name);
      expect(myFixture(c)).not.toBeNull();
      c = recordMine(c, 3, 1);
    }
    expect(c.done).toBe(true);
    expect(c.winner).toBe(2);
  });

  it('losing knocks you out and the rest is played out to a winner', () => {
    let c = newCup('cup', 11, 0, 7, 3);
    c = recordMine(c, 0, 2);
    expect(c.done).toBe(true);
    expect(c.winner).not.toBe(0);
    expect(c.rounds).toHaveLength(3);
    expect(c.rounds[2]).toHaveLength(1);
    expect(myFixture(c)).toBeNull();
  });

  it('a draw is settled on penalties', () => {
    let c = newCup('cup', 3, 1, 5, 1);
    c = recordMine(c, 1, 1, [5, 4]);
    expect(c.done).toBe(false);
    const f = c.rounds[0].find(g => g.home === 1 || g.away === 1)!;
    expect(fixtureWinner(f)).toBe(1);
    for (const g of c.rounds[0]) expect(fixtureWinner(g)).toBeGreaterThanOrEqual(0);
  });

  it('a season is a 4-club round robin: everyone plays everyone once, 3 points a win', () => {
    let c = newCup('season', 5, 4, 11, 2);
    expect(c.clubs).toHaveLength(4);
    const pairs = new Set<string>();
    for (const r of c.rounds) for (const f of r) pairs.add([f.home, f.away].sort().join('-'));
    expect(pairs.size).toBe(6);
    for (let i = 0; i < 3; i++) c = recordMine(c, 2, 0);
    expect(c.done).toBe(true);
    const t = table(c);
    expect(t[0].club).toBe(4);
    expect(t[0].pts).toBe(9);
    expect(t.reduce((a, r) => a + r.p, 0)).toBe(12);
    expect(c.winner).toBe(4);
  });

  it('is deterministic for a seed and stays within the CPU levels', () => {
    const a = recordMine(newCup('cup', 99, 3, 11, 4), 1, 0);
    const b = recordMine(newCup('cup', 99, 3, 11, 4), 1, 0);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const d = opponentDifficulty(a);
    expect(d).toBeGreaterThanOrEqual(1);
    expect(d).toBeLessThanOrEqual(4);
  });
});
