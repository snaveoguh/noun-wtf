import { describe, expect, it } from 'vitest';

import type { SeaPoint } from '../sea';

import { seabedDepth } from '../coast';
import { seaSample, swellAt, wrap, type Swell } from '../waves';

import { SurfBot } from './bot';
import {
  enterWater,
  newWater,
  stepWater,
  WATER,
  type SeaQuery,
  type WaterEvent,
  type WaterInput,
  type WaterState,
} from './sim';

// A straight coast over the real waves: the sea is +z (d = z), the coast
// runs along x (a = x), the shore is z = 0, the beach rises to −z.
export function testSea(clock: { t: number }): SeaQuery {
  return {
    at(x, z, out: SeaPoint) {
      seaSample(0, z, x, x, z, clock.t, out);
      out.sx = 0;
      out.sz = -1;
      out.ax = 1;
      out.az = 0;
      out.d = z;
      out.bed = -seabedDepth(z);
      return out;
    },
    ground(_x, z) {
      return z > 0 ? -seabedDepth(z) : -z * 0.06;
    },
  };
}

const idle = (): WaterInput => ({
  moveX: 0,
  moveY: 0,
  camYaw: 0,
  jump: false,
  duck: false,
  duckHeld: false,
  sprint: false,
});

const TAU = Math.PI * 2;
const angleDiff = (a: number, b: number) => {
  let d = a - b;
  d -= TAU * Math.round(d / TAU);
  return d;
};

/** Run a policy for `secs` at `fps`; returns every event. */
function run(
  s: WaterState,
  q: SeaQuery,
  clock: { t: number },
  secs: number,
  fps: number,
  policy: (s: WaterState, ev: WaterEvent[]) => WaterInput,
  until?: (s: WaterState, ev: WaterEvent[]) => boolean,
): WaterEvent[] {
  const all: WaterEvent[] = [];
  const dt = 1 / fps;
  let last: WaterEvent[] = [];
  for (let i = 0; i < secs * fps; i++) {
    const ev: WaterEvent[] = [];
    stepWater(s, policy(s, last), q, dt, ev);
    clock.t += dt;
    all.push(...ev);
    last = ev;
    if (until?.(s, all)) break;
  }
  return all;
}

/** Seconds until the next big crest reaches d (at a), from t. */
export function nextBig(d: number, a: number, t0: number, minH = 1.7): number {
  const sw: Swell = { phi: 0, A: 0, k: 0, Dh: 0, ratio: 0, depth: 0 };
  let prev = wrap(swellAt(d, a, t0, sw).phi);
  for (let t = t0 + 0.05; t < t0 + 200; t += 0.05) {
    const p = swellAt(d, a, t, sw);
    const w = wrap(p.phi);
    if (w < prev - Math.PI && p.A * 2 > minH) return t - t0;
    prev = w;
  }
  return Infinity;
}

/** A surfer bot: waits at the line-up facing in, paddles for a big one, pops, rides down the line. */
export function surfer(clock: { t: number }, opts: { popLate?: number } = {}) {
  let paddleFrom = -1;
  return (s: WaterState, last: WaterEvent[]): WaterInput => {
    const inp = idle();
    if (s.phase === 'paddle') {
      // face the beach
      const want = Math.PI;
      inp.moveX = Math.max(-1, Math.min(1, -angleDiff(want, s.yaw) * 2));
      // time it: start paddling as the next big crest is ~14 m behind
      if (paddleFrom < 0) paddleFrom = clock.t + Math.max(0, nextBig(s.z + 14, s.x, clock.t));
      if (clock.t < paddleFrom) return inp;
      if (clock.t - paddleFrom < 9) {
        inp.moveY = 1;
        inp.sprint = true;
      }
      if (s.ready && clock.t >= (opts.popLate ?? 0)) inp.jump = true;
      void last;
      return inp;
    }
    if (s.phase === 'ride' || s.phase === 'pop') {
      // angle down the line (+x), higher on the face the further down you are
      const pm = wrap(s.phi);
      const theta = pm < 4.3 ? 1.75 : pm > 5.8 ? 0.9 : 1.3;
      const want = Math.atan2(Math.sin(theta), -Math.cos(theta));
      inp.moveX = Math.max(-1, Math.min(1, -angleDiff(want, s.yaw) * 2.5));
      return inp;
    }
    return inp;
  };
}

export function lineup(x = 0, z = 150, board: WaterState['board'] = 'longboard'): WaterState {
  const s = newWater(board);
  s.phase = 'paddle';
  s.x = x;
  s.z = z;
  s.yaw = Math.PI;
  return s;
}

describe('surfing', () => {
  for (const fps of [60, 20]) {
    it(`catches a set wave from the line-up and rides it down the line (${fps} fps)`, () => {
      const clock = { t: 40 };
      const q = testSea(clock);
      const s = lineup();
      const ev = run(s, q, clock, 60, fps, surfer(clock), st => st.phase === 'ride' && st.rideT > 9);
      expect(ev.some(e => e.type === 'catch')).toBe(true);
      expect(ev.some(e => e.type === 'pop')).toBe(true);
      expect(s.phase).toBe('ride');
      // stayed on the face for the whole ride, travelling along the coast
      const x0 = s.x;
      const ride: WaterEvent[] = run(s, q, clock, 6, fps, surfer(clock), st => st.phase !== 'ride');
      expect(s.phase).toBe('ride');
      expect(s.x - x0).toBeGreaterThan(25);
      expect(Math.hypot(s.vx, s.vz)).toBeGreaterThan(5);
      // the board sits on the surface you see
      const p = q.at(s.x, s.z, {} as SeaPoint)!;
      expect(Math.abs(s.y - p.y)).toBeLessThan(0.05);
      expect(ride.some(e => e.type === 'bail')).toBe(false);
    });
  }

  it('the same ride at 20 and 60 fps ends up in about the same place', () => {
    const ends: number[][] = [];
    for (const fps of [60, 20]) {
      const clock = { t: 40 };
      const q = testSea(clock);
      const s = lineup();
      run(s, q, clock, 40, fps, surfer(clock), st => st.phase === 'ride' && st.rideT > 6);
      ends.push([s.x, s.z]);
    }
    expect(Math.hypot(ends[0][0] - ends[1][0], ends[0][1] - ends[1][1])).toBeLessThan(6);
  });

  it('with no paddling the waves roll under you', () => {
    const clock = { t: 40 };
    const q = testSea(clock);
    const s = lineup(0, 260);
    const ev = run(s, q, clock, 40, 60, () => idle());
    expect(ev.some(e => e.type === 'catch')).toBe(false);
    expect(s.phase).toBe('paddle');
    // rocked about, not washed in
    expect(s.z).toBeGreaterThan(200);
  });

  it('wipes out when the lip lands on you (straight in as it breaks)', () => {
    const clock = { t: 40 };
    const q = testSea(clock);
    const s = lineup();
    // pop, then straight in and stall: the curl catches up
    const bot = surfer(clock);
    const ev = run(
      s,
      q,
      clock,
      60,
      60,
      (st, last) => {
        if (st.phase === 'ride') {
          // straight in: the wave breaks on top of you
          const inp = idle();
          inp.moveX = Math.max(-1, Math.min(1, -angleDiff(Math.PI, st.yaw) * 2));
          return inp;
        }
        return bot(st, last);
      },
      (_, all) => all.some(e => e.type === 'bail'),
    );
    expect(ev.some(e => e.type === 'bail')).toBe(true);
    expect(s.phase).toBe('wipeout');
    // and you come back up, on your board
    run(s, q, clock, WATER.wipeTime + 0.5, 60, () => idle());
    expect(['paddle', 'wade']).toContain(s.phase);
  });

  it('duck dives under a broken wave instead of being washed in', () => {
    const go = (duck: boolean) => {
      const clock = { t: 40 };
      const q = testSea(clock);
      const s = lineup(0, 70, 'shortboard');
      s.yaw = 0; // facing out
      // wait for the next whitewater to arrive
      const wait = nextBig(70, 0, clock.t, 0.9);
      run(s, q, clock, Math.max(0, wait - 0.6), 60, () => idle());
      const z0 = s.z;
      let ducked = false;
      run(s, q, clock, 2.5, 60, st => {
        const inp = idle();
        if (duck && !ducked && st.phase === 'paddle') {
          inp.duck = true;
          ducked = true;
        }
        return inp;
      });
      return s.z - z0;
    };
    const washed = go(false);
    const dived = go(true);
    expect(dived).toBeGreaterThan(washed + 0.5);
  });

  it('paddles out through the surf', () => {
    const clock = { t: 40 };
    const q = testSea(clock);
    const s = lineup(0, 30, 'longboard');
    s.yaw = 0;
    run(s, q, clock, 90, 30, st => {
      const inp = idle();
      inp.moveY = 1;
      inp.moveX = Math.max(-1, Math.min(1, -angleDiff(0, st.yaw) * 2));
      const p = q.at(st.x, st.z + 8, {} as SeaPoint)!;
      if (st.phase === 'paddle' && p.foam > 0.5 && p.broken > 0.5) inp.duck = true;
      return inp;
    });
    expect(s.z).toBeGreaterThan(160);
  });
});

describe('wading and swimming', () => {
  it('walks in off the beach, swims when deep, walks back out', () => {
    const clock = { t: 10 };
    const q = testSea(clock);
    const s = newWater(null);
    enterWater(s, 0, q.ground(0, 20), 20, 0, 0, 0);
    const ev: WaterEvent[] = [];
    const fwd = (y: number) => ({ ...idle(), moveY: y });
    // in (+z is out to sea; camera faces +z)
    for (let i = 0; i < 60 * 30 && s.phase !== 'swim'; i++) {
      stepWater(s, fwd(1), q, 1 / 60, ev);
      clock.t += 1 / 60;
    }
    expect(s.phase).toBe('swim');
    expect(s.z).toBeGreaterThan(20);
    // back out
    let out = false;
    for (let i = 0; i < 60 * 120; i++) {
      out = !stepWater(s, fwd(-1), q, 1 / 60, ev);
      clock.t += 1 / 60;
      if (out) break;
    }
    expect(out).toBe(true);
    expect(s.phase).toBe('off');
    expect(ev.some(e => e.type === 'exit')).toBe(true);
  });

  it('a board in the shallows: you walk it out, then paddle', () => {
    const clock = { t: 10 };
    const q = testSea(clock);
    const s = newWater('foamie');
    enterWater(s, 0, q.ground(0, 20), 20, 0, 0, 0);
    for (let i = 0; i < 60 * 40 && s.phase === 'wade'; i++) {
      stepWater(s, { ...idle(), moveY: 1 }, q, 1 / 60, []);
      clock.t += 1 / 60;
    }
    expect(s.phase).toBe('paddle');
  });
});

describe('airs', () => {
  const air = (spin: number, yawOff: number) => {
    const clock = { t: 3 };
    const q = testSea(clock);
    const s = lineup(0, 120, 'shortboard');
    const p = q.at(0, 120, {} as SeaPoint)!;
    s.phase = 'air';
    s.y = p.y + 1.2;
    s.vx = 6;
    s.vz = -2;
    s.vy = 2;
    s.yaw = Math.atan2(6, -2) + yawOff;
    s.airSpin = spin;
    const ev: WaterEvent[] = [];
    for (let i = 0; i < 240 && s.phase === 'air'; i++) stepWater(s, idle(), q, 1 / 60, ev);
    return { s, ev };
  };
  it('lands square: an air (360s and reverses score more)', () => {
    const a = air(0, 0);
    expect(a.s.phase).toBe('ride');
    const t = a.ev.find(e => e.type === 'trick') as { name: string; points: number };
    expect(t.name).toBe('Air');
    const b = air(TAU, 0);
    const tb = b.ev.find(e => e.type === 'trick') as { name: string; points: number };
    expect(tb.name).toBe('Air 360');
    expect(tb.points).toBeGreaterThan(t.points);
    const r = air(Math.PI, Math.PI);
    expect(r.s.phase).toBe('ride');
    expect((r.ev.find(e => e.type === 'trick') as { name: string }).name).toBe('Air Reverse');
  });
  it('lands sideways: wipeout', () => {
    const a = air(Math.PI / 2, Math.PI / 2);
    expect(a.s.phase).toBe('wipeout');
    expect(a.ev.some(e => e.type === 'bail')).toBe(true);
  });
});

describe('the line-up locals (SurfBot)', () => {
  it('sits at their spot, catches waves, rides them and paddles back out', () => {
    const clock = { t: 12 };
    const q = testSea(clock);
    const s = lineup(0, 150, 'longboard');
    const blank = () => ({}) as SeaPoint;
    const bot = new SurfBot(0, 150, 3, blank);
    let rides = 0;
    let longest = 0;
    let back = 0;
    let was = s.phase;
    for (let i = 0; i < 30 * 240; i++) {
      stepWater(s, bot.input(s, q), q, 1 / 30, []);
      clock.t += 1 / 30;
      if (s.phase === 'ride' && was !== 'ride') rides++;
      if (s.phase === 'ride') longest = Math.max(longest, s.rideT);
      if (s.phase === 'paddle' && Math.hypot(s.x, s.z - 150) < 12 && rides > 0) back++;
      was = s.phase;
    }
    expect(rides).toBeGreaterThanOrEqual(2);
    expect(longest).toBeGreaterThan(5);
    expect(back).toBeGreaterThan(0);
  });
});
