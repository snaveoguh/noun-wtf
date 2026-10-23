// Simple in-memory rate limiter (per-minute + daily)
const rateLimits = new Map<string, { count: number; resetAt: number }>();
const dailyLimits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 10; // messages per minute
const RATE_WINDOW = 60_000; // 1 minute
const DAILY_LIMIT = 50; // messages per day
const DAILY_WINDOW = 86_400_000; // 24 hours

export function checkRateLimit(key: string): { ok: boolean; daily?: boolean } {
  const now = Date.now();

  // Check daily limit first
  const daily = dailyLimits.get(key);
  if (!daily || now > daily.resetAt) {
    dailyLimits.set(key, { count: 1, resetAt: now + DAILY_WINDOW });
  } else if (daily.count >= DAILY_LIMIT) {
    return { ok: false, daily: true };
  } else {
    daily.count++;
  }

  // Check per-minute limit
  const entry = rateLimits.get(key);
  if (!entry || now > entry.resetAt) {
    rateLimits.set(key, { count: 1, resetAt: now + RATE_WINDOW });
    return { ok: true };
  }
  if (entry.count >= RATE_LIMIT) return { ok: false, daily: false };
  entry.count++;
  return { ok: true };
}
