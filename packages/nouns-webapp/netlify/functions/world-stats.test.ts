import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MAX_APPEAL_CHARS, MAX_CLOSED_APPEALS, MAX_OPEN_APPEALS } from '../lib/appeals';
import { encodeTrace, PHYS } from '../lib/runProof';

// ── An in-memory Netlify Blobs store (etags and all) ──
const blobs = new Map<string, { v: string; etag: string }>();
let etags = 0;
const store = {
  async get(k: string, o?: { type?: string }) {
    const b = blobs.get(k);
    if (!b) return null;
    return o?.type === 'json' ? JSON.parse(b.v) : b.v;
  },
  async getWithMetadata(k: string) {
    const b = blobs.get(k);
    return b ? { data: JSON.parse(b.v), etag: b.etag } : null;
  },
  async setJSON(k: string, v: unknown, o: { onlyIfMatch?: string; onlyIfNew?: boolean } = {}) {
    const b = blobs.get(k);
    if (o.onlyIfNew && b) return { modified: false };
    if (o.onlyIfMatch && b?.etag !== o.onlyIfMatch) return { modified: false };
    blobs.set(k, { v: JSON.stringify(v), etag: `e${++etags}` });
    return { modified: true };
  },
  async set(k: string, v: string) {
    blobs.set(k, { v, etag: `e${++etags}` });
  },
  async delete(k: string) {
    blobs.delete(k);
  },
};
vi.mock('@netlify/blobs', () => ({ connectLambda: () => undefined, getStore: () => store }));

const { handler } = await import('./world-stats');

const TOKEN = 'test-admin-token-0123456789';

async function call(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const res = await handler({ httpMethod: 'POST', body: JSON.stringify(body), headers });
  return { status: res.statusCode, out: JSON.parse(res.body) };
}
const admin = (body: Record<string, unknown>, token = TOKEN) =>
  call(body, { 'x-world-admin': token });
async function board(k: string) {
  const res = await handler({ httpMethod: 'GET', body: null });
  return JSON.parse(res.body).boards[k] as { name: string; value: number }[];
}

/** An honest ride: rolling down from `h` m in the plaza, sampled every 0.4 s. */
function ride(h = 60) {
  const rows: number[][] = [];
  for (let k = 0; k <= 40; k++) {
    const y = h * (1 - k / 40);
    rows.push([k * 0.4, k * 3, y, 0, Math.sqrt(2 * PHYS.g * (h - y)) * 0.98, 0]);
  }
  const s = Float32Array.from(rows.flat());
  return { d: encodeTrace(s), kmh: Math.floor(s[40 * 6 + 4] * 36) / 10 };
}

beforeEach(() => {
  blobs.clear();
  vi.stubEnv('WORLD_ADMIN_TOKEN', TOKEN);
});
afterEach(() => vi.unstubAllEnvs());

describe('world-stats: refusals say why', () => {
  it('a claim with no proof, and one whose proof was too big, are told apart', async () => {
    const bare = await call({ rider: 'r1', name: 'A', best: { kmh: 900 } });
    expect(bare.out.rejected.kmh).toBe('no proof sent with the claim');
    const big = await call({
      rider: 'r1',
      name: 'A',
      best: { kmh: 900 },
      proofs: [{ keys: ['kmh'], d: 'A'.repeat(2_000_004) }],
    });
    expect(big.out.rejected.kmh).toMatch(/^proof too big/);
    const { d, kmh } = ride();
    const ok = await call({
      rider: 'r1',
      name: 'A',
      best: { kmh },
      proofs: [{ keys: ['kmh'], d }],
    });
    expect(ok.out.rejected).toBeUndefined();
    expect(ok.out.you.best.kmh).toBe(kmh);
  });
});

describe('world-stats: appeals', () => {
  const { d, kmh } = ride();

  it('validates: a proved record, a sane value, a trace of bounded size', async () => {
    const base = { action: 'appeal', rider: 'r1', name: 'A', value: 900, d };
    expect((await call({ ...base, key: 'combo' })).status).toBe(400);
    expect((await call({ ...base, key: 'kmh', value: 50_000 })).status).toBe(400);
    expect((await call({ ...base, key: 'kmh', d: '' })).status).toBe(400);
    const big = await call({ ...base, key: 'kmh', d: 'A'.repeat(MAX_APPEAL_CHARS + 4) });
    expect(big.status).toBe(400);
    expect(big.out.error).toMatch(/Trace too big/);
  });

  it('a claim its ride does prove goes straight on the board', async () => {
    const r = await call({ action: 'appeal', rider: 'r1', name: 'A', key: 'kmh', value: kmh, d });
    expect(r.out).toMatchObject({ ok: true, saved: true });
    expect((await board('kmh'))[0]).toMatchObject({ name: 'A', value: kmh });
  });

  it('one open appeal per rider per record (a new one replaces it), with a cap on all open ones', async () => {
    const a1 = await call({ action: 'appeal', rider: 'r1', name: 'A', key: 'kmh', value: 900, d });
    expect(a1.out.appeal).toMatchObject({ status: 'pending', key: 'kmh', value: 900 });
    expect(a1.out.reason).toBe('beyond its proof');
    const a2 = await call({ action: 'appeal', rider: 'r1', name: 'A', key: 'kmh', value: 901, d });
    expect(a2.out.appeal.id).toBe(a1.out.appeal.id);
    const mine = await call({ action: 'appeals', rider: 'r1' });
    expect(mine.out.appeals).toHaveLength(1);
    expect(mine.out.appeals[0]).toMatchObject({ value: 901, status: 'pending' });
    expect(mine.out.appeals[0].d).toBeUndefined();

    for (let i = 1; i < MAX_OPEN_APPEALS; i++) {
      const r = await call({
        action: 'appeal',
        rider: `x${i}`,
        name: 'X',
        key: 'airS',
        value: 9,
        d,
      });
      expect(r.status).toBe(200);
    }
    const full = await call({
      action: 'appeal',
      rider: 'late',
      name: 'L',
      key: 'airS',
      value: 9,
      d,
    });
    expect(full.status).toBe(429);
    // …but an open one can still be replaced
    expect(
      (await call({ action: 'appeal', rider: 'r1', name: 'A', key: 'kmh', value: 902, d })).status,
    ).toBe(200);
  });

  it('admin needs WORLD_ADMIN_TOKEN: off without it, refused with a wrong one', async () => {
    vi.stubEnv('WORLD_ADMIN_TOKEN', '');
    expect((await admin({ action: 'admin-appeals' })).status).toBe(503);
    vi.stubEnv('WORLD_ADMIN_TOKEN', TOKEN);
    expect((await admin({ action: 'admin-appeals' }, 'nope')).status).toBe(401);
    expect((await call({ action: 'admin-appeals' })).status).toBe(401);
    expect((await admin({ action: 'admin-appeals' })).status).toBe(200);
  });

  it('approve puts the record on the board; reject closes it with a note the rider sees', async () => {
    await call({ rider: 'r1', name: 'A', best: { kmh }, proofs: [{ keys: ['kmh'], d }] });
    const a = (await call({ action: 'appeal', rider: 'r1', name: 'A', key: 'kmh', value: 900, d }))
      .out.appeal;
    const b = (await call({ action: 'appeal', rider: 'r2', name: 'B', key: 'airS', value: 10, d }))
      .out.appeal;

    const list = (await admin({ action: 'admin-appeals' })).out.appeals;
    expect(list.map((x: { id: string }) => x.id).sort()).toEqual([a.id, b.id].sort());
    const tr = await admin({ action: 'admin-appeal', id: a.id });
    expect(tr.out.d).toBe(d);

    const yes = await admin({ action: 'admin-decide', id: a.id, decision: 'approve' });
    expect(yes.out.appeal.status).toBe('approved');
    expect((await board('kmh'))[0]).toMatchObject({ name: 'A', value: 900 });
    // Decided once only
    expect((await admin({ action: 'admin-decide', id: a.id, decision: 'reject' })).status).toBe(
      409,
    );

    const no = await admin({
      action: 'admin-decide',
      id: b.id,
      decision: 'reject',
      note: 'clipped through a wall',
    });
    expect(no.out.appeal).toMatchObject({ status: 'rejected', note: 'clipped through a wall' });
    expect((await board('airS')) ?? []).toHaveLength(0);
    const seen = (await call({ action: 'appeals', rider: 'r2' })).out.appeals[0];
    expect(seen).toMatchObject({ status: 'rejected', note: 'clipped through a wall' });
  });

  it('closed appeals are capped, and their traces go with them', async () => {
    for (let i = 0; i < MAX_CLOSED_APPEALS + 3; i++) {
      const a = (
        await call({ action: 'appeal', rider: `c${i}`, name: 'C', key: 'airM', value: 50, d })
      ).out.appeal;
      await admin({ action: 'admin-decide', id: a.id, decision: 'reject' });
    }
    const list = (await admin({ action: 'admin-appeals' })).out.appeals;
    expect(list).toHaveLength(MAX_CLOSED_APPEALS);
    const traces = [...blobs.keys()].filter(k => k.startsWith('appeal-trace/'));
    expect(traces).toHaveLength(MAX_CLOSED_APPEALS);
  });
});

describe('world-stats: missions', () => {
  const T = Date.UTC(2026, 9, 1);

  it('keeps valid missions, drops junk, answers with them, and never removes any', async () => {
    const r = await call({
      rider: 'm1',
      name: 'M',
      missions: { 'wake-up': T, 'leave-a-mark': T + 1, 'made-up': T, 'paint-it-red': 'x' },
    });
    expect(r.out.you.missions).toEqual({ 'wake-up': T, 'leave-a-mark': T + 1 });
    const again = await call({ rider: 'm1', name: 'M', missions: {} });
    expect(again.out.you.missions).toEqual({ 'wake-up': T, 'leave-a-mark': T + 1 });
  });

  it('a record mission only lands when the row holds the record (its proof accepted)', async () => {
    const chain = { 'wake-up': T, 'free-your-mind': T, 'deja-vu': T, 'the-one': T };
    // Claimed without the records: only the starter sticks
    const bare = await call({ rider: 'm2', name: 'M', missions: chain });
    expect(Object.keys(bare.out.you.missions)).toEqual(['wake-up']);
    // A refused speed claim doesn't open a speed mission either
    const fake = await call({ rider: 'm2', name: 'M', best: { kmh: 12_000 }, missions: chain });
    expect(fake.out.rejected.kmh).toBeDefined();
    expect(Object.keys(fake.out.you.missions)).toEqual(['wake-up']);
  });

  it('a title must be a finished mission; boards show it', async () => {
    const { d, kmh } = ride();
    const early = await call({
      rider: 'm3',
      name: 'Neo',
      missions: { 'wake-up': T },
      title: 'the-one',
    });
    expect(early.out.you.title).toBeNull();
    const r = await call({
      rider: 'm3',
      name: 'Neo',
      best: { kmh },
      proofs: [{ keys: ['kmh'], d }],
      title: 'wake-up',
    });
    expect(r.out.you.title).toBe('wake-up');
    expect((await board('kmh')).find(x => x.name === 'Neo')).toMatchObject({ title: 'Awake' });
    const off = await call({ rider: 'm3', name: 'Neo', title: null });
    expect(off.out.you.title).toBeNull();
  });
});
