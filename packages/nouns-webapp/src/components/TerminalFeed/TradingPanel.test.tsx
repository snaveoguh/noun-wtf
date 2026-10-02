import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import TradingPanel from './TradingPanel';

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

const fixtures: Record<string, unknown> = {
  '/pooter-api/trading/positions': {
    positions: [
      {
        id: 'a',
        symbol: 'ETH',
        venue: 'hyperliquid',
        direction: 'long',
        status: 'open',
        entryPriceUsd: 3000,
        entryNotionalUsd: 500,
        unrealizedPnlUsd: 25,
      },
      { id: 'b', symbol: 'SOL', direction: 'short', status: 'closed', realizedPnlUsd: 100 },
    ],
    parallel: [
      {
        runnerId: 'r2',
        label: 'degen',
        positions: [
          { id: 'c', symbol: 'PEPE', direction: 'long', status: 'closed', realizedPnlUsd: -40 },
        ],
      },
    ],
  },
  '/pooter-api/trading/performance': {
    accountValueUsd: 1234.5,
    openPositionCount: 1,
    watchMarkets: ['ETH'],
    metrics: { totalTrades: 2, winRate: 50, realizedPnlUsd: 60, largestWin: 100, largestLoss: -40 },
  },
  '/pooter-api/trading/signals': {
    signals: [{ symbol: 'ETH', direction: 'bullish', confidence: 0.8 }],
  },
};

afterEach(() => vi.unstubAllGlobals());

describe('TradingPanel', () => {
  it('shows per-agent earnings from the pooter.world API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => Promise.resolve(json(fixtures[url]))),
    );
    render(
      <QueryClientProvider client={new QueryClient()}>
        <TradingPanel />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText('degen')).toBeTruthy());
    expect(screen.getByText('$1,234.50')).toBeTruthy();
    // main agent: +100 realized + 25 unrealized
    expect(screen.getByText('+$125.00')).toBeTruthy();
    expect(screen.getAllByText('-$40.00').length).toBeGreaterThan(0);
    expect(screen.getByText(/hyperliquid/)).toBeTruthy();
  });

  it('says so when the bot is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('<html>', { status: 502 }))),
    );
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <TradingPanel />
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByText(/trading bot unreachable/)).toBeTruthy());
  });
});
