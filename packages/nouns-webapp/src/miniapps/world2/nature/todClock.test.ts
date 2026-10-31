import { describe, expect, it } from 'vitest';

import { TOD_EVERY, TodClock } from './todClock';

const run = (c: TodClock, seconds: number, blocked = false) => {
  let steps = 0;
  for (let t = 0; t < seconds; t += 0.5) if (c.tick(0.5, blocked)) steps++;
  return steps;
};

describe('the time-of-day clock', () => {
  it('steps every ten minutes of play', () => {
    expect(TOD_EVERY).toBe(600);
    const c = new TodClock();
    expect(run(c, 599)).toBe(0);
    expect(run(c, 2)).toBe(1);
    expect(run(c, 1200)).toBe(2);
  });

  it('waits while something else owns the light, then steps once', () => {
    const c = new TodClock();
    expect(run(c, 900, true)).toBe(0);
    expect(run(c, 1)).toBe(1);
    expect(run(c, 590)).toBe(0);
  });

  it('a manual change starts the count again', () => {
    const c = new TodClock();
    run(c, 550);
    c.reset();
    expect(run(c, 500)).toBe(0);
    expect(run(c, 101)).toBe(1);
  });
});
