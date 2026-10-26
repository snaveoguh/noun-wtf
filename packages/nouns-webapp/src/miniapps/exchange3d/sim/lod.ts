// ── 3D Grand Exchange: level of detail (pure) ────────────────────────────
//
// Two tiers per trader:
//   rig   — the full rigged Noun (world2's NounCharacter: skinned body,
//           3D head, clips). A few dozen at most, nearest the camera.
//   crowd — one instanced low-poly Noun (box head + body wearing the
//           trader's real Noun art from an atlas). Every trader not rigged.
// Rigs swap with hysteresis (a rigged trader keeps its rig until it is
// `hysteresis` × farther than the next candidate), so the boundary doesn't
// churn as the crowd mills. In the VAST view no one is rigged.

export interface Budget {
  traders: number;
  rigs: number;
  /** Rigs only within this distance of the camera (m). */
  rigDist: number;
  bubbles: number;
  /** New rigs built per frame (building one is a hitch). */
  rigsPerFrame: number;
  pixelRatio: number;
}

export function budgetFor(phone: boolean, override?: { traders?: number; rigs?: number }): Budget {
  const b: Budget = phone
    ? { traders: 110, rigs: 8, rigDist: 30, bubbles: 16, rigsPerFrame: 1, pixelRatio: 1.25 }
    : { traders: 320, rigs: 28, rigDist: 46, bubbles: 30, rigsPerFrame: 2, pixelRatio: 1.5 };
  if (override?.traders !== undefined && override.traders >= 0)
    b.traders = Math.min(3000, Math.floor(override.traders));
  if (override?.rigs !== undefined && override.rigs >= 0)
    b.rigs = Math.min(80, Math.floor(override.rigs));
  return b;
}

/**
 * Which traders get a rig. `dist[i]` is trader i's camera distance
 * (Infinity = never, e.g. off screen behind the camera). `pinned` (the
 * followed trader) is always in when within range.
 */
export function pickRigs(
  dist: ArrayLike<number>,
  current: ReadonlySet<number>,
  max: number,
  maxDist: number,
  pinned: number | null = null,
  hysteresis = 1.2,
): Set<number> {
  const out = new Set<number>();
  if (max <= 0) return out;
  const cand: { i: number; d: number }[] = [];
  for (let i = 0; i < dist.length; i++) {
    const d = dist[i]!;
    if (!(d <= maxDist * (current.has(i) ? hysteresis : 1))) continue;
    cand.push({ i, d: current.has(i) ? d / hysteresis : d });
  }
  cand.sort((a, b) => a.d - b.d || a.i - b.i);
  if (pinned !== null && pinned >= 0 && pinned < dist.length && dist[pinned]! <= maxDist * 2)
    out.add(pinned);
  for (const c of cand) {
    if (out.size >= max) break;
    out.add(c.i);
  }
  return out;
}

/** Hall copies to draw around the real hall, by camera distance (0 = none). */
export function copyRings(camDist: number, phone: boolean): number {
  if (camDist < 150) return 0;
  if (camDist < 320) return 1;
  if (phone || camDist < 650) return 2;
  return 3;
}
