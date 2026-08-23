// ─── Agent NounIRL — Block Watcher (SPEED-OPTIMIZED, DUAL-DAO) ──────────────
//
// LATENCY BUDGET: <2 seconds from block seen → tx broadcast
//
// SPEED ARCHITECTURE:
// 1. MULTI-PROVIDER WEBSOCKET RACE: Subscribe to N providers simultaneously.
//    First block header wins. Cuts latency from "slowest provider" to "fastest".
// 2. PRE-ENCODED CALLDATA: Settlement tx calldata is constant (no args).
//    Pre-encode once, reuse forever.
// 3. LOCAL NONCE TRACKING: Keep nonce in memory, increment on settlement.
//    Avoids eth_getTransactionCount RPC call on critical path.
// 4. MULTI-BUILDER FAN-OUT: To land in the EXACT next block, blast the same
//    signed raw tx to many endpoints at once — public RPCs (mempool reach) +
//    the major block builders directly (beaverbuild, Titan, rsync, Flashbots).
//    One RPC gossips too slowly; Flashbots Protect alone DEFERS inclusion across
//    blocks. Fanning out maximises the chance whoever builds N+1 already has it.
// 5. ADAPTIVE AUCTION CACHE: Near auction end (<60s), poll every 3s instead of 15s.
//    Ensures fresh auction state when settlement window opens.
// 6. PRE-SIGNED RAW TX: Sign settlement tx in advance with predicted nonce + gas.
//    On match: just broadcast — skip encode+sign step (~100-200ms saved). The tx
//    hash is deterministic from the signed bytes, so we return it locally with
//    ZERO RPC round-trips on the hot path (broadcasts run in the background).
//
// DUAL-DAO (2026-08-01): ONE process watches BOTH Nouns DAO V1 and NounV2 off
// the SAME block subscription. Each block header drives per-DAO processing —
// separate auction caches, predictions, standing targets, pre-signed txs and
// re-fire guards — replacing the old "one process = one DAO" NOUNIRL_WATCH_DAO
// switch. Both DAOs share the nounirl wallet, so settle fires are serialized
// through an in-process queue: simultaneous V1+V2 matches can never broadcast
// two txs with the same nonce.
//
// RESULT: Most blocks process in <1ms per DAO (pure math + cache).
// Settlement path: hot-path broadcast is non-blocking; tx hits all builders at once.

import {
  createPublicClient,
  createWalletClient,
  http,
  webSocket,
  encodeFunctionData,
  parseGwei,
  keccak256,
  type PublicClient,
  type WalletClient,
  type Hex,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';

import { bridgePublish } from './bridge.js';
import {
  AUCTION_HOUSE_ABI,
  NOUNS_TOKEN_ABI,
  BLOCK_POLL_INTERVAL_MS,
  SAFETY_NET_POLL_INTERVAL_MS,
  AGENT_RPC_URL,
  DAOS,
  LEGACY_WATCH_DAO,
  selectAddresses,
  type WatchedDao,
} from './constants.js';
import { reservationStore, type Reservation } from './reservations.js';
import {
  predictSeed,
  seedToTraitNames,
  matchesTraits,
  type NounSeed,
  type TraitNames,
} from './traitPredictor.js';

// ─── Standing Trait Targets (per DAO) ─────────────────────────────────────
// Traits the bot ALWAYS hunts, tip or no tip. Unlike reservations these are
// never consumed — every time the next noun would mint with a matching combo
// and the auction has ended, the bot fires.
//
// SYNTAX (within one DAO's spec)
//   "category:Name"        one condition
//   "a:X+b:Y"              AND — every condition must hold
//   "a:X+b:Y,c:Z"          OR of groups (comma separates groups)
//   "off"                  disable standing targets for that DAO
//
// e.g. head:Index card+accessory:Grease,head:Retainer+accessory:Grease,head:Joker
//   -> (Index card AND Grease) OR (Retainer AND Grease) OR Joker
//
// CONFIG SOURCES, per DAO, first match wins:
//   1. NOUNIRL_STANDING_TRAITS_V1 / NOUNIRL_STANDING_TRAITS_V2
//   2. Legacy NOUNIRL_STANDING_TRAITS — groups may carry a "v1:"/"v2:" prefix;
//      un-prefixed groups apply to the DAO the (retired) NOUNIRL_WATCH_DAO var
//      names, else v1. This keeps a pre-dual-DAO deployment (e.g. the live
//      "hunt V2 slobber combos" config with NOUNIRL_WATCH_DAO=v2) working
//      unchanged. A DAO that gets no legacy groups falls through to 3.
//   3. Defaults: v1 → "head:wall" (the historic default), v2 → none.
//
// Names are the DISPLAY form produced by seedToTraitNames() — "head-index-card"
// becomes "Index card" (space, not hyphen). Matching is exact + case-insensitive
// rather than substring, because "head:Wall" must not also fire on Wallet or
// Wallsafe.
const STANDING_RESERVATION_PREFIX = 'standing';

function standingReservationId(dao: WatchedDao): string {
  return `${STANDING_RESERVATION_PREFIX}-${dao}`;
}

function isStandingReservationId(id: string): boolean {
  return id.startsWith(STANDING_RESERVATION_PREFIX);
}

type StandingCondition = { category: keyof TraitNames; wanted: string };
/** Outer array = OR of groups; inner array = AND of conditions. */
type StandingGroup = StandingCondition[];

const OFF_VALUES = ['off', 'none', 'false', '0'];

const DEFAULT_STANDING_SPECS: Record<WatchedDao, string[]> = {
  v1: ['head:wall'],
  v2: [],
};

function splitSpecs(raw: string): string[] {
  return raw
    .split(',')
    .map(t => t.trim())
    .filter(t => t.includes(':'));
}

function resolveStandingSpecs(dao: WatchedDao): string[] {
  // 1. Per-DAO env var wins outright.
  const perDaoRaw = (
    process.env[dao === 'v1' ? 'NOUNIRL_STANDING_TRAITS_V1' : 'NOUNIRL_STANDING_TRAITS_V2'] ?? ''
  ).trim();
  if (perDaoRaw) {
    if (OFF_VALUES.includes(perDaoRaw.toLowerCase())) return [];
    return splitSpecs(perDaoRaw);
  }

  // 2. Legacy single-DAO var, with optional per-group v1:/v2: prefixes.
  const legacyRaw = (process.env.NOUNIRL_STANDING_TRAITS ?? '').trim();
  const legacyDao: WatchedDao = LEGACY_WATCH_DAO ?? 'v1';
  if (legacyRaw) {
    if (OFF_VALUES.includes(legacyRaw.toLowerCase())) {
      // Legacy "off" governs only the DAO the legacy deployment watched.
      if (dao === legacyDao) return [];
      return DEFAULT_STANDING_SPECS[dao];
    }
    const mine: string[] = [];
    for (const group of legacyRaw
      .split(',')
      .map(t => t.trim())
      .filter(Boolean)) {
      const prefixMatch = group.match(/^(v1|v2):(.+)$/i);
      if (prefixMatch) {
        if (prefixMatch[1]!.toLowerCase() === dao && prefixMatch[2]!.includes(':')) {
          mine.push(prefixMatch[2]!.trim());
        }
      } else if (dao === legacyDao && group.includes(':')) {
        mine.push(group);
      }
    }
    if (mine.length > 0) return mine;
  }

  // 3. Defaults.
  return DEFAULT_STANDING_SPECS[dao];
}

function parseStandingGroups(specs: string[]): StandingGroup[] {
  return specs
    .map(spec =>
      spec
        .split('+')
        .map(part => part.trim())
        .filter(part => part.includes(':'))
        .map(part => {
          const colonIdx = part.indexOf(':');
          return {
            category: part.slice(0, colonIdx).trim().toLowerCase() as keyof TraitNames,
            wanted: part
              .slice(colonIdx + 1)
              .trim()
              .toLowerCase(),
          };
        }),
    )
    .filter(group => group.length > 0);
}

// ─── Settlement Config ────────────────────────────────────────────────────
// Preflight balance check on the RPC requires `balance >= gasLimit * maxFeePerGas`.
// Settlement actually burns ~250-350k gas at near-base-fee. The old 600k × 200 gwei
// reserved 0.12 ETH up front — bot was permanently locked out unless funded heavily.
const SETTLEMENT_GAS_LIMIT = 500_000n;
const SETTLEMENT_PRIORITY_FEE = parseGwei('5');
const SETTLEMENT_MAX_FEE = parseGwei('20');

// Pre-encoded calldata — settleCurrentAndCreateNewAuction() takes no args and
// has the same signature on both auction houses. Encode once, reuse forever.
const SETTLEMENT_CALLDATA = encodeFunctionData({
  abi: AUCTION_HOUSE_ABI,
  functionName: 'settleCurrentAndCreateNewAuction',
});

// Optional exact-block guard. When NOUNIRL_SETTLER_ADDRESS is set, targeted
// settles route through ExactBlockSettler.settleAtBlock(auctionHouse, target),
// which reverts (~25k gas) unless the tx lands in EXACTLY the target block.
// The minted noun's seed comes from blockhash(block.number - 1), so a settle
// landing one block late mints a different noun than predicted — this guard
// turns that into a cheap revert instead (see Noun #1984: predicted Wall,
// landed 1 block late, got Porkbao). Contract: contracts/ExactBlockSettler.sol.
// Stateless + takes the auction house as an arg, so ONE deployment serves both
// DAOs. Unset → legacy direct-to-AH behaviour, including the manual settle
// endpoint.
const EXACT_BLOCK_SETTLER = ((): Hex | null => {
  const raw = (process.env.NOUNIRL_SETTLER_ADDRESS ?? '').trim();
  return /^0x[0-9a-fA-F]{40}$/.test(raw) ? (raw as Hex) : null;
})();
const SETTLER_ABI = [
  {
    type: 'function',
    name: 'settleAtBlock',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'auctionHouse', type: 'address' },
      { name: 'targetBlock', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;
if (EXACT_BLOCK_SETTLER) {
  console.log(`[NounIRL] Exact-block settle guard active: ${EXACT_BLOCK_SETTLER}`);
}

// ─── Multi-Provider Config ───────────────────────────────────────────────
// Race every endpoint, first block header wins.
//
// ⚠️ 2026-07-30: this list used to be free-tier ONLY — publicnode (which began
// 403'ing anonymous traffic 2026-07-25) and eth.drpc.org (free tier, observed
// serving blocks BEHIND the tip: "requested block range [N] is beyond latest
// executed block [N-1]"). A watcher that sees block N late cannot land a tx IN
// block N, so the snipe path silently degraded to blind settling and the
// wall-head streak (nouns 1970-1975) died.
//
// The PAID dRPC websocket already exists in this environment as PONDER_WS_URL_1
// but was never given to the watcher. Put it FIRST; keep the free ones as
// redundancy since the race takes whichever header arrives first.
const WS_ENDPOINTS: string[] = (() => {
  const explicit = (process.env.NOUNIRL_WS_URLS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (explicit.length > 0) return explicit;

  const paid = [process.env.NOUNIRL_WS_URL, process.env.PONDER_WS_URL_1].filter(
    (u): u is string => typeof u === 'string' && u.startsWith('ws'),
  );
  return [...paid, 'wss://ethereum-rpc.publicnode.com', 'wss://eth.drpc.org'];
})();

// ─── Settlement Broadcast Fan-Out ─────────────────────────────────────────
// A settlement tx has NO MEV to protect (the noun goes to the winning bidder
// regardless of who calls settle), so there's no reason to route through
// Flashbots Protect alone — and Protect deliberately holds/retries a tx across
// many blocks rather than targeting the next one, which is exactly how we were
// missing by 1-3 blocks. A single free-RPC mempool send is no better: it
// gossips slowly and may never reach the builder that wins N+1.
//
// Fix: blast the SAME signed raw tx at every endpoint simultaneously — several
// public RPCs for mempool reach PLUS the major builders directly (they build
// the large majority of blocks). All references are the same tx hash, so
// there's no double-send risk; whichever path lands it first wins.
// Direct builder submission endpoints. All three were verified live + accepting
// `eth_sendRawTransaction` (2026-06-05). Builders only implement the send method
// (generic calls like eth_chainId return method-not-found), which is exactly
// what we need. These few builders build the large majority of mainnet blocks.
const SETTLEMENT_BUILDER_ENDPOINTS = [
  'https://rpc.flashbots.net', // Flashbots — now just one of many, not relied on / not first
  'https://rpc.beaverbuild.org', // beaverbuild — top builder by block share
  'https://rpc.titanbuilder.xyz', // Titan
];

// Public mempool RPCs — verified returning chainId 0x1 (2026-06-05). Dead/HTML
// endpoints (merkle.io, rsync-builder, payload.de, securerpc, llamarpc) were
// dropped after a reachability sweep. A failed endpoint is logged + ignored, so
// this list degrading over time costs reach but never blocks settlement.
const SETTLEMENT_PUBLIC_RPCS = [
  'https://ethereum-rpc.publicnode.com',
  'https://1rpc.io/eth',
  'https://cloudflare-eth.com',
  'https://eth.drpc.org',
];

// dRPC/paid endpoint (AGENT_RPC_URL) first, then the public RPCs for mempool
// reach, then the builders direct. Deduped so a custom AGENT_RPC_URL that equals
// a listed node isn't hit twice.
function settlementBroadcastEndpoints(): string[] {
  return [...new Set([AGENT_RPC_URL, ...SETTLEMENT_PUBLIC_RPCS, ...SETTLEMENT_BUILDER_ENDPOINTS])];
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

// ─── State ─────────────────────────────────────────────────────────────────

interface AuctionState {
  nounId: number;
  endTime: number;
  settled: boolean;
  amount: bigint;
  bidder: string;
}

/** Everything the watcher tracks separately per DAO. */
interface DaoWatchState {
  dao: WatchedDao;
  auctionHouse: `0x${string}`;
  token: `0x${string}`;
  nextNounId: number;
  auctionEndTime: number;
  lastPredictedSeed: NounSeed | null;
  lastPredictedTraits: TraitNames | null;
  // Auction cache
  cachedAuction: AuctionState | null;
  cachedAuctionAt: number;
  // Pre-signed settlement tx (both DAOs pre-sign at the SAME wallet nonce; at
  // most one of them can land, the other falls back to a fresh sign — see
  // settleAuction's serialization queue).
  preSignedTx: Hex | null;
  preSignedNonce: number | null;
  preSignedAt: number;
  // Re-fire guard — once we've broadcast a settle for a given noun, don't fire
  // again for the SAME noun on the next block ticks while the receipt is still
  // pending. (We dropped the forced pre-fire `auction()` RPC read to trim
  // hot-path latency; this guard replaces the double-fire protection it gave
  // us. It clears naturally once the auction advances to a new nounId.)
  lastFiredNounId: number;
  lastFiredAt: number;
  // Standing targets
  standingSpecs: string[];
  standingGroups: StandingGroup[];
}

function initDaoState(dao: WatchedDao): DaoWatchState {
  const { auctionHouse, token } = selectAddresses(dao);
  const standingSpecs = resolveStandingSpecs(dao);
  return {
    dao,
    auctionHouse,
    token,
    nextNounId: 0,
    auctionEndTime: 0,
    lastPredictedSeed: null,
    lastPredictedTraits: null,
    cachedAuction: null,
    cachedAuctionAt: 0,
    preSignedTx: null,
    preSignedNonce: null,
    preSignedAt: 0,
    lastFiredNounId: 0,
    lastFiredAt: 0,
    standingSpecs,
    standingGroups: parseStandingGroups(standingSpecs),
  };
}

const daoStates: Record<WatchedDao, DaoWatchState> = {
  v1: initDaoState('v1'),
  v2: initDaoState('v2'),
};

for (const dao of DAOS) {
  const ds = daoStates[dao];
  console.log(
    `[NounIRL] Watching ${dao.toUpperCase()} — auctionHouse=${ds.auctionHouse} token=${ds.token}`,
  );
  if (ds.standingGroups.length > 0) {
    console.log(
      `[NounIRL] ${dao.toUpperCase()} standing trait targets (${ds.standingGroups.length} rule(s)): ` +
        ds.standingGroups
          .map(g => g.map(c => `${c.category}=${c.wanted}`).join(' AND '))
          .join(' OR '),
    );
  } else {
    console.log(`[NounIRL] ${dao.toUpperCase()} standing trait targets: none`);
  }
}

interface WatcherState {
  running: boolean;
  lastBlockNumber: number;
  lastBlockHash: Hex | null;
  lastCheckedAt: number;
  totalBlocksChecked: number;
  transportMode: 'websocket' | 'http-poll' | 'none';
  wsProviderCount: number;
  blockLatencyMs: number;
  errors: string[];
}

const state: WatcherState = {
  running: false,
  lastBlockNumber: 0,
  lastBlockHash: null,
  lastCheckedAt: 0,
  totalBlocksChecked: 0,
  transportMode: 'none',
  wsProviderCount: 0,
  blockLatencyMs: 0,
  errors: [],
};

function pushError(msg: string): void {
  state.errors.push(msg);
  if (state.errors.length > 50) state.errors.shift();
}

let pollTimer: ReturnType<typeof setInterval> | null = null;
let wsUnsubscribers: (() => void)[] = [];
let publicClient: PublicClient | null = null;
let walletClient: WalletClient | null = null;
let agentAccount: PrivateKeyAccount | null = null;

// Local nonce tracking — ONE wallet serves both DAOs, so this is shared.
let localNonce: number | null = null;
let nonceRefreshedAt = 0;
const NONCE_REFRESH_TTL = 30_000;

const PRE_SIGN_TTL = 12_000; // refresh every ~1 block
const REFIRE_GUARD_MS = 24_000; // ~2 blocks

export function matchesStandingTraits(dao: WatchedDao, traitNames: TraitNames): boolean {
  // OR across groups, AND within a group.
  return daoStates[dao].standingGroups.some(group =>
    group.every(c => traitNames[c.category]?.toLowerCase() === c.wanted),
  );
}

function standingReservation(dao: WatchedDao): Reservation {
  const ds = daoStates[dao];
  return {
    id: standingReservationId(dao),
    wallet: process.env.NOUNIRL_ADDRESS ?? '0x0',
    tipTxHash: '',
    tipChainId: 1,
    tipAmountEth: 0,
    traits: ds.standingSpecs,
    dao,
    status: 'active',
    createdAt: 0,
  };
}

// ─── Init ──────────────────────────────────────────────────────────────────

function initClients(): boolean {
  // Agent uses its own RPC (free public node by default) to avoid
  // competing with Ponder for the Infura rate limit.
  const rpcUrl = AGENT_RPC_URL;

  publicClient = createPublicClient({
    chain: mainnet,
    transport: http(rpcUrl),
  });

  const privateKey = process.env.NOUNIRL_PRIVATE_KEY;
  if (privateKey) {
    try {
      agentAccount = privateKeyToAccount(privateKey as Hex);
      walletClient = createWalletClient({
        chain: mainnet,
        transport: http(rpcUrl),
        account: agentAccount,
      });
      console.log(`[NounIRL] Wallet initialized: ${agentAccount.address}`);
    } catch (err) {
      console.error('[NounIRL] Failed to init wallet:', err);
      return false;
    }
  } else {
    console.warn('[NounIRL] No NOUNIRL_PRIVATE_KEY — running in read-only mode');
  }

  return true;
}

// ─── Local Nonce Management ──────────────────────────────────────────────

async function getLocalNonce(): Promise<number> {
  const now = Date.now();
  if (localNonce !== null && now - nonceRefreshedAt < NONCE_REFRESH_TTL) {
    return localNonce;
  }

  if (!publicClient || !agentAccount) return 0;

  try {
    const count = await publicClient.getTransactionCount({
      address: agentAccount.address,
    });
    localNonce = count;
    nonceRefreshedAt = now;
    return count;
  } catch {
    return localNonce ?? 0;
  }
}

// ─── Pre-Sign Settlement Transactions ────────────────────────────────────
// Both DAOs get a pre-signed settle tx at the SAME (current) nonce. Only one
// of them can ever land at that nonce; if both DAOs match in the same block
// the serialized settle queue fires the first with the pre-signed tx and the
// second detects the stale nonce and fresh-signs at nonce+1.

async function refreshPreSignedTxs(): Promise<void> {
  if (!agentAccount || !publicClient) return;

  try {
    const nonce = await getLocalNonce();

    for (const dao of DAOS) {
      const ds = daoStates[dao];
      const signed = await agentAccount.signTransaction({
        to: ds.auctionHouse,
        data: SETTLEMENT_CALLDATA,
        gas: SETTLEMENT_GAS_LIMIT,
        maxFeePerGas: SETTLEMENT_MAX_FEE,
        maxPriorityFeePerGas: SETTLEMENT_PRIORITY_FEE,
        nonce,
        chainId: 1,
        type: 'eip1559' as const,
      });
      ds.preSignedTx = signed;
      ds.preSignedNonce = nonce;
      ds.preSignedAt = Date.now();
    }
  } catch (err) {
    console.error('[NounIRL] Pre-sign failed:', err instanceof Error ? err.message : err);
  }
}

function invalidatePreSignedTxs(): void {
  for (const dao of DAOS) {
    const ds = daoStates[dao];
    ds.preSignedTx = null;
    ds.preSignedNonce = null;
  }
}

// ─── Auction State ──────────────────────────────────────────────────────

function getAuctionCacheTTL(ds: DaoWatchState): number {
  if (!ds.cachedAuction) return 0;
  const secsToEnd = ds.cachedAuction.endTime - Math.floor(Date.now() / 1000);
  if (secsToEnd <= 60 && secsToEnd > 0) return 3_000; // HOT ZONE
  if (secsToEnd <= 0) return 1_000; // ENDED
  return 15_000; // Normal
}

async function getCurrentAuction(
  dao: WatchedDao,
  forceRefresh = false,
): Promise<AuctionState | null> {
  if (!publicClient) return null;

  const ds = daoStates[dao];
  const now = Date.now();
  const ttl = getAuctionCacheTTL(ds);
  if (!forceRefresh && ds.cachedAuction && now - ds.cachedAuctionAt < ttl) {
    return ds.cachedAuction;
  }

  try {
    const result = await publicClient.readContract({
      address: ds.auctionHouse,
      abi: AUCTION_HOUSE_ABI,
      functionName: 'auction',
    });

    const r = result as unknown as {
      nounId: bigint;
      amount: bigint;
      startTime: number;
      endTime: number;
      bidder: string;
      settled: boolean;
    };

    ds.cachedAuction = {
      nounId: Number(r.nounId),
      endTime: Number(r.endTime),
      settled: r.settled,
      amount: r.amount,
      bidder: r.bidder,
    };
    ds.cachedAuctionAt = now;
    ds.auctionEndTime = ds.cachedAuction.endTime;

    return ds.cachedAuction;
  } catch (err) {
    console.error(`[NounIRL] Failed to read ${dao} auction:`, err);
    return ds.cachedAuction;
  }
}

// ─── Settlement (ULTRA-FAST PATH, SERIALIZED ACROSS DAOS) ────────────────
// Both DAOs spend from the same wallet. A single in-process queue serializes
// every settle fire so two matches in the same block can never broadcast two
// txs with the same nonce — the second fire sees the incremented localNonce
// and fresh-signs.

let settleQueue: Promise<unknown> = Promise.resolve();

export interface SettleOptions {
  /**
   * Block the settle MUST land in. Only honoured when NOUNIRL_SETTLER_ADDRESS
   * is configured — the tx then routes through ExactBlockSettler.settleAtBlock
   * and reverts if it misses the slot, instead of minting a mis-seeded noun.
   * Omitted (manual settles): plain direct-to-AH settle, lands whenever.
   */
  targetBlock?: number;
}

export async function settleAuction(
  dao: WatchedDao = 'v1',
  opts?: SettleOptions,
): Promise<{ txHash: string; guarded: boolean } | null> {
  const run = settleQueue.then(() => doSettleAuction(dao, opts));
  // The queue itself must never reject, or one failure would poison all
  // subsequent fires.
  settleQueue = run.catch(() => undefined);
  return run;
}

async function doSettleAuction(
  dao: WatchedDao,
  opts?: SettleOptions,
): Promise<{ txHash: string; guarded: boolean } | null> {
  if (!walletClient || !publicClient || !agentAccount) {
    console.error('[NounIRL] Cannot settle — wallet not configured');
    return null;
  }

  const ds = daoStates[dao];
  const t0 = Date.now();
  const guarded = Boolean(EXACT_BLOCK_SETTLER && opts?.targetBlock);

  try {
    console.log(
      `[NounIRL] 🔥 SETTLING ${dao.toUpperCase()} — pre-signed: ${ds.preSignedTx ? 'YES' : 'NO'}${guarded ? ` (guarded → block ${opts?.targetBlock})` : ''}`,
    );

    let signedTx: Hex;

    const currentNonce = await getLocalNonce();
    if (guarded && EXACT_BLOCK_SETTLER && opts?.targetBlock) {
      // GUARDED PATH: fresh-sign a settleAtBlock() call. Can't use the
      // pre-signed tx (target block is only known now); local signing costs
      // ~1-2ms, which is noise next to broadcast latency.
      signedTx = await agentAccount.signTransaction({
        to: EXACT_BLOCK_SETTLER,
        data: encodeFunctionData({
          abi: SETTLER_ABI,
          functionName: 'settleAtBlock',
          args: [ds.auctionHouse, BigInt(opts.targetBlock)],
        }),
        gas: SETTLEMENT_GAS_LIMIT,
        maxFeePerGas: SETTLEMENT_MAX_FEE,
        maxPriorityFeePerGas: SETTLEMENT_PRIORITY_FEE,
        nonce: currentNonce,
        chainId: 1,
        type: 'eip1559' as const,
      });
    } else if (
      // FAST PATH: Use pre-signed transaction if nonce is still valid
      ds.preSignedTx &&
      ds.preSignedNonce === currentNonce &&
      Date.now() - ds.preSignedAt < PRE_SIGN_TTL * 3
    ) {
      console.log(`[NounIRL] Using pre-signed ${dao} tx (nonce ${currentNonce})`);
      signedTx = ds.preSignedTx;
    } else {
      // FALLBACK: Fresh sign with the current nonce, then fan out the same way.
      console.log(
        `[NounIRL] Fresh sign for ${dao} (nonce stale: expected ${ds.preSignedNonce}, got ${currentNonce})`,
      );
      signedTx = await agentAccount.signTransaction({
        to: ds.auctionHouse,
        data: SETTLEMENT_CALLDATA,
        gas: SETTLEMENT_GAS_LIMIT,
        maxFeePerGas: SETTLEMENT_MAX_FEE,
        maxPriorityFeePerGas: SETTLEMENT_PRIORITY_FEE,
        nonce: currentNonce,
        chainId: 1,
        type: 'eip1559' as const,
      });
    }

    // Fan the signed tx out to every endpoint at once. Returns the (locally
    // computed) hash immediately — no RPC round-trip on the hot path.
    const hash = broadcastRawTx(signedTx);

    // Update local nonce + invalidate BOTH DAOs' pre-signed txs (they were
    // signed at the now-consumed nonce).
    if (localNonce !== null) localNonce++;
    invalidatePreSignedTxs();

    const txTime = Date.now() - t0;
    console.log(
      `[NounIRL] ✅ ${dao.toUpperCase()} settlement tx assembled + fanned out in ${txTime}ms: ${hash}`,
    );

    return { txHash: hash, guarded };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[NounIRL] ${dao} settlement failed after ${Date.now() - t0}ms:`, msg);
    pushError(`${dao} settlement failed: ${msg}`);
    return null;
  }
}

// Blast the SAME signed raw tx at every public RPC + builder simultaneously.
// Returns the deterministic tx hash IMMEDIATELY (computed locally from the
// signed bytes) so the hot path never blocks on a network round-trip; the
// actual POSTs run in the background and log how many endpoints accepted.
// Never throws — one slow/dead endpoint must not block settlement.
function broadcastRawTx(signedTx: Hex): Hex {
  const hash = keccak256(signedTx);
  const endpoints = settlementBroadcastEndpoints();
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'eth_sendRawTransaction',
    params: [signedTx],
  });

  const started = Date.now();
  let accepted = 0;

  void Promise.allSettled(
    endpoints.map(async url => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3_000);
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
          signal: ctrl.signal,
        });
        const json = (await res.json()) as {
          result?: string;
          error?: { message?: string };
        };
        if (json.result) {
          accepted++;
        } else if (json.error) {
          // "already known" / "nonce too low" just mean another endpoint already
          // accepted the same tx — that's a success, not a failure.
          const m = json.error.message ?? '';
          if (/already known|nonce too low|already exists|known transaction/i.test(m)) {
            accepted++;
          } else {
            console.warn(`[NounIRL] broadcast ${hostOf(url)} rejected: ${m}`);
          }
        }
      } catch (err) {
        const m = err instanceof Error ? err.message : String(err);
        console.warn(`[NounIRL] broadcast ${hostOf(url)} failed: ${m}`);
      } finally {
        clearTimeout(timer);
      }
    }),
  ).then(() => {
    console.log(
      `[NounIRL] 📡 broadcast ${hash} → ${accepted}/${endpoints.length} endpoints accepted in ${Date.now() - started}ms`,
    );
  });

  return hash;
}

// ─── Block Processing ───────────────────────────────────────────────────

async function onNewBlock(
  blockNumber: bigint,
  blockHash: Hex,
  parentHash: Hex,
  blockTimestamp?: bigint,
): Promise<void> {
  if (!publicClient) return;

  const num = Number(blockNumber);
  if (num <= state.lastBlockNumber) return;

  if (blockTimestamp) {
    state.blockLatencyMs = Date.now() - Number(blockTimestamp) * 1000;
  }

  state.lastBlockNumber = num;
  state.lastBlockHash = blockHash;
  state.lastCheckedAt = Math.floor(Date.now() / 1000);
  state.totalBlocksChecked++;

  // Both DAOs process the same header concurrently — their state is fully
  // separate; only settle FIRES are serialized (nonce queue in settleAuction).
  await Promise.all(DAOS.map(dao => processDaoBlock(dao, num, blockHash, blockTimestamp)));
}

async function processDaoBlock(
  dao: WatchedDao,
  num: number,
  blockHash: Hex,
  blockTimestamp?: bigint,
): Promise<void> {
  const ds = daoStates[dao];
  const t0 = Date.now();

  try {
    const auction = await getCurrentAuction(dao);
    if (!auction) return;

    ds.auctionEndTime = auction.endTime;
    const now = Math.floor(Date.now() / 1000);
    const auctionEnded = now >= auction.endTime;

    const nextNounId = auction.nounId + 1;
    ds.nextNounId = nextNounId;

    // NounsSeeder uses blockhash(block.number - 1). If our settlement tx lands
    // in block N+1, the seeder uses hash(N) — which is the CURRENT block's hash.
    // Using parentHash (hash of N-1) predicts what was minted in THIS block,
    // not what would be minted in the NEXT block where our tx lands.
    const seed = predictSeed(blockHash, nextNounId, { dao });
    const traits = seedToTraitNames(seed, dao);

    ds.lastPredictedSeed = seed;
    ds.lastPredictedTraits = traits;

    // Only THIS DAO's reservations (plus its standing target) are eligible.
    const activeReservations: Reservation[] = reservationStore
      .getActive()
      .filter(r => r.dao === dao);
    if (ds.standingGroups.length > 0) activeReservations.push(standingReservation(dao));
    if (activeReservations.length === 0) return;

    for (const reservation of activeReservations) {
      const isStanding = isStandingReservationId(reservation.id);
      const isMatch = isStanding
        ? matchesStandingTraits(dao, traits)
        : matchesTraits(traits, reservation.traits);

      if (isMatch && auctionEnded) {
        // Skip if the auction we already have cached is settled, or if we just
        // fired for this same noun and are still waiting on the receipt. We do
        // NOT force-refresh auction() here — that RPC round-trip on the hot path
        // is what was eating into the slot. A stale settled-flag at worst costs a
        // cheap reverting tx; landing in the target block matters more.
        if (auction.settled) {
          console.log(`[NounIRL] ${dao} match found but auction already settled — skipping`);
          continue;
        }
        if (nextNounId === ds.lastFiredNounId && Date.now() - ds.lastFiredAt < REFIRE_GUARD_MS) {
          console.log(
            `[NounIRL] Already fired for ${dao} Noun #${nextNounId} ${Date.now() - ds.lastFiredAt}ms ago — awaiting receipt, not re-firing`,
          );
          continue;
        }

        // How far into slot N are we broadcasting? (lower = more of the ~12s
        // slot left for a builder to pick up our tx for block N+1.)
        const targetBlock = num + 1;
        const slotMs = blockTimestamp ? Date.now() - Number(blockTimestamp) * 1000 : null;
        console.log(
          `[NounIRL] 🎯 ${dao.toUpperCase()} MATCH in ${Date.now() - t0}ms! Noun #${nextNounId} → target block ${targetBlock}` +
            `${slotMs !== null ? ` (${slotMs}ms into slot ${num})` : ''} — ${JSON.stringify(traits)}`,
        );

        ds.lastFiredNounId = nextNounId;
        ds.lastFiredAt = Date.now();

        const result = await settleAuction(dao, { targetBlock });
        if (result) {
          // Record as pending — only confirm after receipt verification
          console.log(
            `[NounIRL] ⏳ ${dao} settlement tx broadcast for ${reservation.id} — awaiting confirmation...`,
          );

          ds.cachedAuction = null;
          ds.cachedAuctionAt = 0;

          // Capture values for the async callback
          const resId = reservation.id;
          const resWallet = reservation.wallet;
          const settledNounId = nextNounId;
          const settledTraits = { ...traits };
          const settledBlock = num;
          const firedTargetBlock = targetBlock;
          const txHash = result.txHash;
          const firedGuarded = result.guarded;

          // Wait for receipt, verify success, then verify actual onchain traits
          if (publicClient) {
            const pc = publicClient;
            void pc
              .waitForTransactionReceipt({ hash: txHash as `0x${string}` })
              .then(async receipt => {
                // TELEMETRY: did we land in the EXACT block we aimed for? A late
                // landing means the predicted seed (keyed on block N's hash) is
                // wrong — this is the "missed by N blocks" signal, now measured
                // instead of guessed.
                const landedBlock = Number(receipt.blockNumber);
                const blocksLate = landedBlock - firedTargetBlock;
                if (blocksLate === 0) {
                  console.log(
                    `[NounIRL] 🎯 Landed in TARGET block ${firedTargetBlock} — ${dao} Noun #${settledNounId} ✅ on time`,
                  );
                } else {
                  const lateMsg = `[NounIRL] ⏱️ Landed ${blocksLate} block(s) ${blocksLate > 0 ? 'LATE' : 'EARLY'} — target ${firedTargetBlock}, got ${landedBlock} (${dao} Noun #${settledNounId}, tx ${txHash})`;
                  console.warn(lateMsg);
                  pushError(
                    `${dao} settle landed ${blocksLate} block(s) off target for Noun #${settledNounId} (target ${firedTargetBlock}, got ${landedBlock})`,
                  );
                }

                if (receipt.status !== 'success') {
                  if (firedGuarded && blocksLate !== 0) {
                    // Working as designed: the guard refused to settle outside
                    // the target block, so the predicted noun was never minted
                    // wrong. Cost: ~25k gas. The hunt continues.
                    console.warn(
                      `[NounIRL] 🛡️ ${dao} guard reverted — missed target block ${firedTargetBlock} (landed ${landedBlock}). Mis-seeded settle averted for Noun #${settledNounId}, still hunting.`,
                    );
                    pushError(
                      `${dao} guard averted mis-seeded settle for Noun #${settledNounId} (missed block ${firedTargetBlock} by ${blocksLate})`,
                    );
                    // Clear this DAO's re-fire guard so the very next matching
                    // block can fire again — the auction is still unsettled.
                    ds.lastFiredNounId = -1;
                    ds.lastFiredAt = 0;
                  } else {
                    console.error(
                      `[NounIRL] ❌ Settlement tx REVERTED — ${dao} Noun #${settledNounId} tx ${txHash}. Someone else settled first.`,
                    );
                    pushError(`${dao} settlement reverted for Noun #${settledNounId}: ${txHash}`);
                  }
                  return; // Reservation stays active
                }

                // Tx succeeded on-chain — count it regardless of trait match.
                // This is the "did the bot land a settle?" counter. The
                // reservation-fulfilment counter (settlements[]) only ticks
                // below if actual traits also match the reservation.
                reservationStore.recordOnchainSettle({
                  txHash,
                  blockNumber: Number(receipt.blockNumber),
                  nounId: settledNounId,
                  matched: false, // flipped to true below if trait verification passes
                  reservationId: resId,
                  dao,
                  at: Math.floor(Date.now() / 1000),
                });

                // Tx succeeded — now verify actual traits match the reservation
                let actualTraits: TraitNames | null = null;
                try {
                  const onchainSeed = (await pc.readContract({
                    address: ds.token,
                    abi: NOUNS_TOKEN_ABI,
                    functionName: 'seeds',
                    args: [BigInt(settledNounId)],
                  })) as unknown as {
                    background: bigint;
                    body: bigint;
                    accessory: bigint;
                    head: bigint;
                    glasses: bigint;
                  };

                  const seed: NounSeed = {
                    background: Number(onchainSeed.background),
                    body: Number(onchainSeed.body),
                    accessory: Number(onchainSeed.accessory),
                    head: Number(onchainSeed.head),
                    glasses: Number(onchainSeed.glasses),
                  };
                  actualTraits = seedToTraitNames(seed, dao);
                } catch (err) {
                  console.warn(
                    `[NounIRL] Could not read onchain seed for ${dao} Noun #${settledNounId}:`,
                    err,
                  );
                }

                // Check if actual traits match the reservation (or standing target)
                const firedStanding = isStandingReservationId(resId);
                const res = reservationStore.get(resId);
                if (actualTraits && (res || firedStanding)) {
                  const actuallyMatches = firedStanding
                    ? matchesStandingTraits(dao, actualTraits)
                    : matchesTraits(actualTraits, res!.traits);
                  if (!actuallyMatches) {
                    console.error(
                      `[NounIRL] ❌ TRAIT MISMATCH — ${dao} Noun #${settledNounId} actual traits: ${JSON.stringify(actualTraits)}, predicted: ${JSON.stringify(settledTraits)}, wanted: ${JSON.stringify(res?.traits ?? ds.standingSpecs)}`,
                    );
                    pushError(
                      `${dao} trait mismatch for Noun #${settledNounId}: predicted ${JSON.stringify(settledTraits)}, actual ${JSON.stringify(actualTraits)}`,
                    );
                    // Reservation stays active — the minted Noun doesn't match
                    return;
                  }
                  console.log(
                    `[NounIRL] ✅ Onchain trait verification passed — ${dao} Noun #${settledNounId}: ${JSON.stringify(actualTraits)}`,
                  );
                }

                // All checks passed — record the settlement
                const confirmedTraits = actualTraits ?? settledTraits;
                reservationStore.markSettleAttemptMatched(txHash);
                // Standing targets are never consumed — only real reservations fulfil.
                if (!firedStanding) reservationStore.fulfill(resId, settledNounId, txHash);
                reservationStore.addSettlement({
                  nounId: settledNounId,
                  txHash,
                  reservationId: resId,
                  matchedTraits: { ...confirmedTraits } as Record<string, string>,
                  blockNumber: settledBlock,
                  settledAt: Math.floor(Date.now() / 1000),
                  gasUsed: receipt.gasUsed.toString(),
                  dao,
                });

                console.log(
                  `[NounIRL] ✅ Confirmed settlement — ${dao} Noun #${settledNounId} block ${receipt.blockNumber}, gas: ${receipt.gasUsed}`,
                );

                bridgePublish('noun-settled', {
                  nounId: settledNounId,
                  txHash,
                  reservationId: resId,
                  wallet: resWallet,
                  matchedTraits: confirmedTraits,
                  blockNumber: settledBlock,
                  dao,
                });
              })
              .catch(err => {
                console.error(`[NounIRL] ❌ Receipt error for ${dao} Noun #${settledNounId}:`, err);
                pushError(
                  `${dao} receipt error for Noun #${settledNounId}: ${err instanceof Error ? err.message : err}`,
                );
                // Reservation stays active — don't record a phantom settlement
              });
          }

          break;
        }
      } else if (isMatch && !auctionEnded) {
        console.log(
          `[NounIRL] 👀 ${dao} match pending — Noun #${nextNounId} — ends in ${auction.endTime - now}s`,
        );

        bridgePublish('noun-match-pending', {
          nounId: nextNounId,
          reservationId: reservation.id,
          wallet: reservation.wallet,
          matchedTraits: { ...traits },
          auctionEndsIn: auction.endTime - now,
          blockNumber: num,
          dao,
        });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[NounIRL] ${dao} block error:`, msg);
    pushError(`${dao} block ${num}: ${msg}`);
  }
}

// ─── HTTP Poll Fallback ─────────────────────────────────────────────────

async function poll(): Promise<void> {
  if (!publicClient) return;

  try {
    const block = await publicClient.getBlock({ blockTag: 'latest' });
    if (Number(block.number) <= state.lastBlockNumber) return;

    await onNewBlock(block.number, block.hash as Hex, block.parentHash as Hex, block.timestamp);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[NounIRL] Poll error:', msg);
    pushError(`Poll: ${msg}`);
  }
}

// ─── Multi-Provider WebSocket Race ──────────────────────────────────────

function subscribeWsProvider(wsUrl: string, label: string): (() => void) | null {
  try {
    const client = createPublicClient({
      chain: mainnet,
      transport: webSocket(wsUrl, {
        reconnect: { attempts: 20, delay: 3_000 },
      }),
    });

    const unwatch = client.watchBlocks({
      onBlock: block => {
        if (!block || block.number == null || !block.hash || !block.parentHash) return;
        onNewBlock(block.number, block.hash as Hex, block.parentHash as Hex, block.timestamp).catch(
          err =>
            console.error(`[NounIRL] ${label} error:`, err instanceof Error ? err.message : err),
        );
      },
      onError: err => {
        console.warn(`[NounIRL] ${label} WS error: ${err.message}`);
      },
    });

    console.log(`[NounIRL] ✅ WS subscribed: ${label}`);
    state.wsProviderCount++;
    return unwatch;
  } catch (err) {
    console.warn(`[NounIRL] Failed ${label}:`, err instanceof Error ? err.message : err);
    return null;
  }
}

// ─── Background Tasks ───────────────────────────────────────────────────

let backgroundTimer: ReturnType<typeof setInterval> | null = null;

function startBackgroundTasks(): void {
  backgroundTimer = setInterval(async () => {
    if (!agentAccount) return;
    await refreshPreSignedTxs();
  }, PRE_SIGN_TTL);

  void refreshPreSignedTxs();
}

// ─── Public API ─────────────────────────────────────────────────────────

export function startWatcher(): void {
  if (state.running) {
    console.warn('[NounIRL] Watcher already running');
    return;
  }

  if (!initClients()) {
    console.error('[NounIRL] Failed to initialize — watcher not started');
    return;
  }

  state.running = true;
  void poll();

  // Build WebSocket URL list — use FREE providers only.
  // Infura WS counts against the rate limit and Ponder needs that budget.
  const wsUrls: Array<{ url: string; label: string }> = [];
  for (const url of WS_ENDPOINTS) {
    // Label paid endpoints distinctly so the logs show whether the fast one
    // actually connected — a silent fallback to free tier is what broke the
    // snipe path in July.
    const host = new URL(url).hostname;
    const paid = host.includes('lb.drpc.live') || url.includes('/ethereum/');
    wsUrls.push({ url, label: `${paid ? 'PAID' : 'free'} (${host})` });
  }

  // Subscribe ALL providers — race for fastest block
  let wsConnected = 0;
  for (const { url, label } of wsUrls) {
    const unsub = subscribeWsProvider(url, label);
    if (unsub) {
      wsUnsubscribers.push(unsub);
      wsConnected++;
    }
  }

  if (wsConnected > 0) {
    state.transportMode = 'websocket';
    console.log(
      `[NounIRL] 🚀 Started — ${wsConnected} WebSocket providers racing, watching ${DAOS.map(d => d.toUpperCase()).join(' + ')}`,
    );
  } else {
    state.transportMode = 'http-poll';
    pollTimer = setInterval(poll, BLOCK_POLL_INTERVAL_MS);
    console.log(`[NounIRL] 🚀 Started — HTTP polling every ${BLOCK_POLL_INTERVAL_MS}ms`);
  }

  // Safety net HTTP poll — much less frequent when WS is active
  // (just a fallback in case all WS connections drop)
  if (wsConnected > 0 && !pollTimer) {
    pollTimer = setInterval(poll, SAFETY_NET_POLL_INTERVAL_MS);
  }

  startBackgroundTasks();
}

export function stopWatcher(): void {
  for (const unsub of wsUnsubscribers) {
    try {
      unsub();
    } catch {
      /* */
    }
  }
  wsUnsubscribers = [];
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
  if (backgroundTimer) {
    clearInterval(backgroundTimer);
    backgroundTimer = null;
  }
  state.running = false;
  state.transportMode = 'none';
  state.wsProviderCount = 0;
  console.log('[NounIRL] Block watcher stopped');
}

// Per-DAO slice of the watcher state, safe to serialize into API responses.
export interface DaoPublicState {
  dao: WatchedDao;
  auctionHouse: string;
  token: string;
  nextNounId: number;
  auctionEndTime: number;
  lastPredictedSeed: NounSeed | null;
  lastPredictedTraits: TraitNames | null;
  standingTraits: string[];
  activeReservations: number;
}

function daoPublicState(dao: WatchedDao): DaoPublicState {
  const ds = daoStates[dao];
  return {
    dao,
    auctionHouse: ds.auctionHouse,
    token: ds.token,
    nextNounId: ds.nextNounId,
    auctionEndTime: ds.auctionEndTime,
    lastPredictedSeed: ds.lastPredictedSeed,
    lastPredictedTraits: ds.lastPredictedTraits,
    standingTraits: ds.standingSpecs,
    activeReservations: reservationStore.getActive().filter(r => r.dao === dao).length,
  };
}

// Legacy top-level fields (nextNounId, lastPredictedTraits, …) mirror V1 — the
// main DAO — so pre-dual-DAO consumers (terminal `bid`, feed widgets) keep
// working. Per-DAO truth lives in `daos`.
export function getWatcherState(): WatcherState & {
  nextNounId: number;
  auctionEndTime: number;
  lastPredictedSeed: NounSeed | null;
  lastPredictedTraits: TraitNames | null;
  activeReservations: number;
  standingTraits: string[];
  settleGuard: Hex | null;
  daos: Record<WatchedDao, DaoPublicState>;
} {
  const daos = {
    v1: daoPublicState('v1'),
    v2: daoPublicState('v2'),
  };
  return {
    ...state,
    nextNounId: daos.v1.nextNounId,
    auctionEndTime: daos.v1.auctionEndTime,
    lastPredictedSeed: daos.v1.lastPredictedSeed,
    lastPredictedTraits: daos.v1.lastPredictedTraits,
    activeReservations: reservationStore.getActive().length,
    // Combined view, dao-prefixed so a flat list stays unambiguous.
    standingTraits: DAOS.flatMap(d => daoStates[d].standingSpecs.map(s => `${d}:${s}`)),
    // ExactBlockSettler address when the guard is on (null = direct-to-AH).
    settleGuard: EXACT_BLOCK_SETTLER,
    daos,
  };
}

export interface DaoCheckResult {
  dao: WatchedDao;
  nextNounId: number;
  predictedTraits: TraitNames | null;
  auctionEnded: boolean;
  matchingReservations: string[];
}

function daoCheckResult(dao: WatchedDao): DaoCheckResult {
  const ds = daoStates[dao];
  const now = Math.floor(Date.now() / 1000);
  const active = reservationStore.getActive().filter(r => r.dao === dao);
  const matchingIds = ds.lastPredictedTraits
    ? active.filter(r => matchesTraits(ds.lastPredictedTraits!, r.traits)).map(r => r.id)
    : [];
  if (ds.lastPredictedTraits && matchesStandingTraits(dao, ds.lastPredictedTraits)) {
    matchingIds.push(standingReservationId(dao));
  }
  return {
    dao,
    nextNounId: ds.nextNounId,
    predictedTraits: ds.lastPredictedTraits,
    auctionEnded: ds.auctionEndTime > 0 && now >= ds.auctionEndTime,
    matchingReservations: matchingIds,
  };
}

// Legacy top-level fields mirror V1; `daos` carries both.
export async function checkNow(): Promise<{
  blockNumber: number;
  nextNounId: number;
  predictedTraits: TraitNames | null;
  auctionEnded: boolean;
  matchingReservations: string[];
  daos: Record<WatchedDao, DaoCheckResult>;
}> {
  await poll();
  const daos = {
    v1: daoCheckResult('v1'),
    v2: daoCheckResult('v2'),
  };

  return {
    blockNumber: state.lastBlockNumber,
    nextNounId: daos.v1.nextNounId,
    predictedTraits: daos.v1.predictedTraits,
    auctionEnded: daos.v1.auctionEnded,
    matchingReservations: daos.v1.matchingReservations,
    daos,
  };
}
