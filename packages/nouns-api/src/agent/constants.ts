// ─── Agent NounIRL — Constants ──────────────────────────────────────────────

// Chain-aware: set NOUNIRL_CHAIN=sepolia to run on testnet
export const NOUNIRL_CHAIN = (process.env.NOUNIRL_CHAIN || 'mainnet') as 'mainnet' | 'sepolia';
const IS_SEPOLIA = NOUNIRL_CHAIN === 'sepolia';

// Nouns Auction House V2
export const AUCTION_HOUSE_ADDRESS = IS_SEPOLIA
  ? ('0x488609b7113FCf3B761A05956300d605E8f6BcAf' as const)
  : ('0x830BD73E4184ceF73443C15111a1DF14e495C706' as const);

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
export const AGENT_RPC_URL =
  process.env.NOUNIRL_RPC_URL ||
  (IS_SEPOLIA
    ? 'https://ethereum-sepolia-rpc.publicnode.com'
    : 'https://ethereum-rpc.publicnode.com');

// NounsToken contract — for Noun-gated access control
export const NOUNS_TOKEN_ADDRESS = IS_SEPOLIA
  ? ('0x4C4674bb72a096855496a7204962297bd7e12b85' as const)
  : ('0x9C8fF314C9Bc7F6e59A9d9225Fb22946427eDC03' as const);
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
export const GITHUB_REPO = process.env.GITHUB_REPO || 'snaveoguh/noun-wtf';
