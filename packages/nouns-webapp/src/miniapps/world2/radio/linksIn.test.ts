import { describe, expect, it } from 'vitest';

import { linksIn } from './FmPanel';

describe('linksIn (DJ set bulk paste)', () => {
  it('finds every link however the list is pasted, once each, in order', () => {
    const text = `https://www.youtube.com/watch?v=aaa
1. Eddie Grant https://youtu.be/bbb,https://www.youtube.com/watch?v=ccc
https://www.youtube.com/watch?v=aaa  not a link   https://audius.co/x/y`;
    expect(linksIn(text)).toEqual([
      'https://www.youtube.com/watch?v=aaa',
      'https://youtu.be/bbb',
      'https://www.youtube.com/watch?v=ccc',
      'https://audius.co/x/y',
    ]);
  });
  it('nothing pasted, nothing found', () => {
    expect(linksIn('just some words')).toEqual([]);
  });
});
