import type { TradeState } from '../../src/miniapps/world2/trade/contract';

import { recoverTypedDataAddress, type Address, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CLAIM_CAPS,
  CLAIM_TYPES,
  claimDomain,
  NONCE_CLAIMED,
  NONCE_UNUSED,
  voucherFromWire,
  type SignedClaim,
} from '../../src/miniapps/world2/trade/onchain/tokens';

// ── An in-memory Netlify Blobs store (etags and all), as in world-stats.test.ts ──
const blobs = new Map<string, { v: string; etag: string }>();
let etags = 0;
/** Yield to the event loop inside every store call, so concurrent requests interleave. */
const tick = () => new Promise(r => setTimeout(r, 0));
const store = {
  async get(k: string, o?: { type?: string }) {
    await tick();
    const b = blobs.get(k);
    if (!b) return null;
    return o?.type === 'json' ? JSON.parse(b.v) : b.v;
  },
  async getWithMetadata(k: string) {
    await tick();
    const b = blobs.get(k);
    return b ? { data: JSON.parse(b.v), etag: b.etag } : null;
  },
  async setJSON(k: string, v: unknown, o: { onlyIfMatch?: string; onlyIfNew?: boolean } = {}) {
    await tick();
    const b = blobs.get(k);
    if (o.onlyIfNew && b) return { modified: false };
    if (o.onlyIfMatch && b?.etag !== o.onlyIfMatch) return { modified: false };
    blobs.set(k, { v: JSON.stringify(v), etag: `e${++etags}` });
    return { modified: true };
  },
  async delete(k: string) {
    await tick();
    blobs.delete(k);
  },
};
vi.mock('@netlify/blobs', () => ({ connectLambda: () => undefined, getStore: () => store }));

const { makeHandler } = await import('../functions/world-trade-claim');
const { blobLedger } = await import('./tradeClaim');
const { signerFromKey } = await import('./tradeOnchain');

// A throwaway key made fresh for this run: never funded, never used anywhere else.
const SIGNER_KEY = generatePrivateKey();
const signer = signerFromKey(SIGNER_KEY)!;
const PLAYER: Address = privateKeyToAccount(generatePrivateKey()).address;
const GOODS: Address = '0x5FbDB2315678afecb367f032d93F642f64180aa3';
const CHAIN_ID = 84532;

let clock = Date.UTC(2026, 9, 18, 12);
let chainTime = Math.floor(clock / 1000);
const nonceStates = new Map<bigint, number>();
const chain = {
  nonceStatus: vi.fn(async (n: bigint) => ({
    state: nonceStates.get(n) ?? NONCE_UNUSED,
    blockTime: chainTime,
  })),
  receipt: vi.fn(async () => null),
  head: vi.fn(async () => 0n),
};
const cfg = {
  enabled: true,
  chainId: CHAIN_ID,
  goods: GOODS,
  rpc: 'http://unused',
  ttlS: 1800,
  confirmations: 3,
};
let nextNonce = 1n;
const handler = makeHandler({
  store,
  chain,
  cfg,
  signer,
  now: () => clock,
  randomNonce: () => nextNonce++,
});

async function call(body: Record<string, unknown>) {
  const res = await handler({ httpMethod: 'POST', body: JSON.stringify(body) });
  return { status: res.statusCode, out: JSON.parse(res.body) };
}
const claim = (rider: string, goods: Record<string, number>, coin = 0, address: string = PLAYER) =>
  call({ action: 'claim', rider, address, goods, coin });

async function ledgerState(rider: string) {
  return ((await store.get(`ledger/${rider}`, { type: 'json' })) as { state: TradeState } | null)
    ?.state;
}

async function fund(rider: string, cargo: TradeState['cargo'], coin: number) {
  const r = await blobLedger(store).credit(
    rider,
    { goods: cargo, coin },
    `seed:${rider}:${Math.random()}`,
  );
  expect(r.ok).toBe(true);
}

beforeEach(() => {
  blobs.clear();
  nonceStates.clear();
  clock = Date.UTC(2026, 9, 18, 12);
  chainTime = Math.floor(clock / 1000);
});

describe('world-trade-claim', () => {
  it('debits the ledger and returns a voucher signed by the server key', async () => {
    await fund('r1', { ICECREAM: 10, FISH: 4 }, 500);
    const { status, out } = await claim('r1', { ICECREAM: 3, FISH: 4 }, 120);
    expect(status).toBe(200);
    const c = out.claim as SignedClaim;
    expect(c.chainId).toBe(CHAIN_ID);
    expect(c.contract).toBe(GOODS);
    expect(c.voucher.player).toBe(PLAYER);
    expect(c.voucher.ids).toEqual(['1', '3']);
    expect(c.voucher.amounts).toEqual(['3', '4']);
    expect(c.voucher.coin).toBe('120');
    expect(Number(c.voucher.expiry)).toBe(Math.floor(clock / 1000) + 1800);

    const recovered = await recoverTypedDataAddress({
      domain: claimDomain(CHAIN_ID, GOODS),
      types: CLAIM_TYPES,
      primaryType: 'Claim',
      message: voucherFromWire(c.voucher),
      signature: c.signature as Hex,
    });
    expect(recovered).toBe(signer.address);

    expect(await ledgerState('r1')).toMatchObject({ coin: 380, cargo: { ICECREAM: 7 } });
    expect((await ledgerState('r1'))!.cargo.FISH).toBeUndefined();
  });

  it('refuses a claim over the balance and debits nothing', async () => {
    await fund('r2', { PIZZA: 2 }, 50);
    let r = await claim('r2', { PIZZA: 3 });
    expect(r.status).toBe(400);
    expect(r.out.error).toBe('Not enough PIZZA');
    r = await claim('r2', {}, 51);
    expect(r.status).toBe(400);
    expect(r.out.error).toBe('Not enough COIN');
    r = await claim('nobody', { PIZZA: 1 });
    expect(r.status).toBe(400);
    expect(await ledgerState('r2')).toMatchObject({ coin: 50, cargo: { PIZZA: 2 } });
    // and the slot is free again: a claim within balance still works
    r = await claim('r2', { PIZZA: 2 }, 50);
    expect(r.status).toBe(200);
  });

  it('double-claim race: two concurrent cash-outs of the whole balance debit once', async () => {
    await fund('r3', { WATER: 5 }, 100);
    const [a, b] = await Promise.all([
      claim('r3', { WATER: 5 }, 100),
      claim('r3', { WATER: 5 }, 100),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    expect(await ledgerState('r3')).toMatchObject({ coin: 0, cargo: {} });
  });

  it('double-claim race across riders sharing nothing still cannot overdraw one ledger', async () => {
    await fund('r4', { NOGGLES: 4 }, 0);
    const port = blobLedger(store);
    const results = await Promise.all([
      port.debit('r4', { goods: { NOGGLES: 3 }, coin: 0 }, 'x1'),
      port.debit('r4', { goods: { NOGGLES: 3 }, coin: 0 }, 'x2'),
      port.debit('r4', { goods: { NOGGLES: 3 }, coin: 0 }, 'x3'),
    ]);
    expect(results.filter(r => r.ok)).toHaveLength(1);
    expect(await ledgerState('r4')).toMatchObject({ cargo: { NOGGLES: 1 } });
    // the same op id twice applies once
    const again = await port.credit('r4', { goods: { NOGGLES: 3 }, coin: 0 }, 'x1');
    expect(again).toMatchObject({ ok: true, applied: false });
  });

  it('one live voucher per rider: asking again returns it (409) without a second debit', async () => {
    await fund('r5', { FRIES: 10 }, 0);
    const first = await claim('r5', { FRIES: 2 });
    const second = await claim('r5', { FRIES: 2 });
    expect(second.status).toBe(409);
    expect(second.out.pending).toEqual(first.out.claim);
    expect(await ledgerState('r5')).toMatchObject({ cargo: { FRIES: 8 } });
  });

  it('frees the rider once the voucher is claimed on-chain', async () => {
    await fund('r6', { DRIP: 5 }, 0);
    const first = await claim('r6', { DRIP: 1 });
    nonceStates.set(BigInt(first.out.claim.voucher.nonce), NONCE_CLAIMED);
    const second = await claim('r6', { DRIP: 1 });
    expect(second.status).toBe(200);
    expect(await ledgerState('r6')).toMatchObject({ cargo: { DRIP: 3 } });
  });

  it('refunds an expired, unused voucher exactly once (by chain time)', async () => {
    await fund('r7', { FISH: 5 }, 40);
    const first = await claim('r7', { FISH: 5 }, 40);
    expect(await ledgerState('r7')).toMatchObject({ coin: 0, cargo: {} });
    const expiry = Number(first.out.claim.voucher.expiry);

    // past expiry by the server clock, but the chain has not caught up: still pending
    clock = (expiry + 3600) * 1000;
    chainTime = expiry - 5;
    let p = await call({ action: 'pending', rider: 'r7' });
    expect(p.out.pending).not.toBeNull();

    chainTime = expiry + 61;
    p = await call({ action: 'pending', rider: 'r7' });
    expect(p.out.pending).toBeNull();
    expect(p.out.refunded).toEqual({ goods: { FISH: 5 }, coin: 40 });
    expect(await ledgerState('r7')).toMatchObject({ coin: 40, cargo: { FISH: 5 } });

    p = await call({ action: 'pending', rider: 'r7' });
    expect(p.out.refunded).toBeNull();
    expect(await ledgerState('r7')).toMatchObject({ coin: 40, cargo: { FISH: 5 } });
  });

  it('does not refund a voucher that was claimed after expiry by the server clock', async () => {
    await fund('r8', { FISH: 5 }, 0);
    const first = await claim('r8', { FISH: 5 });
    const expiry = Number(first.out.claim.voucher.expiry);
    nonceStates.set(BigInt(first.out.claim.voucher.nonce), NONCE_CLAIMED);
    chainTime = expiry + 1000;
    const p = await call({ action: 'pending', rider: 'r8' });
    expect(p.out).toMatchObject({ pending: null, refunded: null });
    expect(await ledgerState('r8')).toMatchObject({ cargo: {} });
  });

  it('enforces the daily per-wallet caps the contract will', async () => {
    await fund('r9', { ICECREAM: 2000 }, 0);
    await fund('r10', { ICECREAM: 2000 }, 0);
    const a = await claim('r9', { ICECREAM: CLAIM_CAPS.goodPerAddress });
    expect(a.status).toBe(200);
    nonceStates.set(BigInt(a.out.claim.voucher.nonce), NONCE_CLAIMED);
    // same wallet, a different rider: still capped
    const b = await claim('r10', { ICECREAM: 1 });
    expect(b.status).toBe(429);
    // tomorrow it resets
    clock += 86_400_000;
    chainTime += 86_400;
    const c = await claim('r10', { ICECREAM: 1 });
    expect(c.status).toBe(200);
  });

  it('validates input and stays off unless configured', async () => {
    expect((await claim('r', { GOLD: 1 })).out.error).toMatch(/Unknown good/);
    expect((await claim('r', { FISH: -1 })).status).toBe(400);
    expect((await claim('r', { FISH: 1.5 })).status).toBe(400);
    expect((await claim('r', {}, 0)).out.error).toBe('Nothing to cash out');
    expect((await claim('r', { FISH: 1 }, 0, 'not-an-address')).out.error).toBe('Bad address');
    expect((await claim('r', { FISH: CLAIM_CAPS.goodPerAddress + 1 })).status).toBe(400);
    expect((await call({ action: 'nope', rider: 'r' })).status).toBe(400);

    const off = makeHandler({ store, chain, cfg: { ...cfg, enabled: false }, signer });
    let res = await off({
      httpMethod: 'POST',
      body: JSON.stringify({ action: 'claim', rider: 'r', address: PLAYER, goods: { FISH: 1 } }),
    });
    expect(res.statusCode).toBe(503);
    const keyless = makeHandler({ store, chain, cfg, signer: null });
    res = await keyless({
      httpMethod: 'POST',
      body: JSON.stringify({ action: 'claim', rider: 'r', address: PLAYER, goods: { FISH: 1 } }),
    });
    expect(res.statusCode).toBe(503);
  });

  it('a crash between locking and debiting is finished (not lost, not doubled) on the next call', async () => {
    await fund('r11', { PIZZA: 4 }, 0);
    let failNext = true;
    const port = blobLedger(store);
    const flaky = {
      debit: async (...a: Parameters<typeof port.debit>) => {
        if (failNext) {
          failNext = false;
          throw new Error('lambda died');
        }
        return port.debit(...a);
      },
      credit: port.credit,
    };
    const h = makeHandler({
      store,
      chain,
      cfg,
      signer,
      now: () => clock,
      randomNonce: () => 777n,
      ledger: flaky,
    });
    const r1 = await h({
      httpMethod: 'POST',
      body: JSON.stringify({ action: 'claim', rider: 'r11', address: PLAYER, goods: { PIZZA: 4 } }),
    });
    expect(r1.statusCode).toBe(500); // no voucher handed out
    const r2 = await h({
      httpMethod: 'POST',
      body: JSON.stringify({ action: 'pending', rider: 'r11' }),
    });
    const out = JSON.parse(r2.body);
    expect(out.pending.voucher.nonce).toBe('777');
    expect(await ledgerState('r11')).toMatchObject({ cargo: {} });
  });
});
