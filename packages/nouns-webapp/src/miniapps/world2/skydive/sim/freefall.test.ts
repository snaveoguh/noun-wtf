import { describe, expect, it } from 'vitest';

import { SKY, type SkyInput } from '../contract';

import { canPull, end, enter, newSky, pull, shouldEnter, shouldOffer, stepSky } from './freefall';

const inp = (o: Partial<SkyInput> = {}): SkyInput => ({
  moveX: 0,
  moveY: 0,
  dive: false,
  pull: false,
  ...o,
});

/** The sim + the Player's own gravity step, at 90 Hz. */
function fly(secs: number, i: SkyInput | ((t: number) => SkyInput), vy = -10, pulled = -1) {
  const s = newSky();
  enter(s, vy);
  const v = { x: 0, y: vy, z: 0 };
  let yaw = 0;
  let y = 0;
  const dt = 1 / 90;
  let t = 0;
  for (; t < secs; t += dt) {
    if (pulled >= 0 && t >= pulled && s.phase === 'freefall') pull(s);
    yaw = stepSky(s, v, yaw, typeof i === 'function' ? i(t) : i, dt);
    v.y -= SKY.gravity * dt;
    y += v.y * dt;
  }
  return { s, v, yaw, y, hs: Math.hypot(v.x, v.z) };
}

describe('freefall', () => {
  it('settles at belly terminal (~55 m/s)', () => {
    const r = fly(20, inp());
    expect(-r.v.y).toBeGreaterThan(53);
    expect(-r.v.y).toBeLessThan(57);
    expect(r.s.posture).toBe('belly');
  });

  it('dives to ~75 m/s and flares to ~45 m/s', () => {
    const d = fly(25, inp({ dive: true }));
    expect(-d.v.y).toBeGreaterThan(72);
    expect(-d.v.y).toBeLessThan(77);
    const f = fly(25, inp({ moveY: -1 }));
    expect(-f.v.y).toBeGreaterThan(43);
    expect(-f.v.y).toBeLessThan(47);
  });

  it('a flare out of a dive slows down without flipping the fall', () => {
    const r = fly(30, t => inp(t < 15 ? { dive: true } : { moveY: -1 }));
    expect(r.v.y).toBeLessThan(-40);
    expect(-r.v.y).toBeLessThan(48);
  });

  it('tracking builds horizontal speed with momentum, capped ~14 m/s', () => {
    const early = fly(0.5, inp({ moveY: 1 }));
    expect(early.hs).toBeGreaterThan(2);
    expect(early.hs).toBeLessThan(8);
    const r = fly(20, inp({ moveY: 1 }));
    expect(r.hs).toBeGreaterThan(12);
    expect(r.hs).toBeLessThanOrEqual(SKY.trackMax + 1e-6);
    // Let go: it carries on, then bleeds off slowly
    const coast = fly(21, t => inp(t < 20 ? { moveY: 1 } : {}));
    expect(coast.hs).toBeGreaterThan(9);
  });

  it('left / right turns the heading', () => {
    const r = fly(1, inp({ moveX: 1 }));
    expect(r.yaw).toBeCloseTo(-SKY.yawRate, 1);
  });
});

describe('the parachute', () => {
  it('only pulls with enough air under you', () => {
    const s = newSky();
    expect(canPull(s, 500)).toBe(false); // not in freefall
    enter(s, -20);
    expect(canPull(s, SKY.pullMin - 1)).toBe(false);
    expect(canPull(s, SKY.pullMin + 1)).toBe(true);
  });

  it('opens over ~1 s to ~6 m/s from terminal, inside the pull height', () => {
    const s = newSky();
    enter(s, -55);
    const v = { x: 0, y: -55, z: 0 };
    pull(s);
    let yaw = 0;
    const dt = 1 / 90;
    let at1 = 0;
    for (let t = 0; t < 4; t += dt) {
      yaw = stepSky(s, v, yaw, inp(), dt);
      v.y -= SKY.gravity * dt;
      if (Math.abs(t - 1) < dt / 2) at1 = -v.y;
    }
    expect(s.open).toBe(1);
    expect(at1).toBeLessThan(9); // a landing here wouldn't even need a roll
    expect(-v.y).toBeCloseTo(SKY.canopyVy, 1);
    // From the lowest pull, the drop until it's under roll speed fits
    const r = fly(1.2, inp(), -75, 0);
    expect(-r.v.y).toBeLessThan(9);
    expect(-r.y).toBeLessThan(SKY.pullMin);
  });

  it('glides and steers under canopy; forward is faster, back brakes', () => {
    const n = fly(8, inp(), -55, 0);
    expect(n.hs).toBeCloseTo(SKY.glide, 0);
    const f = fly(8, inp({ moveY: 1 }), -55, 0);
    const b = fly(8, inp({ moveY: -1 }), -55, 0);
    expect(f.hs).toBeGreaterThan(n.hs);
    expect(-f.v.y).toBeGreaterThan(-n.v.y);
    expect(b.hs).toBeLessThan(n.hs);
    expect(-b.v.y).toBeLessThan(-n.v.y);
    const t = fly(3, inp({ moveX: -1 }), -55, 0);
    expect(t.yaw).toBeGreaterThan(2);
  });

  it('ends cleanly', () => {
    const s = newSky();
    enter(s, -30);
    pull(s);
    end(s);
    expect(s.phase).toBe('off');
    const v = { x: 1, y: -3, z: 2 };
    expect(stepSky(s, v, 0.5, inp({ moveX: 1 }), 1 / 60)).toBe(0.5);
    expect(v).toEqual({ x: 1, y: -3, z: 2 });
  });
});

describe('when a fall becomes a skydive', () => {
  const ok = { airborne: true, vy: -12, airT: 1, clear: 100, catchable: false };
  it('a real drop from height', () => expect(shouldEnter(ok)).toBe(true));
  it('never on an ordinary jump or a short drop', () => {
    // a jump: rising, then a few metres of air
    expect(shouldEnter({ ...ok, vy: 3 })).toBe(false);
    expect(shouldEnter({ ...ok, airT: 0.2 })).toBe(false);
    expect(shouldEnter({ ...ok, clear: 8 })).toBe(false);
    expect(shouldEnter({ ...ok, vy: -2 })).toBe(false);
    expect(shouldEnter({ ...ok, airborne: false })).toBe(false);
  });
  it('never with a ledge, wall or pole in reach (parkour first)', () =>
    expect(shouldEnter({ ...ok, catchable: true })).toBe(false));
  it('a running jump off a 20 m roof never gets there', () => {
    // a gap jump (5.7 m/s up) off the ring's roofs into the street
    let y = 20.4;
    let vy = 5.7;
    let t = 0;
    let entered = false;
    while (y > 0) {
      vy -= SKY.gravity / 90;
      y += vy / 90;
      t += 1 / 90;
      entered ||= shouldEnter({ airborne: true, vy, airT: t, clear: y, catchable: false });
    }
    expect(entered).toBe(false);
  });
});

describe('offering a skydive on a big board air', () => {
  const ok = { offered: true, airborne: true, airT: 1, clear: 80, catchable: false };
  it('high enough, where it would not start by itself', () => expect(shouldOffer(ok)).toBe(true));
  it('not where freefall starts by itself, or on the ground', () => {
    expect(shouldOffer({ ...ok, offered: false })).toBe(false);
    expect(shouldOffer({ ...ok, airborne: false })).toBe(false);
  });
  it('only with room to pull after taking it', () => {
    expect(shouldOffer({ ...ok, clear: SKY.offerClear - 1 })).toBe(false);
    expect(SKY.offerClear).toBeGreaterThan(SKY.pullMin);
  });
  it('not the moment you leave the lip, nor with something to catch', () => {
    expect(shouldOffer({ ...ok, airT: 0.1 })).toBe(false);
    expect(shouldOffer({ ...ok, catchable: true })).toBe(false);
  });
});
