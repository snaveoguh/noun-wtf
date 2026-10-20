// ── The weird towns' shared bits: sidewalks, blocks, plants, signs ───────
//
// Noggle City, Shroom Hollow, Neon Nouns and Crater Lil are built like Dry
// Gulch (towns/kit.ts: one TownBuilder, merged by material) but wider: a
// sidewalk either side of main street (the dirt line), a front row of
// buildings facing it and a taller back row behind. Customers stand on the
// sidewalks (cast.ts: SIDEWALK_Y).

import type { GrownTown } from './site';
import type * as THREE from 'three';

import { MODELS } from '../world/landmarks/models';
import { LANDMARKS } from '../world/landmarks/sites';

import { BLOCK_FONT, boxAt, type SignSpec, type TownBuilder } from './kit';

/** Sidewalk: from the street edge out to here (v'), this high. */
export const SIDEWALK = { edge: 7, out: 11, y: 0.22 } as const;

export function sidewalks(b: TownBuilder, color: number, curb: number, u0 = 10, u1?: number) {
  const end = u1 ?? b.f.Lf - 10;
  for (const sgn of [-1, 1]) {
    const mid = sgn * ((SIDEWALK.edge + SIDEWALK.out) / 2);
    const m = b.at(mid, (u0 + end) / 2);
    b.add(
      boxAt(
        -(SIDEWALK.out - SIDEWALK.edge) / 2,
        (SIDEWALK.out - SIDEWALK.edge) / 2,
        0,
        SIDEWALK.y,
        -(end - u0) / 2,
        (end - u0) / 2,
      ),
      color,
      m,
      { collide: true },
    );
    // Curb strip at the street edge
    const cm = b.at(sgn * (SIDEWALK.edge + 0.15), (u0 + end) / 2);
    b.add(boxAt(-0.16, 0.16, 0, SIDEWALK.y + 0.04, -(end - u0) / 2, (end - u0) / 2), curb, cm);
  }
}

export interface Block {
  /** Along the street (centre). */
  u: number;
  /** Frontage, depth, height (m). */
  w: number;
  d: number;
  h: number;
  wall: number;
  /** Sign key on the front (optional). */
  sign?: string;
  signScale?: number;
}

/**
 * A building facing the street: front face at |v'| = front, the body going
 * back from there. `near`: on the −v' side. Returns the front matrix (prop
 * frame: +Z out of the front, x along the street, y up from the pad).
 */
export function blockAt(b: TownBuilder, s: Block, front: number, near: boolean): THREE.Matrix4 {
  const m = b.at(near ? -front : front, s.u, 0, near ? 1 : -1, 0);
  b.add(boxAt(-s.w / 2, s.w / 2, 0, s.h, -s.d, 0), s.wall, m, { collide: true });
  if (s.sign !== undefined) b.sign(s.sign, m, 0, Math.min(s.h - 1.4, 6.2), 0.06, s.signScale ?? 1);
  return m;
}

/** A grid of windows on a front (local +Z face at z = 0), `bucket` glow for neon. */
export function windows(
  b: TownBuilder,
  m: THREE.Matrix4,
  w: number,
  h: number,
  color: number,
  opts: {
    y0?: number;
    step?: number;
    size?: number;
    glow?: boolean;
    skip?: (i: number, j: number) => boolean;
  } = {},
) {
  const step = opts.step ?? 3.2;
  const size = opts.size ?? 1.4;
  const y0 = opts.y0 ?? 3;
  const cols = Math.max(1, Math.floor((w - 1.5) / step));
  const x0 = -((cols - 1) * step) / 2;
  for (let j = 0; y0 + j * step + size < h - 0.6; j++)
    for (let i = 0; i < cols; i++) {
      if (opts.skip?.(i, j) === true) continue;
      const x = x0 + i * step;
      const y = y0 + j * step;
      b.add(boxAt(x - size / 2, x + size / 2, y, y + size, 0, 0.08), color, m, {
        bucket: opts.glow === true ? 'glow' : 'solid',
      });
    }
}

/** A door on a front. */
export function door(b: TownBuilder, m: THREE.Matrix4, color: number, x = 0, w = 1.8, h = 2.6) {
  b.add(boxAt(x - w / 2, x + w / 2, 0, h, 0, 0.1), color, m);
}

/** Bold flat signboard spec (block letters). */
export const board = (
  key: string,
  w: number,
  h: number,
  text: string,
  bg: string,
  fg: string,
  border?: string,
): SignSpec => ({
  key,
  w,
  h,
  bg,
  fg,
  border,
  lines: [{ text, size: 0.56, y: 0.55, font: BLOCK_FONT }],
});

/** Arch + welcome sign specs every weird town has. */
export function gateSigns(
  name: string,
  motto: string,
  hot: string,
  pop: string,
  c: { bg: string; fg: string; accent: string },
): SignSpec[] {
  return [
    {
      key: 'arch',
      w: 12,
      h: 2.2,
      bg: c.bg,
      fg: c.fg,
      border: c.accent,
      lines: [
        { text: name, size: 0.5, y: 0.42 },
        { text: motto, size: 0.18, y: 0.8, color: c.accent },
      ],
    },
    {
      key: 'welcome',
      w: 6,
      h: 3,
      bg: c.fg,
      fg: c.bg,
      border: c.accent,
      lines: [
        { text: name, size: 0.2, y: 0.24 },
        { text: pop, size: 0.13, y: 0.5 },
        { text: hot, size: 0.12, y: 0.74, color: c.accent },
      ],
    },
  ];
}

/** The welcome board on two posts at the top of town (left of the street, facing arrivals). */
export function welcomeBoard(b: TownBuilder, post: number) {
  const m = b.at(-13, 6, 0, 0.45, -1);
  for (const x of [-2.4, 2.4]) b.add(boxAt(x - 0.14, x + 0.14, 0, 3.4, -0.2, -0.05), post, m);
  b.add(boxAt(-3.1, 3.1, 1.3, 4.4, -0.06, 0), post, m);
  b.sign('welcome', m, 0, 2.85, 0.02, 0.98);
}

/** A simple gate over the street at u: two posts and a beam carrying the arch sign both ways. */
export function gate(b: TownBuilder, u: number, post: number, beam: number) {
  const m = b.at(0, u, 0, 0, -1);
  for (const x of [-9.6, 9.6])
    b.add(boxAt(x - 0.5, x + 0.5, 0, 9, -0.5, 0.5), post, m, { collide: true });
  b.add(boxAt(-10.6, 10.6, 8.2, 9.2, -0.45, 0.45), beam, m);
  b.sign('arch', m, 0, 6.9, 0.48, 1.1);
  b.sign('arch', b.at(0, u, 0, 0, 1), 0, 6.9, 0.48, 1.1);
}

/** The town's landmarks (world/landmarks/sites.ts), built into the town mesh. */
export function townLandmarks(b: TownBuilder, town: GrownTown) {
  for (const def of LANDMARKS) {
    const at = def.at;
    if (!('town' in at) || at.town !== town) continue;
    MODELS[def.model](b, b.at(at.vp, at.u, 0, at.dvp, at.du));
  }
}

/** Deterministic little hash in [0, 1). */
export function hash01(i: number, salt: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x27d4eb2f);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
