import type { Address } from 'viem';

import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { audit, RULES, type TradeRow } from '../../src/miniapps/world2/trade/ledger';
import { NONCE_UNUSED } from '../../src/miniapps/world2/trade/onchain/tokens';

// Cash-outs and deposits move the SAME books world-trade keeps (rider/<id> in
// noun-world-trade), so what you earn driving around is what you can claim.

const blobs = new Map<string, { v: string; etag: string }>();
let etags = 0;
const opened: unknown[] = [];
const tick = () => Promise.resolve();
const store = {
  async get(k: string, o?: { type?: string }) {
    await tick();
    const b = blobs.get(k);
    if (b === undefined) return null;
    return o?.type === 'json' ? JSON.parse(b.v) : b.v;
  },
  async getWithMetadata(k: string) {
    await tick();
    const b = blobs.get(k);
    return b !== undefined ? { data: JSON.parse(b.v), etag: b.etag } : null;
  },
  async setJSON(k: string, v: unknown, o: { onlyIfMatch?: string; onlyIfNew?: boolean } = {}) {
    await tick();
    const b = blobs.get(k);
    if (
      (o.onlyIfNew === true && b !== undefined) ||
      (o.onlyIfMatch !== undefined && b?.etag !== o.onlyIfMatch)
    )
      return { modified: false };
    blobs.set(k, { v: JSON.stringify(v), etag: `e${++etags}` });
    return { modified: true };
  },
  async delete(k: string) {
    blobs.delete(k);
  },
};
vi.mock('@netlify/blobs', () => ({
  getStore: (opts: unknown) => {
    opened.push(opts);
    return store;
  },
}));

const { handleTrade } = await import('../functions/world-trade');
const { makeHandler } = await import('../functions/world-trade-claim');
const { rowLedger } = await import('./tradeLedger');
const { signerFromKey } = await import('./tradeOnchain');

const RIDER = '0f8e0c1a-3333-4aaa-8bbb-000000000003';
const PLAYER: Address = privateKeyToAccount(generatePrivateKey()).address;
const T0 = Date.UTC(2026, 9, 19, 12);
const row = () => JSON.parse(blobs.get(`rider/${RIDER}`)!.v) as TradeRow;

async function trade(action: unknown) {
  const res = await handleTrade(
    store as never,
    'POST',
    {},
    JSON.stringify({ rider: RIDER, action }),
  );
  return JSON.parse(res.body);
}

const claimHandler = makeHandler({
  chain: {
    nonceStatus: async () => ({ state: NONCE_UNUSED, blockTime: Math.floor(T0 / 1000) }),
    receipt: async () => null,
    head: async () => 0n,
  },
  cfg: {
    enabled: true,
    chainId: 8453,
    goods: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
    rpc: 'http://unused',
    ttlS: 1800,
    confirmations: 3,
  },
  signer: signerFromKey(generatePrivateKey()),
  now: () => T0,
  randomNonce: () => 42n,
});
async function claim(goods: Record<string, number>, coin: number) {
  const res = await claimHandler({
    httpMethod: 'POST',
    body: JSON.stringify({ action: 'claim', rider: RIDER, address: PLAYER, goods, coin }),
  });
  return { status: res.statusCode, out: JSON.parse(res.body) };
}

beforeEach(() => {
  blobs.clear();
  opened.length = 0;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
});

describe('cash-out debits the game books', () => {
  it('opens both stores with strong consistency', async () => {
    await claim({ FISH: 1 }, 0);
    expect(opened).toContainEqual({ name: 'noun-world-trade', consistency: 'strong' });
    expect(opened).toContainEqual({ name: 'noun-world-trade-onchain', consistency: 'strong' });
  });

  it('goods bought in town and coin earned selling can be claimed; the starter purse cannot', async () => {
    expect((await trade({ t: 'buy', town: 'beach', good: 'FISH', qty: 4 })).ok).toBe(true);
    vi.setSystemTime(T0 + 2000);
    expect((await trade({ t: 'sell', town: 'beach', good: 'FISH', qty: 1 })).ok).toBe(true);
    const before = row();
    // Everything left is starter coin (bought with it, sold back at a loss)
    expect(before.coin).toBeLessThan(RULES.STARTER_COIN);
    const coinTry = await claim({}, 1);
    expect(coinTry.status).toBe(400);
    expect(coinTry.out.error).toMatch(/starter/);

    const ok = await claim({ FISH: 3 }, 0);
    expect(ok.status).toBe(200);
    expect(ok.out.claim.voucher.ids).toEqual(['3']);
    const after = row();
    expect(after.held.FISH ?? 0).toBe(0);
    expect(after.coin).toBe(before.coin);
    expect(audit(after)).toBe(true);
    // the HUD's next GET shows the same books
    const g = await handleTrade(store as never, 'GET', { rider: RIDER }, null);
    expect(JSON.parse(g.body).state.cargo).toEqual({});
  });

  it('ice cream never becomes a token', async () => {
    await trade({ t: 'buy', town: 'city', good: 'ICECREAM', qty: 2 });
    const r = await claim({ ICECREAM: 1 }, 0);
    expect(r.status).toBe(400);
    expect(r.out.error).toMatch(/melts/);
  });

  it('a deposit credit lands in the same row, once', async () => {
    const port = rowLedger(store);
    const a = await port.credit(RIDER, { goods: { PIZZA: 2 }, coin: 60 }, 'deposit:0xabc');
    const b = await port.credit(RIDER, { goods: { PIZZA: 2 }, coin: 60 }, 'deposit:0xabc');
    expect(a).toMatchObject({ ok: true, applied: true });
    expect(b).toMatchObject({ ok: true, applied: false });
    expect(row()).toMatchObject({ coin: RULES.STARTER_COIN + 60, held: { PIZZA: 2 } });
    expect(audit(row())).toBe(true);
    // deposited coin is not starter coin: it can go back out
    expect((await port.debit(RIDER, { goods: {}, coin: 60 }, 'claim:1')).ok).toBe(true);
  });
});
