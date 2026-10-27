// ── Which painted walls to load first (pure: no three.js) ───────────────
//
// The plaza has ~2,000 painted wall cells. Loading them 40 at a time, one
// batch after another in the store's order, took a minute or more on a phone
// before the wall you were standing at came up (a player's own tags only
// appeared once they sprayed there and PartyKit re-sent the wall). Now the
// cells nearest the rider go first, and a few batches run at once.

/** A cell id `level|nx,ny,nz|d|cu|cv` → its centre in the world, or null. */
export function wallCentre(
  id: string,
  cellW: number,
  cellH: number,
): { x: number; y: number; z: number } | null {
  const parts = id.split('|');
  if (parts.length !== 5) return null;
  const nn = parts[1]!.split(',').map(Number);
  const d = Number(parts[2]);
  const cu = Number(parts[3]);
  const cv = Number(parts[4]);
  if (nn.length !== 3 || ![...nn, d, cu, cv].every(Number.isFinite)) return null;
  // Same basis as Graffiti.basis(): normal snapped to 0.05, normalised
  let [nx, ny, nz] = nn.map(x => Math.round(x * 20) / 20) as [number, number, number];
  const nl = Math.hypot(nx, ny, nz);
  if (nl < 1e-6) return null;
  nx /= nl;
  ny /= nl;
  nz /= nl;
  let u: [number, number, number];
  if (Math.abs(ny) > 0.85) u = [1, 0, 0];
  else {
    // up × n
    const ux = nz;
    const uz = -nx;
    const ul = Math.hypot(ux, uz);
    u = [ux / ul, 0, uz / ul];
  }
  // v = n × u
  const v: [number, number, number] = [
    ny * u[2] - nz * u[1],
    nz * u[0] - nx * u[2],
    nx * u[1] - ny * u[0],
  ];
  const vl = Math.hypot(v[0], v[1], v[2]);
  const a = (cu + 0.5) * cellW;
  const b = (cv + 0.5) * cellH;
  return {
    x: nx * d + u[0] * a + (v[0] / vl) * b,
    y: ny * d + u[1] * a + (v[1] / vl) * b,
    z: nz * d + u[2] * a + (v[2] / vl) * b,
  };
}

/** Wall ids ordered nearest-first from `at` (unparseable ids go last). */
export function nearestFirst(
  ids: readonly string[],
  at: { x: number; y: number; z: number } | null,
  cellW: number,
  cellH: number,
): string[] {
  if (at === null) return [...ids];
  const dist = (id: string) => {
    const c = wallCentre(id, cellW, cellH);
    return c === null ? Infinity : Math.hypot(c.x - at.x, c.y - at.y, c.z - at.z);
  };
  return ids
    .map(id => ({ id, d: dist(id) }))
    .sort((p, q) => p.d - q.d)
    .map(p => p.id);
}

/** Run `jobs` with at most `limit` in flight; resolves when all have settled. */
export async function inParallel<T>(
  jobs: readonly T[],
  limit: number,
  run: (job: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < jobs.length) {
      const j = jobs[next++]!;
      try {
        await run(j);
      } catch {
        // one batch failing doesn't stop the rest
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, jobs.length)) }, lane));
}
