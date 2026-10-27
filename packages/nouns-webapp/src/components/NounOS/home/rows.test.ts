import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CATALOG } from '../catalog';

import {
  BIG_DROP_CARD,
  BIG_DROP_COVER,
  BIG_DROP_HINT,
  BIG_DROP_URL,
  buildRows,
  CLIENTS,
  coverForPath,
  GAMES,
  HERO_SLIDES,
  searchItems,
} from './rows';

describe('buildRows', () => {
  const rows = buildRows(CATALOG, [
    {
      id: 'c1',
      at: 1,
      name: 'Noun Kart',
      url: 'https://nounkart.xyz/',
      blurb: 'kart racing with noggles',
      kind: 'game',
    },
  ]);

  it('orders the shelves: play, every catalog section, clients, community', () => {
    expect(rows.map(r => r.id)).toEqual([
      'play',
      ...CATALOG.map(s => s.id),
      'clients',
      'community',
    ]);
  });

  it('leads Play now with the games (real covers), then the extra toys', () => {
    const play = rows[0]!;
    const n = GAMES.length;
    expect(play.items.slice(0, n).map(i => i.action)).toEqual(
      GAMES.map(g => ({ t: 'game', id: g.id })),
    );
    expect(play.items.slice(0, n).every(i => i.cover !== undefined)).toBe(true);
    const paths = play.items.flatMap(i => (i.action.t === 'entry' ? [i.action.entry.path] : []));
    expect(paths).toEqual(['/exchange', '/world/voice', '/playground', '/crystal-ball']);
    const booth = play.items.find(i => i.key === 'play:/world/voice')!;
    expect(booth.cover).toBe('/home/covers/voice-booth.webp');
    expect(booth.action).toMatchObject({ t: 'entry', entry: { path: '/world/voice' } });
  });

  it('gives Noun World a hover preview clip', () => {
    expect(rows[0]!.items[0]!.preview?.mp4).toMatch(/\.mp4$/);
  });

  it('keeps every catalog entry, using the game cover for /world and /warfare', () => {
    for (const s of CATALOG) {
      const row = rows.find(r => r.id === s.id)!;
      expect(row.items).toHaveLength(s.entries.length);
      expect(row.title).toBe(s.title);
      expect(row.tagline).toBe(s.tag);
    }
    const art = rows.find(r => r.id === 'art')!;
    const world = art.items.find(i => i.key === 'art:/world')!;
    expect(world.action).toEqual({ t: 'game', id: 'world' });
    expect(world.cover).toBe(GAMES[0]!.card);
  });

  it('opens clients externally, https only', () => {
    const clients = rows.find(r => r.id === 'clients')!;
    expect(clients.items).toHaveLength(CLIENTS.length);
    for (const it of clients.items) {
      expect(it.external).toBe(true);
      expect(it.action.t === 'external' && it.action.url.startsWith('https://')).toBe(true);
    }
  });

  it('starts Community with the submit card, then approved entries', () => {
    const c = rows.find(r => r.id === 'community')!;
    expect(c.items[0]!.action).toEqual({ t: 'submit' });
    expect(c.items[1]).toMatchObject({
      title: 'NOUN KART',
      external: true,
      action: { t: 'external', url: 'https://nounkart.xyz/' },
      label: 'GAME · nounkart.xyz',
    });
  });

  it('has unique keys within each row', () => {
    for (const r of rows) expect(new Set(r.items.map(i => i.key)).size).toBe(r.items.length);
  });
});

describe('THE BIG DROP card', () => {
  const drop = (opts?: { dropUnlocked?: boolean }) =>
    buildRows(CATALOG, [], opts)[0]!.items.find(i => i.key === 'game:drop')!;

  it('sits in Play now after the four games, with one obvious cover to swap', () => {
    const play = buildRows(CATALOG)[0]!;
    expect(play.items.findIndex(i => i.key === 'game:drop')).toBe(4);
    expect(GAMES.find(g => g.id === 'drop')).toMatchObject({
      card: BIG_DROP_CARD,
      cover: BIG_DROP_COVER,
    });
    expect(drop().cover).toBe(BIG_DROP_CARD);
    const pub = resolve(__dirname, '../../../../public');
    for (const f of [BIG_DROP_CARD, BIG_DROP_COVER])
      expect(existsSync(resolve(pub, `.${f}`)), f).toBe(true);
  });

  it('is locked (no HOT, the hint) unless the deepest door is open', () => {
    expect(drop()).toMatchObject({ locked: { hint: BIG_DROP_HINT }, hot: false });
    expect(drop({ dropUnlocked: false }).locked).toBeDefined();
    const open = drop({ dropUnlocked: true });
    expect(open.locked).toBeUndefined();
    expect(open.hot).toBe(true);
    expect(open.action).toEqual({ t: 'game', id: 'drop' });
  });

  it('launches Noun World straight onto the mountain', () => {
    expect(BIG_DROP_URL).toBe('/world?drop=1');
  });

  it('only ever locks the Big Drop', () => {
    for (const r of buildRows(CATALOG))
      for (const it of r.items)
        if (it.key !== 'game:drop') expect(it.locked, it.key).toBeUndefined();
  });
});

describe('covers', () => {
  const rows = buildRows(CATALOG, [
    {
      id: 'c1',
      at: 1,
      name: 'Noun Kart',
      url: 'https://nounkart.xyz/',
      blurb: 'kart',
      kind: 'game',
    },
  ]);
  const publicDir = resolve(__dirname, '../../../../public');

  it('gives every catalog entry and game a portrait poster that exists on disk', () => {
    const items = rows
      .filter(r => r.id !== 'clients' && r.id !== 'community')
      .flatMap(r => r.items);
    for (const it of items) {
      expect(it.cover, it.key).toMatch(/\.webp$/);
      expect(existsSync(resolve(publicDir, `.${it.cover}`)), it.cover).toBe(true);
    }
    for (const g of GAMES) expect(existsSync(resolve(publicDir, `.${g.card}`)), g.card).toBe(true);
  });

  it('gives every Nouns client its own poster on disk, community stays on generated art', () => {
    const clients = rows.find(r => r.id === 'clients')!;
    expect(clients.items).toHaveLength(CLIENTS.length);
    for (const it of clients.items) {
      expect(it.cover, it.key).toMatch(/^\/home\/covers\/client-.+\.webp$/);
      expect(existsSync(resolve(publicDir, `.${it.cover}`)), it.cover).toBe(true);
    }
    expect(new Set(CLIENTS.map(c => c.card)).size).toBe(CLIENTS.length);
  });

  it('names posters after the path and leaves unknown pages to the generated box art', () => {
    expect(coverForPath('/world/classic')).toBe('/home/covers/world-classic.webp');
    expect(coverForPath('/explore/wallet')).toBe('/home/covers/explore-wallet.webp');
    expect(coverForPath('/world/voice')).toBe('/home/covers/voice-booth.webp');
    expect(coverForPath('/books/meme-value')).toBe('/home/covers/meme-value.webp');
    expect(coverForPath('/cc0')).toBe('/home/covers/cc0-library.webp');
    expect(coverForPath('/not-a-page')).toBeUndefined();
    const community = rows.find(r => r.id === 'community')!;
    expect(community.items.every(i => i.cover === undefined)).toBe(true);
  });
});

describe('searchItems', () => {
  const rows = buildRows(CATALOG);
  it('ranks name prefix matches first and dedupes repeats across shelves', () => {
    const hits = searchItems(rows, 'noun');
    const keys = hits.map(h => h.title);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys[0]!.startsWith('NOUN')).toBe(true);
    expect(keys.filter(k => k === 'NOUN WORLD')).toHaveLength(1);
  });
  it('finds the Voice Booth by name and by what it does', () => {
    expect(searchItems(rows, 'voice booth')[0]?.title).toBe('VOICE BOOTH');
    expect(searchItems(rows, 'voice model').map(h => h.title)).toContain('VOICE BOOTH');
  });
  it('finds the MEME VALUE book on the ART / CULTURE shelf', () => {
    expect(searchItems(rows, 'meme value')[0]?.title).toBe('MEME VALUE');
    expect(searchItems(rows, 'book').map(h => h.title)).toContain('MEME VALUE');
    const art = rows.find(r => r.id === 'art')!;
    const card = art.items.find(i => i.key === 'art:/books/meme-value')!;
    expect(card.cover).toBe('/home/covers/meme-value.webp');
    expect(card.action).toMatchObject({ t: 'entry', entry: { path: '/books/meme-value' } });
  });

  it('finds the CC0 Library on the ART / CULTURE shelf', () => {
    const art = rows.find(r => r.id === 'art')!;
    const cc0 = art.items.find(i => i.key === 'art:/cc0')!;
    expect(cc0).toMatchObject({ title: 'CC0 LIBRARY', cover: '/home/covers/cc0-library.webp' });
    for (const q of ['cc0', 'cc0 library', 'voxels', 'sounds'])
      expect(
        searchItems(rows, q).map(h => h.title),
        q,
      ).toContain('CC0 LIBRARY');
    expect(searchItems(rows, 'cc0')[0]?.title).toBe('CC0 LIBRARY');
  });
  it('matches blurbs', () => {
    expect(searchItems(rows, 'order book').map(h => h.title)).toContain('GRAND EXCHANGE');
  });
  it('is empty for blank queries and never offers the submit card', () => {
    expect(searchItems(rows, '  ')).toEqual([]);
    expect(searchItems(rows, 'submit').some(h => h.action.t === 'submit')).toBe(false);
  });
});

describe('HERO_SLIDES', () => {
  it('every slide has media and a game to launch', () => {
    for (const s of HERO_SLIDES) {
      expect(s.clip !== undefined || s.still !== undefined).toBe(true);
      expect(GAMES.map(g => g.id)).toContain(s.game);
      expect(s.ms).toBeGreaterThan(3000);
    }
  });
});

describe('ART / CULTURE row', () => {
  it('opens with the book, pip3, the van and the booth', () => {
    const art = buildRows(CATALOG).find(r => r.id === 'art')!;
    const paths = art.items.map(i => (i.action.t === 'entry' ? i.action.entry.path : i.key));
    expect(paths.slice(0, 8)).toEqual([
      '/books/meme-value',
      '/pip3',
      '/icecreamvan',
      '/world/voice',
      '/cc0',
      '/playground',
      '/studio',
      '/terraforms',
    ]);
  });
});

describe('hero slides', () => {
  it('each game slide shows its own game, not whatever sits at that index', () => {
    for (const s of HERO_SLIDES) {
      if (s.key === 'warfare') {
        expect(s.still).toBe('/warfare/cover.webp');
        expect(s.tagline).toBe(GAMES.find(g => g.id === 'warfare')!.tagline);
      }
    }
  });
});
