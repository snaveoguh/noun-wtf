// ── Noun Trade: the client side of the ledger (`game.trade`) ─────────────
//
// Implements TradeApi. The server (netlify/functions/world-trade) holds the
// books; this mirrors them for the HUD:
//  • act(): applies the action optimistically with the same pure ledger the
//    server runs (so the UI moves at once), posts it, then takes whatever
//    the server answers as the truth (a refusal rolls the books back).
//    Actions go out one at a time, each with a nonce so a retry is never
//    applied twice.
//  • offline (`?offline=1`, dev runs, tests): the whole ledger runs here in
//    memory — same rules, same prices — and never touches the network.
//  • the rider id is the world-stats one (net/Stats.ts riderId), so a
//    browser keeps one identity across stats and trade.
//
// Last-seen prices: the quotes you saw while in a town are kept per browser
// (localStorage) with when you saw them; the market panel's profit hints
// use those, not live prices from towns you're not in.

import type {
  GoodId,
  Quote,
  TownId,
  TradeAction,
  TradeApi,
  TradeResult,
  TradeState,
} from './contract';

import { riderId } from '../net/Stats';

import { GOOD_IDS } from './goods';
import { applyAction, newRow, stateOf, type TradeRow } from './ledger';
import {
  freshMarket,
  freshMarkets,
  marketAt,
  quoteAt,
  townQuotes,
  type Markets,
  type TownMarket,
} from './market';
import { isTown, TOWN_IDS } from './towns';

const URL_ = '/.netlify/functions/world-trade';
const SEEN_KEY = 'noun-trade-seen';

export interface SeenPrices {
  at: number;
  quotes: Partial<Record<GoodId, Quote>>;
}

export interface TradeNotice {
  text: string;
  ok: boolean;
  at: number;
}

export interface TradeClientOptions {
  offline: boolean;
  rider?: string;
  fetchFn?: typeof fetch;
  /** Clock (ms); tests inject one. */
  now?: () => number;
}

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, v: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    // private mode: last-seen prices just don't persist
  }
}

const nonce = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `n${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** Quotes → a market whose stock matches them (for optimistic pricing). */
function marketFromQuotes(
  town: TownId,
  qs: Partial<Record<GoodId, Quote>> | undefined,
  now: number,
) {
  const m = freshMarket(town, now);
  for (const g of GOOD_IDS) {
    const q = qs?.[g];
    if (q !== undefined) m.stock[g] = q.stock;
  }
  return m;
}

export class TradeClient implements TradeApi {
  readonly offline: boolean;
  readonly rider: string;
  state: TradeState | null = null;
  /** The town the player is in (the UI's tracker sets it). */
  town: TownId | null = null;
  /** Dev / test: pretend to stand in this town (`?town=` or the console). */
  devTown: TownId | null = null;
  /** Prices you've seen in person, per town. */
  seen: Partial<Record<TownId, SeenPrices>>;
  /** Last action's outcome, for a HUD toast. */
  notice: TradeNotice | null = null;
  /** Actions in flight. */
  pending = 0;
  /** Dev / offline only: shift the ledger clock (skip a drive). */
  clockOffset = 0;

  private live: Partial<Record<TownId, Partial<Record<GoodId, Quote>>>> = {};
  private local: { row: TradeRow; markets: Markets } | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<() => void>();
  private version = 0;
  private fetchFn: typeof fetch;
  private clock: () => number;

  constructor(opts: TradeClientOptions) {
    this.offline = opts.offline;
    this.rider = opts.rider ?? riderId();
    this.fetchFn = opts.fetchFn ?? ((...a) => fetch(...a));
    this.clock = opts.now ?? (() => Date.now());
    this.seen = load<Partial<Record<TownId, SeenPrices>>>(SEEN_KEY, {});
    if (this.offline) {
      const now = this.now();
      this.local = { row: newRow(this.rider, now), markets: freshMarkets(now) };
      this.state = stateOf(this.local.row);
    }
  }

  now() {
    return this.clock() + this.clockOffset;
  }

  // ── store for React (useSyncExternalStore) ──
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };
  getVersion = () => this.version;
  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }

  /** Fetch the books (and the current town's quotes) from the server. */
  async load(): Promise<void> {
    if (this.offline) {
      this.emit();
      return;
    }
    try {
      const q = new URLSearchParams({ rider: this.rider });
      if (this.town !== null) q.set('town', this.town);
      const res = await this.fetchFn(`${URL_}?${q}`, { cache: 'no-store' });
      if (!res.ok) return;
      const out = (await res.json()) as { state?: TradeState; quotes?: Quote[] };
      if (out.state) this.state = out.state;
      this.takeQuotes(out.quotes);
      this.emit();
    } catch {
      // offline for now; the next action or town will try again
    }
  }

  /** The player moved into (or out of) a town. */
  setTown(town: TownId | null) {
    if (town === this.town) return;
    this.town = town;
    if (town !== null) {
      if (this.offline) this.markSeen(town, this.townQuotesNow(town));
      else void this.load();
    }
    this.emit();
  }

  /** The latest quote this client knows (live in offline mode). */
  quote(town: TownId, good: GoodId): Quote | null {
    if (this.local !== null) {
      const m = marketAt(town, this.local.markets[town], this.now());
      return quoteAt(town, good, m.stock[good]);
    }
    return this.live[town]?.[good] ?? null;
  }

  /** Every good's quote in a town (null when not known yet). */
  townQuotesNow(town: TownId): Quote[] {
    if (this.local !== null) return townQuotes(town, this.local.markets[town], this.now());
    const qs = this.live[town];
    return qs ? GOOD_IDS.flatMap(g => (qs[g] ? [qs[g]!] : [])) : [];
  }

  act(a: TradeAction): Promise<TradeResult> {
    const run = this.queue.then(() => this.run(a));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async run(a: TradeAction): Promise<TradeResult> {
    const town = 'town' in a ? a.town : null;
    if (this.local !== null) {
      const o = applyAction(this.local.row, this.local.markets, a, this.now());
      this.local.row = o.row;
      if (o.ok) this.local.markets = o.markets;
      this.state = stateOf(o.row);
      const quotes = town !== null ? this.townQuotesNow(town) : undefined;
      if (town !== null && quotes) this.markSeen(town, quotes);
      return this.finish(
        o.ok
          ? { ok: true, state: this.state, quotes }
          : { ok: false, reason: o.reason, state: this.state, quotes },
        a,
      );
    }

    // Online: optimistic first, then the server's word
    const before = this.state;
    const id = nonce();
    this.pending++;
    const guess = this.optimistic(a);
    if (guess !== null) {
      this.state = guess;
      this.emit();
    }
    try {
      const res = await this.fetchFn(URL_, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rider: this.rider, id, action: a }),
      });
      const out = (await res.json()) as Partial<TradeResult>;
      if (out.state) this.state = out.state;
      else this.state = before;
      this.takeQuotes(out.quotes);
      if (town !== null && out.quotes) this.markSeen(town, out.quotes);
      const result: TradeResult = {
        ok: out.ok === true,
        reason: out.ok === true ? undefined : (out.reason ?? `error ${res.status}`),
        state: this.state ?? stateOf(newRow(this.rider, this.now())),
        quotes: out.quotes,
      };
      return this.finish(result, a);
    } catch {
      this.state = before;
      return this.finish(
        {
          ok: false,
          reason: 'offline, try again',
          state: before ?? stateOf(newRow(this.rider, this.now())),
        },
        a,
      );
    } finally {
      this.pending--;
      this.emit();
    }
  }

  /** What the books will probably look like (travel / rate left to the server). */
  private optimistic(a: TradeAction): TradeState | null {
    if (this.state === null || !('town' in a)) return null;
    const now = this.now();
    const row: TradeRow = {
      ...newRow(this.rider, now),
      coin: this.state.coin,
      held: { ...this.state.cargo },
      upgrades: [...this.state.upgrades],
    };
    const markets = freshMarkets(now);
    for (const t of TOWN_IDS) markets[t] = marketFromQuotes(t, this.live[t], now) as TownMarket;
    const o = applyAction(row, markets, a, now);
    return o.ok ? stateOf(o.row) : null;
  }

  private finish(r: TradeResult, a: TradeAction): TradeResult {
    this.notice = { text: r.ok ? doneText(a) : (r.reason ?? 'refused'), ok: r.ok, at: Date.now() };
    this.emit();
    return r;
  }

  private takeQuotes(qs: Quote[] | undefined) {
    if (!Array.isArray(qs)) return;
    for (const q of qs) {
      if (!isTown(q.town)) continue;
      (this.live[q.town] ??= {})[q.good] = q;
    }
  }

  private markSeen(town: TownId, qs: Quote[]) {
    const quotes: Partial<Record<GoodId, Quote>> = {};
    for (const q of qs) if (q.town === town) quotes[q.good] = q;
    this.seen = { ...this.seen, [town]: { at: Date.now(), quotes } };
    save(SEEN_KEY, this.seen);
  }
}

function doneText(a: TradeAction): string {
  switch (a.t) {
    case 'buy':
      return `Bought ${a.qty} ${a.good}`;
    case 'sell':
      return `Sold ${a.qty} ${a.good}`;
    case 'serve':
      return `Served ${a.good}`;
    case 'upgrade':
      return `Fitted: ${a.up}`;
    default:
      return 'Done';
  }
}
