import { describe, expect, it } from 'vitest';

import { UPGRADES } from '../../trade/upgrades';

import { BOARD_IDS, BOARDS } from './boards';

describe('surfboards', () => {
  it('cost what the ledger charges (trade/upgrades.ts)', () => {
    expect(BOARDS.foamie.price).toBe(0);
    expect(UPGRADES.longboard.cost).toBe(BOARDS.longboard.price);
    expect(UPGRADES.shortboard.cost).toBe(BOARDS.shortboard.price);
  });

  it('each one rides differently: the longboard paddles and catches best, the shortboard turns and flies', () => {
    const by = (k: keyof (typeof BOARDS)['foamie']) => BOARD_IDS.map(id => BOARDS[id][k] as number);
    const best = (k: keyof (typeof BOARDS)['foamie'], low = false) => {
      const v = by(k);
      return BOARD_IDS[v.indexOf(low ? Math.min(...v) : Math.max(...v))];
    };
    expect(best('paddle')).toBe('longboard');
    expect(best('catchFrac', true)).toBe('longboard');
    expect(best('turn')).toBe('shortboard');
    expect(best('air')).toBe('shortboard');
    // and every one can beat the peel (~10.7 m/s along the coast) on the face
    for (const id of BOARD_IDS) expect(BOARDS[id].face).toBeGreaterThan(12);
  });
});
