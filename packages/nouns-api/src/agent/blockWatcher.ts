// ─── Agent NounIRL — Block Watcher (SPEED-OPTIMIZED) ────────────────────────
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
// 4. FLASHBOTS PROTECT: Submit settlement via rpc.flashbots.net to prevent
//    frontrunning. Free, no extra cost. Falls back to public mempool.
// 5. ADAPTIVE AUCTION CACHE: Near auction end (<60s), poll every 3s instead of 15s.
//    Ensures fresh auction state when settlement window opens.
// 6. PRE-SIGNED RAW TX: Sign settlement tx in advance with predicted nonce + gas.
//    On match: just sendRawTransaction — skip encode+sign step (~100-200ms saved).
//
// RESULT: Most blocks process in <1ms (pure math + cache).
// Settlement path: <500ms (pre-signed tx → Flashbots broadcast).

import {
  createPublicClient,
  createWalletClient,
  http,
  webSocket,
  encodeFunctionData,
  parseGwei,
  type PublicClient,
  type WalletClient,
  type Hex,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { mainnet, sepolia } from 'viem/chains';

import { bridgePublish } from './bridge.js';
import {
  AUCTION_HOUSE_ADDRESS,
  AUCTION_HOUSE_ABI,
  NOUNS_TOKEN_ADDRESS,
  NOUNS_TOKEN_ABI,
  BLOCK_POLL_INTERVAL_MS,
  SAFETY_NET_POLL_INTERVAL_MS,
  AGENT_RPC_URL,
  NOUNIRL_CHAIN,
} from './constants.js';

const AGENT_CHAIN = NOUNIRL_CHAIN === 'sepolia' ? sepolia : mainnet;
import { reservationStore } from './reservations.js';
import {
  predictSeed,
  seedToTraitNames,
  matchesTraits,
  type NounSeed,
  type TraitNames,
} from './traitPredictor.js';

// ─── Settlement Config ────────────────────────────────────────────────────
const SETTLEMENT_GAS_LIMIT = 600_000n;
const SETTLEMENT_PRIORITY_FEE = parseGwei('5');
const SETTLEMENT_MAX_FEE = parseGwei('200');

// Pre-encoded calldata — settleCurrentAndCreateNewAuction() takes no args
// This is constant and never changes. Encode once, reuse forever.
const SETTLEMENT_CALLDATA = encodeFunctionData({
  abi: AUCTION_HOUSE_ABI,
  functionName: 'settleCurrentAndCreateNewAuction',
});

// ─── Multi-Provider Config ───────────────────────────────────────────────
// Free WebSocket endpoints — race them all, first block wins.
const FREE_WS_ENDPOINTS =
  NOUNIRL_CHAIN === 'sepolia'
    ? ['wss://ethereum-sepolia-rpc.publicnode.com']
    : ['wss://ethereum-rpc.publicnode.com', 'wss://eth.drpc.org'];

// Flashbots Protect RPC — free, MEV-safe submission
const FLASHBOTS_RPC = 'https://rpc.flashbots.net';

// ─── State ─────────────────────────────────────────────────────────────────

interface WatcherState {
  running: boolean;
  lastBlockNumber: number;
  lastBlockHash: Hex | null;
  lastPredictedSeed: NounSeed | null;
  lastPredictedTraits: TraitNames | null;
  lastCheckedAt: number;
  nextNounId: number;
  auctionEndTime: number;
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
  lastPredictedSeed: null,
  lastPredictedTraits: null,
  lastCheckedAt: 0,
  nextNounId: 0,
  auctionEndTime: 0,
  totalBlocksChecked: 0,
  transportMode: 'none',
  wsProviderCount: 0,
  blockLatencyMs: 0,
  errors: [],
};

let pollTimer: ReturnType<typeof setInterval> | null = null;
let wsUnsubscribers: (() => void)[] = [];
let publicClient: PublicClient | null = null;
let walletClient: WalletClient | null = null;
let flashbotsClient: PublicClient | null = null;
let agentAccount: PrivateKeyAccount | null = null;

// Local nonce tracking
let localNonce: number | null = null;
let nonceRefreshedAt = 0;
const NONCE_REFRESH_TTL = 30_000;

// Pre-signed transaction
let preSignedTx: Hex | null = null;
let preSignedNonce: number | null = null;
let preSignedAt = 0;
const PRE_SIGN_TTL = 12_000; // refresh every ~1 block

// ─── Init ──────────────────────────────────────────────────────────────────

function initClients(): boolean {
  // Agent uses its own RPC (free public node by default) to avoid
  // competing with Ponder for the Infura rate limit.
  const rpcUrl = AGENT_RPC_URL;

  publicClient = createPublicClient({
    chain: AGENT_CHAIN,
    transport: http(rpcUrl),
  });

  // Flashbots Protect is mainnet-only — skip on testnet
  if (NOUNIRL_CHAIN !== 'sepolia') {
    flashbotsClient = createPublicClient({
      chain: AGENT_CHAIN,
      transport: http(FLASHBOTS_RPC),
    });
  }

  const privateKey = process.env.NOUNIRL_PRIVATE_KEY;
  if (privateKey) {
    try {
      agentAccount = privateKeyToAccount(privateKey as Hex);
      walletClient = createWalletClient({
        chain: AGENT_CHAIN,
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

// ─── Pre-Sign Settlement Transaction ────────────────────────────────────

async function refreshPreSignedTx(): Promise<void> {
  if (!agentAccount || !publicClient) return;

  try {
    const nonce = await getLocalNonce();

    const tx = {
      to: AUCTION_HOUSE_ADDRESS as `0x${string}`,
      data: SETTLEMENT_CALLDATA,
      gas: SETTLEMENT_GAS_LIMIT,
      maxFeePerGas: SETTLEMENT_MAX_FEE,
      maxPriorityFeePerGas: SETTLEMENT_PRIORITY_FEE,
      nonce,
      chainId: AGENT_CHAIN.id,
      type: 'eip1559' as const,
    };

    const signed = await agentAccount.signTransaction(tx);
    preSignedTx = signed;
    preSignedNonce = nonce;
    preSignedAt = Date.now();
  } catch (err) {
    console.error('[NounIRL] Pre-sign failed:', err instanceof Error ? err.message : err);
  }
}

// ─── Auction State ──────────────────────────────────────────────────────

interface AuctionState {
  nounId: number;
  endTime: number;
  settled: boolean;
  amount: bigint;
  bidder: string;
}

let cachedAuction: AuctionState | null = null;
let cachedAuctionAt = 0;

function getAuctionCacheTTL(): number {
  if (!cachedAuction) return 0;
  const secsToEnd = cachedAuction.endTime - Math.floor(Date.now() / 1000);
  if (secsToEnd <= 60 && secsToEnd > 0) return 3_000; // HOT ZONE
  if (secsToEnd <= 0) return 1_000; // ENDED
  return 15_000; // Normal
}

async function getCurrentAuction(forceRefresh = false): Promise<AuctionState | null> {
  if (!publicClient) return null;

  const now = Date.now();
  const ttl = getAuctionCacheTTL();
  if (!forceRefresh && cachedAuction && now - cachedAuctionAt < ttl) {
    return cachedAuction;
  }

  try {
    const result = await publicClient.readContract({
      address: AUCTION_HOUSE_ADDRESS,
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

    cachedAuction = {
      nounId: Number(r.nounId),
      endTime: Number(r.endTime),
      settled: r.settled,
      amount: r.amount,
      bidder: r.bidder,
    };
    cachedAuctionAt = now;
    state.auctionEndTime = cachedAuction.endTime;

    return cachedAuction;
  } catch (err) {
    console.error('[NounIRL] Failed to read auction:', err);
    return cachedAuction;
  }
}

// ─── Settlement (ULTRA-FAST PATH) ───────────────────────────────────────

async function settleAuction(): Promise<{ txHash: string } | null> {
  if (!walletClient || !publicClient || !agentAccount) {
    console.error('[NounIRL] Cannot settle — wallet not configured');
    return null;
  }

  const t0 = Date.now();

  try {
    console.log(`[NounIRL] 🔥 SETTLING — pre-signed: ${preSignedTx ? 'YES' : 'NO'}`);

    let hash: Hex;

    // FAST PATH: Use pre-signed transaction if nonce is still valid
    const currentNonce = await getLocalNonce();
    if (
      preSignedTx &&
      preSignedNonce === currentNonce &&
      Date.now() - preSignedAt < PRE_SIGN_TTL * 3
    ) {
      console.log(`[NounIRL] Using pre-signed tx (nonce ${currentNonce})`);

      // Submit to BOTH Flashbots AND public mempool simultaneously.
      // Settlement is a public function (no MEV risk) — we just need inclusion speed.
      // Flashbots Protect silently drops txs if builders don't pick them up,
      // so public mempool is the reliability backstop.
      const [flashbotsResult, mempoolResult] = await Promise.allSettled([
        sendRawTx(preSignedTx, true),
        sendRawTx(preSignedTx, false),
      ]);
      hash =
        (mempoolResult.status === 'fulfilled' ? mempoolResult.value : null) ??
        (flashbotsResult.status === 'fulfilled' ? flashbotsResult.value : null) ??
        (() => {
          throw new Error(
            `Both paths failed: flashbots=${flashbotsResult.status === 'rejected' ? flashbotsResult.reason : '?'}, mempool=${mempoolResult.status === 'rejected' ? mempoolResult.reason : '?'}`,
          );
        })();
    } else {
      // FALLBACK: Fresh sign + send via walletClient
      console.log(
        `[NounIRL] Fresh sign (nonce stale: expected ${preSignedNonce}, got ${currentNonce})`,
      );

      // @ts-expect-error — viem strict chain typing
      hash = await walletClient.writeContract({
        address: AUCTION_HOUSE_ADDRESS,
        abi: AUCTION_HOUSE_ABI,
        functionName: 'settleCurrentAndCreateNewAuction',
        gas: SETTLEMENT_GAS_LIMIT,
        maxPriorityFeePerGas: SETTLEMENT_PRIORITY_FEE,
        maxFeePerGas: SETTLEMENT_MAX_FEE,
        chain: AGENT_CHAIN,
      });
    }

    // Update local nonce + invalidate pre-signed
    if (localNonce !== null) localNonce++;
    preSignedTx = null;
    preSignedNonce = null;

    const txTime = Date.now() - t0;
    console.log(`[NounIRL] ✅ Settlement tx sent in ${txTime}ms: ${hash}`);

    return { txHash: hash };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[NounIRL] Settlement failed after ${Date.now() - t0}ms:`, msg);
    state.errors.push(`Settlement failed: ${msg}`);
    if (state.errors.length > 50) state.errors.shift();
    return null;
  }
}

async function sendRawTx(signedTx: Hex, useFlashbots: boolean): Promise<Hex> {
  const client = useFlashbots ? flashbotsClient : publicClient;
  if (!client) throw new Error('No client');

  const hash = await client.request({
    method: 'eth_sendRawTransaction',
    params: [signedTx],
  });

  if (useFlashbots) {
    console.log('[NounIRL] Submitted via Flashbots Protect (MEV-safe)');
  }

  return hash as Hex;
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

  const t0 = Date.now();

  if (blockTimestamp) {
    state.blockLatencyMs = Date.now() - Number(blockTimestamp) * 1000;
  }

  state.lastBlockNumber = num;
  state.lastBlockHash = blockHash;
  state.lastCheckedAt = Math.floor(Date.now() / 1000);
  state.totalBlocksChecked++;

  try {
    const auction = await getCurrentAuction();
    if (!auction) return;

    state.auctionEndTime = auction.endTime;
    const now = Math.floor(Date.now() / 1000);
    const auctionEnded = now >= auction.endTime;

    const nextNounId = auction.nounId + 1;
    state.nextNounId = nextNounId;

    // NounsSeeder uses blockhash(block.number - 1). If our settlement tx lands
    // in block N+1, the seeder uses hash(N) — which is the CURRENT block's hash.
    // Using parentHash (hash of N-1) predicts what was minted in THIS block,
    // not what would be minted in the NEXT block where our tx lands.
    const seed = predictSeed(blockHash, nextNounId);
    const traits = seedToTraitNames(seed);

    state.lastPredictedSeed = seed;
    state.lastPredictedTraits = traits;

    const activeReservations = reservationStore.getActive();
    if (activeReservations.length === 0) return;

    for (const reservation of activeReservations) {
      const isMatch = matchesTraits(traits, reservation.traits);

      const forceSettle = process.env.NOUNIRL_FORCE_SETTLE === 'true';
      if (isMatch && (auctionEnded || forceSettle)) {
        const freshAuction = await getCurrentAuction(true);
        if (!freshAuction || freshAuction.settled) {
          console.log('[NounIRL] Match found but auction already settled — skipping');
          continue;
        }

        console.log(
          `[NounIRL] 🎯 MATCH in ${Date.now() - t0}ms! Noun #${nextNounId} — ${JSON.stringify(traits)}`,
        );

        const result = await settleAuction();
        if (result) {
          // Record as pending — only confirm after receipt verification
          console.log(
            `[NounIRL] ⏳ Settlement tx broadcast for ${reservation.id} — awaiting confirmation...`,
          );

          cachedAuction = null;
          cachedAuctionAt = 0;

          // Capture values for the async callback
          const resId = reservation.id;
          const resWallet = reservation.wallet;
          const settledNounId = nextNounId;
          const settledTraits = { ...traits };
          const settledBlock = num;
          const txHash = result.txHash;

          // Wait for receipt, verify success, then verify actual onchain traits
          if (publicClient) {
            const pc = publicClient;
            void pc
              .waitForTransactionReceipt({ hash: txHash as `0x${string}` })
              .then(async receipt => {
                if (receipt.status !== 'success') {
                  console.error(
                    `[NounIRL] ❌ Settlement tx REVERTED — Noun #${settledNounId} tx ${txHash}. Someone else settled first.`,
                  );
                  state.errors.push(`Settlement reverted for Noun #${settledNounId}: ${txHash}`);
                  if (state.errors.length > 50) state.errors.shift();
                  return; // Reservation stays active
                }

                // Tx succeeded — now verify actual traits match the reservation
                let actualTraits: TraitNames | null = null;
                try {
                  const onchainSeed = (await pc.readContract({
                    address: NOUNS_TOKEN_ADDRESS,
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
                  actualTraits = seedToTraitNames(seed);
                } catch (err) {
                  console.warn(
                    `[NounIRL] Could not read onchain seed for Noun #${settledNounId}:`,
                    err,
                  );
                }

                // Check if actual traits match the reservation
                const res = reservationStore.get(resId);
                if (actualTraits && res) {
                  const actuallyMatches = matchesTraits(actualTraits, res.traits);
                  if (!actuallyMatches) {
                    console.error(
                      `[NounIRL] ❌ TRAIT MISMATCH — Noun #${settledNounId} actual traits: ${JSON.stringify(actualTraits)}, predicted: ${JSON.stringify(settledTraits)}, wanted: ${JSON.stringify(res.traits)}`,
                    );
                    state.errors.push(
                      `Trait mismatch for Noun #${settledNounId}: predicted ${JSON.stringify(settledTraits)}, actual ${JSON.stringify(actualTraits)}`,
                    );
                    if (state.errors.length > 50) state.errors.shift();
                    // Reservation stays active — the minted Noun doesn't match
                    return;
                  }
                  console.log(
                    `[NounIRL] ✅ Onchain trait verification passed — Noun #${settledNounId}: ${JSON.stringify(actualTraits)}`,
                  );
                }

                // All checks passed — record the settlement
                const confirmedTraits = actualTraits ?? settledTraits;
                reservationStore.fulfill(resId, settledNounId, txHash);
                reservationStore.addSettlement({
                  nounId: settledNounId,
                  txHash,
                  reservationId: resId,
                  matchedTraits: { ...confirmedTraits } as Record<string, string>,
                  blockNumber: settledBlock,
                  settledAt: Math.floor(Date.now() / 1000),
                  gasUsed: receipt.gasUsed.toString(),
                });

                console.log(
                  `[NounIRL] ✅ Confirmed settlement — Noun #${settledNounId} block ${receipt.blockNumber}, gas: ${receipt.gasUsed}`,
                );

                bridgePublish('noun-settled', {
                  nounId: settledNounId,
                  txHash,
                  reservationId: resId,
                  wallet: resWallet,
                  matchedTraits: confirmedTraits,
                  blockNumber: settledBlock,
                });
              })
              .catch(err => {
                console.error(`[NounIRL] ❌ Receipt error for Noun #${settledNounId}:`, err);
                state.errors.push(
                  `Receipt error for Noun #${settledNounId}: ${err instanceof Error ? err.message : err}`,
                );
                if (state.errors.length > 50) state.errors.shift();
                // Reservation stays active — don't record a phantom settlement
              });
          }

          break;
        }
      } else if (isMatch && !auctionEnded) {
        console.log(
          `[NounIRL] 👀 Match pending — Noun #${nextNounId} — ends in ${auction.endTime - now}s`,
        );

        bridgePublish('noun-match-pending', {
          nounId: nextNounId,
          reservationId: reservation.id,
          wallet: reservation.wallet,
          matchedTraits: { ...traits },
          auctionEndsIn: auction.endTime - now,
          blockNumber: num,
        });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[NounIRL] Block error:', msg);
    state.errors.push(`Block ${num}: ${msg}`);
    if (state.errors.length > 50) state.errors.shift();
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
    state.errors.push(`Poll: ${msg}`);
    if (state.errors.length > 50) state.errors.shift();
  }
}

// ─── Multi-Provider WebSocket Race ──────────────────────────────────────

function subscribeWsProvider(wsUrl: string, label: string): (() => void) | null {
  try {
    const client = createPublicClient({
      chain: AGENT_CHAIN,
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
    await refreshPreSignedTx();
  }, PRE_SIGN_TTL);

  void refreshPreSignedTx();
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
  for (const url of FREE_WS_ENDPOINTS) {
    wsUrls.push({ url, label: `free (${new URL(url).hostname})` });
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
      `[NounIRL] 🚀 Started on ${NOUNIRL_CHAIN} (chain ${AGENT_CHAIN.id}) — ${wsConnected} WebSocket providers racing`,
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

export function getWatcherState(): WatcherState & { activeReservations: number } {
  return { ...state, activeReservations: reservationStore.getActive().length };
}

export async function checkNow(): Promise<{
  blockNumber: number;
  nextNounId: number;
  predictedTraits: TraitNames | null;
  auctionEnded: boolean;
  matchingReservations: string[];
}> {
  await poll();
  const now = Math.floor(Date.now() / 1000);
  const active = reservationStore.getActive();
  const matchingIds = state.lastPredictedTraits
    ? active.filter(r => matchesTraits(state.lastPredictedTraits!, r.traits)).map(r => r.id)
    : [];

  return {
    blockNumber: state.lastBlockNumber,
    nextNounId: state.nextNounId,
    predictedTraits: state.lastPredictedTraits,
    auctionEnded: now >= state.auctionEndTime,
    matchingReservations: matchingIds,
  };
}
