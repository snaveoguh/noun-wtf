import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory Netlify Blobs
const blobs = new Map<string, string>();
const store = {
  async get(k: string, o?: { type?: string }) {
    const v = blobs.get(k);
    if (v === undefined) return null;
    return o?.type === 'json' ? JSON.parse(v) : v;
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

const { handler, voiceTag, VOICE_UPLOADS_PER_TAG_HOUR, VOICE_REPORTS_PER_IP_HOUR } = await import(
  '../functions/world-voice'
);

const TOKEN = 'a-very-long-admin-token-123';
const RIDER = '0b7c6a1e-5d1f-4c62-9a43-2d3f0e8b9c11';
const TAG = voiceTag(RIDER);
const IP = { 'x-nf-client-connection-ip': '1.2.3.4' };
const webm = (n = 200) => {
  const b = Buffer.alloc(n, 7);
  b.set([0x1a, 0x45, 0xdf, 0xa3]);
  return b.toString('base64');
};
const upload = (extra: Record<string, unknown> = {}) => ({
  action: 'upload',
  rider: RIDER,
  key: 'bail.0',
  mime: 'audio/webm;codecs=opus',
  t0: 0.1,
  t1: 1.1,
  gain: 1.5,
  dur: 1.4,
  data: webm(),
  ...extra,
});

const call = (
  httpMethod: string,
  body?: unknown,
  headers: Record<string, string> = IP,
  query?: Record<string, string>,
) =>
  handler({
    httpMethod,
    body: body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body),
    headers,
    queryStringParameters: query,
  });
const data = async (p: ReturnType<typeof call>) => {
  const r = await p;
  return { status: r.statusCode, data: JSON.parse(r.body) as Record<string, any>, raw: r };
};

describe('world-voice', () => {
  beforeEach(() => {
    blobs.clear();
    process.env.WORLD_ADMIN_TOKEN = TOKEN;
  });

  it('the public tag hides the rider id', () => {
    expect(TAG).toMatch(/^[\da-f]{24}$/);
    expect(TAG).not.toContain(RIDER.slice(0, 8));
    expect(voiceTag(RIDER)).toBe(TAG);
  });

  it('uploads a clip; the manifest and the bytes are served, cacheable', async () => {
    const r = await data(call('POST', upload()));
    expect(r.status).toBe(200);
    expect(r.data.tag).toBe(TAG);
    const v = r.data.clip.v as number;
    const m = await data(call('GET', undefined, IP, { tag: TAG }));
    expect(m.status).toBe(200);
    expect(Object.keys(m.data.clips)).toEqual(['bail.0']);
    expect(m.data.clips['bail.0']).toMatchObject({ mime: 'audio/webm', t0: 0.1, gain: 1.5 });
    expect(m.raw.headers['Cache-Control']).toContain('max-age=60');
    const clip = await call('GET', undefined, IP, { tag: TAG, key: 'bail.0', v: String(v) });
    expect(clip.statusCode).toBe(200);
    expect(clip.isBase64Encoded).toBe(true);
    expect(clip.body).toBe(webm());
    expect(clip.headers['Content-Type']).toBe('audio/webm');
    expect(clip.headers['Cache-Control']).toContain('immutable');
    // Never the rider id in storage
    expect([...blobs.keys()].join(' ')).not.toContain(RIDER);
  });

  it('refuses bad uploads', async () => {
    const cases: Record<string, unknown>[] = [
      { key: 'bail.99' },
      { key: '../m/x' },
      { mime: 'audio/wav' },
      { mime: 'text/html' },
      { dur: 12 },
      { data: 'not base64!!' },
      { data: Buffer.from('<html>hello world</html>').toString('base64') }, // wrong magic
      { mime: 'audio/mp4' }, // webm bytes labelled mp4
      { rider: 'x' },
    ];
    for (const c of cases) expect((await data(call('POST', upload(c)))).status).toBe(400);
    // Over 64 KB of audio
    expect((await data(call('POST', upload({ data: webm(70_000) })))).status).toBe(413);
    expect((await data(call('POST', 'nope'))).status).toBe(400);
    expect([...blobs.keys()].filter(k => !k.startsWith('rl/'))).toEqual([]);
  });

  it('caps clips per player and rate limits uploads', async () => {
    for (let i = 0; i < VOICE_UPLOADS_PER_TAG_HOUR; i++)
      expect((await data(call('POST', upload()))).status).toBe(200);
    expect((await data(call('POST', upload()))).status).toBe(429);
  });

  it('deletes own clips', async () => {
    await call('POST', upload());
    await call('POST', upload({ key: 'speed.1' }));
    expect(
      (await data(call('POST', { action: 'delete', rider: RIDER, key: 'bail.0' }))).status,
    ).toBe(200);
    let m = await data(call('GET', undefined, IP, { tag: TAG }));
    expect(Object.keys(m.data.clips)).toEqual(['speed.1']);
    await call('POST', { action: 'delete', rider: RIDER });
    m = await data(call('GET', undefined, IP, { tag: TAG }));
    expect(m.data.clips).toEqual({});
    expect([...blobs.keys()].some(k => k.startsWith('c/'))).toBe(false);
  });

  it('reports are stored (no raw IP) and rate limited', async () => {
    await call('POST', upload());
    const r = await data(
      call('POST', { action: 'report', tag: TAG, key: 'bail.0', reason: 'slur' }),
    );
    expect(r.status).toBe(200);
    const rep = [...blobs.entries()].find(([k]) => k.startsWith(`r/${TAG}/`))!;
    expect(rep[1]).not.toContain('1.2.3.4');
    expect((await data(call('POST', { action: 'report', tag: 'zz' }))).status).toBe(400);
    for (let i = 1; i < VOICE_REPORTS_PER_IP_HOUR; i++)
      await call('POST', { action: 'report', tag: TAG });
    expect((await data(call('POST', { action: 'report', tag: TAG }))).status).toBe(429);
  });

  it('admin actions need the token', async () => {
    for (const action of ['admin-reports', 'admin-hide', 'admin-delete']) {
      expect((await data(call('POST', { action, tag: TAG }))).status).toBe(401);
      expect(
        (await data(call('POST', { action, tag: TAG }, { 'x-world-admin': 'no' }))).status,
      ).toBe(401);
    }
  });

  it('chat clips: uploaded, served for 10 minutes, then gone', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-23T12:00:00Z'));
      const chat = {
        action: 'chat-upload',
        rider: RIDER,
        mime: 'audio/webm',
        dur: 3,
        text: 'yo',
        data: webm(),
      };
      const r = await data(call('POST', chat));
      expect(r.status).toBe(200);
      expect(r.data.id).toMatch(/^[\da-f]{16}$/);
      const get = () => call('GET', undefined, IP, { tag: TAG, chat: r.data.id });
      expect((await get()).statusCode).toBe(200);
      expect((await get()).body).toBe(webm());
      // One per 5 s
      expect((await data(call('POST', chat))).status).toBe(429);
      vi.setSystemTime(new Date('2026-10-23T12:00:06Z'));
      expect((await data(call('POST', chat))).status).toBe(200);
      // Bad ones
      for (const bad of [
        { dur: 20 },
        { text: '' },
        { text: 'x'.repeat(200) },
        { mime: 'audio/wav' },
      ])
        expect((await data(call('POST', { ...chat, ...bad }))).status).toBe(400);
      // Reports keep the text
      await call('POST', { action: 'report', tag: TAG, chat: r.data.id });
      const rep = [...blobs.entries()].find(([k]) => k.startsWith(`r/${TAG}/`))!;
      expect(JSON.parse(rep[1])).toMatchObject({ chat: r.data.id, text: 'yo' });
      // Expired
      vi.setSystemTime(new Date('2026-10-23T12:11:00Z'));
      expect((await get()).statusCode).toBe(404);
    } finally {
      vi.useRealTimers();
    }
  });

  it('hidden clips and hidden players are never served', async () => {
    const up = await data(call('POST', upload()));
    await call('POST', upload({ key: 'speed.1' }));
    await call('POST', { action: 'report', tag: TAG, key: 'bail.0' });
    const admin = { 'x-world-admin': TOKEN };
    const list = await data(call('POST', { action: 'admin-reports' }, admin));
    expect(list.data.reported).toHaveLength(1);
    expect(list.data.reported[0].tag).toBe(TAG);

    await call('POST', { action: 'admin-hide', tag: TAG, key: 'bail.0', hidden: true }, admin);
    let m = await data(call('GET', undefined, IP, { tag: TAG }));
    expect(Object.keys(m.data.clips)).toEqual(['speed.1']);
    const v = String(up.data.clip.v);
    expect((await call('GET', undefined, IP, { tag: TAG, key: 'bail.0', v })).statusCode).toBe(404);
    // Re-recording doesn't unhide it
    await call('POST', upload());
    m = await data(call('GET', undefined, IP, { tag: TAG }));
    expect(Object.keys(m.data.clips)).toEqual(['speed.1']);

    // The whole player
    await call('POST', { action: 'admin-hide', tag: TAG, hidden: true }, admin);
    m = await data(call('GET', undefined, IP, { tag: TAG }));
    expect(m.data.clips).toEqual({});
    expect((await data(call('POST', upload({ key: 'record.1' })))).status).toBe(403);
    await call('POST', { action: 'admin-hide', tag: TAG, hidden: false }, admin);
    m = await data(call('GET', undefined, IP, { tag: TAG }));
    expect(Object.keys(m.data.clips)).toEqual(['speed.1']);

    // Delete wipes clips and reports
    await call('POST', { action: 'admin-delete', tag: TAG }, admin);
    expect([...blobs.keys()].some(k => k.startsWith('c/') || k.startsWith('r/'))).toBe(false);
    m = await data(call('GET', undefined, IP, { tag: TAG }));
    expect(m.data.clips).toEqual({});
  });
});
