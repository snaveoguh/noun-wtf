import { describe, expect, it } from 'vitest';

import { CLAIM_CAPS, globalCapOn, HALVING_DAYS } from './tokens';

describe('globalCapOn (mirrors NounTradeGoods.globalCapOn)', () => {
  const base = CLAIM_CAPS.coinGlobal;
  const d0 = 20_745;
  it('halves every HALVING_DAYS after launch, four times, then stays', () => {
    expect(globalCapOn(base, d0, d0)).toBe(base);
    expect(globalCapOn(base, d0, d0 + HALVING_DAYS - 1)).toBe(base);
    expect(globalCapOn(base, d0, d0 + HALVING_DAYS)).toBe(base / 2);
    expect(globalCapOn(base, d0, d0 + 4 * HALVING_DAYS)).toBe(base / 16);
    expect(globalCapOn(base, d0, d0 + 40 * HALVING_DAYS)).toBe(base / 16);
  });
  it('with no launch day configured, the launch value (the contract still enforces its own)', () => {
    expect(globalCapOn(base, null, d0 + 10_000)).toBe(base);
  });
});
