// ── City token: a small, pure supply / sinks / farm-resistance model ─────
//
// Not production code and not a contract. It exists so the numbers in
// ../token-design.md can be rerun and argued with. Plain TypeScript, no
// imports, no clock, no randomness: the same params always give the same
// output. Run it:
//
//   node --experimental-strip-types docs/strategy/model/run.ts
//   node --experimental-strip-types --test docs/strategy/model/token.test.ts
//
// Units are whole tokens (integers). Every split floors and sends the
// remainder somewhere named, so `checkConservation` can prove that nothing
// is created or lost: genesis supply = holders + pools + treasury + burned.
//
// What's grounded in the repo and what's assumed is listed in
// ../token-design.md §5. The short version: the COIN rates come from the
// game's own constants (trade/ledger.ts RULES, trade/upgrades.ts,
// exchange/engine/sim.ts STARTER_COIN, exchange/engine/book.ts FEE_BPS,
// noun-trade-contracts/SUPPLY.md's 600 COIN/day player assumption); the
// population, sell and spend rates are assumptions.

// ── Allocation ───────────────────────────────────────────────────────────

export type Bucket =
  | 'retro' // launch conversion of COIN / points (one snapshot)
  | 'play' // ongoing play rewards, weekly epochs
  | 'creators' // graffiti, voice, CC0, covers, maps: snapshot-attributed work
  | 'agents' // agent-economy bootstrapping (fee rebates, bonds matched)
  | 'treasury' // the city's treasury, governed + timelocked
  | 'liquidity' // protocol-owned liquidity on Base, LP locked
  | 'commons' // Nouns DAO treasury + CC0 commons grants
  | 'builders'; // the people building it, 1y cliff / 3y linear

/** Basis points per bucket. Must sum to 10_000. */
export const ALLOCATION_BPS: Record<Bucket, number> = {
  retro: 2_250,
  play: 2_500,
  creators: 1_250,
  agents: 500,
  treasury: 2_000,
  liquidity: 500,
  commons: 500,
  builders: 500,
};

export const TOTAL_SUPPLY = 1_000_000_000;

export function allocate(total: number, bps: Record<Bucket, number> = ALLOCATION_BPS) {
  const sum = Object.values(bps).reduce((a, b) => a + b, 0);
  if (sum !== 10_000) throw new Error(`allocation sums to ${sum} bps, not 10000`);
  const out = {} as Record<Bucket, number>;
  let given = 0;
  for (const k of Object.keys(bps) as Bucket[]) {
    out[k] = Math.floor((total * bps[k]) / 10_000);
    given += out[k];
  }
  out.treasury += total - given; // rounding dust goes to the treasury
  return out;
}

// ── Emission: weekly epochs, halving yearly ──────────────────────────────

/**
 * Split `pool` into `weeks` weekly amounts, each year emitting half the year
 * before (52-week years). The last week takes the rounding remainder, so the
 * schedule sums to `pool` exactly.
 */
export function emissionSchedule(pool: number, weeks: number, decayPerYear = 0.5): number[] {
  const w: number[] = [];
  let norm = 0;
  for (let i = 0; i < weeks; i++) {
    const f = decayPerYear ** Math.floor(i / 52);
    w.push(f);
    norm += f;
  }
  const out = w.map(f => Math.floor((pool * f) / norm));
  const used = out.reduce((a, b) => a + b, 0);
  if (weeks > 0) out[weeks - 1] += pool - used;
  return out;
}

// ── Activity and scoring ─────────────────────────────────────────────────

/**
 * One account's week, as the server would see it. `proved` means the server
 * can check it (run proofs for records, server-ledger COIN from world-trade,
 * graffiti attributed in a signed daily Base snapshot). Client-claimed
 * things (respect events today: the client sends them, the server re-scores
 * but can't witness most of them) are `claimed`.
 */
export interface WeekActivity {
  /** Distinct days with a real session (world-stats `days`, per rider). */
  activeDays: number;
  /** Server-ledger COIN earned this week, starter purses excluded. */
  coinEarned: number;
  /** Graffiti pieces attributed in that week's snapshots. */
  pieces: number;
  /** Pieces other players kept up / reacted to (the quality signal). */
  piecesKept: number;
  /** Proved record improvements (world-stats + runProof). */
  provedRecords: number;
  /** Respect tier at week end: 0 outcast … 4 legend (respect/rules.ts TIERS). */
  respectTier: number;
  /** Wallet linked via world-stats' signed `link`, and for how many weeks. */
  linkedWeeks: number;
  /** Agent trades settled for this account (agent economy, later). */
  agentTrades: number;
}

export interface ScoreRules {
  /** Gate: no score at all below these. */
  minActiveDays: number;
  minRespectTier: number;
  minLinkedWeeks: number;
  /** Concave: score grows with sqrt of each input, not linearly. */
  concave: boolean;
  /** Most points one account can take in a week. */
  weeklyCap: number;
  /** Need at least this many different kinds of activity for full score. */
  diversityKinds: number;
}

/** What a naive points program does: count everything, linearly, no gates. */
export const NAIVE_RULES: ScoreRules = {
  minActiveDays: 0,
  minRespectTier: 0,
  minLinkedWeeks: 0,
  concave: false,
  weeklyCap: Infinity,
  diversityKinds: 0,
};

/** The rules ../token-design.md proposes. */
export const DEFENDED_RULES: ScoreRules = {
  minActiveDays: 3,
  minRespectTier: 2, // local
  minLinkedWeeks: 2,
  concave: true,
  weeklyCap: 100,
  diversityKinds: 2,
};

const WEIGHTS = {
  day: 4,
  coin: 0.02, // 600 COIN/day regular ≈ 84 pts/week linear
  piece: 3,
  kept: 6,
  record: 8,
  agentTrade: 0.5,
};

export function score(a: WeekActivity, r: ScoreRules): number {
  if (a.activeDays < r.minActiveDays) return 0;
  if (a.respectTier < r.minRespectTier) return 0;
  if (a.linkedWeeks < r.minLinkedWeeks) return 0;
  const f = r.concave ? (x: number) => Math.sqrt(Math.max(0, x)) * 3 : (x: number) => x;
  const parts = [
    WEIGHTS.day * a.activeDays, // days are already bounded (≤ 7): stay linear
    f(WEIGHTS.coin * a.coinEarned),
    f(WEIGHTS.piece * a.pieces) + f(WEIGHTS.kept * a.piecesKept),
    f(WEIGHTS.record * a.provedRecords),
    f(WEIGHTS.agentTrade * a.agentTrades),
  ];
  const kinds = [a.coinEarned, a.pieces, a.provedRecords, a.agentTrades].filter(x => x > 0).length;
  let s = parts.reduce((x, y) => x + y, 0);
  if (kinds < r.diversityKinds) s *= 0.5;
  return Math.min(r.weeklyCap, s);
}

/** Split `pool` pro rata to scores (floored); the remainder is returned. */
export function distribute(pool: number, scores: number[]): { paid: number[]; rest: number } {
  const total = scores.reduce((a, b) => a + b, 0);
  if (total <= 0) return { paid: scores.map(() => 0), rest: pool };
  const paid = scores.map(s => Math.floor((pool * s) / total));
  return { paid, rest: pool - paid.reduce((a, b) => a + b, 0) };
}

// ── Archetypes ───────────────────────────────────────────────────────────

export interface Archetype {
  id: string;
  /** Genuine players vs farmers (for the split the model reports). */
  farmer: boolean;
  /** Accounts of this type in week 0, and weekly growth (0.02 = +2%/wk). */
  count: number;
  growth: number;
  week: WeekActivity;
  /** Share of fresh rewards sold straight away. */
  sellRate: number;
  /** Share of held balance spent in-game each week (cosmetics, rent, fees). */
  spendRate: number;
}

const wk = (o: Partial<WeekActivity>): WeekActivity => ({
  activeDays: 0,
  coinEarned: 0,
  pieces: 0,
  piecesKept: 0,
  provedRecords: 0,
  respectTier: 1,
  linkedWeeks: 10,
  agentTrades: 0,
  ...o,
});

/**
 * Population at the token gate (../growth-plan.md: ~2,000 weekly actives).
 * Today's real numbers are far below this (see token-design.md §5).
 */
export const ARCHETYPES: Archetype[] = [
  {
    id: 'casual',
    farmer: false,
    count: 1_400,
    growth: 0.01,
    week: wk({ activeDays: 2, coinEarned: 600, pieces: 1, respectTier: 1 }),
    sellRate: 0.3,
    spendRate: 0.1,
  },
  {
    id: 'regular',
    farmer: false,
    count: 450,
    growth: 0.015,
    week: wk({ activeDays: 5, coinEarned: 3_000, pieces: 4, piecesKept: 1, provedRecords: 1, respectTier: 3 }),
    sellRate: 0.25,
    spendRate: 0.15,
  },
  {
    id: 'creator',
    farmer: false,
    count: 150,
    growth: 0.015,
    week: wk({ activeDays: 4, coinEarned: 1_000, pieces: 20, piecesKept: 8, respectTier: 3 }),
    sellRate: 0.2,
    spendRate: 0.2,
  },
  {
    // One real person running a scripted trade loop on one account, all day.
    // World-trade's ledger is server-checked (travel time, rate limits), so
    // the COIN is "real", it's just not play.
    id: 'grinder-bot',
    farmer: true,
    count: 40,
    growth: 0.03,
    week: wk({ activeDays: 7, coinEarned: 40_000, respectTier: 2 }),
    sellRate: 1,
    spendRate: 0,
  },
  {
    // Many fresh accounts, each doing the minimum the program counts.
    id: 'sybil',
    farmer: true,
    count: 2_000,
    growth: 0.05,
    week: wk({ activeDays: 2, coinEarned: 300, pieces: 3, respectTier: 1, linkedWeeks: 1 }),
    sellRate: 1,
    spendRate: 0,
  },
];

// ── Simulation ───────────────────────────────────────────────────────────

export interface SimParams {
  weeks: number;
  rules: ScoreRules;
  archetypes?: Archetype[];
  /** In-game spend: share burned, share to the treasury; the rest to creators. */
  spendBurnBps: number;
  spendTreasuryBps: number;
  /** Agent economy: weekly token volume, fee, fee burn share (rest treasury). */
  agentVolumeWeekly: number;
  agentVolumeGrowth: number;
  agentFeeBps: number;
  agentFeeBurnBps: number;
  /** Creators bucket: weekly pro rata to creators' `pieces + 2·kept`, years. */
  creatorYears: number;
}

export const DEFAULT_PARAMS: SimParams = {
  weeks: 104,
  rules: DEFENDED_RULES,
  spendBurnBps: 5_000,
  spendTreasuryBps: 3_000,
  agentVolumeWeekly: 2_000_000,
  agentVolumeGrowth: 0.02,
  agentFeeBps: 50,
  agentFeeBurnBps: 5_000,
  creatorYears: 4,
};

export interface WeekRow {
  week: number;
  emitted: number;
  toPlayers: number;
  toFarmers: number;
  sold: number;
  burned: number;
  toTreasury: number;
  /** Tokens in archetype hands (not pools, treasury, burned). */
  held: number;
}

export interface SimResult {
  rows: WeekRow[];
  /** Share of play + creator rewards farmers took over the whole run. */
  farmerShare: number;
  totals: { emitted: number; burned: number; treasuryIn: number; sold: number };
  ledger: Ledger;
}

export interface Ledger {
  genesis: number;
  pools: Record<Bucket, number>;
  holders: Record<string, number>;
  burned: number;
}

export function checkConservation(l: Ledger): string[] {
  const pools = Object.values(l.pools).reduce((a, b) => a + b, 0);
  const held = Object.values(l.holders).reduce((a, b) => a + b, 0);
  const errs: string[] = [];
  for (const [k, v] of Object.entries(l.pools)) if (v < 0) errs.push(`pool ${k} < 0`);
  for (const [k, v] of Object.entries(l.holders)) if (v < 0) errs.push(`holder ${k} < 0`);
  if (pools + held + l.burned !== l.genesis)
    errs.push(`conservation: ${pools} + ${held} + ${l.burned} != ${l.genesis}`);
  return errs;
}

export function simulate(p: SimParams = DEFAULT_PARAMS): SimResult {
  const types = p.archetypes ?? ARCHETYPES;
  const pools = allocate(TOTAL_SUPPLY);
  const l: Ledger = { genesis: TOTAL_SUPPLY, pools: { ...pools }, holders: {}, burned: 0 };
  // Sold tokens go to a generic "market" holder (outside buyers).
  for (const t of types) l.holders[t.id] = 0;
  l.holders.market = 0;

  const play = emissionSchedule(pools.play, 4 * 52);
  const creators = emissionSchedule(pools.creators, p.creatorYears * 52);
  const rows: WeekRow[] = [];
  let farmTook = 0;
  let allTook = 0;
  const tot = { emitted: 0, burned: 0, treasuryIn: 0, sold: 0 };

  for (let w = 0; w < p.weeks; w++) {
    const counts = types.map(t => Math.round(t.count * (1 + t.growth) ** w));
    // Play rewards: pro rata to score × accounts.
    const playPool = Math.min(play[w] ?? 0, l.pools.play);
    const scores = types.map((t, i) => score(t.week, p.rules) * counts[i]);
    const pd = distribute(playPool, scores);
    // Creator rewards: pro rata to attributed work, gated like play.
    const crPool = Math.min(creators[w] ?? 0, l.pools.creators);
    const crScores = types.map((t, i) =>
      score(t.week, p.rules) > 0 ? (t.week.pieces + 2 * t.week.piecesKept) * counts[i] : 0,
    );
    const cd = distribute(crPool, crScores);
    l.pools.play -= playPool - pd.rest;
    l.pools.creators -= crPool - cd.rest;

    let toPlayers = 0;
    let toFarmers = 0;
    let sold = 0;
    let burned = 0;
    let toTreasury = 0;
    types.forEach((t, i) => {
      const got = pd.paid[i] + cd.paid[i];
      if (t.farmer) toFarmers += got;
      else toPlayers += got;
      l.holders[t.id] += got;
      // Sell a share of what just arrived.
      const s = Math.floor(got * t.sellRate);
      l.holders[t.id] -= s;
      l.holders.market += s;
      sold += s;
      // Spend a share of the balance in-game: burn / treasury / creators.
      const spend = Math.floor(l.holders[t.id] * t.spendRate);
      if (spend > 0) {
        l.holders[t.id] -= spend;
        const b = Math.floor((spend * p.spendBurnBps) / 10_000);
        const tr = Math.floor((spend * p.spendTreasuryBps) / 10_000);
        const cr = spend - b - tr;
        l.burned += b;
        l.pools.treasury += tr;
        l.holders.creator = (l.holders.creator ?? 0) + cr;
        burned += b;
        toTreasury += tr;
      }
    });
    // Agent fees, paid out of the market's float (outside buyers use agents).
    const vol = Math.floor(p.agentVolumeWeekly * (1 + p.agentVolumeGrowth) ** w);
    const fee = Math.min(l.holders.market, Math.floor((vol * p.agentFeeBps) / 10_000));
    if (fee > 0) {
      const b = Math.floor((fee * p.agentFeeBurnBps) / 10_000);
      l.holders.market -= fee;
      l.burned += b;
      l.pools.treasury += fee - b;
      burned += b;
      toTreasury += fee - b;
    }
    const emitted = toPlayers + toFarmers;
    farmTook += toFarmers;
    allTook += emitted;
    tot.emitted += emitted;
    tot.burned += burned;
    tot.treasuryIn += toTreasury;
    tot.sold += sold;
    const held = Object.values(l.holders).reduce((a, b) => a + b, 0);
    rows.push({ week: w, emitted, toPlayers, toFarmers, sold, burned, toTreasury, held });
  }
  return { rows, farmerShare: allTook > 0 ? farmTook / allTook : 0, totals: tot, ledger: l };
}

// ── Launch conversion (the retro snapshot) ──────────────────────────────

export interface RetroAccount {
  id: string;
  /** World-trade server ledger: earned (sales + serves), not granted. */
  tradeEarned: number;
  /** Grand Exchange equity minus its starter grant (≥ 0 counts). */
  exchangeGain: number;
  /** Respect tier at the snapshot (0..4). */
  respectTier: number;
  /** Proved records held (world-stats competition boards). */
  provedRecords: number;
  /** Graffiti pieces attributed in onchain snapshots before launch. */
  pieces: number;
  /** Distinct days played (world-stats). */
  activeDays: number;
  linked: boolean;
  /** Builders / staff accounts get nothing here (they have their own bucket). */
  staff?: boolean;
}

/** Most one account can take of the retro pool, bps. */
export const RETRO_CAP_BPS = 50; // 0.5%

export function retroPoints(a: RetroAccount): number {
  if (!a.linked || a.staff || a.activeDays < 3) return 0;
  const coin = Math.sqrt(Math.max(0, a.tradeEarned) + Math.max(0, a.exchangeGain));
  return (
    coin + // 10k COIN → 100 pts, 1M → 1,000: farming COIN 100× gets 10×
    25 * Math.max(0, a.respectTier - 1) + // local 25, regular 50, legend 75
    40 * Math.sqrt(a.provedRecords) +
    15 * Math.sqrt(a.pieces) +
    10 * Math.sqrt(a.activeDays)
  );
}

/**
 * Convert the snapshot into tokens: pro rata to points, each account capped
 * at RETRO_CAP_BPS of the pool; anything the cap or the gates leave unspent
 * returns to the play pool (it isn't burned and nobody keeps it).
 */
export function retroConvert(pool: number, accounts: RetroAccount[]) {
  const cap = Math.floor((pool * RETRO_CAP_BPS) / 10_000);
  const pts = accounts.map(retroPoints);
  const paid = accounts.map(() => 0);
  let open = accounts.map((_, i) => i).filter(i => pts[i] > 0);
  let left = pool;
  // Water-fill: pay pro rata, clip at the cap, redistribute among the rest.
  while (open.length > 0 && left > 0) {
    const total = open.reduce((s, i) => s + pts[i], 0);
    let clipped = false;
    let spent = 0;
    for (const i of open) {
      const share = Math.floor((left * pts[i]) / total);
      const give = Math.min(share, cap - paid[i]);
      if (give < share) clipped = true;
      paid[i] += give;
      spent += give;
    }
    left -= spent;
    open = open.filter(i => paid[i] < cap);
    if (!clipped || spent === 0) break;
  }
  return { paid, toPlay: pool - paid.reduce((a, b) => a + b, 0) };
}

// ── In-game COIN today (grounding) ──────────────────────────────────────

/** Constants copied from the game; tests check they still match the source. */
export const COIN_FACTS = {
  tradeStarter: 150, // trade/ledger.ts RULES.STARTER_COIN
  exchangeStarter: 500, // exchange/engine/sim.ts STARTER_COIN
  exchangeFeeBps: 100, // exchange/engine/book.ts FEE_BPS (seller pays, to treasury)
  upgradesTotal: 120 + 200 + 300 + 500 + 800 + 2_500, // trade/upgrades.ts, one-off
  maxSpendPerAction: 100, // trade/ledger.ts RULES.MAX_SPEND
  regularProfitPerDay: 600, // noun-trade-contracts/SUPPLY.md assumption, unmeasured
};

/**
 * Days until a regular player has bought every van upgrade and COIN has no
 * sink left but goods, melt and building spends: after that, COIN is pure
 * inflation, which is why it can't convert 1:1.
 */
export const daysToExhaustSinks = () =>
  Math.ceil((COIN_FACTS.upgradesTotal - COIN_FACTS.tradeStarter) / COIN_FACTS.regularProfitPerDay);
