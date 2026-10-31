import { describe, expect, it } from 'vitest';

import { firstSpawnInCamp, pickSpawn } from './firstSpawn';

describe('who wakes up in CAMP', () => {
  it('a plain /world load (and the test flags) does', () => {
    expect(firstSpawnInCamp('')).toBe(true);
    expect(firstSpawnInCamp('?offline=1&skip=1&q=low&bday=0')).toBe(true);
    expect(firstSpawnInCamp('?seed=1-2-3-4-5&name=bob&debug')).toBe(true);
  });

  it('deep links and modes that set their own spawn skip it; ?spawn=plaza opts out', () => {
    for (const q of [
      '?play=hoops&mode=3',
      '?play=parkour',
      '?play=pool',
      '?drop=1',
      '?mode=2',
      '?spot=nj',
      '?megaramp=1',
      '?town=cowboy',
      '?dressing=1',
      '?offline=1&skip=1&spawn=plaza',
    ])
      expect(firstSpawnInCamp(q), q).toBe(false);
  });

  it('spreads riders over the spots', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 100; i++) seen.add(pickSpawn(8, i / 100));
    expect(seen.size).toBe(8);
    expect(pickSpawn(8, 0.9999)).toBe(7);
    expect(pickSpawn(8, 0)).toBe(0);
  });
});
