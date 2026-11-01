import { describe, expect, it } from 'vitest';

import { parseSeedKey, seedKey } from '../character/NounAppearance';

import {
  cleanRiderName,
  miniAppEmbed,
  parseRiderKey,
  playAsUrl,
  riderCardUrl,
  riderKey,
  worldShareMeta,
} from './playLink';

describe('play-as links', () => {
  it('uses the game’s own seed key, missingnoun included', () => {
    const seeds = [
      { background: 1, body: 12, accessory: 40, head: 100, glasses: 3 },
      { background: 0, body: 0, accessory: 0, head: 7, glasses: 15, missingnoun: true },
    ];
    for (const s of seeds) {
      expect(riderKey(s)).toBe(seedKey(s));
      expect(parseRiderKey(riderKey(s))).toEqual(parseSeedKey(seedKey(s)));
    }
  });

  it('only accepts five small whole numbers and an optional m', () => {
    expect(parseRiderKey('0-1-2-3-4')).toEqual({
      background: 0,
      body: 1,
      accessory: 2,
      head: 3,
      glasses: 4,
    });
    expect(parseRiderKey('0-1-2-3-4-m')?.missingnoun).toBe(true);
    for (const bad of [
      '',
      null,
      undefined,
      '0-1-2-3',
      '0-1-2-3-4-5',
      '0-1-2-3-4-x',
      '1e3-1-2-3-4',
      '-1-1-2-3-4',
      '0-1-2-3-4.5',
      '1000-1-2-3-4',
      '0-1-2-3-4-m-m',
    ]) {
      expect(parseRiderKey(bad)).toBeNull();
    }
  });

  it('builds the link the game reads (seed + name), and the card urls', () => {
    const s = { background: 1, body: 2, accessory: 3, head: 4, glasses: 5, missingnoun: true };
    expect(playAsUrl(s)).toBe('https://noun.wtf/world?seed=1-2-3-4-5-m');
    expect(playAsUrl(s, { name: 'lil 67', origin: 'https://dev-noun-wtf.netlify.app' })).toBe(
      'https://dev-noun-wtf.netlify.app/world?seed=1-2-3-4-5-m&name=lil+67',
    );
    const u = new URL(playAsUrl(s, { name: 'a&b=c' }));
    expect(u.searchParams.get('seed')).toBe('1-2-3-4-5-m');
    expect(u.searchParams.get('name')).toBe('abc');
    expect(riderCardUrl('1-2-3-4-5', 'og')).toBe('https://noun.wtf/og/world/1-2-3-4-5.png');
    expect(riderCardUrl('1-2-3-4-5', 'fc')).toBe('https://noun.wtf/og/world/fc/1-2-3-4-5.png');
  });

  it('cleans names for a URL and a card', () => {
    expect(cleanRiderName('  hugo   <script>  ')).toBe('hugo script');
    expect(cleanRiderName('x'.repeat(40))).toHaveLength(20);
    expect(cleanRiderName(null)).toBe('');
  });

  it('unfurls a play-as link as that rider and plain /world as the game', () => {
    const m = worldShareMeta({ seed: '0-1-2-3-4-m', name: 'zed' });
    expect(m.image).toBe('https://noun.wtf/og/world/0-1-2-3-4-m.png');
    expect(m.fcImage).toBe('https://noun.wtf/og/world/fc/0-1-2-3-4-m.png');
    expect(m.url).toBe('https://noun.wtf/world?seed=0-1-2-3-4-m&name=zed');
    expect(m.title).toContain('zed');
    expect(m.button).toBe('PLAY AS ME');
    const plain = worldShareMeta({ seed: 'nonsense' });
    expect(plain.url).toBe('https://noun.wtf/world');
    expect(plain.image).toMatch(/\/fc\/world-og\.png$/);
  });

  it('writes the Farcaster embed in the mini app shape (and the legacy frame one)', () => {
    const e = miniAppEmbed({ imageUrl: 'https://x/i.png', url: 'https://noun.wtf/world' });
    expect(e).toMatchObject({
      version: '1',
      imageUrl: 'https://x/i.png',
      button: {
        title: 'PLAY AS ME',
        action: { type: 'launch_miniapp', url: 'https://noun.wtf/world' },
      },
    });
    const old = miniAppEmbed({ imageUrl: 'i', url: 'u', button: 'x'.repeat(50) }, true);
    expect(old).toMatchObject({ version: 'next', button: { action: { type: 'launch_frame' } } });
    expect((old.button as { title: string }).title).toHaveLength(32);
  });
});
