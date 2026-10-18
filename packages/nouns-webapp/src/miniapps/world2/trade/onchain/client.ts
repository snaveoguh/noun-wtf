// ── Noun Trade on-chain: browser side of cash-out / deposit ──
//
// The wallet comes from wagmi (the player's connected connector); txs go to Base
// through a viem wallet client on that connector's provider, so the shared wagmi
// config (mainnet + polygon) does not need Base added. When the panel is wired into
// the HUD, Base can instead join src/wagmi.ts and these calls can move to
// useWriteContract — the functions below keep the same shape.

import type { GoodId, TradeState } from '../contract';

import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  http,
  type Account,
  type Address,
  type CustomTransport,
  type EIP1193Provider,
  type Hash,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { base, baseSepolia, foundry, type Chain } from 'viem/chains';

import { TRADE_CHAIN_ID, TRADE_GOODS_ADDRESS, TRADE_RPC } from './flags';
import {
  ALL_GOODS,
  NOUN_TRADE_COIN_ABI,
  NOUN_TRADE_GOODS_ABI,
  riderTag,
  TRADE_TOKEN_IDS,
  voucherFromWire,
  type SignedClaim,
} from './tokens';

const CLAIM_URL = '/.netlify/functions/world-trade-claim';
const DEPOSIT_URL = '/.netlify/functions/world-trade-deposit';

export const tradeChain = (): Chain =>
  ({ 8453: base, 84532: baseSepolia, 31337: foundry })[TRADE_CHAIN_ID] ?? baseSepolia;

let reader: PublicClient | null = null;
export function tradeReader(): PublicClient {
  reader ??= createPublicClient({
    chain: tradeChain(),
    transport: http(TRADE_RPC),
  }) as PublicClient;
  return reader;
}

// ── Server calls ──

export type ClaimReply =
  | { ok: true; claim: SignedClaim; state?: TradeState }
  | { ok: false; error: string; pending?: SignedClaim };

async function post(url: string, body: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const out = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, out };
}

/** Ask the server to debit the game balance and sign a voucher for it. */
export async function requestClaim(
  rider: string,
  address: Address,
  goods: Partial<Record<GoodId, number>>,
  coin: number,
): Promise<ClaimReply> {
  const { status, out } = await post(CLAIM_URL, { action: 'claim', rider, address, goods, coin });
  if (status === 200 && out.claim !== undefined)
    return { ok: true, claim: out.claim as SignedClaim, state: out.state as TradeState };
  return {
    ok: false,
    error: String(out.error ?? `Cash-out failed (${status})`),
    pending: out.pending as SignedClaim | undefined,
  };
}

/** The rider's live voucher, if any (an expired unused one is refunded server-side). */
export async function fetchPending(rider: string) {
  const { out } = await post(CLAIM_URL, { action: 'pending', rider });
  return {
    pending: (out.pending as SignedClaim | null) ?? null,
    refunded:
      (out.refunded as { goods: Partial<Record<GoodId, number>>; coin: number } | null) ?? null,
  };
}

/** Report a deposit tx; polls while the server waits for it to be mined / confirmed. */
export async function reportDeposit(rider: string, tx: Hash, tries = 20, waitMs = 3000) {
  for (let i = 0; i < tries; i++) {
    const { status, out } = await post(DEPOSIT_URL, { rider, tx });
    if (status === 200)
      return { ok: true as const, credited: out.credited, already: Boolean(out.already) };
    if (out.retry !== true)
      return { ok: false as const, error: String(out.error ?? `Deposit failed (${status})`) };
    await new Promise(r => setTimeout(r, waitMs));
  }
  return { ok: false as const, error: 'Still waiting for Base, try again in a minute' };
}

// ── Wallet ──

export type TradeWallet = WalletClient<CustomTransport, Chain, Account>;

/** A viem wallet client on the trade chain, over the wagmi connector's provider. */
export async function tradeWallet(
  connector: { getProvider(): Promise<unknown> },
  account: Address,
): Promise<TradeWallet> {
  const provider = (await connector.getProvider()) as EIP1193Provider;
  const chain = tradeChain();
  const wallet = createWalletClient({ account, chain, transport: custom(provider) });
  const current = await wallet.getChainId();
  if (current !== chain.id) {
    try {
      await wallet.switchChain({ id: chain.id });
    } catch {
      await wallet.addChain({ chain });
      await wallet.switchChain({ id: chain.id });
    }
  }
  return wallet;
}

/** Calldata for NounTradeGoods.claim(voucher, signature). */
export const claimCalldata = (signed: SignedClaim): Hex =>
  encodeFunctionData({
    abi: NOUN_TRADE_GOODS_ABI,
    functionName: 'claim',
    args: [voucherFromWire(signed.voucher), signed.signature],
  });

/** Calldata for NounTradeGoods.deposit(ids, amounts, coin, riderTag(rider)). */
export function depositCalldata(
  rider: string,
  goods: Partial<Record<GoodId, number>>,
  coin: number,
): Hex {
  const list = (Object.entries(goods) as [GoodId, number][]).filter(([, n]) => n > 0);
  return encodeFunctionData({
    abi: NOUN_TRADE_GOODS_ABI,
    functionName: 'deposit',
    args: [
      list.map(([g]) => BigInt(TRADE_TOKEN_IDS[g])),
      list.map(([, n]) => BigInt(n)),
      BigInt(coin),
      riderTag(rider),
    ],
  });
}

export async function submitClaim(wallet: TradeWallet, signed: SignedClaim): Promise<Hash> {
  if (signed.chainId !== tradeChain().id) throw new Error('Voucher is for another chain');
  return wallet.sendTransaction({ to: signed.contract, data: claimCalldata(signed) });
}

export async function submitDeposit(
  wallet: TradeWallet,
  rider: string,
  goods: Partial<Record<GoodId, number>>,
  coin: number,
): Promise<Hash> {
  if (!TRADE_GOODS_ADDRESS) throw new Error('No Noun Trade contract configured');
  return wallet.sendTransaction({
    to: TRADE_GOODS_ADDRESS,
    data: depositCalldata(rider, goods, coin),
  });
}

export const waitForTx = (hash: Hash) => tradeReader().waitForTransactionReceipt({ hash });

/** What the wallet holds on-chain: goods per id and NTCOIN. */
export async function readHoldings(owner: Address) {
  if (!TRADE_GOODS_ADDRESS) return null;
  const goodsAddr = TRADE_GOODS_ADDRESS;
  const r = tradeReader();
  const [bals, coinAddr] = await Promise.all([
    r.readContract({
      address: goodsAddr,
      abi: NOUN_TRADE_GOODS_ABI,
      functionName: 'balanceOfBatch',
      args: [ALL_GOODS.map(() => owner), ALL_GOODS.map(g => BigInt(TRADE_TOKEN_IDS[g]))],
    }),
    r.readContract({ address: goodsAddr, abi: NOUN_TRADE_GOODS_ABI, functionName: 'coin' }),
  ]);
  const coin = await r.readContract({
    address: coinAddr,
    abi: NOUN_TRADE_COIN_ABI,
    functionName: 'balanceOf',
    args: [owner],
  });
  const goods: Partial<Record<GoodId, number>> = {};
  ALL_GOODS.forEach((g, i) => {
    if (bals[i] > 0n) goods[g] = Number(bals[i]);
  });
  return { goods, coin: Number(coin) };
}
