/**
 * useStatsData — Aggregates treasury, auction, and proposal data
 * for the 3D stats corridor visualization.
 */
import { useQuery } from '@tanstack/react-query';
import { useReadNounsTreasuryBalancesInEth } from '@nouns/sdk/react/treasury';
import { formatEther } from 'viem';

import config from '@/config';

const SUBGRAPH_URL =
  config.app.subgraphApiUri || 'https://spirited-flexibility-production-3c30.up.railway.app';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AuctionItem {
  nounId: number;
  amount: string; // ETH
  date: string;
}

export interface ProposalStats {
  total: number;
  passed: number;
  failed: number;
  active: number;
  cancelled: number;
}

export interface SpendingCategory {
  category: string;
  ethAmount: number;
  color: string;
}

export interface StatsData {
  treasuryEth: number;
  treasuryUsd: number;
  treasuryBreakdown: {
    eth: number;
    stEth: number;
    rEth: number;
    wstEth: number;
    wEth: number;
    usdc: number;
    mEth: number;
  };
  totalAuctionRevenue: number;
  recentAuctions: AuctionItem[];
  monthlyRevenue: { month: string; eth: number }[];
  proposals: ProposalStats;
  spendingByCategory: SpendingCategory[];
  nounCount: number;
  flowStats: {
    totalInflow: number;
    totalOutflow: number;
    uniqueAddresses: number;
    totalTransactions: number;
    uniqueVoters: number;
    totalVotes: number;
    totalStreams: number;
    activeStreams: number;
  };
  loading: boolean;
  error: string | null;
}

// ─── Fetchers ───────────────────────────────────────────────────────────────

async function fetchAuctions(): Promise<{
  items: { nounId: string; amount: string; startTime: string; settled: boolean }[];
}> {
  const query = `{
    auctions(orderBy: "startTime", orderDirection: "desc", limit: 1000) {
      items {
        nounId
        amount
        startTime
        settled
      }
    }
  }`;
  const res = await fetch(SUBGRAPH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  return json.data?.auctions ?? { items: [] };
}

async function fetchProposals(): Promise<{
  items: { id: string; status: string; forVotes: string; againstVotes: string; description: string }[];
}> {
  const query = `{
    proposals(orderBy: "createdBlock", orderDirection: "desc", limit: 1000) {
      items {
        id
        status
        forVotes
        againstVotes
        description
      }
    }
  }`;
  const res = await fetch(SUBGRAPH_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  const json = await res.json();
  return json.data?.proposals ?? { items: [] };
}

async function fetchFlowStats(): Promise<{
  totalInflow: number;
  totalOutflow: number;
  uniqueAddresses: number;
  totalTransactions: number;
  uniqueVoters?: number;
  totalVotes?: number;
  totalStreams?: number;
  activeStreams?: number;
}> {
  try {
    const res = await fetch(`${SUBGRAPH_URL}/api/treasury/flows`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.stats ?? {};
  } catch {
    return { totalInflow: 0, totalOutflow: 0, uniqueAddresses: 0, totalTransactions: 0 };
  }
}

// ETH price from CoinGecko
async function fetchEthPrice(): Promise<number> {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd',
    );
    const data = await res.json();
    return data.ethereum?.usd ?? 0;
  } catch {
    return 0;
  }
}

// ─── Spending categorization ────────────────────────────────────────────────

const CATEGORY_KEYWORDS: Record<string, string[]> = {
  'Builder': ['builder', 'develop', 'engineering', 'technical', 'infra', 'software'],
  'Art & Culture': ['art', 'artist', 'culture', 'creative', 'music', 'nounish'],
  'Community': ['community', 'event', 'meetup', 'conference', 'social', 'gathering'],
  'Marketing': ['marketing', 'brand', 'awareness', 'media', 'campaign'],
  'Education': ['education', 'learn', 'teach', 'onboard', 'workshop'],
  'Charity': ['charity', 'donation', 'public good', 'humanitarian', 'relief'],
  'Governance': ['governance', 'delegate', 'voting', 'dao', 'operational'],
  'Other': [],
};

const CATEGORY_COLORS: Record<string, string> = {
  'Builder': '#60a5fa',
  'Art & Culture': '#ec4899',
  'Community': '#fbbf24',
  'Marketing': '#34d399',
  'Education': '#a78bfa',
  'Charity': '#f87171',
  'Governance': '#38bdf8',
  'Other': '#94a3b8',
};

function categorizeProposal(description: string): string {
  const lower = (description ?? '').toLowerCase();
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (cat === 'Other') continue;
    if (keywords.some(kw => lower.includes(kw))) return cat;
  }
  return 'Other';
}

// ─── Monthly revenue aggregation ────────────────────────────────────────────

function aggregateMonthlyRevenue(
  auctions: { amount: string; startTime: string }[],
): { month: string; eth: number }[] {
  const monthMap = new Map<string, number>();
  for (const a of auctions) {
    const date = new Date(Number(a.startTime) * 1000);
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    const eth = parseFloat(formatEther(BigInt(a.amount || '0')));
    monthMap.set(key, (monthMap.get(key) ?? 0) + eth);
  }
  // Return last 12 months
  return Array.from(monthMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-12)
    .map(([month, eth]) => ({ month, eth }));
}

// ─── Main Hook ──────────────────────────────────────────────────────────────

export function useStatsData(): StatsData {
  // 1. Treasury balances from on-chain
  const { data: treasuryBalances } = useReadNounsTreasuryBalancesInEth({
    query: {
      select: data => data,
    },
  });

  // 2. Combined fetch for auctions, proposals, flow stats, ETH price
  const { data: combined, isLoading, error } = useQuery({
    queryKey: ['statsCorridorData'],
    queryFn: async () => {
      const [auctions, proposals, flowStats, ethPrice] = await Promise.all([
        fetchAuctions(),
        fetchProposals(),
        fetchFlowStats(),
        fetchEthPrice(),
      ]);
      return { auctions, proposals, flowStats, ethPrice };
    },
    staleTime: 5 * 60_000, // 5 min
    gcTime: 30 * 60_000,
    retry: 2,
  });

  // ── Compute derived data ──

  const ethBal = treasuryBalances
    ? Number(formatEther(treasuryBalances.ETH))
    : 0;
  const stEthBal = treasuryBalances
    ? Number(formatEther(treasuryBalances.stETH))
    : 0;
  const rEthBal = treasuryBalances
    ? Number(formatEther(treasuryBalances.rETH))
    : 0;
  const wstEthBal = treasuryBalances
    ? Number(formatEther(treasuryBalances.wstETH))
    : 0;
  const wEthBal = treasuryBalances
    ? Number(formatEther(treasuryBalances.wETH))
    : 0;
  const usdcBal = treasuryBalances
    ? Number(formatEther(treasuryBalances.USDC))
    : 0;
  const mEthBal = treasuryBalances
    ? Number(formatEther(treasuryBalances.mETH))
    : 0;
  const totalEth = treasuryBalances
    ? Number(formatEther(treasuryBalances.total))
    : 0;

  const ethPrice = combined?.ethPrice ?? 0;
  const auctionItems = combined?.auctions?.items ?? [];
  const proposalItems = combined?.proposals?.items ?? [];
  const flowStats = combined?.flowStats ?? {
    totalInflow: 0, totalOutflow: 0, uniqueAddresses: 0, totalTransactions: 0,
  };

  // Auction revenue
  const totalAuctionRevenue = auctionItems.reduce((sum, a) => {
    return sum + parseFloat(formatEther(BigInt(a.amount || '0')));
  }, 0);

  const recentAuctions: AuctionItem[] = auctionItems.slice(0, 20).map(a => ({
    nounId: Number(a.nounId),
    amount: parseFloat(formatEther(BigInt(a.amount || '0'))).toFixed(4),
    date: new Date(Number(a.startTime) * 1000).toLocaleDateString(),
  }));

  const monthlyRevenue = aggregateMonthlyRevenue(auctionItems);

  // Proposal stats
  const proposals: ProposalStats = {
    total: proposalItems.length,
    passed: proposalItems.filter(p => p.status === 'EXECUTED' || p.status === 'QUEUED').length,
    failed: proposalItems.filter(p => p.status === 'DEFEATED' || p.status === 'VETOED').length,
    active: proposalItems.filter(p => p.status === 'ACTIVE' || p.status === 'PENDING').length,
    cancelled: proposalItems.filter(p => p.status === 'CANCELLED').length,
  };

  // Spending by category (from passed proposals, rough estimate)
  const categoryMap = new Map<string, number>();
  for (const p of proposalItems) {
    if (p.status === 'EXECUTED' || p.status === 'QUEUED') {
      const cat = categorizeProposal(p.description);
      categoryMap.set(cat, (categoryMap.get(cat) ?? 0) + 1);
    }
  }
  const spendingByCategory: SpendingCategory[] = Array.from(categoryMap.entries())
    .map(([category, count]) => ({
      category,
      ethAmount: count, // Using count as proxy for now
      color: CATEGORY_COLORS[category] ?? '#94a3b8',
    }))
    .sort((a, b) => b.ethAmount - a.ethAmount);

  // Noun count from highest auction ID
  const nounCount = auctionItems.length > 0
    ? Math.max(...auctionItems.map(a => Number(a.nounId))) + 1
    : 0;

  return {
    treasuryEth: totalEth,
    treasuryUsd: totalEth * ethPrice,
    treasuryBreakdown: {
      eth: ethBal,
      stEth: stEthBal,
      rEth: rEthBal,
      wstEth: wstEthBal,
      wEth: wEthBal,
      usdc: usdcBal,
      mEth: mEthBal,
    },
    totalAuctionRevenue,
    recentAuctions,
    monthlyRevenue,
    proposals,
    spendingByCategory,
    nounCount,
    flowStats: {
      totalInflow: flowStats.totalInflow ?? 0,
      totalOutflow: flowStats.totalOutflow ?? 0,
      uniqueAddresses: flowStats.uniqueAddresses ?? 0,
      totalTransactions: flowStats.totalTransactions ?? 0,
      uniqueVoters: flowStats.uniqueVoters ?? 0,
      totalVotes: flowStats.totalVotes ?? 0,
      totalStreams: flowStats.totalStreams ?? 0,
      activeStreams: flowStats.activeStreams ?? 0,
    },
    loading: isLoading,
    error: error ? (error as Error).message : null,
  };
}
