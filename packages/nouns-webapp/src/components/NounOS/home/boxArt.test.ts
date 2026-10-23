import { describe, expect, it } from 'vitest';

import { artSpec, GROUNDS, hashString, NOUN_COUNTS, nounSvgUrl, prng, seedFromKey } from './boxArt';

const COUNTS = { backgrounds: 2, bodies: 30, accessories: 140, heads: 240, glasses: 23 };

describe('hashString', () => {
  it('is FNV-1a 32-bit', () => {
    expect(hashString('')).toBe(0x811c9dc5);
    expect(hashString('a')).toBe(0xe40c292c);
    expect(hashString('foobar')).toBe(0xbf9cf968);
  });
  it('spreads similar paths apart', () => {
    expect(hashString('/vote')).not.toBe(hashString('/vote/'));
  });
});

describe('prng', () => {
  it('is deterministic and in [0,1)', () => {
    const a = prng(42);
    const b = prng(42);
    for (let i = 0; i < 200; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });
});

describe('seedFromKey', () => {
  it('gives the same Noun for the same key, every trait in range', () => {
    for (const k of ['/pip3', '/vote', '/explore/wallet', 'https://nouns.game/']) {
      const s = seedFromKey(k, COUNTS);
      expect(seedFromKey(k, COUNTS)).toEqual(s);
      expect(s.background).toBeLessThan(COUNTS.backgrounds);
      expect(s.body).toBeLessThan(COUNTS.bodies);
      expect(s.accessory).toBeLessThan(COUNTS.accessories);
      expect(s.head).toBeLessThan(COUNTS.heads);
      expect(s.glasses).toBeLessThan(COUNTS.glasses);
      for (const v of Object.values(s)) expect(Number.isInteger(v) && v >= 0).toBe(true);
    }
  });
  it('varies across the catalog', () => {
    const heads = new Set(
      Array.from({ length: 40 }, (_, i) => seedFromKey(`/page-${i}`, COUNTS).head),
    );
    expect(heads.size).toBeGreaterThan(30);
  });
});

describe('artSpec', () => {
  it('picks a ground from its group and a stable crop', () => {
    const a = artSpec('/vote', 'gov', COUNTS);
    expect(artSpec('/vote', 'gov', COUNTS)).toEqual(a);
    expect(GROUNDS.gov).toContainEqual(a.ground);
    expect(['face', 'full', 'peek']).toContain(a.crop);
    expect(a.tilt).toBeLessThanOrEqual(-2);
    expect(a.light).toBeGreaterThanOrEqual(20);
  });
  it('falls back to the art grounds for unknown groups', () => {
    expect(GROUNDS.art).toContainEqual(artSpec('/x', 'nope', COUNTS).ground);
  });
});

describe('nounSvgUrl', () => {
  it('renders a real Noun without its flat background', () => {
    const url = nounSvgUrl(seedFromKey('/pip3', NOUN_COUNTS));
    expect(url.startsWith('data:image/svg+xml;base64,')).toBe(true);
    const svg = atob(url.split(',')[1]!);
    expect(svg).toContain('<svg');
    expect(svg).not.toMatch(/<rect width="100%" height="100%"/);
  });
});
