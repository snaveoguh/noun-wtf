import type { Hono } from 'hono';

import { MIN_NOUNS_FOR_DEPLOY, type WatchedDao } from '../../agent/constants.js';
import {
  applyAndDeploy,
  batchLearn,
  buildPeopleDb,
  canDeploy,
  checkNow,
  generatePatch,
  getAgentBalance,
  getGasBudget,
  getAllTraitNames,
  getBuildStatus,
  getDeployHistory,
  getKnowledgeStats,
  getPeopleCount,
  getPerson,
  getRecentTraitChanges,
  getTraitCountsSnapshot,
  getWatcherState,
  isBridgeConfigured,
  listPeople,
  parseTraitDescription,
  reservationStore,
  runSelfLearn,
  searchPeople,
  settleAuction,
  verifyTip,
} from '../../agent/index.js';
import { getNounBalance } from '../lib/chain.js';

export function registerAgentRoutes(app: Hono) {
  // ============================================================
  // Agent NounIRL — API Endpoints
  // ============================================================

  // ── Agent Predict (fast — no auth, no Claude, ~1ms) ─────────────────────
  // The watcher runs BOTH DAOs off one block feed, so `?dao=v1|v2` selects that
  // DAO's NATIVE cached prediction — its own nextNounId, auction end and seed.
  // (The old cross-DAO "recompute under the other DAO's seeder rules" hack is
  // gone; every response is a real prediction of that DAO's next noun.)
  // Default dao is v1, matching the main-site consumers.
  app.get('/api/agent/predict', c => {
    const w = getWatcherState();
    const q = c.req.query('dao');
    const dao: WatchedDao = q === 'v2' ? 'v2' : 'v1';
    const d = w.daos[dao];

    return c.json({
      block: w.lastBlockNumber,
      nextNounId: d.nextNounId,
      seed: d.lastPredictedSeed,
      traits: d.lastPredictedTraits,
      auctionEnd: d.auctionEndTime,
      auctionEnded: d.auctionEndTime > 0 && Math.floor(Date.now() / 1000) >= d.auctionEndTime,
      running: w.running,
      checkedAt: w.lastCheckedAt,
      dao,
      // Back-compat for clients that still read the single-DAO-era field.
      watchedDao: dao,
      crossDao: false,
    });
  });

  // ── Agent Status ────────────────────────────────────────────────────────
  // One watcher, both DAOs: `daos.v1` / `daos.v2` carry each DAO's own
  // prediction, auction state, standing targets and trait counts. The legacy
  // top-level fields (nextNounId, predictedTraits, …) mirror V1 for
  // pre-dual-DAO consumers.
  app.get('/api/agent/status', async c => {
    const watcherState = getWatcherState();
    const stats = reservationStore.stats();
    let balance = 0;
    try {
      balance = await getAgentBalance();
    } catch {
      /* ok */
    }

    const daoSection = (dao: WatchedDao) => {
      const d = watcherState.daos[dao];
      const counts = getTraitCountsSnapshot(dao);
      return {
        dao,
        auctionHouse: d.auctionHouse,
        token: d.token,
        nextNounId: d.nextNounId,
        auctionEndTime: d.auctionEndTime,
        predictedSeed: d.lastPredictedSeed,
        predictedTraits: d.lastPredictedTraits,
        standingTraits: d.standingTraits,
        activeReservations: d.activeReservations,
        traitCounts: {
          counts: counts.counts,
          source: counts.source,
          descriptor: counts.descriptor,
          fetchedAt: counts.fetchedAt,
        },
      };
    };

    const v1 = daoSection('v1');

    return c.json({
      agent: 'NounIRL',
      wallet: process.env.NOUNIRL_ADDRESS || 'not configured',
      running: watcherState.running,
      transport: watcherState.transportMode,
      lastBlock: watcherState.lastBlockNumber,
      // Legacy top-level fields — mirror V1 (main DAO). Use `daos` for both.
      nextNounId: v1.nextNounId,
      auctionEndTime: v1.auctionEndTime,
      predictedSeed: v1.predictedSeed,
      predictedTraits: v1.predictedTraits,
      lastCheckedAt: watcherState.lastCheckedAt,
      totalBlocksChecked: watcherState.totalBlocksChecked,
      errors: watcherState.errors.slice(-5),
      standingTraits: watcherState.standingTraits,
      settleGuard: watcherState.settleGuard,
      settleGas: watcherState.settleGas,
      balanceEth: Math.round(balance * 10000) / 10000,
      // How many settles the balance pays for vs the reservations waiting.
      gasBudget: await getGasBudget().catch(() => null),
      reservations: stats,
      recentSettleAttempts: reservationStore.getRecentSettleAttempts(),
      canDeploy: canDeploy(),
      bridge: isBridgeConfigured() ? 'connected' : 'not configured',
      traitCounts: v1.traitCounts,
      recentTraitChanges: getRecentTraitChanges(),
      daos: {
        v1,
        v2: daoSection('v2'),
      },
    });
  });

  // ── Create Reservation ──────────────────────────────────────────────────
  app.post('/api/agent/reserve', async c => {
    try {
      const body = await c.req.json();
      const { wallet, txHash, chainId, traits, settleFor, dao } = body as {
        wallet: string;
        txHash: string;
        chainId: number;
        traits: string[];
        settleFor?: string;
        dao?: string;
      };

      // Validate inputs
      if (
        !wallet ||
        !txHash ||
        !chainId ||
        !traits ||
        !Array.isArray(traits) ||
        traits.length === 0
      ) {
        return c.json({ error: 'Missing required fields: wallet, txHash, chainId, traits[]' }, 400);
      }
      if (dao !== undefined && dao !== 'v1' && dao !== 'v2') {
        return c.json({ error: "Invalid dao — must be 'v1' or 'v2'" }, 400);
      }

      // Check if tx already used
      if (reservationStore.isTxUsed(txHash)) {
        return c.json({ error: 'This transaction has already been used for a reservation' }, 409);
      }

      // Create reservation (pending verification)
      const reservation = reservationStore.create({
        wallet,
        tipTxHash: txHash,
        tipChainId: chainId,
        tipAmountEth: 0, // will be updated after verification
        traits,
        dao: dao === 'v2' ? 'v2' : 'v1',
        settleFor,
      });

      const gasBudget = await getGasBudget().catch(() => null);

      // Verify tip asynchronously (don't block the response)
      verifyTip(txHash, chainId)
        .then(result => {
          if (result.valid) {
            // Update amount and activate
            const r = reservationStore.get(reservation.id);
            if (r) {
              // Persist tip amount to Postgres before activating — a plain
              // `r.tipAmountEth = ...` would only mutate memory and the value
              // would be lost on next deploy.
              reservationStore.setTipAmount(reservation.id, result.amountEth || 0);
              reservationStore.activate(reservation.id);
              console.log(
                `[NounIRL] ✅ Reservation ${reservation.id} verified and activated — ${result.amountEth} ETH from ${result.chainName}`,
              );
            }
          } else {
            console.log(
              `[NounIRL] ❌ Tip verification failed for ${reservation.id}: ${result.error}`,
            );
            reservationStore.cancel(reservation.id);
          }
        })
        .catch(err => {
          console.error(`[NounIRL] Tip verification error for ${reservation.id}:`, err);
        });

      return c.json({
        reservation: {
          id: reservation.id,
          status: reservation.status,
          traits: reservation.traits,
          dao: reservation.dao,
          message: 'Reservation created — verifying tip transaction...',
          // Gas isn't ring-fenced per reservation: say so when the settle
          // wallet can't cover everything waiting (this one included).
          gasWarning: gasBudget?.short ? gasBudget.summary : null,
        },
      });
    } catch (err) {
      console.error('[NounIRL] Reserve error:', err);
      return c.json({ error: 'Failed to create reservation' }, 500);
    }
  });

  // ── List Reservations ───────────────────────────────────────────────────
  app.get('/api/agent/reservations', c => {
    const wallet = c.req.query('wallet');
    const reservations = wallet ? reservationStore.getByWallet(wallet) : reservationStore.getAll();

    return c.json({ reservations });
  });

  // ── Cancel Reservation ──────────────────────────────────────────────────
  app.post('/api/agent/cancel/:id', c => {
    const id = c.req.param('id');
    const reservation = reservationStore.get(id);

    if (!reservation) {
      return c.json({ error: 'Reservation not found' }, 404);
    }

    reservationStore.cancel(id);
    return c.json({ success: true, message: 'Reservation cancelled' });
  });

  // ── Backfill tipAmountEth for reservations stored as 0 ──────────────────
  // One-shot: walks every reservation with tipAmountEth === 0, fetches the
  // underlying tx on the correct chain, reads tx.value, and persists. Safe to
  // re-run — no-ops on rows that already have a positive amount.
  app.post('/api/agent/backfill-tip-amounts', async c => {
    try {
      const { createPublicClient, http, formatEther } = await import('viem');
      const viemChains = await import('viem/chains');
      const { SUPPORTED_CHAINS } = await import('../../agent/constants.js');

      // viem's per-chain types are uniquely narrowed; cast to a common shape so
      // a single Record can hold them.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const chains: Record<number, any> = {
        1: viemChains.mainnet,
        8453: viemChains.base,
        10: viemChains.optimism,
        42161: viemChains.arbitrum,
        7777777: viemChains.zora,
      };

      const all = reservationStore.getAll();
      const candidates = all.filter(r => !r.tipAmountEth || r.tipAmountEth === 0);

      const results: Array<{
        id: string;
        txHash: string;
        chainId: number;
        before: number;
        after?: number;
        error?: string;
      }> = [];

      for (const r of candidates) {
        const chain = chains[r.tipChainId];
        const cfg = SUPPORTED_CHAINS[r.tipChainId];
        if (!chain || !cfg) {
          results.push({
            id: r.id,
            txHash: r.tipTxHash,
            chainId: r.tipChainId,
            before: r.tipAmountEth,
            error: `Unsupported chain ${r.tipChainId}`,
          });
          continue;
        }
        try {
          const client = createPublicClient({ chain, transport: http(cfg.rpc) });
          const tx = await client.getTransaction({ hash: r.tipTxHash as `0x${string}` });
          const amount = Number(formatEther(tx.value));
          if (amount > 0) {
            reservationStore.setTipAmount(r.id, amount);
          }
          results.push({
            id: r.id,
            txHash: r.tipTxHash,
            chainId: r.tipChainId,
            before: r.tipAmountEth,
            after: amount,
          });
        } catch (err) {
          results.push({
            id: r.id,
            txHash: r.tipTxHash,
            chainId: r.tipChainId,
            before: r.tipAmountEth,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const updated = results.filter(x => x.after && x.after > 0).length;
      return c.json({
        success: true,
        scanned: candidates.length,
        updated,
        results,
      });
    } catch (err) {
      console.error('[NounIRL] Backfill error:', err);
      return c.json(
        { success: false, error: err instanceof Error ? err.message : String(err) },
        500,
      );
    }
  });

  // ── Manual Check ────────────────────────────────────────────────────────
  app.post('/api/agent/check', async c => {
    try {
      const result = await checkNow();
      return c.json(result);
    } catch (err) {
      console.error('[NounIRL] Manual check error:', err);
      return c.json({ error: 'Check failed' }, 500);
    }
  });

  // ── Trait Info ───────────────────────────────────────────────────────────
  app.get('/api/agent/traits/:category', c => {
    const category = c.req.param('category') as
      | 'background'
      | 'body'
      | 'accessory'
      | 'head'
      | 'glasses';
    const validCategories = ['background', 'body', 'accessory', 'head', 'glasses'];

    if (!validCategories.includes(category)) {
      return c.json({ error: `Invalid category. Valid: ${validCategories.join(', ')}` }, 400);
    }

    const dao: WatchedDao = c.req.query('dao') === 'v2' ? 'v2' : 'v1';
    const names = getAllTraitNames(category, dao);
    return c.json({ category, dao, count: names.length, traits: names });
  });

  // ── Parse Natural Language Traits ───────────────────────────────────────
  app.post('/api/agent/parse-traits', async c => {
    try {
      const body = await c.req.json();
      const { description } = body as { description: string };
      if (!description) return c.json({ error: 'description is required' }, 400);

      const parsed = parseTraitDescription(description);
      return c.json({ description, parsed });
    } catch {
      return c.json({ error: 'Failed to parse traits' }, 500);
    }
  });

  // ── Manual Settlement (crystal ball twin-snipe) ────────────────────────
  // `?dao=v1|v2` (or JSON body {dao}) picks which DAO's auction to settle;
  // defaults to v1.
  app.post('/api/agent/settle', async c => {
    const w = getWatcherState();
    if (!w.running) {
      return c.json({ error: 'Watcher not running' }, 503);
    }
    let bodyDao: string | undefined;
    try {
      const body = (await c.req.json()) as { dao?: string };
      bodyDao = body?.dao;
    } catch {
      /* no body is fine */
    }
    const rawDao = c.req.query('dao') ?? bodyDao;
    const dao: WatchedDao = rawDao === 'v2' ? 'v2' : 'v1';
    const d = w.daos[dao];
    if (!d.auctionEndTime || Date.now() / 1000 < d.auctionEndTime) {
      return c.json({ error: `${dao} auction not ended yet` }, 400);
    }
    try {
      const result = await settleAuction(dao);
      if (!result) {
        return c.json({ error: 'Settlement failed — wallet not configured or tx error' }, 500);
      }
      return c.json({ txHash: result.txHash, dao });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 500);
    }
  });

  // ── Settlement History ──────────────────────────────────────────────────
  app.get('/api/agent/settlements', c => {
    const limit = Number(c.req.query('limit') || 20);
    const settlements = reservationStore.getSettlements(limit);
    return c.json({ settlements });
  });

  // ── Deploy History ──────────────────────────────────────────────────────
  app.get('/api/agent/deploys', c => {
    const limit = Number(c.req.query('limit') || 20);
    const deploys = getDeployHistory(limit);
    return c.json({ deploys, canDeploy: canDeploy() });
  });

  // ── Trigger Deploy (manual, Noun-gated) ─────────────────────────────────
  app.post('/api/agent/deploy', async c => {
    try {
      const body = await c.req.json();
      const {
        description,
        reason,
        wallet: deployWallet,
      } = body as { description: string; reason?: string; wallet?: string };
      if (!description) return c.json({ error: 'description is required' }, 400);

      // Noun-gated: require connected wallet with 4+ Nouns
      if (!deployWallet) {
        return c.json(
          { error: `Deploy requires a connected wallet holding ≥ ${MIN_NOUNS_FOR_DEPLOY} Nouns.` },
          403,
        );
      }
      const nounBalance = await getNounBalance(deployWallet);
      if (nounBalance < MIN_NOUNS_FOR_DEPLOY) {
        return c.json(
          {
            error: `Deploy requires ≥ ${MIN_NOUNS_FOR_DEPLOY} Nouns. Wallet holds ${nounBalance}.`,
          },
          403,
        );
      }

      if (!canDeploy()) {
        return c.json({ error: 'Rate limited — max 1 deploy per hour' }, 429);
      }

      console.log(`[NounIRL] Deploy authorized by ${deployWallet} (${nounBalance} Nouns)`);

      // Generate patches via Claude
      const patches = await generatePatch(description);

      // Apply and deploy
      const result = await applyAndDeploy(
        patches,
        description,
        reason ||
          `manual deploy via API (authorized by ${deployWallet.slice(0, 6)}...${deployWallet.slice(-4)}, ${nounBalance} Nouns)`,
        'terminal',
      );

      return c.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Deploy failed';
      return c.json({ error: msg }, 500);
    }
  });

  // ── Knowledge Ingestion ──────────────────────────────────────────────────
  app.post('/api/agent/learn', async c => {
    try {
      const body = await c.req.json();
      const { urls } = body as { urls?: string[] };

      if (!urls || !Array.isArray(urls) || urls.length === 0) {
        return c.json({ error: 'urls array is required' }, 400);
      }

      if (urls.length > 20) {
        return c.json({ error: 'Max 20 URLs per batch' }, 400);
      }

      // Validate all URLs
      for (const url of urls) {
        try {
          new URL(url);
        } catch {
          return c.json({ error: `Invalid URL: ${url}` }, 400);
        }
      }

      const results = await batchLearn(urls);
      const totalFacts = results.reduce((sum, r) => sum + r.factsLearned, 0);

      return c.json({
        success: true,
        totalFacts,
        results,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Learning failed';
      return c.json({ error: msg }, 500);
    }
  });

  app.get('/api/agent/knowledge', async c => {
    try {
      const stats = await getKnowledgeStats();
      return c.json(stats);
    } catch {
      return c.json({ totalFacts: 0, sources: [] });
    }
  });

  // ─── Self-Learning: Read our own Ponder data ─────────────────────────────────

  app.post('/api/agent/self-learn', async c => {
    try {
      // This is a long-running operation — run it in background and return immediately
      const startTime = Date.now();

      // Kick off the pipeline (non-blocking)
      runSelfLearn()
        .then(result => {
          console.log(
            `[SelfLearn] Pipeline finished in ${((Date.now() - startTime) / 1000).toFixed(0)}s:`,
            JSON.stringify(result),
          );
        })
        .catch(err => {
          console.error('[SelfLearn] Pipeline failed:', err);
        });

      return c.json({
        success: true,
        message:
          'Self-learning pipeline started. Processing proposals, auctions, and delegates from noun.wtf Ponder index. This takes a few minutes.',
        startedAt: new Date().toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 500);
    }
  });

  // ─── People Database ─────────────────────────────────────────────────────────

  app.get('/api/agent/people', async c => {
    try {
      const limit = parseInt(c.req.query('limit') || '50', 10);
      const offset = parseInt(c.req.query('offset') || '0', 10);
      const sort = c.req.query('sort') || 'votes';
      const tag = c.req.query('tag') || undefined;

      const result = await listPeople({ limit, offset, sort, tag });
      return c.json(result);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 500);
    }
  });

  app.get('/api/agent/people/search', async c => {
    try {
      const q = c.req.query('q');
      if (!q) return c.json({ error: 'Missing ?q= parameter' }, 400);
      const limit = parseInt(c.req.query('limit') || '20', 10);
      const results = await searchPeople(q, limit);
      return c.json({ results, count: results.length });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 500);
    }
  });

  app.get('/api/agent/people/stats', async c => {
    try {
      const count = await getPeopleCount();
      const status = getBuildStatus();
      return c.json({ count, build: status });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 500);
    }
  });

  app.get('/api/agent/people/:address', async c => {
    try {
      const address = c.req.param('address');
      const person = await getPerson(address);
      if (!person) return c.json({ error: 'Person not found' }, 404);
      return c.json(person);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 500);
    }
  });

  app.post('/api/agent/people/build', async c => {
    try {
      const status = getBuildStatus();
      if (status.running) {
        return c.json(
          {
            success: false,
            message: 'Build already in progress',
            progress: status.progress,
          },
          409,
        );
      }

      const startTime = Date.now();

      // Kick off in background (non-blocking)
      buildPeopleDb()
        .then(result => {
          console.log(
            `[PeopleDb] Build finished in ${((Date.now() - startTime) / 1000).toFixed(0)}s:`,
            JSON.stringify(result),
          );
        })
        .catch(err => {
          console.error('[PeopleDb] Build failed:', err);
        });

      return c.json({
        success: true,
        message:
          'People database build started. This crawls all proposals, votes, auctions, bids, delegates, and streams, resolves ENS, and generates summaries. May take 10-30 minutes.',
        startedAt: new Date().toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return c.json({ error: msg }, 500);
    }
  });
}
