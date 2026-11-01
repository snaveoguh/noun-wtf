import { describe, expect, it } from 'vitest';

import { skipsSpot } from './FmSpotsUi';

describe('NOUN FM intro: which keys skip the jingle', () => {
  it('any key in play moves past it', () => {
    expect(skipsSpot(document.body, false)).toBe(true);
  });
  it('not on the character select (its arrows and name field cut the jingle off)', () => {
    expect(skipsSpot(document.body, true)).toBe(false);
  });
  it('never while typing', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    expect(skipsSpot(input, false)).toBe(false);
    input.remove();
  });
});
