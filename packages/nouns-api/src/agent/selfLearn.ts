// ─── Agent NounIRL — Self-Learning from noun.wtf's Ponder GraphQL ─────────────
//
// Queries our own indexed data (proposals, auctions, votes, delegates)
// and distills it into the knowledge base using Claude.
// This is the primary knowledge source — we learn from ourselves.

import { hubGenerate } from './hubClient.js';
import { remember, recall } from './memory.js';

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Parse a JSON array from Claude's response, stripping markdown fences if present */
function parseFactsArray(text: string): string[] {
  // Strip markdown code fences
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  cleaned = cleaned.trim();

  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((f: unknown) => typeof f === 'string' && f.length > 10);
  } catch {
    // Try to find a JSON array in the text
    const match = cleaned.match(/\[[\s\S]*\]/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed)) {
          return parsed.filter((f: unknown) => typeof f === 'string' && f.length > 10);
        }
      } catch { /* give up */ }
    }
    return [];
  }
}

// ─── Types ─────────────────────────────────────────────────────────────────

interface ProposalTransaction {
  value: string;   // wei
  target: string;
  signature: string;
}

interface ProposalData {
  id: string;
  proposer: string;
  description: string;
  status: string;
  forVotes: number;
  againstVotes: number;
  abstainVotes: number;
  quorumVotes: string;
  createdAt: string;
  transactions?: { items: ProposalTransaction[] };
}

interface AuctionData {
  nounId: string;
  amount: string;
  winner: string;
  settled: boolean;
  startTime: string;
}

interface SelfLearnResult {
  proposalsProcessed: number;
  factsStored: number;
  errors: string[];
}

// ─── GraphQL Client ──────────────────────────────────────────────────────────

const PONDER_URL = process.env.PONDER_SELF_URL
  || 'https://spirited-flexibility-production-3c30.up.railway.app';

async function gqlQuery<T>(query: string): Promise<T> {
  const res = await fetch(PONDER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`GraphQL error: ${res.status}`);
  const json = await res.json() as { data: T; errors?: Array<{ message: string }> };
  if (json.errors && json.errors.length > 0) throw new Error(json.errors[0]!.message);
  return json.data;
}

// ─── Proposal Ingestion ──────────────────────────────────────────────────────

const PROPOSAL_ANALYSIS_PROMPT = `You are analyzing Nouns DAO governance proposals for an AI agent's knowledge base. Extract the MOST important facts from this batch of proposals.

RULES:
1. Focus on: proposal topics, ETH amounts requested, outcomes (passed/failed), notable voting patterns, proposer activity, key themes
2. Synthesize across proposals — identify patterns, recurring themes, big-budget items, controversial votes
3. Each fact should be a single, self-contained sentence
4. Include specific numbers: ETH amounts requested, vote counts, proposal IDs
5. Note any interesting voting dynamics (close votes, unanimous decisions, vetoed proposals)
6. Identify major funding categories (art, development, marketing, community, infrastructure)
7. Track which proposals were executed vs cancelled, and total ETH allocated per category
8. Track total treasury outflows — sum up all ETH requested in executed proposals
9. Output 15-30 facts for a batch of ~50 proposals

Output format: JSON array of strings. Each string is one fact.
Output ONLY the JSON array, no markdown fences, no explanation.`;

/**
 * Fetch proposals from our Ponder GraphQL in batches, analyze with Claude,
 * store distilled facts in knowledge base.
 */
export async function learnFromProposals(
  batchSize = 50,
  maxBatches = 20,
): Promise<SelfLearnResult> {
  let totalProcessed = 0;
  let totalFacts = 0;
  const errors: string[] = [];

  // Check what we've already learned to avoid re-processing
  const existingKnowledge = await recall('self-learn-progress');
  const lastProcessedId = existingKnowledge.length > 0
    ? parseInt(existingKnowledge[0]!.content, 10) || 0
    : 0;

  console.log(`[SelfLearn] Starting proposal ingestion from id > ${lastProcessedId}`);

  for (let batch = 0; batch < maxBatches; batch++) {
    const offset = batch * batchSize;

    try {
      // Fetch a batch of proposals ordered by id ascending
      const data = await gqlQuery<{
        proposals: {
          items: ProposalData[];
          totalCount: number;
        };
      }>(`{
        proposals(
          limit: ${batchSize},
          offset: ${offset},
          orderBy: "id",
          orderDirection: "asc"
        ) {
          items {
            id
            proposer
            description
            status
            forVotes
            againstVotes
            abstainVotes
            quorumVotes
            createdAt
            transactions {
              items {
                value
                target
                signature
              }
            }
          }
          totalCount
        }
      }`);

      const proposals = data.proposals.items;
      if (proposals.length === 0) break;

      // Build a summary of this batch for Claude to analyze
      const batchText = proposals.map(p => {
        // Truncate descriptions to keep under context limits
        const desc = p.description?.slice(0, 500) || 'No description';
        const title = (desc.split('\n')[0] || '').replace(/^#\s*/, '').slice(0, 120);
        const totalVotes = p.forVotes + p.againstVotes + p.abstainVotes;
        const passRate = totalVotes > 0
          ? ((p.forVotes / totalVotes) * 100).toFixed(0) + '%'
          : 'N/A';

        // Calculate total ETH requested from transaction values
        const txs = p.transactions?.items || [];
        const totalEth = txs.reduce((sum, tx) => sum + Number(tx.value) / 1e18, 0);
        const ethLine = totalEth > 0 ? `\n  ETH Requested: ${totalEth.toFixed(2)} ETH` : '';
        const targets = txs.length > 0
          ? `\n  Targets: ${txs.map(tx => tx.target.slice(0, 10) + '...').join(', ')}`
          : '';

        return `Prop ${p.id} [${p.status}]: "${title}"
  Proposer: ${p.proposer.slice(0, 10)}...
  Votes: For=${p.forVotes} Against=${p.againstVotes} Abstain=${p.abstainVotes} (${passRate} approval)
  Quorum: ${p.quorumVotes}${ethLine}${targets}
  Description excerpt: ${desc.slice(0, 300)}`;
      }).join('\n\n');

      // Analyze via agent-hub
      const output = await hubGenerate({
        system: PROPOSAL_ANALYSIS_PROMPT,
        user: `Analyze this batch of Nouns DAO proposals (Prop ${proposals[0]!.id} through Prop ${proposals[proposals.length - 1]!.id}):\n\n${batchText}`,
        task: 'selfLearn',
        maxTokens: 3000,
        temperature: 0.1,
      });

      const facts = parseFactsArray(output);
      if (facts.length === 0) {
        console.error('[SelfLearn] No facts extracted from batch:', output.slice(0, 200));
        errors.push(`Batch ${batch}: No facts extracted`);
        continue;
      }

      // Store facts in knowledge base
      const firstProp = proposals[0]!;
      const lastProp = proposals[proposals.length - 1]!;
      const batchLabel = `proposals-${firstProp.id}-${lastProp.id}`;
      for (let i = 0; i < facts.length; i++) {
        await remember('knowledge', `${batchLabel}-${i}`, facts[i]!);
      }

      totalProcessed += proposals.length;
      totalFacts += facts.length;

      // Track progress
      await remember('self-learn-progress', 'last-proposal-id', String(lastProp.id));

      console.log(`[SelfLearn] Batch ${batch + 1}: Processed props ${firstProp.id}-${lastProp.id}, extracted ${facts.length} facts`);

      // Small delay between batches to be respectful of Claude API
      if (batch < maxBatches - 1) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }

      // If we got fewer than batchSize, we've reached the end
      if (proposals.length < batchSize) break;

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[SelfLearn] Batch ${batch} error:`, msg);
      errors.push(`Batch ${batch}: ${msg}`);
      // Continue to next batch
    }
  }

  // Store a source record
  await remember(
    'knowledge-sources',
    'noun.wtf-proposals',
    `Self-learned from ${totalProcessed} proposals via Ponder GraphQL, extracted ${totalFacts} facts on ${new Date().toISOString().split('T')[0]}`,
  );

  console.log(`[SelfLearn] Complete: ${totalProcessed} proposals → ${totalFacts} facts`);
  return { proposalsProcessed: totalProcessed, factsStored: totalFacts, errors };
}

// ─── Auction Stats Ingestion ─────────────────────────────────────────────────

/**
 * Learn aggregate auction statistics from our indexed data.
 */
export async function learnFromAuctions(): Promise<{ factsStored: number }> {
  // Fetch recent auctions
  const data = await gqlQuery<{
    auctions: {
      items: AuctionData[];
      totalCount: number;
    };
  }>(`{
    auctions(
      limit: 100,
      orderBy: "nounId",
      orderDirection: "desc"
    ) {
      items {
        nounId
        amount
        winner
        settled
        startTime
      }
      totalCount
    }
  }`);

  // Filter to settled auctions with valid amounts
  const auctions = data.auctions.items.filter(a => a.settled && a.amount);
  const totalAuctions = data.auctions.totalCount;

  if (auctions.length === 0) {
    console.log('[SelfLearn] No settled auctions found');
    return { factsStored: 0 };
  }

  // Build auction summary for Claude
  const auctionText = auctions.map(a => {
    const ethAmount = (Number(a.amount) / 1e18).toFixed(4);
    return `Noun ${a.nounId}: ${ethAmount} ETH → ${(a.winner || 'unknown').slice(0, 10)}...`;
  }).join('\n');

  const avgPrice = auctions.reduce((sum, a) => sum + Number(a.amount) / 1e18, 0) / auctions.length;

  const output = await hubGenerate({
    system: `You are analyzing Nouns DAO auction data. Extract key statistical facts about auction prices, trends, notable sales, and patterns. Output a JSON array of fact strings (10-15 facts).`,
    user: `Total auctions in history: ${totalAuctions}\nAverage of last 100: ${avgPrice.toFixed(4)} ETH\n\nLast 100 settled auctions:\n${auctionText}`,
    task: 'selfLearn',
    maxTokens: 2000,
    temperature: 0.1,
  });

  const facts = parseFactsArray(output);
  if (facts.length === 0) {
    console.error('[SelfLearn] No auction facts extracted:', output.slice(0, 200));
    return { factsStored: 0 };
  }

  for (let i = 0; i < facts.length; i++) {
    await remember('knowledge', `auction-stats-${i}`, facts[i]!);
  }

  await remember(
    'knowledge-sources',
    'noun.wtf-auctions',
    `Self-learned from ${totalAuctions} auctions, extracted ${facts.length} facts on ${new Date().toISOString().split('T')[0]}`,
  );

  console.log(`[SelfLearn] Auction stats: ${facts.length} facts from ${totalAuctions} auctions`);
  return { factsStored: facts.length };
}

// ─── Delegate/Voter Stats ────────────────────────────────────────────────────

/**
 * Learn about top delegates and voting patterns.
 */
export async function learnFromDelegates(): Promise<{ factsStored: number }> {
  const data = await gqlQuery<{
    delegates: {
      items: Array<{ id: string; delegatedVotes: number }>;
      totalCount: number;
    };
  }>(`{
    delegates(limit: 50, orderBy: "delegatedVotes", orderDirection: "desc") {
      items {
        id
        delegatedVotes
      }
      totalCount
    }
  }`);

  const delegates = data.delegates.items;
  const totalDelegates = data.delegates.totalCount;

  const delegateText = delegates.map((d, i) =>
    `#${i + 1}: ${d.id.slice(0, 10)}... — ${d.delegatedVotes} votes`,
  ).join('\n');

  const output = await hubGenerate({
    system: `You are analyzing Nouns DAO delegate data. Extract key facts about the delegate landscape: concentration of voting power, number of active delegates, whale delegates, etc. Output a JSON array of fact strings (5-10 facts).`,
    user: `Total delegates: ${totalDelegates}\n\nTop 50 delegates by voting power:\n${delegateText}`,
    task: 'selfLearn',
    maxTokens: 1500,
    temperature: 0.1,
  });

  const facts = parseFactsArray(output);
  if (facts.length === 0) {
    console.error('[SelfLearn] No delegate facts extracted:', output.slice(0, 200));
    return { factsStored: 0 };
  }

  for (let i = 0; i < facts.length; i++) {
    await remember('knowledge', `delegate-stats-${i}`, facts[i]!);
  }

  await remember(
    'knowledge-sources',
    'noun.wtf-delegates',
    `Self-learned from ${totalDelegates} delegates, extracted ${facts.length} facts on ${new Date().toISOString().split('T')[0]}`,
  );

  return { factsStored: facts.length };
}

// ─── Full Self-Learn Pipeline ────────────────────────────────────────────────

/**
 * Run the complete self-learning pipeline:
 * 1. Ingest all proposals (batched)
 * 2. Analyze auction statistics
 * 3. Analyze delegate landscape
 */
export async function runSelfLearn(): Promise<{
  proposals: SelfLearnResult;
  auctions: { factsStored: number };
  delegates: { factsStored: number };
  totalFacts: number;
}> {
  console.log('[SelfLearn] ⌐◨-◨ Starting full self-learning pipeline...');

  const proposals = await learnFromProposals();
  const auctions = await learnFromAuctions();
  const delegates = await learnFromDelegates();

  const totalFacts = proposals.factsStored + auctions.factsStored + delegates.factsStored;

  console.log(`[SelfLearn] ✅ Pipeline complete: ${totalFacts} total facts learned`);

  return { proposals, auctions, delegates, totalFacts };
}
