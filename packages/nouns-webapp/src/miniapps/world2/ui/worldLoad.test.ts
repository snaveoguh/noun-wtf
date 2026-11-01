import { describe, expect, it } from 'vitest';

import {
  GRAFFITI_CAP_MS,
  GRAFFITI_STALL_MS,
  loadTarget,
  stepShimmer,
  worldLoaded,
  type WorldLoadState,
} from './worldLoad';

const base: WorldLoadState = {
  levelReady: false,
  graffiti: null,
  graffitiArrived: false,
  elapsedMs: 0,
  sinceLevelMs: 0,
  stalledMs: 0,
};

describe('world loader readiness', () => {
  it('waits for the level, then for every graffiti piece', () => {
    expect(worldLoaded(base)).toBe(false);
    // graffiti done but the level isn't: still loading
    expect(worldLoaded({ ...base, graffitiArrived: true })).toBe(false);
    const level = { ...base, levelReady: true, graffiti: { done: 10, total: 200 } };
    expect(worldLoaded(level)).toBe(false);
    expect(worldLoaded({ ...level, graffitiArrived: true })).toBe(true);
  });

  it('slow but moving graffiti is waited for: only a stall or the cap lets go', () => {
    const slow = {
      ...base,
      levelReady: true,
      graffiti: { done: 1360, total: 3393 },
      elapsedMs: 9e4,
    };
    // half a minute in and still coming: keep waiting
    expect(worldLoaded({ ...slow, sinceLevelMs: 30_000, stalledMs: 400 })).toBe(false);
    // nothing new for the stall window: the endpoint is stuck, go
    expect(worldLoaded({ ...slow, sinceLevelMs: 30_000, stalledMs: GRAFFITI_STALL_MS - 1 })).toBe(
      false,
    );
    expect(worldLoaded({ ...slow, sinceLevelMs: 30_000, stalledMs: GRAFFITI_STALL_MS })).toBe(true);
    // a dead endpoint (no index ever) goes after the stall too
    const dead = { ...base, levelReady: true, graffiti: { done: 0, total: null } };
    expect(
      worldLoaded({ ...dead, sinceLevelMs: GRAFFITI_STALL_MS, stalledMs: GRAFFITI_STALL_MS }),
    ).toBe(true);
    // a trickle never holds play past the cap
    expect(worldLoaded({ ...slow, sinceLevelMs: GRAFFITI_CAP_MS, stalledMs: 10 })).toBe(true);
    // the waits count from the level, not the page: a slow level doesn't eat them
    expect(worldLoaded({ ...base, elapsedMs: 10 * GRAFFITI_CAP_MS })).toBe(false);
  });

  it('the band follows the walls fetched and only reaches the end when loaded', () => {
    const t0 = loadTarget({ ...base, elapsedMs: 0 });
    const t1 = loadTarget({ ...base, elapsedMs: 4000 });
    expect(t0).toBe(0);
    expect(t1).toBeGreaterThan(t0);
    const lv = { ...base, levelReady: true, elapsedMs: 8000 };
    const a = loadTarget({ ...lv, graffiti: { done: 0, total: null } });
    const b = loadTarget({ ...lv, graffiti: { done: 50, total: 100 } });
    const c = loadTarget({ ...lv, graffiti: { done: 100, total: 100 } });
    expect(a).toBeGreaterThanOrEqual(t1);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(c).toBeLessThan(1);
    expect(loadTarget({ ...lv, graffitiArrived: true })).toBe(1);
  });

  it('the shimmer never runs backwards and finishes once loaded', () => {
    let s = 0.5;
    s = stepShimmer(s, 0.2, 16, false);
    expect(s).toBe(0.5);
    let frames = 0;
    while (s < 1 && frames < 1000) {
      s = stepShimmer(s, 1, 16, true);
      frames++;
    }
    expect(s).toBe(1);
    // the last stretch is quick: well under a second
    expect(frames * 16).toBeLessThan(600);
  });
});
