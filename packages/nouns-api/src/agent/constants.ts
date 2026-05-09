// ─── Agent NounIRL — Constants ──────────────────────────────────────────────

// Nouns DAO V1 — Auction House V2 contract (mainnet)
// (V1 in this file means "the original Nouns DAO". The contract is internally
// versioned NounsAuctionHouseV2 — that's separate from the new Nouns DAO V2 launch.)
export const AUCTION_HOUSE_ADDRESS = '0x830BD73E4184ceF73443C15111a1DF14e495C706' as const;

// Nouns DAO V2 — newly launched DAO (2026-04-24). Same auction-house function
// signatures (settleCurrentAndCreateNewAuction, auction(), etc.) — only addresses
// differ, so the existing AUCTION_HOUSE_ABI works for both.
export const AUCTION_HOUSE_V2_ADDRESS = '0x9a6ddb16e23967d5482e5bfd7444a04a5d5145fc' as const;
export const NOUNS_TOKEN_V2_ADDRESS = '0xb1d6bdf9326dd09183c2e9d25af5e22c637293b9' as const;

// ─── DAO Selector ──────────────────────────────────────────────────────────
// The bot watches one DAO at a time. Pick via NOUNIRL_WATCH_DAO env var.
// To run both, deploy two instances of the agent service with different values.
export type WatchedDao = 'v1' | 'v2';

function parseWatchedDao(): WatchedDao {
  const raw = (process.env.NOUNIRL_WATCH_DAO ?? 'v1').trim().toLowerCase();
  if (raw === 'v1' || raw === 'v2') return raw;
  console.warn(
    `[NounIRL] Invalid NOUNIRL_WATCH_DAO="${raw}" — must be 'v1' or 'v2'. Defaulting to 'v1'.`,
  );
  return 'v1';
}

export const WATCHED_DAO: WatchedDao = parseWatchedDao();

export function selectAddresses(dao: WatchedDao): {
  auctionHouse: `0x${string}`;
  token: `0x${string}`;
} {
  if (dao === 'v2') {
    return {
      auctionHouse: AUCTION_HOUSE_V2_ADDRESS,
      token: NOUNS_TOKEN_V2_ADDRESS,
    };
  }
  return {
    auctionHouse: AUCTION_HOUSE_ADDRESS,
    token: NOUNS_TOKEN_ADDRESS,
  };
}

// NounIRL agent wallet — resolved from nounirl.eth
// Set via NOUNIRL_ADDRESS env var at runtime
export const getNounIrlAddress = (): string => {
  const addr = process.env.NOUNIRL_ADDRESS;
  if (!addr) throw new Error('NOUNIRL_ADDRESS env var not set');
  return addr;
};

// ─── Trait Counts (from NounsDescriptorV2 @ 0x33A9c445fb4FB21f2c030A6b2d3e2F12D017BFAC) ──
// These mirror the on-chain descriptor's count functions.
// Queried: 2026-03-08 — counts MUST match on-chain or predictions are wrong.
export const TRAIT_COUNTS = {
  background: 2,
  body: 31,
  accessory: 144,
  head: 258,
  glasses: 24,
} as const;

// ─── Supported Chains for Omnichain Tips ───────────────────────────────────
export const SUPPORTED_CHAINS: Record<number, { name: string; rpc: string }> = {
  1: { name: 'Ethereum', rpc: 'https://ethereum-rpc.publicnode.com' },
  8453: { name: 'Base', rpc: 'https://base-rpc.publicnode.com' },
  10: { name: 'Optimism', rpc: 'https://optimism-rpc.publicnode.com' },
  42161: { name: 'Arbitrum', rpc: 'https://arbitrum-one-rpc.publicnode.com' },
  7777777: { name: 'Zora', rpc: 'https://rpc.zora.energy' },
};

// ─── Minimum Tip ───────────────────────────────────────────────────────────
// ~$5 worth of ETH — at $2500/ETH that's 0.002 ETH.
// We use a conservative floor; if ETH moons the agent gets more tips.
export const MIN_TIP_ETH = 0.002;

// ─── Auction House ABI (minimal — only what the agent needs) ───────────────
export const AUCTION_HOUSE_ABI = [
  {
    type: 'function',
    name: 'auction',
    inputs: [],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'nounId', type: 'uint96' },
          { name: 'amount', type: 'uint128' },
          { name: 'startTime', type: 'uint40' },
          { name: 'endTime', type: 'uint40' },
          { name: 'bidder', type: 'address' },
          { name: 'settled', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'settleCurrentAndCreateNewAuction',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

// ─── Block Watcher Config ──────────────────────────────────────────────────
export const BLOCK_POLL_INTERVAL_MS = 1_000; // 1s poll — settlement window is 1 block (~12s)
export const SAFETY_NET_POLL_INTERVAL_MS = 30_000; // 30s backup poll when WS is active

// Agent uses a FREE public RPC for its HTTP calls (auction reads, nonce checks, block polls).
// This avoids competing with Ponder for the Infura rate limit.
export const AGENT_RPC_URL = process.env.NOUNIRL_RPC_URL || 'https://ethereum-rpc.publicnode.com';

// NounsToken contract (mainnet) — for Noun-gated access control
export const NOUNS_TOKEN_ADDRESS = '0x9C8fF314C9Bc7F6e59A9d9225Fb22946427eDC03' as const;
export const NOUNS_TOKEN_ABI = [
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'seeds',
    inputs: [{ name: 'nounId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'background', type: 'uint48' },
          { name: 'body', type: 'uint48' },
          { name: 'accessory', type: 'uint48' },
          { name: 'head', type: 'uint48' },
          { name: 'glasses', type: 'uint48' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const;

// Minimum Nouns held to use deploy_code
export const MIN_NOUNS_FOR_DEPLOY = 4;

// ─── Deploy Config ─────────────────────────────────────────────────────────
export const MAX_DEPLOYS_PER_HOUR = 1;
export const DEPLOY_ALLOWED_PATHS = ['packages/nouns-webapp/src/'] as const;
export const GITHUB_REPO = process.env.GITHUB_REPO || 'mshrmstudio/noun-wtf';
