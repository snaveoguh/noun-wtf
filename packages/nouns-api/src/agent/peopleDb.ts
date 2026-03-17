// ─── Agent NounIRL — People Database ────────────────────────────────────────
//
// Comprehensive directory of every Nouns ecosystem participant.
// Cross-references all onchain activity (proposals, votes, auctions, bids,
// delegation, streams) into unified per-person profiles stored in Postgres.
//
// Build pipeline:
//   Phase 1: Collect all unique addresses from Ponder GraphQL
//   Phase 2: Batch ENS resolution
//   Phase 3: Aggregate onchain stats per address
//   Phase 4: Parse proposal descriptions for team mentions (Claude)
//   Phase 5: Generate summaries + auto-tags (Claude)

import { hubGenerate } from './hubClient.js';
import pg from 'pg';
import { resolveEns } from './governanceContext.js';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface PersonProfile {
  address: string;
  ensName: string | null;
  aliases: string[];
  associatedWallets: string[];
  proposalsCreated: Array<{ id: string; title: string; status: string }>;
  proposalsSigned: string[];
  proposalsMentioned: Array<{ id: string; context: string }>;
  votesTotal: number;
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
  nounsOwned: string[];
  auctionWins: Array<{ nounId: string; ethAmount: number }>;
  totalEthAuctions: number;
  streamsReceived: Array<{ proposalId: string | null; amount: number }>;
  totalEthStreams: number;
  delegatedVotes: number;
  delegatingTo: string | null;
  bidsPlaced: number;
  totalEthBid: number;
  firstSeenBlock: number | null;
  lastActiveBlock: number | null;
  tags: string[];
  profileSummary: string | null;
  updatedAt: number;
}

export interface BuildProgress {
  phase: string;
  detail: string;
  addressesFound?: number;
  addressesProcessed?: number;
  startedAt: string;
}

// ─── Postgres ──────────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL;
let pool: pg.Pool | null = null;

if (DATABASE_URL) {
  pool = new pg.Pool({
    connectionString: DATABASE_URL,
    max: 3,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
}

const INIT_SQL = `
  CREATE TABLE IF NOT EXISTS nounirl_people (
    address TEXT PRIMARY KEY,
    ens_name TEXT,
    aliases TEXT DEFAULT '[]',
    associated_wallets TEXT DEFAULT '[]',
    proposals_created TEXT DEFAULT '[]',
    proposals_signed TEXT DEFAULT '[]',
    proposals_mentioned TEXT DEFAULT '[]',
    votes_total INTEGER DEFAULT 0,
    votes_for INTEGER DEFAULT 0,
    votes_against INTEGER DEFAULT 0,
    votes_abstain INTEGER DEFAULT 0,
    nouns_owned TEXT DEFAULT '[]',
    auction_wins TEXT DEFAULT '[]',
    total_eth_auctions REAL DEFAULT 0,
    streams_received TEXT DEFAULT '[]',
    total_eth_streams REAL DEFAULT 0,
    delegated_votes INTEGER DEFAULT 0,
    delegating_to TEXT,
    bids_placed INTEGER DEFAULT 0,
    total_eth_bid REAL DEFAULT 0,
    first_seen_block INTEGER,
    last_active_block INTEGER,
    tags TEXT DEFAULT '[]',
    profile_summary TEXT,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_people_ens ON nounirl_people(ens_name);
  CREATE INDEX IF NOT EXISTS idx_people_votes ON nounirl_people(votes_total DESC);
  CREATE INDEX IF NOT EXISTS idx_people_eth ON nounirl_people(total_eth_auctions DESC);
  CREATE INDEX IF NOT EXISTS idx_people_updated ON nounirl_people(updated_at DESC);
`;

let dbInitialized = false;

async function ensureDb(): Promise<void> {
  if (dbInitialized || !pool) return;
  try {
    await pool.query(INIT_SQL);
    dbInitialized = true;
    console.log('[PeopleDb] Postgres table initialized');
  } catch (err) {
    console.error('[PeopleDb] Postgres init failed:', err);
  }
}

// ─── GraphQL Client ────────────────────────────────────────────────────────

const PONDER_URL = process.env.PONDER_SELF_URL
  || 'https://spirited-flexibility-production-3c30.up.railway.app';

async function gql<T>(query: string, timeoutMs = 30_000): Promise<T> {
  const res = await fetch(PONDER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`GraphQL error: ${res.status}`);
  const json = await res.json() as { data: T; errors?: Array<{ message: string }> };
  if (json.errors?.length) throw new Error(json.errors[0]!.message);
  return json.data;
}

// ─── Build Progress (in-memory) ────────────────────────────────────────────

let buildInProgress = false;
let lastProgress: BuildProgress | null = null;

export function getBuildStatus(): { running: boolean; progress: BuildProgress | null } {
  return { running: buildInProgress, progress: lastProgress };
}

function setProgress(phase: string, detail: string, extra?: Partial<BuildProgress>) {
  lastProgress = {
    phase, detail,
    startedAt: lastProgress?.startedAt || new Date().toISOString(),
    ...extra,
  };
  console.log(`[PeopleDb] ${phase}: ${detail}`);
}

// ─── Phase 1: Collect All Addresses ────────────────────────────────────────

async function collectAddresses(): Promise<Set<string>> {
  setProgress('Phase 1', 'Collecting all unique addresses from Ponder...');
  const addresses = new Set<string>();

  // Fetch in paginated batches from each source
  async function collectFromQuery(
    entityName: string,
    query: (offset: number) => string,
    extractAddrs: (data: any) => string[],
  ): Promise<void> {
    let offset = 0;
    const batchSize = 1000;
    let count = 0;
    while (true) {
      try {
        const data = await gql<any>(query(offset), 60_000);
        const items = extractAddrs(data);
        if (items.length === 0) break;
        for (const addr of items) {
          if (addr && addr.startsWith('0x') && addr.length === 42) {
            addresses.add(addr.toLowerCase());
          }
        }
        count += items.length;
        offset += batchSize;
        if (items.length < batchSize) break;
      } catch (err) {
        console.warn(`[PeopleDb] Error fetching ${entityName} at offset ${offset}:`, err);
        break;
      }
    }
    console.log(`[PeopleDb]   ${entityName}: ${count} records`);
  }

  // Proposers
  await collectFromQuery('proposers',
    (offset) => `{ proposals(limit: 1000, offset: ${offset}, orderBy: "id", orderDirection: "asc") { items { proposer } } }`,
    (d) => (d.proposals?.items || []).map((p: any) => p.proposer),
  );

  // Voters
  await collectFromQuery('voters',
    (offset) => `{ votes(limit: 1000, offset: ${offset}) { items { voter } } }`,
    (d) => (d.votes?.items || []).map((v: any) => v.voter),
  );

  // Auction winners
  await collectFromQuery('auction winners',
    (offset) => `{ auctions(limit: 1000, offset: ${offset}, orderBy: "nounId", orderDirection: "asc") { items { winner } } }`,
    (d) => (d.auctions?.items || []).map((a: any) => a.winner).filter(Boolean),
  );

  // Bidders
  await collectFromQuery('bidders',
    (offset) => `{ bids(limit: 1000, offset: ${offset}) { items { bidder } } }`,
    (d) => (d.bids?.items || []).map((b: any) => b.bidder),
  );

  // Delegates
  await collectFromQuery('delegates',
    (offset) => `{ delegates(limit: 1000, offset: ${offset}) { items { id } } }`,
    (d) => (d.delegates?.items || []).map((d2: any) => d2.id),
  );

  // Stream recipients
  await collectFromQuery('stream recipients',
    (offset) => `{ streams(limit: 1000, offset: ${offset}) { items { recipient } } }`,
    (d) => (d.streams?.items || []).map((s: any) => s.recipient),
  );

  // Proposal signers
  await collectFromQuery('proposal signers',
    (offset) => `{ proposalSigners(limit: 1000, offset: ${offset}) { items { signer } } }`,
    (d) => (d.proposalSigners?.items || []).map((s: any) => s.signer),
  );

  // Noun owners (current)
  await collectFromQuery('noun owners',
    (offset) => `{ nouns(limit: 1000, offset: ${offset}) { items { owner } } }`,
    (d) => (d.nouns?.items || []).map((n: any) => n.owner),
  );

  setProgress('Phase 1', `Found ${addresses.size} unique addresses`, { addressesFound: addresses.size });
  return addresses;
}

// ─── Phase 2: ENS Resolution ───────────────────────────────────────────────

async function resolveAllEns(addresses: string[]): Promise<Map<string, string | null>> {
  setProgress('Phase 2', `Resolving ENS for ${addresses.length} addresses...`);
  const ensMap = new Map<string, string | null>();
  let resolved = 0;

  // Process in batches of 5 with delays
  for (let i = 0; i < addresses.length; i += 5) {
    const batch = addresses.slice(i, i + 5);
    const results = await Promise.all(
      batch.map(addr => resolveEns(addr).catch(() => null)),
    );
    for (let j = 0; j < batch.length; j++) {
      ensMap.set(batch[j]!, results[j] ?? null);
      if (results[j]) resolved++;
    }

    if (i % 100 === 0 && i > 0) {
      setProgress('Phase 2', `Resolved ${i}/${addresses.length} (${resolved} ENS names found)`, {
        addressesProcessed: i,
        addressesFound: addresses.length,
      });
    }

    // Rate limit: small delay between batches
    if (i + 5 < addresses.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  setProgress('Phase 2', `ENS resolution complete: ${resolved}/${addresses.length} have ENS names`);
  return ensMap;
}

// ─── Phase 3: Aggregate Stats ──────────────────────────────────────────────

interface RawStats {
  proposalsCreated: Map<string, Array<{ id: string; title: string; status: string }>>;
  proposalsSigned: Map<string, string[]>;
  votes: Map<string, { total: number; for: number; against: number; abstain: number }>;
  nounsOwned: Map<string, string[]>;
  auctionWins: Map<string, Array<{ nounId: string; ethAmount: number }>>;
  bids: Map<string, { count: number; totalEth: number }>;
  delegates: Map<string, number>;
  delegatingTo: Map<string, string>;
  streams: Map<string, Array<{ proposalId: string | null; amount: number }>>;
  firstSeen: Map<string, number>;
  lastActive: Map<string, number>;
}

function extractTitle(description: string): string {
  const firstLine = (description || '').split('\n')[0] || '';
  return firstLine.replace(/^#\s*/, '').slice(0, 120) || 'Untitled';
}

async function aggregateStats(addresses: Set<string>): Promise<RawStats> {
  setProgress('Phase 3', 'Aggregating onchain stats...');

  const stats: RawStats = {
    proposalsCreated: new Map(),
    proposalsSigned: new Map(),
    votes: new Map(),
    nounsOwned: new Map(),
    auctionWins: new Map(),
    bids: new Map(),
    delegates: new Map(),
    delegatingTo: new Map(),
    streams: new Map(),
    firstSeen: new Map(),
    lastActive: new Map(),
  };

  function trackBlock(addr: string, block: number | null) {
    if (!block) return;
    const a = addr.toLowerCase();
    const f = stats.firstSeen.get(a);
    if (!f || block < f) stats.firstSeen.set(a, block);
    const l = stats.lastActive.get(a);
    if (!l || block > l) stats.lastActive.set(a, block);
  }

  // ── Proposals ──
  setProgress('Phase 3', 'Fetching proposals...');
  let offset = 0;
  while (true) {
    const d = await gql<{ proposals: { items: Array<{ id: string; proposer: string; description: string; status: string; createdAtBlock: string }> } }>(
      `{ proposals(limit: 1000, offset: ${offset}, orderBy: "id", orderDirection: "asc") { items { id, proposer, description, status, createdAtBlock } } }`,
      60_000,
    );
    const items = d.proposals?.items || [];
    if (items.length === 0) break;
    for (const p of items) {
      const addr = p.proposer.toLowerCase();
      if (!stats.proposalsCreated.has(addr)) stats.proposalsCreated.set(addr, []);
      stats.proposalsCreated.get(addr)!.push({ id: p.id, title: extractTitle(p.description), status: p.status });
      trackBlock(addr, parseInt(p.createdAtBlock, 10) || null);
    }
    offset += 1000;
    if (items.length < 1000) break;
  }

  // ── Proposal Signers ──
  setProgress('Phase 3', 'Fetching proposal signers...');
  offset = 0;
  while (true) {
    try {
      const d = await gql<{ proposalSigners: { items: Array<{ proposalId: string; signer: string }> } }>(
        `{ proposalSigners(limit: 1000, offset: ${offset}) { items { proposalId, signer } } }`,
        60_000,
      );
      const items = d.proposalSigners?.items || [];
      if (items.length === 0) break;
      for (const s of items) {
        const addr = s.signer.toLowerCase();
        if (!stats.proposalsSigned.has(addr)) stats.proposalsSigned.set(addr, []);
        stats.proposalsSigned.get(addr)!.push(s.proposalId);
      }
      offset += 1000;
      if (items.length < 1000) break;
    } catch {
      break; // table may not exist
    }
  }

  // ── Votes ──
  setProgress('Phase 3', 'Fetching votes...');
  offset = 0;
  while (true) {
    const d = await gql<{ votes: { items: Array<{ voter: string; support: number; createdAtBlock: string }> } }>(
      `{ votes(limit: 1000, offset: ${offset}) { items { voter, support, createdAtBlock } } }`,
      60_000,
    );
    const items = d.votes?.items || [];
    if (items.length === 0) break;
    for (const v of items) {
      const addr = v.voter.toLowerCase();
      if (!stats.votes.has(addr)) stats.votes.set(addr, { total: 0, for: 0, against: 0, abstain: 0 });
      const vr = stats.votes.get(addr)!;
      vr.total++;
      if (v.support === 1) vr.for++;
      else if (v.support === 0) vr.against++;
      else vr.abstain++;
      trackBlock(addr, parseInt(v.createdAtBlock, 10) || null);
    }
    offset += 1000;
    if (items.length < 1000) break;
  }

  // ── Nouns owned ──
  setProgress('Phase 3', 'Fetching noun ownership...');
  offset = 0;
  while (true) {
    const d = await gql<{ nouns: { items: Array<{ id: string; owner: string }> } }>(
      `{ nouns(limit: 1000, offset: ${offset}) { items { id, owner } } }`,
      60_000,
    );
    const items = d.nouns?.items || [];
    if (items.length === 0) break;
    for (const n of items) {
      const addr = n.owner.toLowerCase();
      if (!stats.nounsOwned.has(addr)) stats.nounsOwned.set(addr, []);
      stats.nounsOwned.get(addr)!.push(n.id);
    }
    offset += 1000;
    if (items.length < 1000) break;
  }

  // ── Auctions (settled) ──
  setProgress('Phase 3', 'Fetching auction wins...');
  offset = 0;
  while (true) {
    const d = await gql<{ auctions: { items: Array<{ nounId: string; winner: string; amount: string; settled: boolean }> } }>(
      `{ auctions(limit: 1000, offset: ${offset}, orderBy: "nounId", orderDirection: "asc") { items { nounId, winner, amount, settled } } }`,
      60_000,
    );
    const items = d.auctions?.items || [];
    if (items.length === 0) break;
    for (const a of items) {
      if (!a.settled || !a.winner) continue;
      const addr = a.winner.toLowerCase();
      const ethAmount = Number(a.amount) / 1e18;
      if (!stats.auctionWins.has(addr)) stats.auctionWins.set(addr, []);
      stats.auctionWins.get(addr)!.push({ nounId: a.nounId, ethAmount });
    }
    offset += 1000;
    if (items.length < 1000) break;
  }

  // ── Bids ──
  setProgress('Phase 3', 'Fetching bids...');
  offset = 0;
  while (true) {
    const d = await gql<{ bids: { items: Array<{ bidder: string; value: string }> } }>(
      `{ bids(limit: 1000, offset: ${offset}) { items { bidder, value } } }`,
      60_000,
    );
    const items = d.bids?.items || [];
    if (items.length === 0) break;
    for (const b of items) {
      const addr = b.bidder.toLowerCase();
      if (!stats.bids.has(addr)) stats.bids.set(addr, { count: 0, totalEth: 0 });
      const br = stats.bids.get(addr)!;
      br.count++;
      br.totalEth += Number(b.value) / 1e18;
    }
    offset += 1000;
    if (items.length < 1000) break;
  }

  // ── Delegates ──
  setProgress('Phase 3', 'Fetching delegates...');
  offset = 0;
  while (true) {
    const d = await gql<{ delegates: { items: Array<{ id: string; delegatedVotes: number }> } }>(
      `{ delegates(limit: 1000, offset: ${offset}, orderBy: "delegatedVotes", orderDirection: "desc") { items { id, delegatedVotes } } }`,
      60_000,
    );
    const items = d.delegates?.items || [];
    if (items.length === 0) break;
    for (const del of items) {
      stats.delegates.set(del.id.toLowerCase(), del.delegatedVotes);
    }
    offset += 1000;
    if (items.length < 1000) break;
  }

  // ── Delegation events (who delegates to whom — latest per delegator) ──
  setProgress('Phase 3', 'Fetching delegation events...');
  offset = 0;
  while (true) {
    try {
      const d = await gql<{ delegationEvents: { items: Array<{ delegator: string; toDelegate: string; createdAtBlock: string }> } }>(
        `{ delegationEvents(limit: 1000, offset: ${offset}, orderBy: "createdAtBlock", orderDirection: "desc") { items { delegator, toDelegate, createdAtBlock } } }`,
        60_000,
      );
      const items = d.delegationEvents?.items || [];
      if (items.length === 0) break;
      for (const de of items) {
        const delegator = de.delegator.toLowerCase();
        // Only store the most recent delegation (first seen since ordered desc)
        if (!stats.delegatingTo.has(delegator)) {
          stats.delegatingTo.set(delegator, de.toDelegate.toLowerCase());
        }
        trackBlock(delegator, parseInt(de.createdAtBlock, 10) || null);
      }
      offset += 1000;
      if (items.length < 1000) break;
    } catch {
      break;
    }
  }

  // ── Streams received ──
  setProgress('Phase 3', 'Fetching streams...');
  offset = 0;
  while (true) {
    try {
      const d = await gql<{ streams: { items: Array<{ recipient: string; proposalId: string | null; tokenAmount: string }> } }>(
        `{ streams(limit: 1000, offset: ${offset}) { items { recipient, proposalId, tokenAmount } } }`,
        60_000,
      );
      const items = d.streams?.items || [];
      if (items.length === 0) break;
      for (const s of items) {
        const addr = s.recipient.toLowerCase();
        const amount = Number(s.tokenAmount) / 1e18;
        if (!stats.streams.has(addr)) stats.streams.set(addr, []);
        stats.streams.get(addr)!.push({ proposalId: s.proposalId, amount });
      }
      offset += 1000;
      if (items.length < 1000) break;
    } catch {
      break;
    }
  }

  setProgress('Phase 3', 'Stats aggregation complete');
  return stats;
}

// ─── Phase 4: Parse Proposal Descriptions for Team Mentions ────────────────

interface TeamMention {
  proposalId: string;
  names: Array<{ name: string; address?: string }>;
}

function parseJsonArray(text: string): any[] {
  let cleaned = text.trim()
    .replace(/^```(?:json)?\s*\n?/i, '')
    .replace(/\n?```\s*$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) {
      try { return JSON.parse(match[0]); } catch { /* give up */ }
    }
    return [];
  }
}

async function parseTeamMentions(): Promise<TeamMention[]> {
  setProgress('Phase 4', 'Parsing proposal descriptions for team mentions...');
  const allMentions: TeamMention[] = [];

  // Fetch all proposals with descriptions
  let offset = 0;
  const allProposals: Array<{ id: string; description: string }> = [];
  while (true) {
    const d = await gql<{ proposals: { items: Array<{ id: string; description: string }> } }>(
      `{ proposals(limit: 200, offset: ${offset}, orderBy: "id", orderDirection: "asc") { items { id, description } } }`,
      60_000,
    );
    const items = d.proposals?.items || [];
    if (items.length === 0) break;
    allProposals.push(...items);
    offset += 200;
    if (items.length < 200) break;
  }

  // Process in batches of 25 proposals
  const BATCH_SIZE = 25;
  for (let i = 0; i < allProposals.length; i += BATCH_SIZE) {
    const batch = allProposals.slice(i, i + BATCH_SIZE);
    const batchText = batch.map(p => {
      const desc = (p.description || '').slice(0, 1000);
      return `=== PROP ${p.id} ===\n${desc}`;
    }).join('\n\n');

    try {
      const output = await hubGenerate({
        system: `Extract all team member names, aliases, ENS names, and wallet addresses mentioned in these Nouns DAO proposal descriptions. Focus on people who are named as team members, builders, artists, or collaborators — not organizations.

Output a JSON array of objects: [{"proposalId": "123", "names": [{"name": "4156", "address": "0x..."}, {"name": "gremplin.eth"}]}]
Only include proposals that mention specific people. Skip proposals with no team/person mentions.
Output ONLY the JSON array, no markdown fences.`,
        user: batchText,
        task: 'selfLearn',
        maxTokens: 2000,
        temperature: 0,
      });

      const mentions = parseJsonArray(output);
      for (const m of mentions) {
        if (m.proposalId && Array.isArray(m.names) && m.names.length > 0) {
          allMentions.push({
            proposalId: String(m.proposalId),
            names: m.names.filter((n: any) => n.name),
          });
        }
      }

      setProgress('Phase 4', `Processed ${Math.min(i + BATCH_SIZE, allProposals.length)}/${allProposals.length} proposals`);

      // Rate limit
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      console.warn(`[PeopleDb] Team mention extraction error at batch ${i}:`, err);
    }
  }

  setProgress('Phase 4', `Found team mentions in ${allMentions.length} proposals`);
  return allMentions;
}

// ─── Phase 5: Generate Tags + Summaries ────────────────────────────────────

// Known Nounder addresses
const NOUNDER_ADDRESSES = new Set([
  '0x2573c60a6d127755aa2dc85e342f7da2378a0cc5', // nounders.eth multisig
  '0x830bd73e4184cef73443c15111a1df14e495c706', // auction house
].map(a => a.toLowerCase()));

function computeTags(profile: Partial<PersonProfile>): string[] {
  const tags: string[] = [];
  if (NOUNDER_ADDRESSES.has(profile.address?.toLowerCase() || '')) tags.push('nounder');
  if ((profile.nounsOwned?.length || 0) >= 5) tags.push('whale');
  if ((profile.totalEthAuctions || 0) >= 100) tags.push('big-spender');
  if ((profile.votesTotal || 0) >= 100) tags.push('prolific-voter');
  if ((profile.votesTotal || 0) >= 10) tags.push('voter');
  if ((profile.proposalsCreated?.length || 0) >= 3) tags.push('proposer');
  if ((profile.proposalsCreated?.length || 0) >= 1) tags.push('has-proposed');
  if ((profile.delegatedVotes || 0) >= 5) tags.push('delegate');
  if ((profile.auctionWins?.length || 0) >= 3) tags.push('collector');
  if ((profile.streamsReceived?.length || 0) >= 1) tags.push('builder');
  if ((profile.proposalsSigned?.length || 0) >= 1) tags.push('signer');
  if ((profile.bidsPlaced || 0) >= 10) tags.push('active-bidder');
  return tags;
}

function activityScore(profile: Partial<PersonProfile>): number {
  return (
    (profile.proposalsCreated?.length || 0) * 10 +
    (profile.votesTotal || 0) * 1 +
    (profile.auctionWins?.length || 0) * 5 +
    (profile.bidsPlaced || 0) * 0.5 +
    (profile.delegatedVotes || 0) * 2 +
    (profile.nounsOwned?.length || 0) * 3 +
    (profile.streamsReceived?.length || 0) * 4 +
    (profile.proposalsSigned?.length || 0) * 3
  );
}

async function generateSummaries(profiles: PersonProfile[]): Promise<Map<string, string>> {
  setProgress('Phase 5', 'Generating profile summaries for top participants...');
  const summaries = new Map<string, string>();

  // Sort by activity and take top 200
  const sorted = [...profiles].sort((a, b) => activityScore(b) - activityScore(a)).slice(0, 200);

  // Process in batches of 20
  for (let i = 0; i < sorted.length; i += 20) {
    const batch = sorted.slice(i, i + 20);
    const batchText = batch.map(p => {
      const name = p.ensName || `${p.address.slice(0, 10)}...`;
      const parts = [`${name} (${p.address})`];
      if (p.nounsOwned.length > 0) parts.push(`Owns ${p.nounsOwned.length} Nouns`);
      if (p.proposalsCreated.length > 0) parts.push(`Created ${p.proposalsCreated.length} proposals`);
      if (p.votesTotal > 0) parts.push(`${p.votesTotal} votes (${p.votesFor} for, ${p.votesAgainst} against)`);
      if (p.auctionWins.length > 0) parts.push(`Won ${p.auctionWins.length} auctions (${p.totalEthAuctions.toFixed(1)} ETH)`);
      if (p.delegatedVotes > 0) parts.push(`${p.delegatedVotes} delegated votes`);
      if (p.streamsReceived.length > 0) parts.push(`Receives ${p.streamsReceived.length} payment streams`);
      if (p.tags.length > 0) parts.push(`Tags: ${p.tags.join(', ')}`);
      return parts.join(' | ');
    }).join('\n');

    try {
      const output = await hubGenerate({
        system: `Write a 1-2 sentence profile summary for each Nouns DAO participant. Be concise, factual, deadpan. Note their role (collector, builder, delegate, voter). Mention notable stats.
Output a JSON object: {"0xaddr": "summary text", ...}
Output ONLY the JSON, no markdown fences.`,
        user: batchText,
        task: 'selfLearn',
        maxTokens: 3000,
        temperature: 0.3,
      });

      try {
        let cleaned = output.trim()
          .replace(/^```(?:json)?\s*\n?/i, '')
          .replace(/\n?```\s*$/i, '')
          .trim();
        const parsed = JSON.parse(cleaned);
        for (const [addr, summary] of Object.entries(parsed)) {
          if (typeof summary === 'string') {
            summaries.set(addr.toLowerCase(), summary);
          }
        }
      } catch { /* parse error, skip batch */ }

      setProgress('Phase 5', `Generated summaries for ${Math.min(i + 20, sorted.length)}/${sorted.length} top participants`);
      await new Promise(r => setTimeout(r, 1500));
    } catch (err) {
      console.warn(`[PeopleDb] Summary generation error at batch ${i}:`, err);
    }
  }

  return summaries;
}

// ─── Upsert to Postgres ───────────────────────────────────────────────────

async function upsertPerson(profile: PersonProfile): Promise<void> {
  if (!pool) return;
  await ensureDb();

  const now = Math.floor(Date.now() / 1000);
  await pool.query(
    `INSERT INTO nounirl_people (
      address, ens_name, aliases, associated_wallets,
      proposals_created, proposals_signed, proposals_mentioned,
      votes_total, votes_for, votes_against, votes_abstain,
      nouns_owned, auction_wins, total_eth_auctions,
      streams_received, total_eth_streams,
      delegated_votes, delegating_to,
      bids_placed, total_eth_bid,
      first_seen_block, last_active_block,
      tags, profile_summary, updated_at
    ) VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
      $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25
    ) ON CONFLICT (address) DO UPDATE SET
      ens_name = $2, aliases = $3, associated_wallets = $4,
      proposals_created = $5, proposals_signed = $6, proposals_mentioned = $7,
      votes_total = $8, votes_for = $9, votes_against = $10, votes_abstain = $11,
      nouns_owned = $12, auction_wins = $13, total_eth_auctions = $14,
      streams_received = $15, total_eth_streams = $16,
      delegated_votes = $17, delegating_to = $18,
      bids_placed = $19, total_eth_bid = $20,
      first_seen_block = $21, last_active_block = $22,
      tags = $23, profile_summary = $24, updated_at = $25`,
    [
      profile.address,
      profile.ensName,
      JSON.stringify(profile.aliases),
      JSON.stringify(profile.associatedWallets),
      JSON.stringify(profile.proposalsCreated),
      JSON.stringify(profile.proposalsSigned),
      JSON.stringify(profile.proposalsMentioned),
      profile.votesTotal,
      profile.votesFor,
      profile.votesAgainst,
      profile.votesAbstain,
      JSON.stringify(profile.nounsOwned),
      JSON.stringify(profile.auctionWins),
      profile.totalEthAuctions,
      JSON.stringify(profile.streamsReceived),
      profile.totalEthStreams,
      profile.delegatedVotes,
      profile.delegatingTo,
      profile.bidsPlaced,
      profile.totalEthBid,
      profile.firstSeenBlock,
      profile.lastActiveBlock,
      JSON.stringify(profile.tags),
      profile.profileSummary,
      now,
    ],
  );
}

// ─── Full Build Pipeline ──────────────────────────────────────────────────

export async function buildPeopleDb(): Promise<{
  addressesProcessed: number;
  withEns: number;
  withSummaries: number;
  errors: string[];
}> {
  if (buildInProgress) throw new Error('Build already in progress');
  if (!pool) throw new Error('DATABASE_URL not configured');

  buildInProgress = true;
  lastProgress = { phase: 'Starting', detail: 'Initializing...', startedAt: new Date().toISOString() };
  const errors: string[] = [];

  try {
    await ensureDb();

    // Phase 1: Collect addresses
    const addressSet = await collectAddresses();
    const addressList = Array.from(addressSet);

    // Phase 2: ENS resolution
    const ensMap = await resolveAllEns(addressList);

    // Phase 3: Aggregate stats
    const stats = await aggregateStats(addressSet);

    // Phase 4: Team mentions (Claude)
    let teamMentions: TeamMention[] = [];
    try {
      teamMentions = await parseTeamMentions();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Phase 4 error: ${msg}`);
      console.error('[PeopleDb] Phase 4 failed:', msg);
    }

    // Build mention index: address -> [{id, context}]
    // Also build a name->address map from mentions
    const mentionsByAddr = new Map<string, Array<{ id: string; context: string }>>();
    for (const mention of teamMentions) {
      for (const person of mention.names) {
        if (person.address) {
          const addr = person.address.toLowerCase();
          if (!mentionsByAddr.has(addr)) mentionsByAddr.set(addr, []);
          mentionsByAddr.get(addr)!.push({
            id: mention.proposalId,
            context: person.name,
          });
        }
      }
    }

    // Assemble profiles
    setProgress('Phase 5', 'Assembling profiles...');
    const profiles: PersonProfile[] = [];
    const now = Math.floor(Date.now() / 1000);

    for (const addr of addressList) {
      const voteStats = stats.votes.get(addr) || { total: 0, for: 0, against: 0, abstain: 0 };
      const bidStats = stats.bids.get(addr) || { count: 0, totalEth: 0 };
      const wins = stats.auctionWins.get(addr) || [];
      const strms = stats.streams.get(addr) || [];

      const profile: PersonProfile = {
        address: addr,
        ensName: ensMap.get(addr) ?? null,
        aliases: [],
        associatedWallets: [],
        proposalsCreated: stats.proposalsCreated.get(addr) || [],
        proposalsSigned: stats.proposalsSigned.get(addr) || [],
        proposalsMentioned: mentionsByAddr.get(addr) || [],
        votesTotal: voteStats.total,
        votesFor: voteStats.for,
        votesAgainst: voteStats.against,
        votesAbstain: voteStats.abstain,
        nounsOwned: stats.nounsOwned.get(addr) || [],
        auctionWins: wins,
        totalEthAuctions: wins.reduce((sum, w) => sum + w.ethAmount, 0),
        streamsReceived: strms,
        totalEthStreams: strms.reduce((sum, s) => sum + s.amount, 0),
        delegatedVotes: stats.delegates.get(addr) || 0,
        delegatingTo: stats.delegatingTo.get(addr) || null,
        bidsPlaced: bidStats.count,
        totalEthBid: bidStats.totalEth,
        firstSeenBlock: stats.firstSeen.get(addr) || null,
        lastActiveBlock: stats.lastActive.get(addr) || null,
        tags: [],
        profileSummary: null,
        updatedAt: now,
      };

      profile.tags = computeTags(profile);
      profiles.push(profile);
    }

    // Phase 5: Generate summaries for top participants
    let summaries = new Map<string, string>();
    try {
      summaries = await generateSummaries(profiles);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Phase 5 summary error: ${msg}`);
    }

    // Apply summaries and write to DB
    setProgress('Phase 5', `Writing ${profiles.length} profiles to Postgres...`);
    let written = 0;
    for (const profile of profiles) {
      profile.profileSummary = summaries.get(profile.address) || null;
      try {
        await upsertPerson(profile);
        written++;
        if (written % 200 === 0) {
          setProgress('Phase 5', `Written ${written}/${profiles.length} profiles`);
        }
      } catch (err) {
        console.warn(`[PeopleDb] Failed to write ${profile.address}:`, err);
      }
    }

    const withEns = profiles.filter(p => p.ensName).length;
    const withSummaries = summaries.size;

    setProgress('Complete', `Built ${profiles.length} profiles (${withEns} with ENS, ${withSummaries} with summaries)`);
    console.log(`[PeopleDb] Build complete: ${profiles.length} people, ${withEns} ENS, ${withSummaries} summaries`);

    return { addressesProcessed: profiles.length, withEns, withSummaries, errors };

  } finally {
    buildInProgress = false;
  }
}

// ─── Query API ────────────────────────────────────────────────────────────

function rowToProfile(row: any): PersonProfile {
  return {
    address: row.address,
    ensName: row.ens_name,
    aliases: JSON.parse(row.aliases || '[]'),
    associatedWallets: JSON.parse(row.associated_wallets || '[]'),
    proposalsCreated: JSON.parse(row.proposals_created || '[]'),
    proposalsSigned: JSON.parse(row.proposals_signed || '[]'),
    proposalsMentioned: JSON.parse(row.proposals_mentioned || '[]'),
    votesTotal: row.votes_total,
    votesFor: row.votes_for,
    votesAgainst: row.votes_against,
    votesAbstain: row.votes_abstain,
    nounsOwned: JSON.parse(row.nouns_owned || '[]'),
    auctionWins: JSON.parse(row.auction_wins || '[]'),
    totalEthAuctions: row.total_eth_auctions,
    streamsReceived: JSON.parse(row.streams_received || '[]'),
    totalEthStreams: row.total_eth_streams,
    delegatedVotes: row.delegated_votes,
    delegatingTo: row.delegating_to,
    bidsPlaced: row.bids_placed,
    totalEthBid: row.total_eth_bid,
    firstSeenBlock: row.first_seen_block,
    lastActiveBlock: row.last_active_block,
    tags: JSON.parse(row.tags || '[]'),
    profileSummary: row.profile_summary,
    updatedAt: row.updated_at,
  };
}

const SORTABLE_COLUMNS: Record<string, string> = {
  votes: 'votes_total',
  eth_auctions: 'total_eth_auctions',
  eth_bid: 'total_eth_bid',
  eth_streams: 'total_eth_streams',
  delegated_votes: 'delegated_votes',
  nouns: "(SELECT COUNT(*) FROM json_each(nouns_owned))",
  proposals: "(SELECT COUNT(*) FROM json_each(proposals_created))",
  updated: 'updated_at',
};

export async function listPeople(opts: {
  limit?: number;
  offset?: number;
  sort?: string;
  tag?: string;
}): Promise<{ people: PersonProfile[]; total: number }> {
  if (!pool) return { people: [], total: 0 };
  await ensureDb();

  const limit = Math.min(opts.limit || 50, 200);
  const offset = opts.offset || 0;
  const sortCol = SORTABLE_COLUMNS[opts.sort || 'votes'] || 'votes_total';

  let whereClause = '';
  const params: any[] = [];

  if (opts.tag) {
    params.push(`%"${opts.tag}"%`);
    whereClause = `WHERE tags LIKE $${params.length}`;
  }

  const countRes = await pool.query(
    `SELECT COUNT(*) as count FROM nounirl_people ${whereClause}`,
    params,
  );
  const total = parseInt(countRes.rows[0]?.count || '0', 10);

  const queryParams = [...params, limit, offset];
  const res = await pool.query(
    `SELECT * FROM nounirl_people ${whereClause}
     ORDER BY ${sortCol} DESC NULLS LAST
     LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`,
    queryParams,
  );

  return { people: res.rows.map(rowToProfile), total };
}

export async function getPerson(address: string): Promise<PersonProfile | null> {
  if (!pool) return null;
  await ensureDb();

  const res = await pool.query(
    'SELECT * FROM nounirl_people WHERE address = $1',
    [address.toLowerCase()],
  );
  if (res.rows.length === 0) return null;
  return rowToProfile(res.rows[0]);
}

export async function searchPeople(query: string, limit = 20): Promise<PersonProfile[]> {
  if (!pool) return [];
  await ensureDb();

  const q = query.toLowerCase().trim();

  // Search by address prefix, ENS name, or aliases
  const res = await pool.query(
    `SELECT * FROM nounirl_people
     WHERE address LIKE $1
        OR LOWER(ens_name) LIKE $2
        OR LOWER(aliases) LIKE $2
        OR LOWER(profile_summary) LIKE $2
     ORDER BY votes_total DESC
     LIMIT $3`,
    [`${q}%`, `%${q}%`, limit],
  );

  return res.rows.map(rowToProfile);
}

export async function getPeopleCount(): Promise<number> {
  if (!pool) return 0;
  await ensureDb();
  const res = await pool.query('SELECT COUNT(*) as count FROM nounirl_people');
  return parseInt(res.rows[0]?.count || '0', 10);
}

// ─── Chat Context Injection ──────────────────────────────────────────────

export async function buildPeopleContext(maxPeople = 30): Promise<string> {
  if (!pool) return '';
  await ensureDb();

  try {
    const res = await pool.query(
      `SELECT address, ens_name, tags, profile_summary, votes_total, nouns_owned,
              total_eth_auctions, delegated_votes, proposals_created
       FROM nounirl_people
       WHERE profile_summary IS NOT NULL
       ORDER BY votes_total DESC
       LIMIT $1`,
      [maxPeople],
    );

    if (res.rows.length === 0) return '';

    const lines = ['NOUNS ECOSYSTEM PEOPLE DIRECTORY:'];
    for (const row of res.rows) {
      const name = row.ens_name || `${row.address.slice(0, 10)}...`;
      const tags = JSON.parse(row.tags || '[]');
      const nouns = JSON.parse(row.nouns_owned || '[]');
      const proposals = JSON.parse(row.proposals_created || '[]');
      const tagStr = tags.length > 0 ? ` [${tags.join(',')}]` : '';
      const summary = row.profile_summary || '';
      lines.push(`- ${name}${tagStr}: ${summary} (${nouns.length} nouns, ${proposals.length} props, ${row.votes_total} votes, ${row.delegated_votes} delegated, ${(row.total_eth_auctions || 0).toFixed(1)} ETH spent)`);
    }

    return '\n\n' + lines.join('\n');
  } catch (err) {
    console.warn('[PeopleDb] Failed to build people context:', err);
    return '';
  }
}

/**
 * Look up a specific person by address or ENS fragment for chat context.
 */
export async function lookupPersonForChat(query: string): Promise<string> {
  const results = await searchPeople(query, 3);
  if (results.length === 0) return '';

  const lines: string[] = [];
  for (const p of results) {
    const name = p.ensName || `${p.address.slice(0, 10)}...`;
    lines.push(`\n### ${name} (${p.address})`);
    if (p.ensName) lines.push(`ENS: ${p.ensName}`);
    if (p.tags.length > 0) lines.push(`Tags: ${p.tags.join(', ')}`);
    if (p.profileSummary) lines.push(p.profileSummary);
    if (p.nounsOwned.length > 0) lines.push(`Nouns owned: ${p.nounsOwned.join(', ')}`);
    if (p.proposalsCreated.length > 0) {
      lines.push(`Proposals (${p.proposalsCreated.length}):`);
      for (const pr of p.proposalsCreated.slice(0, 5)) {
        lines.push(`  - Prop ${pr.id}: "${pr.title}" [${pr.status}]`);
      }
    }
    if (p.votesTotal > 0) {
      lines.push(`Votes: ${p.votesTotal} total (${p.votesFor} for, ${p.votesAgainst} against, ${p.votesAbstain} abstain)`);
    }
    if (p.auctionWins.length > 0) {
      lines.push(`Auction wins: ${p.auctionWins.length} (${p.totalEthAuctions.toFixed(2)} ETH total)`);
    }
    if (p.delegatedVotes > 0) lines.push(`Delegated votes: ${p.delegatedVotes}`);
    if (p.streamsReceived.length > 0) lines.push(`Payment streams: ${p.streamsReceived.length} (${p.totalEthStreams.toFixed(2)} ETH)`);
    if (p.bidsPlaced > 0) lines.push(`Bids placed: ${p.bidsPlaced} (${p.totalEthBid.toFixed(2)} ETH total bid volume)`);
  }

  return lines.join('\n');
}
