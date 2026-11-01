// ── Mural billboard fitting (pure) ──────────────────────────────────────
//
// The plaza mural is a fixed 14 × 8.7 m decal; Pip3's GIFs come in every
// shape (mostly square or portrait). Instead of stretching each clip onto
// the decal, the mural becomes a framed screen sized to the clip's own
// aspect: as wide as the mural at most, growing taller (up from the
// mural's bottom edge, over the shopfront awnings) until the frame would
// reach the top of the wall, then narrowing to keep the aspect.
//
// Everything here is in the wall's own 2D frame: `u` runs along the wall
// (metres, 0 = the mural's centre), `y` is world height.

/** The baked mural decal's rectangle on its wall. */
export interface WallRect {
  /** Centre along the wall. */
  u: number;
  width: number;
  bottom: number;
  top: number;
}

/** Where the wall the mural sits on ends (from the collision world). */
export interface WallExtent {
  /** Highest point of the wall face above the mural (the roofline). */
  top: number;
  /** The wall's ends along `u` at the mural's height. */
  left: number;
  right: number;
}

export interface FitOptions {
  /** The frame's border outside the screen (m). */
  border: number;
  /** Clear wall kept between the frame and the wall's edges / roofline (m). */
  margin: number;
  /** Widest screen as a fraction of the mural's width. */
  maxWidthScale?: number;
}

/** A screen rectangle in the wall frame (the picture only, no border). */
export interface ScreenRect {
  u: number;
  width: number;
  bottom: number;
  height: number;
}

/** Fallback when a clip's size is unknown or nonsense: the mural itself. */
export function muralScreen(m: WallRect): ScreenRect {
  return { u: m.u, width: m.width, bottom: m.bottom, height: m.top - m.bottom };
}

/**
 * The largest screen with `aspect` (width / height) that fits: at most the
 * mural's width (× maxWidthScale) and the wall's width minus border and
 * margin; bottom on the mural's bottom edge; top no higher than the wall's
 * top minus border and margin. The screen never gets shorter than the space
 * allows just because the mural was short: a wide clip keeps the full width
 * and is as tall as its aspect makes it.
 */
export function fitScreen(
  mural: WallRect,
  aspect: number,
  wall: WallExtent | null,
  opts: FitOptions,
): ScreenRect {
  if (!Number.isFinite(aspect) || aspect <= 0.05 || aspect > 20) return muralScreen(mural);
  const pad = opts.border + opts.margin;
  const bottom = mural.bottom;
  // No wall measured: stay inside the mural's own rectangle
  const topLimit = wall === null ? mural.top : Math.max(mural.top, wall.top - pad);
  let maxW = mural.width * (opts.maxWidthScale ?? 1);
  let u = mural.u;
  if (wall !== null) {
    const span = wall.right - wall.left - 2 * pad;
    if (span > 0) maxW = Math.min(maxW, span);
    // Keep the screen centred on the mural, but inside the wall's ends
    const lo = wall.left + pad + maxW / 2;
    const hi = wall.right - pad - maxW / 2;
    if (lo <= hi) u = Math.min(hi, Math.max(lo, u));
  }
  const maxH = Math.max(0.5, topLimit - bottom);
  let width = maxW;
  let height = width / aspect;
  if (height > maxH) {
    height = maxH;
    width = height * aspect;
  }
  return { u, width, bottom, height };
}

/** Same rectangle to within `eps` metres (skip a rebuild). */
export function sameRect(a: ScreenRect | null, b: ScreenRect, eps = 0.01): boolean {
  return (
    a !== null &&
    Math.abs(a.u - b.u) < eps &&
    Math.abs(a.width - b.width) < eps &&
    Math.abs(a.bottom - b.bottom) < eps &&
    Math.abs(a.height - b.height) < eps
  );
}

/**
 * Scan a wall along one axis: `hit(t)` says whether the wall face is there
 * at t. From `from` (which must hit) steps by `step` until the first miss
 * or `limit`; returns the last t that hit, refined by bisection to ~1 cm.
 */
export function scanEdge(
  hit: (t: number) => boolean,
  from: number,
  step: number,
  limit: number,
): number {
  let last = from;
  const dir = Math.sign(step);
  for (let t = from + step; dir > 0 ? t <= limit : t >= limit; t += step) {
    if (!hit(t)) {
      let a = last;
      let b = t;
      while (Math.abs(b - a) > 0.01) {
        const m = (a + b) / 2;
        if (hit(m)) a = m;
        else b = m;
      }
      return a;
    }
    last = t;
  }
  return last;
}
