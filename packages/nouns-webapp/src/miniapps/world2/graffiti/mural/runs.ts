// ── Pressure strokes on the g3 wire: runs of constant radius ────────────
//
// Pure (no three.js, no DOM). A pen stroke has a radius per point. The g3
// format has one radius per stroke, so a pressure stroke goes out as RUNS:
// consecutive strokes of constant radius sharing their end points, every
// run after the first flagged `join` (an overlong point-count varint, see
// strokes.ts). Old clients draw the runs as they are: a faithful stepped
// line. New clients join them back up (joinRuns) and draw one stroke whose
// width follows the runs smoothly (radii interpolated along its length).
//
// The radius ladder is geometric (each rung ~18% wider than the last), so a
// slow swell from a fine line to a fat one is a handful of runs, not one per
// point: a pressure stroke costs a few strokes of a tag's 48.

import type { DrawItem } from '../history';

import { MAX_POINTS, MAX_RADIUS_MM, MIN_RADIUS_MM, quantRadius, type Stroke } from '../strokes';

/** Radius ratio between neighbouring rungs of the ladder. */
export const RUN_RATIO = 1.18;
/** At most this many runs per stroke (the ladder coarsens until it fits). */
export const MAX_RUNS = 14;

/** Snap a radius (mm) to the run ladder (2 mm steps, as stored). */
export function rung(r: number, ratio = RUN_RATIO): number {
  const c = Math.max(MIN_RADIUS_MM, Math.min(MAX_RADIUS_MM, r));
  const k = Math.round(Math.log(c / MIN_RADIUS_MM) / Math.log(ratio));
  return quantRadius(MIN_RADIUS_MM * Math.pow(ratio, k));
}

/**
 * Ramer–Douglas–Peucker over (u, v, r): drops points that sit on the line
 * through their neighbours in position AND radius, so the taper survives.
 */
export function simplifyVar(
  pts: number[],
  rs: number[],
  eps: number,
): { pts: number[]; rs: number[] } {
  const n = pts.length / 2;
  if (n <= 2) return { pts: pts.slice(), rs: rs.slice(0, n) };
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack: number[] = [0, n - 1];
  const eps2 = eps * eps;
  while (stack.length > 0) {
    const b = stack.pop()!;
    const a = stack.pop()!;
    const ax = pts[a * 2];
    const ay = pts[a * 2 + 1];
    const ar = rs[a];
    const dx = pts[b * 2] - ax;
    const dy = pts[b * 2 + 1] - ay;
    const dr = rs[b] - ar;
    const len2 = dx * dx + dy * dy + dr * dr;
    let best = -1;
    let bestD = eps2;
    for (let i = a + 1; i < b; i++) {
      const px = pts[i * 2] - ax;
      const py = pts[i * 2 + 1] - ay;
      const pr = rs[i] - ar;
      let d2: number;
      if (len2 === 0) d2 = px * px + py * py + pr * pr;
      else {
        const t = Math.max(0, Math.min(1, (px * dx + py * dy + pr * dr) / len2));
        const ex = px - t * dx;
        const ey = py - t * dy;
        const er = pr - t * dr;
        d2 = ex * ex + ey * ey + er * er;
      }
      if (d2 > bestD) {
        bestD = d2;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push(a, best, best, b);
    }
  }
  const op: number[] = [];
  const or: number[] = [];
  for (let i = 0; i < n; i++)
    if (keep[i]) {
      op.push(pts[i * 2], pts[i * 2 + 1]);
      or.push(rs[i]);
    }
  return { pts: op, rs: or };
}

type Look = Pick<Stroke, 'color' | 'hard' | 'opacity'>;

function cut(look: Look, pts: number[], rs: number[], ratio: number): Stroke[] {
  const n = pts.length / 2;
  const out: Stroke[] = [];
  let start = 0;
  let r = rung(rs[0], ratio);
  for (let i = 1; i < n; i++) {
    const q = rung(rs[i], ratio);
    // A new rung, and the run so far has a segment: close it at this point
    // (shared with the next run, so the line never breaks)
    if (q !== r && i - start >= 1 && i < n - 1) {
      out.push({ ...look, r, pts: pts.slice(start * 2, i * 2 + 2) });
      start = i;
      r = q;
    }
  }
  out.push({ ...look, r, pts: pts.slice(start * 2) });
  // Long runs: MAX_POINTS per stroke, split (joined) where needed
  const fit: Stroke[] = [];
  for (const s of out) {
    let p = s.pts;
    while (p.length / 2 > MAX_POINTS) {
      fit.push({ ...s, pts: p.slice(0, MAX_POINTS * 2) });
      p = p.slice(MAX_POINTS * 2 - 2);
    }
    fit.push({ ...s, pts: p });
  }
  fit.forEach((s, i) => {
    if (i > 0) s.join = true;
    else delete s.join;
  });
  return fit;
}

function boxSmooth(rs: number[], k: number): number[] {
  const n = rs.length;
  if (k >= n * 2) {
    let m = 0;
    for (const r of rs) m += r;
    return rs.map(() => m / n);
  }
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let c = 0;
    for (let j = Math.max(0, i - k); j <= Math.min(n - 1, i + k); j++) {
      sum += rs[j];
      c++;
    }
    out[i] = sum / c;
  }
  return out;
}

/**
 * Cut a per-point-radius stroke into wire strokes: one per rung of radius,
 * joined. A stroke that never leaves one rung is one ordinary stroke.
 */
export function splitRuns(look: Look, pts: number[], rs: number[]): Stroke[] {
  if (pts.length < 2) return [];
  let ratio = RUN_RATIO;
  let runs = cut(look, pts, rs, ratio);
  while (runs.length > MAX_RUNS && ratio < 3) {
    ratio *= 1.25;
    runs = cut(look, pts, rs, ratio);
  }
  // Still too jumpy (a pen flickering between light and hard): even the
  // radius out along the line, wider each time, until it fits
  let soft = rs;
  for (let k = 2; runs.length > MAX_RUNS; k *= 2) {
    soft = boxSmooth(soft, k);
    runs = cut(look, pts, soft, ratio);
  }
  return runs;
}

/** Can `s` join on to `prev` (same look, starting where it ended)? */
export function continues(prev: Stroke, s: Stroke): boolean {
  const n = prev.pts.length;
  return (
    s.join === true &&
    s.color === prev.color &&
    s.hard === prev.hard &&
    s.opacity === prev.opacity &&
    n >= 2 &&
    s.pts[0] === prev.pts[n - 2] &&
    s.pts[1] === prev.pts[n - 1]
  );
}

/**
 * Per-point radii for a chain of joined runs: each run's radius sits at its
 * middle (along the line), and points in between are interpolated, so the
 * width swells and tapers instead of stepping. Returns the merged points.
 */
export function mergeRuns(runs: Stroke[]): { pts: number[]; rs: number[] } {
  const pts: number[] = [];
  for (let k = 0; k < runs.length; k++) {
    const p = runs[k].pts;
    for (let i = k === 0 ? 0 : 2; i < p.length; i++) pts.push(p[i]);
  }
  const n = pts.length / 2;
  // Arc length at every merged point
  const s = new Float64Array(n);
  for (let i = 1; i < n; i++)
    s[i] = s[i - 1] + Math.hypot(pts[i * 2] - pts[i * 2 - 2], pts[i * 2 + 1] - pts[i * 2 - 1]);
  // Anchor: run k's radius at its middle
  const at: number[] = [];
  const ar: number[] = [];
  let base = 0;
  for (let k = 0; k < runs.length; k++) {
    const m = runs[k].pts.length / 2;
    const first = base;
    const last = base + m - 1;
    at.push((s[first] + s[Math.min(n - 1, last)]) / 2);
    ar.push(runs[k].r);
    base = last;
  }
  const rs: number[] = new Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const x = s[i];
    while (j < at.length - 2 && at[j + 1] < x) j++;
    let r: number;
    if (at.length === 1 || x <= at[0]) r = ar[0];
    else if (x >= at[at.length - 1]) r = ar[ar.length - 1];
    else {
      const span = at[j + 1] - at[j];
      const t = span > 1e-9 ? (x - at[j]) / span : 0;
      r = ar[j] + (ar[j + 1] - ar[j]) * Math.max(0, Math.min(1, t));
    }
    rs[i] = r;
  }
  return { pts, rs };
}

/**
 * Join chains of runs in a wall's draw list into single variable-width
 * items (`rs` set). Lists without a joined stroke come back as they are.
 */
export function joinRuns(items: DrawItem[]): DrawItem[] {
  let any = false;
  for (const it of items)
    if (it.kind === 'stroke' && it.stroke.join === true) {
      any = true;
      break;
    }
  if (!any) return items;
  const out: DrawItem[] = [];
  let i = 0;
  while (i < items.length) {
    const it = items[i];
    if (it.kind !== 'stroke') {
      out.push(it);
      i++;
      continue;
    }
    const chain = [it.stroke];
    let j = i + 1;
    for (; j < items.length; j++) {
      const nx = items[j];
      if (nx.kind !== 'stroke' || !continues(chain[chain.length - 1], nx.stroke)) break;
      chain.push(nx.stroke);
    }
    if (chain.length === 1) out.push(it);
    else {
      const { pts, rs } = mergeRuns(chain);
      let r = 0;
      for (const x of rs) r = Math.max(r, x);
      out.push({
        kind: 'stroke',
        stroke: {
          color: it.stroke.color,
          hard: it.stroke.hard,
          opacity: it.stroke.opacity,
          r,
          pts,
        },
        seed: it.seed,
        rs,
      });
    }
    i = j;
  }
  return out;
}
