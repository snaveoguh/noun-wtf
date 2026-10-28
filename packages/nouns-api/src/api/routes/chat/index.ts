/* eslint-disable unicorn/no-nested-ternary */
import type { Hono } from 'hono';

import { desc, eq } from 'drizzle-orm';
import { db } from 'ponder:api';
import schema from 'ponder:schema';

import { MIN_NOUNS_FOR_DEPLOY } from '../../../agent/constants.js';
import { proposalTitle } from '../../../agent/governanceContext.js';
import ImageDataV1ForTraits from '../../../agent/image-data-v1.json';
import ImageDataV2ForTraits from '../../../agent/image-data-v2.json';
import {
  applyAndDeploy,
  buildFunctionSkillPromptSnippet,
  buildGovernanceContext,
  buildLiveAuctionContext,
  buildMemoryContext,
  buildPeopleContext,
  buildProposalsAndGrantsContext,
  canDeploy,
  checkNow,
  generatePatch,
  getAgentBalance,
  getAllTraitNames,
  getGasBudget,
  getWatcherState,
  learnFromUrl,
  parseTraitDescription,
  recall,
  remember,
  reservationStore,
  runSelfLearn,
  verifyTip,
} from '../../../agent/index.js';
import { getOnchainArt, type OnchainArt } from '../../../agent/onchainArt.js';
import {
  getPerformance as getTradingPerformance,
  getPositions as getTradingPositions,
  getSignals as getTradingSignals,
} from '../../../agent/tradingClient.js';
import {
  applyDerivation,
  assertColorsInPalette,
  buildTraitProposal,
  findTrait,
  IMAGE_KEY,
  parseRle,
  pngToRle,
  serializeRle,
  type TraitCategory,
  type TraitDao,
} from '../../../agent/traitProposal.js';
import { getDreamTraitImage } from '../../dreams.js';
import { formatBlocksRemaining, getCurrentBlock, getNounBalance } from '../../lib/chain.js';
import { resolveEnsBatch } from '../../lib/ens.js';
import { computeDerivedStatus } from '../../lib/proposalStatus.js';
import { getSettlerMaps } from '../../settlerMaps.js';

import { candidateTitle, findCandidates, parseCommand } from './commands.js';
import {
  AGENT_HUB_URL,
  hubChat,
  type HubChatRequest,
  isUpstreamAiFailure,
  NOUNIRL_PIPE_UNLOCK_MESSAGE,
  patchXmlToolCalls,
} from './hub.js';
import { NOUNIRL_SYSTEM_PROMPT, NOUNS_SYSTEM_PROMPT } from './prompts.js';
import { expandProposalTransactions, type ProposalTxInput } from './proposalTx.js';
import { checkRateLimit } from './rateLimit.js';
import { buildNounIrlTools, buildRemovedGovernanceTools } from './tools.js';
import { fetchWorldStats, WORLD_QUESTION, worldBrief } from './world.js';

export function registerChatRoutes(app: Hono) {
  // ============================================================
  // Chat endpoint
  // ============================================================

  app.post('/api/chat', async c => {
    let agentMode: string | undefined;
    try {
      const body = await c.req.json();
      const { message, wallet, history, agent_mode, view_context } = body as {
        message: string;
        wallet?: string;
        history?: Array<{ role: string; content: string }>;
        agent_mode?: string;
        view_context?: { dao?: string; nounId?: number | string | null };
      };
      agentMode = agent_mode;

      if (!message || typeof message !== 'string') {
        return c.json({ error: 'Message is required' }, 400);
      }

      if (message.length > 2000) {
        return c.json({ error: 'Message too long (max 2000 chars)' }, 400);
      }

      // Require wallet connection — no anonymous chat (prevents spam, enables per-wallet rate limiting)
      if (!wallet || typeof wallet !== 'string' || !/^0x[\dA-Fa-f]{40}$/.test(wallet)) {
        return c.json(
          { error: 'Connect your wallet to use chat. ⌐◨-◨', requiresWallet: true },
          401,
        );
      }

      // ─── Try free command parser first (no API call) ─────────
      const parsed = await parseCommand(message, wallet);
      if (parsed.handled) {
        const payload: { response: string; action?: Record<string, unknown> } = {
          response: parsed.response!,
        };
        if (parsed.action) payload.action = parsed.action;
        return c.json(payload);
      }

      // ─── Graceful fallback when agent-hub unavailable ──────────
      if (!AGENT_HUB_URL) {
        return c.json({
          response:
            "I'm in command mode right now. Try 'vote for prop 567', 'bid 0.5 eth', 'active proposals', or type 'help' for the full list of commands. Freeform chat is temporarily offline. ⌐◨-◨",
        });
      }

      // Rate limit by wallet or IP
      const rateLimitKey = wallet || c.req.header('x-forwarded-for') || 'anonymous';
      const rateCheck = checkRateLimit(rateLimitKey);
      if (!rateCheck.ok) {
        if (rateCheck.daily) {
          return c.json(
            {
              error:
                "you've hit the daily limit. talk to pipe — they're better at this anyway. find them on farcaster @pipe or warpcast.com/pipe",
              rateLimited: true,
              daily: true,
            },
            429,
          );
        }
        return c.json(
          {
            error:
              'slow down — max 10 messages per minute. take a breath, the chain will still be there.',
            rateLimited: true,
          },
          429,
        );
      }

      // Choose system prompt based on agent mode
      const isNounIrl = agent_mode === 'nounirl';
      const staticPrompt = isNounIrl ? NOUNIRL_SYSTEM_PROMPT : NOUNS_SYSTEM_PROMPT;

      // Build dynamic context (changes per request — not cached)
      let dynamicContext = '';
      const gameBrief =
        typeof message === 'string' && WORLD_QUESTION.test(message) ? await worldBrief() : '';

      // Inject current view context (which DAO + noun the user is looking at).
      // This is the FIRST thing we inject so the model anchors to it before
      // reading any of the live governance / auction data below.
      if (view_context && typeof view_context === 'object') {
        const rawDao = typeof view_context.dao === 'string' ? view_context.dao.toLowerCase() : '';
        // Normalize lil-nouns aliases that the client may send.
        const dao: 'nouns' | 'nounv2' | 'lil-nouns' | null =
          rawDao === 'nounv2'
            ? 'nounv2'
            : rawDao === 'nouns'
              ? 'nouns'
              : rawDao === 'lil-nouns' || rawDao === 'lilnouns' || rawDao === 'lil'
                ? 'lil-nouns'
                : null;
        const rawNounId = view_context.nounId;
        const nounId =
          typeof rawNounId === 'number' && Number.isFinite(rawNounId)
            ? rawNounId
            : typeof rawNounId === 'string' && /^\d+$/.test(rawNounId)
              ? Number.parseInt(rawNounId, 10)
              : null;

        if (dao !== null || nounId !== null) {
          const daoLabel =
            dao === 'nouns'
              ? 'mainnet Nouns DAO (token IDs are mainnet Noun IDs)'
              : dao === 'nounv2'
                ? 'NounV2 fork DAO (token IDs are v2 IDs starting at 0 — NOT mainnet Nouns)'
                : dao === 'lil-nouns'
                  ? "Lil Nouns DAO (separate governor; pass dao='lil-nouns' to prepare_vote for proposals here)"
                  : 'unknown';
          dynamicContext += '\n\n## Current View';
          dynamicContext += `\n- dao: ${dao ?? 'unknown'} (${daoLabel})`;
          if (nounId !== null) {
            const nounLabel =
              dao === 'nounv2'
                ? `NounV2 #${nounId}`
                : dao === 'lil-nouns'
                  ? `Lil Noun #${nounId}`
                  : `Noun #${nounId}`;
            dynamicContext += `\n- viewing: ${nounLabel}`;
          }
          dynamicContext +=
            '\n- When the user says "this noun" or asks an unqualified question, assume they mean the noun above. If they ask about a different noun, confirm which DAO they mean.';
          if (dao === 'lil-nouns') {
            dynamicContext +=
              '\n- VOTING: when the user asks to vote here, default `dao` to "lil-nouns" in prepare_vote. Do not ask them which DAO unless they explicitly mention mainnet.';
          }
        }
      }

      // Inject persistent memory context (cross-session)
      const memoryContext = await buildMemoryContext(wallet || undefined);
      if (memoryContext) {
        dynamicContext += memoryContext;
      }

      // Inject governance context (proposals, votes, nouns, delegate power)
      if (wallet) {
        try {
          const govContext = await buildGovernanceContext(wallet);
          if (govContext) dynamicContext += govContext;
        } catch (err) {
          console.error('[Chat] Governance context error:', err);
        }
      }

      // Inject live auction data (current noun, bids, time remaining)
      try {
        const auctionContext = await buildLiveAuctionContext();
        if (auctionContext) dynamicContext += auctionContext;
      } catch (err) {
        console.error('[Chat] Auction context error:', err);
      }

      // Inject people directory context (top participants)
      try {
        const peopleContext = await buildPeopleContext(30);
        if (peopleContext) dynamicContext += peopleContext;
      } catch (err) {
        console.error('[Chat] People context error:', err);
      }

      // Inject global governance overview (all proposals + grants with derived statuses)
      try {
        const govOverview = await buildProposalsAndGrantsContext();
        if (govOverview) dynamicContext += govOverview;
      } catch (err) {
        console.error('[Chat] Governance overview error:', err);
      }

      // Inject live agent context for NounIRL mode
      if (isNounIrl) {
        const watcherState = getWatcherState();
        const stats = reservationStore.stats();
        const walletReservations = wallet ? reservationStore.getByWallet(wallet) : [];

        const daoContextLines = (['v1', 'v2'] as const)
          .map(dao => {
            const d = watcherState.daos[dao];
            return `- ${dao.toUpperCase()} (${dao === 'v1' ? 'main Nouns DAO' : 'NounV2'}): next noun #${d.nextNounId}, auction ends ${d.auctionEndTime ? new Date(d.auctionEndTime * 1000).toISOString() : 'unknown'}, predicted traits ${d.lastPredictedTraits ? JSON.stringify(d.lastPredictedTraits) : 'computing...'}, standing targets ${d.standingTraits.length > 0 ? JSON.stringify(d.standingTraits) : 'none'}, active reservations ${d.activeReservations}`;
          })
          .join('\n');

        dynamicContext += `\n\nLIVE AGENT STATE (ONE watcher covers BOTH DAOs simultaneously):
- Running: ${watcherState.running}
- Transport: ${watcherState.transportMode} ${watcherState.transportMode === 'websocket' ? '(instant block headers via WSS)' : '(HTTP polling fallback)'}
- Last block: ${watcherState.lastBlockNumber}
${daoContextLines}
- Standing targets are ALWAYS auto-hunted for free, no reservation needed.
- Total settlements: ${stats.totalSettlements}
- Caller wallet: ${wallet || 'not connected'}
- Caller's reservations: ${walletReservations.length > 0 ? JSON.stringify(walletReservations.map(r => ({ id: r.id.slice(0, 8), dao: r.dao, traits: r.traits, status: r.status }))) : 'none'}

TOOLS — YOU HAVE REAL ONCHAIN CAPABILITIES:
You have the following tools. USE THEM. Don't just describe what you would do — actually call the tool.

1. verify_tip(txHash, chainId) — Verify an ETH tip to nounirl.eth. Returns { valid, amountEth, from, chainName }.
2. create_reservation(wallet, txHash, chainId, traits[], dao?) — Create a trait reservation backed by a verified tip. dao='v1' (main Nouns, default) or 'v2' (NounV2) — the watcher covers both and only matches a reservation against its own DAO's mints. The block watcher auto-settles when traits match.
3. get_reservations(wallet?) — List reservations, optionally filtered by wallet.
4. cancel_reservation(reservationId) — Cancel a reservation.
5. check_block() — Force a block check. Returns predicted traits, block number, next noun ID, auction status, matching reservations.
6. list_traits(category) — List all valid trait names for background/body/accessory/head/glasses.
7. parse_traits(description) — Parse natural language into structured "category:value" traits.
8. get_settlements(limit?) — The agent's OWN settlements only (nounirl.eth, 2026 onward). Never treat this as the full history.
8b. get_noun_settler(nounId, dao?) — Who settled and who curated ANY noun back to Noun 0, from the noun.wtf indexer, with ENS + settle tx. ALWAYS call this for "who settled/curated #N" — never say records only go back to a certain noun, and never send people to Etherscan for it.
9. get_agent_balance() — ETH balance of nounirl.eth.
10. deploy_code(description, reason) — Ship a code change to the non-production "dev-noun" branch (Netlify branch-deploys it to a fixed preview URL). NOUN-GATED: caller must hold ≥ 4 Nouns. Rate limited: 1/hour. Only packages/nouns-webapp/src/. CANNOT delete files (rejected by safety filter). After a successful deploy the result includes a previewUrl — quote it back to the user and tell them to DM @pip on Warpcast for review before any push to main/prod. Production isolation is structural — you have no path to write to main. If user doesn't hold enough Nouns, tell them politely — this is governance-weighted access control.
11. remember_fact(key, content, scope) — Store a fact in persistent memory. scope="wallet" for user-specific, scope="global" for shared knowledge. USE THIS PROACTIVELY. When a user tells you their name, ENS, preferences, anything personal — remember it. When you learn something important — remember it globally.
12. recall_facts(scope, key?) — Look up remembered facts. You don't usually need to call this explicitly because your memory is auto-injected into context. But use it to check what you know.
13. learn_url(url) — Fetch a web page, extract key facts, and store them in your knowledge base. Use when someone shares a URL and wants you to learn from it. The knowledge persists and is available to both you and the homepage chat.
14. self_learn() — Trigger the self-learning pipeline. Reads ALL proposals, auctions, and delegate data from noun.wtf's own Ponder index and distills key facts into your knowledge base. Use when someone asks you to learn about Nouns governance, refresh your knowledge, or "eat your own dog food." Takes a few minutes to process all ~950 proposals.

MEMORY — YOU HAVE PERSISTENT MEMORY:
You remember things across sessions. Your memory is stored in Postgres. When you learn a user's name, ENS, favorite trait, or anything meaningful, call remember_fact to persist it. Next time they talk to you, their memories are auto-loaded into your context. This is how you build relationships.

RESERVATION FLOW:
When a user wants to reserve traits:
1. Help them specify traits using parse_traits or list_traits
2. Tell them to send ≥ 0.002 ETH (~$5) to nounirl.eth on any chain (Ethereum/Base/OP/Arb/Zora)
3. When they provide the tx hash: call verify_tip to confirm, then create_reservation
4. The block watcher handles the rest — it monitors every block and auto-settles when traits match

When a user asks "status": call check_block for live data. Don't rely on the injected state alone — it may be stale.
When a user asks about their reservations: call get_reservations with their wallet.

GOVERNANCE — the terminal handles votes, bids, sponsors, candidates, and grants via typed commands (e.g. "vote for 567", "bid 0.5 eth"). These are parsed automatically — you don't need tools for them. If someone asks about governance, explain that they can type commands directly. noun.wtf client ID is 37 (auto-included in votes, bids, promotes). Proposals start as candidates → collect sponsor signatures → get promoted.

LIL NOUNS VOTING — prepare_vote works for BOTH mainnet Nouns DAO and Lil Nouns DAO. When the user wants to vote on a Lil Nouns prop (mentions "lil"/"lilnoun(s)", or the Current View shows dao=lil-nouns, or the proposal exists in Lil Nouns DAO context fetched from /api/lil-proposals), set dao: 'lil-nouns' on the prepare_vote call. For mainnet Nouns leave it unset or pass dao: 'nouns'. If the user says "prop N" without specifying a DAO and the Current View doesn't disambiguate, ask one short clarifying question ("Lil Nouns or mainnet?") rather than guessing. Do NOT tell users to go to lilnouns.wtf to vote — they can vote from this terminal.
${buildFunctionSkillPromptSnippet()}
CRITICAL RULES:
- NEVER fabricate data. If you don't know, say so or use a tool to look it up.
- NEVER write function calls as text. Use the structured tool-calling mechanism. Text like "<function=...>" does NOTHING.
- Be honest about capabilities. You're an LLM with tool-calling, persistent memory, and access to noun.wtf's Ponder index.`;
      }

      // Build messages array from history
      const messages: HubChatRequest['messages'] = [];
      if (history && Array.isArray(history)) {
        for (const msg of history.slice(-10)) {
          if (msg.role === 'user' || msg.role === 'assistant') {
            messages.push({ role: msg.role, content: msg.content });
          }
        }
      }
      // The webapp already appends the current message to `history`; don't send it twice.
      const lastMsg = messages[messages.length - 1];
      if (!(lastMsg?.role === 'user' && lastMsg.content === message)) {
        messages.push({ role: 'user', content: message });
      }

      // NounIRL gets the full toolkit — every capability it needs to operate autonomously
      const nounIrlTools: HubChatRequest['tools'] = buildNounIrlTools();

      // Preserve original tool definitions in dead code so handlers aren't orphaned.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const _removedGovernanceTools = false && buildRemovedGovernanceTools(); // end _removedGovernanceTools

      // Build system prompt — combine static + dynamic context
      const systemPrompt = [gameBrief, staticPrompt, dynamicContext].filter(Boolean).join('\n\n');

      // First API call via agent-hub (both use Sonnet for quality)
      let response = await hubChat({
        messages,
        system: systemPrompt,
        task: 'chat',
        maxTokens: isNounIrl ? 1024 : 512, // homepage chat gets shorter responses to save tokens
        temperature: 0.7,
        ...(isNounIrl ? { tools: nounIrlTools } : {}),
      });

      // Recover XML tool calls if the LLM hallucinated them as text (Groq/Llama fallback)
      patchXmlToolCalls(response);

      // Track governance actions prepared by tools (returned in response for frontend execution)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let pendingAction: Record<string, any> | null = null;

      // Handle tool use loop (max 5 iterations — agent may chain: parse_traits → verify_tip → create_reservation)
      let iterations = 0;
      while (
        response.finishReason === 'tool_calls' &&
        response.toolCalls?.length &&
        iterations < 5
      ) {
        iterations++;
        const toolUseBlocks = response.toolCalls;

        const toolResults: HubChatRequest['messages'] = [];

        for (const toolUse of toolUseBlocks) {
          try {
            let result: unknown;
            const args = JSON.parse(toolUse.function.arguments || '{}');

            switch (toolUse.function.name) {
              case 'verify_tip': {
                const input = args as { txHash: string; chainId: number };
                result = await verifyTip(input.txHash, input.chainId);
                break;
              }

              case 'create_reservation': {
                const input = args as {
                  wallet: string;
                  txHash: string;
                  chainId: number;
                  traits: string[];
                  dao?: string;
                };
                // Check if tx already used
                if (reservationStore.isTxUsed(input.txHash)) {
                  result = {
                    success: false,
                    error: 'This transaction has already been used for a reservation',
                  };
                } else {
                  // Create reservation
                  const gasBudget = await getGasBudget().catch(() => null);
                  const reservation = reservationStore.create({
                    wallet: input.wallet,
                    tipTxHash: input.txHash,
                    tipChainId: input.chainId,
                    tipAmountEth: 0,
                    traits: input.traits,
                    dao: input.dao === 'v2' ? 'v2' : 'v1',
                  });
                  // Verify tip and activate async
                  verifyTip(input.txHash, input.chainId)
                    .then(tipResult => {
                      if (tipResult.valid) {
                        const r = reservationStore.get(reservation.id);
                        if (r) {
                          // Persist tip amount to Postgres before activating —
                          // a plain `r.tipAmountEth = ...` would only mutate
                          // memory and the value would be lost on next deploy.
                          reservationStore.setTipAmount(reservation.id, tipResult.amountEth || 0);
                          reservationStore.activate(reservation.id);
                          console.log(
                            `[NounIRL] ✅ Reservation ${reservation.id} verified & activated — ${tipResult.amountEth} ETH from ${tipResult.chainName}`,
                          );
                        }
                      } else {
                        console.log(
                          `[NounIRL] ❌ Tip verification failed for ${reservation.id}: ${tipResult.error}`,
                        );
                        reservationStore.cancel(reservation.id);
                      }
                    })
                    .catch(err => {
                      console.error(`[NounIRL] Tip verification error for ${reservation.id}:`, err);
                    });
                  result = {
                    success: true,
                    reservationId: reservation.id,
                    status: reservation.status,
                    traits: reservation.traits,
                    dao: reservation.dao,
                    message:
                      'Reservation created. Tip is being verified — it will auto-activate once confirmed onchain.',
                    // Gas isn't ring-fenced per reservation. When the wallet
                    // can't cover everything waiting, tell the user plainly.
                    gasWarning: gasBudget?.short ? gasBudget.summary : null,
                  };
                }
                break;
              }

              case 'get_reservations': {
                const input = args as { wallet?: string };
                const reservations = input.wallet
                  ? reservationStore.getByWallet(input.wallet)
                  : reservationStore.getAll();
                result = {
                  reservations: reservations.map(r => ({
                    id: r.id,
                    wallet: r.wallet,
                    traits: r.traits,
                    dao: r.dao,
                    status: r.status,
                    tipAmountEth: r.tipAmountEth,
                    tipChainId: r.tipChainId,
                    createdAt: new Date(r.createdAt * 1000).toISOString(),
                    fulfilledNounId: r.fulfilledNounId,
                  })),
                  stats: reservationStore.stats(),
                };
                break;
              }

              case 'cancel_reservation': {
                const input = args as { reservationId: string };
                const reservation = reservationStore.get(input.reservationId);
                if (!reservation) {
                  result = { success: false, error: 'Reservation not found' };
                } else {
                  reservationStore.cancel(input.reservationId);
                  result = {
                    success: true,
                    message: `Reservation ${input.reservationId} cancelled`,
                  };
                }
                break;
              }

              case 'check_block': {
                result = await checkNow();
                break;
              }

              case 'list_traits': {
                const input = args as {
                  category: 'background' | 'body' | 'accessory' | 'head' | 'glasses';
                };
                const names = getAllTraitNames(input.category);
                result = { category: input.category, count: names.length, traits: names };
                break;
              }

              case 'parse_traits': {
                const input = args as { description: string };
                const parsed = parseTraitDescription(input.description);
                result = { description: input.description, parsed };
                break;
              }

              case 'get_settlements': {
                const input = args as { limit?: number };
                result = { settlements: reservationStore.getSettlements(input.limit || 20) };
                break;
              }

              case 'get_noun_settler': {
                const input = args as { nounId: number; dao?: 'v1' | 'v2' };
                const dao: 'v1' | 'v2' = input.dao === 'v2' ? 'v2' : 'v1';
                const id = Math.floor(Number(input.nounId));
                if (!Number.isFinite(id) || id < 0) {
                  result = { error: 'nounId must be a non-negative integer' };
                  break;
                }
                const maps = await getSettlerMaps(db, dao);
                const settler = maps.settlers[String(id)] ?? null;
                const curator = maps.curated[String(id)] ?? null;
                const table = dao === 'v2' ? schema.nounV2Auction : schema.auction;
                const [row] = await db
                  .select()
                  .from(table)
                  .where(eq(table.nounId, BigInt(id)))
                  .limit(1);
                const names = await resolveEnsBatch(
                  [settler, curator, row?.winner ?? null].filter((a): a is string => !!a),
                );
                const label = (a: string | null) =>
                  a ? { address: a, ens: names[a.toLowerCase()] ?? null } : null;
                const v1row =
                  dao === 'v1'
                    ? (row as typeof schema.auction.$inferSelect | undefined)
                    : undefined;
                result = {
                  dao,
                  nounId: id,
                  indexedUpTo: maps.maxNounId,
                  // Nounder nouns (V1: every 10th id ≤ 1820) were never auctioned — they were
                  // minted by the tx that settled the previous auction, so settler is inherited.
                  nounderNoun: dao === 'v1' && maps.nounderIds.includes(id),
                  settler: label(settler),
                  settledAtUnix: v1row?.settledAt ? Math.floor(v1row.settledAt.getTime()) : null,
                  settledAtTransaction: v1row?.settledAtTransaction ?? null,
                  curator: label(curator),
                  curatorNote:
                    'curator(N) = settler(N-1): their settle tx minted N and rolled its seed.',
                  winner: label(row?.winner ?? null),
                  amountEth: row?.amount != null ? Number(row.amount) / 1e18 : null,
                  settled: row?.settled ?? null,
                  found: settler !== null || curator !== null || !!row,
                  // Every deploy re-indexes into a fresh schema (~10-15 min). While that
                  // runs the maps stop short — say so instead of "no record".
                  note:
                    settler === null && curator === null && !row && maps.maxNounId < id
                      ? `The indexer is still catching up (settlements indexed through Noun ${maps.maxNounId}). This is a temporary backfill window after a deploy — ask again in a few minutes, the data does go back to Noun 0.`
                      : null,
                };
                break;
              }

              case 'get_agent_balance': {
                const balance = await getAgentBalance();
                const gasBudget = await getGasBudget().catch(() => null);
                result = {
                  address: process.env.NOUNIRL_ADDRESS || 'not configured',
                  balanceEth: Math.round(balance * 10000) / 10000,
                  // Settles the balance pays for vs paid reservations waiting.
                  // Quote these numbers; never estimate gas from memory.
                  gasBudget,
                };
                break;
              }

              case 'deploy_code': {
                const input = args as { description: string; reason?: string };

                // ── Noun-gated: require 4+ Nouns to deploy ──
                if (!wallet) {
                  result = {
                    success: false,
                    error: `Deploy requires a connected wallet holding ≥ ${MIN_NOUNS_FOR_DEPLOY} Nouns. Connect your wallet first.`,
                  };
                } else {
                  const nounBalance = await getNounBalance(wallet);
                  if (nounBalance < MIN_NOUNS_FOR_DEPLOY) {
                    result = {
                      success: false,
                      error: `Deploy requires ≥ ${MIN_NOUNS_FOR_DEPLOY} Nouns. Your wallet (${wallet.slice(0, 6)}...${wallet.slice(-4)}) holds ${nounBalance} Noun${nounBalance === 1 ? '' : 's'}. Only major Nouners can push code changes.`,
                    };
                  } else if (!canDeploy()) {
                    result = {
                      success: false,
                      error: 'Rate limited — max 1 deploy per hour. Try again later.',
                    };
                  } else {
                    console.log(`[NounIRL] Deploy authorized by ${wallet} (${nounBalance} Nouns)`);
                    const patches = await generatePatch(input.description);
                    const deployResult = await applyAndDeploy(
                      patches,
                      input.description,
                      input.reason ||
                        `autonomous deploy via terminal (authorized by ${wallet.slice(0, 6)}...${wallet.slice(-4)}, ${nounBalance} Nouns)`,
                      'terminal',
                    );
                    result = {
                      success: deployResult.success,
                      branch: deployResult.branch,
                      commitSha: deployResult.commitSha,
                      // Quote `previewUrl` back to the user so they can open
                      // the live change. Tell them to DM @pip on Warpcast
                      // before any prod merge — production is pip's call.
                      previewUrl: deployResult.previewUrl,
                      nextStep: deployResult.success
                        ? 'Tell the user the previewUrl and ask them to DM @pip on Warpcast to review and ship to main.'
                        : undefined,
                      error: deployResult.error,
                      patchCount: deployResult.patches.length,
                      authorizedBy: wallet,
                      nounBalance,
                    };
                  }
                }
                break;
              }

              case 'remember_fact': {
                const input = args as { key: string; content: string; scope: 'wallet' | 'global' };
                const memScope =
                  input.scope === 'wallet' && wallet ? `wallet:${wallet.toLowerCase()}` : 'global';
                await remember(memScope, input.key, input.content);
                result = {
                  success: true,
                  message: `Remembered "${input.key}" in ${input.scope} scope.`,
                };
                break;
              }

              case 'recall_facts': {
                const input = args as { scope: 'wallet' | 'global' | 'all'; key?: string };
                if (input.scope === 'all') {
                  const all = await recall('global');
                  const walletMem = wallet ? await recall(`wallet:${wallet.toLowerCase()}`) : [];
                  result = { global: all, wallet: walletMem };
                } else {
                  const scope =
                    input.scope === 'wallet' && wallet
                      ? `wallet:${wallet.toLowerCase()}`
                      : 'global';
                  result = { memories: await recall(scope, input.key) };
                }
                break;
              }

              case 'learn_url': {
                const input = args as { url: string };
                try {
                  new URL(input.url); // validate URL
                  result = await learnFromUrl(input.url);
                } catch {
                  result = { error: 'Invalid URL provided' };
                }
                break;
              }

              case 'self_learn': {
                // Fire and forget — this takes minutes
                runSelfLearn()
                  .then(r => {
                    console.log(
                      `[SelfLearn] Tool-triggered pipeline complete: ${r.totalFacts} facts`,
                    );
                  })
                  .catch(err => {
                    console.error('[SelfLearn] Tool-triggered pipeline failed:', err);
                  });
                result = {
                  started: true,
                  message:
                    "Self-learning pipeline started. Processing all proposals, auctions, and delegates from noun.wtf. This takes a few minutes — I'll have comprehensive knowledge of all ~950 Nouns DAO proposals when it finishes.",
                };
                break;
              }

              case 'world_fastest': {
                try {
                  const st = await fetchWorldStats();
                  const top = (k: string) => (st.boards?.[k] ?? []).slice(0, 5);
                  result = {
                    playersEver: st.riders ?? 0,
                    sessions: st.sessions ?? 0,
                    topSpeedKmh: top('kmh'),
                    bestCombo: top('combo'),
                    bestSession: top('session'),
                    highestJumpM: top('airM'),
                    longestHangS: top('airS'),
                    longestGrindM: top('grindM'),
                    furthestDownhillM: top('downM'),
                  };
                } catch (err) {
                  result = {
                    error: `Leaderboard unavailable: ${err instanceof Error ? err.message : String(err)}`,
                  };
                }
                break;
              }

              // ── Governance Action Tools ──────────────────────────────────────
              case 'lookup_proposal': {
                const input = args as { proposalId?: number; keyword?: string };
                try {
                  if (input.proposalId) {
                    const rows = await db
                      .select()
                      .from(schema.proposal)
                      .where(eq(schema.proposal.id, String(input.proposalId)))
                      .limit(1);
                    if (rows.length === 0) {
                      result = { error: `Proposal #${input.proposalId} not found in index.` };
                    } else {
                      const p = rows[0];
                      const descText = (p.description ?? '').toString();
                      const title = proposalTitle(descText);
                      const currentBlock = await getCurrentBlock();
                      const voting = formatBlocksRemaining(currentBlock, p.endBlock);
                      const updatePeriod = formatBlocksRemaining(
                        currentBlock,
                        p.updatePeriodEndBlock,
                      );
                      const objectionPeriod = formatBlocksRemaining(
                        currentBlock,
                        p.objectionPeriodEndBlock,
                      );
                      result = {
                        proposalId: p.id,
                        title,
                        status: p.status,
                        proposer: p.proposer,
                        forVotes: p.forVotes?.toString(),
                        againstVotes: p.againstVotes?.toString(),
                        abstainVotes: p.abstainVotes?.toString(),
                        quorumVotes: p.quorumVotes?.toString(),
                        quorumMet:
                          p?.quorumVotes == null
                            ? null
                            : BigInt(p?.forVotes ?? 0) >= BigInt(p?.quorumVotes ?? 0),
                        currentBlock: currentBlock.toString(),
                        startBlock: p.startBlock?.toString(),
                        endBlock: p.endBlock?.toString(),
                        votingTimeLeft: voting.timeLeftFormatted,
                        votingBlocksLeft: voting.blocksLeft,
                        votingEnded: voting.hasEnded,
                        updatePeriodEndBlock: p.updatePeriodEndBlock?.toString() ?? null,
                        updatePeriodTimeLeft: updatePeriod.timeLeftFormatted,
                        objectionPeriodEndBlock: p.objectionPeriodEndBlock?.toString() ?? null,
                        objectionPeriodTimeLeft: objectionPeriod.timeLeftFormatted,
                        description: descText.slice(0, 500),
                      };
                    }
                  } else if (input.keyword) {
                    // Search proposals by description content
                    const allProps = await db
                      .select()
                      .from(schema.proposal)
                      .orderBy(desc(schema.proposal.createdAtBlock))
                      .limit(100);
                    const kw = input.keyword.toLowerCase();
                    const matches = allProps
                      .filter(p => {
                        const desc = (p.description ?? '').toString().toLowerCase();
                        return desc.includes(kw);
                      })
                      .slice(0, 5);
                    result = {
                      matches: matches.map(p => {
                        const descText = (p.description ?? '').toString();
                        const title = proposalTitle(descText);
                        return {
                          proposalId: p.id,
                          title,
                          status: p.status,
                          proposer: p.proposer,
                          forVotes: p.forVotes?.toString(),
                          quorumVotes: p.quorumVotes?.toString(),
                        };
                      }),
                      count: matches.length,
                    };
                  } else {
                    result = { error: 'Provide either proposalId or keyword.' };
                  }
                } catch (err) {
                  result = {
                    error: `Lookup failed: ${err instanceof Error ? err.message : 'unknown'}`,
                  };
                }
                break;
              }

              case 'lookup_candidate': {
                const input = args as { slug?: string; keyword?: string };
                try {
                  if (input.slug) {
                    const rows = await db
                      .select()
                      .from(schema.candidate)
                      .where(eq(schema.candidate.slug, input.slug))
                      .limit(1);
                    if (rows.length === 0) {
                      result = { error: `Candidate "${input.slug}" not found.` };
                    } else {
                      const c = rows[0];
                      const descText = (c.description ?? '').toString();
                      const title = proposalTitle(descText);
                      result = {
                        slug: c.slug,
                        proposer: c.proposer,
                        title,
                        description: descText.slice(0, 500),
                        canceled: c.canceled,
                      };
                    }
                  } else if (input.keyword) {
                    const matches = await findCandidates(input.keyword, {
                      limit: 5,
                      includeCanceled: true,
                    });
                    result = {
                      matches: matches.map(c => ({
                        slug: c.slug,
                        proposer: c.proposer,
                        title: candidateTitle(c),
                        canceled: c.canceled,
                      })),
                      count: matches.length,
                    };
                  } else {
                    result = { error: 'Provide either slug or keyword.' };
                  }
                } catch (err) {
                  result = {
                    error: `Lookup failed: ${err instanceof Error ? err.message : 'unknown'}`,
                  };
                }
                break;
              }

              case 'prepare_vote': {
                const input = args as {
                  proposalId: number;
                  support: 0 | 1 | 2;
                  reason?: string;
                  dao?: string;
                };
                // Normalize the dao value. Client accepts 'lil-nouns' | 'lilnouns' | 'lil'
                // as aliases for Lil Nouns; we forward the canonical 'lil-nouns' string.
                const rawDao = (input.dao ?? '').toLowerCase();
                const isLil = rawDao === 'lil-nouns' || rawDao === 'lilnouns' || rawDao === 'lil';
                const daoCanonical: 'nouns' | 'lil-nouns' = isLil ? 'lil-nouns' : 'nouns';
                if (!wallet) {
                  result = {
                    error:
                      'User must connect their wallet to vote. Tell them to click "connect" in the header.',
                  };
                } else if (daoCanonical === 'lil-nouns') {
                  // Lil Nouns proposals are not in the mainnet Ponder index; we trust the
                  // model + injected /api/lil-proposals context to pick a real ID. The
                  // on-chain governor will revert if the prop is invalid or not in
                  // Active/ObjectionPeriod state — the client surfaces that error.
                  pendingAction = {
                    type: 'VOTE',
                    proposalId: input.proposalId,
                    support: input.support,
                    reason: input.reason,
                    title: `Lil Prop #${input.proposalId}`,
                    dao: 'lil-nouns',
                  };
                  result = {
                    success: true,
                    action: pendingAction,
                    message: `Vote prepared: ${['AGAINST', 'FOR', 'ABSTAIN'][input.support]} on Lil Prop #${input.proposalId}. The user will be asked to confirm and sign the transaction in their wallet (Lil Nouns governor).`,
                  };
                } else {
                  try {
                    const rows = await db
                      .select()
                      .from(schema.proposal)
                      .where(eq(schema.proposal.id, String(input.proposalId)))
                      .limit(1);
                    if (rows.length === 0) {
                      result = { error: `Proposal #${input.proposalId} not found.` };
                    } else {
                      const p = rows[0];
                      // Check votability using block timing instead of DB status,
                      // because the indexer may not have a handler that sets ACTIVE status.
                      // A proposal is votable if: cancelled/vetoed/executed = false, and current block is within voting window.
                      const isFinalStatus =
                        p.status === 'CANCELLED' ||
                        p.status === 'VETOED' ||
                        p.status === 'EXECUTED' ||
                        p.status === 'QUEUED';
                      let votable = !isFinalStatus;
                      let rejectReason = '';
                      if (isFinalStatus) {
                        rejectReason = `Proposal #${input.proposalId} is "${p.status}" — voting is closed.`;
                        votable = false;
                      } else if (p.startBlock && p.endBlock) {
                        const currentBlock = await getCurrentBlock();
                        const start = BigInt(p.startBlock);
                        const end = BigInt(p.endBlock);
                        const objEnd = p.objectionPeriodEndBlock
                          ? BigInt(p.objectionPeriodEndBlock)
                          : null;
                        const effectiveEnd = objEnd && objEnd > end ? objEnd : end;
                        if (currentBlock < start) {
                          rejectReason = `Proposal #${input.proposalId} voting hasn't started yet (starts at block ${p.startBlock}).`;
                          votable = false;
                        } else if (currentBlock > effectiveEnd) {
                          rejectReason = `Proposal #${input.proposalId} voting has ended.`;
                          votable = false;
                        }
                      }
                      if (!votable) {
                        result = { error: rejectReason };
                      } else {
                        const descText = (p.description ?? '').toString();
                        const title = proposalTitle(descText);
                        pendingAction = {
                          type: 'VOTE',
                          proposalId: input.proposalId,
                          support: input.support,
                          reason: input.reason,
                          title,
                          dao: 'nouns',
                        };
                        result = {
                          success: true,
                          action: pendingAction,
                          message: `Vote prepared: ${['AGAINST', 'FOR', 'ABSTAIN'][input.support]} on Prop #${input.proposalId} "${title}". The user will be asked to confirm and sign the transaction.`,
                        };
                      }
                    }
                  } catch (err) {
                    result = {
                      error: `Vote prep failed: ${err instanceof Error ? err.message : 'unknown'}`,
                    };
                  }
                }
                break;
              }

              case 'prepare_proposal_feedback': {
                const input = args as { proposalId: number; support: 0 | 1 | 2; reason?: string };
                if (!wallet) {
                  result = {
                    error:
                      'User must connect their wallet to give feedback. Tell them to click "connect" in the header.',
                  };
                } else {
                  try {
                    const rows = await db
                      .select()
                      .from(schema.proposal)
                      .where(eq(schema.proposal.id, String(input.proposalId)))
                      .limit(1);
                    if (rows.length === 0) {
                      result = { error: `Proposal #${input.proposalId} not found.` };
                    } else {
                      const descText = (rows[0].description ?? '').toString();
                      const title = proposalTitle(descText);
                      pendingAction = {
                        type: 'PROPOSAL_FEEDBACK',
                        proposalId: input.proposalId,
                        support: input.support,
                        reason: input.reason,
                        title,
                      };
                      result = {
                        success: true,
                        action: pendingAction,
                        message: `Feedback prepared: ${['AGAINST', 'FOR', 'ABSTAIN'][input.support]} on Prop #${input.proposalId} "${title}". The user will be asked to confirm and sign.`,
                      };
                    }
                  } catch (err) {
                    result = {
                      error: `Feedback prep failed: ${err instanceof Error ? err.message : 'unknown'}`,
                    };
                  }
                }
                break;
              }

              case 'prepare_candidate_feedback': {
                const input = args as {
                  proposer: string;
                  slug: string;
                  support: 0 | 1 | 2;
                  reason?: string;
                };
                if (!wallet) {
                  result = {
                    error:
                      'User must connect their wallet. Tell them to click "connect" in the header.',
                  };
                } else {
                  try {
                    const rows = await db
                      .select()
                      .from(schema.candidate)
                      .where(eq(schema.candidate.slug, input.slug))
                      .limit(1);
                    if (rows.length === 0) {
                      result = { error: `Candidate "${input.slug}" not found.` };
                    } else {
                      const c = rows[0];
                      const descText = (c.description ?? '').toString();
                      const title = proposalTitle(descText);
                      pendingAction = {
                        type: 'CANDIDATE_FEEDBACK',
                        proposer: c.proposer as string,
                        slug: input.slug,
                        support: input.support,
                        reason: input.reason,
                        title,
                      };
                      result = {
                        success: true,
                        action: pendingAction,
                        message: `Candidate feedback prepared: ${['AGAINST', 'FOR', 'ABSTAIN'][input.support]} on "${title}". The user will be asked to confirm and sign.`,
                      };
                    }
                  } catch (err) {
                    result = {
                      error: `Candidate feedback prep failed: ${err instanceof Error ? err.message : 'unknown'}`,
                    };
                  }
                }
                break;
              }

              case 'prepare_candidate': {
                const input = args as {
                  title: string;
                  description: string;
                  transactions?: ProposalTxInput[];
                };
                if (!wallet) {
                  result = {
                    error:
                      'User must connect their wallet to create a candidate. Tell them to click "connect" in the header.',
                  };
                } else {
                  // Generate a URL-safe slug from the title
                  const slug = input.title
                    .toLowerCase()
                    .replace(/[^\da-z]+/g, '-')
                    .replace(/^-|-$/g, '')
                    .slice(0, 80);
                  const fullDescription = `# ${input.title}\n\n${input.description}`;

                  const expanded = expandProposalTransactions(input.transactions);
                  if (!expanded.ok) {
                    result = { error: expanded.error };
                    break;
                  }
                  const txs = expanded.txs;

                  pendingAction = {
                    type: 'CREATE_CANDIDATE',
                    slug,
                    description: fullDescription,
                    title: input.title,
                    targets: txs.map(t => t.target),
                    values: txs.map(t => t.value),
                    signatures: txs.map(t => t.signature),
                    calldatas: txs.map(t => t.calldata),
                  };
                  const txNote =
                    txs.length > 0
                      ? ` Includes ${txs.length} executable transaction${txs.length > 1 ? 's' : ''}.`
                      : ' Description-only (no executable transactions).';
                  result = {
                    success: true,
                    action: pendingAction,
                    message: `Candidate prepared: "${input.title}" (slug: ${slug}).${txNote} The user will be asked to confirm and sign. Note: creating a candidate costs a small amount of ETH (set by the DAO).`,
                  };
                }
                break;
              }

              case 'propose_trait': {
                const input = args as {
                  category: TraitCategory;
                  trait_name: string;
                  title: string;
                  description: string;
                  dao?: TraitDao;
                  rle?: string;
                  dream_id?: number;
                  png_data_url?: string;
                  derive_from?: string;
                  swap_runs?: string;
                  recolor?: string;
                };
                if (!wallet) {
                  result = {
                    error:
                      'User must connect their wallet to propose a trait. Tell them to click "connect" in the header.',
                  };
                  break;
                }
                try {
                  const dao: TraitDao = input.dao === 'nouns' ? 'nouns' : 'nounv2';
                  // On-chain art is authoritative (falls back to bundled data on RPC failure)
                  const art = await getOnchainArt(dao);

                  // Image source precedence: rle > dream_id > png_data_url > derive_from
                  let rleHex: string | undefined;
                  if (input.rle) {
                    rleHex = input.rle;
                  } else if (input.dream_id != null) {
                    const img = await getDreamTraitImage(Number(input.dream_id));
                    if (!img) {
                      throw new Error(
                        `Dream #${input.dream_id} not found or has no custom trait image.`,
                      );
                    }
                    rleHex = await pngToRle(img.data, art.palette);
                  } else if (input.png_data_url) {
                    const m = input.png_data_url.match(/^data:image\/[\w+-]+;base64,(.+)$/);
                    if (!m) throw new Error('png_data_url must be a data:image/png;base64,… URL');
                    rleHex = await pngToRle(Buffer.from(m[1]!, 'base64'), art.palette);
                  } else if (input.derive_from) {
                    const derivation: {
                      swapRunColors?: [number, number];
                      recolor?: [number, number][];
                    } = {};
                    if (input.swap_runs) {
                      const [i, j] = input.swap_runs.split(',').map(Number);
                      derivation.swapRunColors = [i!, j!];
                    }
                    if (input.recolor)
                      derivation.recolor = input.recolor
                        .split(',')
                        .map(p => p.split(':').map(Number) as [number, number]);
                    // Names only exist in the bundled data; the actual bytes are
                    // taken from chain at the resolved index when available.
                    /* eslint-disable @typescript-eslint/no-explicit-any */
                    const bundle = (
                      dao === 'nouns' ? ImageDataV1ForTraits : ImageDataV2ForTraits
                    ) as any;
                    /* eslint-enable @typescript-eslint/no-explicit-any */
                    const src = findTrait(bundle, input.category, input.derive_from);
                    const imagesKey = IMAGE_KEY[input.category] as keyof OnchainArt['images'];
                    const baseRle = art.images[imagesKey][src.index] ?? src.data.replace(/^0x/, '');
                    const derived = applyDerivation(parseRle(baseRle), derivation);
                    assertColorsInPalette(derived, art.palette.length);
                    rleHex = serializeRle(derived);
                  } else {
                    throw new Error('Provide one of: rle, dream_id, png_data_url, or derive_from.');
                  }

                  const proposal = buildTraitProposal({
                    category: input.category,
                    title: input.title,
                    description: input.description,
                    dao,
                    rleHex,
                  });

                  // Absolute URL — the confirm card on noun.wtf renders this as a
                  // plain <img src>, so a relative path would resolve against
                  // Netlify instead of this API. Railway injects RAILWAY_PUBLIC_DOMAIN.
                  const apiBase = process.env.RAILWAY_PUBLIC_DOMAIN
                    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}`
                    : '';
                  const previewUrl = `${apiBase}/api/trait-preview?dao=${dao}&category=${input.category}&mode=grid&rle=${proposal.add.rleHex}`;
                  const daoLabel = dao === 'nouns' ? 'the original Nouns DAO' : 'NounV2';
                  pendingAction = {
                    type: 'PROPOSE_TRAIT',
                    dao,
                    title: input.title,
                    traitName: input.trait_name,
                    category: input.category,
                    description: proposal.description,
                    targets: proposal.targets,
                    values: proposal.values.map(v => v.toString()),
                    signatures: proposal.signatures,
                    calldatas: proposal.calldatas,
                    previewUrl,
                  };
                  const governanceNote =
                    dao === 'nouns'
                      ? 'propose() goes to the main Nouns DAO governor — the user must meet the main DAO proposal threshold, and voting follows mainnet timing.'
                      : 'executed by the NounV2 Treasury — the user must hold >=1 NounV2 to propose. Voting is ~12h, then a 12h timelock before execute.';
                  result = {
                    success: true,
                    action: pendingAction,
                    previewUrl,
                    message: `Trait proposal prepared: adds ${input.category} "${input.trait_name}" to ${daoLabel} (${proposal.add.decompressedLength}B image via ${proposal.add.signature}). Preview of sample nouns wearing it: ${previewUrl} — share this link with the user. The user will confirm and sign; ${governanceNote}`,
                  };
                } catch (e) {
                  result = {
                    error: `Could not build trait proposal: ${
                      e instanceof Error ? e.message : String(e)
                    }`,
                  };
                }
                break;
              }

              case 'prepare_update_candidate': {
                const input = args as {
                  slug: string;
                  title: string;
                  description: string;
                  reason?: string;
                  transactions?: ProposalTxInput[];
                };
                if (!wallet) {
                  result = {
                    error:
                      'User must connect their wallet to update a candidate. Tell them to click "connect" in the header.',
                  };
                } else {
                  try {
                    const rows = await db
                      .select()
                      .from(schema.candidate)
                      .where(eq(schema.candidate.slug, input.slug))
                      .limit(1);
                    if (rows.length === 0) {
                      result = { error: `Candidate "${input.slug}" not found.` };
                    } else {
                      const c = rows[0];
                      if (c.canceled) {
                        result = { error: `Candidate "${input.slug}" has been canceled.` };
                      } else if ((c.proposer as string).toLowerCase() !== wallet.toLowerCase()) {
                        result = {
                          error: `Only the original proposer (${(c.proposer as string).slice(0, 6)}...${(c.proposer as string).slice(-4)}) can update this candidate. Connected wallet doesn't match.`,
                        };
                      } else {
                        const expanded = expandProposalTransactions(input.transactions);
                        if (!expanded.ok) {
                          result = { error: expanded.error };
                          break;
                        }
                        const txs = expanded.txs;
                        const fullDescription = `# ${input.title}\n\n${input.description}`;

                        pendingAction = {
                          type: 'UPDATE_CANDIDATE',
                          slug: input.slug,
                          description: fullDescription,
                          title: input.title,
                          reason: input.reason || '',
                          targets: txs.map(t => t.target),
                          values: txs.map(t => t.value),
                          signatures: txs.map(t => t.signature),
                          calldatas: txs.map(t => t.calldata),
                        };
                        result = {
                          success: true,
                          action: pendingAction,
                          message: `Update prepared for candidate "${input.title}" (slug: ${input.slug}). WARNING: This will reset all existing sponsor signatures — sponsors will need to re-sign the updated version.`,
                        };
                      }
                    }
                  } catch (err) {
                    result = {
                      error: `Update candidate prep failed: ${err instanceof Error ? err.message : 'unknown'}`,
                    };
                  }
                }
                break;
              }

              case 'prepare_update_proposal': {
                const input = args as {
                  proposalId: number;
                  description?: string;
                  updateMessage: string;
                  transactions?: ProposalTxInput[];
                };
                if (!wallet) {
                  result = {
                    error:
                      'User must connect their wallet to update a proposal. Tell them to click "connect" in the header.',
                  };
                } else {
                  try {
                    const rows = await db
                      .select()
                      .from(schema.proposal)
                      .where(eq(schema.proposal.id, String(input.proposalId)))
                      .limit(1);
                    if (rows.length === 0) {
                      result = { error: `Proposal #${input.proposalId} not found.` };
                    } else {
                      const p = rows[0];
                      if ((p.proposer as string).toLowerCase() !== wallet.toLowerCase()) {
                        result = {
                          error: `Only the original proposer can update this proposal. Connected wallet doesn't match.`,
                        };
                      } else if (!p.updatePeriodEndBlock) {
                        result = {
                          error: `Proposal #${input.proposalId} doesn't have an update period set. It may be too old or already past its update window.`,
                        };
                      } else {
                        const expanded = expandProposalTransactions(input.transactions);
                        if (!expanded.ok) {
                          result = { error: expanded.error };
                          break;
                        }
                        const txs = expanded.txs;

                        const descText = (p.description ?? '').toString();
                        const title = proposalTitle(descText);

                        // Determine update type: description-only, transactions-only, or both
                        const hasNewDesc = !!input.description;
                        const hasNewTxs = txs.length > 0;

                        let updateType:
                          | 'UPDATE_PROPOSAL'
                          | 'UPDATE_PROPOSAL_DESCRIPTION'
                          | 'UPDATE_PROPOSAL_TRANSACTIONS';
                        if (hasNewDesc && hasNewTxs) {
                          updateType = 'UPDATE_PROPOSAL';
                        } else if (hasNewTxs) {
                          updateType = 'UPDATE_PROPOSAL_TRANSACTIONS';
                        } else {
                          updateType = 'UPDATE_PROPOSAL_DESCRIPTION';
                        }

                        pendingAction = {
                          type: updateType,
                          proposalId: input.proposalId,
                          title,
                          description: input.description || descText,
                          updateMessage: input.updateMessage,
                          targets: txs.map(t => t.target),
                          values: txs.map(t => t.value),
                          signatures: txs.map(t => t.signature),
                          calldatas: txs.map(t => t.calldata),
                          updatePeriodEndBlock: p.updatePeriodEndBlock?.toString(),
                        };
                        result = {
                          success: true,
                          action: pendingAction,
                          message: `Proposal update prepared for Prop #${input.proposalId} "${title}". Update type: ${updateType.replace(/_/g, ' ').toLowerCase()}. Update period ends at block ${p.updatePeriodEndBlock}. The user will be asked to confirm and sign.`,
                        };
                      }
                    }
                  } catch (err) {
                    result = {
                      error: `Update proposal prep failed: ${err instanceof Error ? err.message : 'unknown'}`,
                    };
                  }
                }
                break;
              }

              case 'prepare_sponsor': {
                const input = args as { proposer: string; slug: string; reason?: string };
                if (!wallet) {
                  result = {
                    error:
                      'User must connect their wallet to sponsor a candidate. Tell them to click "connect" in the header.',
                  };
                } else {
                  try {
                    const rows = await db
                      .select()
                      .from(schema.candidate)
                      .where(eq(schema.candidate.slug, input.slug))
                      .limit(1);
                    if (rows.length === 0) {
                      result = { error: `Candidate "${input.slug}" not found.` };
                    } else {
                      const c = rows[0];
                      if (c.canceled) {
                        result = { error: `Candidate "${input.slug}" has been canceled.` };
                      } else {
                        const descText = (c.description ?? '').toString();
                        const title = proposalTitle(descText);
                        pendingAction = {
                          type: 'SPONSOR',
                          proposer: c.proposer as string,
                          slug: input.slug,
                          reason: input.reason,
                          title,
                          // Frontend needs these to construct the EIP-712 signature
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
                        result = {
                          success: true,
                          action: pendingAction,
                          message: `Sponsor prepared for "${title}". The user will be asked to sign an EIP-712 message and submit it onchain. This adds their signature to help the candidate reach the proposal threshold.`,
                        };
                      }
                    }
                  } catch (err) {
                    result = {
                      error: `Sponsor prep failed: ${err instanceof Error ? err.message : 'unknown'}`,
                    };
                  }
                }
                break;
              }

              case 'prepare_bid': {
                const input = args as { nounId: number; bidAmountEth: string };
                if (!wallet) {
                  result = {
                    error:
                      'User must connect their wallet to bid. Tell them to click "connect" in the header.',
                  };
                } else {
                  try {
                    // Verify the auction exists and is active
                    const rows = await db
                      .select()
                      .from(schema.auction)
                      .where(eq(schema.auction.nounId, String(input.nounId)))
                      .limit(1);
                    if (rows.length === 0) {
                      result = { error: `Auction for Noun ${input.nounId} not found in index.` };
                    } else {
                      const auction = rows[0];
                      if (auction.settled) {
                        result = {
                          error: `Auction for Noun ${input.nounId} has already been settled.`,
                        };
                      } else {
                        const bidAmount = parseFloat(input.bidAmountEth);
                        if (isNaN(bidAmount) || bidAmount <= 0) {
                          result = { error: 'Invalid bid amount.' };
                        } else {
                          pendingAction = {
                            type: 'BID',
                            nounId: input.nounId,
                            bidAmountEth: input.bidAmountEth,
                          };
                          result = {
                            success: true,
                            action: pendingAction,
                            message: `Bid prepared: ${input.bidAmountEth} ETH on Noun ${input.nounId}. The user will be asked to confirm and sign the transaction. Client ID 37 (noun.wtf) will be included.`,
                          };
                        }
                      }
                    }
                  } catch (err) {
                    result = {
                      error: `Bid prep failed: ${err instanceof Error ? err.message : 'unknown'}`,
                    };
                  }
                }
                break;
              }

              case 'prepare_promote': {
                const input = args as { proposer: string; slug: string };
                if (!wallet) {
                  result = {
                    error:
                      'User must connect their wallet to promote a candidate. Tell them to click "connect" in the header.',
                  };
                } else {
                  try {
                    const rows = await db
                      .select()
                      .from(schema.candidate)
                      .where(eq(schema.candidate.slug, input.slug))
                      .limit(1);
                    if (rows.length === 0) {
                      result = { error: `Candidate "${input.slug}" not found.` };
                    } else {
                      const c = rows[0];
                      if (c.canceled) {
                        result = { error: `Candidate "${input.slug}" has been canceled.` };
                      } else {
                        const descText = (c.description ?? '').toString();
                        const title = proposalTitle(descText);

                        // Fetch signatures for this candidate.
                        // Match on candidateId (`${proposer}-${slug}` PK), not
                        // a non-existent candidateSlug column.
                        const sigs = await db
                          .select()
                          .from(schema.candidateSignature)
                          .where(eq(schema.candidateSignature.candidateId, c.id as string))
                          .limit(100);

                        const nowSec = Math.floor(Date.now() / 1000);
                        const validSigs = sigs.filter(
                          s => !s.canceled && Number(s.expirationTimestamp) > nowSec,
                        );

                        pendingAction = {
                          type: 'PROMOTE',
                          proposer: c.proposer as string,
                          slug: input.slug,
                          title,
                          // Full proposal data for the proposeBySigs call
                          targets: JSON.parse((c.targets as string) || '[]'),
                          values: JSON.parse((c.values as string) || '[]'),
                          signatures: JSON.parse((c.signatures as string) || '[]'),
                          calldatas: JSON.parse((c.calldatas as string) || '[]'),
                          description: descText,
                          // Valid sponsor signatures
                          sponsorSignatures: validSigs.map(s => ({
                            sig: s.sig,
                            signer: s.signer,
                            expirationTimestamp: s.expirationTimestamp?.toString(),
                          })),
                        };
                        result = {
                          success: true,
                          action: pendingAction,
                          signatureCount: validSigs.length,
                          message: `Promote prepared for "${title}" with ${validSigs.length} valid signatures. The user will call proposeBySigs with client ID 37 (noun.wtf). This creates a real onchain proposal from the candidate.`,
                        };
                      }
                    }
                  } catch (err) {
                    result = {
                      error: `Promote prep failed: ${err instanceof Error ? err.message : 'unknown'}`,
                    };
                  }
                }
                break;
              }

              case 'lookup_grant': {
                const input = args as { grantId?: number; keyword?: string };
                try {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  let rows: any[];
                  if (input.grantId !== undefined) {
                    rows = await db
                      .select()
                      .from(schema.grant)
                      .where(eq(schema.grant.id, String(input.grantId)))
                      .limit(1);
                  } else {
                    rows = await db
                      .select()
                      .from(schema.grant)
                      .orderBy(desc(schema.grant.createdAtBlock))
                      .limit(20);
                    if (input.keyword) {
                      const kw = input.keyword.toLowerCase();
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      rows = rows.filter((r: any) =>
                        (r.description || '').toLowerCase().includes(kw),
                      );
                    }
                  }
                  if (rows.length === 0) {
                    result = {
                      found: false,
                      message: input.grantId
                        ? `Grant #${input.grantId} not found.`
                        : 'No grants found.',
                    };
                  } else {
                    const currentBlock = await getCurrentBlock();
                    result = {
                      found: true,
                      currentBlock: currentBlock.toString(),
                      // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      grants: rows.map((g: any) => {
                        const descText = (g.description || '').toString();
                        const title = proposalTitle(descText);
                        const voting = formatBlocksRemaining(currentBlock, g.endBlock);
                        return {
                          id: g.id,
                          proposer: g.proposer,
                          title,
                          status: g.status,
                          forVotes: g.forVotes,
                          againstVotes: g.againstVotes,
                          abstainVotes: g.abstainVotes,
                          startBlock: g.startBlock,
                          endBlock: g.endBlock,
                          executionETA: g.executionETA,
                          votingTimeLeft: voting.timeLeftFormatted,
                          votingBlocksLeft: voting.blocksLeft,
                          votingEnded: voting.hasEnded,
                        };
                      }),
                    };
                  }
                } catch (err) {
                  result = {
                    error: `Grant lookup failed: ${err instanceof Error ? err.message : 'unknown'}`,
                  };
                }
                break;
              }

              case 'prepare_grant_vote': {
                const input = args as { grantId: number; support: 0 | 1 | 2; reason?: string };
                if (!wallet) {
                  result = {
                    error:
                      'User must connect their wallet to vote on a grant. Tell them to click "connect" in the header.',
                  };
                } else {
                  try {
                    const rows = await db
                      .select()
                      .from(schema.grant)
                      .where(eq(schema.grant.id, String(input.grantId)))
                      .limit(1);
                    if (rows.length === 0) {
                      result = { error: `Grant #${input.grantId} not found.` };
                    } else {
                      const g = rows[0];
                      if (g.status !== 'ACTIVE') {
                        result = {
                          error: `Grant #${input.grantId} is "${g.status}" — can only vote on Active grants.`,
                        };
                      } else {
                        const descText = (g.description || '').toString();
                        const title = proposalTitle(descText);
                        pendingAction = {
                          type: 'GRANT_VOTE',
                          grantId: input.grantId,
                          support: input.support,
                          reason: input.reason,
                          title,
                        };
                        result = {
                          success: true,
                          action: pendingAction,
                          message: `Grant vote prepared: ${['AGAINST', 'FOR', 'ABSTAIN'][input.support]} on Grant #${input.grantId} "${title}". The user will be asked to confirm and sign.`,
                        };
                      }
                    }
                  } catch (err) {
                    result = {
                      error: `Grant vote prep failed: ${err instanceof Error ? err.message : 'unknown'}`,
                    };
                  }
                }
                break;
              }

              case 'prepare_grant_proposal': {
                const input = args as {
                  title: string;
                  description: string;
                  transactions?: ProposalTxInput[];
                };
                if (!wallet) {
                  result = {
                    error:
                      'User must connect their wallet to create a grant proposal. Tell them to click "connect" in the header.',
                  };
                } else {
                  const expanded = expandProposalTransactions(input.transactions);
                  if (!expanded.ok) {
                    result = { error: expanded.error };
                    break;
                  }
                  const txs = expanded.txs;
                  const fullDescription = `# ${input.title}\n\n${input.description}`;

                  pendingAction = {
                    type: 'GRANT_PROPOSAL',
                    title: input.title,
                    description: fullDescription,
                    targets: txs.map(t => t.target),
                    values: txs.map(t => t.value),
                    signatures: txs.map(t => t.signature),
                    calldatas: txs.map(t => t.calldata),
                  };
                  const txNote =
                    txs.length > 0
                      ? ` Includes ${txs.length} executable transaction${txs.length > 1 ? 's' : ''}.`
                      : ' Description-only (no executable transactions).';
                  result = {
                    success: true,
                    action: pendingAction,
                    message: `Grant proposal prepared: "${input.title}".${txNote} This enters 12hr voting immediately — no delay. The user will be asked to confirm and sign.`,
                  };
                }
                break;
              }

              case 'prepare_queue_proposal': {
                const input = args as { proposalId: number };
                if (!wallet) {
                  result = {
                    error:
                      'User must connect their wallet to queue a proposal. Tell them to click "connect" in the header.',
                  };
                } else {
                  try {
                    const rows = await db
                      .select()
                      .from(schema.proposal)
                      .where(eq(schema.proposal.id, BigInt(input.proposalId)))
                      .limit(1);
                    if (rows.length === 0) {
                      result = { error: `Proposal #${input.proposalId} not found.` };
                    } else {
                      const p = rows[0];
                      const currentBlock = await getCurrentBlock();
                      const derived = computeDerivedStatus(
                        p as Parameters<typeof computeDerivedStatus>[0],
                        currentBlock,
                      );
                      if (derived !== 'SUCCEEDED') {
                        result = {
                          error: `Proposal #${input.proposalId} is "${derived}" — can only queue SUCCEEDED proposals (passed voting with quorum).`,
                        };
                      } else {
                        const descText = (p.description || '').toString();
                        const title = proposalTitle(descText);
                        pendingAction = {
                          type: 'QUEUE_PROPOSAL',
                          proposalId: input.proposalId,
                          title,
                        };
                        result = {
                          success: true,
                          action: pendingAction,
                          message: `Queue prepared for Prop #${input.proposalId} "${title}". This will place it in the timelock — after the waiting period it can be executed. The user will be asked to confirm and sign.`,
                        };
                      }
                    }
                  } catch (err) {
                    result = {
                      error: `Queue prep failed: ${err instanceof Error ? err.message : 'unknown'}`,
                    };
                  }
                }
                break;
              }

              case 'prepare_queue_grant': {
                const input = args as { grantId: number };
                if (!wallet) {
                  result = {
                    error:
                      'User must connect their wallet to queue a grant. Tell them to click "connect" in the header.',
                  };
                } else {
                  try {
                    const rows = await db
                      .select()
                      .from(schema.grant)
                      .where(eq(schema.grant.id, BigInt(input.grantId)))
                      .limit(1);
                    if (rows.length === 0) {
                      result = { error: `Grant #${input.grantId} not found.` };
                    } else {
                      const g = rows[0];
                      // For grants, check if voting passed — status should still be ACTIVE but votes have passed
                      // In practice the indexer may or may not have a derived status helper for grants
                      // We'll check that it's not already QUEUED/EXECUTED/CANCELLED
                      if (g.status === 'QUEUED') {
                        result = { error: `Grant #${input.grantId} is already queued.` };
                      } else if (g.status === 'EXECUTED') {
                        result = { error: `Grant #${input.grantId} has already been executed.` };
                      } else if (g.status === 'CANCELED') {
                        result = { error: `Grant #${input.grantId} was cancelled.` };
                      } else {
                        const descText = (g.description || '').toString();
                        const title = proposalTitle(descText);
                        pendingAction = {
                          type: 'QUEUE_GRANT',
                          grantId: input.grantId,
                          title,
                        };
                        result = {
                          success: true,
                          action: pendingAction,
                          message: `Queue prepared for Grant #${input.grantId} "${title}". This will place it in the 12hr timelock before it can be executed. The user will be asked to confirm and sign.`,
                        };
                      }
                    }
                  } catch (err) {
                    result = {
                      error: `Queue prep failed: ${err instanceof Error ? err.message : 'unknown'}`,
                    };
                  }
                }
                break;
              }

              case 'prepare_execute_proposal': {
                const input = args as { proposalId: number };
                if (!wallet) {
                  result = {
                    error:
                      'User must connect their wallet to execute a proposal. Tell them to click "connect" in the header.',
                  };
                } else {
                  try {
                    const rows = await db
                      .select()
                      .from(schema.proposal)
                      .where(eq(schema.proposal.id, BigInt(input.proposalId)))
                      .limit(1);
                    if (rows.length === 0) {
                      result = { error: `Proposal #${input.proposalId} not found.` };
                    } else {
                      const p = rows[0];
                      if (p.status !== 'QUEUED') {
                        result = {
                          error: `Proposal #${input.proposalId} is "${p.status}" — can only execute QUEUED proposals.`,
                        };
                      } else if (!p.executionETA) {
                        result = {
                          error: `Proposal #${input.proposalId} has no execution ETA set.`,
                        };
                      } else {
                        const nowSeconds = Math.floor(Date.now() / 1000);
                        const eta = Number(p.executionETA);
                        if (nowSeconds < eta) {
                          const minutesLeft = (eta - nowSeconds) / 60;
                          const timeStr =
                            minutesLeft > 60
                              ? `~${(minutesLeft / 60).toFixed(1)} hours`
                              : `~${Math.ceil(minutesLeft)} minutes`;
                          result = {
                            error: `Proposal #${input.proposalId} timelock not yet expired (${timeStr} remaining).`,
                          };
                        } else {
                          const descText = (p.description || '').toString();
                          const title = proposalTitle(descText);
                          pendingAction = {
                            type: 'EXECUTE_PROPOSAL',
                            proposalId: input.proposalId,
                            title,
                          };
                          result = {
                            success: true,
                            action: pendingAction,
                            message: `Execute prepared for Prop #${input.proposalId} "${title}". The user will be asked to confirm and sign the execution transaction.`,
                          };
                        }
                      }
                    }
                  } catch (err) {
                    result = {
                      error: `Execute prep failed: ${err instanceof Error ? err.message : 'unknown'}`,
                    };
                  }
                }
                break;
              }

              case 'prepare_execute_grant': {
                const input = args as { grantId: number };
                if (!wallet) {
                  result = {
                    error:
                      'User must connect their wallet to execute a grant. Tell them to click "connect" in the header.',
                  };
                } else {
                  try {
                    const rows = await db
                      .select()
                      .from(schema.grant)
                      .where(eq(schema.grant.id, BigInt(input.grantId)))
                      .limit(1);
                    if (rows.length === 0) {
                      result = { error: `Grant #${input.grantId} not found.` };
                    } else {
                      const g = rows[0];
                      if (g.status !== 'QUEUED') {
                        result = {
                          error: `Grant #${input.grantId} is "${g.status}" — can only execute QUEUED grants.`,
                        };
                      } else if (!g.executionETA) {
                        result = { error: `Grant #${input.grantId} has no execution ETA set.` };
                      } else {
                        const nowSeconds = Math.floor(Date.now() / 1000);
                        const eta = Number(g.executionETA);
                        if (nowSeconds < eta) {
                          const minutesLeft = (eta - nowSeconds) / 60;
                          const timeStr =
                            minutesLeft > 60
                              ? `~${(minutesLeft / 60).toFixed(1)} hours`
                              : `~${Math.ceil(minutesLeft)} minutes`;
                          result = {
                            error: `Grant #${input.grantId} timelock not yet expired (${timeStr} remaining).`,
                          };
                        } else {
                          const descText = (g.description || '').toString();
                          const title = proposalTitle(descText);
                          pendingAction = {
                            type: 'EXECUTE_GRANT',
                            grantId: input.grantId,
                            title,
                          };
                          result = {
                            success: true,
                            action: pendingAction,
                            message: `Execute prepared for Grant #${input.grantId} "${title}". The user will be asked to confirm and sign the execution transaction.`,
                          };
                        }
                      }
                    }
                  } catch (err) {
                    result = {
                      error: `Execute prep failed: ${err instanceof Error ? err.message : 'unknown'}`,
                    };
                  }
                }
                break;
              }

              // ── Trading Bot Tools ──────────────────────────────────────────
              case 'get_trading_positions': {
                const input = args as { openOnly?: boolean };
                try {
                  const data = await getTradingPositions(input.openOnly !== false);
                  const positions = data.positions || [];
                  const parallelPositions = data.parallel || [];
                  const allOpen = [...positions, ...parallelPositions.flatMap(r => r.positions)];
                  result = {
                    positionCount: allOpen.length,
                    positions: allOpen.slice(0, 10).map(p => ({
                      id: p.id,
                      venue: p.venue,
                      symbol: p.symbol || p.tokenAddress,
                      direction: p.direction,
                      status: p.status,
                      entryPriceUsd: p.entryPriceUsd,
                      entryNotionalUsd: p.entryNotionalUsd,
                      moralScore: p.moralScore,
                      openedAt: p.openedAt ? new Date(p.openedAt).toISOString() : null,
                    })),
                    source: 'pooter.world trading bot',
                  };
                } catch (err) {
                  result = {
                    error: `Trading API error: ${err instanceof Error ? err.message : 'unavailable'}`,
                  };
                }
                break;
              }

              case 'get_trading_performance': {
                try {
                  const perf = await getTradingPerformance();
                  result = {
                    accountValueUsd: perf.accountValueUsd,
                    openPositions: perf.openPositionCount,
                    watchMarkets: perf.watchMarkets,
                    totalTrades: perf.metrics?.totalTrades ?? 0,
                    winRate: perf.metrics?.winRate ?? 0,
                    realizedPnlUsd: perf.metrics?.realizedPnlUsd ?? 0,
                    avgPnlPerTrade: perf.metrics?.avgPnlPerTrade ?? 0,
                    largestWin: perf.metrics?.largestWin ?? 0,
                    largestLoss: perf.metrics?.largestLoss ?? 0,
                    source: 'pooter.world trading bot',
                  };
                } catch (err) {
                  result = {
                    error: `Trading API error: ${err instanceof Error ? err.message : 'unavailable'}`,
                  };
                }
                break;
              }

              case 'get_trading_signals': {
                try {
                  const data = await getTradingSignals();
                  result = {
                    signals: data.signals || [],
                    source: 'pooter.world trading bot',
                  };
                } catch (err) {
                  result = {
                    error: `Signals API error: ${err instanceof Error ? err.message : 'unavailable'}`,
                  };
                }
                break;
              }

              default:
                result = { error: `Unknown tool: ${toolUse.function.name}` };
            }

            toolResults.push({
              role: 'tool',
              tool_call_id: toolUse.id,
              content: JSON.stringify(result),
            });
          } catch (err) {
            toolResults.push({
              role: 'tool',
              tool_call_id: toolUse.id,
              content: JSON.stringify({
                error: err instanceof Error ? err.message : 'Tool execution failed',
              }),
            });
          }
        }

        // Continue conversation with tool results — OpenAI format
        messages.push({
          role: 'assistant',
          content: response.text,
          tool_calls: response.toolCalls,
        });
        messages.push(...toolResults);

        response = await hubChat({
          messages,
          system: systemPrompt,
          task: 'chat',
          maxTokens: 1024,
          temperature: 0.7,
          ...(isNounIrl ? { tools: nounIrlTools } : {}),
        });

        // Recover XML tool calls on continuation responses too
        patchXmlToolCalls(response);
      }

      let text = response.text || '';

      // If LLM returned empty, retry once with a nudge
      if (!text && !pendingAction) {
        try {
          messages.push({ role: 'assistant', content: '' });
          messages.push({ role: 'user', content: 'Please respond to my previous message.' });
          const retry = await hubChat({
            messages,
            system: systemPrompt,
            task: 'chat',
            maxTokens: 1024,
            temperature: 0.7,
          });
          text = retry.text || '';
        } catch {
          /* ignore retry failure */
        }
      }

      // If agent used tools but returned no text, provide a fallback
      if (!text && pendingAction) {
        text = 'Action prepared — confirm below. ⌐◨-◨';
      } else if (!text) {
        text = "Hmm, I'm having trouble responding right now. Try again? ⌐◨-◨";
      }

      // Include governance action if one was prepared by a tool
      const responsePayload: { response: string; action?: Record<string, unknown> } = {
        response: text,
      };
      if (pendingAction) {
        responsePayload.action = pendingAction;
      }
      return c.json(responsePayload);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('Terminal chat error:', errMsg);
      const friendlyError =
        agentMode === 'nounirl' && isUpstreamAiFailure(errMsg)
          ? NOUNIRL_PIPE_UNLOCK_MESSAGE
          : `AI request failed: ${errMsg}`;
      return c.json({ error: friendlyError }, 500);
    }
  });
}
