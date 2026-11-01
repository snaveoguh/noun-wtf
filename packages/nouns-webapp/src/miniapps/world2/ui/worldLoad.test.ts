import { describe, expect, it } from 'vitest';

import {
  flickVariants,
  GRAFFITI_CAP_MS,
  GRAFFITI_STALL_MS,
  PIP3_VARIANTS,
  worldLoaded,
  type WorldLoadState,
} from './worldLoad';

const base: WorldLoadState = {
  levelReady: false,
  nearWallsUp: false,
  sinceLevelMs: 0,
  stalledMs: 0,
};

describe('the loader hands over', () => {
  it('once the level is in and the walls round the rider are painted', () => {
    expect(worldLoaded({ ...base, nearWallsUp: true })).toBe(false);
    expect(worldLoaded({ ...base, levelReady: true })).toBe(false);
    expect(worldLoaded({ ...base, levelReady: true, nearWallsUp: true })).toBe(true);
  });

  it('never waits on a dead graffiti store for ever', () => {
    const lv = { ...base, levelReady: true };
    expect(worldLoaded({ ...lv, stalledMs: GRAFFITI_STALL_MS - 1, sinceLevelMs: 20_000 })).toBe(
      false,
    );
    expect(worldLoaded({ ...lv, stalledMs: GRAFFITI_STALL_MS })).toBe(true);
    expect(worldLoaded({ ...lv, stalledMs: 10, sinceLevelMs: GRAFFITI_CAP_MS })).toBe(true);
  });
});

describe('the loader wordmark', () => {
  it('pops letters to another of their Pip3 versions', () => {
    let r = 7;
    const rand = () => (r = (r * 16807) % 2147483647) / 2147483647;
    let v = [1, 1, 1, 1, 1, 1, 1, 1];
    const seen = new Set<number>();
    for (let k = 0; k < 200; k++) {
      const next = flickVariants(v, rand);
      const changed = next.filter((x, i) => x !== v[i]).length;
      expect(changed).toBe(2);
      for (const x of next) {
        expect(x).toBeGreaterThanOrEqual(1);
        expect(x).toBeLessThanOrEqual(PIP3_VARIANTS);
        seen.add(x);
      }
      v = next;
    }
    // every drawing turns up
    expect(seen.size).toBe(PIP3_VARIANTS);
    // never more flicks than letters
    expect(flickVariants([3], rand, 4)).not.toEqual([3]);
  });

  it('pops one letter at a time when asked', () => {
    let r = 11;
    const rand = () => (r = (r * 16807) % 2147483647) / 2147483647;
    let v = [1, 2, 3, 4, 5, 1, 2, 3];
    for (let k = 0; k < 50; k++) {
      const next = flickVariants(v, rand, 1);
      expect(next.filter((x, i) => x !== v[i])).toHaveLength(1);
      v = next;
    }
  });
});
