import { describe, expect, it } from 'vitest';

import { maskOwner } from '../../exchange3d/sim/feed';
import { LocalExchange } from '../client';

import { checkInvariants } from './book';
import { botTakes, checkDeal, dealAct, dealsView, DEAL_TTL_MS } from './deals';
import { fairValue } from './goods';
import { genesis, riderAccount } from './sim';

const T0 = Date.UTC(2026, 9, 20, 12);
const tagOf = (o: string) => maskOwner(o, null);

describe('direct deals (engine)', () => {
  it('checks shapes before anything else', () => {
    expect(checkDeal({ t: 'accept', deal: 'o12' })).toBe('bad deal id');
    expect(checkDeal({ t: 'decline', deal: 'd7' })).toBeNull();
    expect(
      checkDeal({ t: 'offer', to: 'bot:nobody', side: 'buy', good: 'FISH', qty: 1, price: 1 }),
    ).toBe('bad target');
    expect(
      checkDeal({ t: 'offer', to: 'r:abc', side: 'buy', good: 'FISH', qty: 1, price: 1 }),
    ).toBeNull();
  });

  it('settles a rider-to-rider deal exactly, fee to the treasury, on the tape', () => {
    const s = genesis(3, T0, 0);
    const a = riderAccount(s, 'rider-a-000001', T0);
    const b = riderAccount(s, 'rider-b-000002', T0);
    a.goods.FISH = 10;
    s.mintedGoods.FISH = (s.mintedGoods.FISH ?? 0) + 10;
    const o = dealAct(
      s,
      'rider-a-000001',
      { t: 'offer', to: tagOf('rider-b-000002'), side: 'sell', good: 'FISH', qty: 10, price: 20 },
      T0,
      tagOf,
    );
    expect(o.ok).toBe(true);
    const inbox = dealsView(s, 'rider-b-000002', T0, tagOf).incoming;
    expect(inbox).toHaveLength(1);
    const treasury = s.treasury;
    const r = dealAct(s, 'rider-b-000002', { t: 'accept', deal: inbox[0]!.id }, T0 + 1000, tagOf);
    expect(r.ok).toBe(true);
    expect(b.goods.FISH).toBe(10);
    expect(b.coin).toBe(500 - 200);
    expect(a.coin).toBe(500 + 200 - 2);
    expect(s.treasury).toBe(treasury + 2);
    expect(s.fills.at(-1)).toMatchObject({
      buyer: 'rider-b-000002',
      seller: 'rider-a-000001',
      price: 20,
    });
    expect(checkInvariants(s)).toEqual([]);
    // Expired offers are invisible and get pruned
    dealAct(
      s,
      'rider-a-000001',
      { t: 'offer', to: tagOf('rider-b-000002'), side: 'buy', good: 'FISH', qty: 1, price: 1 },
      T0,
      tagOf,
    );
    expect(dealsView(s, 'rider-b-000002', T0 + DEAL_TTL_MS + 1, tagOf).incoming).toEqual([]);
  });

  it('bots: buy under fair, sell over it, within their means', () => {
    const s = genesis(5, T0, 0);
    const fair = fairValue('FISH', T0);
    expect(botTakes(s, 'bot:abacus', 'buy', 'FISH', 1, Math.ceil(fair * 1.3), T0).ok).toBe(false);
    expect(botTakes(s, 'bot:abacus', 'buy', 'FISH', 1, Math.floor(fair * 0.8), T0).ok).toBe(true);
    expect(botTakes(s, 'bot:abacus', 'sell', 'FISH', 1, Math.floor(fair * 0.8), T0).ok).toBe(false);
    expect(botTakes(s, 'bot:abacus', 'sell', 'FISH', 1, Math.ceil(fair * 1.3), T0).ok).toBe(true);
    expect(botTakes(s, 'bot:abacus', 'sell', 'FISH', 999, Math.ceil(fair * 1.3), T0).ok).toBe(
      false,
    );
  });

  it('works offline too (the in-tab exchange the 3D floor falls back to)', async () => {
    const x = new LocalExchange(7);
    const fair = fairValue('WATER', x.now());
    const r = await x.act(
      {
        t: 'offer',
        to: 'bot:abacus',
        side: 'buy',
        good: 'WATER',
        qty: 1,
        price: Math.ceil(fair * 1.3),
      },
      'WATER',
      'm',
    );
    expect(r.ok).toBe(true);
    expect(r.snapshot.you?.goods.WATER).toBe(1);
    expect(r.deals).toEqual({ incoming: [], outgoing: [] });
    expect(checkInvariants(x.state)).toEqual([]);
  });
});
