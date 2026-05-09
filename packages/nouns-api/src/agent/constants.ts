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
// The single mutable branch the agent ships every commit onto. Netlify
// branch-deploys this to a fixed dev URL (DEV_NOUN_URL). Hard-coded — no env
// override — so a misconfigured deployment can never redirect the agent's
// pushes onto `main`/prod or any other branch. Each `applyAndDeploy` call
// fast-forwards `dev-noun` to a new commit; pip merges `dev-noun` → `main`
// manually after reviewing the live preview.
export const DEPLOY_BASE_BRANCH = 'dev-noun';

// Always-on Netlify URL that branch-deploys `dev-noun`. Reported back to the
// terminal user after every deploy so they can preview the change live and
// share the link with pip for review. Override via env when the Netlify
// branch-deploy URL is finalized.
export const DEV_NOUN_URL = process.env.DEV_NOUN_URL ?? 'https://dev-noun--noun-wtf.netlify.app';

// ─── Patch Safety ──────────────────────────────────────────────────────────
//
// Defence-in-depth against an LLM-generated (or prompt-injected) patch
// shipping malware. A determined attacker can probably evade pattern-matching,
// so the *primary* gate is the Netlify hook being opt-in (see
// NOUNIRL_AUTO_DEPLOY in deployer.ts) — this list is the secondary filter.
export const DEPLOY_MAX_PATCH_FILES = 5;
export const DEPLOY_MAX_PATCH_BYTES = 50_000;

// Files the agent must never touch — wallet/config/contract glue, top-level
// app entry points, route tables. Anything that controls money flow, env, or
// where the user lands. Suffix-match against the patch path.
export const DEPLOY_DENY_PATH_SUFFIXES = [
  '/config.ts',
  '/wagmi.ts',
  '/App.tsx',
  '/main.tsx',
  '/index.tsx',
  '/store.ts',
] as const;

// Source-content patterns that almost never appear in legitimate edits and
// are common in injection / exfiltration payloads. Each entry blocks the
// patch with the given reason. Intentionally conservative — false positives
// are recoverable (re-prompt the agent), false negatives ship malware.
export const DEPLOY_DENY_SOURCE_PATTERNS: ReadonlyArray<{ re: RegExp; reason: string }> = [
  { re: /\beval\s*\(/, reason: 'eval()' },
  { re: /\bnew\s+Function\s*\(/, reason: 'new Function() constructor' },
  { re: /\bdangerouslySetInnerHTML\b/, reason: 'dangerouslySetInnerHTML' },
  { re: /<script\b[^>]*\bsrc\s*=/i, reason: 'remote <script src>' },
  { re: /\bimport\s*\(\s*["'`]https?:\/\//, reason: 'dynamic import() of remote URL' },
  { re: /\bfrom\s+["'`]https?:\/\//, reason: 'static import from remote URL' },
  { re: /\bdata:text\/html/i, reason: 'data:text/html URI' },
  { re: /["'`]\s*javascript:/i, reason: 'javascript: URL scheme' },
  // Hardcoded external redirect — covers obvious phishing redirects. Internal
  // route changes use react-router, not window.location.
  {
    re: /window\.location(?:\.[a-z]+)?\s*=\s*["'`]https?:\/\//i,
    reason: 'hardcoded window.location external redirect',
  },
];
