// NOUN FM clock sync + drift correction maths.

import { describe, expect, it } from 'vitest';

import { audioDriftFix, ClockSync, expectedPosition, sampleOffset, youTubeDriftFix } from './sync';

describe('clock offset', () => {
  it('one ping: server time minus the midpoint of the round trip', () => {
    // client clock 1000 behind the server, 80 ms each way
    const r = sampleOffset({ sent: 5000, server: 5000 + 1000 + 80, received: 5160 });
    expect(r.rtt).toBe(160);
    expect(r.offset).toBe(1000);
  });

  it('trusts the shortest round trip (asymmetric delay on slow ones)', () => {
    const c = new ClockSync();
    expect(c.offset).toBe(0);
    c.hint(10_500, 10_000); // a broadcast: rough guess until a ping lands
    expect(c.offset).toBe(500);
    expect(c.synced).toBe(false);
    // true offset 700; a slow ping with 400 ms stuck on the way back
    c.add({ sent: 0, server: 700 + 50, received: 450 });
    c.add({ sent: 1000, server: 1000 + 700 + 20, received: 1040 });
    c.add({ sent: 2000, server: 2000 + 700 + 300, received: 2350 });
    expect(c.synced).toBe(true);
    expect(c.offset).toBe(700);
    expect(c.serverNow(3000)).toBe(3700);
  });

  it('forgets old samples (keeps 8)', () => {
    const c = new ClockSync();
    c.add({ sent: 0, server: 100, received: 0 }); // rtt 0, offset 100
    for (let i = 1; i <= 8; i++)
      c.add({ sent: i * 1000, server: i * 1000 + 200 + 10, received: i * 1000 + 20 });
    expect(c.offset).toBe(200);
  });
});

describe('two listeners land on the same position', () => {
  it('different clocks + latencies, same expected position', () => {
    const startAt = 1_000_000; // server ms
    const serverNow = startAt + 42_000;
    const listeners = [
      { skew: -3_000, lat: 30 },
      { skew: 12_345, lat: 180 },
    ].map(({ skew, lat }) => {
      const c = new ClockSync();
      const sent = serverNow - skew - 2 * lat - 1000; // some time ago, on the client clock
      c.add({ sent, server: sent + skew + lat, received: sent + 2 * lat });
      return expectedPosition(startAt, c.serverNow(serverNow - skew));
    });
    expect(listeners[0]).toBeCloseTo(42, 6);
    expect(listeners[1]).toBeCloseTo(42, 6);
  });
});

describe('drift correction', () => {
  it('in sync: leave it', () => {
    expect(audioDriftFix(30, 30.03)).toEqual({ seek: null, rate: 1 });
  });

  it('small drift: nudge the rate, never more than 5 %', () => {
    const ahead = audioDriftFix(30, 30.4);
    expect(ahead.seek).toBeNull();
    expect(ahead.rate).toBeLessThan(1);
    expect(ahead.rate).toBeGreaterThanOrEqual(0.95);
    const behind = audioDriftFix(30, 29.2);
    expect(behind.rate).toBeGreaterThan(1);
    expect(behind.rate).toBeLessThanOrEqual(1.05);
  });

  it('big drift (stall, late join): seek', () => {
    expect(audioDriftFix(30, 25)).toEqual({ seek: 30, rate: 1 });
    expect(audioDriftFix(-1, 3)).toEqual({ seek: 0, rate: 1 });
  });

  it('YouTube: seek only when playing, a big drift, not too often', () => {
    expect(youTubeDriftFix(60, 50, 20, true)).toBe(60);
    expect(youTubeDriftFix(60, 58, 20, true)).toBeNull();
    expect(youTubeDriftFix(60, 50, 2, true)).toBeNull();
    expect(youTubeDriftFix(60, 0, 20, false)).toBeNull(); // buffering / ad: hands off
  });
});
