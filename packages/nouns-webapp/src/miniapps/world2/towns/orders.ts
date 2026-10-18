// ── Street orders: who wants what, how long they'll wait, the tip ────────
//
// Pure + clock-free (callers pass `now` in seconds and a random source), so
// the rules are unit-tested. Crazy Taxi style: customers stand at the
// roadside with an order bubble and a countdown; get within SERVE_R (on
// foot, on the board or in the van) and the item flies over. The tip
// grows with the speed of the hand-off and the time left on the clock.
// ICE CREAM melts: its orders are short, shortest in the desert.
//
// Prices here are only the local fallback / preview. When the trade/
// economy is merged the server ledger decides what a street sale pays
// (TradeApi.act({ t: 'serve' })); the tip is the street's style bonus.

import type { GoodId, TownId } from '../trade/contract';

import { TOWNS } from './specs';

/** Serve range (m, horizontal) and how far above / below you can be. */
export const SERVE_R = 6;
export const SERVE_DY = 4;
/** Compass + "hold E" zone: further than this, E does nothing here. */
export const NEAR_R = 16;

/** Reference street price per unit (COIN), before the town's bias. */
export const STREET_PRICE: Record<GoodId, number> = {
  ICECREAM: 6,
  FRIES: 4,
  FISH: 5,
  DRIP: 14,
  NOGGLES: 10,
  PIZZA: 7,
  WATER: 3,
};

const ALL_GOODS = Object.keys(STREET_PRICE) as GoodId[];

/** How long a customer waits (s). Ice cream melts; the desert melts it fastest. */
export function orderDuration(town: TownId, good: GoodId): number {
  if (good === 'ICECREAM') return town === 'cowboy' ? 16 : town === 'beach' ? 22 : 26;
  if (good === 'WATER' && town === 'cowboy') return 24;
  return 38;
}

/** True when the order spoils rather than just running out (bubble drips). */
export const melts = (good: GoodId) => good === 'ICECREAM';

/**
 * What a customer here asks for: weighted by the town's demand (bias²),
 * never something the town makes itself.
 */
export function pickGood(town: TownId, rnd: () => number): GoodId {
  const m = TOWNS[town].market;
  const ws = ALL_GOODS.map(g => (m.makes.includes(g) ? 0 : (m.bias[g] ?? 1) ** 2));
  const sum = ws.reduce((a, b) => a + b, 0);
  let r = rnd() * sum;
  for (let i = 0; i < ALL_GOODS.length; i++) {
    r -= ws[i];
    if (r < 0) return ALL_GOODS[i];
  }
  return ALL_GOODS[ALL_GOODS.length - 1];
}

/** Local price of one unit in this town (COIN). */
export function streetPrice(town: TownId, good: GoodId): number {
  return Math.max(1, Math.round(STREET_PRICE[good] * (TOWNS[town].market.bias[good] ?? 1)));
}

export interface Order {
  customer: string;
  town: TownId;
  good: GoodId;
  /** Placed at / runs for (s). */
  t0: number;
  dur: number;
}

export const timeLeft = (o: Order, now: number) => Math.max(0, o.t0 + o.dur - now);
export const fracLeft = (o: Order, now: number) => timeLeft(o, now) / o.dur;

export interface Tip {
  price: number;
  tip: number;
  total: number;
  /** HUD shout: 'DRIVE-BY!', 'SPEEDY!', 'SERVED'. */
  grade: string;
}

/** Hand-off speeds (m/s) that count as a drive-by / max out the speed bonus. */
export const DRIVE_BY = 12;
const SPEED_MAX = 35;

/**
 * The tip for serving `o` at `now` while moving at `speed` m/s: up to the
 * price again for a fresh order, ×2.5 for a full-speed hand-off; a nearly
 * melted order still gets a little.
 */
export function tipFor(o: Order, now: number, speed: number, price?: number): Tip {
  const p = price ?? streetPrice(o.town, o.good);
  const left = fracLeft(o, now);
  const sp = Math.min(Math.max(speed, 0), SPEED_MAX) / SPEED_MAX;
  const tip = Math.round(p * (0.15 + 0.85 * left) * (1 + 1.5 * sp));
  const grade = speed >= DRIVE_BY ? 'DRIVE-BY!' : left > 0.66 ? 'SPEEDY!' : 'SERVED';
  return { price: p, tip, total: p + tip, grade };
}

/** Horizontal distance ≤ r and within SERVE_DY vertically. */
export function inServeRange(
  p: { x: number; y: number; z: number },
  c: { x: number; y: number; z: number },
  r = SERVE_R,
): boolean {
  const dx = p.x - c.x;
  const dz = p.z - c.z;
  return dx * dx + dz * dz <= r * r && Math.abs(p.y - c.y) <= SERVE_DY;
}

// ── A town's order board ──

export interface BoardOpts {
  /** Most orders open at once. */
  maxOpen: number;
  /** Wait (s) between a customer's orders: [min, max]. */
  cooldown: [number, number];
}

export const BOARD_DEFAULTS: BoardOpts = { maxOpen: 3, cooldown: [8, 22] };

export type OrderEvent =
  | { t: 'open'; order: Order }
  | { t: 'expire'; order: Order }
  | { t: 'served'; order: Order; tip: Tip };

/** Orders for one town's customers. Deterministic given `rnd` and the `now`s fed in. */
export class OrderBoard {
  readonly open = new Map<string, Order>();
  /** Customer → earliest time they'll order again. */
  private nextAt = new Map<string, number>();

  constructor(
    readonly town: TownId,
    readonly customers: string[],
    private rnd: () => number,
    private opts: BoardOpts = BOARD_DEFAULTS,
    start = 0,
  ) {
    // Staggered first orders so the town doesn't all shout at once
    customers.forEach((c, i) => this.nextAt.set(c, start + 1.5 + i * 2.5 + rnd() * 3));
  }

  /** Advance to `now`: expire late orders, open new ones. */
  update(now: number): OrderEvent[] {
    const ev: OrderEvent[] = [];
    for (const o of [...this.open.values()])
      if (timeLeft(o, now) <= 0) {
        this.open.delete(o.customer);
        this.rest(o.customer, now);
        ev.push({ t: 'expire', order: o });
      }
    for (const c of this.customers) {
      if (this.open.size >= this.opts.maxOpen) break;
      if (this.open.has(c) || now < (this.nextAt.get(c) ?? 0)) continue;
      const good = pickGood(this.town, this.rnd);
      const o: Order = {
        customer: c,
        town: this.town,
        good,
        t0: now,
        dur: orderDuration(this.town, good),
      };
      this.open.set(c, o);
      ev.push({ t: 'open', order: o });
    }
    return ev;
  }

  /** Serve a customer's open order (null if they have none). */
  serve(customer: string, now: number, speed: number, price?: number): OrderEvent | null {
    const o = this.open.get(customer);
    if (o === undefined || timeLeft(o, now) <= 0) return null;
    this.open.delete(customer);
    this.rest(customer, now);
    return { t: 'served', order: o, tip: tipFor(o, now, speed, price) };
  }

  private rest(customer: string, now: number) {
    const [a, b] = this.opts.cooldown;
    this.nextAt.set(customer, now + a + this.rnd() * (b - a));
  }
}

/** Small seeded PRNG (mulberry32) for tests / reproducible boards. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
