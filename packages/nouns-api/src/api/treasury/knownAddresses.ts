// ─── Known addresses for the Nonsense (treasury flows) page ──────────────────
//
// The ONE table of hand-written labels behind /api/treasury/flows. Everything
// else about an address (its type, its name) is derived by rule in
// buildFlows.ts — see `classify`. Only add an entry here when you can cite a
// source a reviewer can check; never infer a label from proposal text.
//
// Sources, by tag:
//   sdk      — packages/nouns-sdk / packages/nouns-webapp/src/contracts/*.gen.ts
//              (wagmi-generated from the deployed Nouns contracts)
//   ens      — forward ENS record, checked on mainnet (e.g. nouns.eth resolves
//              to the V2 timelock; nounders.eth to the Nounders multisig)
//   onchain  — read from a contract on mainnet (named getter in `note`)
//   token    — the token's own contract (symbol()/decimals() on mainnet)
//
// All keys are lowercase.

export type KnownKind =
  | 'treasury' // nouns.eth and the legacy timelock — merged into one node
  | 'dao-contract' // Nouns DAO's own contracts (governor, auction house, payer…)
  | 'nounders'
  | 'subdao'; // sub-DAOs, forks and grant programs with a verifiable address

export interface KnownAddress {
  name: string;
  kind: KnownKind;
  description: string;
  source: 'sdk' | 'ens' | 'onchain' | 'token';
  note?: string;
  url?: string;
}

/** nouns.eth (Timelock V2, `NounsDAOExecutorV2` proxy) — current treasury. */
export const TREASURY_V2 = '0xb1a32fc9f9d8b2cf86c068cae13108809547ef71';
/** Timelock V1 (`NounsDAOExecutor`) — the treasury until the DAO V3 migration (2023). */
export const TREASURY_V1 = '0x0bc3807ec262cb779b38d65b38158acc3bfede10';
export const TREASURY_ADDRESSES: ReadonlySet<string> = new Set([TREASURY_V2, TREASURY_V1]);

export const NOUNS_TOKEN = '0x9c8ff314c9bc7f6e59a9d9225fb22946427edc03';
export const AUCTION_HOUSE = '0x830bd73e4184cef73443c15111a1df14e495c706';
export const GOVERNOR = '0x6f3e6272a167e8accb32072d08e0957f9c79223d';
export const PAYER = '0xd97bcd9f47cee35c0a9ec1dc40c1269afc9e8e1d';
export const TOKEN_BUYER = '0x4f2acdc74f6941390d9b1804fabc3e780388cfe5';
export const STREAM_FACTORY = '0x0fd206fc7a7dbcd5661157edcb1ffdd0d02a61ff';
export const CLIENT_REWARDS = '0x883860178f95d0c82413edc1d6de530cb4771d55';
export const NOUNDERS = '0x2573c60a6d127755aa2dc85e342f7da2378a0cc5';

// ── Tokens the treasury pays out in ──────────────────────────────────────────
export interface TokenInfo {
  symbol: string;
  decimals: number;
  /** Counts 1:1 toward ETH totals (ETH, WETH, stETH). */
  ethLike?: boolean;
  /** Counts 1:1 toward USD totals (USDC). */
  usdLike?: boolean;
}

export const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2';
export const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
export const STETH = '0xae7ab96520de3a18e5e111b5eaab095312d7fe84';
export const WSTETH = '0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0';
export const RETH = '0xae78736cd615f374d3085123a210448e74fc6393';
export const METH = '0xd5f7838f5c461feff7fe49ea5ebaf7728bb0adfa';

export const TOKENS: Readonly<Record<string, TokenInfo>> = {
  [WETH]: { symbol: 'WETH', decimals: 18, ethLike: true },
  [STETH]: { symbol: 'stETH', decimals: 18, ethLike: true },
  [USDC]: { symbol: 'USDC', decimals: 6, usdLike: true },
  [WSTETH]: { symbol: 'wstETH', decimals: 18 },
  [RETH]: { symbol: 'rETH', decimals: 18 },
  [METH]: { symbol: 'mETH', decimals: 18 },
};

/**
 * Contracts that take treasury ETH and hand back another treasury asset —
 * a conversion, not spending. ETH sent here is reported separately
 * (`stats.convertedEth`) and never counted as "out".
 */
export const CONVERSION_TARGETS: Readonly<Record<string, string>> = {
  [WETH]: 'ETH → WETH (wrap)',
  [STETH]: 'ETH → stETH (Lido stake)',
  [TOKEN_BUYER]: 'ETH → USDC (Token Buyer refills the USDC Payer)',
  '0xe3cbd06d7dadb3f4e6557bab7edd924cd1489e8f': 'ETH → mETH (Mantle stake)',
};

export const KNOWN_ADDRESSES: Readonly<Record<string, KnownAddress>> = {
  // ── Treasury ──
  [TREASURY_V2]: {
    name: 'nouns.eth',
    kind: 'treasury',
    description: 'Nouns DAO treasury — Timelock V2 (NounsDAOExecutorV2)',
    source: 'ens',
    note: 'nouns.eth resolves here; sdk nounsTreasuryAddress',
  },
  [TREASURY_V1]: {
    name: 'Treasury (Timelock V1)',
    kind: 'treasury',
    description: 'Original Nouns treasury (NounsDAOExecutor), used until the 2023 V3 migration',
    source: 'sdk',
    note: 'sdk nounsLegacyTreasuryAddress',
  },
  // ── DAO contracts & infrastructure ──
  [GOVERNOR]: {
    name: 'Nouns DAO Governor',
    kind: 'dao-contract',
    description: 'NounsDAOProxy — runs proposals and votes',
    source: 'sdk',
  },
  [AUCTION_HOUSE]: {
    name: 'Nouns Auction House',
    kind: 'dao-contract',
    description: 'Sells one Noun a day; proceeds go to the treasury',
    source: 'sdk',
  },
  [NOUNS_TOKEN]: {
    name: 'Nouns Token',
    kind: 'dao-contract',
    description: 'The Nouns ERC-721 contract',
    source: 'sdk',
  },
  [PAYER]: {
    name: 'USDC Payer',
    kind: 'dao-contract',
    description: 'Pays proposal recipients in USDC (queues a debt when it runs dry)',
    source: 'sdk',
  },
  [TOKEN_BUYER]: {
    name: 'Token Buyer',
    kind: 'dao-contract',
    description: 'Swaps treasury ETH into USDC for the Payer',
    source: 'sdk',
  },
  [STREAM_FACTORY]: {
    name: 'Stream Factory',
    kind: 'dao-contract',
    description: 'Creates vesting streams for proposal payouts',
    source: 'sdk',
  },
  [CLIENT_REWARDS]: {
    name: 'Client Rewards',
    kind: 'dao-contract',
    description: 'Pays clients (front-ends) that bring bids, votes and proposals',
    source: 'sdk',
    note: 'webapp src/lib/knownAbis.ts NOUNS_CLIENT_REWARDS_ADDRESS',
  },
  '0xf790a5f59678dd733fb3de93493a91f472ca1365': {
    name: 'Nouns DAO Data',
    kind: 'dao-contract',
    description: 'Proposal candidates and feedback',
    source: 'sdk',
  },
  '0x33a9c445fb4fb21f2c030a6b2d3e2f12d017bfac': {
    name: 'Nouns Descriptor',
    kind: 'dao-contract',
    description: 'Renders Noun art on-chain',
    source: 'sdk',
  },
  // ── Nounders ──
  [NOUNDERS]: {
    name: 'nounders.eth',
    kind: 'nounders',
    description: "Nounders multisig — receives every 10th Noun for the project's first 5 years",
    source: 'ens',
    note: 'nounders.eth resolves here; NounsToken.noundersDAO()',
  },
};

export function knownAddress(addr: string): KnownAddress | undefined {
  return KNOWN_ADDRESSES[addr.toLowerCase()];
}
