import { describe, expect, it } from 'vitest';

import { PIT_BY_GOOD, PIT_R_OUT } from './layout';
import {
  meetPoint,
  spotsFor,
  TIMING,
  TradeScheduler,
  type FillJob,
  type SchedulerHost,
  type Spot,
} from './trades';

/** A fake floor: traders teleport to their spot after `walk` seconds. */
function floor(n: number, walk = 1) {
  const pos = Array.from({ length: n }, (_, i) => ({ x: i * 2, z: 0 }));
  const held = new Map<number, { trade: number; s: Spot; at: number }>();
  let now = 0;
  const host: SchedulerHost = {
    pos: i => pos[i]!,
    free: i => !held.has(i),
    arrived: i => {
      const h = held.get(i);
      if (h === undefined) return true;
      if (now - h.at >= walk) {
        pos[i] = { x: h.s.x, z: h.s.z };
        return true;
      }
      return false;
    },
    hold: (i, trade, s) => held.set(i, { trade, s, at: now }),
    release: (i, trade) => {
      if (held.get(i)?.trade === trade) held.delete(i);
    },
    pit: g => PIT_BY_GOOD[g],
  };
  return { host, held, setNow: (t: number) => (now = t) };
}

const job = (buyer: number, seller: number, real = false, key = `${buyer}-${seller}`): FillJob => ({
  key,
  good: 'FRIES',
  qty: 6,
  price: 8,
  buyer,
  seller,
  real,
});

function run(s: TradeScheduler, f: ReturnType<typeof floor>, from: number, to: number, dt = 0.05) {
  const evs: string[] = [];
  for (let t = from; t <= to + 1e-9; t += dt) {
    f.setNow(t);
    for (const e of s.step(t)) evs.push(`${e.t}:${e.a.job.key}`);
  }
  return evs;
}

describe('meet points', () => {
  it('meets between the two when near the pit, on the rim when far', () => {
    const pit = PIT_BY_GOOD.FRIES;
    const near = meetPoint({ x: pit.x - 1, z: pit.z }, { x: pit.x + 1, z: pit.z }, pit);
    expect(near).toEqual({ x: pit.x, z: pit.z });
    const far = meetPoint({ x: pit.x + 60, z: pit.z }, { x: pit.x + 62, z: pit.z }, pit);
    expect(Math.hypot(far.x - pit.x, far.z - pit.z)).toBeLessThan(PIT_R_OUT);
    expect(far.x).toBeGreaterThan(pit.x);
  });

  it('spots face each other, GAP apart', () => {
    const [b, s] = spotsFor({ x: 0, z: 0 }, { x: -5, z: 0 }, { x: 5, z: 0 });
    expect(Math.hypot(b.x - s.x, b.z - s.z)).toBeCloseTo(TIMING.GAP);
    expect(b.x).toBeLessThan(s.x);
    expect(Math.sin(b.face)).toBeCloseTo(1); // buyer faces +x
    expect(Math.sin(s.face)).toBeCloseTo(-1);
  });
});

describe('TradeScheduler', () => {
  it('plays a fill through approach → meet → swap → done and frees both', () => {
    const f = floor(4, 1);
    const s = new TradeScheduler(f.host, { maxActive: 4 });
    expect(s.push(job(0, 1), 0)).toBe(true);
    expect(s.busy(0) && s.busy(1)).toBe(true);
    const evs = run(s, f, 0, 5);
    expect(evs).toEqual(['start:0-1', 'meet:0-1', 'swap:0-1', 'done:0-1']);
    expect(s.busy(0) || s.busy(1)).toBe(false);
    expect(f.held.size).toBe(0);
    expect(s.active).toHaveLength(0);
  });

  it('times phases: meet waits for arrival, swap after MEET, done after SWAP', () => {
    const f = floor(2, 2);
    const s = new TradeScheduler(f.host, { maxActive: 2 });
    s.push(job(0, 1), 0);
    const at: Record<string, number> = {};
    for (let t = 0; t <= 6; t += 0.05) {
      f.setNow(t);
      for (const e of s.step(t)) at[e.t] ??= t;
    }
    expect(at.meet).toBeGreaterThanOrEqual(2 - 1e-9);
    expect(at.swap! - at.meet!).toBeCloseTo(TIMING.MEET, 1);
    expect(at.done! - at.swap!).toBeCloseTo(TIMING.SWAP, 1);
  });

  it('gives up walking after APPROACH_MAX', () => {
    const f = floor(2, 999);
    const s = new TradeScheduler(f.host, { maxActive: 2 });
    s.push(job(0, 1), 0);
    let meet = -1;
    for (let t = 0; t <= 8 && meet < 0; t += 0.05) {
      f.setNow(t);
      if (s.step(t).some(e => e.t === 'meet')) meet = t;
    }
    expect(meet).toBeCloseTo(TIMING.APPROACH_MAX, 1);
  });

  it('drops simulated fills when full or a trader is busy; never real ones', () => {
    const f = floor(10);
    const s = new TradeScheduler(f.host, { maxActive: 2 });
    expect(s.push(job(0, 1), 0)).toBe(true);
    expect(s.push(job(1, 2), 0)).toBe(false); // 1 is busy
    expect(s.push(job(2, 3), 0)).toBe(true);
    expect(s.push(job(4, 5), 0)).toBe(false); // full
    expect(s.push(job(4, 5, true, 'real'), 0)).toBe(true);
    expect(s.push(job(3, 3), 0)).toBe(false); // self trade
    expect(s.stats.dropped).toBe(3);
  });

  it('queues a real fill until its trader is free, then plays it in full', () => {
    const f = floor(4, 0.5);
    const s = new TradeScheduler(f.host, { maxActive: 4 });
    s.push(job(0, 1, false, 'a'), 0);
    s.push(job(1, 2, true, 'b'), 0); // trader 1 busy with 'a'
    expect(s.queued).toBe(1);
    const evs = run(s, f, 0, 6);
    expect(evs.indexOf('start:b')).toBeGreaterThan(evs.indexOf('done:a'));
    expect(evs).toContain('done:b');
    expect(s.stats.quick).toBe(0);
  });

  it('a real fill that waits too long plays quick (no walk)', () => {
    const f = floor(3, 999);
    const s = new TradeScheduler(f.host, { maxActive: 4 });
    s.push(job(0, 1, false, 'slow'), 0);
    s.push(job(1, 2, true, 'r'), 0);
    const evs = run(s, f, 0, TIMING.QUEUE_WAIT + 2);
    expect(evs).toContain('swap:r');
    expect(evs).not.toContain('start:r');
    expect(evs).toContain('done:r');
    expect(s.stats.quick).toBe(1);
    // A quick trade never took trader 2
    expect(f.held.has(2)).toBe(false);
  });

  it('a backed-up queue flushes the oldest quick', () => {
    const f = floor(3, 999);
    const s = new TradeScheduler(f.host, { maxActive: 1, maxQueue: 2 });
    s.push(job(0, 1, false, 's'), 0);
    for (let k = 0; k < 4; k++) s.push(job(1, 2, true, `r${k}`), 0);
    expect(s.queued).toBe(2);
    expect(s.stats.quick).toBe(2);
  });
});
