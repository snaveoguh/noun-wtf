// ── NOUN TAXI: what a ride pays (pure, shared with the trade ledger) ──────
//
// A fare pays a flag fall plus a per-metre rate on the route's length, a
// speed tip for time left on its clock, and style tips (near misses, airs,
// drifts) capped per ride. Hitchhikers pay a little and never tip for
// style. trade/ledger.ts ('fare' action) bounds what the server pays with
// maxPay(), so the client's tips can never mint more than this table says.

export type RideKind = 'fare' | 'hitch';

export const FARE = {
  /** Flag fall and rate (COIN, COIN per metre). */
  base: 6,
  perM: 0.008,
  hitchBase: 2,
  hitchPerM: 0.003,
  /** Speed tip: this share of the fare at a full clock left. */
  speedTip: 0.6,
  /** Style tips per ride: at most this share of the fare plus a flat bit. */
  styleShare: 0.5,
  styleFlat: 25,
  /** The fare's clock: a grace plus the distance at a reference pace. */
  grace: 14,
  /** Reference pace (m/s): the city's streets, the open lines. */
  paceCity: 15,
  paceRoad: 40,
} as const;

/** The metered fare (whole COIN) for a ride of `m` metres. */
export function baseFare(m: number, kind: RideKind): number {
  const d = Math.max(0, m);
  return kind === 'hitch'
    ? Math.max(1, Math.round(FARE.hitchBase + FARE.hitchPerM * d))
    : Math.max(1, Math.round(FARE.base + FARE.perM * d));
}

/** Most style tips one ride can earn. */
export function styleCap(m: number, kind: RideKind): number {
  if (kind === 'hitch') return 0;
  return Math.round(baseFare(m, kind) * FARE.styleShare + FARE.styleFlat);
}

/** Seconds on a fare's clock for a route of `m` metres (`road`: part of it on a dirt line). */
export function allowance(m: number, road: boolean): number {
  const pace = road ? FARE.paceRoad : FARE.paceCity;
  return Math.round(FARE.grace + Math.max(0, m) / pace);
}

/** The most a ride of `m` metres can ever pay (fare + full speed tip + full style tips). */
export function maxPay(m: number, kind: RideKind = 'fare'): number {
  const f = baseFare(m, kind);
  const speed = kind === 'hitch' ? 0 : Math.ceil(f * FARE.speedTip);
  return f + speed + styleCap(m, kind);
}

export type Grade = 'S' | 'A' | 'B' | 'C';

export interface DropPay {
  fare: number;
  speedTip: number;
  styleTip: number;
  total: number;
  grade: Grade;
  /** Seconds the shift clock gets back. */
  bonusTime: number;
  /** 0..1 of the fare's clock left. */
  left: number;
}

export const GRADE_LINE: Record<Grade, string> = {
  S: 'SPEEDY!',
  A: 'GREAT RIDE',
  B: 'NOT BAD',
  C: 'FINALLY…',
};

/** What a drop-off pays: `used` seconds of `allow` on the clock, `style` tips earned. */
export function dropPay(
  m: number,
  kind: RideKind,
  allow: number,
  used: number,
  style: number,
): DropPay {
  const fare = baseFare(m, kind);
  const left = allow > 0 ? Math.max(0, Math.min(1, (allow - used) / allow)) : 0;
  const speedTip = kind === 'hitch' ? 0 : Math.round(fare * FARE.speedTip * left);
  const styleTip = Math.max(0, Math.min(styleCap(m, kind), Math.round(style)));
  const grade: Grade = left > 0.5 ? 'S' : left > 0.3 ? 'A' : left > 0.1 ? 'B' : 'C';
  const bonusTime = Math.round(4 + 16 * left + Math.min(20, (m / 1000) * 2));
  return { fare, speedTip, styleTip, total: fare + speedTip + styleTip, grade, bonusTime, left };
}
