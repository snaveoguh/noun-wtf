import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadAllArchive, loadArchiveCreator, parseArchiveIndex, parseArchiveManifest } from '.';

const PUBLIC = resolve(__dirname, '../../public');

/** fetch() over the real files in public/, counting requests */
function diskFetch(overrides: Record<string, unknown> = {}) {
  const hits: string[] = [];
  const f = async (url: string) => {
    hits.push(url);
    if (url in overrides) {
      const v = overrides[url];
      return { ok: v !== 404, status: v === 404 ? 404 : 200, json: async () => v };
    }
    try {
      const body = readFileSync(resolve(PUBLIC, `.${url}`), 'utf8');
      return { ok: true, status: 200, json: async () => JSON.parse(body) as unknown };
    } catch {
      return { ok: false, status: 404, json: async () => null };
    }
  };
  return { f, hits };
}

describe('cc0-archive loader', () => {
  it('loads the deployed archive: index, then only creators that have assets', async () => {
    const { f, hits } = diskFetch();
    const all = await loadAllArchive(f);
    expect(hits[0]).toBe('/cc0-archive/index.json');
    const seb = all.find(m => m.creator.id === 'sebastien');
    expect(seb?.creator.inMemoriam).toBe(true);
    expect(seb!.assets.length).toBeGreaterThan(4000);
    // empty creators (assetCount 0) aren't fetched
    expect(hits).not.toContain('/cc0-archive/creators/hugo.json');
  });

  it("one broken creator file doesn't sink the rest", async () => {
    const index = {
      version: 1,
      updatedAt: 'x',
      creators: [
        { id: 'a', name: 'A', file: 'creators/a.json', assetCount: 1 },
        { id: 'b', name: 'B', file: 'creators/b.json', assetCount: 1 },
      ],
    };
    const good = { creator: { id: 'b', name: 'B', bio: '', links: {} }, assets: [] };
    const { f } = diskFetch({
      '/cc0-archive/index.json': index,
      '/cc0-archive/creators/a.json': 404,
      '/cc0-archive/creators/b.json': good,
    });
    const all = await loadAllArchive(f);
    expect(all.map(m => m.creator.id)).toEqual(['b']);
  });

  it('throws when the index is missing or malformed', async () => {
    await expect(loadAllArchive(diskFetch({ '/cc0-archive/index.json': 404 }).f)).rejects.toThrow();
    await expect(
      loadAllArchive(diskFetch({ '/cc0-archive/index.json': { version: 2 } }).f),
    ).rejects.toThrow(/malformed/);
  });

  it('refuses path-like creator ids', async () => {
    await expect(loadArchiveCreator('../index', diskFetch().f)).rejects.toThrow(/bad creator id/);
  });

  it('drops malformed assets and bad index rows', () => {
    const m = parseArchiveManifest({
      creator: { id: 'x', name: 'X', links: {} },
      assets: [
        {
          id: '1',
          creatorId: 'x',
          title: 't',
          mediaUrl: 'https://a/b.png',
          sourceUrl: 'https://a',
          mediaType: 'image',
          tags: [],
        },
        { id: '2', title: 'no media' },
        null,
      ],
    });
    expect(m?.assets.map(a => a.id)).toEqual(['1']);
    expect(parseArchiveManifest({ assets: [] })).toBeNull();
    expect(
      parseArchiveIndex({
        version: 1,
        creators: [
          { id: 'ok', name: 'OK' },
          { id: '../x', name: 'bad' },
        ],
      })?.creators.map(c => c.id),
    ).toEqual(['ok']);
  });
});
