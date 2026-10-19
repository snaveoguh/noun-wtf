import type { TradeState } from '../../src/miniapps/world2/trade/contract';

import { encodeAbiParameters, encodeEventTopics, type Address, type Hex } from 'viem';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { NOUN_TRADE_GOODS_ABI, riderTag } from '../../src/miniapps/world2/trade/onchain/tokens';

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
  async delete(k: string) {
    blobs.delete(k);
  },
};
vi.mock('@netlify/blobs', () => ({ getStore: () => store }));

const { makeHandler } = await import('../functions/world-trade-deposit');
const { blobLedger } = await import('./tradeClaim');

const GOODS: Address = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const PLAYER: Address = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';
const TX = `0x${'ab'.repeat(32)}` as Hex;

function depositLog(
  rider: string,
  ids: bigint[],
  amounts: bigint[],
  coin: bigint,
  logIndex = 0,
  address = GOODS,
) {
  return {
    address,
    logIndex,
    topics: encodeEventTopics({
      abi: NOUN_TRADE_GOODS_ABI,
      eventName: 'Deposited',
      args: { player: PLAYER, account: riderTag(rider), depositId: 1n },
    }) as Hex[],
    data: encodeAbiParameters(
      [{ type: 'uint256[]' }, { type: 'uint256[]' }, { type: 'uint256' }],
      [ids, amounts, coin],
    ),
  };
}

let receipt: Awaited<ReturnType<typeof chain.receipt>> = null;
let head = 100n;
const chain = {
  nonceStatus: vi.fn(),
  receipt: vi.fn(
    async (): Promise<{
      status: 'success' | 'reverted';
      blockNumber: bigint;
      to: Address | null;
      logs: { address: Address; topics: Hex[]; data: Hex; logIndex: number | null }[];
    } | null> => receipt,
  ),
  head: vi.fn(async () => head),
};
const cfg = { enabled: true, chainId: 84532, goods: GOODS, rpc: 'x', ttlS: 1800, confirmations: 3 };
const handler = makeHandler({ store, chain, cfg, ledger: blobLedger(store) });

async function call(body: Record<string, unknown>) {
  const res = await handler({ httpMethod: 'POST', body: JSON.stringify(body) });
  return { status: res.statusCode, out: JSON.parse(res.body) };
}
const ledger = async (rider: string) =>
  ((await store.get(`ledger/${rider}`, { type: 'json' })) as { state: TradeState } | null)?.state;

beforeEach(() => {
  blobs.clear();
  head = 100n;
  receipt = null;
});

describe('world-trade-deposit', () => {
  it('credits a confirmed deposit once, idempotent by tx hash', async () => {
    receipt = {
      status: 'success',
      blockNumber: 98n,
      to: GOODS,
      logs: [depositLog('rider-a', [1n, 7n], [3n, 2n], 25n, 4)],
    };
    let r = await call({ rider: 'rider-a', tx: TX });
    expect(r.status).toBe(200);
    expect(r.out).toMatchObject({
      ok: true,
      already: false,
      credited: { goods: { ICECREAM: 3, WATER: 2 }, coin: 25 },
    });
    expect(await ledger('rider-a')).toMatchObject({ coin: 25, cargo: { ICECREAM: 3, WATER: 2 } });

    r = await call({ rider: 'rider-a', tx: TX.toUpperCase().replace('0X', '0x') });
    expect(r.out).toMatchObject({ ok: true, already: true });
    expect(await ledger('rider-a')).toMatchObject({ coin: 25, cargo: { ICECREAM: 3, WATER: 2 } });
  });

  it('two concurrent posts of the same tx credit once', async () => {
    receipt = {
      status: 'success',
      blockNumber: 90n,
      to: GOODS,
      logs: [depositLog('rider-b', [3n], [5n], 0n)],
    };
    await Promise.all([call({ rider: 'rider-b', tx: TX }), call({ rider: 'rider-b', tx: TX })]);
    expect(await ledger('rider-b')).toMatchObject({ cargo: { FISH: 5 } });
  });

  it('waits for confirmations and for the tx to be mined', async () => {
    let r = await call({ rider: 'rider-c', tx: TX });
    expect(r.status).toBe(404);
    receipt = {
      status: 'success',
      blockNumber: 99n,
      to: GOODS,
      logs: [depositLog('rider-c', [2n], [1n], 0n)],
    };
    r = await call({ rider: 'rider-c', tx: TX });
    expect(r.status).toBe(202);
    expect(r.out.retry).toBe(true);
    head = 101n;
    r = await call({ rider: 'rider-c', tx: TX });
    expect(r.status).toBe(200);
  });

  it("refuses failed txs, other riders' deposits, foreign contracts, and junk", async () => {
    receipt = { status: 'reverted', blockNumber: 1n, to: GOODS, logs: [] };
    expect((await call({ rider: 'x', tx: TX })).status).toBe(400);

    receipt = {
      status: 'success',
      blockNumber: 1n,
      to: GOODS,
      logs: [depositLog('someone-else', [1n], [1n], 0n)],
    };
    let r = await call({ rider: 'thief', tx: TX });
    expect(r.status).toBe(403);
    expect(await ledger('thief')).toBeUndefined();

    // a look-alike event from another contract is ignored
    const fake = '0x0000000000000000000000000000000000000bad' as Address;
    receipt = {
      status: 'success',
      blockNumber: 1n,
      to: fake,
      logs: [depositLog('thief', [1n], [999n], 0n, 0, fake)],
    };
    r = await call({ rider: 'thief', tx: TX });
    expect(r.status).toBe(400);
    expect(await ledger('thief')).toBeUndefined();

    expect((await call({ rider: 'x', tx: '0x1234' })).status).toBe(400);
    expect((await call({ tx: TX })).status).toBe(400);
  });

  it('a tx carrying deposits for two riders credits each of them once', async () => {
    receipt = {
      status: 'success',
      blockNumber: 1n,
      to: GOODS,
      logs: [depositLog('rider-d', [6n], [1n], 0n, 0), depositLog('rider-e', [6n], [1n], 0n, 1)],
    };
    expect((await call({ rider: 'rider-d', tx: TX })).status).toBe(200);
    expect((await call({ rider: 'rider-e', tx: TX })).status).toBe(200);
    expect((await call({ rider: 'rider-d', tx: TX })).out.already).toBe(true);
    expect(await ledger('rider-d')).toMatchObject({ cargo: { PIZZA: 1 } });
    expect(await ledger('rider-e')).toMatchObject({ cargo: { PIZZA: 1 } });
  });

  it('reports unknown (future) ids without crediting them', async () => {
    receipt = {
      status: 'success',
      blockNumber: 1n,
      to: GOODS,
      logs: [depositLog('rider-f', [5n, 42n], [1n, 9n], 0n)],
    };
    const r = await call({ rider: 'rider-f', tx: TX });
    expect(r.out).toMatchObject({ credited: { goods: { NOGGLES: 1 } }, unknownIds: ['42'] });
  });
});
