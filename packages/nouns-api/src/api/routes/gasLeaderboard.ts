import type { Hono } from 'hono';

// ─── Gas Leaderboard ────────────────────────────────────────────────────────

type GasAction =
  | 'bidding'
  | 'settling'
  | 'proposing'
  | 'voting'
  | 'queuing'
  | 'executing'
  | 'canceling'
  | 'creating_candidate'
  | 'updating_candidate'
  | 'canceling_candidate'
  | 'sponsoring'
  | 'feedback'
  | 'grant_proposing'
  | 'grant_voting'
  | 'grant_admin'
  | 'delegation'
  | 'other';

const GAS_CONTRACTS: Record<string, Record<string, GasAction>> = {
  '0x830BD73E4184ceF73443C15111a1DF14e495C706': {
    // AuctionHouseV2
    createBid: 'bidding',
    settleAuction: 'settling',
    settleCurrentAndCreateNewAuction: 'settling',
  },
  '0x6f3E6272A167e8AcCb32072d08E0957F9c79223d': {
    // NounsDAOV4
    propose: 'proposing',
    castVote: 'voting',
    castVoteWithReason: 'voting',
    castRefundableVote: 'voting',
    castRefundableVoteWithReason: 'voting',
    queue: 'queuing',
    execute: 'executing',
    cancel: 'canceling',
  },
  '0xf790A5f59678dd733fb3De93493A91f472ca1365': {
    // NounsDAOData
    createProposalCandidate: 'creating_candidate',
    updateProposalCandidate: 'updating_candidate',
    cancelProposalCandidate: 'canceling_candidate',
    addSignature: 'sponsoring',
    sendFeedback: 'feedback',
    sendCandidateFeedback: 'feedback',
  },
  '0xBAc9233725440c595b19d975309CC98cb259253a': {
    // SmallGrantsTreasury
    propose: 'grant_proposing',
    castVote: 'grant_voting',
    queue: 'grant_admin',
    execute: 'grant_admin',
    cancel: 'grant_admin',
  },
  '0x9C8fF314C9Bc7F6e59A9d9225Fb22946427eDC03': {
    // NounsToken
    delegate: 'delegation',
  },
};

const GAS_ACTION_LABELS: Record<GasAction, string> = {
  bidding: 'Bidding',
  settling: 'Settling',
  proposing: 'Proposing',
  voting: 'Voting',
  queuing: 'Queuing',
  executing: 'Executing',
  canceling: 'Canceling',
  creating_candidate: 'Creating Candidates',
  updating_candidate: 'Updating Candidates',
  canceling_candidate: 'Canceling Candidates',
  sponsoring: 'Sponsoring',
  feedback: 'Feedback',
  grant_proposing: 'Grant Proposals',
  grant_voting: 'Grant Voting',
  grant_admin: 'Grant Admin',
  delegation: 'Delegation',
  other: 'Other',
};

interface GasEntry {
  address: string;
  totalGasCostWei: bigint;
  totalRefundWei: bigint;
  netGasCostWei: bigint;
  totalGasCostEth: number;
  totalRefundEth: number;
  netGasCostEth: number;
  txCount: number;
  byAction: Record<GasAction, { txCount: number; gasCostWei: bigint; gasCostEth: number }>;
}

interface GasLeaderboardData {
  entries: Array<
    Omit<GasEntry, 'totalGasCostWei' | 'totalRefundWei' | 'netGasCostWei' | 'byAction'> & {
      byAction: Record<GasAction, { txCount: number; gasCostEth: number }>;
    }
  >;
  meta: {
    totalTransactions: number;
    totalGasEth: number;
    totalRefundEth: number;
    uniqueAddresses: number;
    lastUpdated: number;
    actionLabels: Record<GasAction, string>;
  };
}

let gasLeaderboardCache: { data: GasLeaderboardData; fetchedAt: number } | null = null;
const GAS_CACHE_TTL = 6 * 3600_000; // 6 hours
let gasLeaderboardBuilding = false;

function extractFnName(etherscanFunctionName: string): string {
  // Etherscan returns e.g. "createBid(uint256)" — extract just the name
  const paren = etherscanFunctionName.indexOf('(');
  return paren > 0 ? etherscanFunctionName.slice(0, paren) : etherscanFunctionName;
}

async function fetchEtherscanTxList(
  contractAddress: string,
  apiKey: string,
  action: 'txlist' | 'txlistinternal' = 'txlist',
): Promise<Record<string, string>[]> {
  const all: Record<string, string>[] = [];
  let page = 1;
  while (true) {
    const url = `https://api.etherscan.io/v2/api?chainid=1&module=account&action=${action}&address=${contractAddress}&startblock=0&endblock=99999999&page=${page}&offset=10000&sort=asc&apikey=${apiKey}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    const json = await res.json();
    if (json.status !== '1' || !Array.isArray(json.result)) break;
    all.push(...json.result);
    if (json.result.length < 10000) break;
    page++;
    await new Promise(r => setTimeout(r, 250)); // rate limit
  }
  return all;
}

async function buildGasLeaderboard(apiKey: string): Promise<GasLeaderboardData> {
  const daoAddress = '0x6f3E6272A167e8AcCb32072d08E0957F9c79223d';
  const addressMap = new Map<string, GasEntry>();
  let totalTransactions = 0;

  const emptyByAction = (): GasEntry['byAction'] => {
    const obj = {} as GasEntry['byAction'];
    for (const k of Object.keys(GAS_ACTION_LABELS) as GasAction[]) {
      obj[k] = { txCount: 0, gasCostWei: 0n, gasCostEth: 0 };
    }
    return obj;
  };

  // Fetch all contract transactions
  for (const contractAddress of Object.keys(GAS_CONTRACTS)) {
    console.log(`[GasLeaderboard] Fetching txlist for ${contractAddress}...`);
    const txs = await fetchEtherscanTxList(contractAddress, apiKey);
    console.log(`[GasLeaderboard] Got ${txs.length} txs for ${contractAddress}`);
    const fnMap = GAS_CONTRACTS[contractAddress];

    for (const tx of txs) {
      const addr = tx.from.toLowerCase();
      let entry = addressMap.get(addr);
      if (!entry) {
        entry = {
          address: tx.from,
          totalGasCostWei: 0n,
          totalRefundWei: 0n,
          netGasCostWei: 0n,
          totalGasCostEth: 0,
          totalRefundEth: 0,
          netGasCostEth: 0,
          txCount: 0,
          byAction: emptyByAction(),
        };
        addressMap.set(addr, entry);
      }

      const gasCost = BigInt(tx.gasUsed || '0') * BigInt(tx.gasPrice || '0');
      const fnName = extractFnName(tx.functionName || '');
      const action: GasAction = fnMap[fnName] || 'other';

      entry.totalGasCostWei += gasCost;
      entry.txCount += 1;
      entry.byAction[action].txCount += 1;
      entry.byAction[action].gasCostWei += gasCost;
      totalTransactions++;
    }
    await new Promise(r => setTimeout(r, 250));
  }

  // Fetch vote refunds (internal txs from DAO contract back to voters)
  console.log('[GasLeaderboard] Fetching vote refund internal txs...');
  const internalTxs = await fetchEtherscanTxList(daoAddress, apiKey, 'txlistinternal');
  console.log(`[GasLeaderboard] Got ${internalTxs.length} internal txs`);

  // Build refund map: txHash → refund value
  // Internal txs where from=DAO contract are vote refunds sent back to voters
  const refundByAddress = new Map<string, bigint>();
  for (const itx of internalTxs) {
    if (itx.from?.toLowerCase() !== daoAddress.toLowerCase()) continue;
    if (!itx.to || itx.value === '0') continue;
    const voterAddr = itx.to.toLowerCase();
    refundByAddress.set(voterAddr, (refundByAddress.get(voterAddr) || 0n) + BigInt(itx.value));
  }

  // Apply refunds to address entries
  for (const [addr, refund] of refundByAddress) {
    const entry = addressMap.get(addr);
    if (entry) {
      entry.totalRefundWei = refund;
    }
  }

  // Compute derived fields and serialize
  let totalGasWei = 0n;
  let totalRefundWei = 0n;

  const entries = Array.from(addressMap.values()).map(e => {
    e.netGasCostWei = e.totalGasCostWei - e.totalRefundWei;
    e.totalGasCostEth = Number(e.totalGasCostWei) / 1e18;
    e.totalRefundEth = Number(e.totalRefundWei) / 1e18;
    e.netGasCostEth = Number(e.netGasCostWei) / 1e18;
    totalGasWei += e.totalGasCostWei;
    totalRefundWei += e.totalRefundWei;

    // Serialize byAction (drop bigints for JSON)
    const byAction = {} as Record<GasAction, { txCount: number; gasCostEth: number }>;
    for (const [k, v] of Object.entries(e.byAction) as [
      GasAction,
      (typeof e.byAction)[GasAction],
    ][]) {
      if (v.txCount > 0) {
        byAction[k] = { txCount: v.txCount, gasCostEth: Number(v.gasCostWei) / 1e18 };
      }
    }

    return {
      address: e.address,
      totalGasCostEth: e.totalGasCostEth,
      totalRefundEth: e.totalRefundEth,
      netGasCostEth: e.netGasCostEth,
      txCount: e.txCount,
      byAction,
    };
  });

  entries.sort((a, b) => b.netGasCostEth - a.netGasCostEth);

  return {
    entries,
    meta: {
      totalTransactions,
      totalGasEth: Number(totalGasWei) / 1e18,
      totalRefundEth: Number(totalRefundWei) / 1e18,
      uniqueAddresses: entries.length,
      lastUpdated: Date.now(),
      actionLabels: GAS_ACTION_LABELS,
    },
  };
}

export function registerGasLeaderboardRoutes(app: Hono) {
  app.get('/api/gas-leaderboard', async c => {
    const apiKey = process.env.ETHERSCAN_API_KEY;
    if (!apiKey) {
      return c.json({ error: 'Gas leaderboard not configured (missing ETHERSCAN_API_KEY)' }, 503);
    }

    // Return cached if fresh
    if (gasLeaderboardCache && Date.now() - gasLeaderboardCache.fetchedAt < GAS_CACHE_TTL) {
      return c.json(gasLeaderboardCache.data);
    }

    // Return stale while rebuilding
    if (gasLeaderboardCache && gasLeaderboardBuilding) {
      return c.json(gasLeaderboardCache.data);
    }

    // No cache yet, building in progress
    if (!gasLeaderboardCache && gasLeaderboardBuilding) {
      return c.json({ status: 'building' }, 202);
    }

    // Trigger background build
    gasLeaderboardBuilding = true;
    buildGasLeaderboard(apiKey)
      .then(data => {
        gasLeaderboardCache = { data, fetchedAt: Date.now() };
        console.log(
          `[GasLeaderboard] Built: ${data.meta.uniqueAddresses} addresses, ${data.meta.totalTransactions} txs`,
        );
      })
      .catch(err => console.error('[GasLeaderboard] Build failed:', err))
      .finally(() => {
        gasLeaderboardBuilding = false;
      });

    if (gasLeaderboardCache) return c.json(gasLeaderboardCache.data);
    return c.json({ status: 'building' }, 202);
  });
}
