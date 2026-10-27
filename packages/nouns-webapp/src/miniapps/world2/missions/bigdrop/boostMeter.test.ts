import { describe, expect, it } from 'vitest';

import {
  BOOST,
  bailBoost,
  createBoost,
  fillFromCombo,
  fillFromRiding,
  governSpeed,
  padBoost,
  stepBoost,
  tapBoost,
} from './boostMeter';

describe('the SSX boost meter', () => {
  it('fills from air, grabs, grinds and landed combos, never past full', () => {
    const b = createBoost();
    fillFromRiding(b, 1, 'ground', false);
    expect(b.meter).toBe(0);
    fillFromRiding(b, 1, 'air', false);
    expect(b.meter).toBeCloseTo(BOOST.air, 6);
    fillFromRiding(b, 1, 'air', true);
    expect(b.meter).toBeCloseTo(2 * BOOST.air + BOOST.grab, 6);
    fillFromRiding(b, 1, 'grind', false);
    expect(b.meter).toBeCloseTo(2 * BOOST.air + BOOST.grab + BOOST.grind, 6);
    fillFromCombo(b, 1500);
    expect(b.meter).toBeCloseTo(2 * BOOST.air + BOOST.grab + BOOST.grind + 0.5, 6);
    fillFromCombo(b, 1e6);
    expect(b.meter).toBe(1);
  });

  it('burns a chunk per tap, stacks taps, and refuses when short', () => {
    const b = createBoost();
    expect(tapBoost(b)).toBe(false);
    expect(b.burn).toBe(0);
    b.meter = 0.6;
    expect(tapBoost(b)).toBe(true);
    expect(b.meter).toBeCloseTo(0.35, 6);
    expect(b.burn).toBeCloseTo(BOOST.burn, 6);
    expect(tapBoost(b)).toBe(true);
    expect(b.burn).toBeCloseTo(2 * BOOST.burn, 6);
    expect(tapBoost(b)).toBe(false);
    // It burns down and stops
    let t = 0;
    while (stepBoost(b, 0.1)) t += 0.1;
    expect(t).toBeCloseTo(2 * BOOST.burn, 1);
    expect(b.burn).toBe(0);
  });

  it('caps a stack of taps', () => {
    const b = createBoost();
    b.meter = 0.99;
    for (let i = 0; i < 4; i++) tapBoost(b);
    expect(b.burn).toBeLessThanOrEqual(BOOST.maxBurn);
  });

  it('burns a full meter as one long TRICKY', () => {
    const b = createBoost();
    fillFromCombo(b, 1e6);
    expect(tapBoost(b)).toBe(true);
    expect(b.tricky).toBe(true);
    expect(b.meter).toBe(0);
    expect(b.burn).toBe(BOOST.tricky);
    while (stepBoost(b, 0.5));
    expect(b.tricky).toBe(false);
  });

  it('gives a free burn on a pad and loses half on a bail', () => {
    const b = createBoost();
    padBoost(b);
    expect(b.burn).toBe(BOOST.padBurn);
    expect(b.meter).toBe(0);
    b.meter = 0.8;
    bailBoost(b);
    expect(b.meter).toBeCloseTo(0.8 * (1 - BOOST.bailLoss), 6);
    expect(b.burn).toBe(0);
  });
});

describe('the course governor', () => {
  it('leaves you alone under the cap', () => {
    expect(governSpeed(20, 30, false, 1 / 60)).toBe(20);
    expect(governSpeed(40, 30, true, 1 / 60)).toBe(40);
  });

  it('bleeds speed over the cap off smoothly, down to the cap and never under it', () => {
    let v = 60;
    const dt = 1 / 60;
    let prev = v;
    for (let i = 0; i < 60; i++) {
      v = governSpeed(v, 30, false, dt);
      expect(v).toBeLessThan(prev);
      // No more than a gentle slow-down per frame (a landing eases back)
      expect(prev - v).toBeLessThan(0.5);
      expect(v).toBeGreaterThan(30);
      prev = v;
    }
    // About a time constant later, most of the excess is gone
    expect(v - 30).toBeLessThan(30 * 0.5);
    for (let i = 0; i < 600; i++) v = governSpeed(v, 30, false, dt);
    expect(v).toBeCloseTo(30, 1);
  });

  it('lets a boost run up to the raised cap', () => {
    let v = 30;
    // (the course drives the board only up to the raised cap)
    for (let i = 0; i < 120; i++)
      v = governSpeed(Math.min(30 * BOOST.capK, v + BOOST.accel / 60), 30, true, 1 / 60);
    expect(v).toBeGreaterThan(30 * BOOST.capK - 1);
    expect(v).toBeLessThan(30 * BOOST.capK + 1);
  });
});
