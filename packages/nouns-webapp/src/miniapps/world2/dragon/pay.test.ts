import { describe, expect, it } from 'vitest';

import { TradeClient } from '../trade/TradeClient';

import { buyDragon, coinOf, DRAGON_COST, dragonOwned } from './pay';

describe('buying a dragon (offline, ?purse=)', () => {
  it('the starter purse can not afford one', async () => {
    const game = { trade: new TradeClient({ offline: true, rider: 'r-poor' }) };
    expect(coinOf(game)!).toBeLessThan(DRAGON_COST);
    const r = await buyDragon(game, 'noggle');
    expect(r.ok).toBe(false);
    expect(dragonOwned(game)).toBe(false);
  });

  it('with a dev purse: buy → owned, coin spent; a second buy is refused', async () => {
    const game = { trade: new TradeClient({ offline: true, rider: 'r-rich', devPurse: 5000 }) };
    expect(coinOf(game)).toBe(5000);
    const r = await buyDragon(game, 'noggle');
    expect(r).toMatchObject({ ok: true });
    expect(dragonOwned(game)).toBe(true);
    expect(coinOf(game)).toBe(5000 - DRAGON_COST);
    expect((await buyDragon(game, 'noggle')).ok).toBe(false);
  });

  it('the dev purse is ignored online (the server holds the books)', () => {
    const t = new TradeClient({
      offline: false,
      rider: 'r-online',
      devPurse: 5000,
      fetchFn: () => Promise.reject(new Error('no network in tests')),
    });
    expect(t.state).toBeNull();
  });
});
