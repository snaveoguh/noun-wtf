import { describe, expect, it } from 'vitest';

import { TOWN_SPECS } from '../trade/towns';
import { TOWN_SITES } from '../world/mountain/tracks';

describe('town table', () => {
  it('prices and the travel check use the towns where they are built', () => {
    for (const site of TOWN_SITES) {
      const spec = TOWN_SPECS[site.town];
      expect(spec.track).toBe(site.track);
      expect(spec.s).toBe(site.at);
    }
  });
});
