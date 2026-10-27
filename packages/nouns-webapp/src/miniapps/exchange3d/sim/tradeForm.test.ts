import type { Ticker, YouView } from '../../exchange/engine/types';

import { describe, expect, it } from 'vitest';

import { defaultPrice, formAction, formProblem, openForm, type TradeTarget } from './tradeForm';

const tick: Ticker = { good: 'FISH', last: 12, bid: 11, ask: 14, chg: 0, vol: 0, fair: 12.5 };
const you = (o: Partial<YouView> = {}): YouView => ({
  owner: 'you',
  coin: 100,
  lockCoin: 0,
  goods: {},
  lockGoods: {},
  orders: [],
  fills: [],
  equity: 100,
  ...o,
});
const peer: TradeTarget = {
  kind: 'peer',
  key: 'p1',
  name: 'NOUN 7',
  tag: 'r:abc1234',
  seedKey: '0-1-2-3-4',
};
const bot: TradeTarget = { kind: 'bot', key: 'b', name: 'Abacus', bot: 'bot:abacus' };
const sim: TradeTarget = { kind: 'sim', key: 's', name: 'TRADER #3', good: 'FISH' };

describe('exchange3d trade panel', () => {
  it('opens on the price you would trade against', () => {
    expect(defaultPrice('buy', tick, 'FISH')).toBe(14);
    expect(defaultPrice('sell', tick, 'FISH')).toBe(11);
    expect(defaultPrice('buy', undefined, 'FISH')).toBeGreaterThan(0);
    // Holding the good: open on selling it
    expect(openForm(sim, [tick], you({ goods: { FISH: 3 } }), 'ICECREAM')).toMatchObject({
      side: 'sell',
      good: 'FISH',
      price: 11,
    });
    expect(openForm(peer, [tick], you(), 'FISH').side).toBe('buy');
  });

  it('says what is wrong before sending', () => {
    const f = { side: 'buy' as const, good: 'FISH' as const, qty: 2, price: 14 };
    expect(formProblem(f, you())).toBeNull();
    expect(formProblem({ ...f, qty: 0 }, you())).toMatch(/qty/);
    expect(formProblem({ ...f, qty: 1.5 }, you())).toMatch(/qty/);
    expect(formProblem({ ...f, price: 0 }, you())).toMatch(/price/);
    expect(formProblem({ ...f, qty: 10 }, you())).toBe('you have 100 COIN');
    expect(formProblem({ ...f, side: 'sell' }, you())).toBe('you have 0 FISH');
    expect(formProblem({ ...f, side: 'sell' }, you({ goods: { FISH: 2 } }))).toBeNull();
  });

  it('routes each kind of trader to the right exchange action', () => {
    const f = { side: 'sell' as const, good: 'FISH' as const, qty: 2, price: 13 };
    expect(formAction(peer, f)).toEqual({
      t: 'offer',
      to: 'r:abc1234',
      side: 'sell',
      good: 'FISH',
      qty: 2,
      price: 13,
    });
    expect(formAction(bot, f)).toMatchObject({ t: 'offer', to: 'bot:abacus' });
    expect(formAction(sim, f)).toEqual({
      t: 'order',
      side: 'sell',
      good: 'FISH',
      qty: 2,
      price: 13,
      kind: 'limit',
    });
  });
});
