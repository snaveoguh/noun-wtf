// ── Facade detailing: skins, mouldings, signs, fire escapes (pure) ──────
//
// Builds a building's geometry into plain arrays (Geo) from its plan:
//   skin   — the wall itself, re-tiled in the building's style (exactly in
//            the GLB wall's plane: the GLB facade it replaces is hidden, so
//            nothing is coplanar), carrying the baked lightmap across;
//   detail — sills, lintels, hoods, cornices, mullions, fins, bay windows,
//            sign boxes, door railings, fire escapes;
//   fine   — the small stuff a phone skips: AC units, drainpipes,
//            brackets, shutter slats, balusters.
// Every overlay starts 5 cm inside the wall (its back face is dropped) and
// stands at least 6 cm proud, so no face of it lies on a wall.

import type { Footprint } from '../../interiors/doors';
import type { EscapePart, EscapePlan } from './escape';
import type { FaceRect } from './faces';
import type { RGB, V3 } from './geom';
import type { Cell, DoorRect, Opening, WallRect, WallSegment } from './layout';
import type { FacadeStyle } from './styles';

import { mulberry32 } from '../../interiors/rng';
import { signUv, tileUv } from './atlas';
import { lmAt } from './faces';
import { Geo, WallFrame, mix, rgb, scale } from './geom';
import { freeAcross, freeAlong, PARAPET, rectsOverlap, roofFor } from './layout';
import { STOREY } from './styles';

/** Overlays start this far inside the wall. */
export const IN = -0.05;
/** …and their nearest wall-parallel face stands at least this far out. */
export const MIN_PROUD = 0.06;
/**
 * Bands that run a whole stretch stop this short of its ends, so their end
 * caps never lie in the plane of the wall round the corner.
 */
export const END = 0.03;

export interface SegmentPlan {
  seg: WallSegment;
  face: FaceRect;
  cells: Cell[];
  windows: Opening[];
  door: DoorRect | null;
  /** The GLB's painted pieces and screens on this wall (graffiti, the mural): no relief over them. */
  decals: WallRect[];
}

export interface EscapePlacement {
  face: FaceRect;
  /** Span along the wall and which end the ladder (end B) is at. */
  a: number;
  b: number;
  ladderAtS1: boolean;
  plan: EscapePlan;
}

export interface BuildingPlan {
  key: string;
  fp: Footprint | null;
  style: FacadeStyle;
  variant: number;
  seed: number;
  segments: SegmentPlan[];
  escape: EscapePlacement | null;
  /** Sign slot (atlas) for its name board, if it gets one. */
  sign: number | null;
}

export interface BuildingGeo {
  skin: Geo;
  detail: Geo;
  fine: Geo;
  /** Fire escape collision (positions only, world space). */
  collide: Geo | null;
}

const TINTS: Record<FacadeStyle, RGB[]> = {
  tenement: [
    [1, 1, 1],
    [1.06, 0.93, 0.88],
    [0.86, 0.8, 0.78],
    [1.12, 1.04, 0.86],
  ],
  brownstone: [
    [1, 1, 1],
    [0.9, 0.9, 0.95],
    [1.1, 1.02, 0.95],
  ],
  modern: [
    [1, 1, 1],
    [0.92, 1.04, 1.12],
    [0.94, 1.1, 0.98],
    [1.12, 1.0, 0.86],
  ],
  deco: [
    [1, 1, 1],
    [1.0, 0.92, 0.9],
    [0.92, 1.0, 0.95],
    [1.0, 0.96, 0.86],
  ],
  loft: [
    [1, 1, 1],
    [0.9, 0.9, 0.95],
    [1.12, 1.05, 0.95],
    [1.45, 1.4, 1.35],
  ],
  shopfront: [
    [1, 0.86, 0.74],
    [0.8, 0.98, 0.86],
    [0.76, 0.88, 1],
    [1, 0.95, 0.72],
    [0.9, 0.82, 1],
    [1, 0.78, 0.72],
  ],
};

export function tintOf(style: FacadeStyle, variant: number): RGB {
  const ts = TINTS[style];
  return ts[Math.floor(variant * ts.length) % ts.length]!;
}

const STONE = rgb(0xe8dcc4);
const IRON = rgb(0x2a2c31);
const IRON_LIGHT = rgb(0x4a4f57);
const ALU = rgb(0xc5ced6);
const GOLD = rgb(0xd6b24c);
const AC = rgb(0xd9dcd8);
const PIPE = rgb(0x6c7178);

// ── Skin ────────────────────────────────────────────────────────────────

function skinQuad(
  g: Geo,
  f: WallFrame,
  face: FaceRect,
  s0: number,
  s1: number,
  y0: number,
  y1: number,
  d: number,
  uv: [number, number, number, number],
  v0f: number,
  v1f: number,
  color: RGB,
) {
  const [u0, va, u1, vb] = uv;
  const v0 = va + (vb - va) * v0f;
  const v1 = va + (vb - va) * v1f;
  const lm = face.lm;
  const l = (s: number, y: number): [number, number] => (lm === null ? [0, 0] : lmAt(lm, s, y));
  g.quad(
    f.p(s0, d, y0),
    f.p(s1, d, y0),
    f.p(s1, d, y1),
    f.p(s0, d, y1),
    f.n,
    color,
    [
      [u0, v0],
      [u1, v0],
      [u1, v1],
      [u0, v1],
    ],
    [l(s0, y0), l(s1, y0), l(s1, y1), l(s0, y1)],
  );
}

/** The building's walls, re-tiled (in the GLB wall planes). */
export function buildSkin(g: Geo, b: BuildingPlan) {
  const tint = tintOf(b.style, b.variant);
  for (const sp of b.segments) {
    const f = new WallFrame(sp.face.nx, sp.face.nz, sp.face.at);
    // A bay reads its tile along s; s grows the same way on every wall
    // seen from outside only for some normals, so mirror where it doesn't
    const flipU = sp.face.nz !== 0 ? sp.face.nz < 0 : sp.face.nx > 0;
    for (const c of sp.cells) {
      const uv = tileUv(b.style, c.tile);
      const span = c.rowY1 - c.rowY0;
      const v0f = (c.y0 - c.rowY0) / span;
      const v1f = (c.y1 - c.rowY0) / span;
      const [u0, va, u1, vb] = uv;
      skinQuad(
        g,
        f,
        sp.face,
        c.s0,
        c.s1,
        c.y0,
        c.y1,
        0,
        flipU ? [u1, va, u0, vb] : uv,
        v0f,
        v1f,
        tint,
      );
    }
  }
}

// ── Details ─────────────────────────────────────────────────────────────

function frameOf(sp: SegmentPlan) {
  return new WallFrame(sp.face.nx, sp.face.nz, sp.face.at);
}

function sills(
  g: Geo,
  f: WallFrame,
  ws: readonly Opening[],
  c: RGB,
  out = 0.13,
  lintel?: { c: RGB; h: number; out: number; ext: number },
) {
  for (const w of ws) {
    f.box(g, w.s0 - 0.07, w.s1 + 0.07, IN, out, w.y0 - 0.09, w.y0 - 0.01, c);
    if (lintel !== undefined)
      f.box(
        g,
        w.s0 - lintel.ext,
        w.s1 + lintel.ext,
        IN,
        lintel.out,
        w.y1,
        w.y1 + lintel.h,
        lintel.c,
      );
  }
}

function cornice(
  g: Geo,
  fine: Geo,
  f: WallFrame,
  sp: SegmentPlan,
  c: RGB,
  depth: number,
  brackets: boolean,
) {
  const top = sp.face.y1;
  if (
    sp.decals.some(r =>
      rectsOverlap(r, { s0: sp.seg.s0, s1: sp.seg.s1, y0: top - 0.8, y1: top + 0.1 }),
    )
  )
    return;
  const s0 = sp.seg.s0 + END;
  const s1 = sp.seg.s1 - END;
  f.box(g, s0, s1, IN, depth, top - 0.22, top + 0.1, c);
  f.box(g, s0, s1, IN, depth * 0.6, top - 0.42, top - 0.22, scale(c, 0.93));
  if (!brackets) return;
  const n = Math.max(2, Math.round((sp.seg.s1 - sp.seg.s0) / 0.9));
  for (let i = 0; i <= n; i++) {
    const s = sp.seg.s0 + 0.12 + ((sp.seg.s1 - sp.seg.s0 - 0.24) * i) / n;
    f.box(fine, s - 0.07, s + 0.07, IN, depth * 0.8, top - 0.75, top - 0.42, scale(c, 0.86));
  }
}

function drainpipe(
  fine: Geo,
  f: WallFrame,
  s: number,
  y0: number,
  y1: number,
  decals: readonly WallRect[] = [],
) {
  if (decals.some(r => rectsOverlap(r, { s0: s - 0.1, s1: s + 0.1, y0, y1 }))) return;
  const [x, , z] = f.p(s, 0.13, 0);
  fine.cylinder(x, z, y0, y1, 0.055, 6, PIPE, {});
  // brackets every 2 m
  for (let y = y0 + 1; y < y1; y += 2) f.box(fine, s - 0.03, s + 0.03, IN, 0.13, y, y + 0.06, PIPE);
  // the shoe at the bottom
  f.box(fine, s - 0.07, s + 0.07, IN, 0.3, y0, y0 + 0.1, PIPE);
}

function acUnits(fine: Geo, f: WallFrame, ws: readonly Opening[], rnd: () => number, p: number) {
  for (const w of ws) {
    if (rnd() > p) continue;
    const m = (w.s0 + w.s1) / 2 + (rnd() - 0.5) * 0.2;
    f.box(fine, m - 0.33, m + 0.33, IN, 0.48, w.y0 - 0.5, w.y0 - 0.1, AC);
    // grille
    f.box(fine, m - 0.26, m + 0.26, 0.4, 0.5, w.y0 - 0.44, w.y0 - 0.16, scale(AC, 0.7));
  }
}

/** Front-facing stretch the building's name and door belong to. */
function doorSegment(b: BuildingPlan): SegmentPlan | null {
  return b.segments.find(s => s.door !== null) ?? null;
}

function signBoard(
  g: Geo,
  skin: Geo,
  f: WallFrame,
  sp: SegmentPlan,
  slot: number,
  s0: number,
  s1: number,
  y0: number,
  y1: number,
) {
  const d = 0.2;
  f.box(g, s0 - 0.08, s1 + 0.08, IN, d - 0.02, y0 - 0.08, y1 + 0.08, IRON);
  const uv = signUv(slot);
  const flipU = sp.face.nz !== 0 ? sp.face.nz < 0 : sp.face.nx > 0;
  skinQuad(
    skin,
    f,
    sp.face,
    s0,
    s1,
    y0,
    y1,
    d,
    flipU ? [uv[2], uv[1], uv[0], uv[3]] : uv,
    0,
    1,
    [1.15, 1.15, 1.15],
  );
}

/** A sign board standing out from the wall (both faces lettered). */
function bladeSign(
  g: Geo,
  skin: Geo,
  f: WallFrame,
  sp: SegmentPlan,
  slot: number,
  s: number,
  y0: number,
) {
  const out0 = 0.3;
  const out1 = 1.25;
  const y1 = y0 + 0.62;
  // bracket arm + frame
  f.box(g, s - 0.03, s + 0.03, IN, out1 + 0.08, y1 + 0.05, y1 + 0.11, IRON);
  f.box(g, s - 0.05, s + 0.05, out0 - 0.04, out1 + 0.04, y0 - 0.04, y1 + 0.04, IRON);
  const uv = signUv(slot);
  const t = f.t;
  const lm = sp.face.lm;
  const l = (y: number): [number, number] => (lm === null ? [0, 0] : lmAt(lm, s, y));
  for (const side of [1, -1]) {
    const ss = s + side * 0.052;
    const a = f.p(ss, out0, y0);
    const b2 = f.p(ss, out1, y0);
    const c = f.p(ss, out1, y1);
    const d = f.p(ss, out0, y1);
    const n: V3 = [t[0] * side, 0, t[2] * side];
    // read left-to-right from either side
    const flip = (f.nz !== 0 ? f.nz * side > 0 : f.nx * side < 0) ? 1 : 0;
    const us = flip ? [uv[2], uv[0]] : [uv[0], uv[2]];
    skin.quad(
      a,
      b2,
      c,
      d,
      n,
      [1.15, 1.15, 1.15],
      [
        [us[0]!, uv[1]],
        [us[1]!, uv[1]],
        [us[1]!, uv[3]],
        [us[0]!, uv[3]],
      ],
      [l(y0), l(y0), l(y1), l(y1)],
    );
  }
}

/** Half-down roller shutters over a stretch of shop window (never the door). */
function shutters(g: Geo, fine: Geo, f: WallFrame, s0: number, s1: number) {
  const y0 = 1.85;
  const y1 = 3.12;
  f.box(g, s0, s1, 0.06, 0.2, y1 - 0.24, y1, IRON_LIGHT); // the drum housing
  f.box(g, s0 + 0.02, s1 - 0.02, 0.07, 0.14, y0, y1 - 0.24, rgb(0x9aa1a8));
  for (let y = y0 + 0.09; y < y1 - 0.26; y += 0.09)
    f.box(fine, s0 + 0.02, s1 - 0.02, 0.07, 0.155, y, y + 0.025, rgb(0x7d848c));
  f.box(g, s0 + 0.02, s1 - 0.02, 0.07, 0.17, y0 - 0.05, y0 + 0.02, IRON_LIGHT);
}

/**
 * Where half-down shutters go on a shop's street wall: over the shop
 * window on the far side of the door, never within 1.2 m of it.
 */
export function shutterSpan(s0: number, s1: number, door: DoorRect): [number, number] | null {
  if (s1 - s0 < 7) return null;
  const left = door.s - s0 > s1 - door.s;
  const a = left ? s0 + 0.4 : door.s + door.width / 2 + 1.2;
  const b = left ? door.s - door.width / 2 - 1.2 : s1 - 0.4;
  if (b - a < 1.2) return null;
  return [a, Math.min(b, a + 3.4)];
}

function bayWindow(
  g: Geo,
  skin: Geo,
  f: WallFrame,
  sp: SegmentPlan,
  b: BuildingPlan,
  s0: number,
  s1: number,
  y0: number,
  y1: number,
  stone: RGB,
) {
  const d = 0.42;
  const tint = tintOf(b.style, b.variant);
  // front: window tiles, one per storey
  const uv = tileUv(b.style, 'win');
  const flipU = sp.face.nz !== 0 ? sp.face.nz < 0 : sp.face.nx > 0;
  for (let y = y0; y < y1 - 0.5; y += STOREY) {
    const top = Math.min(y + STOREY, y1);
    skinQuad(
      skin,
      f,
      sp.face,
      s0,
      s1,
      y,
      top,
      d,
      flipU ? [uv[2], uv[1], uv[0], uv[3]] : uv,
      0,
      (top - y) / STOREY,
      tint,
    );
  }
  // sides, cap and corbel in stone
  f.box(g, s0 - 0.12, s0, IN, d, y0, y1, stone);
  f.box(g, s1, s1 + 0.12, IN, d, y0, y1, stone);
  f.box(g, s0 - 0.18, s1 + 0.18, IN, d + 0.1, y1, y1 + 0.18, scale(stone, 1.05));
  f.box(g, s0 - 0.12, s1 + 0.12, IN, d + 0.04, y0 - 0.3, y0, scale(stone, 0.9));
}

function doorRailings(g: Geo, f: WallFrame, door: DoorRect) {
  for (const side of [-1, 1]) {
    const s = door.s + side * (door.width / 2 + 0.45);
    // newel post + a rail running out from the wall
    f.box(g, s - 0.12, s + 0.12, 1.3, 1.54, 0, 1.15, rgb(0x6e4636));
    f.box(g, s - 0.025, s + 0.025, IN, 1.3, 0.85, 0.92, IRON);
    for (let d = 0.25; d < 1.3; d += 0.3) f.box(g, s - 0.02, s + 0.02, d, d + 0.04, 0, 0.88, IRON);
  }
}

// ── Fire escapes ────────────────────────────────────────────────────────

/** World box of an escape part (wall frame → world), for the u-mapping of a placement. */
function escMap(e: EscapePlacement) {
  const sOf = (u: number) => (e.ladderAtS1 ? e.a + u : e.b - u);
  return sOf;
}

function partCorners(f: WallFrame, sOf: (u: number) => number, p: EscapePart): V3[] {
  // Bottom ring then top ring, each round the edge
  const ring = (y: (u: number, d: number) => number): V3[] =>
    (
      [
        [p.u0, p.d0],
        [p.u1, p.d0],
        [p.u1, p.d1],
        [p.u0, p.d1],
      ] as const
    ).map(([u, d]) => f.p(sOf(u), d, y(u, d)));
  if (p.kind === 'box') return [...ring(() => p.y0), ...ring(() => p.y1)];
  const top = (u: number, d: number) =>
    p.axis === 'u'
      ? p.y0 + ((u - p.u0) / (p.u1 - p.u0)) * (p.y1 - p.y0)
      : p.y0 + ((d - p.d0) / (p.d1 - p.d0)) * (p.y1 - p.y0);
  return [...ring((u, d) => top(u, d) - p.thick), ...ring(top)];
}

export function buildEscape(
  detail: Geo,
  fine: Geo,
  collide: Geo,
  e: EscapePlacement,
  lowDetail: boolean,
) {
  const f = new WallFrame(e.face.nx, e.face.nz, e.face.at);
  const sOf = escMap(e);
  const box = (
    g: Geo,
    u0: number,
    u1: number,
    d0: number,
    d1: number,
    y0: number,
    y1: number,
    c: RGB,
  ) => {
    const a = sOf(u0);
    const b = sOf(u1);
    f.box(g, Math.min(a, b), Math.max(a, b), d0, d1, y0, y1, c);
  };
  const grate = rgb(0x34363b);
  for (const p of e.plan.parts) {
    if (p.solid) collide.prism(partCorners(f, sOf, p), [1, 1, 1]);
    if (p.kind === 'box') {
      if (p.role === 'rail') {
        // a top rail and a mid rail; balusters in the fine layer
        const along = p.u1 - p.u0 > p.d1 - p.d0;
        box(detail, p.u0, p.u1, p.d0, p.d1, p.y1 - 0.06, p.y1, IRON);
        box(detail, p.u0, p.u1, p.d0, p.d1, p.y0 + 0.45, p.y0 + 0.49, IRON);
        if (!lowDetail) {
          const len = along ? p.u1 - p.u0 : p.d1 - p.d0;
          const n = Math.max(1, Math.round(len / 0.32));
          for (let i = 0; i <= n; i++) {
            const t = i / n;
            if (along) {
              const u = p.u0 + (p.u1 - p.u0 - 0.03) * t;
              box(fine, u, u + 0.03, p.d0, p.d1, p.y0, p.y1, IRON);
            } else {
              const d = p.d0 + (p.d1 - p.d0 - 0.03) * t;
              box(fine, p.u0, p.u1, d, d + 0.03, p.y0, p.y1, IRON);
            }
          }
        }
      } else if (p.role === 'ladder') {
        // two stiles and rungs, hanging a little proud of the panel
        const d0 = p.d0 + 0.02;
        const d1 = p.d0 + 0.07;
        box(detail, p.u0, p.u0 + 0.06, d0, d1, p.y0 - 0.1, p.y1 + 0.9, IRON);
        box(detail, p.u1 - 0.06, p.u1, d0, d1, p.y0 - 0.1, p.y1 + 0.9, IRON);
        for (let y = p.y0 + 0.15; y < p.y1; y += 0.3)
          box(detail, p.u0, p.u1, d0, d1, y, y + 0.04, IRON_LIGHT);
      } else if (p.role === 'post') {
        box(detail, p.u0, p.u1, p.d0, p.d1, p.y0, p.y1, IRON);
      } else {
        // platform / pad / deck: a grating with a frame
        box(detail, p.u0, p.u1, p.d0, p.d1, p.y0, p.y1, grate);
        box(detail, p.u0, p.u1, p.d1 - 0.05, p.d1, p.y0 - 0.08, p.y1, IRON);
      }
    } else if (p.role === 'flight' || p.role === 'bridge') {
      // stringers + treads
      const n = Math.max(1, p.steps);
      if (p.axis === 'u') {
        const run = (p.u1 - p.u0) / n;
        const rise = (p.y1 - p.y0) / n;
        for (let i = 0; i < n; i++) {
          const y = p.y0 + rise * (i + 0.5);
          box(
            detail,
            p.u0 + run * i,
            p.u0 + run * (i + 1) + 0.04,
            p.d0 + 0.06,
            p.d1 - 0.06,
            y - 0.05,
            y,
            grate,
          );
        }
        for (const [d0, d1] of [
          [p.d0, p.d0 + 0.06],
          [p.d1 - 0.06, p.d1],
        ] as const)
          detail.prism(
            partCorners(f, sOf, { ...p, d0, d1, thick: 0.26, y0: p.y0 + 0.08, y1: p.y1 + 0.08 }),
            IRON,
          );
      } else {
        const run = (p.d1 - p.d0) / n;
        const rise = (p.y1 - p.y0) / n;
        for (let i = 0; i < n; i++) {
          const y = p.y0 + rise * (i + 0.5);
          const da = p.d0 + run * i;
          const db = p.d0 + run * (i + 1);
          box(
            detail,
            p.u0 + 0.06,
            p.u1 - 0.06,
            Math.min(da, db) - 0.02,
            Math.max(da, db) + 0.02,
            y - 0.05,
            y,
            grate,
          );
        }
        for (const [u0, u1] of [
          [p.u0, p.u0 + 0.06],
          [p.u1 - 0.06, p.u1],
        ] as const)
          detail.prism(
            partCorners(f, sOf, { ...p, u0, u1, thick: 0.26, y0: p.y0 + 0.08, y1: p.y1 + 0.08 }),
            IRON,
          );
      }
    } else if (p.role === 'rail') {
      // sloped handrail along a flight
      detail.prism(partCorners(f, sOf, { ...p, thick: 0.06 }), IRON);
      detail.prism(
        partCorners(f, sOf, { ...p, y0: p.y0 - 0.5, y1: p.y1 - 0.5, thick: 0.04 }),
        IRON,
      );
      if (!lowDetail) {
        const len = p.u1 - p.u0;
        const n = Math.max(1, Math.round(len / 0.4));
        for (let i = 0; i <= n; i++) {
          const u = p.u0 + ((len - 0.03) * i) / n;
          const yb = p.y0 - p.thick + ((u - p.u0) / len) * (p.y1 - p.y0);
          box(fine, u, u + 0.03, p.d0, p.d1, yb, yb + p.thick, IRON);
        }
      }
    }
  }
}

// ── A whole building ────────────────────────────────────────────────────

export function buildBuilding(b: BuildingPlan, opts: { lowDetail: boolean }): BuildingGeo {
  const skin = new Geo(true, true);
  const detail = new Geo();
  const fine = new Geo();
  buildSkin(skin, b);
  const rnd = mulberry32(b.seed ^ 0x5f3759df);
  const stoneTint = mix(STONE, tintOf(b.style, b.variant), 0.15);
  const dseg = doorSegment(b);
  for (const sp of b.segments) {
    if (sp.seg.fp === null) continue;
    const f = frameOf(sp);
    const ws = sp.windows;
    const top = sp.face.y1;
    const street = sp.seg.kind !== 'side';
    const shownFrom = Math.max(sp.face.y0, sp.seg.cover);
    const roof = b.fp !== null ? roofFor(b.fp.ground + b.fp.height, sp.face) : top - PARAPET;
    // Keep AC units and pipes out of a fire escape's way
    const esc =
      b.escape !== null && b.escape.face === sp.face ? [b.escape.a - 0.4, b.escape.b + 0.4] : null;
    const clearOfEscape = (w: { s0: number; s1: number }) =>
      esc === null || w.s1 < esc[0]! || w.s0 > esc[1]!;
    const acWs = ws.filter(clearOfEscape);
    const dec = sp.decals;
    const pipeAt = (end: 0 | 1) => {
      const s = end === 0 ? sp.seg.s0 + 0.3 : sp.seg.s1 - 0.3;
      if (clearOfEscape({ s0: s - 0.1, s1: s + 0.1 })) return s;
      const other = end === 0 ? sp.seg.s1 - 0.3 : sp.seg.s0 + 0.3;
      return clearOfEscape({ s0: other - 0.1, s1: other + 0.1 }) ? other : null;
    };
    switch (b.style) {
      case 'tenement':
        sills(detail, f, ws, stoneTint, 0.13, { c: stoneTint, h: 0.2, out: 0.1, ext: 0.1 });
        if (street) cornice(detail, fine, f, sp, stoneTint, 0.5, true);
        acUnits(fine, f, acWs, rnd, 0.22);
        if (street && sp.seg.s1 - sp.seg.s0 > 4) {
          const s = pipeAt(1);
          if (s !== null) drainpipe(fine, f, s, 0, top - 0.3, dec);
        }
        break;
      case 'brownstone': {
        const stone = scale(rgb(0x8b5a45), 1.15);
        sills(detail, f, ws, stone, 0.12, { c: scale(stone, 1.1), h: 0.24, out: 0.17, ext: 0.16 });
        if (street) cornice(detail, fine, f, sp, scale(stone, 1.2), 0.42, true);
        // a bay window up the middle bay of the street wall
        const bays = new Set(sp.cells.map(c => c.bay));
        if (sp.seg.kind === 'front' && bays.size >= 3 && roof - STOREY > STOREY + 1) {
          const mid = Math.floor(bays.size / 2);
          const cell = sp.cells.find(c => c.bay === mid);
          if (
            cell !== undefined &&
            shownFrom <= STOREY + 0.01 &&
            !dec.some(r => rectsOverlap(r, { s0: cell.s0, s1: cell.s1, y0: STOREY, y1: roof }, 0.1))
          )
            bayWindow(
              detail,
              skin,
              f,
              sp,
              b,
              cell.s0 + 0.2,
              cell.s1 - 0.2,
              STOREY + 0.3,
              roof - 0.15,
              stone,
            );
        }
        if (sp.door !== null) doorRailings(detail, f, sp.door);
        acUnits(fine, f, acWs, rnd, 0.12);
        break;
      }
      case 'modern': {
        if (!street) break;
        const xs = new Set<number>();
        for (const c of sp.cells) {
          xs.add(Math.round(c.s0 * 1000) / 1000);
          xs.add(Math.round(c.s1 * 1000) / 1000);
        }
        const y0 = Math.max(shownFrom, STOREY);
        for (const s of xs)
          for (const [a, c] of freeAlong(y0, top, s, 0.04, dec))
            f.box(detail, s - 0.04, s + 0.04, IN, 0.12, a, c, ALU);
        for (let y = STOREY; y < roof - 0.1; y += STOREY)
          if (y >= shownFrom)
            for (const [a, c] of freeAcross(sp.seg.s0 + END, sp.seg.s1 - END, y + 0.42, 0.04, dec))
              f.box(detail, a, c, IN, 0.09, y + 0.38, y + 0.46, ALU);
        f.box(
          detail,
          sp.seg.s0 + END,
          sp.seg.s1 - END,
          IN,
          0.1,
          top - 0.12,
          top + 0.08,
          scale(ALU, 0.9),
        );
        break;
      }
      case 'deco': {
        if (!street) break;
        const xs = [...new Set(sp.cells.map(c => Math.round(c.s0 * 1000) / 1000)), sp.seg.s1].sort(
          (p, q) => p - q,
        );
        const n = xs.length - 1;
        const y0 = Math.max(shownFrom, STOREY);
        xs.forEach((s, i) => {
          const k = n > 0 ? 1 - Math.abs(i - n / 2) / (n / 2) : 1;
          const h = top + 0.35 + 1.9 * k * k;
          const s0 = Math.max(sp.seg.s0 + END, s - 0.15);
          const s1 = Math.min(sp.seg.s1 - END, s + 0.15);
          for (const [a, c] of freeAlong(y0, h, (s0 + s1) / 2, (s1 - s0) / 2, dec))
            f.box(detail, s0, s1, IN, 0.32, a, c, scale(stoneTint, 1.04));
          f.box(
            fine,
            Math.max(sp.seg.s0 + END, s0 - 0.03),
            Math.min(sp.seg.s1 - END, s1 + 0.03),
            IN,
            0.36,
            h,
            h + 0.12,
            GOLD,
          );
        });
        // a band of gold at each setback line
        f.box(detail, sp.seg.s0 + END, sp.seg.s1 - END, IN, 0.12, top - 0.1, top + 0.045, GOLD);
        break;
      }
      case 'loft':
        sills(detail, f, ws, rgb(0x9c9384), 0.12, { c: IRON, h: 0.14, out: 0.1, ext: 0.08 });
        if (street) cornice(detail, fine, f, sp, rgb(0x6e4433), 0.25, false);
        if (street && sp.seg.s1 - sp.seg.s0 > 4)
          for (const end of [0, 1] as const) {
            const s = pipeAt(end);
            if (s !== null && Math.abs(s - (end === 0 ? sp.seg.s0 + 0.3 : sp.seg.s1 - 0.3)) < 1e-6)
              drainpipe(fine, f, s, 0, top - 0.3, dec);
          }
        break;
      case 'shopfront':
        sills(detail, f, ws, rgb(0xe1dbd2), 0.1);
        if (street)
          f.box(
            detail,
            sp.seg.s0 + END,
            sp.seg.s1 - END,
            IN,
            0.14,
            top - 0.14,
            top + 0.06,
            scale(tintOf(b.style, b.variant), 0.8),
          );
        break;
    }
  }
  // Signs, shutters on the door's stretch
  if (dseg !== null && dseg.door !== null && b.sign !== null && dseg.seg.kind === 'front') {
    const f = frameOf(dseg);
    const door = dseg.door;
    if (b.style === 'shopfront') {
      const len = Math.min(dseg.seg.s1 - dseg.seg.s0 - 1.2, 6.5);
      const m = (dseg.seg.s0 + dseg.seg.s1) / 2;
      const board = { s0: m - len / 2 - 0.1, s1: m + len / 2 + 0.1, y0: 3.54, y1: 3.7 + len / 4.6 };
      if (len > 2 && !dseg.decals.some(r => rectsOverlap(r, board)))
        signBoard(detail, skin, f, dseg, b.sign, m - len / 2, m + len / 2, 3.62, 3.62 + len / 4.6);
    } else if (b.style === 'tenement' || b.style === 'loft' || b.style === 'deco') {
      // Blade sign at the end of the stretch away from the door (the
      // door's end when a fire escape has the far one)
      const far =
        door.s - dseg.seg.s0 > dseg.seg.s1 - door.s ? dseg.seg.s0 + 0.5 : dseg.seg.s1 - 0.5;
      const near = far === dseg.seg.s0 + 0.5 ? dseg.seg.s1 - 0.5 : dseg.seg.s0 + 0.5;
      const e = b.escape !== null && b.escape.face === dseg.face ? b.escape : null;
      const free = (s: number) =>
        (e === null || s < e.a - 1.5 || s > e.b + 1.5) &&
        !dseg.decals.some(r => rectsOverlap(r, { s0: s - 0.1, s1: s + 0.1, y0: 3.6, y1: 4.5 }));
      const s = free(far) ? far : free(near) ? near : null;
      if (s !== null) bladeSign(detail, skin, f, dseg, b.sign, s, 3.7);
    }
    if (b.style === 'shopfront' || b.style === 'loft' || rnd() < 0.4) {
      const span = shutterSpan(dseg.seg.s0, dseg.seg.s1, door);
      if (span !== null) shutters(detail, fine, f, span[0], span[1]);
    }
  }
  let collide: Geo | null = null;
  if (b.escape !== null) {
    collide = new Geo();
    buildEscape(detail, fine, collide, b.escape, opts.lowDetail);
  }
  return { skin, detail, fine, collide };
}
