import type { AgentDecision, AgentObs } from './contract';
import type { ExchangeState, GoodId } from '../exchange/engine/types';

import { describe, expect, it } from 'vitest';

import {
  bandOf,
  checkInvariants,
  dealAct,
  fairValue,
  genesis,
  playerAct,
  riderAccount,
  setShop,
  shopTakes,
  SHOP_TTL_MS,
  STARTER_COIN,
  tick,
} from '../exchange/engine';
import { maskOwner } from '../exchange3d/sim/feed';

import { guard, MAX_ACTIONS } from './guard';
import { llmDue, llmPrompt, parseDecision } from './llm';
import { collector } from './policies/collector';
import { makerQuote } from './policies/marketMaker';
import { shopkeeper, shopPrices } from './policies/shopkeeper';
import { stepToward } from './policies/util';
import { AGENT_BY_ID, AGENTS } from './roster';
import { agentsPublic, emptyDoc, ensureAgents, ledgerView, obsFor, runAgents } from './run';

const T0 = Date.UTC(2026, 10, 1, 12);
const MIN = 60_000;
const tagOf = (o: string) => maskOwner(o, null);

function world(seed = 3) {
  const ex = genesis(seed, T0, 2 * 3_600_000);
  const doc = emptyDoc(T0);
  return { ex, doc };
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function totalCoin(ex: ExchangeState) {
  let c = ex.treasury + ex.ext.coin;
  for (const a of Object.values(ex.accounts)) c += a.coin + a.lockCoin;
  return c;
}

describe('agent economy sim', () => {
  it('runs a simulated day: ledger conserved, prices bounded, agents funded once', () => {
    const { ex, doc } = world();
    const shopper = 'shopper-0001';
    riderAccount(ex, shopper, T0);
    let rnd = 12345;
    const r = () => (rnd = (Math.imul(rnd, 1103515245) + 12345) >>> 0) / 2 ** 32;
    let turns = 0;
    let shopSales = 0;
    for (let i = 1; i <= 288; i++) {
      const now = T0 + i * 5 * MIN;
      tick(ex, now);
      const mintedBefore = ex.minted;
      const out = runAgents(ex, doc, now, { tagOf });
      // A run never mints (after the agents' one-off starter grants on run 1)
      if (i > 1) expect(ex.minted).toBe(mintedBefore);
      expect(out.length).toBeLessThanOrEqual(AGENTS.length);
      turns += out.length;
      expect(checkInvariants(ex)).toEqual([]);
      expect(totalCoin(ex)).toBe(ex.minted);
      // Every posted price stays inside the band of fair value
      for (const [id, sh] of Object.entries(ex.shops ?? {})) {
        for (const [g, l] of Object.entries(sh.lines)) {
          const { lo, hi } = bandOf(g as GoodId, sh.at);
          for (const p of [l!.bid, l!.ask])
            if (p !== null) expect(p >= lo && p <= hi, `${id} ${g} ${p}`).toBe(true);
          if (l!.bid !== null && l!.ask !== null) expect(l!.bid).toBeLessThan(l!.ask);
        }
      }
      // A shopper buys from / sells to a random open shop at its posted price
      const at = now + 1000; // a player's request lands after the run
      const pub = agentsPublic(ex, doc, now).filter(a => a.lines !== null);
      if (pub.length > 0 && r() < 0.6) {
        const a = pub[Math.floor(r() * pub.length)]!;
        const goods = Object.keys(a.lines!) as GoodId[];
        const g = goods[Math.floor(r() * goods.length)]!;
        const l = a.lines![g]!;
        const res =
          r() < 0.7 && l.ask !== null
            ? dealAct(
                ex,
                shopper,
                { t: 'offer', to: a.id, side: 'buy', good: g, qty: 1, price: l.ask },
                at,
                tagOf,
              )
            : l.bid !== null && (ex.accounts[shopper]!.goods[g] ?? 0) > 0
              ? dealAct(
                  ex,
                  shopper,
                  { t: 'offer', to: a.id, side: 'sell', good: g, qty: 1, price: l.bid },
                  at,
                  tagOf,
                )
              : null;
        if (res?.ok === true) shopSales++;
        expect(checkInvariants(ex)).toEqual([]);
      }
    }
    expect(turns).toBeGreaterThan(100);
    expect(shopSales).toBeGreaterThan(10);
    // Funded exactly once each, with the rider's starter grant
    for (const def of AGENTS) expect(ex.accounts[def.id]!.grant).toBe(STARTER_COIN);
    // They actually traded and the ledger shows it (tags only)
    const fills = doc.ledger.filter(e => e.kind === 'fill');
    expect(fills.length).toBeGreaterThan(20);
    for (const e of fills)
      expect(e.with === 'you' || /^(r:|bot:|agent:)/.test(e.with ?? '')).toBe(true);
    expect(fills.some(e => e.with === tagOf(shopper))).toBe(true);
    expect(ledgerView(doc, 10)).toHaveLength(10);
    // Shopkeepers hold stock
    expect(
      Object.values(ex.accounts['agent:mochi']!.goods).reduce((a, b) => a + (b ?? 0), 0),
    ).toBeGreaterThan(0);
  });

  it('is deterministic from the same state', () => {
    const a = world(9);
    const b = { ex: clone(a.ex), doc: clone(a.doc) };
    for (let i = 1; i <= 24; i++) {
      const now = T0 + i * 5 * MIN;
      for (const w of [a, b]) {
        tick(w.ex, now);
        runAgents(w.ex, w.doc, now, { tagOf });
      }
    }
    expect(JSON.stringify(a.ex)).toBe(JSON.stringify(b.ex));
    expect(JSON.stringify(a.doc)).toBe(JSON.stringify(b.doc));
  });

  it('a paused agent takes no turns; one turn per agent per run, even forced', () => {
    const { ex, doc } = world();
    ensureAgents(ex, doc, T0);
    doc.agents['agent:reel']!.paused = true;
    const out = runAgents(ex, doc, T0 + MIN, { force: true, tagOf });
    expect(out.map(t => t.id).sort()).toEqual(
      AGENTS.map(a => a.id)
        .filter(id => id !== 'agent:reel')
        .sort(),
    );
    expect(runAgents(ex, doc, T0 + 2 * MIN, { tagOf })).toEqual([]); // not due yet
  });

  it('a broke agent stays broke: nothing tops it up', () => {
    const { ex, doc } = world();
    ensureAgents(ex, doc, T0);
    const a = ex.accounts['agent:magpie']!;
    ex.treasury += a.coin; // move its COIN out (a transfer, conserved)
    a.coin = 0;
    for (let i = 1; i <= 30; i++) {
      tick(ex, T0 + i * 5 * MIN);
      runAgents(ex, doc, T0 + i * 5 * MIN, { tagOf });
    }
    expect(a.grant).toBe(STARTER_COIN);
    expect(checkInvariants(ex)).toEqual([]);
  });
});

function obs(over: Partial<AgentObs> = {}): AgentObs {
  const def = AGENT_BY_ID['agent:mochi']!;
  const market: AgentObs['market'] = {};
  for (const g of def.goods) market[g] = { fair: 12, bid: 11, ask: 13, last: 12 };
  return {
    def,
    now: T0,
    turn: 0,
    coin: 400,
    lockCoin: 0,
    goods: {},
    lockGoods: {},
    orders: [],
    market,
    demand: {},
    quotes: {},
    notes: [],
    ...over,
  };
}

describe('rule policies', () => {
  it('shopkeeper: scarce stock prices higher, gluts lower, sold out has no ask', () => {
    const low = shopPrices(10, 2, 10, 0, 0.12);
    const high = shopPrices(10, 14, 10, 0, 0.12);
    expect(low.ask!).toBeGreaterThan(high.ask!);
    expect(low.bid!).toBeGreaterThan(0);
    expect(shopPrices(10, 15, 10, 0, 0.12).bid).toBeNull();
    expect(shopPrices(10, 0, 10, 0, 0.12).ask).toBeNull();
    expect(shopPrices(10, 5, 10, 10, 0.12).ask!).toBeGreaterThan(
      shopPrices(10, 5, 10, 0, 0.12).ask!,
    );
  });

  it('prices move at most a step a turn', () => {
    expect(stepToward(10, 30, 0.1)).toBeCloseTo(11);
    expect(stepToward(10, 1, 0.1)).toBeCloseTo(9);
    expect(stepToward(null, 7, 0.1)).toBe(7);
  });

  it('shopkeeper restocks when low and posts a board', () => {
    const d = shopkeeper(obs());
    expect(d.actions.some(a => a.t === 'place' && a.side === 'buy')).toBe(true);
    expect(d.actions.some(a => a.t === 'shop')).toBe(true);
  });

  it('market maker: bid under ask, leans against inventory', () => {
    const flat = makerQuote(10, 9, 11, 6, 6, 0.04, 0.06);
    const long = makerQuote(10, 9, 11, 12, 6, 0.04, 0.06);
    expect(flat.bid).toBeLessThan(flat.ask);
    expect(long.ask).toBeLessThanOrEqual(flat.ask);
    expect(long.bid).toBeLessThanOrEqual(flat.bid);
    // A book far from fair is ignored
    expect(makerQuote(10, 30, 40, 6, 6, 0.04, 0.06).ask).toBeLessThan(12);
  });

  it('collector never lifts an ask over fair', () => {
    const def = AGENT_BY_ID['agent:magpie']!;
    const market: AgentObs['market'] = {};
    for (const g of def.goods) market[g] = { fair: 50, bid: 40, ask: 55, last: 50 };
    const d = collector(obs({ def, market }));
    for (const a of d.actions)
      if (a.t === 'place' && a.ioc === true) expect(a.price).toBeLessThanOrEqual(49);
    expect(d.actions.some(a => a.t === 'place' && a.side === 'buy' && a.price <= 46)).toBe(true);
  });
});

describe('guard', () => {
  it('drops other goods, foreign cancels, clamps prices, caps spend and action count', () => {
    const o = obs({
      coin: 100,
      orders: [{ id: 'o1', good: 'PIZZA', side: 'buy', price: 10, left: 5, at: T0 }],
    });
    const d: AgentDecision = {
      say: 'hi <b>there</b>',
      actions: [
        { t: 'place', good: 'NOGGLES', side: 'buy', qty: 1, price: 50 },
        { t: 'cancel', id: 'o999' },
        { t: 'cancel', id: 'o1' },
        { t: 'place', good: 'PIZZA', side: 'buy', qty: 100, price: 1_000_000 },
        ...Array.from({ length: 20 }, () => ({ t: 'note' as const, text: 'x' })),
      ],
    };
    const g = guard(o, d);
    expect(g.actions.some(a => a.t === 'place' && a.good === 'NOGGLES')).toBe(false);
    expect(g.actions.filter(a => a.t === 'cancel').map(a => (a as { id: string }).id)).toEqual([
      'o1',
    ]);
    const p = g.actions.find(a => a.t === 'place')! as Extract<
      (typeof g.actions)[number],
      { t: 'place' }
    >;
    expect(p.price).toBeLessThanOrEqual(bandOf('PIZZA', T0).hi);
    expect(p.qty).toBeLessThanOrEqual(o.def.maxQty);
    // spend: (100 free + 50 released) × 0.6
    expect(p.qty * p.price).toBeLessThanOrEqual(90);
    expect(g.actions.length).toBeLessThanOrEqual(MAX_ACTIONS);
    expect(g.say).not.toContain('<');
  });
});

describe('engine: agent shops', () => {
  function shopWorld() {
    const { ex, doc } = world();
    ensureAgents(ex, doc, T0);
    ex.accounts['agent:reel']!.goods.FISH = 5;
    ex.mintedGoods.FISH = (ex.mintedGoods.FISH ?? 0) + 5;
    const fair = fairValue('FISH', T0);
    setShop(
      ex,
      'agent:reel',
      { FISH: { bid: Math.round(fair * 0.8), ask: Math.round(fair * 1.2), max: 3 } },
      T0,
    );
    riderAccount(ex, 'buyer-00001', T0);
    return {
      ex,
      ask: ex.shops!['agent:reel']!.lines.FISH!.ask!,
      bid: ex.shops!['agent:reel']!.lines.FISH!.bid!,
    };
  }

  it('a player buys at the posted price; under it is refused; fee to the treasury', () => {
    const { ex, ask } = shopWorld();
    const t0 = ex.treasury;
    expect(
      dealAct(
        ex,
        'buyer-00001',
        { t: 'offer', to: 'agent:reel', side: 'buy', good: 'FISH', qty: 1, price: ask - 1 },
        T0,
        tagOf,
      ).ok,
    ).toBe(false);
    const r = dealAct(
      ex,
      'buyer-00001',
      { t: 'offer', to: 'agent:reel', side: 'buy', good: 'FISH', qty: 2, price: ask },
      T0,
      tagOf,
    );
    expect(r.ok).toBe(true);
    expect(ex.accounts['buyer-00001']!.goods.FISH).toBe(2);
    expect(ex.treasury).toBeGreaterThanOrEqual(t0);
    expect(checkInvariants(ex)).toEqual([]);
    // Over the line's max, or more than in stock
    expect(shopTakes(ex, 'agent:reel', 'sell', 'FISH', 4, ask, T0).ok).toBe(false);
    expect(shopTakes(ex, 'agent:reel', 'sell', 'FISH', 3, ask, T0).ok).toBe(true);
  });

  it('sells back at or under the bid; a stale shop is shut', () => {
    const { ex, bid, ask } = shopWorld();
    dealAct(
      ex,
      'buyer-00001',
      { t: 'offer', to: 'agent:reel', side: 'buy', good: 'FISH', qty: 1, price: ask },
      T0,
      tagOf,
    );
    expect(
      dealAct(
        ex,
        'buyer-00001',
        { t: 'offer', to: 'agent:reel', side: 'sell', good: 'FISH', qty: 1, price: bid + 1 },
        T0,
        tagOf,
      ).ok,
    ).toBe(false);
    expect(
      dealAct(
        ex,
        'buyer-00001',
        { t: 'offer', to: 'agent:reel', side: 'sell', good: 'FISH', qty: 1, price: bid },
        T0,
        tagOf,
      ).ok,
    ).toBe(true);
    expect(shopTakes(ex, 'agent:reel', 'sell', 'FISH', 1, ask, T0 + SHOP_TTL_MS).ok).toBe(false);
  });

  it('setShop clamps into the band and keeps bid < ask', () => {
    const { ex } = world();
    const sh = setShop(ex, 'agent:mochi', { PIZZA: { bid: 999_999, ask: 1, max: 999 } }, T0);
    const l = sh.lines.PIZZA!;
    const { lo, hi } = bandOf('PIZZA', T0);
    expect(l.ask! >= lo && l.ask! <= hi).toBe(true);
    if (l.bid !== null) expect(l.bid).toBeLessThan(l.ask!);
    expect(l.max).toBeLessThanOrEqual(25);
    expect(() => setShop(ex, 'not-an-agent', {}, T0)).toThrow();
  });

  it('nobody can trade as an agent through the player paths', () => {
    const { ex } = world();
    expect(
      playerAct(ex, 'agent:mochi', { t: 'order', side: 'buy', good: 'FISH', qty: 1, price: 5 })
        .reason,
    ).toBe('reserved');
    expect(
      dealAct(
        ex,
        'agent:mochi',
        { t: 'offer', to: 'bot:abacus', side: 'buy', good: 'FISH', qty: 1, price: 5 },
        T0,
        tagOf,
      ).reason,
    ).toBe('reserved');
    expect(tagOf('agent:mochi')).toBe('agent:mochi');
  });
});

describe('LLM policy (no network)', () => {
  it('parses a reply, drops junk, and the guard still applies', () => {
    const w = world();
    ensureAgents(w.ex, w.doc, T0);
    const o = obsFor(w.ex, AGENT_BY_ID['agent:mochi']!, w.doc.agents['agent:mochi']!, T0);
    expect(JSON.parse(llmPrompt(o)).you.name).toBe('Mochi');
    const text = `Sure! {"actions":[{"t":"place","good":"PIZZA","side":"buy","qty":9999,"price":9999},{"t":"mint","coin":1e9},{"t":"place","good":"DRIP","side":"buy","qty":1,"price":1},{"t":"shop","lines":{"PIZZA":{"bid":1,"ask":99999,"max":3}}}],"say":"pizza time","note":"stocking up"}`;
    const d = parseDecision(text)!;
    expect(d.say).toBe('pizza time');
    expect(d.actions.some(a => (a as { t: string }).t === 'mint')).toBe(false);
    const g = guard(o, d);
    expect(g.actions.some(a => a.t === 'place' && a.good === 'DRIP')).toBe(false);
    const p = g.actions.find(a => a.t === 'place') as
      | Extract<(typeof g.actions)[number], { t: 'place' }>
      | undefined;
    if (p) {
      expect(p.qty).toBeLessThanOrEqual(8);
      expect(p.price).toBeLessThanOrEqual(bandOf('PIZZA', T0).hi);
    }
    expect(parseDecision('no json here')).toBeNull();
    expect(parseDecision('{not json')).toBeNull();
  });

  it('runAgents uses an override decision and marks the turn as llm', () => {
    const { ex, doc } = world();
    const out = runAgents(ex, doc, T0, {
      tagOf,
      decide: def =>
        def.id === 'agent:mochi' ? { actions: [{ t: 'note', text: 'thinking' }], say: 'hm' } : null,
    });
    expect(out.find(t => t.id === 'agent:mochi')!.policy).toBe('llm');
    expect(out.find(t => t.id === 'agent:reel')!.policy).toBe('rules');
    expect(doc.agents['agent:mochi']!.mem.notes.at(-1)!.text).toBe('thinking');
  });

  it('llmDue rate-limits per agent and per run', () => {
    const due = llmDue(
      [
        { id: 'a', llm: true, due: true },
        { id: 'b', llm: true, due: true, llmAt: T0 - 10 * MIN },
        { id: 'c', llm: false, due: true },
        { id: 'd', llm: true, due: true, llmAt: T0 - 2 * 3_600_000 },
        { id: 'e', llm: true, due: true },
      ],
      T0,
    );
    expect(due).toHaveLength(2);
    expect(due).not.toContain('b');
    expect(due).not.toContain('c');
  });
});
