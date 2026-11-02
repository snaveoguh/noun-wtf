import { describe, expect, it } from 'vitest';

import {
  applyAction,
  audit,
  fareCap,
  normalizeRow,
  parseAction,
  RULES,
  newRow,
} from '../../trade/ledger';
import { freshMarkets } from '../../trade/market';
import { travelMetres } from '../../trade/towns';

import { maxPay } from './pay';

const T0 = Date.UTC(2026, 10, 1, 12);

const fare = (o: Partial<Record<string, unknown>> = {}) =>
  parseAction({
    t: 'fare',
    town: 'cowboy',
    from: 'city',
    coin: 100,
    metres: 11_600,
    who: 'f1',
    kind: 'fare',
    ...o,
  });

describe('the ledger pays taxi fares', () => {
  it('parses a fare and refuses junk', () => {
    expect('a' in fare()).toBe(true);
    expect('error' in fare({ town: 'mars' })).toBe(true);
    expect('error' in fare({ coin: 0 })).toBe(true);
    expect('error' in fare({ coin: 1.5 })).toBe(true);
    expect('error' in fare({ who: '<b>' })).toBe(true);
    expect('error' in fare({ kind: 'limo' })).toBe(true);
    expect('error' in fare({ metres: -1 })).toBe(true);
  });

  it('pays up to the cap, books it as earned, and the books balance', () => {
    const row = { ...newRow('r1', T0), last: null };
    const m = freshMarkets(T0);
    const p = fare() as { a: Parameters<typeof applyAction>[2] };
    const o = applyAction(row, m, p.a, T0 + 10 * 60_000);
    expect(o.ok).toBe(true);
    if (!o.ok) return;
    expect(o.row.coin).toBe(row.coin + 100);
    expect(o.row.book.earned).toBe(100);
    expect(audit(o.row)).toBe(true);
    expect(o.row.fareAt).toBe(T0 + 10 * 60_000);
    // the row keeps fareAt through a save / load
    expect(normalizeRow(JSON.parse(JSON.stringify(o.row)), 'r1', T0).fareAt).toBe(o.row.fareAt);
  });

  it('caps by the road between the towns, not the metres claimed', () => {
    const lie = {
      from: 'city' as const,
      town: 'city' as const,
      metres: 100_000,
      kind: 'fare' as const,
    };
    expect(fareCap(lie)).toBe(maxPay(RULES.FARE_SLACK_M));
    const row = newRow('r1', T0);
    const p = parseAction({ ...lie, t: 'fare', who: 'x', coin: fareCap(lie) + 1 }) as {
      a: Parameters<typeof applyAction>[2];
    };
    const o = applyAction(row, freshMarkets(T0), p.a, T0 + 60_000);
    expect(o.ok).toBe(false);
  });

  it('refuses a fare too soon after the last, the same passenger twice, and a teleport', () => {
    let row = newRow('r1', T0);
    const m = freshMarkets(T0);
    const act = (o: Record<string, unknown>, at: number) =>
      applyAction(
        row,
        m,
        (
          parseAction({
            t: 'fare',
            from: 'city',
            town: 'city',
            coin: 10,
            metres: 400,
            kind: 'fare',
            who: 'a',
            ...o,
          }) as { a: Parameters<typeof applyAction>[2] }
        ).a,
        at,
      );
    let o = act({}, T0 + 1000);
    expect(o.ok).toBe(true);
    row = o.row;
    expect(act({ who: 'b' }, T0 + 3000).ok).toBe(false);
    expect(act({ who: 'a' }, T0 + 30_000).ok).toBe(false);
    o = act({ who: 'b' }, T0 + 30_000);
    expect(o.ok).toBe(true);
    row = o.row;
    // Puerto Noun ~29 km away 20 s later: no car does that
    const far = act(
      { who: 'c', from: 'city', town: 'beach', metres: 29_000, coin: 100 },
      T0 + 50_000,
    );
    expect(far.ok).toBe(false);
    const ok = act(
      { who: 'c', from: 'city', town: 'beach', metres: 29_000, coin: 100 },
      T0 + 30_000 + (travelMetres('city', 'beach') / RULES.CAR_MAX_SPEED) * 1000,
    );
    expect(ok.ok).toBe(true);
  });
});
