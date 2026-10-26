import type { RespectEvent } from '../interiors/contract';

import { describe, expect, it } from 'vitest';

import {
  apply,
  drift,
  FORGIVE_MS,
  GAIN_PER_MIN,
  HALF_LIFE_MS,
  KINDS,
  LOSS_PER_MIN,
  MINUTE,
  newBook,
  normalizeBook,
  parseEvent,
  progressOf,
  RULES,
  tickerText,
  tierFor,
  type RespectBook,
} from './rules';

const T0 = Date.UTC(2026, 9, 26, 12);

/** Score a list of events, one every `gap` ms; returns the deltas and the book. */
function run(events: RespectEvent[], gap = 1000, book: RespectBook = newBook(T0), t0 = T0) {
  const ds: number[] = [];
  let b = book;
  events.forEach((e, i) => {
    const r = apply(b, e, t0 + i * gap);
    b = r.book;
    ds.push(r.delta);
  });
  return { ds, book: b };
}

const one = (e: RespectEvent) => apply(newBook(T0), e, T0);

describe('every event kind', () => {
  const cases: [RespectEvent, number, string][] = [
    [{ kind: 'gift', to: 'Nadia', coin: 5 }, 4, 'gave Nadia 5 COIN'],
    [{ kind: 'gift', to: 'Nadia', coin: 1 }, 2, 'gave Nadia 1 COIN'],
    [{ kind: 'gift', to: 'Nadia', coin: 1000 }, 12, 'gave Nadia 1,000 COIN'],
    [{ kind: 'gift', to: 'Nadia', coin: 0 }, 0, 'gave Nadia 0 COIN'],
    [{ kind: 'ate', at: 'Cafe Noun', thanked: false }, 1, 'ate at Cafe Noun'],
    [{ kind: 'ate', at: 'Cafe Noun', thanked: true }, 3, 'ate at Cafe Noun, said thanks'],
    [{ kind: 'refused_food', at: 'Cafe Noun' }, -2, 'turned down food at Cafe Noun'],
    [{ kind: 'bought', at: 'Shop', coin: 3 }, 1, 'bought local at Shop'],
    [{ kind: 'bought', at: 'Shop', coin: 10 }, 2, 'bought local at Shop'],
    [{ kind: 'bought', at: 'Shop', coin: 50 }, 3, 'bought local at Shop'],
    [{ kind: 'stole', at: 'Shop', coin: 0 }, -15, 'stole from Shop'],
    [{ kind: 'stole', at: 'Shop', coin: 40 }, -23, 'stole from Shop'],
    [{ kind: 'stole', at: 'Shop', coin: 9999 }, -30, 'stole from Shop'],
    [{ kind: 'sat', at: 'Bar' }, 1, 'sat a while at Bar'],
    [{ kind: 'overstayed', at: 'Bar' }, -4, 'overstayed at Bar'],
    [{ kind: 'helped', who: 'Ziggy' }, 5, 'helped Ziggy'],
    [{ kind: 'trick', score: 4999 }, 0, 'landed a 4,999 combo'],
    [{ kind: 'trick', score: 5000 }, 1, 'landed a 5,000 combo'],
    [{ kind: 'trick', score: 20_000 }, 2, 'landed a 20,000 combo'],
    [{ kind: 'trick', score: 60_000 }, 3, 'landed a 60,000 combo'],
    [{ kind: 'trick', score: 1_000_000 }, 4, 'landed a 1,000,000 combo'],
    [{ kind: 'bail_into', who: 'Ziggy' }, -3, 'bailed into Ziggy'],
    [{ kind: 'tagged_home', building: 'b1' }, -10, "tagged someone's home"],
    [{ kind: 'tagged_wall' }, 2, 'put up a piece'],
    [{ kind: 'served', town: 'cowboy', tip: 2 }, 1, 'served in cowboy'],
    [{ kind: 'served', town: 'cowboy', tip: 8 }, 2, 'served in cowboy, big tip'],
    [{ kind: 'served', town: 'cowboy', tip: 25 }, 3, 'served in cowboy, big tip'],
    [{ kind: 'hoops_win' }, 8, 'won at hoops'],
    [{ kind: 'hoops_loss' }, -1, 'lost at hoops'],
    [{ kind: 'break_win', crewSize: 2 }, 6, 'won a breakdance battle'],
    [{ kind: 'break_win', crewSize: 30 }, 10, 'won a breakdance battle'],
    [{ kind: 'break_loss', crewSize: 3 }, -1, 'lost a breakdance battle'],
    [{ kind: 'custom', label: 'found a lost cat', amount: 7 }, 7, 'found a lost cat'],
    [{ kind: 'custom', label: 'cheat', amount: 500 }, 10, 'cheat'],
    [{ kind: 'custom', label: 'oops', amount: -500 }, -10, 'oops'],
  ];
  it.each(cases)('%j → %i', (e, d, label) => {
    const r = one(e);
    expect(r.delta).toBe(d);
    expect(r.label).toBe(label);
    expect(r.book.score).toBe(d);
  });

  it('covers every kind in the contract', () => {
    const seen = new Set(cases.map(c => c[0].kind));
    for (const k of KINDS) expect(seen.has(k), k).toBe(true);
  });

  it('a neutral event (a small combo) scores 0 and is not logged', () => {
    const r = one({ kind: 'trick', score: 100 });
    expect(r.why).toBe('neutral');
    expect(r.book.log).toHaveLength(0);
  });
});

describe('rate limits', () => {
  it('caps each kind per rolling minute, then frees up', () => {
    const big = { kind: 'trick', score: 10_000 } as const;
    const { ds, book } = run([big, big, big, big, big], 5000);
    expect(ds).toEqual([1, 1, 1, 0, 0]);
    // A minute after the first, one slot is free again
    expect(apply(book, big, T0 + MINUTE + 1).delta).toBe(1);
  });

  it.each(KINDS.filter(k => k !== 'gift'))('%s has a per-minute cap', k => {
    expect(RULES[k].perMin).toBeGreaterThan(0);
    expect(RULES[k].perMin).toBeLessThanOrEqual(6);
  });

  it('same-target cooldowns: one meal per place per 5 min, other places still count', () => {
    const ate = (at: string) => ({ kind: 'ate', at, thanked: true }) as const;
    const { ds } = run([ate('A'), ate('A'), ate('B')], 1000);
    expect(ds).toEqual([3, 0, 3]);
    const r = run([ate('A')]).book;
    expect(apply(r, ate('A'), T0 + 5 * MINUTE + 1).delta).toBe(3);
  });

  it('bailing into the same person twice within 30 s counts once', () => {
    const b = { kind: 'bail_into', who: 'Ziggy' } as const;
    expect(run([b, b], 10_000).ds).toEqual([-3, 0]);
    expect(run([b, b], 31_000).ds).toEqual([-3, -3]);
  });

  it('tagging the same home is one hit per 3 min', () => {
    const t = { kind: 'tagged_home', building: 'b1' } as const;
    expect(run([t, t, { kind: 'tagged_home', building: 'b2' }], 1000).ds).toEqual([-10, 0, -10]);
  });

  it('gifts diminish per recipient within the hour', () => {
    const g = (to: string) => ({ kind: 'gift', to, coin: 25 }) as const;
    const { ds } = run([g('Nadia'), g('Nadia'), g('Nadia'), g('Nadia'), g('Bob')], 11_000);
    expect(ds).toEqual([10, 5, 3, 1, 10]);
    // An hour later, Nadia is full price again
    const { book } = run([g('Nadia'), g('Nadia')], 1000);
    expect(apply(book, g('Nadia'), T0 + 3600_000 + 2000).delta).toBe(10);
  });

  it('caps all gains at +40 a minute (clipping the last one)', () => {
    const evs: RespectEvent[] = [
      { kind: 'hoops_win' },
      { kind: 'hoops_win' },
      { kind: 'helped', who: 'a' },
      { kind: 'helped', who: 'b' },
      { kind: 'helped', who: 'c' },
      { kind: 'gift', to: 'x', coin: 100 },
      { kind: 'gift', to: 'y', coin: 100 },
    ];
    const { ds, book } = run(evs, 1000);
    expect(ds).toEqual([8, 8, 5, 5, 5, 9, 0]);
    expect(ds.reduce((a, b) => a + b, 0)).toBe(GAIN_PER_MIN);
    expect(book.score).toBe(GAIN_PER_MIN);
  });

  it('caps all losses at −60 a minute', () => {
    const evs: RespectEvent[] = [
      { kind: 'stole', at: 'a', coin: 1000 },
      { kind: 'stole', at: 'b', coin: 1000 },
      { kind: 'stole', at: 'c', coin: 1000 },
      { kind: 'tagged_home', building: 'h' },
    ];
    const { ds } = run(evs, 1000);
    expect(ds).toEqual([-30, -30, 0, 0]);
    expect(-ds.reduce((a, b) => a + b, 0)).toBe(LOSS_PER_MIN);
  });

  it('a long grind can only farm the per-minute rate', () => {
    // A 10k combo every 2 s for 10 minutes: 3 a minute
    const evs = Array.from({ length: 300 }, () => ({ kind: 'trick', score: 10_000 }) as const);
    expect(run(evs, 2000).book.score).toBe(30);
  });
});

describe('tiers and hysteresis', () => {
  it('thresholds on the way up', () => {
    expect(tierFor(-41)).toBe('outcast');
    expect(tierFor(-40)).toBe('stranger');
    expect(tierFor(49.99)).toBe('stranger');
    expect(tierFor(50)).toBe('local');
    expect(tierFor(200)).toBe('regular');
    expect(tierFor(600)).toBe('legend');
    expect(tierFor(1e6)).toBe('legend');
  });

  it("keeps a tier until you're its slack below the line", () => {
    expect(tierFor(45, 'local')).toBe('local');
    expect(tierFor(40, 'local')).toBe('local');
    expect(tierFor(39.9, 'local')).toBe('stranger');
    expect(tierFor(560, 'legend')).toBe('legend');
    expect(tierFor(539, 'legend')).toBe('regular');
    expect(tierFor(-45, 'stranger')).toBe('stranger');
    expect(tierFor(-51, 'stranger')).toBe('outcast');
  });

  it("a fall lands in the tier below with that tier's slack too", () => {
    expect(tierFor(185, 'legend')).toBe('regular');
    expect(tierFor(170, 'legend')).toBe('local');
  });

  it('does not flicker at a line', () => {
    let b = newBook(T0);
    b = { ...b, score: 48 };
    const up = apply(b, { kind: 'served', town: 't', tip: 30 }, T0);
    expect(up.book.tier).toBe('local');
    const down = apply(up.book, { kind: 'bail_into', who: 'z' }, T0 + 1000);
    expect(down.book.score).toBe(48);
    expect(down.book.tier).toBe('local');
  });

  it('progress through a tier', () => {
    expect(progressOf(50, 'local')).toBe(0);
    expect(progressOf(125, 'local')).toBe(0.5);
    expect(progressOf(45, 'local')).toBe(0);
    expect(progressOf(-40, 'stranger')).toBe(0);
    expect(progressOf(5, 'stranger')).toBe(0.5);
    expect(progressOf(1500, 'legend')).toBe(1);
    expect(progressOf(-200, 'outcast')).toBe(0);
  });
});

describe('drift', () => {
  it('halves the excess over the tier floor every 3 days, never losing the tier', () => {
    const b: RespectBook = { score: 150, tier: 'local', at: T0, log: [] };
    expect(drift(b, T0 + HALF_LIFE_MS).score).toBe(100);
    const later = drift(b, T0 + 20 * HALF_LIFE_MS);
    expect(later.score).toBeGreaterThanOrEqual(50);
    expect(later.tier).toBe('local');
    const legend = drift({ score: 700, tier: 'legend', at: T0, log: [] }, T0 + 1e12);
    expect(legend.tier).toBe('legend');
  });

  it('strangers above 0 drift to 0', () => {
    expect(drift({ score: 20, tier: 'stranger', at: T0, log: [] }, T0 + HALF_LIFE_MS).score).toBe(
      10,
    );
  });

  it('forgives a negative score at +1 per 5 minutes, up to 0', () => {
    const b: RespectBook = { score: -100, tier: 'outcast', at: T0, log: [] };
    expect(drift(b, T0 + 10 * FORGIVE_MS).score).toBe(-90);
    const healed = drift(b, T0 + 200 * FORGIVE_MS);
    expect(healed.score).toBe(0);
    expect(healed.tier).toBe('stranger');
  });

  it('does nothing in the hysteresis band or for time going backwards', () => {
    const b: RespectBook = { score: 45, tier: 'local', at: T0, log: [] };
    expect(drift(b, T0 + HALF_LIFE_MS).score).toBe(45);
    expect(drift(b, T0 - 1000)).toBe(b);
  });

  it('is applied before an event is scored', () => {
    const b: RespectBook = { score: 150, tier: 'local', at: T0, log: [] };
    const r = apply(b, { kind: 'helped', who: 'a' }, T0 + HALF_LIFE_MS);
    expect(r.book.score).toBe(105);
  });
});

describe('validation', () => {
  it('accepts every well-formed event', () => {
    expect(parseEvent({ kind: 'gift', to: 'Nadia', coin: 5 })).toEqual({
      kind: 'gift',
      to: 'Nadia',
      coin: 5,
    });
    expect(parseEvent({ kind: 'hoops_win' })).toEqual({ kind: 'hoops_win' });
    expect(parseEvent({ kind: 'tagged_wall' })).toEqual({ kind: 'tagged_wall' });
    expect(parseEvent({ kind: 'ate', at: 'x', thanked: 'yes' })).toEqual({
      kind: 'ate',
      at: 'x',
      thanked: false,
    });
  });

  it.each([
    null,
    'gift',
    { kind: 'score', amount: 1000 },
    { kind: 'gift', to: 'x', coin: -1 },
    { kind: 'gift', to: 'x', coin: Infinity },
    { kind: 'gift', to: '', coin: 5 },
    { kind: 'trick', score: '50000' },
    { kind: 'trick', score: NaN },
    { kind: 'served', town: 't' },
    { kind: 'break_win' },
    { kind: 'custom', label: 'x' },
    { kind: 'bail_into', who: 42 },
  ])('rejects %j', v => {
    expect(parseEvent(v)).toBeNull();
  });

  it('cleans strings (no markup, short)', () => {
    const e = parseEvent({ kind: 'helped', who: `<b>${'z'.repeat(100)}` });
    expect(e).not.toBeNull();
    expect((e as { who: string }).who).toBe('b' + 'z'.repeat(47));
  });

  it('normalizes junk books to a fresh one', () => {
    expect(normalizeBook('nope', T0)).toEqual(newBook(T0));
    expect(normalizeBook({ score: 'lots' }, T0)).toEqual(newBook(T0));
    const b = normalizeBook(
      {
        score: 70,
        tier: 'legend',
        at: T0,
        log: [{ k: 'trick', d: 1, at: T0 }, { k: 'bogus', d: 1, at: T0 }, null],
      },
      T0,
    );
    // A stored tier can't lift you above what the score earns
    expect(b.tier).toBe('local');
    expect(b.log).toEqual([{ k: 'trick', d: 1, at: T0 }]);
  });

  it('ticker text', () => {
    expect(tickerText(4, 'gave Nadia 5 COIN')).toBe('+4 RESPECT, gave Nadia 5 COIN');
    expect(tickerText(-3, 'bailed into Ziggy')).toBe('−3 RESPECT, bailed into Ziggy');
  });
});
