import { describe, expect, it } from 'vitest';

import { getEventDef, makeDescribeCtx } from './eventRegistry';

const ctx = makeDescribeCtx();
const ZERO = '0x0000000000000000000000000000000000000000';
const render = (type: string, data: Record<string, unknown>) => {
  const def = getEventDef(type, data);
  return { label: def.label, text: String(def.describe(data, ctx)) };
};

describe('V2_SETTLED', () => {
  it('shows a no-bid V2 settle as burned even when the API says treasury', () => {
    // What /api/nounv2-feed served for V2 Noun 93 before the indexer fix.
    const { label, text } = render('V2_SETTLED', {
      nounId: 93,
      winner: ZERO,
      amount: '0',
      burned: false,
      treasury: true,
    });
    expect(label).toBe('BURNED');
    expect(text).toContain('V2 Noun 93 burned');
    expect(text).not.toContain('treasury');
  });

  it('still shows a won V2 auction as won', () => {
    const { text } = render('V2_SETTLED', {
      nounId: 95,
      winner: '0x850c65cb63fdEfAa4a687756A1311B920294FC5c',
      amount: '50',
    });
    expect(text).toContain('V2 Noun 95 won by');
  });
});

describe('AUCTION_SETTLED (V1)', () => {
  it('keeps a V4 no-bid settle in the treasury', () => {
    const { label, text } = render('AUCTION_SETTLED', {
      nounId: 2052,
      winner: ZERO,
      amount: '0',
      treasury: true,
    });
    expect(label).toBe('TREASURY');
    expect(text).toContain('held by Nouns DAO treasury');
  });
});
