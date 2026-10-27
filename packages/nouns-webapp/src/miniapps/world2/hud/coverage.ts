// ── How much of the screen the HUD covers (pure, tested) ────────────────
//
// The HUD's budget is measured, not eyeballed: the browser audit collects
// every visible HUD box, and these functions turn them into the share of
// the screen covered (overlaps counted once) and the share of the middle
// "play zone" that must stay clear on a phone.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Clip a rect to a bounding rect; null when they don't overlap. */
export function clip(r: Rect, to: Rect): Rect | null {
  const x0 = Math.max(r.x, to.x);
  const y0 = Math.max(r.y, to.y);
  const x1 = Math.min(r.x + r.w, to.x + to.w);
  const y1 = Math.min(r.y + r.h, to.y + to.h);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
}

/**
 * Area of the union of rects (overlaps counted once), exact: sweep the
 * distinct x edges and merge the y intervals live in each strip.
 */
export function unionArea(rects: readonly Rect[]): number {
  const rs = rects.filter(r => r.w > 0 && r.h > 0);
  if (rs.length === 0) return 0;
  const xs = [...new Set(rs.flatMap(r => [r.x, r.x + r.w]))].sort((a, b) => a - b);
  let area = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const xa = xs[i]!;
    const xb = xs[i + 1]!;
    const spans = rs
      .filter(r => r.x <= xa && r.x + r.w >= xb)
      .map(r => [r.y, r.y + r.h] as const)
      .sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let cs = -Infinity;
    let ce = -Infinity;
    for (const [s, e] of spans) {
      if (s > ce) {
        if (ce > cs) covered += ce - cs;
        cs = s;
        ce = e;
      } else if (e > ce) ce = e;
    }
    if (ce > cs) covered += ce - cs;
    area += covered * (xb - xa);
  }
  return area;
}

/**
 * The middle of the screen a phone HUD keeps clear: the central `share`
 * of each axis (0.7 → 15% margins all round).
 */
export function playZone(W: number, H: number, share = 0.7): Rect {
  const mx = (W * (1 - share)) / 2;
  const my = (H * (1 - share)) / 2;
  return { x: mx, y: my, w: W - 2 * mx, h: H - 2 * my };
}

export interface Coverage {
  /** Share of the whole screen under HUD (0..1). */
  screen: number;
  /** Share of the play zone under HUD (0..1). */
  zone: number;
  /** Covered px² (union). */
  px: number;
}

/** Screen and play-zone coverage of a set of HUD boxes. */
export function coverage(rects: readonly Rect[], W: number, H: number, share = 0.7): Coverage {
  const screen: Rect = { x: 0, y: 0, w: W, h: H };
  const onScreen = rects.map(r => clip(r, screen)).filter((r): r is Rect => r !== null);
  const zone = playZone(W, H, share);
  const inZone = rects.map(r => clip(r, zone)).filter((r): r is Rect => r !== null);
  const px = unionArea(onScreen);
  return { screen: px / (W * H), zone: unionArea(inZone) / (zone.w * zone.h), px };
}
