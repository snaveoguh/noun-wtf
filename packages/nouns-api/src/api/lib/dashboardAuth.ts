// ============================================================
// Dashboard Stats
// ============================================================

export function checkDashboardKey(c: {
  req: { query: (k: string) => string | undefined };
}): boolean {
  const key = c.req.query('key');
  const expected = process.env.DASHBOARD_API_KEY;
  return !!expected && key === expected;
}
