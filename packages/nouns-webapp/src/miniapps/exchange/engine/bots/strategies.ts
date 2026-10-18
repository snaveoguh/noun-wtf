// ── Bot strategies: pure functions of (book, account, fair value) ─────────
//
// A strategy returns actions and one thought. It can't touch the ledger:
// the driver (../tick.ts) applies the actions through the same engine calls
// players use, after clamping them (size cap, a price band around fair
// value, the town-leg budget), so no strategy can overspend, print COIN or
// walk a thin book to an absurd price.

import type { BotStyle, GoodId } from '../types';
import type { BotAction, BotCtx, BotTurn, Strategy } from './types';

import { GOODS } from '../goods';
import { pick, randInt } from '../rng';

const remaining = (o: { qty: number; filled: number }) => o.qty - o.filled;
const pct = (x: number) => `${x >= 0 ? '+' : ''}${Math.round(x * 100)}%`;
const quiet = (actions: BotAction[] = []): BotTurn => ({ actions, say: null });

/** Units of `g` the bot holds, free + escrowed. */
const held = (c: BotCtx, g: GoodId) => (c.me.goods[g] ?? 0) + (c.me.lockGoods[g] ?? 0);

/** Shuffle a few goods (seeded). */
function someGoods(c: BotCtx, n: number): GoodId[] {
  const xs = [...GOODS];
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(c.rng() * (i + 1));
    [xs[i], xs[j]] = [xs[j], xs[i]];
  }
  return xs.slice(0, n);
}

// ── Market maker: quote both sides around fair, skewed by inventory ──
export const maker: Strategy = c => {
  const { p } = c.def;
  const actions: BotAction[] = [];
  let say: string | null = null;
  let sayGood: GoodId | undefined;
  for (const g of someGoods(c, p.perAct)) {
    const mineHere = c.mine.filter(o => o.good === g);
    let coin = c.me.coin;
    let free = c.me.goods[g] ?? 0;
    for (const o of mineHere) {
      actions.push({ t: 'cancel', id: o.id });
      if (o.side === 'buy') coin += remaining(o) * o.price;
      else free += remaining(o);
    }
    const fair = c.fair(g);
    const last = c.last(g);
    const anchor = last === null ? fair : fair * (1 - p.anchorLast) + last * p.anchorLast;
    const target = c.def.budget.goods[g] ?? 20;
    const inv = held(c, g);
    const lean = Math.max(-1, Math.min(1, (inv - target) / Math.max(1, target)));
    const mid = anchor * (1 - lean * p.skew);
    let bid = Math.max(1, Math.floor(mid * (1 - p.half)));
    let ask = Math.ceil(mid * (1 + p.half));
    if (ask <= bid) ask = bid + 1;
    // Never cross the book: a maker makes, it doesn't take
    const t = c.top(g);
    if (t.ask !== null && bid >= t.ask) bid = t.ask - 1;
    if (t.bid !== null && ask <= t.bid) ask = t.bid + 1;
    // A small ladder: the touch, then deeper levels a step further out
    const step = Math.max(1, Math.round(mid * p.half));
    for (let k = 0; k < (p.levels ?? 1); k++) {
      const sz = Math.min(c.def.maxQty, randInt(c.rng, p.minSz, p.maxSz) + k * 2);
      const b = bid - k * step;
      if (b >= 1 && coin >= sz * b) {
        actions.push({ t: 'place', good: g, side: 'buy', qty: sz, price: b });
        coin -= sz * b;
      }
      const askSz = Math.min(sz, free);
      if (askSz > 0) {
        actions.push({ t: 'place', good: g, side: 'sell', qty: askSz, price: ask + k * step });
        free -= askSz;
      }
    }
    if (say === null && c.rng() < (p.talk ?? 0.2)) {
      sayGood = g;
      say =
        lean > 0.35
          ? `long ${inv} ${g}, leaning my offer down to ${ask}`
          : lean < -0.35
            ? `short on ${g} (${inv} left), bidding up to ${bid}`
            : `making ${g} ${bid} / ${ask}`;
    }
  }
  return { actions, say, good: sayGood };
};

// ── Arbitrageur: exchange vs town markets ──
export const arb: Strategy = c => {
  const { margin } = c.def.p;
  if (c.townLeft <= 0) return quiet();
  let best: { edge: number; turn: BotTurn } | null = null;
  for (const g of GOODS) {
    const t = c.top(g);
    const towns = c.towns(g);
    const dear = towns.reduce((a, b) => (b.bid > a.bid ? b : a));
    const cheap = towns.reduce((a, b) => (b.ask < a.ask ? b : a));
    // Buy on the exchange, sell to a town
    if (t.ask !== null && dear.bid > t.ask * (1 + margin)) {
      const edge = dear.bid - t.ask;
      const qty = Math.min(t.askQty, c.def.maxQty, c.townLeft, Math.floor(c.me.coin / t.ask));
      if (qty > 0 && (!best || edge * qty > best.edge)) {
        best = {
          edge: edge * qty,
          turn: {
            good: g,
            say: `${g} ${t.ask} here vs ${dear.bid} in ${dear.name}, lifting the offer`,
            actions: [
              { t: 'place', good: g, side: 'buy', qty, price: t.ask, ioc: true },
              { t: 'town', town: dear.town, good: g, side: 'sell', qty },
            ],
          },
        };
      }
    }
    // Buy from a town, hit the exchange bid (seller pays the 1% fee)
    if (t.bid !== null && t.bid * 0.99 > cheap.ask * (1 + margin)) {
      const edge = t.bid * 0.99 - cheap.ask;
      const qty = Math.min(t.bidQty, c.def.maxQty, c.townLeft, Math.floor(c.me.coin / cheap.ask));
      if (qty > 0 && (!best || edge * qty > best.edge)) {
        best = {
          edge: edge * qty,
          turn: {
            good: g,
            say: `${g} ${cheap.ask} in ${cheap.name}, bids ${t.bid} here, hitting it`,
            actions: [
              { t: 'town', town: cheap.town, good: g, side: 'buy', qty },
              { t: 'place', good: g, side: 'sell', qty, price: t.bid, ioc: true },
            ],
          },
        };
      }
    }
  }
  if (best) return best.turn;
  // Nothing to do: sell any leftovers back to the best town
  for (const g of GOODS) {
    const n = c.me.goods[g] ?? 0;
    if (n <= 0) continue;
    const dear = c.towns(g).reduce((a, b) => (b.bid > a.bid ? b : a));
    const qty = Math.min(n, c.townLeft);
    if (qty > 0) {
      return {
        good: g,
        say: c.rng() < 0.3 ? `no gaps worth taking, dumping ${qty} ${g} in ${dear.name}` : null,
        actions: [{ t: 'town', town: dear.town, good: g, side: 'sell', qty }],
      };
    }
  }
  return c.rng() < 0.05
    ? { actions: [], say: 'every town lines up with the board. quiet.' }
    : quiet();
};

// ── Momentum: chase what moved ──
export const momentum: Strategy = c => {
  const { look, trigger } = c.def.p;
  for (const g of someGoods(c, 3)) {
    const cl = c.closes(g, look + 1);
    if (cl.length < 3) continue;
    const r = cl[cl.length - 1] / cl[0] - 1;
    const t = c.top(g);
    const sz = randInt(c.rng, 2, c.def.maxQty);
    if (
      r > trigger &&
      t.ask !== null &&
      c.me.coin >= Math.max(t.ask * sz, c.def.budget.coin * 0.3)
    ) {
      return {
        good: g,
        say: `${g} ${pct(r)} in ${look}m, chasing`,
        actions: [
          {
            t: 'place',
            good: g,
            side: 'buy',
            qty: Math.min(sz, t.askQty),
            price: t.ask,
            ioc: true,
          },
        ],
      };
    }
    const have = c.me.goods[g] ?? 0;
    if (r < -trigger && t.bid !== null && have > 0) {
      return {
        good: g,
        say: `${g} ${pct(r)} in ${look}m, I'm out`,
        actions: [
          {
            t: 'place',
            good: g,
            side: 'sell',
            qty: Math.min(have, sz, t.bidQty),
            price: t.bid,
            ioc: true,
          },
        ],
      };
    }
  }
  // No trend: bank some of a fat position with a small resting offer
  if (c.mine.length < 4) {
    for (const g of someGoods(c, 2)) {
      const have = c.me.goods[g] ?? 0;
      const extra = have - (c.def.budget.goods[g] ?? 0);
      if (extra <= 0) continue;
      const px = Math.ceil((c.last(g) ?? c.fair(g)) * 1.02);
      return {
        good: g,
        say:
          c.rng() < 0.3
            ? `trend's gone on ${g}, banking ${Math.min(extra, c.def.maxQty)} at ${px}`
            : null,
        actions: [
          { t: 'place', good: g, side: 'sell', qty: Math.min(extra, c.def.maxQty), price: px },
        ],
      };
    }
  }
  return c.rng() < 0.08 ? { actions: [], say: 'no trend worth riding. waiting.' } : quiet();
};

// ── Mean reverter: fade what strayed from fair ──
export const meanrev: Strategy = c => {
  const { band, rest, stale } = c.def.p;
  const actions: BotAction[] = [];
  for (const o of c.mine) if (c.now - o.at > stale) actions.push({ t: 'cancel', id: o.id });
  for (const g of someGoods(c, 3)) {
    const fair = c.fair(g);
    const t = c.top(g);
    const have = c.me.goods[g] ?? 0;
    const sz = randInt(c.rng, 2, c.def.maxQty);
    if (t.bid !== null && t.bid > fair * (1 + band) && have > 0) {
      actions.push({
        t: 'place',
        good: g,
        side: 'sell',
        qty: Math.min(have, sz, t.bidQty),
        price: t.bid,
        ioc: true,
      });
      return { actions, good: g, say: `${g} bid ${pct(t.bid / fair - 1)} over fair, fading it` };
    }
    if (t.ask !== null && t.ask < fair * (1 - band) && c.me.coin >= t.ask * sz) {
      actions.push({
        t: 'place',
        good: g,
        side: 'buy',
        qty: Math.min(sz, t.askQty),
        price: t.ask,
        ioc: true,
      });
      return {
        actions,
        good: g,
        say: `${g} offered ${pct(t.ask / fair - 1)} under fair, scooping`,
      };
    }
  }
  // Nothing stretched: leave patient orders out where things usually snap
  // back to. Over its starting stock it offers, under it bids (and never
  // ties up more than half its COIN in bids).
  if (c.mine.length < 6) {
    const g = pick(c.rng, GOODS);
    const fair = c.fair(g);
    const sz = randInt(c.rng, 2, c.def.maxQty);
    const have = c.me.goods[g] ?? 0;
    if (have > (c.def.budget.goods[g] ?? 0)) {
      const px = Math.ceil(fair * (1 + rest));
      actions.push({ t: 'place', good: g, side: 'sell', qty: Math.min(sz, have), price: px });
      return {
        actions,
        good: g,
        say: c.rng() < 0.4 ? `heavy on ${g}, offering some back at ${px}` : null,
      };
    }
    const px = Math.max(1, Math.floor(fair * (1 - rest)));
    if (c.me.lockCoin + px * sz <= (c.me.coin + c.me.lockCoin) / 2) {
      actions.push({ t: 'place', good: g, side: 'buy', qty: sz, price: px });
      return {
        actions,
        good: g,
        say: c.rng() < 0.4 ? `resting a bargain bid on ${g} at ${px}` : null,
      };
    }
  }
  return { actions, say: null };
};

// ── Whale: rarely, sweep a big slice of one side; otherwise unwind ──
export const whale: Strategy = c => {
  const { share } = c.def.p;
  const g = pick(c.rng, GOODS);
  const t = c.top(g);
  const fair = c.fair(g);
  const buy = c.rng() < 0.5;
  if (buy && t.ask !== null) {
    const qty = Math.min(
      c.def.maxQty,
      Math.floor(t.askDepth * share),
      Math.floor(c.me.coin / (fair * 1.3)),
    );
    if (qty >= 5) {
      return {
        good: g,
        say: `🐋 sweeping ${qty} ${g}. hold on to something.`,
        actions: [
          { t: 'place', good: g, side: 'buy', qty, price: Math.ceil(fair * 1.25), ioc: true },
        ],
      };
    }
  }
  if (!buy && t.bid !== null) {
    const qty = Math.min(c.def.maxQty, Math.floor(t.bidDepth * share), c.me.goods[g] ?? 0);
    if (qty >= 5) {
      return {
        good: g,
        say: `🐋 dumping ${qty} ${g} on the bids. sorry not sorry.`,
        actions: [
          { t: 'place', good: g, side: 'sell', qty, price: Math.floor(fair * 0.75), ioc: true },
        ],
      };
    }
  }
  return { actions: [], say: `🐋 Big Blue surfaces, looks at ${g}, goes back to sleep.`, good: g };
};

const DEGEN_IN = [
  'to the moon',
  'aping',
  'cannot lose',
  'trust me',
  'number go up',
  'vibes are immaculate',
];
const DEGEN_OUT = [
  'paper hands activated',
  'it is so over',
  'rugged by my own brain',
  'taking the L',
];

// ── Degen: random side, random good, tiny size ──
export const degen: Strategy = c => {
  const { band } = c.def.p;
  const g = pick(c.rng, GOODS);
  const fair = c.fair(g);
  const have = c.me.goods[g] ?? 0;
  const sz = randInt(c.rng, 1, c.def.maxQty);
  const wantBuy = c.rng() < 0.55;
  if (wantBuy && c.me.coin >= fair * (1 + band) * sz) {
    return {
      good: g,
      say: `${g} ${pick(c.rng, DEGEN_IN)}, buying ${sz}`,
      actions: [
        {
          t: 'place',
          good: g,
          side: 'buy',
          qty: sz,
          price: Math.ceil(fair * (1 + band)),
          ioc: true,
        },
      ],
    };
  }
  if (have > 0) {
    const q = Math.min(have, sz);
    return {
      good: g,
      say: `${pick(c.rng, DEGEN_OUT)}, selling ${q} ${g}`,
      actions: [
        {
          t: 'place',
          good: g,
          side: 'sell',
          qty: q,
          price: Math.max(1, Math.floor(fair * (1 - band))),
          ioc: true,
        },
      ],
    };
  }
  return c.rng() < 0.2 ? { actions: [], say: 'down bad. watching the tape.' } : quiet();
};

export const STRATEGIES: Record<BotStyle, Strategy> = {
  maker,
  arb,
  momentum,
  meanrev,
  whale,
  degen,
};
