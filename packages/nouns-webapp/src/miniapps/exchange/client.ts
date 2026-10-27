// ── Grand Exchange clients: the live server, or the engine in memory ──────
//
// Both speak the same shapes (ExchangeSnapshot in, actions out), so the
// floor UI doesn't care which it has. `?offline=1` uses LocalExchange: the
// engine and the bots run in this tab with no network (dev, tests, demos).

import { maskOwner } from '../exchange3d/sim/feed';

import {
  dealAct,
  dealsView,
  genesis,
  playerAct,
  riderAccount,
  snapshot,
  tick,
  type DealAction,
  type DealsView,
  type ExchangeAction,
  type ExchangeSnapshot,
  type ExchangeState,
  type GeFill,
  type GoodId,
  type PublicDeal,
} from './engine';

export type ClientAction = ExchangeAction | DealAction | { t: 'join' };

const isDealAction = (a: ClientAction): a is DealAction =>
  a.t === 'offer' || a.t === 'accept' || a.t === 'decline';

export interface ActReply {
  ok: boolean;
  reason?: string;
  fills: GeFill[];
  snapshot: ExchangeSnapshot;
  /** Direct deals (engine/deals.ts): the offer made / the deal settled. */
  deal?: PublicDeal;
  deals?: DealsView;
}

export interface ExchangeClient {
  readonly offline: boolean;
  readonly owner: string;
  load(good: GoodId, tf: 'm' | 'h'): Promise<ExchangeSnapshot>;
  act(a: ClientAction, good: GoodId, tf: 'm' | 'h'): Promise<ActReply>;
}

/** Same id the world's stats use (net/Stats.ts riderId): one rider per browser. */
const RIDER_KEY = 'noun-world-rider-id';
export function riderId(): string {
  try {
    let id = localStorage.getItem(RIDER_KEY);
    if (id === null || id.length < 8) {
      id = crypto.randomUUID();
      localStorage.setItem(RIDER_KEY, id);
    }
    return id;
  } catch {
    return `guest-${Math.random().toString(36).slice(2, 12)}`;
  }
}

const URL_ = '/.netlify/functions/world-exchange';

export class HttpExchange implements ExchangeClient {
  readonly offline = false;
  constructor(readonly owner: string = riderId()) {}

  async load(good: GoodId, tf: 'm' | 'h'): Promise<ExchangeSnapshot> {
    const qs = new URLSearchParams({ good, tf, rider: this.owner });
    const r = await fetch(`${URL_}?${qs.toString()}`);
    if (!r.ok) throw new Error(`exchange ${r.status}`);
    return (await r.json()) as ExchangeSnapshot;
  }

  async act(a: ClientAction, good: GoodId, tf: 'm' | 'h'): Promise<ActReply> {
    const r = await fetch(URL_, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rider: this.owner, action: a, good, tf }),
    });
    const body = (await r.json()) as Partial<ActReply> & { error?: string };
    if (!r.ok || body.snapshot === undefined) {
      const snap = await this.load(good, tf);
      return {
        ok: false,
        reason: body.reason ?? body.error ?? `error ${r.status}`,
        fills: [],
        snapshot: snap,
      };
    }
    return body as ActReply;
  }
}

/** The whole exchange in this tab. `speed` runs the sim clock faster than real time. */
export class LocalExchange implements ExchangeClient {
  readonly offline = true;
  readonly owner = 'you-offline';
  readonly state: ExchangeState;
  private readonly t0 = Date.now();

  constructor(
    seed = 7,
    private readonly speed = 1,
  ) {
    this.state = genesis(seed, this.t0, 3 * 3_600_000);
    riderAccount(this.state, this.owner, this.t0);
  }

  /** Simulated now. */
  now() {
    return this.t0 + (Date.now() - this.t0) * this.speed;
  }

  async load(good: GoodId, tf: 'm' | 'h'): Promise<ExchangeSnapshot> {
    tick(this.state, this.now(), { maxSteps: 400 });
    return snapshot(this.state, { good, tf, owner: this.owner });
  }

  async act(a: ClientAction, good: GoodId, tf: 'm' | 'h'): Promise<ActReply> {
    const now = this.now();
    tick(this.state, now, { maxSteps: 400 });
    const tagOf = (o: string) => maskOwner(o, null);
    const r =
      a.t === 'join'
        ? { ok: true, fills: [] as GeFill[] }
        : isDealAction(a)
          ? dealAct(this.state, this.owner, a, now, tagOf)
          : playerAct(this.state, this.owner, a, now);
    return {
      ok: r.ok,
      ...('reason' in r && r.reason !== undefined ? { reason: r.reason } : {}),
      fills: r.fills,
      ...('deal' in r && r.deal !== undefined ? { deal: r.deal } : {}),
      deals: dealsView(this.state, this.owner, now, tagOf),
      snapshot: snapshot(this.state, { good, tf, owner: this.owner }),
    };
  }
}
