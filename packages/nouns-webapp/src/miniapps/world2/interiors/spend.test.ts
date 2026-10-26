import { describe, expect, it } from 'vitest';

import { applyAction, audit, newRow, parseAction } from '../trade/ledger';
import { freshMarkets } from '../trade/market';

// The trade ledger's `spend` action (added for interiors: gifts, meals
// eaten in, services). A coin sink: it can only ever take your own COIN.

describe("ledger: 'spend'", () => {
  const now = 1_000_000;

  it('parses a valid spend and rejects bad ones', () => {
    const ok = parseAction({
      t: 'spend',
      town: 'city',
      to: 'plaza:-0.4,85#1',
      coin: 5,
      what: 'gift',
    });
    expect('a' in ok).toBe(true);
    expect(
      'error' in parseAction({ t: 'spend', town: 'city', to: 'x', coin: 0, what: 'gift' }),
    ).toBe(true);
    expect(
      'error' in parseAction({ t: 'spend', town: 'city', to: 'x', coin: 101, what: 'gift' }),
    ).toBe(true);
    expect(
      'error' in parseAction({ t: 'spend', town: 'city', to: 'x', coin: 2.5, what: 'gift' }),
    ).toBe(true);
    expect(
      'error' in parseAction({ t: 'spend', town: 'mars', to: 'x', coin: 1, what: 'gift' }),
    ).toBe(true);
    expect(
      'error' in parseAction({ t: 'spend', town: 'city', to: 'x', coin: 1, what: 'loot' }),
    ).toBe(true);
    expect(
      'error' in parseAction({ t: 'spend', town: 'city', to: '<script>', coin: 1, what: 'meal' }),
    ).toBe(true);
  });

  it('takes the coin and keeps the books balanced', () => {
    const row = newRow('r1', now);
    const o = applyAction(
      row,
      freshMarkets(now),
      { t: 'spend', town: 'city', to: 'a', coin: 25, what: 'gift' },
      now,
    );
    expect(o.ok).toBe(true);
    if (!o.ok) return;
    expect(o.row.coin).toBe(row.coin - 25);
    expect(o.coin).toBe(-25);
    expect(audit(o.row)).toBe(true);
  });

  it('never spends more than you have', () => {
    const row = { ...newRow('r1', now), coin: 3 };
    const o = applyAction(
      row,
      freshMarkets(now),
      { t: 'spend', town: 'city', to: 'a', coin: 5, what: 'meal' },
      now,
    );
    expect(o.ok).toBe(false);
  });
});
