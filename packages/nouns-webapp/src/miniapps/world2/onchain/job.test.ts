import type { Hex } from 'viem';

import { describe, expect, it } from 'vitest';

import { encodeStrokes, hash48 } from '../graffiti/strokes';

import { KIND } from './contract';
import { ledgerConfig, runSnapshot, WALLS_PER_READ, type LedgerWriter } from './job';
import { leafHash, proofFor, verifyProof } from './merkle';
import { checkManifest, type Manifest } from './snapshot';
import {
  arweavePathManifest,
  DryRunStorage,
  gatewayUrl,
  IrysStorage,
  PINATA_PIN_URL,
  PinataStorage,
  storageFromEnv,
  type IrysClient,
} from './storage';

const SITE = 'https://example.test';
const tag = (k: number) =>
  encodeStrokes({
    id: hash48(k.toString(16).padStart(16, '0')),
    strokes: [
      { color: 0x101010 * (k % 15), r: 20, hard: false, opacity: 16, pts: [k, 10, 500, 600] },
    ],
  });
const wallId = (i: number) => `plaza|0.00,0.00,1.00|-12.50|${i}|0`;

/** A fake noun.wtf: world-graffiti (plaza only) + world-stats. */
function fakeSite(nWalls = 3, opts: { bare?: boolean } = {}) {
  const calls: string[] = [];
  const walls: Record<string, { d: string; at: number }[]> = {};
  for (let i = 0; i < nWalls; i++) walls[wallId(i)] = [{ d: tag(i + 1), at: 1000 + i }];
  const stats = { riders: 2, sessions: 9, boards: { kmh: [{ name: 'zoom', value: 99, at: 123 }] } };
  const fetchFn = (async (input: string | URL) => {
    const url = new URL(String(input));
    calls.push(url.pathname + url.search);
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (url.pathname.endsWith('/world-stats')) return ok(stats);
    if (url.pathname.endsWith('/world-graffiti')) {
      const level = url.searchParams.get('level');
      const ids = url.searchParams.get('ids');
      if (ids === null) return ok({ walls: level === 'plaza' ? Object.keys(walls) : [] });
      const want = JSON.parse(ids) as string[];
      expect(want.length).toBeLessThanOrEqual(WALLS_PER_READ);
      const out: Record<string, unknown> = {};
      for (const id of want)
        if (id in walls)
          out[id] =
            opts.bare === true || url.searchParams.get('at') !== '1'
              ? walls[id].map(t => t.d)
              : walls[id];
      return ok({ walls: out });
    }
    return new Response('nope', { status: 404 });
  }) as typeof fetch;
  return { fetchFn, calls, walls, stats };
}

function fakeLedger(): LedgerWriter & { commits: { root: Hex; uri: string; kind: number }[] } {
  const commits: { root: Hex; uri: string; kind: number }[] = [];
  return {
    address: '0x0000000000000000000000000000000000000001',
    chainId: 84532,
    commits,
    async latestRoot(kind) {
      const mine = commits.filter(c => c.kind === kind);
      return mine.length ? mine[mine.length - 1].root : null;
    },
    async commit(root, uri, kind) {
      commits.push({ root, uri, kind });
      return `0x${'ab'.repeat(32)}` as Hex;
    },
  };
}

const now = new Date('2026-11-01T03:00:00Z');

describe('runSnapshot', () => {
  it('with no keys it is a dry run: builds both kinds, uploads nowhere, commits nothing', async () => {
    const site = fakeSite();
    const logs: string[] = [];
    const res = await runSnapshot({
      env: { SNAPSHOT_SITE: SITE },
      now,
      fetch: site.fetchFn,
      log: m => logs.push(m),
    });
    expect(res.map(r => [r.kind, r.status, r.count])).toEqual([
      ['graffiti', 'dry-run', 3],
      ['records', 'dry-run', 1],
    ]);
    expect(res[0].uri).toMatch(/^dryrun:\/\/[\da-f]{64}\/manifest\.json$/);
    expect(logs[0]).toContain('no commit (dry run)');
    // it read the world the way the game does, with stored times
    expect(site.calls.some(c => c.includes('at=1'))).toBe(true);
  });

  it('a dry run never commits, even with a ledger', async () => {
    const site = fakeSite();
    const ledger = fakeLedger();
    const res = await runSnapshot({
      env: { SNAPSHOT_SITE: SITE },
      now,
      fetch: site.fetchFn,
      storage: new DryRunStorage(),
      ledger,
    });
    expect(res.every(r => r.status === 'dry-run')).toBe(true);
    expect(ledger.commits).toHaveLength(0);
  });

  it('uploads, commits, and the committed root proves every uploaded piece', async () => {
    const site = fakeSite(WALLS_PER_READ + 5); // more walls than one read takes
    const ledger = fakeLedger();
    const storage = new DryRunStorage();
    // a "real" backend: same as dry run but reports itself as pinata
    const real = { name: 'pinata' as const, upload: storage.upload.bind(storage) };
    const res = await runSnapshot({
      env: { SNAPSHOT_SITE: SITE },
      now,
      fetch: site.fetchFn,
      storage: real,
      ledger,
    });
    expect(res.map(r => r.status)).toEqual(['committed', 'committed']);
    expect(ledger.commits.map(c => c.kind)).toEqual([KIND.graffiti, KIND.records]);

    const g = ledger.commits[0];
    const files = storage.uploads.get(g.uri.replace(/\/manifest\.json$/, ''))!;
    const man = JSON.parse(files.find(f => f.path === 'manifest.json')!.body) as Manifest;
    expect(man.count).toBe(WALLS_PER_READ + 5);
    const check = checkManifest(man, g.root);
    expect(check.ok).toBe(true);
    for (const l of man.leaves) {
      const h = leafHash(KIND.graffiti, l.key, l.content);
      expect(verifyProof(g.root, h, proofFor(check.tree!, h)!)).toBe(true);
      expect(files.some(f => f.path === l.file)).toBe(true);
    }
    const piece = JSON.parse(files.find(f => f.path === man.leaves[0].file)!.body);
    expect(piece.createdAt).toBeGreaterThanOrEqual(1000);
  });

  it('skips a kind whose root has not changed since its last version', async () => {
    const site = fakeSite();
    const ledger = fakeLedger();
    const dry = new DryRunStorage();
    const storage = { name: 'pinata' as const, upload: dry.upload.bind(dry) };
    await runSnapshot({ env: { SNAPSHOT_SITE: SITE }, now, fetch: site.fetchFn, storage, ledger });
    const again = await runSnapshot({
      env: { SNAPSHOT_SITE: SITE },
      now: new Date('2026-11-02'),
      fetch: site.fetchFn,
      storage,
      ledger,
    });
    expect(again.map(r => r.status)).toEqual(['unchanged', 'unchanged']);
    expect(ledger.commits).toHaveLength(2);

    // new paint → a new graffiti version only
    site.walls[wallId(99)] = [{ d: tag(99), at: 5 }];
    const third = await runSnapshot({
      env: { SNAPSHOT_SITE: SITE },
      now: new Date('2026-11-03'),
      fetch: site.fetchFn,
      storage,
      ledger,
    });
    expect(third.map(r => r.status)).toEqual(['committed', 'unchanged']);
  });

  it('reads an older world-graffiti that answers bare tag strings', async () => {
    const site = fakeSite(2, { bare: true });
    const res = await runSnapshot({
      env: { SNAPSHOT_SITE: SITE, SNAPSHOT_KINDS: 'graffiti' },
      now,
      fetch: site.fetchFn,
    });
    expect(res).toMatchObject([{ kind: 'graffiti', status: 'dry-run', count: 2 }]);
  });

  it('empty world: nothing to snapshot', async () => {
    const site = fakeSite(0);
    site.stats.boards = { kmh: [] };
    const res = await runSnapshot({ env: { SNAPSHOT_SITE: SITE }, now, fetch: site.fetchFn });
    expect(res.map(r => r.status)).toEqual(['empty', 'empty']);
  });
});

describe('ledger config', () => {
  it('defaults to Base Sepolia with no address or key', () => {
    expect(ledgerConfig({})).toMatchObject({
      chainId: 84532,
      address: null,
      key: null,
      rpc: 'https://sepolia.base.org',
    });
  });
  it('refuses other chains and malformed keys', () => {
    expect(() => ledgerConfig({ LEDGER_CHAIN_ID: '1' })).toThrow();
    expect(() => ledgerConfig({ LEDGER_COMMITTER_KEY: '0x1234' })).toThrow();
    expect(() => ledgerConfig({ LEDGER_ADDRESS: 'nope' })).toThrow();
  });
});

describe('storage', () => {
  const files = [
    { path: 'p/aa.json', body: '{"a":1}' },
    { path: 'manifest.json', body: '{"m":1}' },
  ];

  it('picks a backend from env', async () => {
    expect((await storageFromEnv({})).name).toBe('dryrun');
    expect((await storageFromEnv({ PINATA_JWT: 'x' })).name).toBe('pinata');
    await expect(storageFromEnv({ SNAPSHOT_STORAGE: 'pinata' })).rejects.toThrow();
    await expect(storageFromEnv({ SNAPSHOT_STORAGE: 'irys' })).rejects.toThrow();
    await expect(storageFromEnv({ SNAPSHOT_STORAGE: 's3' })).rejects.toThrow();
  });

  it('dry run is content-addressed', async () => {
    const s = new DryRunStorage();
    expect(await s.upload(files)).toBe(await s.upload([...files]));
    expect(await s.upload(files)).not.toBe(
      await s.upload([{ ...files[0], body: '{"a":2}' }, files[1]]),
    );
  });

  it('pinata pins one directory with the JWT and returns its CID', async () => {
    let sent: { url: string; init: RequestInit } | null = null;
    const cid = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';
    const fetchFn = (async (url: string, init: RequestInit) => {
      sent = { url, init };
      return new Response(JSON.stringify({ IpfsHash: cid }), { status: 200 });
    }) as unknown as typeof fetch;
    const uri = await new PinataStorage('jwt-123', fetchFn).upload(files, 'snap');
    expect(uri).toBe(`ipfs://${cid}`);
    expect(sent!.url).toBe(PINATA_PIN_URL);
    expect((sent!.init.headers as Record<string, string>).Authorization).toBe('Bearer jwt-123');
    const form = sent!.init.body as FormData;
    const names = form.getAll('file').map(f => (f as File).name);
    expect(names).toEqual(['snap/p/aa.json', 'snap/manifest.json']);
  });

  it('pinata errors surface', async () => {
    const fetchFn = (async () =>
      new Response('bad jwt', { status: 401 })) as unknown as typeof fetch;
    await expect(new PinataStorage('x', fetchFn).upload(files, 's')).rejects.toThrow(/401/);
  });

  it('irys uploads each file then a path manifest', async () => {
    const ups: { data: string; tags: { name: string; value: string }[] }[] = [];
    const client: IrysClient = {
      async upload(data, opts) {
        ups.push({ data, tags: opts.tags });
        return { id: `id${ups.length}` };
      },
    };
    const uri = await new IrysStorage(client).upload(files, 'snap');
    expect(uri).toBe('ar://id3');
    expect(JSON.parse(ups[2].data)).toEqual(
      arweavePathManifest({ 'p/aa.json': 'id1', 'manifest.json': 'id2' }, 'manifest.json'),
    );
    expect(ups[2].tags).toContainEqual({ name: 'Type', value: 'manifest' });
  });

  it('gateway urls', () => {
    expect(gatewayUrl('ipfs://bafy/manifest.json')).toBe('https://ipfs.io/ipfs/bafy/manifest.json');
    expect(gatewayUrl('ar://abc/manifest.json')).toBe('https://arweave.net/abc/manifest.json');
  });
});
