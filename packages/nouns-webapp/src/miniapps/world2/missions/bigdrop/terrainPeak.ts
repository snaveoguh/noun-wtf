// ── The Big Drop's bare cone: its constants and depth profile (pure) ────
//
// Split out of peakTerrain.ts so the track (track.ts) can read the cone
// without an import cycle: peakTerrain → terrainCarve → track → here.
// peakTerrain.ts re-exports both, so callers keep importing from there.

export const PEAK = {
  /** Summit to the snowfield at the bottom (m). */
  drop: 1_000_000,
  /** Fall-line gradient once the slope is in (rise over run), about 49°. */
  grade: 1.15,
  /** Flat summit pad radius (m). */
  pad: 24,
  /** The gradient eases in over this far below the pad (m). */
  ease: 120,
  /** Width of the bend from the slope onto the flat snowfield (m of height). */
  runout: 4000,
  /** Kicker ridges across the fall line: one every `kickEvery` m of slope. */
  kickEvery: 520,
  /** Ridge height (m) at its tallest; it varies around the mountain. */
  kickHeight: 5,
  /** No kickers on the first stretch below the pad (m). */
  kickFrom: 400,
} as const;

/** w·ln(1 + e^(u/w)), without overflow either way. */
function softplus(u: number, w: number): number {
  return u > 0 ? u + w * Math.log1p(Math.exp(-u / w)) : w * Math.log1p(Math.exp(u / w));
}

/** Depth of the smooth cone (no detail) at `s` m out from the pad's edge, ≥ 0. */
export function coneDepth(s: number): number {
  if (s <= 0) return 0;
  const L = PEAK.ease;
  const g = PEAK.grade * (s - L * (1 - Math.exp(-s / L)));
  // Ease the last few km onto the snowfield instead of hitting it at 49°
  return PEAK.drop - softplus(PEAK.drop - g, PEAK.runout / 4);
}

/** Height of the bare cone (no detail) at (x, z), peak coordinates. */
export function coneHeight(x: number, z: number): number {
  return -coneDepth(Math.hypot(x, z) - PEAK.pad);
}
