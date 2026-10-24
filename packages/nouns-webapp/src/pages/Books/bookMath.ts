// The flipbook's pure parts: which pages show at a given view, the page-turn
// geometry (a corner dragged across the page folds it along the perpendicular
// bisector of corner → pointer), and search over the book's text.
//
// Pages are numbered from 1. Page 1 is the front cover, which sits alone on
// the right like a real closed book; the last page (the back cover, when the
// count is even) sits alone on the left.

/** 'spread': two pages side by side (desktop). 'single': one page (phones). */
export type Layout = 'spread' | 'single';

export interface View {
  /** Left page number, or null (nothing there: the closed front cover, or single layout) */
  left: number | null;
  /** Right page number, or null (the back cover is showing alone on the left) */
  right: number | null;
}

/** How many views (spreads or single pages) a book of `pages` has. */
export function viewCount(pages: number, layout: Layout): number {
  if (pages <= 0) return 0;
  return layout === 'single' ? pages : Math.floor(pages / 2) + 1;
}

const inBook = (n: number, pages: number): number | null => (n >= 1 && n <= pages ? n : null);

/** The pages showing at view `i`. */
export function viewAt(i: number, pages: number, layout: Layout): View {
  if (layout === 'single') return { left: null, right: inBook(i + 1, pages) };
  return { left: inBook(2 * i, pages), right: inBook(2 * i + 1, pages) };
}

/** The view that shows page `n` (clamped into the book). */
export function viewOfPage(n: number, pages: number, layout: Layout): number {
  const p = Math.min(Math.max(1, Math.round(n)), Math.max(1, pages));
  return layout === 'single' ? p - 1 : Math.floor(p / 2);
}

/** The page a view "is on", for the URL and for switching layouts. */
export function firstPageOf(i: number, pages: number, layout: Layout): number {
  const v = viewAt(i, pages, layout);
  return v.left ?? v.right ?? 1;
}

/** "12–13 / 252", "1 / 252" */
export function pageLabel(v: View, pages: number): string {
  const nums = [v.left, v.right].filter((n): n is number => n !== null);
  return `${nums.join('–')} / ${pages}`;
}

/**
 * The pages involved in turning from view `base` to `base + 1`. A turn back
 * is the same turn played in reverse (base = current - 1), so one geometry
 * covers both directions.
 *  - `left`: stays put on the left while the leaf turns
 *  - `under`: revealed on the right as the leaf lifts
 *  - `front` / `back`: the two sides of the turning leaf. In single layout
 *    the back is blank paper (null), since only one page is ever in view.
 */
export interface Turn {
  left: number | null;
  under: number | null;
  front: number | null;
  back: number | null;
}

export function turnPages(base: number, pages: number, layout: Layout): Turn {
  const a = viewAt(base, pages, layout);
  const b = viewAt(base + 1, pages, layout);
  return {
    left: a.left,
    under: b.right,
    front: a.right,
    back: layout === 'single' ? null : b.left,
  };
}

/** Pages worth preloading around view `i` (this one, then the neighbours). */
export function neighbourPages(i: number, pages: number, layout: Layout, reach = 2): number[] {
  const out: number[] = [];
  const add = (n: number | null) => {
    if (n !== null && !out.includes(n)) out.push(n);
  };
  const views = viewCount(pages, layout);
  for (let d = 0; d <= reach; d++) {
    for (const j of d === 0 ? [i] : [i + d, i - d]) {
      if (j < 0 || j >= views) continue;
      const v = viewAt(j, pages, layout);
      add(v.left);
      add(v.right);
    }
  }
  return out;
}

// ─── Turn geometry ────────────────────────────────────────────────────────
//
// Book coordinates: origin at the top of the spine, x to the right, y down.
// The turning leaf is always the right-hand page [0, W] × [0, H]; its corner
// C is (W, 0) or (W, H). Dragging the corner to P folds the leaf along the
// perpendicular bisector of C→P. The turn is complete when P reaches the
// mirror corner (-W, C.y): the leaf lies flat on the left.

export interface Pt {
  x: number;
  y: number;
}

/** 2D affine matrix, CSS `matrix(a, b, c, d, e, f)` order. */
export type Mat = [number, number, number, number, number, number];

export const I: Mat = [1, 0, 0, 1, 0, 0];

export function mul(m: Mat, n: Mat): Mat {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

export function inv(m: Mat): Mat {
  const det = m[0] * m[3] - m[1] * m[2];
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

export const apply = (m: Mat, p: Pt): Pt => ({
  x: m[0] * p.x + m[2] * p.y + m[4],
  y: m[1] * p.x + m[3] * p.y + m[5],
});

const tr = (x: number, y: number): Mat => [1, 0, 0, 1, x, y];
const rot = (a: number): Mat => [Math.cos(a), Math.sin(a), -Math.sin(a), Math.cos(a), 0, 0];

export const css = (m: Mat): string =>
  `matrix(${m.map(v => (Math.abs(v) < 1e-9 ? 0 : +v.toFixed(5))).join(',')})`;

/** Corner the leaf is grabbed by. */
export const corner = (W: number, H: number, top: boolean): Pt => ({ x: W, y: top ? 0 : H });

/**
 * Keep the dragged corner where paper can actually go: no further than W
 * from the spine end of its own edge, nor further than the page diagonal
 * from the other spine end (the leaf is bound along the whole spine).
 */
export function constrain(p: Pt, W: number, H: number, top: boolean): Pt {
  let q = { ...p };
  const pull = (anchor: Pt, r: number) => {
    const dx = q.x - anchor.x;
    const dy = q.y - anchor.y;
    const d = Math.hypot(dx, dy);
    if (d > r) q = { x: anchor.x + (dx * r) / d, y: anchor.y + (dy * r) / d };
  };
  pull({ x: 0, y: top ? 0 : H }, W);
  pull({ x: 0, y: top ? H : 0 }, Math.hypot(W, H));
  return q;
}

/** How far through the turn a dragged corner is: 0 flat on the right, 1 flat on the left. */
export function dragProgress(p: Pt, W: number): number {
  return Math.min(1, Math.max(0, (W - p.x) / (2 * W)));
}

/**
 * Where to put the corner for a turn `t` (0..1) of the way through: an arc
 * from C to its mirror, lifted off the page in the middle like a hand would.
 */
export function cornerAt(t: number, W: number, H: number, top: boolean): Pt {
  const e = Math.min(1, Math.max(0, t));
  const lift = Math.sin(Math.PI * e) * H * 0.16;
  return { x: W - 2 * W * e, y: top ? lift : H - lift };
}

/** Whether a released drag completes the turn (past half way, or flicked). */
export function settles(progress: number, velocityX: number, W: number): boolean {
  const flick = (0.6 * W) / 1000; // px per ms, leftwards
  if (velocityX < -flick) return true;
  if (velocityX > flick) return false;
  return progress > 0.5;
}

export interface Fold {
  /** Clip box (BIG × BIG) covering the half-plane on the spine side of the fold */
  clip: Mat;
  /** The leaf's front, inside the clip box */
  front: Mat;
  /** The leaf's back (folded over), inside the clip box */
  back: Mat;
  /** Shading along the fold: a strip `size` px wide, inside the clip box, ending at the fold */
  fold: Mat;
  /** Fold line in book coordinates (a point on it and the unit normal pointing at the corner) */
  mid: Pt;
  normal: Pt;
  /** Rotation of the fold line, radians */
  angle: number;
  progress: number;
}

/**
 * Transforms for a leaf (W × H) whose corner C has been dragged to P. All
 * matrices are CSS transforms with transform-origin 0 0; `front`, `back` and
 * `fold` are relative to the clip box. Returns null when nothing is folded.
 */
export function foldAt(P: Pt, W: number, H: number, top: boolean, big: number): Fold | null {
  const C = corner(W, H, top);
  const dx = C.x - P.x;
  const dy = C.y - P.y;
  const d = Math.hypot(dx, dy);
  if (d < 0.5) return null;
  const normal = { x: dx / d, y: dy / d };
  const mid = { x: (C.x + P.x) / 2, y: (C.y + P.y) / 2 };
  const angle = Math.atan2(normal.y, normal.x);
  // The clip box's right edge lies on the fold line, centred on `mid`.
  const clip = mul(mul(tr(mid.x, mid.y), rot(angle)), tr(-big, -big / 2));
  const toClip = inv(clip);
  // Reflection across the fold line.
  const refl = mul(
    mul(mul(tr(mid.x, mid.y), rot(angle)), [-1, 0, 0, 1, 0, 0]),
    mul(rot(-angle), tr(-mid.x, -mid.y)),
  );
  // A point on the leaf's back at back-image (x, y) is leaf point (W - x, y).
  const flip: Mat = [-1, 0, 0, 1, W, 0];
  return {
    clip,
    front: toClip,
    back: mul(toClip, mul(refl, flip)),
    fold: tr(big, 0),
    mid,
    normal,
    angle,
    progress: dragProgress(P, W),
  };
}

// ─── Search ───────────────────────────────────────────────────────────────

export interface PageText {
  n: number;
  text: string;
}

export interface Hit {
  page: number;
  /** A bit of text around the first match, with the match at [start, end) */
  snippet: string;
  start: number;
  end: number;
  /** Matches on the page */
  count: number;
}

/** Fold case and accents and squash whitespace, so "café" finds "CAFE". */
export function normalise(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Pages containing `query`, in page order, with a snippet each. NFKD keeps
 * one char per char for Latin text, so the snippet offsets index `text`
 * well enough for highlighting; anything else just shows the snippet.
 */
export function searchPages(pages: PageText[], query: string, radius = 40, limit = 200): Hit[] {
  const q = normalise(query).trim();
  if (q.length < 2) return [];
  const hits: Hit[] = [];
  for (const p of pages) {
    const flat = p.text.replace(/\s+/g, ' ');
    const hay = normalise(flat);
    let at = hay.indexOf(q);
    if (at < 0) continue;
    const first = at;
    let count = 0;
    while (at >= 0) {
      count++;
      at = hay.indexOf(q, at + q.length);
    }
    const sameLength = hay.length === flat.length;
    const src = sameLength ? flat : hay;
    const s0 = Math.max(0, first - radius);
    const s1 = Math.min(src.length, first + q.length + radius);
    const lead = s0 > 0 ? '…' : '';
    const snippet = lead + src.slice(s0, s1) + (s1 < src.length ? '…' : '');
    hits.push({
      page: p.n,
      snippet,
      start: lead.length + first - s0,
      end: lead.length + first - s0 + q.length,
      count,
    });
    if (hits.length >= limit) break;
  }
  return hits;
}
