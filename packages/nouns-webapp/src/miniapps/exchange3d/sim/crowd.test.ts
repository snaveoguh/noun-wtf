import { describe, expect, it } from 'vitest';

import { Crowd, PERSONAL } from './crowd';
import {
  BALCONY_Y,
  floorHeight,
  HALL_D,
  HALL_W,
  octR,
  PIT_R_OUT,
  PIT_STEP_H,
  PIT_STEPS,
  pitAt,
  pitSpot,
  PITS,
  TOWER_CLEAR,
} from './layout';

const look = () => ({ background: 0, body: 1, accessory: 2, head: 3, glasses: 4 });

describe('hall layout', () => {
  it('pits never overlap each other or the tower', () => {
    for (const a of PITS) {
      expect(Math.hypot(a.x, a.z)).toBeGreaterThan(TOWER_CLEAR + PIT_R_OUT);
      for (const b of PITS)
        if (a !== b) expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeGreaterThan(2 * PIT_R_OUT + 4);
    }
  });

  it('pit tiers rise from the middle to the rim, open floor is flat', () => {
    const p = PITS[0]!;
    expect(floorHeight(p.x, p.z)).toBe(0);
    expect(floorHeight(p.x + PIT_R_OUT - 0.1, p.z)).toBeCloseTo(PIT_STEPS * PIT_STEP_H);
    expect(floorHeight(0, -40)).toBe(0);
    for (let s = 1; s <= PIT_STEPS; s++) {
      const at = pitSpot(p, 0.7, s);
      expect(pitAt(at.x, at.z)).toBe(p);
      expect(floorHeight(at.x, at.z)).toBeCloseTo(s * PIT_STEP_H);
    }
    expect(octR(3, 4)).toBeGreaterThanOrEqual(4);
  });
});

describe('Crowd', () => {
  it('spawns the asked-for crowd, spread over every pit and the balcony', () => {
    const c = new Crowd({ count: 300, look, balcony: 0.1 });
    expect(c.traders).toHaveLength(300);
    const homes = new Set(c.traders.filter(t => t.mode !== 'balcony').map(t => t.home));
    expect(homes.size).toBe(PITS.length);
    expect(c.traders.filter(t => t.mode === 'balcony')).toHaveLength(30);
  });

  it('is deterministic for a seed', () => {
    const a = new Crowd({ count: 50, look, seed: 4 });
    const b = new Crowd({ count: 50, look, seed: 4 });
    for (let k = 0; k < 200; k++) {
      a.step(1 / 30);
      b.step(1 / 30);
    }
    expect(a.traders.map(t => [t.x, t.z])).toEqual(b.traders.map(t => [t.x, t.z]));
  });

  it('keeps everyone inside the hall, off the tower, balcony on the balcony', () => {
    const c = new Crowd({ count: 300, look });
    for (let k = 0; k < 900; k++) c.step(1 / 15);
    for (const t of c.traders) {
      expect(Math.abs(t.x)).toBeLessThanOrEqual(HALL_W / 2);
      expect(Math.abs(t.z)).toBeLessThanOrEqual(HALL_D / 2);
      if (t.mode === 'balcony') expect(t.y).toBe(BALCONY_Y);
      else expect(Math.hypot(t.x, t.z)).toBeGreaterThanOrEqual(TOWER_CLEAR - 1e-6);
    }
  });

  it('moves: people walk between pits over a minute', () => {
    const c = new Crowd({ count: 200, look, floaters: 0.15 });
    const home0 = c.traders.map(t => t.home);
    for (let k = 0; k < 60 * 10; k++) c.step(0.1);
    const moved = c.traders.filter((t, i) => t.home !== home0[i]).length;
    expect(moved).toBeGreaterThan(20);
  });

  it('separation keeps people from standing inside each other', () => {
    const c = new Crowd({ count: 250, look, balcony: 0 });
    for (let k = 0; k < 400; k++) c.step(1 / 20);
    let close = 0;
    const ts = c.traders;
    for (let i = 0; i < ts.length; i++)
      for (let j = i + 1; j < ts.length; j++)
        if (Math.hypot(ts[i]!.x - ts[j]!.x, ts[i]!.z - ts[j]!.z) < PERSONAL * 0.5) close++;
    expect(close).toBeLessThan(ts.length * 0.03);
  });

  it('held traders walk to their spot, face as told, and are released', () => {
    const c = new Crowd({ count: 20, look, balcony: 0 });
    const t = c.traders[3]!;
    c.hold(t, 7, 20, 10, 1.2);
    expect(c.free(t)).toBe(false);
    for (let k = 0; k < 1500 && !t.arrived; k++) c.step(1 / 30);
    expect(t.arrived).toBe(true);
    expect(Math.hypot(t.x - 20, t.z - 10)).toBeLessThan(0.6);
    for (let k = 0; k < 30; k++) c.step(1 / 30);
    expect(Math.abs(Math.atan2(Math.sin(t.heading - 1.2), Math.cos(t.heading - 1.2)))).toBeLessThan(
      0.05,
    );
    c.release(t, 99); // not its trade: ignored
    expect(t.mode).toBe('held');
    c.release(t, 7);
    expect(c.free(t)).toBe(true);
  });

  it('real traders walk in through the door; a reused slot is renamed', () => {
    const c = new Crowd({ count: 10, look });
    const bot = c.addReal('bot:abacus', 'bot', 'Abacus', look(), 2);
    expect(bot.z).toBeLessThan(-HALL_D / 2 + 5);
    expect(c.get('bot:abacus')).toBe(bot);
    expect(c.addReal('bot:abacus', 'bot', 'Abacus', look(), 2)).toBe(bot);
    const r = c.addReal('r:abc', 'rider', 'RIDER ABC', look(), 1, 4);
    expect(r.i).toBe(4);
    expect(c.get('sim:4')).toBeUndefined();
    expect(c.traders).toHaveLength(11);
  });

  it('cheers spread to people nearby only', () => {
    const c = new Crowd({ count: 100, look, balcony: 0 });
    const t = c.traders[0]!;
    c.cheerNear(t.x, t.z, 5, 2);
    const near = c.traders.filter(x => Math.hypot(x.x - t.x, x.z - t.z) < 5);
    expect(near.every(x => x.cheer > 0)).toBe(true);
    expect(c.traders.filter(x => Math.hypot(x.x - t.x, x.z - t.z) > 6).some(x => x.cheer > 0)).toBe(
      false,
    );
  });
});
