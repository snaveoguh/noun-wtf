import { beforeEach, describe, expect, it } from 'vitest';

import { cleanName, renameRider } from './riderName';

describe('renameRider', () => {
  beforeEach(() => localStorage.clear());

  it('cleans like the character select', () => {
    expect(cleanName('hugo <3 nouns!!')).toBe('HUGO 3 NOUNS');
    expect(cleanName('a'.repeat(30))).toHaveLength(16);
  });

  it('renames the game and the saved character, keeping the rest', () => {
    localStorage.setItem(
      'noun-world-v2-character',
      JSON.stringify({ seed: { head: 3 }, name: 'NOUN 12', board: 'skate' }),
    );
    const g = { name: 'NOUN 12' };
    expect(renameRider(g, 'lil 67')).toBe('LIL 67');
    expect(g.name).toBe('LIL 67');
    expect(JSON.parse(localStorage.getItem('noun-world-v2-character')!)).toEqual({
      seed: { head: 3 },
      name: 'LIL 67',
      board: 'skate',
    });
  });

  it('refuses an empty name', () => {
    const g = { name: 'X' };
    expect(renameRider(g, '  !! ')).toBeNull();
    expect(g.name).toBe('X');
  });
});
