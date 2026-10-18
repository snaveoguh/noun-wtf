// ── Noun Trade cash-out: debit the game ledger, then sign a claim voucher ──
//
// The player asks for goods / coin out of their server balance. We
//   1. settle any earlier voucher (claimed on-chain → done; expired unused → refund),
//   2. check the daily caps the contract will enforce (so it never reverts on them),
//   3. sign an EIP-712 voucher with TRADE_SIGNER_KEY,
//   4. lock the rider's one pending slot (onlyIfNew: a second, racing request loses),
//   5. debit the ledger atomically and idempotently (opId `claim:<nonce>`), and only
//   6. then hand the voucher out.
// A voucher whose debit did not land is never returned. One pending voucher per rider;
// asking again while it is live returns it (409 + `pending`) so a lost response can be
// resumed. Once its expiry has passed on-chain unused, the debit is refunded
// (opId `refund:<nonce>`): the contract can never accept it after that.
//
// The ledger is reached only through LedgerPort, so the economy's real store plugs in
// with an adapter (see blobLedger + the TODO below).

import type { ChainPort, TradeChainConfig, VoucherSigner } from './tradeOnchain';

import { getAddress, isAddress, type Address, type Hex } from 'viem';

import { COIN, type GoodId, type TradeState } from '../../src/miniapps/world2/trade/contract';
import {
  CLAIM_CAPS,
  COIN_CAP_KEY,
  MAX_BATCH,
  NONCE_CLAIMED,
  TRADE_TOKEN_IDS,
  voucherToWire,
  type ClaimVoucher,
  type ClaimVoucherWire,
  type SignedClaim,
} from '../../src/miniapps/world2/trade/onchain/tokens';

// ── Storage seam (a Netlify Blobs store, or the in-memory one in tests) ──

export interface KV {
  get(key: string, opts: { type: 'json' }): Promise<unknown>;
  getWithMetadata(
    key: string,
    opts: { type: 'json' },
  ): Promise<{ data: unknown; etag?: string } | null>;
  setJSON(
    key: string,
    value: unknown,
    opts?: { onlyIfMatch?: string; onlyIfNew?: boolean },
  ): Promise<{ modified: boolean } | void>;
  delete(key: string): Promise<void>;
}

const modified = (r: { modified: boolean } | void) => (r ? r.modified : true);

// ── Ledger seam ──

/** Goods + coin moving in or out of a rider's game balance. */
export interface LedgerDelta {
  goods: Partial<Record<GoodId, number>>;
  coin: number;
}

export type LedgerResult =
  | { ok: true; state: TradeState; applied: boolean }
  | { ok: false; reason: string };

/**
 * The only two things cash-out / deposit need from the economy's ledger.
 * Both MUST be atomic (all of the delta or none) and idempotent by `opId`: applying an
 * opId the ledger has already applied changes nothing and answers ok with applied:false.
 */
export interface LedgerPort {
  /** Take `delta` out of the rider's balance, only if they hold all of it. */
  debit(rider: string, delta: LedgerDelta, opId: string): Promise<LedgerResult>;
  /** Put `delta` into the rider's balance (deposits, refunds). */
  credit(rider: string, delta: LedgerDelta, opId: string): Promise<LedgerResult>;
}

interface LedgerDoc {
  state: TradeState;
  /** Recently applied op ids (newest last), for idempotency. */
  ops: string[];
}

const KEEP_OPS = 200;
const CAS_TRIES = 8;

/**
 * A LedgerPort over one blob per rider holding a TradeState, updated with etag
 * compare-and-swap. Goods are taken from / added to `cargo`.
 *
 * TODO(economy integration): netlify/functions/world-trade.ts owns the real ledger.
 * Swap this for an adapter over that store (same atomic CAS on the rider's TradeState,
 * plus an applied-op list for idempotency), or point `key` at its blob layout if it
 * stores a `{ state, ops }` doc per rider. Deposits may push cargo over `capacity`;
 * the economy decides whether that spills into storage or is allowed.
 */
export function blobLedger(
  store: KV,
  opts: { key?: (rider: string) => string; fresh?: (rider: string) => TradeState } = {},
): LedgerPort {
  const key = opts.key ?? (rider => `ledger/${rider}`);
  const fresh =
    opts.fresh ??
    ((rider: string): TradeState => ({
      rider,
      coin: 0,
      cargo: {},
      capacity: 20,
      upgrades: [],
      last: null,
    }));

  async function apply(rider: string, delta: LedgerDelta, opId: string, sign: 1 | -1) {
    for (let i = 0; i < CAS_TRIES; i++) {
      const cur = await store.getWithMetadata(key(rider), { type: 'json' });
      const doc = (cur?.data as LedgerDoc | undefined) ?? null;
      if (doc?.ops.includes(opId)) return { ok: true, state: doc.state, applied: false } as const;
      if (!doc && sign < 0) return { ok: false, reason: 'No trade balance yet' } as const;
      const base = doc ?? { state: fresh(rider), ops: [] };
      const state: TradeState = structuredClone(base.state);
      if (sign < 0) {
        if (state.coin < delta.coin) return { ok: false, reason: 'Not enough COIN' } as const;
        for (const [g, n] of Object.entries(delta.goods) as [GoodId, number][]) {
          if ((state.cargo[g] ?? 0) < n) return { ok: false, reason: `Not enough ${g}` } as const;
        }
      }
      state.coin += sign * delta.coin;
      for (const [g, n] of Object.entries(delta.goods) as [GoodId, number][]) {
        const next = (state.cargo[g] ?? 0) + sign * n;
        if (next > 0) state.cargo[g] = next;
        else delete state.cargo[g];
      }
      const next: LedgerDoc = { state, ops: [...base.ops, opId].slice(-KEEP_OPS) };
      const res = await store.setJSON(
        key(rider),
        next,
        cur?.etag ? { onlyIfMatch: cur.etag } : { onlyIfNew: true },
      );
      if (modified(res)) return { ok: true, state, applied: true } as const;
    }
    return { ok: false, reason: 'Ledger busy, try again' } as const;
  }

  return {
    debit: (rider, delta, opId) => apply(rider, delta, opId, -1),
    credit: (rider, delta, opId) => apply(rider, delta, opId, 1),
  };
}

// ── Claim service ──

export interface ClaimDeps {
  store: KV;
  ledger: LedgerPort;
  signer: VoucherSigner | null;
  chain: ChainPort | null;
  cfg: TradeChainConfig;
  now?: () => number;
  /** 32 random bytes → nonce (injectable for tests). */
  randomNonce?: () => bigint;
}

export interface ClaimRequest {
  rider: string;
  address: Address;
  goods: Partial<Record<GoodId, number>>;
  coin: number;
}

export interface Reply {
  status: number;
  body: Record<string, unknown>;
}

interface Slot {
  status: 'debiting' | 'issued';
  rider: string;
  goods: Partial<Record<GoodId, number>>;
  coin: number;
  chainId: number;
  contract: Address;
  voucher: ClaimVoucherWire;
  signature: Hex;
  at: number;
}

/** Seconds past a voucher's expiry (by chain time) before an unused one is refunded. */
export const REFUND_GRACE_S = 60;

const slotKey = (rider: string) => `claims/pending/${rider}`;
const dayOf = (ms: number) => Math.floor(ms / 86_400_000);
const tallyKey = (day: number, who: string) => `claims/tally/${day}/${who}`;

/** A rider id as the game sends it, or null. */
export const cleanRider = (v: unknown): string | null =>
  typeof v === 'string' && v.length >= 1 && v.length <= 128 && !/[\u0000-\u001f]/.test(v)
    ? v
    : null;

/** Parse + validate a claim request body. */
export function parseClaimRequest(input: Record<string, unknown>): ClaimRequest | string {
  const rider = cleanRider(input.rider);
  if (!rider) return 'Bad rider';
  if (typeof input.address !== 'string' || !isAddress(input.address, { strict: false })) {
    return 'Bad address';
  }
  const goodsIn = (input.goods ?? {}) as Record<string, unknown>;
  if (typeof goodsIn !== 'object' || Array.isArray(goodsIn)) return 'Bad goods';
  const goods: Partial<Record<GoodId, number>> = {};
  for (const [g, n] of Object.entries(goodsIn)) {
    if (!(g in TRADE_TOKEN_IDS)) return `Unknown good ${g.slice(0, 20)}`;
    if (n === 0) continue;
    if (typeof n !== 'number' || !Number.isSafeInteger(n) || n < 0) return `Bad amount for ${g}`;
    if (n > CLAIM_CAPS.goodPerAddress) return `Over the daily cap for ${g}`;
    goods[g as GoodId] = n;
  }
  const coin = input.coin ?? 0;
  if (typeof coin !== 'number' || !Number.isSafeInteger(coin) || coin < 0) return 'Bad coin';
  if (coin > CLAIM_CAPS.coinPerAddress) return `Over the daily cap for ${COIN}`;
  if (Object.keys(goods).length === 0 && coin === 0) return 'Nothing to cash out';
  if (Object.keys(goods).length > MAX_BATCH) return 'Too many goods';
  return { rider, address: getAddress(input.address), goods, coin };
}

const signedOf = (s: Slot): SignedClaim => ({
  chainId: s.chainId,
  contract: s.contract,
  voucher: s.voucher,
  signature: s.signature,
});

function defaultNonce(): bigint {
  const b = new Uint8Array(32);
  globalThis.crypto.getRandomValues(b);
  return BigInt(`0x${Buffer.from(b).toString('hex')}`);
}

export function claimService(deps: ClaimDeps) {
  const { store, ledger, cfg } = deps;
  const now = deps.now ?? Date.now;
  const randomNonce = deps.randomNonce ?? defaultNonce;

  const delta = (s: Pick<Slot, 'goods' | 'coin'>): LedgerDelta => ({
    goods: s.goods,
    coin: s.coin,
  });

  /**
   * Bring the rider's pending slot up to date. Returns the slot still pending (live
   * voucher), or null if the rider is free to cash out again.
   */
  async function settle(
    rider: string,
  ): Promise<{ slot: Slot | null; refunded?: LedgerDelta } | Reply> {
    const cur = await store.getWithMetadata(slotKey(rider), { type: 'json' });
    const slot = (cur?.data as Slot | undefined) ?? null;
    if (!slot) return { slot: null };
    const nonce = BigInt(slot.voucher.nonce);

    if (slot.status === 'debiting') {
      // A request died between locking and debiting: finish the debit (idempotent).
      const res = await ledger.debit(rider, delta(slot), `claim:${nonce}`);
      if (!res.ok) {
        await store.delete(slotKey(rider));
        return { slot: null };
      }
      const issued: Slot = { ...slot, status: 'issued' };
      await store.setJSON(slotKey(rider), issued);
      return settle(rider);
    }

    if (!deps.chain) return { status: 503, body: { error: 'Chain unavailable' } };
    let st: { state: number; blockTime: number };
    try {
      st = await deps.chain.nonceStatus(nonce);
    } catch {
      return { status: 503, body: { error: 'Could not reach Base, try again' } };
    }
    if (st.state === NONCE_CLAIMED) {
      await store.delete(slotKey(rider));
      return { slot: null };
    }
    if (st.blockTime > Number(slot.voucher.expiry) + REFUND_GRACE_S) {
      // Unused (or admin-cancelled) and expired on-chain: it can never mint. Refund.
      const res = await ledger.credit(rider, delta(slot), `refund:${nonce}`);
      if (!res.ok) return { status: 503, body: { error: res.reason } };
      await store.delete(slotKey(rider));
      return { slot: null, refunded: delta(slot) };
    }
    return { slot };
  }

  async function readTally(day: number, who: string) {
    return (
      ((await store.get(tallyKey(day, who), { type: 'json' })) as Record<string, number> | null) ??
      {}
    );
  }

  async function bumpTally(day: number, who: string, add: Record<string, number>) {
    for (let i = 0; i < CAS_TRIES; i++) {
      const cur = await store.getWithMetadata(tallyKey(day, who), { type: 'json' });
      const t = { ...((cur?.data as Record<string, number> | undefined) ?? {}) };
      for (const [k, n] of Object.entries(add)) t[k] = (t[k] ?? 0) + n;
      const res = await store.setJSON(
        tallyKey(day, who),
        t,
        cur?.etag ? { onlyIfMatch: cur.etag } : { onlyIfNew: true },
      );
      if (modified(res)) return;
    }
    // Best effort: the contract's own caps are the hard limit.
  }

  /** Cash out: returns the signed voucher, or why not. */
  async function claim(req: ClaimRequest): Promise<Reply> {
    if (!cfg.enabled) return { status: 503, body: { error: 'Cash-out is off' } };
    if (!deps.signer || !cfg.goods)
      return { status: 503, body: { error: 'Cash-out is not configured' } };
    const goodsAddr = cfg.goods;

    const settled = await settle(req.rider);
    if ('status' in settled) return settled;
    if (settled.slot) {
      return {
        status: 409,
        body: {
          error: 'A cash-out is already waiting: submit it or let it expire',
          pending: signedOf(settled.slot),
        },
      };
    }

    // Caps, as the contract counts them (per UTC day, per address and global).
    const wanted: Record<string, number> = {};
    for (const [g, n] of Object.entries(req.goods) as [GoodId, number][]) {
      wanted[String(TRADE_TOKEN_IDS[g])] = n;
    }
    if (req.coin > 0) wanted[String(COIN_CAP_KEY)] = req.coin;
    const day = dayOf(now());
    const [mine, all] = await Promise.all([
      readTally(day, req.address.toLowerCase()),
      readTally(day, 'all'),
    ]);
    for (const [k, n] of Object.entries(wanted)) {
      const isCoin = k === String(COIN_CAP_KEY);
      const per = isCoin ? CLAIM_CAPS.coinPerAddress : CLAIM_CAPS.goodPerAddress;
      const glob = isCoin ? CLAIM_CAPS.coinGlobal : CLAIM_CAPS.goodGlobal;
      if ((mine[k] ?? 0) + n > per)
        return { status: 429, body: { error: 'Over the daily cash-out cap for this wallet' } };
      if ((all[k] ?? 0) + n > glob)
        return { status: 429, body: { error: 'Over the daily cash-out cap, try tomorrow' } };
    }

    // Sign.
    const ids = (Object.keys(req.goods) as GoodId[]).sort(
      (a, b) => TRADE_TOKEN_IDS[a] - TRADE_TOKEN_IDS[b],
    );
    const voucher: ClaimVoucher = {
      player: req.address,
      ids: ids.map(g => BigInt(TRADE_TOKEN_IDS[g])),
      amounts: ids.map(g => BigInt(req.goods[g] as number)),
      coin: BigInt(req.coin),
      nonce: randomNonce(),
      expiry: BigInt(Math.floor(now() / 1000) + cfg.ttlS),
    };
    const signature = await deps.signer.sign(cfg.chainId, goodsAddr, voucher);
    const slot: Slot = {
      status: 'debiting',
      rider: req.rider,
      goods: req.goods,
      coin: req.coin,
      chainId: cfg.chainId,
      contract: goodsAddr,
      voucher: voucherToWire(voucher),
      signature,
      at: now(),
    };

    // Lock the rider's slot. A racing request for the same rider loses here.
    if (!modified(await store.setJSON(slotKey(req.rider), slot, { onlyIfNew: true }))) {
      return { status: 409, body: { error: 'A cash-out is already in progress' } };
    }

    // Debit. Only a landed debit releases the voucher.
    const res = await ledger.debit(req.rider, delta(slot), `claim:${voucher.nonce}`);
    if (!res.ok) {
      await store.delete(slotKey(req.rider));
      return { status: 400, body: { error: res.reason } };
    }
    await bumpTally(day, req.address.toLowerCase(), wanted);
    await bumpTally(day, 'all', wanted);
    await store.setJSON(slotKey(req.rider), { ...slot, status: 'issued' } satisfies Slot);
    return { status: 200, body: { ok: true, claim: signedOf(slot), state: res.state } };
  }

  /** The rider's pending voucher (settled first), plus any refund that just happened. */
  async function pending(rider: string): Promise<Reply> {
    const settled = await settle(rider);
    if ('status' in settled) return settled;
    return {
      status: 200,
      body: {
        ok: true,
        pending: settled.slot ? signedOf(settled.slot) : null,
        refunded: settled.refunded ?? null,
      },
    };
  }

  return { claim, pending, settle };
}
