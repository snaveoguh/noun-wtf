import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_FILE_BYTES, PART_BYTES } from '../../src/pages/Cc0Library/uploadRules';

// In-memory Netlify Blobs (strings and binary)
const blobs = new Map<string, string | Uint8Array>();
const store = {
  async get(k: string, o?: { type?: string }) {
    const v = blobs.get(k);
    if (v === undefined) return null;
    if (o?.type === 'json') return JSON.parse(v as string);
    if (o?.type === 'arrayBuffer') {
      const b = typeof v === 'string' ? new TextEncoder().encode(v) : v;
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    }
    return v;
  },
  async set(k: string, v: string | ArrayBuffer) {
    blobs.set(k, typeof v === 'string' ? v : new Uint8Array(v.slice(0)));
    return { modified: true };
  },
  async setJSON(k: string, v: unknown, o: { onlyIfNew?: boolean } = {}) {
    if (o.onlyIfNew === true && blobs.has(k)) return { modified: false };
    blobs.set(k, JSON.stringify(v));
    return { modified: true };
  },
  async delete(k: string) {
    blobs.delete(k);
  },
  async list({ prefix }: { prefix: string }) {
    return {
      blobs: Array.from(blobs.keys())
        .filter(k => k.startsWith(prefix))
        .map(key => ({ key })),
    };
  },
};

vi.mock('@netlify/blobs', () => ({
  connectLambda: () => undefined,
  getStore: () => store,
}));

const { handler, UP_PER_IP_HOUR, UP_REPORTS_PER_IP_HOUR } = await import(
  '../functions/cc0-uploads'
);
const { default: fileHandler, parseRange } = await import('../functions/cc0-file');

const TOKEN = 'a-very-long-admin-token-123';
const IP = { 'x-nf-client-connection-ip': '1.2.3.4' };
const ADMIN = { 'x-world-admin': TOKEN };

const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42,
  0x60, 0x82,
]);
const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64');

const meta = (over: Record<string, unknown> = {}) => ({
  action: 'begin',
  title: 'Voxel Noggles',
  creator: '@nounish',
  link: 'https://example.com/me',
  tags: 'voxel, noggles',
  consent: true,
  name: 'noggles.png',
  bytes: PNG.length,
  ...over,
});

const call = (body?: unknown, headers: Record<string, string> = IP, method = 'POST') =>
  handler({
    httpMethod: method,
    body: body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body),
    headers,
  }).then(r => ({
    status: r.statusCode,
    headers: r.headers,
    data: JSON.parse(r.body) as Record<string, unknown>,
  }));

/** begin → parts → finish; returns the finish response + id */
async function upload(bytes: Uint8Array, over: Record<string, unknown> = {}, headers = IP) {
  const b = await call(meta({ bytes: bytes.length, ...over }), headers);
  if (b.status !== 200) return { ...b, id: '' };
  const { id, token, parts } = b.data as { id: string; token: string; parts: number };
  for (let n = 0; n < parts; n++) {
    const r = await call(
      {
        action: 'part',
        id,
        token,
        n,
        data: b64(bytes.subarray(n * PART_BYTES, (n + 1) * PART_BYTES)),
      },
      headers,
    );
    if (r.status !== 200) return { ...r, id };
  }
  return { ...(await call({ action: 'finish', id, token }, headers)), id };
}

const getFile = (id: string, headers: Record<string, string> = {}) =>
  fileHandler(new Request(`https://noun.wtf/.netlify/functions/cc0-file?id=${id}`, { headers }));

describe('cc0-uploads', () => {
  beforeEach(() => {
    blobs.clear();
    process.env.WORLD_ADMIN_TOKEN = TOKEN;
  });

  it('takes an upload in parts, queues it as pending, lists nothing until approved', async () => {
    const r = await upload(PNG);
    expect(r.status).toBe(200);
    expect(blobs.get(`f/${r.id}`)).toEqual(PNG);
    expect([...blobs.keys()].some(k => k.startsWith('p/'))).toBe(false);
    const list = await call(undefined, IP, 'GET');
    expect(list.data.uploads).toEqual([]);
    expect((await getFile(r.id)).status).toBe(404);
  });

  it('needs the CC0 consent box, literally true', async () => {
    for (const consent of [undefined, false, 'true', 1]) {
      const r = await call(meta({ consent }));
      expect(r.status).toBe(400);
      expect(String(r.data.error)).toMatch(/CC0/);
    }
    expect([...blobs.keys()].some(k => k.startsWith('u/'))).toBe(false);
  });

  it('refuses bad types, oversize files and bad metadata before any bytes', async () => {
    for (const bad of [
      meta({ name: 'virus.exe' }),
      meta({ name: 'page.html' }),
      meta({ bytes: MAX_FILE_BYTES + 1 }),
      meta({ bytes: 0 }),
      meta({ title: '' }),
      meta({ creator: '' }),
      meta({ link: 'javascript:alert(1)' }),
      meta({ website: 'spam.biz' }),
    ])
      expect((await call(bad)).status).toBe(400);
    expect((await call('x'.repeat(5_000_000))).status).toBe(413);
  });

  it('checks the bytes: magic numbers, svg scripts, part sizes', async () => {
    const fake = new TextEncoder().encode('<html>not a png</html>');
    const r = await upload(fake);
    expect(r.status).toBe(400);
    expect(String(r.data.error)).toMatch(/isn't really a \.png/);
    expect(blobs.has(`u/${r.id}`)).toBe(false);

    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    const s = await upload(svg, { name: 'x.svg' });
    expect(s.status).toBe(400);
    expect(String(s.data.error)).toMatch(/scripts/);

    // a part that isn't the size `begin` promised
    const b = await call(meta());
    const { id, token } = b.data as { id: string; token: string };
    const p = await call({ action: 'part', id, token, n: 0, data: b64(PNG.subarray(0, 4)) });
    expect(p.status).toBe(400);
    // finishing with parts missing
    expect((await call({ action: 'finish', id, token })).status).toBe(400);
  });

  it('needs the upload token for parts and finish', async () => {
    const b = await call(meta());
    const { id } = b.data as { id: string };
    const wrong = 'f'.repeat(32);
    expect((await call({ action: 'part', id, token: wrong, n: 0, data: b64(PNG) })).status).toBe(
      404,
    );
    expect((await call({ action: 'finish', id, token: wrong })).status).toBe(404);
    expect(JSON.stringify([...blobs.values()].filter(v => typeof v === 'string'))).not.toContain(
      wrong,
    );
  });

  it('handles a multi-part file up to 10 MB', async () => {
    const big = new Uint8Array(PART_BYTES * 2 + 1234);
    big.set(PNG.subarray(0, 8));
    const r = await upload(big);
    expect(r.status).toBe(200);
    expect((blobs.get(`f/${r.id}`) as Uint8Array).length).toBe(big.length);
  });

  it('strips EXIF from JPEGs on the way in', async () => {
    const exif = [0xff, 0xe1, 0x00, 0x08, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
    const jpg = new Uint8Array([0xff, 0xd8, ...exif, 0xff, 0xda, 0x00, 0x02, 1, 2, 3, 0xff, 0xd9]);
    const r = await upload(jpg, { name: 'photo.jpeg' });
    expect(r.status).toBe(200);
    const stored = blobs.get(`f/${r.id}`) as Uint8Array;
    expect(stored.length).toBe(jpg.length - exif.length);
    const rec = JSON.parse(blobs.get(`u/${r.id}`) as string);
    expect(rec).toMatchObject({
      ext: 'jpg',
      mime: 'image/jpeg',
      stripped: true,
      status: 'pending',
    });
  });

  it('never stores the raw IP or the upload token', async () => {
    await upload(PNG);
    const all = [...blobs.values()].filter(v => typeof v === 'string').join('\n');
    expect(all).not.toContain('1.2.3.4');
  });

  it('rate limits uploads per IP', async () => {
    for (let i = 0; i < UP_PER_IP_HOUR; i++) expect((await call(meta())).status).toBe(200);
    expect((await call(meta())).status).toBe(429);
    expect((await call(meta(), { 'x-nf-client-connection-ip': '5.6.7.8' })).status).toBe(200);
  });

  it('admin actions need the token', async () => {
    expect((await call({ action: 'admin-pending' })).status).toBe(401);
    expect((await call({ action: 'admin-pending' }, { 'x-world-admin': 'nope' })).status).toBe(401);
    expect((await call({ action: 'admin-decide', id: 'a'.repeat(16), approve: true })).status).toBe(
      401,
    );
    delete process.env.WORLD_ADMIN_TOKEN;
    expect((await call({ action: 'admin-pending' }, ADMIN)).status).toBe(503);
  });

  it('admin can preview, approve, hide and reject; hidden files are never served', async () => {
    const a = await upload(PNG);
    const b = await upload(PNG, { title: 'Spam' });
    const pending = await call({ action: 'admin-pending' }, ADMIN);
    const list = pending.data.pending as Record<string, unknown>[];
    expect(list.map(p => p.id)).toEqual([a.id, b.id]);
    expect(list.every(p => p.tokenHash === undefined)).toBe(true);
    // admin preview of a pending file, not cached
    const prev = await getFile(a.id, ADMIN);
    expect(prev.status).toBe(200);
    expect(prev.headers.get('cache-control')).toBe('no-store');

    expect((await call({ action: 'admin-decide', id: a.id, approve: true }, ADMIN)).status).toBe(
      200,
    );
    expect((await call({ action: 'admin-decide', id: b.id, approve: false }, ADMIN)).status).toBe(
      200,
    );
    expect(blobs.has(`f/${b.id}`)).toBe(false);

    const pub = await call(undefined, IP, 'GET');
    expect(pub.data.uploads).toEqual([
      expect.objectContaining({ id: a.id, title: 'Voxel Noggles', tags: ['voxel', 'noggles'] }),
    ]);
    expect(JSON.stringify(pub.data)).not.toMatch(/tokenHash|"ip"/);

    const f = await getFile(a.id);
    expect(f.status).toBe(200);
    expect(f.headers.get('content-type')).toBe('image/png');
    expect(f.headers.get('cache-control')).toMatch(/max-age=31536000/);
    expect(f.headers.get('x-content-type-options')).toBe('nosniff');
    expect(new Uint8Array(await f.arrayBuffer())).toEqual(PNG);

    await call({ action: 'admin-decide', id: a.id, hidden: true }, ADMIN);
    expect((await call(undefined, IP, 'GET')).data.uploads).toEqual([]);
    expect((await getFile(a.id)).status).toBe(404);
    await call({ action: 'admin-decide', id: a.id, hidden: false }, ADMIN);
    expect((await getFile(a.id)).status).toBe(200);
  });

  it('reports go to the admin queue (approved uploads only, rate limited)', async () => {
    const a = await upload(PNG);
    expect((await call({ action: 'report', id: a.id })).status).toBe(404); // still pending
    await call({ action: 'admin-decide', id: a.id, approve: true }, ADMIN);
    expect((await call({ action: 'report', id: a.id, reason: 'not theirs' })).status).toBe(200);
    const q = await call({ action: 'admin-pending' }, ADMIN);
    expect(q.data.reported).toEqual([
      expect.objectContaining({
        upload: expect.objectContaining({ id: a.id }),
        reports: [expect.objectContaining({ reason: 'not theirs' })],
      }),
    ]);
    for (let i = 1; i < UP_REPORTS_PER_IP_HOUR; i++) await call({ action: 'report', id: a.id });
    expect((await call({ action: 'report', id: a.id })).status).toBe(429);
  });
});

describe('cc0-file', () => {
  beforeEach(() => blobs.clear());

  it('404s unknown and malformed ids', async () => {
    expect((await getFile('nope')).status).toBe(404);
    expect((await getFile('0123456789abcdef')).status).toBe(404);
  });

  it('parses byte ranges', () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange('bytes=0-1', 100)).toEqual([0, 1]);
    expect(parseRange('bytes=90-', 100)).toEqual([90, 99]);
    expect(parseRange('bytes=-10', 100)).toEqual([90, 99]);
    expect(parseRange('bytes=0-500', 100)).toEqual([0, 99]);
    expect(parseRange('bytes=200-', 100)).toBe('bad');
    expect(parseRange('items=1-2', 100)).toBe('bad');
  });
});
