import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { CATALOG } from '../catalog';

import { buildRows, CLIENTS, coverForPath, GAMES, HERO_SLIDES, searchItems } from './rows';

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

  it('leads Play now with the three games (real covers), then the extra toys', () => {
    const play = rows[0]!;
    expect(play.items.slice(0, 3).map(i => i.action)).toEqual(
      GAMES.map(g => ({ t: 'game', id: g.id })),
    );
    expect(play.items.slice(0, 3).every(i => i.cover !== undefined)).toBe(true);
    const paths = play.items.flatMap(i => (i.action.t === 'entry' ? [i.action.entry.path] : []));
    expect(paths).toEqual(expect.arrayContaining(['/icecreamvan', '/playground', '/crystal-ball']));
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
