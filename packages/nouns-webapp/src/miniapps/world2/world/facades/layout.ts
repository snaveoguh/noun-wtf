// ── Facade layout: walls → buildings → storeys × bays (pure, tested) ────
//
// The plaza's walls come from the baked GLB (every facade face is an axis-
// aligned rectangle). Each face is cut where buildings meet (a terrace
// face spans several footprints) and where a neighbour stands against it
// (a party wall is hidden up to the neighbour's parapet), then divided
// into storeys (the GLB's string courses sit every 3.4 m) and window bays.
//
// Frames: a face has an outward normal along ±X or ±Z, a plane coordinate
// `at`, and `s` running along it (world x for ±Z faces, world z for ±X).
// `d` is the distance out from the face.

import type { Footprint, Rect } from '../../interiors/doors';
import type { FacadeStyle } from './styles';

import { STOREY } from './styles';

export interface WallFace {
  nx: number;
  nz: number;
  at: number;
  s0: number;
  s1: number;
  y0: number;
  y1: number;
}

export type WallKind = 'front' | 'side' | 'back';

export interface WallSegment {
  face: WallFace;
  /** The building this stretch belongs to (null: none found; styled like the nearest). */
  fp: Footprint | null;
  /** Building whose style it borrows (fp, or the nearest one). */
  styleOf: Footprint | null;
  s0: number;
  s1: number;
  /** Hidden below this height (a neighbour stands against it). */
  cover: number;
  kind: WallKind;
}

/** World x/z of a point on a face. */
export function faceToWorld(f: WallFace, s: number, d: number): { x: number; z: number } {
  return f.nz !== 0 ? { x: s, z: f.at + d * f.nz } : { x: f.at + d * f.nx, z: s };
}

function contains(r: Rect, x: number, z: number, eps = 0.02): boolean {
  return x > r.minX - eps && x < r.maxX + eps && z > r.minZ - eps && z < r.maxZ + eps;
}

/** Which way a wall at (x, z) facing (nx, nz) looks, relative to the plaza's centre. */
export function wallKind(nx: number, nz: number, x: number, z: number): WallKind {
  const len = Math.hypot(x, z);
  if (len < 1e-6) return 'front';
  const toward = -(nx * x + nz * z) / len;
  return toward > 0.5 ? 'front' : toward < -0.5 ? 'back' : 'side';
}

/** Parapet height above a roof (the GLB's facades rise this far over the roof floor). */
export const PARAPET = 0.9;

/**
 * Cut a face into the stretches of each building on its inside, each with
 * the height a neighbour on its outside hides it up to.
 */
export function segmentFace(
  face: WallFace,
  fps: readonly Footprint[],
  /** More places to cut (where another wall meets this one). */
  extra: readonly number[] = [],
): WallSegment[] {
  const cuts = new Set<number>([face.s0, face.s1]);
  for (const v of extra) if (v > face.s0 + 0.05 && v < face.s1 - 0.05) cuts.add(v);
  const near = (r: Rect) =>
    face.nz !== 0
      ? Math.abs(r.minZ - face.at) < 0.6 || Math.abs(r.maxZ - face.at) < 0.6
      : Math.abs(r.minX - face.at) < 0.6 || Math.abs(r.maxX - face.at) < 0.6;
  for (const fp of fps) {
    if (!near(fp)) continue;
    for (const v of face.nz !== 0 ? [fp.minX, fp.maxX] : [fp.minZ, fp.maxZ])
      if (v > face.s0 + 0.05 && v < face.s1 - 0.05) cuts.add(v);
  }
  const sorted = [...cuts].sort((a, b) => a - b);
  const out: WallSegment[] = [];
  for (let i = 0; i + 1 < sorted.length; i++) {
    const s0 = sorted[i]!;
    const s1 = sorted[i + 1]!;
    if (s1 - s0 < 0.05) continue;
    const m = (s0 + s1) / 2;
    const inside = faceToWorld(face, m, -0.3);
    const outside = faceToWorld(face, m, 0.3);
    const fp = fps.find(r => contains(r, inside.x, inside.z)) ?? null;
    const nb = fps.find(r => r !== fp && contains(r, outside.x, outside.z, -0.01)) ?? null;
    let styleOf = fp;
    if (styleOf === null) {
      let best = Infinity;
      for (const r of fps) {
        const dx = Math.max(r.minX - inside.x, 0, inside.x - r.maxX);
        const dz = Math.max(r.minZ - inside.z, 0, inside.z - r.maxZ);
        const dd = Math.hypot(dx, dz);
        if (dd < best) {
          best = dd;
          styleOf = r;
        }
      }
    }
    const mid = faceToWorld(face, m, 0);
    out.push({
      face,
      fp,
      styleOf,
      s0,
      s1,
      cover: nb !== null ? nb.ground + nb.height + PARAPET : face.y0,
      kind: wallKind(face.nx, face.nz, mid.x, mid.z),
    });
  }
  // Merge neighbouring stretches of the same building with the same cover
  const merged: WallSegment[] = [];
  for (const s of out) {
    const last = merged[merged.length - 1];
    if (
      last !== undefined &&
      last.fp === s.fp &&
      last.styleOf === s.styleOf &&
      Math.abs(last.cover - s.cover) < 1e-3 &&
      Math.abs(last.s1 - s.s0) < 1e-6 &&
      !extra.some(v => Math.abs(v - s.s0) < 1e-6)
    )
      last.s1 = s.s1;
    else merged.push({ ...s });
  }
  return merged;
}

export type RowKind = 'ground' | 'storey' | 'parapet';

export interface Row {
  y0: number;
  y1: number;
  kind: RowKind;
  /** 0 = ground floor. */
  floor: number;
}

/** Storeys of a wall from y0 up to y1, with its roof at `roof`. */
export function rowsFor(roof: number, y0: number, y1: number): Row[] {
  const rows: Row[] = [];
  const top = Math.min(roof, y1);
  let y = 0;
  let floor = 0;
  while (y < top - 0.05) {
    let next = y + STOREY;
    // A short leftover joins the storey under it
    if (top - next < 0.6) next = top;
    rows.push({ y0: y, y1: next, kind: floor === 0 ? 'ground' : 'storey', floor });
    y = next;
    floor++;
  }
  if (y1 > top + 0.05) rows.push({ y0: top, y1, kind: 'parapet', floor });
  return rows.filter(r => r.y1 > y0 + 0.01).map(r => ({ ...r, y0: Math.max(r.y0, y0) }));
}

/**
 * Where other walls meet a face (their planes cross it inside its span):
 * a terrace's buildings of different heights, a set-back. Stretches are cut
 * there so nothing runs past a corner into the next wall.
 */
export function meetingCuts(face: WallFace, faces: readonly WallFace[]): number[] {
  const out: number[] = [];
  for (const g of faces) {
    if (g === face || (g.nz !== 0) === (face.nz !== 0)) continue;
    if (g.at <= face.s0 + 0.05 || g.at >= face.s1 - 0.05) continue;
    if (face.at < g.s0 - 0.05 || face.at > g.s1 + 0.05) continue;
    if (g.y1 <= face.y0 || g.y0 >= face.y1) continue;
    out.push(g.at);
  }
  return out;
}

/** The roof a face stands under: its building's, or lower when the face itself is (a split terrace). */
export function roofFor(fpRoof: number, face: WallFace): number {
  const own = face.y1 - PARAPET;
  return own > STOREY && own < fpRoof - 0.3 ? own : fpRoof;
}

/** Equal bays near `bay` wide across [s0, s1]. */
export function baysFor(s0: number, s1: number, bay: number): [number, number][] {
  const n = Math.max(1, Math.round((s1 - s0) / bay));
  const w = (s1 - s0) / n;
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) out.push([s0 + i * w, i === n - 1 ? s1 : s0 + (i + 1) * w]);
  return out;
}

export type Tile = 'win' | 'blank' | 'base' | 'parapet';

export interface Cell {
  s0: number;
  s1: number;
  y0: number;
  y1: number;
  /** The full storey this cell is cut from (for texture v). */
  rowY0: number;
  rowY1: number;
  tile: Tile;
  floor: number;
  bay: number;
}

/** Window opening inside a bay, per style: width (fraction of the bay), sill and head above the floor. */
export const WINDOW: Record<FacadeStyle, { w: number; y0: number; y1: number }> = {
  tenement: { w: 0.42, y0: 0.95, y1: 2.65 },
  modern: { w: 0.9, y0: 0.35, y1: 3.0 },
  deco: { w: 0.46, y0: 0.8, y1: 2.85 },
  brownstone: { w: 0.44, y0: 0.9, y1: 2.85 },
  loft: { w: 0.7, y0: 0.7, y1: 2.95 },
  shopfront: { w: 0.48, y0: 1.0, y1: 2.6 },
};

/** The cells (storey × bay, clipped to what shows) of one wall stretch. */
export function cellsFor(seg: WallSegment, bay: number, roof: number): Cell[] {
  const shown = Math.max(seg.face.y0, seg.cover);
  if (shown >= seg.face.y1 - 0.01) return [];
  const rows = rowsFor(roof, shown, seg.face.y1);
  const bays = baysFor(seg.s0, seg.s1, bay);
  const out: Cell[] = [];
  for (const r of rows) {
    // Full row extents (before the clip) for the texture
    const full = r.kind === 'parapet' ? { y0: roof, y1: seg.face.y1 } : null;
    const rowY0 = full?.y0 ?? r.floor * STOREY;
    const rowY1 = full?.y1 ?? Math.max(r.y1, rowY0 + 0.01);
    const tile: Tile =
      r.kind === 'parapet'
        ? 'parapet'
        : r.kind === 'ground'
          ? 'base'
          : seg.kind === 'side'
            ? 'blank'
            : 'win';
    bays.forEach(([s0, s1], i) =>
      out.push({ s0, s1, y0: r.y0, y1: r.y1, rowY0, rowY1, tile, floor: r.floor, bay: i }),
    );
  }
  return out;
}

/** A rectangle on a wall (s along it, y up). */
export interface WallRect {
  s0: number;
  s1: number;
  y0: number;
  y1: number;
}

export function rectsOverlap(a: WallRect, b: WallRect, pad = 0): boolean {
  return a.s0 < b.s1 + pad && a.s1 > b.s0 - pad && a.y0 < b.y1 + pad && a.y1 > b.y0 - pad;
}

/** [y0, y1] minus the parts of `rects` a vertical strip at s (± half) runs through. */
export function freeAlong(
  y0: number,
  y1: number,
  s: number,
  half: number,
  rects: readonly WallRect[],
  pad = 0.12,
): [number, number][] {
  let out: [number, number][] = [[y0, y1]];
  for (const r of rects) {
    if (s + half <= r.s0 - pad || s - half >= r.s1 + pad) continue;
    const next: [number, number][] = [];
    for (const [a, b] of out) {
      if (b <= r.y0 - pad || a >= r.y1 + pad) next.push([a, b]);
      else {
        if (r.y0 - pad > a) next.push([a, r.y0 - pad]);
        if (r.y1 + pad < b) next.push([r.y1 + pad, b]);
      }
    }
    out = next;
  }
  return out.filter(([a, b]) => b - a > 0.2);
}

/** [s0, s1] minus the parts of `rects` a horizontal band at y (± half) runs through. */
export function freeAcross(
  s0: number,
  s1: number,
  y: number,
  half: number,
  rects: readonly WallRect[],
  pad = 0.12,
): [number, number][] {
  const flipped = rects.map(r => ({ s0: r.y0, s1: r.y1, y0: r.s0, y1: r.s1 }));
  return freeAlong(s0, s1, y, half, flipped, pad);
}

export interface Opening {
  s0: number;
  s1: number;
  y0: number;
  y1: number;
  floor: number;
  bay: number;
}

/** The window openings of a wall's cells (where sills, lintels and frames go). */
export function windowsOf(cells: readonly Cell[], style: FacadeStyle): Opening[] {
  const w = WINDOW[style];
  const out: Opening[] = [];
  for (const c of cells) {
    if (c.tile !== 'win') continue;
    // Only full storeys carry a window (a clipped one is behind a neighbour)
    if (c.y0 > c.rowY0 + w.y0 - 0.01) continue;
    const mid = (c.s0 + c.s1) / 2;
    const half = ((c.s1 - c.s0) * w.w) / 2;
    const y0 = c.rowY0 + w.y0;
    const y1 = Math.min(c.rowY0 + w.y1, c.rowY1 - 0.15);
    if (y1 - y0 < 0.5) continue;
    out.push({ s0: mid - half, s1: mid + half, y0, y1, floor: c.floor, bay: c.bay });
  }
  return out;
}

/** A door on a wall, in its frame: centre and width along s, from the ground up. */
export interface DoorRect {
  s: number;
  width: number;
  height: number;
}

export function overlapsDoor(r: { s0: number; s1: number; y0: number }, door: DoorRect): boolean {
  return r.s0 < door.s + door.width / 2 && r.s1 > door.s - door.width / 2 && r.y0 < door.height;
}

/**
 * Where on a wall stretch a fire escape of `length` fits: clear of the
 * door (and a margin), of `blocked` stretches (balconies), and of the
 * stretch's ends. Returns the span and which end the ladder (end B) is at:
 * the end farther from the door. Null when nothing fits.
 */
export function escapeSpan(
  s0: number,
  s1: number,
  door: DoorRect | null,
  blocked: readonly [number, number][],
  lengths: readonly number[],
  margin = 0.35,
): { a: number; b: number; ladderAtS1: boolean; length: number } | null {
  const clear = (a: number, b: number) => {
    if (door !== null && a < door.s + door.width / 2 + 1.0 && b > door.s - door.width / 2 - 1.0)
      return false;
    return blocked.every(([p, q]) => b <= p - 0.2 || a >= q + 0.2);
  };
  for (const len of lengths) {
    let best: { a: number; b: number; score: number } | null = null;
    for (let a = s0 + margin; a + len <= s1 - margin + 1e-9; a += 0.25) {
      const b = a + len;
      if (!clear(a, b)) continue;
      // Far from the door, else hard against an end of the wall
      const score =
        door !== null
          ? Math.min(Math.abs(a - door.s), Math.abs(b - door.s))
          : -Math.min(a - s0, s1 - b);
      if (best === null || score > best.score + 1e-9) best = { a, b, score };
    }
    if (best !== null) {
      const ladderAtS1 =
        door !== null
          ? Math.abs(best.b - door.s) > Math.abs(best.a - door.s)
          : best.b - (s0 + s1) / 2 > (s0 + s1) / 2 - best.a;
      return { a: best.a, b: best.b, ladderAtS1, length: len };
    }
  }
  return null;
}
