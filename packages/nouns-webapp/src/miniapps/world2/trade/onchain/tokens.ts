// ── Noun Trade on Base: token ids, voucher types, ABI (shared by webapp + server) ──
//
// Contracts: packages/noun-trade-contracts (NounTradeGoods ERC-1155 + NounTradeCoin
// ERC-20 "NTCOIN"). Keep TRADE_TOKEN_IDS and CLAIM_CAPS in sync with
// packages/noun-trade-contracts/script/TradeConfig.sol.
//
// Pure data + viem helpers only (no DOM, no Node), so both the browser panel and the
// Netlify functions (netlify/lib/tradeClaim.ts, tradeDeposit.ts) import it.

import type { GoodId } from '../contract';

import { keccak256, toBytes, type Address, type Hex } from 'viem';

/** ERC-1155 token id per good. Stable forever: new goods only ever append (8, 9, ...). */
export const TRADE_TOKEN_IDS = {
  ICECREAM: 1,
  FRIES: 2,
  FISH: 3,
  DRIP: 4,
  NOGGLES: 5,
  PIZZA: 6,
  WATER: 7,
} as const satisfies Record<GoodId, number>;

export const GOOD_BY_TOKEN_ID: Readonly<Record<number, GoodId>> = Object.fromEntries(
  Object.entries(TRADE_TOKEN_IDS).map(([g, id]) => [id, g as GoodId]),
);

export const ALL_GOODS = Object.keys(TRADE_TOKEN_IDS) as GoodId[];

/** The NTCOIN ERC-20 (0 decimals: 1 token = 1 in-game COIN). */
export const TRADE_COIN = { name: 'Noun Trade Coin', symbol: 'NTCOIN', decimals: 0 } as const;

/** Cap-table key the contract uses for NTCOIN (token id 0 is never minted). */
export const COIN_CAP_KEY = 0;

/** Daily (UTC) claim caps, mirrored from TradeConfig.sol; the server refuses before the chain would. */
export const CLAIM_CAPS = {
  goodPerAddress: 500,
  goodGlobal: 50_000,
  coinPerAddress: 50_000,
  coinGlobal: 5_000_000,
} as const;

/** Most distinct ids in one voucher / deposit (NounTradeGoods.MAX_BATCH). */
export const MAX_BATCH = 16;
/** Longest voucher lifetime the contract accepts (NounTradeGoods.MAX_VOUCHER_TTL). */
export const MAX_VOUCHER_TTL_S = 7 * 24 * 3600;

export const BASE_CHAIN_ID = 8453;
export const BASE_SEPOLIA_CHAIN_ID = 84532;
export const ANVIL_CHAIN_ID = 31337;

/** Public RPCs (no key) per chain, used when TRADE_RPC / VITE_TRADE_RPC is unset. */
export const DEFAULT_TRADE_RPC: Record<number, string> = {
  [BASE_CHAIN_ID]: 'https://mainnet.base.org',
  [BASE_SEPOLIA_CHAIN_ID]: 'https://sepolia.base.org',
  [ANVIL_CHAIN_ID]: 'http://127.0.0.1:8545',
};

export const EXPLORER: Record<number, string> = {
  [BASE_CHAIN_ID]: 'https://basescan.org',
  [BASE_SEPOLIA_CHAIN_ID]: 'https://sepolia.basescan.org',
};

/** Deposit tag for a game rider: keccak256(utf8(riderId)). The rider id itself never goes on-chain. */
export const riderTag = (rider: string): Hex => keccak256(toBytes(rider));

// ── EIP-712 voucher ──

export const CLAIM_DOMAIN_NAME = 'NounTradeGoods';
export const CLAIM_DOMAIN_VERSION = '1';

export const claimDomain = (chainId: number, verifyingContract: Address) =>
  ({
    name: CLAIM_DOMAIN_NAME,
    version: CLAIM_DOMAIN_VERSION,
    chainId,
    verifyingContract,
  }) as const;

export const CLAIM_TYPES = {
  Claim: [
    { name: 'player', type: 'address' },
    { name: 'ids', type: 'uint256[]' },
    { name: 'amounts', type: 'uint256[]' },
    { name: 'coin', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'expiry', type: 'uint256' },
  ],
} as const;

/** A voucher as the contract takes it. */
export interface ClaimVoucher {
  player: Address;
  ids: bigint[];
  amounts: bigint[];
  coin: bigint;
  nonce: bigint;
  expiry: bigint;
}

/** A voucher as JSON carries it (bigints as decimal strings). */
export interface ClaimVoucherWire {
  player: Address;
  ids: string[];
  amounts: string[];
  coin: string;
  nonce: string;
  expiry: string;
}

export const voucherToWire = (v: ClaimVoucher): ClaimVoucherWire => ({
  player: v.player,
  ids: v.ids.map(String),
  amounts: v.amounts.map(String),
  coin: String(v.coin),
  nonce: String(v.nonce),
  expiry: String(v.expiry),
});

export const voucherFromWire = (w: ClaimVoucherWire): ClaimVoucher => ({
  player: w.player,
  ids: w.ids.map(x => BigInt(x)),
  amounts: w.amounts.map(x => BigInt(x)),
  coin: BigInt(w.coin),
  nonce: BigInt(w.nonce),
  expiry: BigInt(w.expiry),
});

/** What the claim endpoint answers with on success. */
export interface SignedClaim {
  chainId: number;
  contract: Address;
  voucher: ClaimVoucherWire;
  signature: Hex;
}

/** On-chain nonce states (NounTradeGoods.NonceState). */
export const NONCE_UNUSED = 0;
export const NONCE_CLAIMED = 1;
export const NONCE_CANCELLED = 2;

// ── ABI (the parts the game uses) ──

export const NOUN_TRADE_GOODS_ABI = [
  {
    type: 'function',
    name: 'claim',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'c',
        type: 'tuple',
        components: [
          { name: 'player', type: 'address' },
          { name: 'ids', type: 'uint256[]' },
          { name: 'amounts', type: 'uint256[]' },
          { name: 'coin', type: 'uint256' },
          { name: 'nonce', type: 'uint256' },
          { name: 'expiry', type: 'uint256' },
        ],
      },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'ids', type: 'uint256[]' },
      { name: 'amounts', type: 'uint256[]' },
      { name: 'coinAmount', type: 'uint256' },
      { name: 'account', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'nonceState',
    stateMutability: 'view',
    inputs: [{ name: 'nonce', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint8' }],
  },
  {
    type: 'function',
    name: 'coin',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'balanceOfBatch',
    stateMutability: 'view',
    inputs: [
      { name: 'accounts', type: 'address[]' },
      { name: 'ids', type: 'uint256[]' },
    ],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
  {
    type: 'function',
    name: 'remainingToday',
    stateMutability: 'view',
    inputs: [
      { name: 'who', type: 'address' },
      { name: 'key', type: 'uint256' },
    ],
    outputs: [
      { name: 'forAddress', type: 'uint256' },
      { name: 'global', type: 'uint256' },
    ],
  },
  {
    type: 'function',
    name: 'paused',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'event',
    name: 'Claimed',
    inputs: [
      { name: 'player', type: 'address', indexed: true },
      { name: 'nonce', type: 'uint256', indexed: true },
      { name: 'signer', type: 'address', indexed: true },
      { name: 'ids', type: 'uint256[]', indexed: false },
      { name: 'amounts', type: 'uint256[]', indexed: false },
      { name: 'coin', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Deposited',
    inputs: [
      { name: 'player', type: 'address', indexed: true },
      { name: 'account', type: 'bytes32', indexed: true },
      { name: 'depositId', type: 'uint256', indexed: true },
      { name: 'ids', type: 'uint256[]', indexed: false },
      { name: 'amounts', type: 'uint256[]', indexed: false },
      { name: 'coin', type: 'uint256', indexed: false },
    ],
  },
] as const;

export const NOUN_TRADE_COIN_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
] as const;
