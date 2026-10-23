import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory Netlify Blobs (consistent: this function never races itself)
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

const { handler, SUB_PER_IP_HOUR } = await import('../functions/community-submissions');

const TOKEN = 'a-very-long-admin-token-123';
const good = {
  name: 'Noun Kart',
  url: 'https://nounkart.xyz/',
  blurb: 'kart racing with noggles',
  kind: 'game',
};

const call = (
  httpMethod: string,
  body?: unknown,
  headers: Record<string, string> = { 'x-nf-client-connection-ip': '1.2.3.4' },
) =>
  handler({ httpMethod, body: body === undefined ? null : JSON.stringify(body), headers }).then(
    r => ({ status: r.statusCode, data: JSON.parse(r.body) as Record<string, unknown> }),
  );

describe('community-submissions', () => {
  beforeEach(() => {
    blobs.clear();
    process.env.WORLD_ADMIN_TOKEN = TOKEN;
  });

  it('queues a valid submission as pending; GET shows only approved', async () => {
    const r = await call('POST', good);
    expect(r.status).toBe(200);
    expect(r.data.ok).toBe(true);
    expect(Array.from(blobs.keys()).some(k => k.startsWith('p/'))).toBe(true);
    const list = await call('GET');
    expect(list.data.entries).toEqual([]);
  });

  it('never stores the raw IP', async () => {
    await call('POST', good);
    const raw = Array.from(blobs.entries()).find(([k]) => k.startsWith('p/'))![1];
    expect(raw).not.toContain('1.2.3.4');
  });

  it('rejects bad submissions', async () => {
    for (const bad of [
      { ...good, url: 'http://nounkart.xyz' },
      { ...good, url: 'javascript:alert(1)' },
      { ...good, name: '' },
      { ...good, kind: 'casino' },
    ]) {
      const r = await call('POST', bad);
      expect(r.status).toBe(400);
    }
    expect((await call('POST', 'x'.repeat(5000))).status).toBe(413);
    expect(blobs.size).toBe(0);
  });

  it('rate limits per IP', async () => {
    for (let i = 0; i < SUB_PER_IP_HOUR; i++) expect((await call('POST', good)).status).toBe(200);
    expect((await call('POST', good)).status).toBe(429);
    const other = await call('POST', good, { 'x-nf-client-connection-ip': '5.6.7.8' });
    expect(other.status).toBe(200);
  });

  it('admin actions need the token', async () => {
    expect((await call('POST', { action: 'admin-pending' })).status).toBe(401);
    const wrong = { 'x-world-admin': 'nope' };
    expect((await call('POST', { action: 'admin-pending' }, wrong)).status).toBe(401);
  });

  it('admin can list, approve and reject', async () => {
    const a = await call('POST', good);
    const b = await call('POST', { ...good, name: 'Spam Thing' });
    const admin = { 'x-world-admin': TOKEN };
    const pending = await call('POST', { action: 'admin-pending' }, admin);
    expect((pending.data.pending as unknown[]).length).toBe(2);

    expect(
      (await call('POST', { action: 'admin-decide', id: a.data.id, approve: true }, admin)).status,
    ).toBe(200);
    expect(
      (await call('POST', { action: 'admin-decide', id: b.data.id, approve: false }, admin)).status,
    ).toBe(200);
    expect(
      (await call('POST', { action: 'admin-decide', id: 'zz', approve: true }, admin)).status,
    ).toBe(400);

    const list = await call('GET');
    expect(list.data.entries).toEqual([expect.objectContaining({ ...good, id: a.data.id })]);
    const left = await call('POST', { action: 'admin-pending' }, admin);
    expect(left.data.pending).toEqual([]);
  });
});
