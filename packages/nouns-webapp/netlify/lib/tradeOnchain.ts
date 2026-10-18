// ── Noun Trade on Base: server config, voucher signer and chain reads ──
//
// Env (Netlify → Site configuration → Environment variables; never in the repo):
//   TRADE_ONCHAIN               "on" to enable cash-out / deposit (default off)
//   TRADE_SIGNER_KEY            0x… private key of the voucher signer. Its ADDRESS is the
//                               SIGNER_ROLE the contract was deployed with. Holds no funds.
//   TRADE_GOODS_ADDRESS         NounTradeGoods address (from deployments/<chainId>.json)
//   TRADE_CHAIN_ID              84532 (Base Sepolia, default) or 8453 (Base)
//   TRADE_RPC                   optional RPC override (default: the public Base RPC)
//   TRADE_VOUCHER_TTL_S         optional voucher lifetime, seconds (default 1800)
//   TRADE_DEPOSIT_CONFIRMATIONS optional blocks before a deposit counts (default 3)

import {
  createPublicClient,
  getAddress,
  http,
  isAddress,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia, foundry } from 'viem/chains';

import {
  ANVIL_CHAIN_ID,
  BASE_CHAIN_ID,
  BASE_SEPOLIA_CHAIN_ID,
  CLAIM_TYPES,
  claimDomain,
  DEFAULT_TRADE_RPC,
  MAX_VOUCHER_TTL_S,
  NOUN_TRADE_GOODS_ABI,
  type ClaimVoucher,
} from '../../src/miniapps/world2/trade/onchain/tokens';

/** Netlify Blobs store for vouchers, deposit markers and cap tallies. */
export const TRADE_STORE = 'noun-world-trade-onchain';

export interface TradeChainConfig {
  enabled: boolean;
  chainId: number;
  goods: Address | null;
  rpc: string;
  ttlS: number;
  confirmations: number;
}

export function readTradeConfig(
  env: Record<string, string | undefined> = process.env,
): TradeChainConfig {
  const chainId = Number(env.TRADE_CHAIN_ID || BASE_SEPOLIA_CHAIN_ID);
  const goodsRaw = env.TRADE_GOODS_ADDRESS ?? '';
  const ttl = Number(env.TRADE_VOUCHER_TTL_S || 1800);
  const conf = Number(env.TRADE_DEPOSIT_CONFIRMATIONS || 3);
  return {
    enabled: env.TRADE_ONCHAIN === 'on',
    chainId,
    goods: isAddress(goodsRaw) ? getAddress(goodsRaw) : null,
    rpc: env.TRADE_RPC || DEFAULT_TRADE_RPC[chainId] || '',
    ttlS: Number.isFinite(ttl)
      ? Math.min(Math.max(60, Math.floor(ttl)), MAX_VOUCHER_TTL_S - 60)
      : 1800,
    confirmations: Number.isFinite(conf) ? Math.min(Math.max(1, Math.floor(conf)), 100) : 3,
  };
}

// ── Signer ──

export interface VoucherSigner {
  address: Address;
  sign(chainId: number, contract: Address, v: ClaimVoucher): Promise<Hex>;
}

/** The voucher signer from a raw key (TRADE_SIGNER_KEY), or null if unset / malformed. */
export function signerFromKey(key: string | undefined): VoucherSigner | null {
  if (!key || !/^0x[\dA-Fa-f]{64}$/.test(key)) return null;
  const account = privateKeyToAccount(key as Hex);
  return {
    address: account.address,
    sign: (chainId, contract, v) =>
      account.signTypedData({
        domain: claimDomain(chainId, contract),
        types: CLAIM_TYPES,
        primaryType: 'Claim',
        message: v,
      }),
  };
}

// ── Chain reads ──

export interface ReceiptLike {
  status: 'success' | 'reverted';
  blockNumber: bigint;
  to: Address | null;
  logs: { address: Address; topics: Hex[]; data: Hex; logIndex: number | null }[];
}

/** The narrow set of chain reads the claim / deposit flows need (faked in tests). */
export interface ChainPort {
  /** nonceState(nonce) and the timestamp of the block it was read at (same block). */
  nonceStatus(nonce: bigint): Promise<{ state: number; blockTime: number }>;
  /** The receipt, or null if the tx is unknown / not mined yet. */
  receipt(tx: Hex): Promise<ReceiptLike | null>;
  head(): Promise<bigint>;
}

const CHAINS = {
  [BASE_CHAIN_ID]: base,
  [BASE_SEPOLIA_CHAIN_ID]: baseSepolia,
  [ANVIL_CHAIN_ID]: foundry,
};

export function viemChainPort(cfg: TradeChainConfig): ChainPort {
  if (!cfg.goods) throw new Error('TRADE_GOODS_ADDRESS unset');
  const goods = cfg.goods;
  const client = createPublicClient({
    chain: CHAINS[cfg.chainId as keyof typeof CHAINS],
    transport: http(cfg.rpc, { timeout: 8000 }),
    cacheTime: 0, // head() must see new blocks for confirmation counts
  }) as PublicClient;
  return {
    async nonceStatus(nonce) {
      const block = await client.getBlock({ blockTag: 'latest' });
      const state = await client.readContract({
        address: goods,
        abi: NOUN_TRADE_GOODS_ABI,
        functionName: 'nonceState',
        args: [nonce],
        blockNumber: block.number,
      });
      return { state: Number(state), blockTime: Number(block.timestamp) };
    },
    async receipt(tx) {
      try {
        const r = await client.getTransactionReceipt({ hash: tx });
        return {
          status: r.status,
          blockNumber: r.blockNumber,
          to: r.to,
          logs: r.logs.map(l => ({
            address: l.address,
            topics: l.topics as Hex[],
            data: l.data,
            logIndex: l.logIndex,
          })),
        };
      } catch (e) {
        if ((e as Error).name === 'TransactionReceiptNotFoundError') return null;
        throw e;
      }
    },
    head: () => client.getBlockNumber(),
  };
}
