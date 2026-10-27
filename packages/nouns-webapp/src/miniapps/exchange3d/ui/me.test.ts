import { describe, expect, it } from 'vitest';

import { parseSaved } from './me';

describe('exchange3d: your rider from the character select', () => {
  it('reads the saved Noun, name and build', () => {
    const raw = JSON.stringify({
      seed: { background: 1, body: 4, accessory: 9, head: 200, glasses: 3 },
      name: 'big noun',
      build: 5,
      board: 'skate',
    });
    expect(parseSaved(raw)).toEqual({
      seed: { background: 1, body: 4, accessory: 9, head: 200, glasses: 3 },
      name: 'big noun',
      weight: 1,
      outfit: null,
    });
  });

  it('reads the saved outfit (bad fields fall back to the Noun default)', () => {
    const seed = { background: 1, body: 4, accessory: 9, head: 200, glasses: 3 };
    const outfit = { pants: 'shorts', pantsColor: 7, shoes: 'slide', shoeColor: 3 };
    expect(parseSaved(JSON.stringify({ seed, outfit }))?.outfit).toEqual(outfit);
    const junk = parseSaved(JSON.stringify({ seed, outfit: { ...outfit, pants: 'kilt' } }));
    expect(junk?.outfit).toMatchObject({ pantsColor: 7, shoes: 'slide' });
    expect(['baggy', 'cargo', 'track', 'shorts', 'skinny']).toContain(junk?.outfit?.pants);
  });

  it('falls back on missing or junk saves', () => {
    expect(parseSaved(null)).toBeNull();
    expect(parseSaved('{nope')).toBeNull();
    expect(parseSaved(JSON.stringify({ seed: { head: 'x' } }))).toBeNull();
    const noName = parseSaved(
      JSON.stringify({ seed: { background: 0, body: 0, accessory: 0, head: 0, glasses: 0 } }),
    );
    expect(noName).toMatchObject({ name: 'YOU', weight: 0 });
  });
});
