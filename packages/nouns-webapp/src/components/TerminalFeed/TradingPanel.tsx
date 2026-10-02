import { useMemo, type CSSProperties } from 'react';

import { useQuery } from '@tanstack/react-query';

// Read-only view of the pooter.world trading agents. Requests go through the
// Netlify proxy `/pooter-api/*` → `https://pooter.world/api/*` (public/_redirects,
// mirrored in vite.config.ts for local dev) so the browser never needs CORS
// from pooter.world. Nothing here can place or trigger a trade.
const POOTER_API = '/pooter-api/trading';
const REFRESH_MS = 30_000;

interface Position {
  id: string;
  venue?: string;
  symbol?: string;
  direction?: 'long' | 'short';
  status?: 'open' | 'closed';
  entryPriceUsd?: number;
  entryNotionalUsd?: number;
  currentPriceUsd?: number;
  moralScore?: number;
  openedAt?: number;
  closedAt?: number;
  realizedPnlUsd?: number;
  unrealizedPnlUsd?: number;
}

interface PositionsResponse {
  positions?: Position[];
  parallel?: Array<{ runnerId: string; label?: string; positions?: Position[] }>;
}

interface PerformanceResponse {
  accountValueUsd?: number | null;
  openPositionCount?: number;
  watchMarkets?: string[];
  metrics?: {
    totalTrades?: number;
    winRate?: number;
    realizedPnlUsd?: number;
    avgPnlPerTrade?: number;
    largestWin?: number;
    largestLoss?: number;
  };
}

interface SignalsResponse {
  signals?: Array<{
    symbol: string;
    direction: 'bullish' | 'bearish' | 'neutral';
    confidence: number;
  }>;
}

interface AgentRow {
  id: string;
  label: string;
  open: Position[];
  closedCount: number;
  wins: number;
  realized: number;
  unrealized: number;
}

async function pooterGet<T>(path: string): Promise<T> {
  const res = await fetch(`${POOTER_API}${path}`, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`pooter.world ${path} → ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  // If the proxy rule is missing the SPA fallback serves index.html — catch
  // that rather than failing with an opaque JSON parse error.
  if (!type.includes('json'))
    throw new Error(`pooter.world ${path} returned ${type || 'non-JSON'}`);
  return res.json() as Promise<T>;
}

const num = (n: unknown): number => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

function usd(n: number | null | undefined, signed = false): string {
  if (n == null || !Number.isFinite(n)) return '—';
  const abs = Math.abs(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (!signed) return `${n < 0 ? '-' : ''}$${abs}`;
  return `${n > 0 ? '+' : n < 0 ? '-' : ''}$${abs}`;
}

function pnlColor(n: number): string {
  if (n > 0) return '#4ade80';
  if (n < 0) return '#f87171';
  return 'var(--theme-text-muted)';
}

function summarise(id: string, label: string, positions: Position[]): AgentRow {
  const open = positions.filter(p => p.status !== 'closed');
  const closed = positions.filter(p => p.status === 'closed');
  return {
    id,
    label,
    open,
    closedCount: closed.length,
    wins: closed.filter(p => num(p.realizedPnlUsd) > 0).length,
    realized: closed.reduce((s, p) => s + num(p.realizedPnlUsd), 0),
    unrealized: open.reduce((s, p) => s + num(p.unrealizedPnlUsd), 0),
  };
}

const sectionTitle: CSSProperties = {
  color: 'var(--theme-accent)',
  fontSize: '11px',
  letterSpacing: '1px',
  margin: '16px 0 6px',
};

const cell: CSSProperties = { padding: '3px 10px 3px 0', whiteSpace: 'nowrap' };

export default function TradingPanel() {
  // All positions (open + closed) so per-agent realized P&L can be summed.
  const positions = useQuery({
    queryKey: ['pooter-trading', 'positions'],
    queryFn: () => pooterGet<PositionsResponse>('/positions'),
    refetchInterval: REFRESH_MS,
  });
  const performance = useQuery({
    queryKey: ['pooter-trading', 'performance'],
    queryFn: () => pooterGet<PerformanceResponse>('/performance'),
    refetchInterval: REFRESH_MS,
  });
  const signals = useQuery({
    queryKey: ['pooter-trading', 'signals'],
    queryFn: () => pooterGet<SignalsResponse>('/signals'),
    refetchInterval: REFRESH_MS,
  });

  const agents = useMemo<AgentRow[]>(() => {
    const data = positions.data;
    if (!data) return [];
    const rows: AgentRow[] = [];
    if ((data.positions?.length ?? 0) > 0)
      rows.push(summarise('main', 'main', data.positions ?? []));
    for (const r of data.parallel ?? []) {
      rows.push(summarise(r.runnerId, r.label || r.runnerId, r.positions ?? []));
    }
    return rows.sort((a, b) => b.realized + b.unrealized - (a.realized + a.unrealized));
  }, [positions.data]);

  const openPositions = agents.flatMap(a => a.open.map(p => ({ agent: a.label, p })));
  const totalUnrealized = agents.reduce((s, a) => s + a.unrealized, 0);
  const metrics = performance.data?.metrics;
  const isLoading = positions.isLoading && performance.isLoading;
  const firstError = positions.error ?? performance.error;
  const lastUpdated = Math.max(positions.dataUpdatedAt, performance.dataUpdatedAt);

  return (
    <div
      className="terminal-scrollbar"
      style={{
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        padding: '8px 16px 24px',
        fontSize: '12px',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      <div style={{ color: 'var(--theme-text-muted)', fontSize: '11px' }}>
        pooter.world trading agents · read-only · refreshes every 30s
        {lastUpdated > 0 && ` · updated ${new Date(lastUpdated).toLocaleTimeString()}`}
      </div>

      {isLoading && <div style={{ marginTop: 16 }}>loading trading data…</div>}

      {firstError && !positions.data && !performance.data && (
        <div style={{ marginTop: 16, color: '#f87171' }}>
          trading bot unreachable: {(firstError as Error).message}
        </div>
      )}

      {performance.data && (
        <>
          <div style={sectionTitle}>OVERVIEW</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 24px' }}>
            <Stat label="account value" value={usd(performance.data.accountValueUsd)} />
            <Stat
              label="realized p&l"
              value={usd(metrics?.realizedPnlUsd, true)}
              color={pnlColor(num(metrics?.realizedPnlUsd))}
            />
            {positions.data && (
              <Stat
                label="unrealized p&l"
                value={usd(totalUnrealized, true)}
                color={pnlColor(totalUnrealized)}
              />
            )}
            <Stat
              label="win rate"
              value={metrics?.winRate != null ? `${metrics.winRate.toFixed(1)}%` : '—'}
            />
            <Stat label="trades" value={String(metrics?.totalTrades ?? 0)} />
            <Stat
              label="open"
              value={String(performance.data.openPositionCount ?? openPositions.length)}
            />
            <Stat label="best" value={usd(metrics?.largestWin, true)} color="#4ade80" />
            <Stat label="worst" value={usd(metrics?.largestLoss, true)} color="#f87171" />
          </div>
          {(performance.data.watchMarkets?.length ?? 0) > 0 && (
            <div style={{ marginTop: 6, color: 'var(--theme-text-muted)', fontSize: '11px' }}>
              watching: {performance.data.watchMarkets?.join(', ')}
            </div>
          )}
        </>
      )}

      {agents.length > 0 && (
        <>
          <div style={sectionTitle}>AGENTS</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: '12px' }}>
              <thead style={{ color: 'var(--theme-text-muted)', textAlign: 'left' }}>
                <tr>
                  <th style={cell}>agent</th>
                  <th style={cell}>total p&l</th>
                  <th style={cell}>realized</th>
                  <th style={cell}>unrealized</th>
                  <th style={cell}>open</th>
                  <th style={cell}>closed</th>
                  <th style={cell}>win %</th>
                </tr>
              </thead>
              <tbody>
                {agents.map(a => {
                  const total = a.realized + a.unrealized;
                  return (
                    <tr key={a.id}>
                      <td style={{ ...cell, color: 'var(--theme-text-primary)' }}>{a.label}</td>
                      <td style={{ ...cell, color: pnlColor(total) }}>{usd(total, true)}</td>
                      <td style={{ ...cell, color: pnlColor(a.realized) }}>
                        {usd(a.realized, true)}
                      </td>
                      <td style={{ ...cell, color: pnlColor(a.unrealized) }}>
                        {usd(a.unrealized, true)}
                      </td>
                      <td style={cell}>{a.open.length}</td>
                      <td style={cell}>{a.closedCount}</td>
                      <td style={cell}>
                        {a.closedCount ? `${((a.wins / a.closedCount) * 100).toFixed(0)}%` : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {positions.data && (
        <>
          <div style={sectionTitle}>OPEN POSITIONS</div>
          {openPositions.length === 0 ? (
            <div style={{ color: 'var(--theme-text-muted)' }}>no open positions</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: '12px' }}>
                <thead style={{ color: 'var(--theme-text-muted)', textAlign: 'left' }}>
                  <tr>
                    <th style={cell}>agent</th>
                    <th style={cell}>side</th>
                    <th style={cell}>market</th>
                    <th style={cell}>size</th>
                    <th style={cell}>entry</th>
                    <th style={cell}>now</th>
                    <th style={cell}>p&l</th>
                    <th style={cell}>moral</th>
                  </tr>
                </thead>
                <tbody>
                  {openPositions.map(({ agent, p }) => (
                    <tr key={`${agent}-${p.id}`}>
                      <td style={cell}>{agent}</td>
                      <td
                        style={{
                          ...cell,
                          color: p.direction === 'short' ? '#f87171' : '#4ade80',
                        }}
                      >
                        {p.direction?.toUpperCase() ?? '?'}
                      </td>
                      <td style={{ ...cell, color: 'var(--theme-text-primary)' }}>
                        {p.symbol || p.venue || '?'}
                        {p.symbol && p.venue && (
                          <span style={{ color: 'var(--theme-text-muted)' }}> · {p.venue}</span>
                        )}
                      </td>
                      <td style={cell}>{usd(p.entryNotionalUsd)}</td>
                      <td style={cell}>{price(p.entryPriceUsd)}</td>
                      <td style={cell}>{price(p.currentPriceUsd)}</td>
                      <td style={{ ...cell, color: pnlColor(num(p.unrealizedPnlUsd)) }}>
                        {p.unrealizedPnlUsd != null ? usd(p.unrealizedPnlUsd, true) : '—'}
                      </td>
                      <td style={cell}>{p.moralScore ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {signals.data?.signals && signals.data.signals.length > 0 && (
        <>
          <div style={sectionTitle}>MARKET SIGNALS</div>
          {signals.data.signals.map(s => {
            const arrow = s.direction === 'bullish' ? '↑' : s.direction === 'bearish' ? '↓' : '→';
            const color =
              s.direction === 'bullish'
                ? '#4ade80'
                : s.direction === 'bearish'
                  ? '#f87171'
                  : 'var(--theme-text-muted)';
            return (
              <div key={s.symbol}>
                <span style={{ color }}>{arrow}</span> {s.symbol}{' '}
                <span style={{ color: 'var(--theme-text-muted)' }}>
                  {s.direction} · {(num(s.confidence) * 100).toFixed(0)}%
                </span>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

function price(n: number | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return `$${n.toLocaleString('en-US', { maximumSignificantDigits: 6 })}`;
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ color: 'var(--theme-text-muted)', fontSize: '10px' }}>{label}</div>
      <div style={{ color: color ?? 'var(--theme-text-primary)', fontSize: '14px' }}>{value}</div>
    </div>
  );
}
