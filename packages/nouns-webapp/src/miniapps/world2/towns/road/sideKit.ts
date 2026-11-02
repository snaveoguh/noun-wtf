// ── Side towns' shared bits: main street, the spur road in, its gate ─────
//
// A side town's main street is its own (the dirt line runs `off` m away on
// the near side), so it's painted: a street down v' = 0 with sidewalks
// (weirdKit's, so customers stand at SIDEWALK_Y), and a spur road from the
// line's edge across the pad's blend to main street at u = Lf / 2. The
// near-side blocks leave that gap (SPUR_GAP). At the line: a junction sign
// both ways, at the pad edge: a gate over the spur.

import { MOUNTAIN } from '../../world/mountain/config';
import { BLOCK_FONT, boxAt, type SignSpec, type TownBuilder } from '../kit';
import { SIDEWALK, sidewalks } from '../weirdKit';

import { type PartCtx, type RoadPart } from './look';
import { SIDE_TOWNS, type SideTownId, type SideTownSite } from './places';
import { ROAD_C } from './props';

/** Near-side u range kept clear for the spur (around Lf / 2). */
export const SPUR_GAP = 10;

export function sideSite(id: SideTownId): SideTownSite {
  return SIDE_TOWNS.find(q => q.id === id)!;
}

/** Junction + gate signs for a side town. */
export function spurSigns(name: string, c: { bg: string; fg: string; accent: string }): SignSpec[] {
  return [
    {
      key: 'junction',
      w: 5.2,
      h: 2.2,
      bg: c.bg,
      fg: c.fg,
      border: c.accent,
      lines: [
        { text: name, size: 0.3, y: 0.36 },
        { text: '→  0.1 KM', size: 0.22, y: 0.74, color: c.accent, font: BLOCK_FONT },
      ],
    },
    {
      key: 'junctionL',
      w: 5.2,
      h: 2.2,
      bg: c.bg,
      fg: c.fg,
      border: c.accent,
      lines: [
        { text: name, size: 0.3, y: 0.36 },
        { text: '0.1 KM  ←', size: 0.22, y: 0.74, color: c.accent, font: BLOCK_FONT },
      ],
    },
  ];
}

/**
 * Main street (decal), sidewalks, the spur road (ground-following, from the
 * line's edge to main street) and its gate + junction signs. Split in parts:
 * the street with the pad, the spur and gate where they are.
 */
export function streetParts(
  site: SideTownSite,
  colors: { street: number; walk: number; curb: number; spur: number; post: number; beam: number },
): RoadPart[] {
  const Lf = site.len;
  const um = Lf / 2;
  const roadEdge = -site.off + MOUNTAIN.trackHalf;
  return [
    {
      vp: 0,
      u: Lf / 4,
      build(b: TownBuilder) {
        b.decal(-SIDEWALK.edge, SIDEWALK.edge, 2, Lf - 2, colors.street, 0.02);
        // Centre line dashes
        for (let u = 8; u < Lf - 8; u += 9) b.decal(-0.12, 0.12, u, u + 4.5, ROAD_C.line, 0.03);
        sidewalks(b, colors.walk, colors.curb, 6, um - SPUR_GAP);
        sidewalks(b, colors.walk, colors.curb, um + SPUR_GAP, Lf - 6);
        farGap(b, colors.walk, colors.curb, um);
        // Spur street across the near side, onto main street
        b.decal(-site.near + 0.5, -SIDEWALK.edge, um - 4.2, um + 4.2, colors.street, 0.02);
      },
    },
    {
      // The spur road, from the line's edge to the pad edge, on the graded ground
      vp: (roadEdge - site.near) / 2,
      u: um,
      build(b: TownBuilder, ctx: PartCtx) {
        const vs: number[] = [];
        for (let v = roadEdge + 0.4; v < -site.near + 1; v += 3) vs.push(v);
        vs.push(-site.near + 1);
        const us = [um - 4.2, um, um + 4.2];
        b.sheet(vs, us, (u, vp) => ctx.ground(vp, u) + 0.07, colors.spur);
        // Gate over the spur at the pad edge, facing arrivals
        const gm = b.at(-site.near + 3, um, 0, -1, 0);
        for (const x of [-6, 6])
          b.add(boxAt(x - 0.4, x + 0.4, 0, 7.4, -0.4, 0.4), colors.post, gm, { collide: true });
        b.add(boxAt(-6.8, 6.8, 6.6, 7.6, -0.35, 0.35), colors.beam, gm);
        b.sign('arch', gm, 0, 5.4, 0.38, 1);
        b.sign('arch', b.at(-site.near + 3, um, 0, 1, 0), 0, 5.4, 0.38, 1);
        welcome(b, -site.near + 6, um + 9);
      },
    },
    {
      // Junction signs at the line, either side of the spur, facing traffic both ways
      vp: roadEdge + 3,
      u: um,
      build(b: TownBuilder, ctx: PartCtx) {
        const v = roadEdge + 3;
        for (const [du, key, u] of [
          [-1, 'junction', um + 14],
          [1, 'junctionL', um - 14],
        ] as const) {
          const y = ctx.ground(v, u) - b.f.P;
          const m = b.at(v, u, y, 0, du);
          for (const x of [-1.9, 1.9])
            b.add(boxAt(x - 0.1, x + 0.1, -0.6, 3.4, -0.1, 0.1), colors.post, m);
          b.sign(key, m, 0, 2.6, 0.12, 1);
        }
      },
    },
  ];
}

/** The far side's sidewalk across the spur gap (the near side stays open for the spur). */
function farGap(b: TownBuilder, walk: number, curb: number, um: number) {
  const mid = (SIDEWALK.edge + SIDEWALK.out) / 2;
  const half = (SIDEWALK.out - SIDEWALK.edge) / 2;
  b.add(boxAt(-half, half, 0, SIDEWALK.y, -SPUR_GAP, SPUR_GAP), walk, b.at(mid, um), {
    collide: true,
  });
  b.add(
    boxAt(-0.16, 0.16, 0, SIDEWALK.y + 0.04, -SPUR_GAP, SPUR_GAP),
    curb,
    b.at(SIDEWALK.edge + 0.15, um),
  );
}

/** The welcome board beside the spur, facing arrivals (−v'). */
function welcome(b: TownBuilder, vp: number, u: number) {
  const m = b.at(vp, u, 0, -1, 0);
  for (const x of [-2.4, 2.4])
    b.add(boxAt(x - 0.14, x + 0.14, 0, 3.4, -0.2, -0.05), ROAD_C.woodDark, m);
  b.add(boxAt(-3.1, 3.1, 1.3, 4.4, -0.06, 0), ROAD_C.woodDark, m);
  b.sign('welcome', m, 0, 2.85, 0.02, 0.98);
}
