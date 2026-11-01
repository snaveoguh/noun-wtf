// ── Grand Exchange: direct deals, trader to trader (pure) ────────────────
//
// On the 3D floor you can walk up to someone and offer them a trade: "I'll
// sell you 3 FISH at 12 COIN each". That's a Deal. It isn't on the order
// book and nothing is escrowed: both sides' free balances are checked when
// it is accepted, and then it settles like a book fill (at the deal price,
// the seller pays the usual fee to the treasury, it goes on the tape).
//
// Privacy: a rider id is the rider's only key, so deals never carry one
// out. Targets are public tags (the same masked tag the floor feed shows,
// `tagOf`), and each side only ever sees the other's tag. The tag is
// resolved to its account when offered (`toOwner`, kept server-side), and
// only that account can accept.
//
// Bots are targets too: an offer to a bot is answered at once (botTakes):
// it trades when the price is on its side of fair value and it can cover it.

import type {
  Account,
  Deal,
  DealsView,
  ExchangeState,
  GeFill,
  GoodId,
  PublicDeal,
  Side,
} from './types';

import { account, feeOf, MAX_PRICE, record } from './book';
import { BOT_BY_ID, isBot } from './bots/roster';
import { fairValue, isGood } from './goods';
import { AGENT_ID_RE, isAgent, shopTakes } from './shops';
import { pushFloor, riderAccount } from './sim';

/** An offer lapses after this long. */
export const DEAL_TTL_MS = 90_000;
/** Open offers one rider can have out (a new one replaces the oldest). */
export const MAX_DEALS_OUT = 4;
/** Offers waiting for one target (older ones drop). */
export const MAX_DEALS_IN = 12;
/** All open offers. */
export const MAX_DEALS = 400;
/** Biggest single deal (units). */
export const MAX_DEAL_QTY = 500;
/** Biggest deal a bot takes (units). */
export const BOT_DEAL_QTY = 40;

export type DealAction =
  | { t: 'offer'; to: string; side: Side; good: GoodId; qty: number; price: number }
  | { t: 'accept'; deal: string }
  | { t: 'decline'; deal: string };

export interface DealResult {
  ok: boolean;
  reason?: string;
  fills: GeFill[];
  /** The offer as its proposer sees it (offer), or the settled one (accept). */
  deal?: PublicDeal;
}

/** Public tag of an owner (bots keep their id). */
export type TagOf = (owner: string) => string;

const TAG_RE = /^r:[\da-z]{1,12}$/;

/** Is this a well-formed deal target? */
export function isTarget(to: unknown): to is string {
  return (
    typeof to === 'string' &&
    (TAG_RE.test(to) || (isBot(to) && BOT_BY_ID[to] !== undefined) || AGENT_ID_RE.test(to))
  );
}

/** Validate a deal action's shape (not funds). Returns null when fine. */
export function checkDeal(a: DealAction): string | null {
  if (a.t === 'accept' || a.t === 'decline')
    return typeof a.deal === 'string' && /^d\d{1,12}$/.test(a.deal) ? null : 'bad deal id';
  if (!isTarget(a.to)) return 'bad target';
  if (a.side !== 'buy' && a.side !== 'sell') return 'bad side';
  if (!isGood(a.good)) return 'unknown good';
  if (!Number.isInteger(a.qty) || a.qty < 1 || a.qty > MAX_DEAL_QTY)
    return `qty must be 1–${MAX_DEAL_QTY}`;
  if (!Number.isInteger(a.price) || a.price < 1 || a.price > MAX_PRICE)
    return `price must be 1–${MAX_PRICE}`;
  return null;
}

const addGood = (a: Account, g: GoodId, n: number) => {
  const v = (a.goods[g] ?? 0) + n;
  if (v === 0) delete a.goods[g];
  else a.goods[g] = v;
};

/** Can `buyer` pay and `seller` deliver, from free balances? */
function covers(
  s: ExchangeState,
  buyer: string,
  seller: string,
  good: GoodId,
  qty: number,
  price: number,
): string | null {
  const b = s.accounts[buyer] as Account | undefined;
  const se = s.accounts[seller] as Account | undefined;
  if (b === undefined || b.coin < qty * price) return 'buyer is short of COIN';
  if (se === undefined || (se.goods[good] ?? 0) < qty) return `seller is short of ${good}`;
  return null;
}

/** Move the goods and the COIN (fee from the seller), and put it on the tape. */
function settle(
  s: ExchangeState,
  buyer: string,
  seller: string,
  good: GoodId,
  qty: number,
  price: number,
  now: number,
): GeFill {
  const b = account(s, buyer, now);
  const se = account(s, seller, now);
  const notional = qty * price;
  const fee = feeOf(notional);
  b.coin -= notional;
  addGood(b, good, qty);
  addGood(se, good, -qty);
  se.coin += notional - fee;
  s.treasury += fee;
  b.last = now;
  se.last = now;
  const f: GeFill = { good, qty, price, buyer, seller, at: now };
  record(s, f);
  pushFloor(s, {
    at: now,
    who: seller,
    good,
    text: `sold ${qty} ${good} @ ${price} hand to hand`,
  });
  return f;
}

/** Most a bot shades fair value by (its edge), by style. */
const BOT_EDGE: Record<string, number> = {
  maker: 0.02,
  arb: 0.03,
  momentum: 0.01,
  meanrev: 0.02,
  whale: 0,
  degen: -0.04,
};

/**
 * Does the bot take this? `botSide` is what the bot would do. It buys at or
 * under fair less its edge, sells at or over fair plus its edge, never more
 * than BOT_DEAL_QTY, and only what it can cover from free balances.
 */
export function botTakes(
  s: ExchangeState,
  bot: string,
  botSide: Side,
  good: GoodId,
  qty: number,
  price: number,
  now: number,
): { ok: boolean; reason?: string } {
  const def = BOT_BY_ID[bot];
  if (def === undefined) return { ok: false, reason: 'no such bot' };
  if (qty > BOT_DEAL_QTY)
    return { ok: false, reason: `${def.name} trades ${BOT_DEAL_QTY} at most` };
  const fair = fairValue(good, now);
  const edge = BOT_EDGE[def.style] ?? 0.02;
  const a = s.accounts[bot] as Account | undefined;
  if (botSide === 'buy') {
    if (price > Math.floor(fair * (1 - edge)))
      return { ok: false, reason: `${def.name} won't pay ${price} (fair ≈ ${Math.round(fair)})` };
    if (a === undefined || a.coin < qty * price)
      return { ok: false, reason: `${def.name} is short of COIN` };
  } else {
    if (price < Math.ceil(fair * (1 + edge)))
      return {
        ok: false,
        reason: `${def.name} won't sell at ${price} (fair ≈ ${Math.round(fair)})`,
      };
    if (a === undefined || (a.goods[good] ?? 0) < qty)
      return { ok: false, reason: `${def.name} hasn't got ${qty} ${good}` };
  }
  return { ok: true };
}

/** Drop lapsed offers (and trim to the caps). */
export function pruneDeals(s: ExchangeState, now: number) {
  if (s.deals === undefined) return;
  s.deals = s.deals.filter(d => now - d.at < DEAL_TTL_MS);
  if (s.deals.length > MAX_DEALS) s.deals.splice(0, s.deals.length - MAX_DEALS);
}

const publicOf = (d: Deal, who: string): PublicDeal => ({
  id: d.id,
  who,
  side: d.side,
  good: d.good,
  qty: d.qty,
  price: d.price,
  at: d.at,
  exp: d.at + DEAL_TTL_MS,
});

/** Is `owner` (whose tag is `me`) the target of this deal? */
const isTargetOf = (d: Deal, owner: string, me: string) =>
  d.toOwner !== undefined ? d.toOwner === owner : d.to === me;

/** A rider's offers in and out (tags only). */
export function dealsView(s: ExchangeState, viewer: string, now: number, tagOf: TagOf): DealsView {
  const me = tagOf(viewer);
  const incoming: PublicDeal[] = [];
  const outgoing: PublicDeal[] = [];
  for (const d of s.deals ?? []) {
    if (now - d.at >= DEAL_TTL_MS) continue;
    if (d.from === viewer) outgoing.push(publicOf(d, d.to));
    else if (isTargetOf(d, viewer, me)) incoming.push(publicOf(d, d.fromTag));
  }
  return { incoming, outgoing };
}

/**
 * The rider account behind a tag: the owner, null for none, or 'ambiguous'
 * when two accounts' tags collide (tags are a short hash; an offer to one
 * of them would be a guess, so it's refused).
 */
function ownerOfTag(s: ExchangeState, tag: string, tagOf: TagOf): string | null | 'ambiguous' {
  let found: string | null = null;
  for (const owner of Object.keys(s.accounts)) {
    if (isBot(owner) || isAgent(owner) || tagOf(owner) !== tag) continue;
    if (found !== null) return 'ambiguous';
    found = owner;
  }
  return found;
}

export function dealAct(
  s: ExchangeState,
  owner: string,
  a: DealAction,
  now: number,
  tagOf: TagOf,
): DealResult {
  if (isBot(owner) || isAgent(owner)) return { ok: false, reason: 'reserved', fills: [] };
  const bad = checkDeal(a);
  if (bad !== null) return { ok: false, reason: bad, fills: [] };
  riderAccount(s, owner, now);
  pruneDeals(s, now);
  s.deals ??= [];
  const me = tagOf(owner);

  if (a.t === 'offer') {
    if (a.to === me) return { ok: false, reason: "that's you", fills: [] };
    // The proposer must be able to cover it now (checked again on accept)
    const mine = s.accounts[owner]!;
    if (a.side === 'buy' && mine.coin < a.qty * a.price)
      return { ok: false, reason: 'not enough COIN', fills: [] };
    if (a.side === 'sell' && (mine.goods[a.good] ?? 0) < a.qty)
      return { ok: false, reason: `not enough ${a.good}`, fills: [] };
    if (isBot(a.to)) {
      const botSide: Side = a.side === 'buy' ? 'sell' : 'buy';
      const take = botTakes(s, a.to, botSide, a.good, a.qty, a.price, now);
      if (!take.ok) return { ok: false, reason: take.reason, fills: [] };
      const buyer = a.side === 'buy' ? owner : a.to;
      const seller = a.side === 'buy' ? a.to : owner;
      return { ok: true, fills: [settle(s, buyer, seller, a.good, a.qty, a.price, now)] };
    }
    if (isAgent(a.to)) {
      // An agent's shop: answered at once, at its posted price (shops.ts)
      const agentSide: Side = a.side === 'buy' ? 'sell' : 'buy';
      const take = shopTakes(s, a.to, agentSide, a.good, a.qty, a.price, now);
      if (!take.ok) return { ok: false, reason: take.reason, fills: [] };
      const buyer = a.side === 'buy' ? owner : a.to;
      const seller = a.side === 'buy' ? a.to : owner;
      return { ok: true, fills: [settle(s, buyer, seller, a.good, a.qty, a.price, now)] };
    }
    const target = ownerOfTag(s, a.to, tagOf);
    if (target === null) return { ok: false, reason: 'no trader by that tag', fills: [] };
    if (target === 'ambiguous')
      return { ok: false, reason: 'that tag is ambiguous, try another trader', fills: [] };
    const out = s.deals.filter(d => d.from === owner);
    if (out.length >= MAX_DEALS_OUT) {
      const old = out[0]!;
      s.deals = s.deals.filter(d => d !== old);
    }
    const inbox = s.deals.filter(d => d.to === a.to);
    if (inbox.length >= MAX_DEALS_IN) {
      const old = inbox[0]!;
      s.deals = s.deals.filter(d => d !== old);
    }
    const d: Deal = {
      id: `d${++s.seq}`,
      from: owner,
      fromTag: me,
      to: a.to,
      toOwner: target,
      side: a.side,
      good: a.good,
      qty: a.qty,
      price: a.price,
      at: now,
    };
    s.deals.push(d);
    return { ok: true, fills: [], deal: publicOf(d, d.to) };
  }

  const d = s.deals.find(x => x.id === a.deal);
  if (d === undefined) return { ok: false, reason: 'that offer has gone', fills: [] };
  if (a.t === 'decline') {
    if (!isTargetOf(d, owner, me) && d.from !== owner)
      return { ok: false, reason: 'not your offer', fills: [] };
    s.deals = s.deals.filter(x => x !== d);
    return { ok: true, fills: [] };
  }
  // accept
  if (!isTargetOf(d, owner, me)) return { ok: false, reason: 'not your offer', fills: [] };
  if (d.from === owner) return { ok: false, reason: "that's you", fills: [] };
  const buyer = d.side === 'buy' ? d.from : owner;
  const seller = d.side === 'buy' ? owner : d.from;
  const short = covers(s, buyer, seller, d.good, d.qty, d.price);
  if (short !== null) {
    // The proposer can't cover it any more: the offer is dead, drop it.
    // The acceptor is short: keep it (they may sell something first)
    if (short.startsWith(d.side === 'buy' ? 'buyer' : 'seller')) {
      s.deals = s.deals.filter(x => x !== d);
      return { ok: false, reason: "they can't cover it any more", fills: [] };
    }
    return { ok: false, reason: short.replace(/^(buyer|seller) is/, "you're"), fills: [] };
  }
  s.deals = s.deals.filter(x => x !== d);
  const f = settle(s, buyer, seller, d.good, d.qty, d.price, now);
  return { ok: true, fills: [f], deal: publicOf(d, d.fromTag) };
}
