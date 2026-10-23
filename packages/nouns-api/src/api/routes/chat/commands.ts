import { desc, eq } from 'drizzle-orm';
import { db } from 'ponder:api';
import schema from 'ponder:schema';

import { proposalTitle } from '../../../agent/governanceContext.js';
import {
  checkNow,
  detectFunction,
  getAllTraitNames,
  getWatcherState,
  reservationStore,
} from '../../../agent/index.js';
import {
  getPerformance as getTradingPerformance,
  getPositions as getTradingPositions,
  getSignals as getTradingSignals,
} from '../../../agent/tradingClient.js';
import { formatBlocksRemaining, getCurrentBlock } from '../../lib/chain.js';

import { expandProposalTransactions, parseCandidateTransfer } from './proposalTx.js';

// ============================================================
// Command Parser — free governance actions without Claude API
// ============================================================

interface ParsedCommand {
  handled: boolean;
  response?: string;
  action?: Record<string, unknown>;
}

const HELP_TEXT = `Available commands (free, no AI needed):

GOVERNANCE:
  vote for/against/abstain prop <ID> [reason]
  feedback for/against prop <ID> [reason]
  show prop <ID>
  active proposals
  execute prop <ID>

CANDIDATES:
  create candidate: <title> - <description>
  sponsor candidate <keyword>
  promote candidate <keyword>
  feedback for/against candidate <keyword>
  show candidate <keyword>

GRANTS:
  vote for/against grant <ID> [reason]
  create grant: <title> - <description>
  show grant <ID>
  active grants
  execute grant <ID>

AUCTION:
  bid <amount> eth

AGENT:
  status
  check block
  list traits <category>
  my reservations

TRADING (pooter.world bot):
  trading status / positions
  market signals

Or just type freely and I'll respond with AI. ⌐◨-◨`;

// ─── Smart Candidate Search ─────────────────────────────────────────────────
// Searches slug, title (first line of description), and description body.
// Tokenized: splits query into words, all must appear somewhere.
// Priority: exact slug > slug contains > title match > description match.
// Returns up to `limit` results, excluding canceled by default.

type CandidateRow = typeof schema.candidate.$inferSelect;

// Slug/title hits (exact-slug 100, slug-contains 80, title-contains 60) count as
// strong "the user means this candidate" matches; description/token-only hits
// (<60) are weak relevance backstops. Used by `preferRecent` to decide which
// matches may be re-ordered newest-first.
const STRONG_MATCH_SCORE = 60;

export async function findCandidates(
  keyword: string,
  opts: {
    includeCanceled?: boolean;
    includePromoted?: boolean;
    limit?: number;
    preferRecent?: boolean;
  } = {},
): Promise<CandidateRow[]> {
  const {
    includeCanceled = false,
    includePromoted = false,
    limit = 5,
    preferRecent = false,
  } = opts;
  // Fetch a large pool — candidates are small rows
  const allCands = await db
    .select()
    .from(schema.candidate)
    .orderBy(desc(schema.candidate.createdAtBlock))
    .limit(500);

  const kw = keyword.toLowerCase().trim();
  // Normalize: strip punctuation for fuzzy matching
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^\d\sa-z]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const kwNorm = normalize(kw);
  const kwTokens = kwNorm.split(' ').filter(Boolean);

  type Scored = { row: CandidateRow; score: number; title: string };
  const results: Scored[] = [];

  for (const c of allCands) {
    if (!includeCanceled && c.canceled) continue;
    // Skip already-promoted candidates by default. Without this filter, a
    // resubmitted candidate that shares the original's slug stem (e.g.
    // `nouns-x-501c3-study` already-promoted vs the new `…-mog6ls68`) can
    // win the fuzzy match on exact-slug score 100 vs the new candidate's
    // 80 substring score, sending the dead row's targets/calldatas to
    // proposeBySigs and creating a duplicate proposal.
    if (!includePromoted && c.promotedToProposalId != null) continue;

    const slug = (c.slug ?? '').toString();
    const slugNorm = normalize(slug);
    const descText = (c.description ?? '').toString();
    const title =
      descText
        .split('\n')[0]
        ?.replace(/^#+\s*/, '')
        .trim() || '';
    const titleNorm = normalize(title);
    const descNorm = normalize(descText);

    let score = 0;

    // Exact slug match (highest priority)
    if (slugNorm === kwNorm || slug.toLowerCase() === kw) {
      score = 100;
    }
    // Slug contains the full query
    else if (slugNorm.includes(kwNorm)) {
      score = 80;
    }
    // Title contains the full query
    else if (titleNorm.includes(kwNorm)) {
      score = 60;
    }
    // Description contains the full query
    else if (descNorm.includes(kwNorm)) {
      score = 40;
    }
    // Tokenized: all query words appear in slug+title+desc
    else if (kwTokens.length > 1) {
      const haystack = `${slugNorm} ${titleNorm} ${descNorm}`;
      const allMatch = kwTokens.every(tok => haystack.includes(tok));
      if (allMatch) {
        // Score by how many tokens match in just the title/slug
        const titleHaystack = `${slugNorm} ${titleNorm}`;
        const titleHits = kwTokens.filter(tok => titleHaystack.includes(tok)).length;
        score = 20 + (titleHits / kwTokens.length) * 15;
      }
    }
    // Single token: check if it appears anywhere
    else if (kwTokens.length === 1) {
      const haystack = `${slugNorm} ${titleNorm} ${descNorm}`;
      if (haystack.includes(kwTokens[0])) {
        if (slugNorm.includes(kwTokens[0])) {
          score = 30;
        } else if (titleNorm.includes(kwTokens[0])) {
          score = 25;
        } else {
          score = 15;
        }
      }
    }

    if (score > 0) {
      results.push({ row: c, score, title });
    }
  }

  // Collapse re-submission families. When a proposer re-creates a candidate the
  // client appends a `-N` suffix; same proposer + base slug = the same proposal.
  // Without this the original out-scores its own resubmission (exact-slug 100 vs
  // suffixed-substring 80). `results` is newest-first, so the first seen wins.
  const families = new Map<string, Scored>();
  for (const r of results) {
    const baseSlug = (r.row.slug ?? '').toString().toLowerCase().replace(/-\d+$/, '');
    const familyKey = `${(r.row.proposer ?? '').toString().toLowerCase()}::${baseSlug}`;
    const existing = families.get(familyKey);
    if (!existing) {
      families.set(familyKey, r);
    } else if (r.score > existing.score) {
      existing.score = r.score;
    }
  }

  // Score desc; ties stay newest-first (stable sort over a newest-first list).
  const ranked = Array.from(families.values()).sort((a, b) => b.score - a.score);

  // Recency-as-intent. For action commands (sponsor/promote) the user means the
  // candidate they most recently created/sponsored, not whichever historical row
  // scores highest. A re-submitted candidate gets a fresh slug suffix that is
  // often non-numeric (e.g. `…-mog6ls68`), so it doesn't collapse into the
  // original's family and the original's exact-slug 100 out-ranks the
  // resubmission's substring 80 — promoting/sponsoring the stale row. When
  // `preferRecent` is set, re-order the strong (slug/title) matches newest-first
  // so the latest candidate wins. Weak description/token-only matches keep score
  // order as a relevance backstop, so a vague keyword can't drag in an unrelated
  // recent candidate over a clear slug hit.
  if (preferRecent) {
    const blk = (r: Scored) => Number(r.row.createdAtBlock ?? 0n);
    const strong = ranked
      .filter(r => r.score >= STRONG_MATCH_SCORE)
      .sort((a, b) => blk(b) - blk(a));
    if (strong.length > 0) {
      const weak = ranked.filter(r => r.score < STRONG_MATCH_SCORE);
      return [...strong, ...weak].slice(0, limit).map(r => r.row);
    }
  }

  return ranked.slice(0, limit).map(r => r.row);
}

// Extract title from candidate description
export function candidateTitle(c: CandidateRow): string {
  return (
    (c.description ?? '')
      .toString()
      .split('\n')[0]
      ?.replace(/^#+\s*/, '')
      .trim() || 'Untitled'
  );
}

export async function parseCommand(
  msg: string,
  wallet: string | undefined,
  opts: { skipFunctionSkill?: boolean } = {},
): Promise<ParsedCommand> {
  const m = msg.trim().toLowerCase();
  const raw = msg.trim(); // preserve case for descriptions

  // ─── Help ──────────────────────────────────────────────────
  if (m === 'help' || m === '?') {
    return { handled: true, response: HELP_TEXT };
  }

  // ─── Status ────────────────────────────────────────────────
  if (m === 'status') {
    const state = getWatcherState();
    const stats = reservationStore.stats();
    const walletRes = wallet ? reservationStore.getByWallet(wallet) : [];
    const daoLines = (['v1', 'v2'] as const)
      .map(dao => {
        const d = state.daos[dao];
        return `- ${dao.toUpperCase()}: next noun #${d.nextNounId} — ${d.lastPredictedTraits ? JSON.stringify(d.lastPredictedTraits) : 'computing...'}
  standing targets: ${d.standingTraits.length > 0 ? d.standingTraits.join(', ') : 'none'} | active reservations: ${d.activeReservations}`;
      })
      .join('\n');
    return {
      handled: true,
      response: `Agent NounIRL status (watching BOTH DAOs):
- Running: ${state.running}
- Transport: ${state.transportMode}
- Last block: ${state.lastBlockNumber}
${daoLines}
- Total settlements: ${stats.totalSettlements}
- Your reservations: ${walletRes.length > 0 ? walletRes.map(r => `${r.id.slice(0, 8)} [${r.dao}] (${r.traits.join(', ')}) [${r.status}]`).join('; ') : 'none'} ⌐◨-◨`,
    };
  }

  // ─── Check Block ───────────────────────────────────────────
  if (m === 'check block' || m === 'check') {
    try {
      const blockResult = await checkNow();
      return { handled: true, response: `Block check: ${JSON.stringify(blockResult, null, 2)}` };
    } catch (err) {
      return {
        handled: true,
        response: `Block check failed: ${err instanceof Error ? err.message : 'unknown'}`,
      };
    }
  }

  // ─── List Traits ───────────────────────────────────────────
  const traitsMatch = m.match(
    /^(?:list|show)\s+traits?\s+(background|body|accessory|head|glasses)$/,
  );
  if (traitsMatch) {
    const category = traitsMatch[1];
    const traits = getAllTraitNames(category);
    return {
      handled: true,
      response: `${category} traits (${traits.length}):\n${traits.join(', ')}`,
    };
  }

  // ─── My Reservations ──────────────────────────────────────
  if (m === 'my reservations' || m === 'reservations') {
    if (!wallet) return { handled: true, response: 'Connect your wallet to view reservations.' };
    const res = reservationStore.getByWallet(wallet);
    if (res.length === 0) return { handled: true, response: 'No active reservations.' };
    return {
      handled: true,
      response: res
        .map(r => `[${r.id.slice(0, 8)}] [${r.dao}] ${r.traits.join(', ')} — ${r.status}`)
        .join('\n'),
    };
  }

  // ─── Trading Status (pooter.world bot) ───────────────────
  if (
    m === 'trading status' ||
    m === 'trading' ||
    m === 'positions' ||
    m === 'open positions' ||
    m === 'trading positions'
  ) {
    try {
      const [posData, perfData] = await Promise.all([
        getTradingPositions(true),
        getTradingPerformance(),
      ]);
      const positions = [
        ...(posData.positions || []),
        ...(posData.parallel || []).flatMap(r => r.positions),
      ];
      const lines = [
        `Trading bot status (pooter.world):`,
        `- Open positions: ${positions.length}`,
        `- Account value: ${perfData.accountValueUsd != null ? `$${perfData.accountValueUsd.toFixed(2)}` : 'N/A'}`,
        `- Win rate: ${perfData.metrics?.winRate?.toFixed(1) ?? '?'}%`,
        `- Realized P&L: $${perfData.metrics?.realizedPnlUsd?.toFixed(2) ?? '0'}`,
        `- Total trades: ${perfData.metrics?.totalTrades ?? 0}`,
        `- Watching: ${perfData.watchMarkets?.join(', ') || 'N/A'}`,
      ];
      if (positions.length > 0) {
        lines.push('', 'Open:');
        for (const p of positions.slice(0, 5)) {
          lines.push(
            `  ${p.direction?.toUpperCase() || '?'} ${p.symbol || p.venue || '?'} @ $${p.entryPriceUsd?.toFixed(4) || '?'} (moral: ${p.moralScore ?? '?'})`,
          );
        }
      }
      lines.push('', 'The moral gate is functioning as designed. ⌐◨-◨');
      return { handled: true, response: lines.join('\n') };
    } catch (err) {
      return {
        handled: true,
        response: `Trading bot unavailable: ${err instanceof Error ? err.message : 'connection failed'}`,
      };
    }
  }

  // ─── Market Signals ─────────────────────────────────────────
  if (m === 'market signals' || m === 'signals') {
    try {
      const data = await getTradingSignals();
      const signals = data.signals || [];
      if (signals.length === 0) {
        return { handled: true, response: 'No active market signals from the trading bot.' };
      }
      const lines = ['Market signals (pooter.world):'];
      for (const s of signals) {
        let arrow = '→';
        if (s.direction === 'bullish') {
          arrow = '↑';
        } else if (s.direction === 'bearish') {
          arrow = '↓';
        }
        lines.push(
          `  ${arrow} ${s.symbol}: ${s.direction} (confidence: ${(s.confidence * 100).toFixed(0)}%)`,
        );
      }
      return { handled: true, response: lines.join('\n') };
    } catch (err) {
      return {
        handled: true,
        response: `Signals unavailable: ${err instanceof Error ? err.message : 'connection failed'}`,
      };
    }
  }

  // ─── Lil Nouns Vote ───────────────────────────────────────
  // Matches: "vote for lil prop 375", "vote against lil nouns proposal 375 because xyz"
  const lilVoteMatch = m.match(
    /^vote\s+(for|against|abstain)\s+lil(?:\s*nouns?)?\s+(?:prop(?:osal)?\s*)?#?(\d+)(?:\s+(?:because\s+|reason:?\s*)?(.+))?$/,
  );
  if (lilVoteMatch) {
    if (!wallet) return { handled: true, response: 'Connect your wallet to vote.' };
    let support = 2;
    if (lilVoteMatch[1] === 'for') support = 1;
    else if (lilVoteMatch[1] === 'against') support = 0;
    const proposalId = parseInt(lilVoteMatch[2]);
    const reason = lilVoteMatch[3]?.trim();
    // Lil Nouns proposals aren't in Ponder — let the on-chain governor reject invalid IDs
    const action = {
      type: 'VOTE',
      proposalId,
      support,
      reason,
      title: `Lil Proposal #${proposalId}`,
      dao: 'lil-nouns',
    };
    return {
      handled: true,
      response: `Vote prepared: ${['AGAINST', 'FOR', 'ABSTAIN'][support]} on Lil Prop #${proposalId}. Confirm in your wallet.`,
      action,
    };
  }

  // ─── Vote on Proposal ─────────────────────────────────────
  const voteMatch = m.match(
    /^vote\s+(for|against|abstain)\s+(?:prop(?:osal)?\s*)?#?(\d+)(?:\s+(?:because\s+|reason:?\s*)?(.+))?$/,
  );
  if (voteMatch) {
    if (!wallet) return { handled: true, response: 'Connect your wallet to vote.' };
    let support = 2; // ABSTAIN
    if (voteMatch[1] === 'for') support = 1;
    else if (voteMatch[1] === 'against') support = 0;
    const proposalId = parseInt(voteMatch[2]);
    const reason = voteMatch[3]?.trim();
    try {
      const rows = await db
        .select()
        .from(schema.proposal)
        .where(eq(schema.proposal.id, String(proposalId)))
        .limit(1);
      if (rows.length === 0)
        return { handled: true, response: `Proposal #${proposalId} not found.` };
      const p = rows[0];
      const isFinal =
        p.status === 'CANCELLED' ||
        p.status === 'VETOED' ||
        p.status === 'EXECUTED' ||
        p.status === 'QUEUED';
      if (isFinal)
        return {
          handled: true,
          response: `Proposal #${proposalId} is "${p.status}" — voting is closed.`,
        };
      if (p.startBlock && p.endBlock) {
        const currentBlock = await getCurrentBlock();
        const objEnd = p.objectionPeriodEndBlock ? BigInt(p.objectionPeriodEndBlock) : null;
        const effectiveEnd = objEnd && objEnd > BigInt(p.endBlock) ? objEnd : BigInt(p.endBlock);
        if (currentBlock < BigInt(p.startBlock))
          return { handled: true, response: `Proposal #${proposalId} voting hasn't started yet.` };
        if (currentBlock > effectiveEnd)
          return { handled: true, response: `Proposal #${proposalId} voting has ended.` };
      }
      const descText = (p.description ?? '').toString();
      const title = proposalTitle(descText);
      const action = { type: 'VOTE', proposalId, support, reason, title };
      return {
        handled: true,
        response: `Vote prepared: ${['AGAINST', 'FOR', 'ABSTAIN'][support]} on Prop #${proposalId} "${title}". Confirm in your wallet.`,
        action,
      };
    } catch (err) {
      return {
        handled: true,
        response: `Vote failed: ${err instanceof Error ? err.message : 'unknown'}`,
      };
    }
  }

  // ─── Feedback on Proposal ─────────────────────────────────
  // Matches: "feedback for/against prop X [reason]", "leave feedback on prop X [reason]", "leave feedback 'reason' on prop X"
  const feedbackPropMatch = m.match(
    /^feedback\s+(for|against)\s+(?:prop(?:osal)?\s*)?#?(\d+)(?:\s+(.+))?$/,
  );
  const leaveFeedbackMatch =
    !feedbackPropMatch &&
    raw.match(/^leave\s+feedback\s+(?:on\s+)?(?:prop(?:osal)?\s*)?#?(\d+)\s+(.+)$/i);
  const leaveFeedbackAlt =
    !feedbackPropMatch &&
    !leaveFeedbackMatch &&
    raw.match(/^leave\s+feedback\s+["']?(.+?)["']?\s+on\s+(?:prop(?:osal)?\s*)?#?(\d+)$/i);
  if (feedbackPropMatch || leaveFeedbackMatch || leaveFeedbackAlt) {
    if (!wallet) return { handled: true, response: 'Connect your wallet to give feedback.' };
    let support = 1; // default to FOR for "leave feedback" (positive sentiment)
    let proposalId: number;
    let reason: string | undefined;
    if (feedbackPropMatch) {
      support = feedbackPropMatch[1] === 'for' ? 1 : 0;
      proposalId = parseInt(feedbackPropMatch[2]);
      reason = feedbackPropMatch[3]?.trim();
    } else if (leaveFeedbackMatch) {
      proposalId = parseInt(leaveFeedbackMatch[1]);
      reason = leaveFeedbackMatch[2]?.trim().replace(/^["']|["']$/g, '');
    } else {
      reason = leaveFeedbackAlt![1]?.trim();
      proposalId = parseInt(leaveFeedbackAlt![2]);
    }
    try {
      const rows = await db
        .select()
        .from(schema.proposal)
        .where(eq(schema.proposal.id, String(proposalId)))
        .limit(1);
      if (rows.length === 0)
        return { handled: true, response: `Proposal #${proposalId} not found.` };
      const descText = (rows[0].description ?? '').toString();
      const title = proposalTitle(descText);
      const action = { type: 'PROPOSAL_FEEDBACK', proposalId, support, reason, title };
      return {
        handled: true,
        response: `Feedback prepared: ${support ? 'FOR' : 'AGAINST'} on Prop #${proposalId} "${title}"${reason ? ` — "${reason}"` : ''}. Confirm in your wallet.`,
        action,
      };
    } catch (err) {
      return {
        handled: true,
        response: `Feedback failed: ${err instanceof Error ? err.message : 'unknown'}`,
      };
    }
  }

  // ─── Show Proposal ────────────────────────────────────────
  const showPropMatch = m.match(/^(?:show|lookup|info|prop(?:osal)?)\s*#?(\d+)$/);
  if (showPropMatch) {
    const proposalId = parseInt(showPropMatch[1]);
    try {
      const rows = await db
        .select()
        .from(schema.proposal)
        .where(eq(schema.proposal.id, String(proposalId)))
        .limit(1);
      if (rows.length === 0)
        return { handled: true, response: `Proposal #${proposalId} not found.` };
      const p = rows[0];
      const descText = (p.description ?? '').toString();
      const title = proposalTitle(descText);
      const currentBlock = await getCurrentBlock();
      const voting = formatBlocksRemaining(currentBlock, p.endBlock);
      return {
        handled: true,
        response: `Prop #${proposalId}: "${title}"
- Status: ${p.status}
- Proposer: ${p.proposer}
- For: ${p.forVotes} / Against: ${p.againstVotes} / Abstain: ${p.abstainVotes}
- Quorum: ${p.quorumVotes}
- Voting: ${voting.timeLeftFormatted}
- ${descText.slice(0, 300)}${descText.length > 300 ? '...' : ''}`,
      };
    } catch (err) {
      return {
        handled: true,
        response: `Lookup failed: ${err instanceof Error ? err.message : 'unknown'}`,
      };
    }
  }

  // ─── Active Proposals ─────────────────────────────────────
  if (m.match(/^(?:active|list|show|what)\s*proposals?$/)) {
    try {
      const currentBlock = await getCurrentBlock();
      const allProps = await db
        .select()
        .from(schema.proposal)
        .orderBy(desc(schema.proposal.createdAtBlock))
        .limit(20);
      const active = allProps.filter(p => {
        if (p.status === 'CANCELLED' || p.status === 'VETOED' || p.status === 'EXECUTED')
          return false;
        if (p.endBlock && currentBlock > BigInt(p.endBlock)) return false;
        return true;
      });
      if (active.length === 0) return { handled: true, response: 'No active proposals right now.' };
      const lines = active.map(p => {
        const descText = (p.description ?? '').toString();
        const title = proposalTitle(descText);
        const voting = formatBlocksRemaining(currentBlock, p.endBlock);
        return `#${p.id}: "${title}" [${p.status}] — ${voting.timeLeftFormatted}`;
      });
      return { handled: true, response: `Active proposals:\n${lines.join('\n')}` };
    } catch (err) {
      return {
        handled: true,
        response: `Lookup failed: ${err instanceof Error ? err.message : 'unknown'}`,
      };
    }
  }

  // ─── Execute Proposal ─────────────────────────────────────
  const execPropMatch = m.match(/^execute\s+(?:prop(?:osal)?\s*)?#?(\d+)$/);
  if (execPropMatch) {
    if (!wallet) return { handled: true, response: 'Connect your wallet to execute.' };
    const proposalId = parseInt(execPropMatch[1]);
    const action = { type: 'EXECUTE_PROPOSAL', proposalId };
    return {
      handled: true,
      response: `Execute prepared for Prop #${proposalId}. Confirm in your wallet.`,
      action,
    };
  }

  // ─── Bid ──────────────────────────────────────────────────
  // Accepts: "bid 0.5 eth", "bid 0.5", "bid 0.5 eth on noun 123", "bid 0.5 on noun 123"
  const bidMatch = m.match(/^bid\s+([\d.]+)\s*(?:eth)?\s*(?:on\s+(?:noun\s+)?(\d+))?$/);
  if (bidMatch) {
    if (!wallet) return { handled: true, response: 'Connect your wallet to bid.' };
    const bidAmount = bidMatch[1];
    const state = getWatcherState();
    const currentNounId = state.nextNounId ? state.nextNounId - 1 : undefined;
    if (!currentNounId)
      return { handled: true, response: 'Could not determine current auction noun ID.' };
    const specifiedNounId = bidMatch[2] ? parseInt(bidMatch[2]) : undefined;
    if (specifiedNounId && specifiedNounId !== currentNounId) {
      return {
        handled: true,
        response: `Noun ${specifiedNounId} is not the current auction. The active auction is Noun ${currentNounId}.`,
      };
    }
    const nounId = currentNounId;
    const action = { type: 'BID', nounId, bidAmountEth: bidAmount };
    return {
      handled: true,
      response: `Bid prepared: ${bidAmount} ETH on Noun ${nounId}. Confirm in your wallet. Client ID 37 included.`,
      action,
    };
  }

  // ─── Create Candidate / Proposal ─────────────────────────
  // "create candidate: title - description", "propose: title - description", "create proposal: title - description"
  const candidateMatch = raw.match(
    /^(?:create\s+(?:candidate|proposal)|propose):\s*(.+?)\s*-\s*(.+)$/i,
  );
  if (candidateMatch) {
    if (!wallet) return { handled: true, response: 'Connect your wallet to create a candidate.' };
    const title = candidateMatch[1].trim();
    const description = candidateMatch[2].trim();
    const slug = title
      .toLowerCase()
      .replace(/[^\da-z]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 80);

    // Nouns candidates MUST carry >=1 transaction (the contract reverts with
    // MustProvideActions otherwise). Try to encode "send X <token> to Y" from
    // the title+description; refuse with guidance if we can't, instead of
    // letting the user sign a tx that's guaranteed to revert in their wallet.
    const parsed = await parseCandidateTransfer(`${title} ${description}`);
    if (parsed === 'unresolved') {
      return {
        handled: true,
        response:
          'I see a transfer but need a usable recipient — give me a 0x address or a .eth name, e.g. "create candidate: Fund X - send 10 ETH to 0xABC…".',
      };
    }
    if (parsed === null) {
      return {
        handled: true,
        response:
          'Nouns candidates need at least one transaction — an empty one reverts on-chain. Tell me what it should do, e.g. "create candidate: Fund the movie - send 10 ETH to nouns.eth" or "… - send 5000 USDC to 0x…".',
      };
    }
    const expanded = expandProposalTransactions([parsed]);
    if (!expanded.ok) {
      return { handled: true, response: `Couldn't encode that transaction: ${expanded.error}` };
    }
    const txs = expanded.txs;

    // Shape must match what the webapp modal (GovernanceActionConfirm) and
    // signer (useGovernanceAction) handle: type 'CREATE_CANDIDATE' + full arrays.
    const action = {
      type: 'CREATE_CANDIDATE',
      slug,
      title,
      description: `# ${title}\n\n${description}`,
      targets: txs.map(t => t.target),
      values: txs.map(t => t.value),
      signatures: txs.map(t => t.signature),
      calldatas: txs.map(t => t.calldata),
    };
    return {
      handled: true,
      response: `Candidate prepared: "${title}" (slug: ${slug}) — ${txs.length} transaction encoded. A 0.01 ETH fee applies unless your wallet has delegated voting power. Confirm and sign in your wallet.`,
      action,
    };
  }

  // ─── Sponsor Candidate ────────────────────────────────────
  const sponsorMatch = m.match(/^sponsor\s+(?:candidate\s+)?(.+)$/);
  if (sponsorMatch) {
    if (!wallet) return { handled: true, response: 'Connect your wallet to sponsor.' };
    const keyword = sponsorMatch[1].trim();
    try {
      // preferRecent: sponsor the latest matching candidate, not a stale
      // re-submission that happens to score higher on an exact-slug match.
      const matches = await findCandidates(keyword, { limit: 1, preferRecent: true });
      if (matches.length === 0)
        return { handled: true, response: `No candidate found matching "${keyword}".` };
      const c = matches[0];
      const title = candidateTitle(c);
      const descText = (c.description ?? '').toString();
      // encodedProp must match the candidate's on-chain hash; frontend uses it
      // to reconstruct targets/values/sigs/calldatas/description for EIP-712.
      const action = {
        type: 'SPONSOR',
        proposer: c.proposer,
        slug: c.slug,
        title,
        encodedProp: c.targets
          ? JSON.stringify({
              targets: JSON.parse((c.targets as string) || '[]'),
              values: JSON.parse((c.values as string) || '[]'),
              signatures: JSON.parse((c.signatures as string) || '[]'),
              calldatas: JSON.parse((c.calldatas as string) || '[]'),
              description: descText,
            })
          : '{}',
      };
      return {
        handled: true,
        response: `Sponsor prepared for "${title}" (${c?.slug}) by ${c.proposer?.slice(0, 8)}... Confirm in your wallet.`,
        action,
      };
    } catch (err) {
      return {
        handled: true,
        response: `Sponsor failed: ${err instanceof Error ? err.message : 'unknown'}`,
      };
    }
  }

  // ─── Promote Candidate ────────────────────────────────────
  const promoteMatch = m.match(/^promote\s+(?:candidate\s+)?(.+)$/);
  if (promoteMatch) {
    if (!wallet) return { handled: true, response: 'Connect your wallet to promote.' };
    const keyword = promoteMatch[1].trim();
    try {
      // preferRecent: promote the latest matching candidate, not a stale
      // re-submission that happens to score higher on an exact-slug match.
      const matches = await findCandidates(keyword, { limit: 1, preferRecent: true });
      if (matches.length === 0)
        return { handled: true, response: `No candidate found matching "${keyword}".` };
      const c = matches[0];
      const title = candidateTitle(c);
      const descText = (c.description ?? '').toString();

      // Fetch valid sponsor signatures.
      // candidateSignature.candidateId is the candidate's primary key
      // (`${proposer}-${slug}`) — there's no `candidateSlug` column. The old
      // code referenced a non-existent property which Drizzle stringified
      // into broken SQL ("syntax error at or near '='" from postgres).
      const sigs = await db
        .select()
        .from(schema.candidateSignature)
        .where(eq(schema.candidateSignature.candidateId, c.id as string))
        .limit(100);
      const nowSec = Math.floor(Date.now() / 1000);
      const validSigs = sigs.filter(s => !s.canceled && Number(s.expirationTimestamp) > nowSec);

      const action = {
        type: 'PROMOTE',
        proposer: c.proposer as string,
        slug: c.slug,
        title,
        targets: JSON.parse((c.targets as string) || '[]'),
        values: JSON.parse((c.values as string) || '[]'),
        signatures: JSON.parse((c.signatures as string) || '[]'),
        calldatas: JSON.parse((c.calldatas as string) || '[]'),
        description: descText,
        sponsorSignatures: validSigs.map(s => ({
          sig: s.sig,
          signer: s.signer,
          expirationTimestamp: s.expirationTimestamp?.toString(),
        })),
      };
      return {
        handled: true,
        response: `Promote prepared for "${title}" (${c?.slug}) with ${validSigs.length} valid sponsor signature${validSigs.length !== 1 ? 's' : ''}. This will create a real proposal with Client ID 37. Confirm in your wallet.`,
        action,
      };
    } catch (err) {
      return {
        handled: true,
        response: `Promote failed: ${err instanceof Error ? err.message : 'unknown'}`,
      };
    }
  }

  // ─── Feedback on Candidate ────────────────────────────────
  const feedbackCandMatch = m.match(/^feedback\s+(for|against)\s+candidate\s+(.+)$/);
  if (feedbackCandMatch) {
    if (!wallet) return { handled: true, response: 'Connect your wallet to give feedback.' };
    const support = feedbackCandMatch[1] === 'for' ? 1 : 0;
    const keyword = feedbackCandMatch[2].trim();
    try {
      const matches = await findCandidates(keyword, { limit: 1 });
      if (matches.length === 0)
        return { handled: true, response: `No candidate found matching "${keyword}".` };
      const c = matches[0];
      const title = candidateTitle(c);
      const action = { type: 'CANDIDATE_FEEDBACK', proposer: c.proposer, slug: c.slug, support };
      return {
        handled: true,
        response: `Feedback prepared: ${support ? 'FOR' : 'AGAINST'} on candidate "${title}". Confirm in your wallet.`,
        action,
      };
    } catch (err) {
      return {
        handled: true,
        response: `Feedback failed: ${err instanceof Error ? err.message : 'unknown'}`,
      };
    }
  }

  // ─── Show Candidate ───────────────────────────────────────
  const showCandMatch = m.match(/^(?:show|lookup|info)\s+candidate\s+(.+)$/);
  if (showCandMatch) {
    const keyword = showCandMatch[1].trim();
    try {
      const matches = await findCandidates(keyword, { limit: 1, includeCanceled: true });
      if (matches.length === 0)
        return { handled: true, response: `No candidate found matching "${keyword}".` };
      const c = matches[0];
      const title = candidateTitle(c);
      const descText = (c.description ?? '').toString();
      return {
        handled: true,
        response: `Candidate: "${title}"
- Proposer: ${c.proposer}
- Slug: ${c.slug}
- Canceled: ${c.canceled ? 'yes' : 'no'}
- ${descText.slice(0, 300)}${descText.length > 300 ? '...' : ''}`,
      };
    } catch (err) {
      return {
        handled: true,
        response: `Lookup failed: ${err instanceof Error ? err.message : 'unknown'}`,
      };
    }
  }

  // ─── Vote on Grant ────────────────────────────────────────
  const grantVoteMatch = m.match(/^vote\s+(for|against)\s+grant\s*#?(\d+)(?:\s+(.+))?$/);
  if (grantVoteMatch) {
    if (!wallet) return { handled: true, response: 'Connect your wallet to vote on grants.' };
    const support = grantVoteMatch[1] === 'for' ? 1 : 0;
    const grantId = parseInt(grantVoteMatch[2]);
    const reason = grantVoteMatch[3]?.trim();
    const action = { type: 'GRANT_VOTE', grantId, support, reason };
    return {
      handled: true,
      response: `Grant vote prepared: ${support ? 'FOR' : 'AGAINST'} on Grant #${grantId}. Confirm in your wallet.`,
      action,
    };
  }

  // ─── Show Grant ───────────────────────────────────────────
  const showGrantMatch = m.match(/^(?:show|lookup|info)\s+grant\s*#?(\d+)$/);
  if (showGrantMatch) {
    const grantId = parseInt(showGrantMatch[1]);
    try {
      const rows = await db
        .select()
        .from(schema.grant)
        .where(eq(schema.grant.id, String(grantId)))
        .limit(1);
      if (rows.length === 0) return { handled: true, response: `Grant #${grantId} not found.` };
      const g = rows[0];
      const descText = (g.description ?? '').toString();
      const title = proposalTitle(descText);
      return {
        handled: true,
        response: `Grant #${grantId}: "${title}"
- Status: ${g.status}
- Proposer: ${g.proposer}
- For: ${g.forVotes} / Against: ${g.againstVotes}
- ${descText.slice(0, 300)}${descText.length > 300 ? '...' : ''}`,
      };
    } catch (err) {
      return {
        handled: true,
        response: `Lookup failed: ${err instanceof Error ? err.message : 'unknown'}`,
      };
    }
  }

  // ─── Active Grants ────────────────────────────────────────
  if (m.match(/^(?:active|list|show|what)\s*grants?$/)) {
    try {
      const allGrants = await db
        .select()
        .from(schema.grant)
        .orderBy(desc(schema.grant.createdAtBlock))
        .limit(20);
      const active = allGrants.filter(g => g.status === 'ACTIVE' || g.status === 'QUEUED');
      if (active.length === 0) return { handled: true, response: 'No active grants right now.' };
      const lines = active.map(g => {
        const descText = (g.description ?? '').toString();
        const title = proposalTitle(descText);
        return `#${g.id}: "${title}" [${g.status}]`;
      });
      return { handled: true, response: `Active grants:\n${lines.join('\n')}` };
    } catch (err) {
      return {
        handled: true,
        response: `Lookup failed: ${err instanceof Error ? err.message : 'unknown'}`,
      };
    }
  }

  // ─── Create Grant ─────────────────────────────────────────
  const grantMatch = raw.match(/^create\s+grant:\s*(.+?)\s*-\s*(.+)$/i);
  if (grantMatch) {
    if (!wallet) return { handled: true, response: 'Connect your wallet to create a grant.' };
    const title = grantMatch[1].trim();
    const description = grantMatch[2].trim();
    const action = { type: 'GRANT_PROPOSAL', title, description };
    return {
      handled: true,
      response: `Grant prepared: "${title}". Confirm in your wallet.`,
      action,
    };
  }

  // ─── Execute Grant ────────────────────────────────────────
  const execGrantMatch = m.match(/^execute\s+grant\s*#?(\d+)$/);
  if (execGrantMatch) {
    if (!wallet) return { handled: true, response: 'Connect your wallet to execute.' };
    const grantId = parseInt(execGrantMatch[1]);
    const action = { type: 'EXECUTE_GRANT', grantId };
    return {
      handled: true,
      response: `Execute prepared for Grant #${grantId}. Confirm in your wallet.`,
      action,
    };
  }

  // ─── "function" skill — loose NL → canonical command ──────
  // Runs after the strict regexes miss. Translates natural phrasings like
  // "bid 0.01eth on noun 1901", "i want to vote yes on prop 567",
  // "sponsor the public-goods candidate" into canonical commands that the
  // strict regex paths above already handle. Re-invokes parseCommand on the
  // normalised form so there is one source of truth for action preparation.
  if (!opts.skipFunctionSkill) {
    const detected = detectFunction(raw);
    if (detected && detected.canonical !== m && detected.canonical !== raw) {
      const recursed = await parseCommand(detected.canonical, wallet, {
        skipFunctionSkill: true,
      });
      if (recursed.handled) {
        return recursed;
      }
    }
  }

  // ─── Not matched ──────────────────────────────────────────
  return { handled: false };
}
