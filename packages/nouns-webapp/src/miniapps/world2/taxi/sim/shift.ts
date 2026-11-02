// ── NOUN TAXI: a shift (the run: clock, rides, totals; pure) ──────────────
//
// A shift starts when the first fare gets in. The shift clock (SHIFT.start
// s) runs while the cab is empty; a fare's own clock (pay.ts allowance)
// runs while they ride, and the shift clock waits. A drop-off pays and
// gives the shift clock time back (DropPay.bonusTime); a fare whose clock
// runs out gets out, unpaid (SHIFT.bailCost s off the shift clock). The
// shift ends when its clock hits 0 with the cab empty, or when you get out
// of the cab. Hitchhikers ride on the same clocks when you're on shift.

import type { Destination } from './destinations';

import { allowance, dropPay, styleCap, type DropPay, type RideKind } from './pay';
import { StyleMeter } from './style';

export const SHIFT = {
  start: 75,
  bailCost: 5,
  /** Stop within the drop zone under this (m/s) to drop off; at a fare under this to pick up. */
  dropSpeed: 3.5,
  pickupSpeed: 3.2,
  pickupR: 9,
  /** Seconds a fare takes to get in / out (the doors). */
  boardS: 0.9,
} as const;

export interface Ride {
  id: string;
  kind: RideKind;
  name: string;
  dest: Destination;
  /** Route length when they got in (m): what the meter charges. */
  metres: number;
  allow: number;
  t: number;
  style: StyleMeter;
  /** Pay town they got in at (trade/ledger `fare` from). */
  from: string;
}

export interface ShiftTotals {
  fares: number;
  coin: number;
  tips: number;
  metres: number;
  longest: number;
  bestChain: number;
  longestAir: number;
  topKmh: number;
  bails: number;
  seconds: number;
}

export type ShiftEvent =
  | { t: 'bail'; ride: Ride }
  | { t: 'over'; totals: ShiftTotals }
  | { t: 'warn'; left: number };

export function emptyTotals(): ShiftTotals {
  return {
    fares: 0,
    coin: 0,
    tips: 0,
    metres: 0,
    longest: 0,
    bestChain: 0,
    longestAir: 0,
    topKmh: 0,
    bails: 0,
    seconds: 0,
  };
}

export type RideIn = Omit<Ride, 't' | 'style' | 'allow'> & { road: boolean };

/** A ride on the meter (its clock from the route's length; style tips capped). */
export function makeRide(r: RideIn): Ride {
  return {
    id: r.id,
    kind: r.kind,
    name: r.name,
    dest: r.dest,
    metres: r.metres,
    from: r.from,
    allow: allowance(r.metres, r.road),
    t: 0,
    style: new StyleMeter(styleCap(r.metres, r.kind)),
  };
}

export class Shift {
  on = false;
  clock: number = SHIFT.start;
  ride: Ride | null = null;
  totals: ShiftTotals = emptyTotals();
  private warned = new Set<number>();

  /** A passenger gets in (starts the shift if it's off). */
  board(r: RideIn): Ride {
    if (!this.on) {
      this.on = true;
      this.clock = SHIFT.start;
      this.totals = emptyTotals();
      this.warned.clear();
    }
    const ride = makeRide(r);
    this.ride = ride;
    return ride;
  }

  /** Time passes; `kmh` the cab's speed. */
  tick(dt: number, kmh: number): ShiftEvent[] {
    if (!this.on) return [];
    const ev: ShiftEvent[] = [];
    this.totals.seconds += dt;
    this.totals.topKmh = Math.max(this.totals.topKmh, Math.round(kmh));
    const r = this.ride;
    if (r !== null) {
      r.t += dt;
      if (r.t >= r.allow) {
        this.ride = null;
        this.totals.bails++;
        this.clock = Math.max(0, this.clock - SHIFT.bailCost);
        ev.push({ t: 'bail', ride: r });
      }
      return ev;
    }
    this.clock -= dt;
    for (const w of [10, 5]) {
      if (this.clock <= w && !this.warned.has(w)) {
        this.warned.add(w);
        ev.push({ t: 'warn', left: w });
      }
    }
    if (this.clock <= 0) ev.push({ t: 'over', totals: this.end() });
    return ev;
  }

  /** The passenger gets out at their stop: pay, time back. */
  drop(): DropPay | null {
    const r = this.ride;
    if (r === null) return null;
    const pay = dropPay(r.metres, r.kind, r.allow, r.t, r.style.tips);
    this.ride = null;
    this.clock += pay.bonusTime;
    if (this.clock > 10) this.warned.clear();
    const T = this.totals;
    T.fares++;
    T.coin += pay.total;
    T.tips += pay.speedTip + pay.styleTip;
    T.metres += r.metres;
    T.longest = Math.max(T.longest, r.metres);
    T.bestChain = Math.max(T.bestChain, r.style.bestChain);
    T.longestAir = Math.max(T.longestAir, r.style.longestAir);
    return pay;
  }

  /** Clock out (out of the cab, or the clock ran down). */
  end(): ShiftTotals {
    const r = this.ride;
    if (r !== null) {
      this.totals.bestChain = Math.max(this.totals.bestChain, r.style.bestChain);
      this.totals.longestAir = Math.max(this.totals.longestAir, r.style.longestAir);
    }
    this.on = false;
    this.ride = null;
    this.clock = SHIFT.start;
    return { ...this.totals, seconds: Math.round(this.totals.seconds) };
  }
}

// ── Local bests (no physics proof for a shift: local only) ──

export interface TaxiBests {
  coin: number;
  fares: number;
  longest: number;
  bestChain: number;
}

export const BESTS_KEY = 'noun-taxi-v1';

export function parseBests(raw: string | null): TaxiBests {
  const zero: TaxiBests = { coin: 0, fares: 0, longest: 0, bestChain: 0 };
  if (raw === null) return zero;
  try {
    const o = JSON.parse(raw) as Partial<TaxiBests>;
    const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
    return { coin: n(o.coin), fares: n(o.fares), longest: n(o.longest), bestChain: n(o.bestChain) };
  } catch {
    return zero;
  }
}

/** Fold a shift into the bests; `beat` lists which ones it broke. */
export function foldBests(
  b: TaxiBests,
  t: ShiftTotals,
): { bests: TaxiBests; beat: (keyof TaxiBests)[] } {
  const beat: (keyof TaxiBests)[] = [];
  const next = { ...b };
  const check = (k: keyof TaxiBests, v: number) => {
    if (v > b[k]) {
      next[k] = v;
      beat.push(k);
    }
  };
  check('coin', t.coin);
  check('fares', t.fares);
  check('longest', Math.round(t.longest));
  check('bestChain', t.bestChain);
  return { bests: next, beat };
}
