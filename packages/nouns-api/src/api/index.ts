import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { db } from 'ponder:api';

import { initAgent } from '../agent/index.js';
import { startSyncWatchdog } from '../syncWatchdog.js';

import { registerActivityRoutes } from './activityFeed.js';
import { registerDreamRoutes } from './dreams.js';
import { checkDashboardKey } from './lib/dashboardAuth.js';
import { metricsMiddleware } from './metrics.js';
import { registerPageviewRoutes } from './pageviews.js';
import { registerAgentRoutes } from './routes/agent.js';
import { registerAuctionStatsRoutes } from './routes/auctionStats.js';
import { registerChatRoutes } from './routes/chat/index.js';
import { registerEnsRoutes } from './routes/ens.js';
import { registerFarcasterRoutes } from './routes/farcaster.js';
import { registerFeedRoutes } from './routes/feed.js';
import { registerGasLeaderboardRoutes } from './routes/gasLeaderboard.js';
import { registerGovernanceRoutes } from './routes/governance.js';
import { registerGrantProposeRoutes, registerGrantRoutes } from './routes/grants.js';
import { registerGraphqlRoutes } from './routes/graphql.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerImageRoutes } from './routes/images.js';
import { registerLilNounsRoutes } from './routes/lilNouns.js';
import { registerNounsRoutes } from './routes/nouns.js';
import { registerNounV2Routes } from './routes/nounV2.js';
import { registerOnchainFeedRoutes } from './routes/onchainFeed.js';
import { registerPip3Routes } from './routes/pip3.js';
import { registerPredictionRoutes } from './routes/predictions.js';
import { registerSketchRoutes } from './routes/sketch.js';
import { registerTreasuryRoutes } from './routes/treasury.js';
import { registerSettlerRoutes } from './settlerMaps.js';
import { registerWalletMapRoute } from './walletMap.js';
import { registerWalletProfileRoutes } from './walletProfile.js';

// Previously exported from this module; kept so the module surface is unchanged.
export {
  expandProposalTransactions,
  type ProposalTxInput,
  type ProposalTxPrimitive,
  type RawProposalTx,
} from './routes/chat/proposalTx.js';

const app = new Hono();

// Initialize Agent NounIRL (non-blocking — starts block watcher in background)
try {
  initAgent();
} catch (err) {
  console.error('[NounIRL] Agent init failed (non-fatal):', err);
}

// Exit (→ Railway restart) if Ponder's sync freezes while HTTP stays up.
startSyncWatchdog();

// CORS — allow noun.wtf and localhost
app.use(
  '*',
  cors({
    origin: [
      'https://noun.wtf',
      'https://dev-noun-wtf.netlify.app',
      'http://localhost:5173',
      'http://localhost:3000',
    ],
    allowMethods: ['GET', 'POST', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Accept'],
  }),
);

// Request metrics
app.use('*', metricsMiddleware);

// ─── Routes ─────────────────────────────────────────────────────────────────
// Registration order matches the pre-split index.ts exactly (Hono matches in
// registration order). Each module lives under ./routes/ (shared helpers in ./lib/).
registerGraphqlRoutes(app); // GraphQL (Ponder) at / and /graphql, with derived proposal status
registerGovernanceRoutes(app); // /api/proposals, /api/candidates
registerGrantRoutes(app); // GET /api/grants
registerNounV2Routes(app); // /api/nounv2-proposals, /api/nounv2-auctions, /api/nounv2-auction
registerLilNounsRoutes(app); // /api/lil-proposals
registerPip3Routes(app); // /api/pip3-gifs
registerAuctionStatsRoutes(app); // /api/auction-stats
registerPredictionRoutes(app); // /api/predictions/markets
registerGrantProposeRoutes(app); // POST /api/grants/propose
registerChatRoutes(app); // POST /api/chat
registerFeedRoutes(app); // /api/feed/:channel
registerSketchRoutes(app); // /api/sketch/latest
registerTreasuryRoutes(app); // /api/treasury/flows
registerAgentRoutes(app); // /api/agent/*

// ─── Activity Feed ──────────────────────────────────────────────────────────
// GET /api/activity + /api/nounv2-feed — see ./activityFeed.ts for the source
// registry, post-processors and the event-type contract.
registerActivityRoutes(app);

registerImageRoutes(app); // /api/ascii-image, /api/og/proposal/:id, /api/trait-preview
registerEnsRoutes(app); // /api/ens
registerOnchainFeedRoutes(app); // /api/onchain-feed
registerNounsRoutes(app); // /api/nouns/seeds, /api/noun-holders
registerFarcasterRoutes(app); // /api/farcaster/*
registerHealthRoutes(app); // /api/health, /api/stats, /api/stats/errors, /api/stats/health
registerGasLeaderboardRoutes(app); // /api/gas-leaderboard

// ─── Wallet Explorer — /api/wallet-map/:identity ────────────────────────────
// Identity-graph endpoint that powers /explore/wallet on the frontend.
// See ./walletMap.ts for the full pipeline.
registerWalletMapRoute(app, db);

// ─── Gamer profile — /api/wallet/:identity/{profile,activity,overview,autopilot}
// Per-wallet Nouns record + AI overview + signed Autopilot voting prefs.
// See ./walletProfile.ts.
registerWalletProfileRoutes(app, db);

// Settler / curator maps — single source for probe dropdowns + gamer profile.
registerSettlerRoutes(app, db);

// ─── Dream Nouns — /api/dream-nouns ─────────────────────────────────────────
// Replaces the Laravel API from the retired probe.wtf DigitalOcean droplet.
registerDreamRoutes(app);

// Site pageview beacon + dashboard traffic stats (replaces the Plausible proxy)
registerPageviewRoutes(app, checkDashboardKey);

export default app;
