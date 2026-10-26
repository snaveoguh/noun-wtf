// ── 3D Grand Exchange: fills → visible trades (pure scheduler) ──────────
//
// A fill names a buyer and a seller. On the floor the two walk to each
// other at the good's pit (approach), shake on it (meet), the goods fly
// seller → buyer and the COIN flies back (swap), then both go back to
// milling (done). The view plays the events this returns; the scheduler
// only decides who, where and when.
//
//  • Real fills always play. If either trader is busy in another trade they
//    queue; after QUEUE_WAIT they play "quick" (no walk: the goods fly
//    between wherever the two stand) so a busy market maker never backs up
//    the tape.
//  • Simulated fills only play when both traders are free and there is room
//    (maxActive); otherwise they are dropped. Real ones never are.

import { PIT_R_OUT, PIT_STEPS, pitSpot, type Pit } from './layout';

export interface FillJob {
  key: string;
  good: Pit['good'];
  qty: number;
  price: number;
  /** Trader indices. */
  buyer: number;
  seller: number;
  real: boolean;
}

export type TradePhase = 'approach' | 'meet' | 'swap' | 'done';

export interface Spot {
  x: number;
  z: number;
  face: number;
}

export interface TradeAnim {
  id: number;
  job: FillJob;
  phase: TradePhase;
  /** When this phase began (s). */
  since: number;
  /** When the trade started (s). */
  start: number;
  /** No walk: the swap plays between wherever the two stand. */
  quick: boolean;
  meet: { x: number; z: number };
  /** [buyer, seller] spots. */
  spots: [Spot, Spot];
}

export type TradeEvent =
  | { t: 'start'; a: TradeAnim }
  | { t: 'meet'; a: TradeAnim }
  | { t: 'swap'; a: TradeAnim }
  | { t: 'done'; a: TradeAnim };

export const TIMING = {
  /** Longest walk before they shake anyway. */
  APPROACH_MAX: 4.5,
  MEET: 0.9,
  SWAP: 1.0,
  /** A queued real fill plays quick after waiting this long. */
  QUEUE_WAIT: 4,
  /** How far apart the two stand to shake. */
  GAP: 1.05,
} as const;

export interface SchedulerHost {
  pos(i: number): { x: number; z: number };
  /** Free to be taken (not held, not on the balcony). */
  free(i: number): boolean;
  arrived(i: number): boolean;
  hold(i: number, trade: number, s: Spot): void;
  release(i: number, trade: number): void;
  pit(good: Pit['good']): Pit;
}

export interface SchedulerOpts {
  /** Most full (walking) trades at once. */
  maxActive: number;
  /** Most real fills waiting. Older ones beyond it play quick at once. */
  maxQueue?: number;
}

/** Where two traders meet for a fill: between them, pulled onto the good's pit. */
export function meetPoint(
  a: { x: number; z: number },
  b: { x: number; z: number },
  pit: Pit,
): { x: number; z: number } {
  const mx = (a.x + b.x) / 2;
  const mz = (a.z + b.z) / 2;
  const dx = mx - pit.x;
  const dz = mz - pit.z;
  if (Math.hypot(dx, dz) <= PIT_R_OUT + 2) return { x: mx, z: mz };
  // Far from the pit: meet on its rim, on the side facing them
  return pitSpot(pit, Math.atan2(dz, dx), PIT_STEPS - 1);
}

/** The buyer's and seller's spots either side of the meet point, facing each other. */
export function spotsFor(
  meet: { x: number; z: number },
  buyer: { x: number; z: number },
  seller: { x: number; z: number },
): [Spot, Spot] {
  let ax = seller.x - buyer.x;
  let az = seller.z - buyer.z;
  const d = Math.hypot(ax, az);
  if (d < 1e-6) {
    ax = 1;
    az = 0;
  } else {
    ax /= d;
    az /= d;
  }
  const h = TIMING.GAP / 2;
  const toSeller = Math.atan2(ax, az);
  return [
    { x: meet.x - ax * h, z: meet.z - az * h, face: toSeller },
    { x: meet.x + ax * h, z: meet.z + az * h, face: toSeller + Math.PI },
  ];
}

export class TradeScheduler {
  private seq = 0;
  private live: TradeAnim[] = [];
  private queue: { job: FillJob; at: number }[] = [];
  private busySet = new Map<number, number>();
  readonly maxActive: number;
  readonly maxQueue: number;
  /** Counters for the HUD / tests. */
  stats = { played: 0, quick: 0, dropped: 0, real: 0 };

  constructor(
    private readonly host: SchedulerHost,
    o: SchedulerOpts,
  ) {
    this.maxActive = o.maxActive;
    this.maxQueue = o.maxQueue ?? 24;
  }

  get active(): readonly TradeAnim[] {
    return this.live;
  }
  get queued(): number {
    return this.queue.length;
  }

  /** Is this trader in a trade (walking, shaking, swapping)? */
  busy(i: number): boolean {
    return this.busySet.has(i);
  }

  private fullCount() {
    let n = 0;
    for (const a of this.live) if (!a.quick) n++;
    return n;
  }

  private canTake(i: number) {
    return !this.busySet.has(i) && this.host.free(i);
  }

  /** Offer a fill. Returns false when a simulated one is dropped. */
  push(job: FillJob, now: number): boolean {
    if (job.buyer === job.seller || job.qty <= 0) {
      this.stats.dropped++;
      return false;
    }
    if (job.real) {
      this.stats.real++;
      this.queue.push({ job, at: now });
      // Too many waiting: the oldest plays quick right now
      while (this.queue.length > this.maxQueue) this.begin(this.queue.shift()!.job, now, true);
      return true;
    }
    if (
      this.fullCount() >= this.maxActive ||
      !this.canTake(job.buyer) ||
      !this.canTake(job.seller)
    ) {
      this.stats.dropped++;
      return false;
    }
    this.begin(job, now, false);
    return true;
  }

  private begin(job: FillJob, now: number, quick: boolean): TradeAnim {
    const b = this.host.pos(job.buyer);
    const s = this.host.pos(job.seller);
    const meet = quick
      ? { x: (b.x + s.x) / 2, z: (b.z + s.z) / 2 }
      : meetPoint(b, s, this.host.pit(job.good));
    const spots = spotsFor(meet, b, s);
    const a: TradeAnim = {
      id: ++this.seq,
      job,
      phase: quick ? 'swap' : 'approach',
      since: now,
      start: now,
      quick,
      meet,
      spots,
    };
    this.live.push(a);
    this.stats.played++;
    if (quick) this.stats.quick++;
    else {
      this.busySet.set(job.buyer, a.id);
      this.busySet.set(job.seller, a.id);
      this.host.hold(job.buyer, a.id, spots[0]);
      this.host.hold(job.seller, a.id, spots[1]);
    }
    this.fresh.push({ t: quick ? 'swap' : 'start', a });
    return a;
  }

  private fresh: TradeEvent[] = [];

  step(now: number): TradeEvent[] {
    const out: TradeEvent[] = this.fresh;
    this.fresh = [];
    // Queued real fills: start when both are free, or quick once they've waited
    for (let k = 0; k < this.queue.length; ) {
      const q = this.queue[k]!;
      const { job } = q;
      const room = this.fullCount() < this.maxActive;
      if (room && this.canTake(job.buyer) && this.canTake(job.seller)) {
        this.queue.splice(k, 1);
        this.begin(job, now, false);
      } else if (now - q.at >= TIMING.QUEUE_WAIT) {
        this.queue.splice(k, 1);
        this.begin(job, now, true);
      } else k++;
    }
    out.push(...this.fresh);
    this.fresh = [];
    const keep: TradeAnim[] = [];
    for (const a of this.live) {
      const el = now - a.since;
      if (a.phase === 'approach') {
        const there = this.host.arrived(a.job.buyer) && this.host.arrived(a.job.seller);
        if (there || el >= TIMING.APPROACH_MAX) {
          a.phase = 'meet';
          a.since = now;
          out.push({ t: 'meet', a });
        }
      } else if (a.phase === 'meet') {
        if (el >= TIMING.MEET) {
          a.phase = 'swap';
          a.since = now;
          out.push({ t: 'swap', a });
        }
      } else if (a.phase === 'swap') {
        if (el >= TIMING.SWAP) {
          a.phase = 'done';
          a.since = now;
          out.push({ t: 'done', a });
          if (!a.quick) {
            for (const i of [a.job.buyer, a.job.seller]) {
              if (this.busySet.get(i) === a.id) this.busySet.delete(i);
              this.host.release(i, a.id);
            }
          }
          continue;
        }
      }
      keep.push(a);
    }
    this.live = keep;
    return out;
  }
}
