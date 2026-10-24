import type { ArchiveAsset, ArchiveCreator } from '@/cc0-archive';

import { describe, expect, it } from 'vitest';

import {
  archiveAssets,
  archiveToAsset,
  cc0LibAssets,
  cc0LibToAsset,
  cleanArchiveTitle,
  creatorFacets,
  filterAssets,
  mergeAssets,
  NO_FILTERS,
  typeFacets,
  typeFromExt,
  uploadToAsset,
  type Cc0Asset,
} from './assets';
import { fetchCc0Lib, fetchUploads } from './useCc0Assets';

const seb: ArchiveCreator = {
  id: 'sebastien',
  name: 'Sebastien',
  bio: '',
  inMemoriam: true,
  links: {},
};
const arch = (over: Partial<ArchiveAsset> = {}): ArchiveAsset => ({
  id: 'sebastien-gh-1',
  creatorId: 'sebastien',
  title: 'Nigiri (1).vxm.png',
  description: '0x572f00/NOUNDRY · HEAD/NOUNS/Sushi/Nigiri (1).vxm.png',
  source: 'web',
  sourceUrl: 'https://github.com/0x572f00/NOUNDRY/blob/main/HEAD/NOUNS/Sushi/Nigiri (1).vxm.png',
  mediaUrl:
    'https://raw.githubusercontent.com/0x572f00/NOUNDRY/main/HEAD/NOUNS/Sushi/Nigiri (1).vxm.png',
  mediaType: 'image',
  tags: ['github', 'cc0', 'png'],
  license: 'CC0',
  ingestedAt: '2026-05-06T22:53:06.719Z',
  meta: { size: 798 },
  ...over,
});

describe('archive adapter', () => {
  it('normalises a NOUNDRY voxel render', () => {
    const a = archiveToAsset(arch(), seb);
    expect(a).toMatchObject({
      id: 'archive-sebastien-gh-1',
      title: 'Nigiri (1)',
      creator: 'Sebastien',
      creatorId: 'sebastien',
      source: 'archive',
      type: 'image',
      ext: 'png',
      isPixel: true,
      inMemoriam: true,
      bytes: 798,
      sourceLabel: 'github.com',
    });
    expect(a.thumb).toBe(a.fileUrl);
    // repo folders become search tags
    expect(a.tags).toEqual(expect.arrayContaining(['head', 'nouns', 'sushi', 'cc0']));
  });

  it('has no thumbnail for 3D files', () => {
    const a = archiveToAsset(
      arch({
        mediaType: '3d',
        mediaUrl: 'https://raw.githubusercontent.com/x/y/main/m.obj',
        title: 'm.obj',
      }),
      seb,
    );
    expect(a.type).toBe('3d');
    expect(a.thumb).toBeUndefined();
    expect(a.title).toBe('m');
  });

  it('leads with finished pieces, parts after', () => {
    const part = arch({
      id: 'p',
      title: 'mouth.vxm.png',
      description: '0x/N · HEAD/NOUNS/Sushi/mouth.vxm.png',
    });
    const render = arch({
      id: 'r',
      title: 'Sushi.vxr.png',
      description: '0x/N · HEAD/NOUNS/Sushi/Sushi.vxr.png',
    });
    const named = arch({
      id: 'n',
      title: 'Sushi.png',
      description: '0x/N · HEAD/NOUNS/-Sushi-/Sushi.png',
    });
    const out = archiveAssets([{ creator: seb, assets: [part, render, named] }]);
    expect(out.map(a => a.id)).toEqual(['archive-r', 'archive-n', 'archive-p']);
    expect(out[2]!.featured).toBeUndefined();
  });

  it('cleans titles', () => {
    expect(cleanArchiveTitle('1block (2).vxm.png')).toBe('1block (2)');
    expect(cleanArchiveTitle('PufferFish.vxr.png')).toBe('PufferFish');
    expect(cleanArchiveTitle('.png')).toBe('.png');
  });

  it('maps extensions to types', () => {
    expect(typeFromExt('gif')).toBe('gif');
    expect(typeFromExt('jpeg')).toBe('image');
    expect(typeFromExt('glb')).toBe('3d');
    expect(typeFromExt('ogg')).toBe('audio');
    expect(typeFromExt(undefined)).toBe('other');
  });
});

describe('cc0-lib adapter', () => {
  it('normalises an item and keeps https only', () => {
    const a = cc0LibToAsset({
      ID: '42',
      Title: 'Noggles Logo',
      File: 'https://cdn.cc0-lib.wtf/noggles.svg',
      Filetype: 'SVG',
      Type: 'Logo',
      Tags: ['Pixel', 'Nouns'],
      ENS: 'noun.eth',
      Source: 'https://nouns.wtf',
    });
    expect(a).toMatchObject({
      id: 'cc0-42',
      creator: 'noun.eth',
      creatorId: 'ens:noun.eth',
      type: 'svg',
      isPixel: true,
      sourceUrl: 'https://nouns.wtf',
      sourceLabel: 'cc0-lib.wtf',
    });
    expect(cc0LibToAsset({ Title: 'x', File: 'javascript:alert(1)' })).toBeNull();
    expect(
      cc0LibToAsset({ Title: 'x', File: 'https://a/x.png', Source: 'javascript:1' })?.sourceUrl,
    ).toBe('https://a/x.png');
  });

  it('dedupes across tag probes and ignores junk responses', () => {
    const item = { ID: '1', Title: 'a', File: 'https://a/a.png' };
    const out = cc0LibAssets([{ data: [item, item] }, { data: [item, 7, null] }, 'html', null]);
    expect(out.map(a => a.id)).toEqual(['cc0-1']);
  });

  it('gives up fast when cc0-lib.wtf is unreachable', async () => {
    let calls = 0;
    const f = (async () => {
      calls++;
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    await expect(fetchCc0Lib(f, async () => undefined)).rejects.toThrow(/unreachable/);
    expect(calls).toBe(1);
  });

  it('collects JSON probes, skips non-JSON ones', async () => {
    const f = (async (url: string) => {
      const tag = new URL(url).searchParams.get('tag');
      const json = tag === 'art';
      return new Response(
        json
          ? JSON.stringify({ data: [{ ID: tag, Title: tag, File: 'https://a/x.png' }] })
          : '<html>',
        {
          headers: { 'content-type': json ? 'application/json' : 'text/html' },
        },
      );
    }) as unknown as typeof fetch;
    const out = await fetchCc0Lib(f, async () => undefined);
    expect(out.map(a => a.id)).toEqual(['cc0-art']);
  });
});

describe('uploads', () => {
  const up = {
    id: '0123456789abcdef',
    at: 5,
    title: 'Boing',
    creator: '@me',
    tags: ['sfx'],
    name: 'boing.mp3',
    ext: 'mp3',
    mime: 'audio/mpeg',
    kind: 'audio' as const,
    bytes: 1000,
  };

  it('become assets served by cc0-file, with no image thumb for audio', () => {
    const a = uploadToAsset(up);
    expect(a).toMatchObject({
      id: 'upload-0123456789abcdef',
      type: 'audio',
      source: 'upload',
      uploadId: up.id,
    });
    expect(a.thumb).toBeUndefined();
    expect(a.fileUrl).toBe('/.netlify/functions/cc0-file?id=0123456789abcdef');
    expect(
      uploadToAsset({ ...up, kind: 'image', ext: 'png', name: 'x.png', mime: 'image/png' }).thumb,
    ).toBe(a.fileUrl);
  });

  it('fetchUploads keeps valid rows, and is empty when the function is absent (dev)', async () => {
    const ok = (async () =>
      new Response(JSON.stringify({ uploads: [up, { ...up, id: 'nope' }] }), {
        headers: { 'content-type': 'application/json' },
      })) as unknown as typeof fetch;
    expect((await fetchUploads(ok)).map(a => a.uploadId)).toEqual([up.id]);
    const html = (async () =>
      new Response('<!doctype html>', {
        headers: { 'content-type': 'text/html' },
      })) as unknown as typeof fetch;
    expect(await fetchUploads(html)).toEqual([]);
  });
});

describe('merge + filter', () => {
  const mk = (id: string, over: Partial<Cc0Asset> = {}): Cc0Asset => ({
    id,
    title: id,
    creator: 'Sebastien',
    creatorId: 'sebastien',
    source: 'archive',
    type: 'image',
    fileUrl: `https://x/${id}.png`,
    sourceLabel: 'github.com',
    tags: [],
    isPixel: false,
    ...over,
  });
  const uOld = mk('u1', {
    source: 'upload',
    at: 1,
    creator: '@a',
    creatorId: 'upload:a',
    type: 'audio',
  });
  const uNew = mk('u2', {
    source: 'upload',
    at: 2,
    creator: '@b',
    creatorId: 'upload:b',
    type: 'gif',
  });
  const lib = mk('l1', {
    source: 'cc0-lib',
    creator: 'noun.eth',
    creatorId: 'ens:noun.eth',
    type: 'svg',
  });
  const arc = [
    mk('a1', { tags: ['sushi', 'head'] }),
    mk('a2', { type: '3d', ext: 'obj' }),
    mk('a1'),
  ];

  it('puts uploads first (newest first), then cc0-lib, then the archive, deduped', () => {
    const all = mergeAssets({ uploads: [uOld, uNew], cc0Lib: [lib], archive: arc });
    expect(all.map(a => a.id)).toEqual(['u2', 'u1', 'l1', 'a1', 'a2']);
    expect(mergeAssets({})).toEqual([]);
  });

  const all = mergeAssets({ uploads: [uOld, uNew], cc0Lib: [lib], archive: arc });
  const ids = (f: Partial<typeof NO_FILTERS>) =>
    filterAssets(all, { ...NO_FILTERS, ...f }).map(a => a.id);

  it('filters by type ("image" includes gif / svg), source and creator', () => {
    expect(ids({})).toHaveLength(5);
    expect(ids({ type: 'image' })).toEqual(['u2', 'l1', 'a1']);
    expect(ids({ type: 'gif' })).toEqual(['u2']);
    expect(ids({ type: '3d' })).toEqual(['a2']);
    expect(ids({ source: 'upload' })).toEqual(['u2', 'u1']);
    expect(ids({ creator: 'ens:noun.eth' })).toEqual(['l1']);
    expect(ids({ source: 'upload', type: 'audio' })).toEqual(['u1']);
  });

  it('searches every word across title, creator, tags and extension', () => {
    expect(ids({ q: 'sushi' })).toEqual(['a1']);
    expect(ids({ q: 'SUSHI head' })).toEqual(['a1']);
    expect(ids({ q: 'sushi obj' })).toEqual([]);
    expect(ids({ q: 'obj' })).toEqual(['a2']);
    expect(ids({ q: 'noun.eth' })).toEqual(['l1']);
    expect(ids({ q: '   ' })).toHaveLength(5);
  });

  it('builds creator and type facets with counts', () => {
    expect(creatorFacets(all)[0]).toEqual({ value: 'sebastien', label: 'Sebastien', count: 2 });
    const types = typeFacets(all);
    expect(types.find(t => t.value === 'image')?.count).toBe(3);
    expect(types.some(t => t.value === 'video')).toBe(false);
  });
});
