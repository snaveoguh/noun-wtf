// ─── Governance Context — Per-wallet profile + live auction for chat injection ──
//
// 1. Queries Ponder GraphQL for connected user's proposals, votes, delegate power, Nouns
// 2. Fetches live auction data (current bid, bidders, time remaining)
// 3. Resolves ENS names
// 4. Caches per wallet with 5-minute TTL (empty profiles not cached)
// Injected into the chat system prompt so the AI knows who it's talking to.

// ─── Types ─────────────────────────────────────────────────────────────────

interface ProposalSummary {
  proposalId: string;
  description: string;
  status: string;
  forVotes: number;
  againstVotes: number;
  abstainVotes: number;
}

interface VoteSummary {
  proposalId: string;
  support: number; // 0=against, 1=for, 2=abstain
  votes: number;
  reason: string | null;
}

interface DelegateSummary {
  id: string;
  delegatedVotes: number;
}

interface NounSummary {
  id: string;
}

interface AuctionWinSummary {
  nounId: string;
  amount: string;
}

interface GovernanceProfile {
  address: string;
  ensName: string | null;
  proposals: ProposalSummary[];
  votes: VoteSummary[];
  delegate: DelegateSummary | null;
  nouns: NounSummary[];
  auctionWins: AuctionWinSummary[];
}

interface BidData {
  bidder: string;
  value: string;
  clientId: number | null;
}

interface LiveAuction {
  nounId: string;
  endTime: number;
  settled: boolean;
  highestBid: string | null;
  bidCount: number;
  bids: BidData[];
}

interface CacheEntry {
  profile: GovernanceProfile;
  fetchedAt: number;
}

// ─── Config ────────────────────────────────────────────────────────────────

const PONDER_URL =
  process.env.PONDER_SELF_URL || 'https://spirited-flexibility-production-3c30.up.railway.app';

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const AUCTION_CACHE_TTL_MS = 30 * 1000; // 30 seconds for live auction

const profileCache = new Map<string, CacheEntry>();
let auctionCache: { auction: LiveAuction; fetchedAt: number } | null = null;

// ─── ENS Resolution ────────────────────────────────────────────────────────

const FALLBACK_RPC = 'https://eth.llamarpc.com';
const ensCache = new Map<string, string | null>();

async function resolveEns(addr: string): Promise<string | null> {
  const key = addr.toLowerCase();
  if (ensCache.has(key)) return ensCache.get(key)!;

  const rpcUrl = process.env.PONDER_RPC_URL_1 || FALLBACK_RPC;
  try {
    const reverseName = addr.slice(2).toLowerCase() + '.addr.reverse';
    let encoded = '0x';
    for (const label of reverseName.split('.')) {
      encoded += label.length.toString(16).padStart(2, '0');
      for (let i = 0; i < label.length; i++) {
        encoded += label.charCodeAt(i).toString(16).padStart(2, '0');
      }
    }
    encoded += '00';
    const calldata =
      '0xec11c823' +
      '0000000000000000000000000000000000000000000000000000000000000020' +
      (encoded.length / 2 - 1).toString(16).padStart(64, '0') +
      encoded.slice(2).padEnd(Math.ceil((encoded.length - 2) / 64) * 64, '0');

    const doCall = async (url: string) => {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_call',
          params: [{ to: '0xce01f8eee7E0a9588E56A9b3b055b42eAf49D12a', data: calldata }, 'latest'],
          id: 1,
        }),
        signal: AbortSignal.timeout(5_000),
      });
      return (await res.json()) as { result?: string; error?: unknown };
    };

    let json = await doCall(rpcUrl);
    if (json.error || !json.result || json.result === '0x') {
      json = await doCall(FALLBACK_RPC);
    }

    if (json.result && json.result !== '0x' && json.result.length > 130) {
      const hex = json.result.slice(2);
      const nameOffset = parseInt(hex.slice(0, 64), 16) * 2;
      const nameLen = parseInt(hex.slice(nameOffset, nameOffset + 64), 16);
      if (nameLen > 0 && nameLen < 100) {
        const nameHex = hex.slice(nameOffset + 64, nameOffset + 64 + nameLen * 2);
        const name = Buffer.from(nameHex, 'hex').toString('utf8');
        if (name && name.includes('.')) {
          ensCache.set(key, name);
          return name;
        }
      }
    }
    ensCache.set(key, null);
    return null;
  } catch {
    return null;
  }
}

// ─── Ponder GraphQL Helper ─────────────────────────────────────────────────

async function gql<T>(query: string): Promise<T> {
  const res = await fetch(PONDER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`GraphQL error: ${res.status}`);
  const json = (await res.json()) as { data: T; errors?: Array<{ message: string }> };
  if (json.errors && json.errors.length > 0) throw new Error(json.errors[0]!.message);
  return json.data;
}

// ─── Governance Profile ────────────────────────────────────────────────────

async function fetchGovernanceProfile(wallet: string): Promise<GovernanceProfile> {
  const addr = wallet.toLowerCase();

  const [gqlResult, ensName] = await Promise.all([fetchProfileGQL(addr), resolveEns(wallet)]);

  return { address: wallet, ensName, ...gqlResult };
}

async function fetchProfileGQL(addr: string) {
  const d = await gql<{
    proposals: {
      items: Array<{
        id: string;
        description: string;
        status: string;
        forVotes: number;
        againstVotes: number;
        abstainVotes: number;
      }>;
    };
    votes: { items: VoteSummary[] };
    delegates: { items: DelegateSummary[] };
    nouns: { items: NounSummary[] };
    auctions: { items: AuctionWinSummary[] };
  }>(`{
    proposals(where: { proposer: "${addr}" }, orderBy: "id", orderDirection: "desc", limit: 100) {
      items { id, description, status, forVotes, againstVotes, abstainVotes }
    }
    votes(where: { voter: "${addr}" }, limit: 1000) {
      items { proposalId, support, votes, reason }
    }
    delegates(where: { id: "${addr}" }) {
      items { id, delegatedVotes }
    }
    nouns(where: { owner: "${addr}" }, limit: 100) {
      items { id }
    }
    auctions(where: { winner: "${addr}" }, limit: 50) {
      items { nounId, amount }
    }
  }`);

  return {
    proposals: (d.proposals?.items || []).map(p => ({
      proposalId: p.id,
      description: p.description,
      status: p.status,
      forVotes: p.forVotes,
      againstVotes: p.againstVotes,
      abstainVotes: p.abstainVotes,
    })),
    votes: d.votes?.items || [],
    delegate: d.delegates?.items?.[0] || null,
    nouns: d.nouns?.items || [],
    auctionWins: d.auctions?.items || [],
  };
}

// ─── Live Auction ──────────────────────────────────────────────────────────

async function fetchLiveAuction(): Promise<LiveAuction | null> {
  try {
    const d = await gql<{
      auctions: {
        items: Array<{
          nounId: string;
          endTime: string;
          settled: boolean;
          amount: string | null;
          bids: { items: BidData[] };
        }>;
      };
    }>(`{
      auctions(orderBy: "nounId", orderDirection: "desc", limit: 1) {
        items {
          nounId, endTime, settled, amount,
          bids(orderBy: "value", orderDirection: "desc", limit: 10) {
            items { bidder, value, clientId }
          }
        }
      }
    }`);

    const a = d.auctions?.items?.[0];
    if (!a) return null;

    return {
      nounId: a.nounId,
      endTime: parseInt(a.endTime, 10),
      settled: a.settled,
      highestBid: a.bids?.items?.[0]?.value || a.amount || null,
      bidCount: a.bids?.items?.length || 0,
      bids: a.bids?.items || [],
    };
  } catch (err) {
    console.warn('[GovernanceContext] Failed to fetch live auction:', err);
    return null;
  }
}

// ─── Context Formatters ────────────────────────────────────────────────────

function extractTitle(description: string): string {
  const firstLine = (description || '').split('\n')[0] || '';
  return firstLine.replace(/^#\s*/, '').slice(0, 80) || 'Untitled';
}

function formatProposals(proposals: ProposalSummary[]): string {
  if (proposals.length === 0) return '';
  const shown = proposals.slice(0, 10);
  const lines = shown.map(p => {
    const title = extractTitle(p.description);
    const totalVotes = p.forVotes + p.againstVotes + p.abstainVotes;
    const voteInfo =
      totalVotes > 0
        ? ` (For: ${p.forVotes}, Against: ${p.againstVotes}, Abstain: ${p.abstainVotes})`
        : '';
    return `- Proposal ${p.proposalId}: "${title}" — ${p.status}${voteInfo}`;
  });
  let section = `\n### Proposals Created (${proposals.length})\n${lines.join('\n')}`;
  if (proposals.length > 10) section += `\n- ...and ${proposals.length - 10} more`;
  return section;
}

function formatVotes(votes: VoteSummary[]): string {
  if (votes.length === 0) return '';
  const forCount = votes.filter(v => v.support === 1).length;
  const againstCount = votes.filter(v => v.support === 0).length;
  const abstainCount = votes.filter(v => v.support === 2).length;
  const withReason = votes.filter(v => v.reason && v.reason.length > 0).length;

  let section = `\n### Voting Record (${votes.length} votes)`;
  section += `\n- Voted FOR on ${forCount} proposals, AGAINST on ${againstCount}, ABSTAINED on ${abstainCount}`;
  if (withReason > 0) section += `\n- Provided voting reasons on ${withReason} votes`;

  const reasonedVotes = votes.filter(v => v.reason && v.reason.length > 0).slice(0, 5);
  if (reasonedVotes.length > 0) {
    section += '\n- Recent votes with reasons:';
    for (const v of reasonedVotes) {
      const stanceMap = { 1: 'FOR', 0: 'AGAINST' } as Record<number, string>;
      const stance = stanceMap[v.support] ?? 'ABSTAIN';
      const reason = (v.reason || '').slice(0, 100);
      section += `\n  - Prop ${v.proposalId}: ${stance} — "${reason}"`;
    }
  }
  return section;
}

function formatNouns(nouns: NounSummary[]): string {
  if (nouns.length === 0) return '';
  const ids = nouns.map(n => `Noun ${n.id}`).join(', ');
  return `\n### Nouns Owned (${nouns.length})\n- ${ids}`;
}

function formatAuctionWins(wins: AuctionWinSummary[]): string {
  if (wins.length === 0) return '';
  const lines = wins.slice(0, 5).map(w => {
    const eth = w.amount ? (Number(w.amount) / 1e18).toFixed(4) : '?';
    return `Noun ${w.nounId} (${eth} ETH)`;
  });
  let section = `\n### Auction Wins (${wins.length})\n- ${lines.join(', ')}`;
  if (wins.length > 5) section += ` ...and ${wins.length - 5} more`;
  return section;
}

function formatProfile(profile: GovernanceProfile): string {
  const { address, ensName, proposals, votes, delegate, nouns, auctionWins } = profile;
  const hasActivity =
    proposals.length > 0 || votes.length > 0 || nouns.length > 0 || auctionWins.length > 0;

  const shortAddr = `${address.slice(0, 6)}...${address.slice(-4)}`;
  let context = '\n\n## Connected User';
  context += `\n- Address: ${shortAddr} (full: ${address})`;
  if (ensName) context += `\n- ENS: ${ensName}`;
  if (delegate && delegate.delegatedVotes > 0) {
    context += `\n- Delegate voting power: ${delegate.delegatedVotes} vote${delegate.delegatedVotes !== 1 ? 's' : ''}`;
  }

  if (!hasActivity) {
    context += '\n- No governance activity found (new or passive participant)';
    return context;
  }

  context += formatProposals(proposals);
  context += formatVotes(votes);
  context += formatNouns(nouns);
  context += formatAuctionWins(auctionWins);
  return context;
}

async function formatLiveAuction(auction: LiveAuction): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const timeLeft = auction.endTime - now;
  const highBidEth = auction.highestBid ? (Number(auction.highestBid) / 1e18).toFixed(4) : '0';

  let timeStr: string;
  if (auction.settled) {
    timeStr = 'SETTLED';
  } else if (timeLeft <= 0) {
    timeStr = 'ENDED (awaiting settlement)';
  } else {
    const hours = Math.floor(timeLeft / 3600);
    const mins = Math.floor((timeLeft % 3600) / 60);
    timeStr = hours > 0 ? `${hours}h ${mins}m remaining` : `${mins}m remaining`;
  }

  let context = `\n\n## Live Auction — Noun ${auction.nounId}`;
  context += `\n- Status: ${timeStr}`;
  context += `\n- Current bid: ${highBidEth} ETH (${auction.bidCount} bids)`;

  // Resolve ENS for bidders in parallel
  if (auction.bids.length > 0) {
    const bidderAddrs = [...new Set(auction.bids.map(b => b.bidder))];
    const ensNames = await Promise.all(bidderAddrs.map(a => resolveEns(a)));
    const ensMap = new Map(bidderAddrs.map((a, i) => [a.toLowerCase(), ensNames[i]]));

    context += '\n- Recent bids:';
    for (const bid of auction.bids.slice(0, 5)) {
      const eth = (Number(bid.value) / 1e18).toFixed(4);
      const ens = ensMap.get(bid.bidder.toLowerCase());
      const bidderLabel = ens || `${bid.bidder.slice(0, 6)}...${bid.bidder.slice(-4)}`;
      context += `\n  - ${bidderLabel}: ${eth} ETH`;
    }
  }

  return context;
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Build a governance context string for the given wallet.
 * Returns empty string if wallet is invalid or fetch fails.
 */
export async function buildGovernanceContext(wallet: string): Promise<string> {
  if (!wallet || !wallet.startsWith('0x') || wallet.length !== 42) {
    return '';
  }

  const cacheKey = wallet.toLowerCase();
  const cached = profileCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return formatProfile(cached.profile);
  }

  try {
    console.log('[GovernanceContext] Fetching profile for', cacheKey);
    const profile = await fetchGovernanceProfile(wallet);
    const hasData =
      profile.proposals.length > 0 ||
      profile.votes.length > 0 ||
      profile.nouns.length > 0 ||
      profile.auctionWins.length > 0;
    console.log('[GovernanceContext] Profile:', {
      proposals: profile.proposals.length,
      votes: profile.votes.length,
      nouns: profile.nouns.length,
      auctionWins: profile.auctionWins.length,
      ensName: profile.ensName,
    });
    if (hasData || profile.ensName) {
      profileCache.set(cacheKey, { profile, fetchedAt: Date.now() });
    }
    return formatProfile(profile);
  } catch (err) {
    console.error('[GovernanceContext] Failed to fetch profile:', err);
    return '';
  }
}

/**
 * Build a live auction context string.
 * Cached for 30 seconds. Returns empty string on failure.
 */
export async function buildLiveAuctionContext(): Promise<string> {
  if (auctionCache && Date.now() - auctionCache.fetchedAt < AUCTION_CACHE_TTL_MS) {
    return formatLiveAuction(auctionCache.auction);
  }

  try {
    const auction = await fetchLiveAuction();
    if (!auction) return '';
    auctionCache = { auction, fetchedAt: Date.now() };
    return formatLiveAuction(auction);
  } catch (err) {
    console.warn('[GovernanceContext] Failed to fetch live auction:', err);
    return '';
  }
}

// ─── Global Proposals & Grants Context ────────────────────────────────────
// Compact summary of ALL proposals + grants injected into every chat request
// so the LLM can answer governance questions without tools.

interface RawProposal {
  id: string;
  description: string;
  status: string;
  forVotes: number;
  againstVotes: number;
  abstainVotes: number;
  quorumVotes: string;
  startBlock: string;
  endBlock: string;
  objectionPeriodEndBlock: string | null;
  executionETA: string | null;
  onTimelockV1: boolean;
  proposer: string;
}

interface RawGrant {
  id: string;
  description: string;
  status: string;
  forVotes: number;
  againstVotes: number;
  abstainVotes: number;
  endBlock: string;
  executionETA: string | null;
  proposer: string;
}

let proposalsGrantsCache: { text: string; fetchedAt: number } | null = null;
const PG_CACHE_TTL_MS = 2 * 60 * 1000; // 2 minutes

async function getLatestBlock(): Promise<bigint> {
  const rpcUrl = process.env.PONDER_RPC_URL_1 || FALLBACK_RPC;
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
      signal: AbortSignal.timeout(5_000),
    });
    const json = (await res.json()) as { result?: string };
    return json.result ? BigInt(json.result) : 0n;
  } catch {
    return 0n;
  }
}

function deriveProposalStatus(p: RawProposal, latestBlock: bigint): string {
  if (['CANCELLED', 'VETOED', 'EXECUTED'].includes(p.status)) return p.status;

  if (p.status === 'QUEUED') {
    if (p.executionETA) {
      const gracePeriod = p.onTimelockV1 ? 14 * 86400 : 21 * 86400;
      if (Math.floor(Date.now() / 1000) >= Number(p.executionETA) + gracePeriod) return 'EXPIRED';
    }
    return 'QUEUED';
  }

  if (p.status === 'ACTIVE' || p.status === 'PENDING') {
    const endBlock = BigInt(p.endBlock);
    let effectiveEnd = endBlock;
    if (p.objectionPeriodEndBlock && BigInt(p.objectionPeriodEndBlock) > endBlock) {
      effectiveEnd = BigInt(p.objectionPeriodEndBlock);
    }

    if (latestBlock > effectiveEnd) {
      const forVotes = BigInt(p.forVotes);
      if (forVotes <= BigInt(p.againstVotes) || forVotes < BigInt(p.quorumVotes)) return 'DEFEATED';
      return 'SUCCEEDED';
    }
    if (latestBlock <= BigInt(p.startBlock)) return 'PENDING';
    return 'ACTIVE';
  }
  return p.status;
}

function deriveGrantStatus(g: RawGrant, latestBlock: bigint): string {
  if (['CANCELED', 'EXECUTED'].includes(g.status)) return g.status;
  if (g.status === 'QUEUED') {
    if (g.executionETA) {
      if (Math.floor(Date.now() / 1000) >= Number(g.executionETA) + 14 * 86400) return 'EXPIRED';
    }
    return 'QUEUED';
  }
  if (g.status === 'ACTIVE') {
    if (latestBlock > BigInt(g.endBlock)) {
      if (g.forVotes === 0 || g.forVotes <= g.againstVotes) return 'DEFEATED';
      return 'SUCCEEDED';
    }
  }
  return g.status;
}

function formatTimeLeft(currentBlock: bigint, endBlock: string): string {
  const blocks = BigInt(endBlock) - currentBlock;
  if (blocks <= 0n) return 'ended';
  const seconds = Number(blocks) * 12;
  const hours = Math.floor(seconds / 3600);
  if (hours >= 48) return `~${Math.floor(hours / 24)}d`;
  if (hours >= 1) return `~${hours}h`;
  return `~${Math.floor(seconds / 60)}m`;
}

/**
 * Build a compact governance overview (proposals + grants) for chat injection.
 * Cached for 2 minutes. Returns empty string on failure.
 */
export async function buildProposalsAndGrantsContext(): Promise<string> {
  if (proposalsGrantsCache && Date.now() - proposalsGrantsCache.fetchedAt < PG_CACHE_TTL_MS) {
    return proposalsGrantsCache.text;
  }

  try {
    const [proposalsData, grantsData, latestBlock] = await Promise.all([
      gql<{ proposals: { items: RawProposal[] } }>(`{
        proposals(orderBy: "id", orderDirection: "desc", limit: 1000) {
          items { id, description, status, forVotes, againstVotes, abstainVotes, quorumVotes, startBlock, endBlock, objectionPeriodEndBlock, executionETA, onTimelockV1, proposer }
        }
      }`),
      gql<{ grants: { items: RawGrant[] } }>(`{
        grants(orderBy: "id", orderDirection: "desc", limit: 200) {
          items { id, description, status, forVotes, againstVotes, abstainVotes, endBlock, executionETA, proposer }
        }
      }`),
      getLatestBlock(),
    ]);

    const proposals = proposalsData.proposals?.items || [];
    const grants = grantsData.grants?.items || [];

    if (proposals.length === 0 && grants.length === 0) return '';

    // Derive statuses
    const withStatus = proposals.map(p => ({
      ...p,
      derivedStatus: latestBlock > 0n ? deriveProposalStatus(p, latestBlock) : p.status,
    }));

    const grantsWithStatus = grants.map(g => ({
      ...g,
      derivedStatus: latestBlock > 0n ? deriveGrantStatus(g, latestBlock) : g.status,
    }));

    // Count statuses
    const statusCounts: Record<string, number> = {};
    for (const p of withStatus) {
      statusCounts[p.derivedStatus] = (statusCounts[p.derivedStatus] || 0) + 1;
    }

    // Active/pending proposals (truly still voteable)
    const active = withStatus.filter(
      p => p.derivedStatus === 'ACTIVE' || p.derivedStatus === 'PENDING',
    );
    // Queued
    const queued = withStatus.filter(p => p.derivedStatus === 'QUEUED');
    // Succeeded (waiting to be queued)
    const succeeded = withStatus.filter(p => p.derivedStatus === 'SUCCEEDED');
    // Recently completed (last 10 defeated/executed)
    const recentCompleted = withStatus
      .filter(p => ['DEFEATED', 'EXECUTED', 'EXPIRED'].includes(p.derivedStatus))
      .slice(0, 10);

    // Build text
    let text = '\n\n## Governance Overview';
    const countParts = Object.entries(statusCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([s, c]) => `${c} ${s.toLowerCase()}`);
    text += `\n${proposals.length} total proposals: ${countParts.join(', ')}`;

    // Active proposals
    if (active.length > 0) {
      text += '\n\n### Active Proposals';
      for (const p of active) {
        const title = extractTitle(p.description);
        const time = formatTimeLeft(latestBlock, p.endBlock);
        text += `\n- #${p.id}: "${title}" — ${p.derivedStatus}, ${time} left, ${p.forVotes} for / ${p.againstVotes} against (quorum: ${p.quorumVotes})`;
      }
    } else {
      text += '\n\nNo active proposals right now.';
    }

    // Queued
    if (queued.length > 0) {
      text += '\n\n### Queued (awaiting execution)';
      for (const p of queued) {
        text += `\n- #${p.id}: "${extractTitle(p.description)}" — QUEUED, ${p.forVotes} for / ${p.againstVotes} against`;
      }
    }

    // Succeeded
    if (succeeded.length > 0) {
      text += '\n\n### Succeeded (awaiting queue)';
      for (const p of succeeded) {
        text += `\n- #${p.id}: "${extractTitle(p.description)}" — SUCCEEDED, ${p.forVotes} for / ${p.againstVotes} against`;
      }
    }

    // Recently completed
    if (recentCompleted.length > 0) {
      text += '\n\n### Recently Completed';
      for (const p of recentCompleted) {
        text += `\n- #${p.id}: "${extractTitle(p.description)}" — ${p.derivedStatus} (${p.forVotes} for, ${p.againstVotes} against)`;
      }
    }

    // Grants
    const grantStatusCounts: Record<string, number> = {};
    for (const g of grantsWithStatus) {
      grantStatusCounts[g.derivedStatus] = (grantStatusCounts[g.derivedStatus] || 0) + 1;
    }
    const activeGrants = grantsWithStatus.filter(g => g.derivedStatus === 'ACTIVE');
    const queuedGrants = grantsWithStatus.filter(g => g.derivedStatus === 'QUEUED');
    const succeededGrants = grantsWithStatus.filter(g => g.derivedStatus === 'SUCCEEDED');
    const recentGrants = grantsWithStatus
      .filter(g => ['DEFEATED', 'EXECUTED', 'EXPIRED'].includes(g.derivedStatus))
      .slice(0, 5);

    text += `\n\n## Small Grants (${grants.length} total)`;
    const grantCountParts = Object.entries(grantStatusCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([s, c]) => `${c} ${s.toLowerCase()}`);
    if (grantCountParts.length > 0) text += `\n${grantCountParts.join(', ')}`;

    if (activeGrants.length > 0) {
      text += '\n\n### Active Grants';
      for (const g of activeGrants) {
        const title = extractTitle(g.description);
        const time = formatTimeLeft(latestBlock, g.endBlock);
        text += `\n- Grant #${g.id}: "${title}" — ${time} left, ${g.forVotes} for / ${g.againstVotes} against`;
      }
    }

    if (queuedGrants.length > 0) {
      text += '\n\n### Queued Grants';
      for (const g of queuedGrants) {
        text += `\n- Grant #${g.id}: "${extractTitle(g.description)}" — QUEUED, ${g.forVotes} for / ${g.againstVotes} against`;
      }
    }

    if (succeededGrants.length > 0) {
      text += '\n\n### Succeeded Grants';
      for (const g of succeededGrants) {
        text += `\n- Grant #${g.id}: "${extractTitle(g.description)}" — SUCCEEDED, ${g.forVotes} for / ${g.againstVotes} against`;
      }
    }

    if (recentGrants.length > 0) {
      text += '\n\n### Recent Grant Results';
      for (const g of recentGrants) {
        text += `\n- Grant #${g.id}: "${extractTitle(g.description)}" — ${g.derivedStatus} (${g.forVotes} for, ${g.againstVotes} against)`;
      }
    }

    proposalsGrantsCache = { text, fetchedAt: Date.now() };
    return text;
  } catch (err) {
    console.error('[GovernanceContext] Failed to build proposals/grants context:', err);
    return '';
  }
}

/**
 * Resolve ENS name for any address. Exported for use by other modules.
 */
export { resolveEns };
