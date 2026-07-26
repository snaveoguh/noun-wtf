import { describe, expect, it } from 'vitest';

import { isMissingNoun, MISSINGNOUN_HEAD_INDEX } from '@/lib/missingNoun';
import { traitName } from '@/lib/traitName';

const seed = (head: number) => ({ background: 0, body: 0, accessory: 0, head, glasses: 0 });

describe('traitName V2 head resolution', () => {
  it('resolves the V2 missingnoun head instead of V1 shrimp tempura', () => {
    expect(traitName('head', MISSINGNOUN_HEAD_INDEX, true)).toBe('Missingnoun');
    expect(traitName('head', MISSINGNOUN_HEAD_INDEX, false)).toBe('Shrimp tempura');
  });

  it('flags missingnoun only in V2 context', () => {
    expect(isMissingNoun(seed(MISSINGNOUN_HEAD_INDEX), true)).toBe(true);
    expect(isMissingNoun(seed(MISSINGNOUN_HEAD_INDEX), false)).toBe(false);
    expect(isMissingNoun(seed(1), true)).toBe(false);
    expect(isMissingNoun(null, true)).toBe(false);
  });
});
