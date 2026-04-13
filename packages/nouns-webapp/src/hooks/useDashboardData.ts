import { useQuery } from '@tanstack/react-query';

const API_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  'https://spirited-flexibility-production-3c30.up.railway.app';

const DASHBOARD_KEY: string =
  (import.meta.env.VITE_DASHBOARD_API_KEY as string | undefined) ||
  'ef468c49f5725aab5c9fb5ccb6e66874dca03eec6bf6b077989ff09da83b754d';

function statsUrl(path: string, params?: Record<string, string>) {
  const url = new URL(`${API_URL}${path}`);
  url.searchParams.set('key', DASHBOARD_KEY);
  if (params) {
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  }
  return url.toString();
}

// ─── API Metrics ─────────────────────────────────────────────────────────────

export interface ApiMetrics {
  totalRequests: number;
  requestsPerHour: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  errorRate: number;
  topEndpoints: {
    path: string;
    method: string;
    count: number;
    avgLatencyMs: number;
    errorCount: number;
  }[];
  topCallers: { ip: string; userAgent: string; count: number }[];
  statusBreakdown: { '2xx': number; '3xx': number; '4xx': number; '5xx': number };
  requestsOverTime: { bucket: string; count: number }[];
  windowMinutes: number;
}

export function useApiMetrics(windowMinutes = 60) {
  return useQuery<ApiMetrics>({
    queryKey: ['dashboard', 'api-metrics', windowMinutes],
    queryFn: () =>
      fetch(statsUrl('/api/stats', { window: String(windowMinutes) })).then(r => {
        if (!r.ok) throw new Error(`Stats API ${r.status}`);
        return r.json();
      }),
    refetchInterval: 30_000,
    enabled: DASHBOARD_KEY.length > 0,
  });
}

// ─── Plausible ───────────────────────────────────────────────────────────────

export interface PlausibleStats {
  aggregate: { results: Record<string, { value: number }> };
  timeseries: { results: { date: string; visitors: number; pageviews: number }[] };
  topPages: { results: { page: string; visitors: number }[] };
  topReferrers: { results: { source: string; visitors: number }[] };
  period: string;
}

export function usePlausibleStats(period = '30d') {
  return useQuery<PlausibleStats>({
    queryKey: ['dashboard', 'plausible', period],
    queryFn: () =>
      fetch(statsUrl('/api/stats/plausible', { period })).then(r => {
        if (!r.ok) throw new Error(`Plausible API ${r.status}`);
        return r.json();
      }),
    refetchInterval: 300_000,
    enabled: DASHBOARD_KEY.length > 0,
  });
}

// ─── System Health ───────────────────────────────────────────────────────────

export interface SystemHealth {
  api: { status: string; uptimeSeconds: number; memoryMB: number };
  indexer: { latestBlock: string };
  database: { ok: boolean; error?: string };
  metricsBufferSize: number;
  timestamp: number;
}

export function useSystemHealth() {
  return useQuery<SystemHealth>({
    queryKey: ['dashboard', 'health'],
    queryFn: () =>
      fetch(statsUrl('/api/stats/health')).then(r => {
        if (!r.ok) throw new Error(`Health API ${r.status}`);
        return r.json();
      }),
    refetchInterval: 60_000,
  });
}
