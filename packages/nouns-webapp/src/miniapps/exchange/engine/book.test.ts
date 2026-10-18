import { describe, expect, it } from 'vitest';

import {
  cancel,
  checkInvariants,
  createState,
  FEE_BPS,
  feeOf,
  MAX_OPEN,
  MAX_SIDE,
  mint,
  ordersOf,
  place,
  placeMarket,
} from './book';

const T0 = Date.UTC(2026, 9, 18, 12);

function fresh() {
  const s = createState(1, T0);
  mint(s, 'alice', 10_000, { FISH: 100, PIZZA: 50 });
  mint(s, 'bob', 10_000, { FISH: 100, PIZZA: 50 });
  mint(s, 'carol', 10_000, { FISH: 100 });
  return s;
}
const ok = (s: ReturnType<typeof fresh>) => expect(checkInvariants(s)).toEqual([]);

describe('order book: priority and matching', () => {
  it('rests non-crossing orders sorted by price, then time', () => {
    const s = fresh();
    place(s, { owner: 'alice', side: 'buy', good: 'FISH', qty: 1, price: 5 });
    place(s, { owner: 'bob', side: 'buy', good: 'FISH', qty: 1, price: 6 });
    place(s, { owner: 'carol', side: 'buy', good: 'FISH', qty: 1, price: 5 });
    place(s, { owner: 'alice', side: 'sell', good: 'FISH', qty: 1, price: 9 });
    place(s, { owner: 'bob', side: 'sell', good: 'FISH', qty: 1, price: 8 });
    expect(s.books.FISH.bids.map(o => [o.owner, o.price])).toEqual([
      ['bob', 6],
      ['alice', 5],
      ['carol', 5],
    ]);
    expect(s.books.FISH.asks.map(o => o.price)).toEqual([8, 9]);
    ok(s);
  });

  it('fills best price first, then the oldest order at that price', () => {
    const s = fresh();
    place(s, { owner: 'alice', side: 'sell', good: 'FISH', qty: 2, price: 7 });
    place(s, { owner: 'bob', side: 'sell', good: 'FISH', qty: 2, price: 7 });
    place(s, { owner: 'carol', side: 'sell', good: 'FISH', qty: 2, price: 6 });
    const r = place(s, { owner: 'alice', side: 'buy', good: 'PIZZA', qty: 1, price: 1 }); // other book untouched
    expect(r.fills).toEqual([]);
    mint(s, 'dave', 1000);
    const b = place(s, { owner: 'dave', side: 'buy', good: 'FISH', qty: 5, price: 7 });
    expect(b.fills.map(f => [f.seller, f.qty, f.price])).toEqual([
      ['carol', 2, 6],
      ['alice', 2, 7],
      ['bob', 1, 7],
    ]);
    expect(s.books.FISH.asks).toHaveLength(1);
    expect(s.books.FISH.asks[0]).toMatchObject({ owner: 'bob', filled: 1, qty: 2 });
    ok(s);
  });

  it('partial fills rest the remainder at the limit', () => {
    const s = fresh();
    place(s, { owner: 'alice', side: 'sell', good: 'FISH', qty: 3, price: 6 });
    const r = place(s, { owner: 'bob', side: 'buy', good: 'FISH', qty: 10, price: 6 });
    expect(r.fills).toHaveLength(1);
    expect(r.order).toMatchObject({ qty: 10, filled: 3 });
    expect(s.books.FISH.bids[0]).toMatchObject({ owner: 'bob', price: 6, filled: 3 });
    expect(s.accounts.bob.lockCoin).toBe(7 * 6);
    ok(s);
  });

  it('trades at the maker price and refunds a taker buy the difference', () => {
    const s = fresh();
    place(s, { owner: 'alice', side: 'sell', good: 'FISH', qty: 4, price: 5 });
    const before = s.accounts.bob.coin;
    place(s, { owner: 'bob', side: 'buy', good: 'FISH', qty: 4, price: 9 });
    expect(s.accounts.bob.coin).toBe(before - 4 * 5);
    expect(s.accounts.bob.lockCoin).toBe(0);
    expect(s.accounts.bob.goods.FISH).toBe(104);
    expect(s.last.FISH).toBe(5);
    ok(s);
  });

  it('the seller pays the fee into the treasury', () => {
    const s = fresh();
    place(s, { owner: 'alice', side: 'buy', good: 'PIZZA', qty: 50, price: 20 });
    const before = s.accounts.bob.coin;
    place(s, { owner: 'bob', side: 'sell', good: 'PIZZA', qty: 50, price: 20 });
    const fee = feeOf(1000);
    expect(fee).toBe((1000 * FEE_BPS) / 10_000);
    expect(s.accounts.bob.coin).toBe(before + 1000 - fee);
    expect(s.treasury).toBe(fee);
    ok(s);
  });

  it('ioc never rests: the unfilled part is released', () => {
    const s = fresh();
    place(s, { owner: 'alice', side: 'sell', good: 'FISH', qty: 2, price: 6 });
    const r = place(s, { owner: 'bob', side: 'buy', good: 'FISH', qty: 5, price: 6, tif: 'ioc' });
    expect(r.fills[0].qty).toBe(2);
    expect(r.cancelled).toBe(3);
    expect(s.books.FISH.bids).toHaveLength(0);
    expect(s.accounts.bob.lockCoin).toBe(0);
    ok(s);
  });

  it('refuses what you cannot afford and malformed orders', () => {
    const s = fresh();
    expect(
      place(s, { owner: 'alice', side: 'buy', good: 'FISH', qty: 2, price: 6000 }).reason,
    ).toBe('not enough COIN');
    expect(place(s, { owner: 'carol', side: 'sell', good: 'PIZZA', qty: 1, price: 6 }).reason).toBe(
      'not enough PIZZA',
    );
    expect(place(s, { owner: 'alice', side: 'buy', good: 'FISH', qty: 1.5, price: 6 }).ok).toBe(
      false,
    );
    expect(place(s, { owner: 'alice', side: 'buy', good: 'FISH', qty: 1, price: 0 }).ok).toBe(
      false,
    );
    expect(
      place(s, { owner: 'alice', side: 'buy', good: 'GOLD' as never, qty: 1, price: 1 }).ok,
    ).toBe(false);
    ok(s);
  });
});

describe('order book: cancels and self-trades', () => {
  it('cancel returns escrow; only the owner can cancel', () => {
    const s = fresh();
    const b = place(s, { owner: 'alice', side: 'buy', good: 'FISH', qty: 3, price: 5 }).order!;
    const a = place(s, { owner: 'alice', side: 'sell', good: 'PIZZA', qty: 7, price: 30 }).order!;
    expect(s.accounts.alice.lockCoin).toBe(15);
    expect(s.accounts.alice.lockGoods.PIZZA).toBe(7);
    expect(cancel(s, 'bob', b.id)).toMatchObject({ ok: false, reason: 'not your order' });
    expect(cancel(s, 'alice', b.id).ok).toBe(true);
    expect(cancel(s, 'alice', a.id).ok).toBe(true);
    expect(cancel(s, 'alice', a.id)).toMatchObject({ ok: false });
    expect(s.accounts.alice).toMatchObject({
      coin: 10_000,
      lockCoin: 0,
      goods: { FISH: 100, PIZZA: 50 },
    });
    ok(s);
  });

  it('cancel after a partial fill releases only the rest', () => {
    const s = fresh();
    const o = place(s, { owner: 'alice', side: 'buy', good: 'FISH', qty: 10, price: 5 }).order!;
    place(s, { owner: 'bob', side: 'sell', good: 'FISH', qty: 4, price: 5 });
    cancel(s, 'alice', o.id);
    expect(s.accounts.alice.coin).toBe(10_000 - 20);
    expect(s.accounts.alice.goods.FISH).toBe(104);
    ok(s);
  });

  it('self-trade prevention cancels your resting order instead of trading with yourself', () => {
    const s = fresh();
    place(s, { owner: 'alice', side: 'sell', good: 'FISH', qty: 2, price: 5 });
    place(s, { owner: 'bob', side: 'sell', good: 'FISH', qty: 2, price: 6 });
    const r = place(s, { owner: 'alice', side: 'buy', good: 'FISH', qty: 2, price: 6 });
    expect(r.fills.map(f => f.seller)).toEqual(['bob']);
    expect(s.books.FISH.asks).toHaveLength(0);
    expect(s.fills.some(f => f.buyer === f.seller)).toBe(false);
    ok(s);
  });
});

describe('order book: market orders, caps, candles', () => {
  it('market buy walks the book up to what you can afford', () => {
    const s = fresh();
    place(s, { owner: 'alice', side: 'sell', good: 'FISH', qty: 3, price: 5 });
    place(s, { owner: 'bob', side: 'sell', good: 'FISH', qty: 3, price: 8 });
    mint(s, 'poor', 30);
    const r = placeMarket(s, { owner: 'poor', side: 'buy', good: 'FISH', qty: 6 });
    // 30 COIN: escrow is qty * worst level, so 3 @ 5 then (30/8 = 3) - 3 = 0 more
    expect(r.fills.map(f => [f.qty, f.price])).toEqual([[3, 5]]);
    expect(s.accounts.poor.coin).toBe(15);
    mint(s, 'rich', 1000);
    const r2 = placeMarket(s, { owner: 'rich', side: 'buy', good: 'FISH', qty: 100 });
    expect(r2.fills.map(f => [f.qty, f.price])).toEqual([[3, 8]]);
    expect(s.books.FISH.bids).toHaveLength(0);
    ok(s);
  });

  it('market sell hits bids, best first, and says so when there are none', () => {
    const s = fresh();
    expect(placeMarket(s, { owner: 'alice', side: 'sell', good: 'FISH', qty: 1 }).reason).toBe(
      'no bids',
    );
    place(s, { owner: 'bob', side: 'buy', good: 'FISH', qty: 2, price: 4 });
    place(s, { owner: 'carol', side: 'buy', good: 'FISH', qty: 2, price: 5 });
    const r = placeMarket(s, { owner: 'alice', side: 'sell', good: 'FISH', qty: 3 });
    expect(r.fills.map(f => [f.buyer, f.price])).toEqual([
      ['carol', 5],
      ['bob', 4],
    ]);
    ok(s);
  });

  it('caps open orders per owner', () => {
    const s = fresh();
    for (let i = 0; i < MAX_OPEN; i++) {
      expect(place(s, { owner: 'alice', side: 'buy', good: 'FISH', qty: 1, price: 1 + i }).ok).toBe(
        true,
      );
    }
    expect(
      place(s, { owner: 'alice', side: 'buy', good: 'FISH', qty: 1, price: 1 }).reason,
    ).toMatch(/max/);
    expect(ordersOf(s, 'alice')).toHaveLength(MAX_OPEN);
    ok(s);
  });

  it('a full side evicts its worst order for a better one (and refunds it)', () => {
    const s = fresh();
    for (let i = 0; i < MAX_SIDE; i++) mint(s, `m${i}`, 100);
    for (let i = 0; i < MAX_SIDE; i++)
      place(s, { owner: `m${i}`, side: 'buy', good: 'FISH', qty: 1, price: 10 + i });
    const worse = place(s, { owner: 'alice', side: 'buy', good: 'FISH', qty: 1, price: 5 });
    expect(worse.reason).toBe('book full at that price');
    expect(s.accounts.alice.lockCoin).toBe(0);
    place(s, { owner: 'alice', side: 'buy', good: 'FISH', qty: 1, price: 50 });
    expect(s.books.FISH.bids).toHaveLength(MAX_SIDE);
    expect(s.accounts.m0.lockCoin).toBe(0);
    expect(s.accounts.m0.coin).toBe(100);
    ok(s);
  });

  it('builds minute and hour OHLCV candles from fills', () => {
    const s = fresh();
    const at = (ms: number) => T0 + ms;
    const trade = (price: number, qty: number, t: number) => {
      place(s, { owner: 'alice', side: 'sell', good: 'FISH', qty, price }, at(t));
      place(s, { owner: 'bob', side: 'buy', good: 'FISH', qty, price }, at(t));
    };
    trade(6, 1, 0);
    trade(8, 2, 10_000);
    trade(5, 3, 20_000);
    trade(7, 1, 70_000);
    expect(s.candles.FISH.m).toEqual([
      { t: T0, o: 6, h: 8, l: 5, c: 5, v: 6 },
      { t: T0 + 60_000, o: 7, h: 7, l: 7, c: 7, v: 1 },
    ]);
    expect(s.candles.FISH.h).toEqual([{ t: T0, o: 6, h: 8, l: 5, c: 7, v: 7 }]);
    ok(s);
  });
});
