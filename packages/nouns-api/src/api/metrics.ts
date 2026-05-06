/**
 * In-memory request metrics ring buffer.
 * Tracks the last MAX_ENTRIES requests and provides aggregation helpers
 * for the /api/stats dashboard endpoint.
 */

import type { MiddlewareHandler } from 'hono';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RequestRecord {
  path: string;
  method: string;
  status: number;
  durationMs: number;
  ip: string;
  userAgent: string;
  referer: string;
  timestamp: number; // epoch ms
}

interface AggregatedMetrics {
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
  topCallers: {
    ip: string;
    userAgent: string;
    count: number;
  }[];
  statusBreakdown: { '2xx': number; '3xx': number; '4xx': number; '5xx': number };
  requestsOverTime: { bucket: string; count: number }[];
  windowMinutes: number;
}

// ---------------------------------------------------------------------------
// Ring buffer
// ---------------------------------------------------------------------------

const MAX_ENTRIES = 10_000;
const buffer: RequestRecord[] = [];

/** Normalize dynamic path segments to `:id` for grouping */
function normalizePath(path: string): string {
  return path.replace(/\/0x[\dA-Fa-f]+/g, '/:address').replace(/\/\d+/g, '/:id');
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

export const metricsMiddleware: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;

  const record: RequestRecord = {
    path: normalizePath(c.req.path),
    method: c.req.method,
    status: c.res.status,
    durationMs: duration,
    ip: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown',
    userAgent: c.req.header('user-agent') || 'unknown',
    referer: c.req.header('referer') || '',
    timestamp: Date.now(),
  };

  buffer.push(record);
  if (buffer.length > MAX_ENTRIES) {
    buffer.splice(0, buffer.length - MAX_ENTRIES);
  }
};

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)] ?? 0;
}

export function getMetrics(windowMinutes = 60): AggregatedMetrics {
  const cutoff = Date.now() - windowMinutes * 60_000;
  const records = buffer.filter(r => r.timestamp >= cutoff);

  const total = records.length;
  const windowHours = windowMinutes / 60;

  // Latency
  const durations = records.map(r => r.durationMs).sort((a, b) => a - b);
  const avgLatency = total > 0 ? durations.reduce((s, d) => s + d, 0) / total : 0;

  // Status breakdown
  const statusBreakdown = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 };
  for (const r of records) {
    if (r.status < 300) statusBreakdown['2xx']++;
    else if (r.status < 400) statusBreakdown['3xx']++;
    else if (r.status < 500) statusBreakdown['4xx']++;
    else statusBreakdown['5xx']++;
  }

  // Top endpoints
  const endpointMap = new Map<string, { count: number; totalMs: number; errors: number }>();
  for (const r of records) {
    const key = `${r.method} ${r.path}`;
    const e = endpointMap.get(key) || { count: 0, totalMs: 0, errors: 0 };
    e.count++;
    e.totalMs += r.durationMs;
    if (r.status >= 400) e.errors++;
    endpointMap.set(key, e);
  }
  const topEndpoints = [...endpointMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 15)
    .map(([key, v]) => {
      const [method = '', ...rest] = key.split(' ');
      return {
        path: rest.join(' '),
        method,
        count: v.count,
        avgLatencyMs: Math.round(v.totalMs / v.count),
        errorCount: v.errors,
      };
    });

  // Top callers
  const callerMap = new Map<string, { count: number; userAgent: string }>();
  for (const r of records) {
    const c = callerMap.get(r.ip) || { count: 0, userAgent: r.userAgent };
    c.count++;
    callerMap.set(r.ip, c);
  }
  const topCallers = [...callerMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 15)
    .map(([ip, v]) => ({ ip, userAgent: v.userAgent, count: v.count }));

  // Requests over time (5-minute buckets)
  const bucketMs = 5 * 60_000;
  const bucketMap = new Map<number, number>();
  for (const r of records) {
    const bucket = Math.floor(r.timestamp / bucketMs) * bucketMs;
    bucketMap.set(bucket, (bucketMap.get(bucket) || 0) + 1);
  }
  const requestsOverTime = [...bucketMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([bucket, count]) => ({ bucket: new Date(bucket).toISOString(), count }));

  return {
    totalRequests: total,
    requestsPerHour: total > 0 ? Math.round(total / windowHours) : 0,
    avgLatencyMs: Math.round(avgLatency),
    p95LatencyMs: percentile(durations, 95),
    p99LatencyMs: percentile(durations, 99),
    errorRate:
      total > 0
        ? Math.round(((statusBreakdown['4xx'] + statusBreakdown['5xx']) / total) * 10000) / 100
        : 0,
    topEndpoints,
    topCallers,
    statusBreakdown,
    requestsOverTime,
    windowMinutes,
  };
}

export function getRecentErrors(limit = 50): RequestRecord[] {
  return buffer
    .filter(r => r.status >= 400)
    .slice(-limit)
    .reverse();
}

export function getBufferSize(): number {
  return buffer.length;
}
