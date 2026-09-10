import { useState } from 'react';

import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

import { useApiMetrics, useSystemHealth, useTrafficStats } from '@/hooks/useDashboardData';

// ─── Period options ──────────────────────────────────────────────────────────

const PERIODS = [
  { label: '1h', apiWindow: 60, traffic: '1h' },
  { label: '24h', apiWindow: 1440, traffic: '24h' },
  { label: '7d', apiWindow: 10080, traffic: '7d' },
  { label: '30d', apiWindow: 43200, traffic: '30d' },
] as const;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function truncateUA(ua: string): string {
  if (ua.length <= 50) return ua;
  return ua.slice(0, 47) + '...';
}

// ─── Small components ────────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4">
      <div className="text-xs uppercase tracking-wide text-white/40">{label}</div>
      <div className="mt-1 text-2xl font-bold text-white">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-white/30">{sub}</div>}
    </div>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={`mr-2 inline-block h-2 w-2 rounded-full ${ok ? 'bg-green-400' : 'bg-red-400'}`}
    />
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-4 mt-10 text-sm font-semibold uppercase tracking-wider text-white/60">
      {children}
    </h2>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────

const DashboardPage: React.FC = () => {
  const [periodIdx, setPeriodIdx] = useState(1); // default 24h
  const period = PERIODS[periodIdx];

  const { data: metrics, isLoading: metricsLoading } = useApiMetrics(period.apiWindow);
  const {
    data: traffic,
    isLoading: trafficLoading,
    error: trafficError,
  } = useTrafficStats(period.traffic);
  const { data: health } = useSystemHealth();

  const hasKey = ((import.meta.env.VITE_DASHBOARD_API_KEY as string | undefined) ?? '').length > 0;

  return (
    <div
      className="mx-auto min-h-screen max-w-6xl px-4 py-8 md:px-8"
      style={{ fontFamily: "'PT Root UI', sans-serif", background: '#050510', color: '#fff' }}
    >
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-bold tracking-tight">noun.wtf dashboard</h1>
        <div className="flex gap-1 rounded-lg bg-white/5 p-1">
          {PERIODS.map((p, i) => (
            <button
              type="button"
              key={p.label}
              onClick={() => setPeriodIdx(i)}
              className={`rounded-md px-3 py-1 text-xs transition-colors ${
                i === periodIdx ? 'bg-white/15 text-white' : 'text-white/40 hover:text-white/60'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── System Health ─────────────────────────────────────────────── */}
      {health && (
        <div className="mb-2 flex flex-wrap gap-3">
          <div className="flex items-center text-xs text-white/50">
            <StatusDot ok={health.api.status === 'ok'} />
            API up {formatUptime(health.api.uptimeSeconds)}
          </div>
          <div className="flex items-center text-xs text-white/50">
            <StatusDot ok={health.database.ok} />
            DB {health.database.ok ? 'ok' : 'down'}
          </div>
          <div className="text-xs text-white/30">
            Block {Number(health.indexer.latestBlock).toLocaleString()} | {health.api.memoryMB}MB
            heap | {health.metricsBufferSize.toLocaleString()} metrics buffered
          </div>
        </div>
      )}

      {/* ── Website Traffic (first-party beacon) ──────────────────────── */}
      {hasKey && (
        <>
          <SectionTitle>Website Traffic</SectionTitle>

          {trafficError ? (
            <div className="rounded-lg border border-white/10 bg-white/5 p-6 text-center text-sm text-white/30">
              Traffic stats unavailable — {String(trafficError)}
            </div>
          ) : trafficLoading ? (
            <div className="text-sm text-white/30">Loading traffic...</div>
          ) : traffic?.aggregate?.results &&
            (traffic.aggregate.results.visitors?.value ?? 0) > 0 ? (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatCard
                  label="Visitors"
                  value={(traffic.aggregate.results.visitors?.value ?? 0).toLocaleString()}
                />
                <StatCard
                  label="Pageviews"
                  value={(traffic.aggregate.results.pageviews?.value ?? 0).toLocaleString()}
                />
                <StatCard
                  label="Bounce Rate"
                  value={`${traffic.aggregate.results.bounce_rate?.value ?? 0}%`}
                />
                <StatCard
                  label="Views / Visitor"
                  value={(traffic.aggregate.results.views_per_visit?.value ?? 0).toLocaleString()}
                />
              </div>

              {traffic.timeseries?.results != null && (
                <div className="mt-4 rounded-lg border border-white/10 bg-white/5 p-4">
                  <div className="mb-2 text-xs text-white/40">Visitors over time</div>
                  <ResponsiveContainer width="100%" height={180}>
                    <AreaChart data={traffic.timeseries.results}>
                      <defs>
                        <linearGradient id="trafficGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#818cf8" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="#818cf8" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 10, fill: '#ffffff40' }}
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: '#ffffff40' }}
                        tickLine={false}
                        axisLine={false}
                        width={30}
                      />
                      <Tooltip
                        contentStyle={{
                          background: '#1e1e2e',
                          border: '1px solid #ffffff20',
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                        labelStyle={{ color: '#ffffff80' }}
                      />
                      <Area
                        type="monotone"
                        dataKey="visitors"
                        stroke="#818cf8"
                        fill="url(#trafficGrad)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}

              <div className="mt-3 grid gap-3 md:grid-cols-3">
                {traffic.topPages?.results != null && (
                  <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                    <div className="mb-2 text-xs text-white/40">Top Pages</div>
                    <div className="space-y-1">
                      {traffic.topPages.results.slice(0, 8).map(p => (
                        <div key={p.page} className="flex justify-between text-xs">
                          <span className="mr-2 truncate text-white/70">{p.page}</span>
                          <span className="shrink-0 text-white/40">{p.visitors}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {traffic.topReferrers?.results != null && (
                  <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                    <div className="mb-2 text-xs text-white/40">Top Referrers</div>
                    <div className="space-y-1">
                      {traffic.topReferrers.results.slice(0, 8).map(r => (
                        <div key={r.source} className="flex justify-between text-xs">
                          <span className="mr-2 truncate text-white/70">{r.source}</span>
                          <span className="shrink-0 text-white/40">{r.visitors}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {traffic.devices?.results != null && (
                  <div className="rounded-lg border border-white/10 bg-white/5 p-4">
                    <div className="mb-2 text-xs text-white/40">Devices</div>
                    <div className="space-y-1">
                      {traffic.devices.results.map(d => (
                        <div key={d.device} className="flex justify-between text-xs">
                          <span className="mr-2 truncate text-white/70">{d.device}</span>
                          <span className="shrink-0 text-white/40">{d.visitors}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : traffic?.aggregate?.results ? (
            <div className="rounded-lg border border-white/10 bg-white/5 p-6 text-center text-sm text-white/30">
              No traffic data for this period
            </div>
          ) : null}
        </>
      )}

      {/* ── API Usage ─────────────────────────────────────────────────── */}
      <SectionTitle>API Usage</SectionTitle>

      {!hasKey ? (
        <div className="rounded-lg border border-white/10 bg-white/5 p-6 text-center text-sm text-white/30">
          Metrics require dashboard key
        </div>
      ) : metricsLoading ? (
        <div className="text-sm text-white/30">Loading metrics...</div>
      ) : metrics ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard
              label="Total Requests"
              value={metrics.totalRequests.toLocaleString()}
              sub={`in last ${period.label}`}
            />
            <StatCard label="Req / Hour" value={metrics.requestsPerHour.toLocaleString()} />
            <StatCard
              label="Avg Latency"
              value={`${metrics.avgLatencyMs}ms`}
              sub={`p95: ${metrics.p95LatencyMs}ms`}
            />
            <StatCard
              label="Error Rate"
              value={`${metrics.errorRate}%`}
              sub={`${metrics.statusBreakdown['4xx'] + metrics.statusBreakdown['5xx']} errors`}
            />
          </div>

          {metrics.requestsOverTime.length > 0 && (
            <div className="mt-4 rounded-lg border border-white/10 bg-white/5 p-4">
              <div className="mb-2 text-xs text-white/40">Requests over time (5-min buckets)</div>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={metrics.requestsOverTime}>
                  <XAxis
                    dataKey="bucket"
                    tickFormatter={formatTime}
                    tick={{ fontSize: 10, fill: '#ffffff40' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: '#ffffff40' }}
                    tickLine={false}
                    axisLine={false}
                    width={30}
                  />
                  <Tooltip
                    labelFormatter={v => new Date(v).toLocaleString()}
                    contentStyle={{
                      background: '#1e1e2e',
                      border: '1px solid #ffffff20',
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                  />
                  <Bar dataKey="count" fill="#34d399" radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {/* Top Endpoints */}
            <div className="rounded-lg border border-white/10 bg-white/5 p-4">
              <div className="mb-2 text-xs text-white/40">Top Endpoints</div>
              <div className="space-y-1.5">
                {metrics.topEndpoints.map(e => (
                  <div key={`${e.method} ${e.path}`} className="flex items-center gap-2 text-xs">
                    <span className="w-9 shrink-0 text-right font-mono text-white/30">
                      {e.method}
                    </span>
                    <span className="flex-1 truncate text-white/70">{e.path}</span>
                    <span className="w-12 shrink-0 text-right text-white/40">{e.count}</span>
                    <span className="w-14 shrink-0 text-right text-white/25">
                      {e.avgLatencyMs}ms
                    </span>
                    {e.errorCount > 0 && (
                      <span className="shrink-0 text-right text-red-400/60">{e.errorCount}err</span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Top Callers */}
            <div className="rounded-lg border border-white/10 bg-white/5 p-4">
              <div className="mb-2 text-xs text-white/40">Top Callers</div>
              <div className="space-y-1.5">
                {metrics.topCallers.map(c => (
                  <div key={c.ip} className="flex items-center gap-2 text-xs">
                    <span className="shrink-0 font-mono text-white/50">{c.ip}</span>
                    <span className="flex-1 truncate text-white/25">{truncateUA(c.userAgent)}</span>
                    <span className="w-12 shrink-0 text-right text-white/40">{c.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Status breakdown */}
          <div className="mt-3 flex gap-3 text-xs text-white/30">
            <span className="text-green-400/60">2xx: {metrics.statusBreakdown['2xx']}</span>
            <span className="text-blue-400/60">3xx: {metrics.statusBreakdown['3xx']}</span>
            <span className="text-yellow-400/60">4xx: {metrics.statusBreakdown['4xx']}</span>
            <span className="text-red-400/60">5xx: {metrics.statusBreakdown['5xx']}</span>
          </div>
        </>
      ) : null}

      <div className="mt-12 pb-8 text-center text-xs text-white/15">
        noun.wtf dashboard | data refreshes automatically
      </div>
    </div>
  );
};

export default DashboardPage;
