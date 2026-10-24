import { describe, expect, it } from 'vitest';

import { beginBody, submitAsset, toBase64 } from './submit';
import {
  checkFileBytes,
  cleanTags,
  fileTypeOf,
  gltfProblem,
  magicOk,
  MAX_FILE_BYTES,
  parseUploads,
  stripJpegMetadata,
  stripPngMetadata,
  svgProblem,
  validateUploadMeta,
} from './uploadRules';

const enc = (s: string) => new TextEncoder().encode(s);
/** jsdom's File has no arrayBuffer() */
const fileOf = (b: Uint8Array, name: string) =>
  Object.assign(new File([b.slice()], name), { arrayBuffer: async () => b.slice().buffer });
const meta = (over: Record<string, unknown> = {}) => ({
  title: 'Voxel Noggles',
  creator: 'nounish',
  tags: 'voxel, noggles',
  consent: true,
  name: 'noggles.png',
  bytes: 1234,
  ...over,
});

describe('validateUploadMeta', () => {
  it('accepts a good upload and normalises it', () => {
    const v = validateUploadMeta(
      meta({ link: 'https://example.com', name: 'My Photo.JPEG', creator: '@@me' }),
    );
    expect(v).toEqual({
      ok: true,
      value: {
        title: 'Voxel Noggles',
        creator: '@me',
        link: 'https://example.com/',
        tags: ['voxel', 'noggles'],
        name: 'My Photo.jpg',
        ext: 'jpg',
        mime: 'image/jpeg',
        kind: 'image',
        bytes: 1234,
      },
    });
  });

  it('requires the consent box to be literally true', () => {
    for (const consent of [undefined, false, 'yes', 1])
      expect(validateUploadMeta(meta({ consent })).ok).toBe(false);
  });

  it('caps size, refuses unknown types and bad links', () => {
    expect(validateUploadMeta(meta({ bytes: MAX_FILE_BYTES })).ok).toBe(true);
    expect(validateUploadMeta(meta({ bytes: MAX_FILE_BYTES + 1 }))).toMatchObject({
      ok: false,
      error: /10 MB/,
    });
    expect(validateUploadMeta(meta({ bytes: 0 })).ok).toBe(false);
    for (const name of ['x.exe', 'x.html', 'x.svgz', 'noext', 'x.mp4'])
      expect(validateUploadMeta(meta({ name })).ok, name).toBe(false);
    expect(validateUploadMeta(meta({ link: 'http://example.com' })).ok).toBe(false);
    expect(validateUploadMeta(meta({ title: 'x' })).ok).toBe(false);
    expect(validateUploadMeta(meta({ creator: '@' })).ok).toBe(false);
    expect(validateUploadMeta(meta({ website: 'bot' })).ok).toBe(false);
  });

  it('knows every accepted type', () => {
    for (const ext of [
      'png',
      'jpg',
      'jpeg',
      'gif',
      'webp',
      'svg',
      'mp3',
      'wav',
      'ogg',
      'glb',
      'gltf',
    ])
      expect(fileTypeOf(`a.${ext}`), ext).toBeDefined();
    expect(fileTypeOf('a.glb')?.kind).toBe('3d');
    expect(fileTypeOf('a.ogg')?.kind).toBe('audio');
  });

  it('cleans tags', () => {
    expect(cleanTags('Pixel Art, voxels;  3d!!, #sfx, voxels')).toEqual([
      'pixel-art',
      'voxels',
      '3d',
      'sfx',
    ]);
    expect(cleanTags(Array.from({ length: 20 }, (_, i) => `t${i}`))).toHaveLength(8);
    expect(cleanTags(undefined)).toEqual([]);
  });
});

describe('magic bytes', () => {
  const riff = (kind: string) => new Uint8Array([...enc('RIFF'), 0, 0, 0, 0, ...enc(kind)]);
  it('matches each format and rejects lookalikes', () => {
    expect(magicOk(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'png')).toBe(
      true,
    );
    expect(magicOk(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), 'jpg')).toBe(true);
    expect(magicOk(enc('GIF89a...'), 'gif')).toBe(true);
    expect(magicOk(riff('WEBP'), 'webp')).toBe(true);
    expect(magicOk(riff('WAVE'), 'wav')).toBe(true);
    expect(magicOk(riff('WAVE'), 'webp')).toBe(false);
    expect(magicOk(enc('OggS'), 'ogg')).toBe(true);
    expect(magicOk(enc('ID3...'), 'mp3')).toBe(true);
    expect(magicOk(new Uint8Array([0xff, 0xfb, 0x90]), 'mp3')).toBe(true);
    expect(magicOk(new Uint8Array([...enc('glTF'), 2, 0, 0, 0]), 'glb')).toBe(true);
    expect(magicOk(enc('<html>'), 'png')).toBe(false);
    expect(magicOk(enc('<html>'), 'gif')).toBe(false);
    expect(magicOk(enc('MZ'), 'exe')).toBe(false);
  });

  it('checkFileBytes runs the format checks', () => {
    expect(checkFileBytes(new Uint8Array(), 'png').ok).toBe(false);
    expect(checkFileBytes(enc('<?php system($_GET[1]); ?>'), 'jpg')).toMatchObject({
      ok: false,
      error: /isn't really/,
    });
    expect(
      checkFileBytes(enc('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>'), 'svg').ok,
    ).toBe(true);
    expect(checkFileBytes(enc('<svg><script>x</script></svg>'), 'svg').ok).toBe(false);
  });
});

describe('svgProblem', () => {
  const ok = [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="red"/></svg>',
    '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><linearGradient id="g"/></defs><rect fill="url(#g)"/><use xlink:href="#g"/></svg>',
    '<svg><image href="data:image/png;base64,AAAA"/><text>one = two</text></svg>',
  ];
  const bad = [
    '<svg><script>alert(1)</script></svg>',
    '<svg><script\nsrc="x"/></svg>',
    '<svg onload="alert(1)"></svg>',
    '<svg><rect ONCLICK = "x"/></svg>',
    '<svg><a href="javascript:alert(1)"><rect/></a></svg>',
    '<svg><a href="java\nscript:alert(1)"><rect/></a></svg>',
    '<svg><foreignObject><iframe src="https://x"/></foreignObject></svg>',
    '<svg><image href="https://evil.example/track.png"/></svg>',
    '<svg><use xlink:href="other.svg#x"/></svg>',
    '<svg><rect style="fill:url(https://x/y)"/></svg>',
    '<svg><style>@import url(x.css)</style></svg>',
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>',
    '<html><body>no svg</body></html>',
  ];
  it('passes static SVGs', () => {
    for (const s of ok) expect(svgProblem(s), s).toBeNull();
  });
  it('refuses scripts, handlers, outside loads and entities', () => {
    for (const s of bad) expect(svgProblem(s), s).not.toBeNull();
  });
});

describe('gltfProblem', () => {
  it('wants JSON with an asset block and embedded buffers only', () => {
    expect(gltfProblem('{"asset":{"version":"2.0"}}')).toBeNull();
    expect(
      gltfProblem('{"asset":{},"buffers":[{"uri":"data:application/octet-stream;base64,AA=="}]}'),
    ).toBeNull();
    expect(gltfProblem('{"asset":{},"buffers":[{"uri":"scene.bin"}]}')).toMatch(/one file/);
    expect(gltfProblem('{"asset":{},"images":[{"uri":"https://x/y.png"}]}')).toMatch(/one file/);
    expect(gltfProblem('not json')).toMatch(/JSON/);
    expect(gltfProblem('{"scenes":[]}')).toMatch(/glTF/);
  });
});

describe('metadata stripping', () => {
  it('drops EXIF / XMP / comments from a JPEG, keeps the image data', () => {
    const app0 = [0xff, 0xe0, 0x00, 0x04, 0x4a, 0x46];
    const exif = [0xff, 0xe1, 0x00, 0x06, 0x45, 0x78, 0x69, 0x66];
    const com = [0xff, 0xfe, 0x00, 0x03, 0x41];
    const scan = [0xff, 0xda, 0x00, 0x02, 9, 9, 9, 0xff, 0xd9];
    const jpg = new Uint8Array([0xff, 0xd8, ...app0, ...exif, ...com, ...scan]);
    expect([...stripJpegMetadata(jpg)]).toEqual([0xff, 0xd8, ...app0, ...scan]);
    // not parseable → untouched
    const junk = new Uint8Array([0xff, 0xd8, 0x00, 0x01]);
    expect(stripJpegMetadata(junk)).toBe(junk);
  });

  it('drops text / eXIf chunks from a PNG', () => {
    const chunk = (type: string, data: number[] = []) => [
      0,
      0,
      0,
      data.length,
      ...enc(type),
      ...data,
      1,
      2,
      3,
      4,
    ];
    const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const png = new Uint8Array([
      ...sig,
      ...chunk('IHDR', [1]),
      ...chunk('tEXt', [65, 66]),
      ...chunk('eXIf', [7]),
      ...chunk('IDAT', [5]),
      ...chunk('IEND'),
    ]);
    expect([...stripPngMetadata(png)]).toEqual([
      ...sig,
      ...chunk('IHDR', [1]),
      ...chunk('IDAT', [5]),
      ...chunk('IEND'),
    ]);
  });
});

describe('client submit', () => {
  it('base64-encodes big buffers', () => {
    const b = new Uint8Array(100_000).map((_, i) => i % 256);
    expect(toBase64(b)).toBe(Buffer.from(b).toString('base64'));
  });

  it('checks the form before anything is sent', () => {
    const form = {
      title: 'Boing',
      creator: '@me',
      link: '',
      tags: '',
      consent: false,
      website: '',
    };
    expect(beginBody(form, { name: 'b.mp3', size: 10 })).toMatchObject({ ok: false, error: /CC0/ });
    expect(beginBody({ ...form, consent: true }, { name: 'b.mp3', size: 10 }).ok).toBe(true);
  });

  it('sends begin → parts → finish and stops on a server error', async () => {
    const sent: Record<string, unknown>[] = [];
    const f = (async (_u: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      sent.push(body);
      const out =
        body.action === 'begin'
          ? { ok: true, id: '0123456789abcdef', token: 't'.repeat(32), parts: 1 }
          : body.action === 'finish'
            ? { ok: false, error: 'nope' }
            : { ok: true };
      return new Response(JSON.stringify(out), { status: out.ok ? 200 : 400 });
    }) as unknown as typeof fetch;
    const file = fileOf(new Uint8Array([...enc('ID3'), 1, 2, 3]), 'boing.mp3');
    const form = {
      title: 'Boing',
      creator: '@me',
      link: '',
      tags: 'sfx',
      consent: true,
      website: '',
    };
    const r = await submitAsset(form, file, { fetch: f });
    expect(r).toEqual({ ok: false, error: 'nope' });
    expect(sent.map(s => s.action)).toEqual(['begin', 'part', 'finish']);
    expect(sent[1]).toMatchObject({
      n: 0,
      data: Buffer.from([...enc('ID3'), 1, 2, 3]).toString('base64'),
    });

    // a fake file is caught before any request
    sent.length = 0;
    const fake = fileOf(enc('<html>'), 'x.png');
    expect((await submitAsset(form, fake, { fetch: f })).ok).toBe(false);
    expect(sent).toEqual([]);
  });

  it('parseUploads drops malformed rows', () => {
    const good = {
      id: '0123456789abcdef',
      at: 1,
      title: 'Boing',
      creator: '@me',
      tags: [],
      name: 'b.mp3',
      bytes: 9,
    };
    expect(
      parseUploads({ uploads: [good, { ...good, id: 'x' }, { ...good, name: 'b.exe' }] }),
    ).toHaveLength(1);
    expect(parseUploads(null)).toEqual([]);
  });
});
