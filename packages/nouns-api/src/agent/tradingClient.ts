// ─── Pooter.world Trading Bot Client ──────────────────────────────────────────
//
// Allows NounIRL to query the morality.network trading engine
// (positions, performance, signals) and optionally trigger trades.

const POOTER_API_URL = process.env.POOTER_API_URL || 'https://pooter.world';
const POOTER_CRON_SECRET = process.env.POOTER_CRON_SECRET || '';

// ── Read-only endpoints (no auth required) ───────────────────────────────────

export interface TradingPosition {
  id: string;
  venue: string;
  tokenAddress?: string;
  symbol?: string;
  direction: 'long' | 'short';
  status: 'open' | 'closed';
  entryPriceUsd: number;
  entryNotionalUsd: number;
  currentPriceUsd?: number;
  moralScore?: number;
  moralJustification?: string;
  openedAt: number;
  closedAt?: number;
  realizedPnlUsd?: number;
  unrealizedPnlUsd?: number;
}

export interface TradingPerformance {
  timestamp: number;
  accountValueUsd: number | null;
  openPositionCount: number;
  watchMarkets: string[];
  metrics: {
    totalTrades: number;
    winRate: number;
    realizedPnlUsd: number;
    avgPnlPerTrade: number;
    largestWin: number;
    largestLoss: number;
  };
}

export interface TradingSignal {
  symbol: string;
  direction: 'bullish' | 'bearish' | 'neutral';
  confidence: number;
  sources: string[];
}

async function pooterFetch<T>(path: string, auth = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (auth && POOTER_CRON_SECRET) {
    headers.authorization = `Bearer ${POOTER_CRON_SECRET}`;
  }

  const res = await fetch(`${POOTER_API_URL}${path}`, {
    headers,
    signal: AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`pooter.world ${path} returned ${res.status}: ${body.slice(0, 200)}`);
  }

  return res.json() as Promise<T>;
}

/** Fetch open/all trading positions */
export async function getPositions(openOnly = true) {
  const data = await pooterFetch<{
    positions: TradingPosition[];
    parallel?: Array<{ runnerId: string; label: string; positions: TradingPosition[] }>;
    config?: Record<string, unknown>;
  }>(`/api/trading/positions${openOnly ? '?openOnly=1' : ''}`);
  return data;
}

/** Fetch trading performance metrics */
export async function getPerformance() {
  return pooterFetch<TradingPerformance>('/api/trading/performance');
}

/** Fetch aggregated market signals */
export async function getSignals() {
  return pooterFetch<{ signals: TradingSignal[] }>('/api/trading/signals');
}

/** Fetch trade journal (P&L per trade) */
export async function getJournal(limit = 20) {
  return pooterFetch<{ entries: Array<Record<string, unknown>> }>(
    `/api/trading/journal?limit=${limit}`,
  );
}

// ── Write endpoints (requires CRON_SECRET) ───────────────────────────────────

/** Trigger a trading cycle (requires POOTER_CRON_SECRET) */
export async function triggerTradeCycle() {
  if (!POOTER_CRON_SECRET) {
    return { error: 'POOTER_CRON_SECRET not configured — cannot trigger trades' };
  }
  return pooterFetch<Record<string, unknown>>('/api/trading/execute', true);
}

/** Check if the trading client is configured */
export function isTradingConfigured(): boolean {
  return POOTER_API_URL !== 'http://localhost:3000';
}

/** Check if trade execution is enabled (has cron secret) */
export function isTradingExecutionEnabled(): boolean {
  return Boolean(POOTER_CRON_SECRET);
}
