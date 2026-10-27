// ── Rooftop clutter: water towers, penthouses, crowns, vents (pure) ─────
//
// Built at a spot the caller has checked is clear roof. The big pieces
// (a water tower's tank and legs, a penthouse, a deco crown) also go into
// the collision, so you can't walk through them up there.

import type { FacadeStyle } from './styles';
import type { RGB } from './geom';

import { Geo, rgb, scale } from './geom';

export interface RoofSpot {
  x: number;
  z: number;
  /** Roof floor height. */
  y: number;
  /** Clear half-size (m) around the spot. */
  r: number;
}

const TANK = rgb(0x8a5a3a);
const TANK_DARK = rgb(0x5e3c27);
const STEEL = rgb(0x3b3f45);
const VENT = rgb(0xb7bcc0);
const PENT = rgb(0xcfd4d8);

/** What a style puts on its roof, biggest first (the caller fits what it can). */
export function roofItems(
  style: FacadeStyle,
  waterTower: boolean,
): ('tower' | 'penthouse' | 'crown' | 'vents' | 'antenna')[] {
  const out: ('tower' | 'penthouse' | 'crown' | 'vents' | 'antenna')[] = [];
  if (waterTower) out.push('tower');
  if (style === 'modern') out.push('penthouse', 'antenna');
  if (style === 'deco') out.push('crown');
  out.push('vents');
  if (style !== 'modern') out.push('antenna');
  return out;
}

/** Footprint half-size an item needs. */
export function itemSize(item: ReturnType<typeof roofItems>[number]): number {
  switch (item) {
    case 'tower':
      return 1.7;
    case 'penthouse':
      return 2.0;
    case 'crown':
      return 2.4;
    case 'vents':
      return 0.8;
    case 'antenna':
      return 0.4;
  }
}

/** A wooden water tower on a steel stand. */
export function waterTower(detail: Geo, fine: Geo, collide: Geo, s: RoofSpot, tint: number) {
  const legH = 2.2;
  const r = 1.25;
  const y0 = s.y;
  // legs + cross bracing
  for (const [dx, dz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ] as const) {
    const x = s.x + dx * r * 0.7;
    const z = s.z + dz * r * 0.7;
    detail.box([x - 0.08, y0, z - 0.08], [x + 0.08, y0 + legH, z + 0.08], STEEL);
    collide.box([x - 0.1, y0, z - 0.1], [x + 0.1, y0 + legH, z + 0.1], STEEL);
  }
  fine.box(
    [s.x - r * 0.75, y0 + legH * 0.45, s.z - 0.04],
    [s.x + r * 0.75, y0 + legH * 0.45 + 0.08, s.z + 0.04],
    STEEL,
  );
  fine.box(
    [s.x - 0.04, y0 + legH * 0.45, s.z - r * 0.75],
    [s.x + 0.04, y0 + legH * 0.45 + 0.08, s.z + r * 0.75],
    STEEL,
  );
  // platform, tank (with hoops), roof cone
  detail.cylinder(s.x, s.z, y0 + legH - 0.12, y0 + legH, r + 0.25, 10, STEEL, {
    top: true,
    bottom: true,
  });
  const wood: RGB = scale(TANK, 0.9 + tint * 0.2);
  detail.cylinder(s.x, s.z, y0 + legH, y0 + legH + 2.6, r, 12, wood, {});
  for (const k of [0.25, 0.55, 0.85])
    fine.cylinder(
      s.x,
      s.z,
      y0 + legH + 2.6 * k,
      y0 + legH + 2.6 * k + 0.06,
      r + 0.03,
      12,
      STEEL,
      {},
    );
  detail.cylinder(s.x, s.z, y0 + legH + 2.6, y0 + legH + 3.5, r + 0.12, 12, TANK_DARK, {}, 0.0);
  collide.box(
    [s.x - r * 0.9, y0 + legH, s.z - r * 0.9],
    [s.x + r * 0.9, y0 + legH + 2.6, s.z + r * 0.9],
    STEEL,
  );
}

/** A mechanical penthouse with louvres and a door. */
export function penthouse(detail: Geo, fine: Geo, collide: Geo, s: RoofSpot) {
  const w = 1.8;
  const d = 1.4;
  const h = 2.3;
  detail.box([s.x - w, s.y, s.z - d], [s.x + w, s.y + h, s.z + d], PENT, ['-y']);
  detail.box(
    [s.x - w - 0.08, s.y + h, s.z - d - 0.08],
    [s.x + w + 0.08, s.y + h + 0.12, s.z + d + 0.08],
    scale(PENT, 0.85),
  );
  collide.box([s.x - w, s.y, s.z - d], [s.x + w, s.y + h, s.z + d], PENT);
  for (let y = s.y + 0.6; y < s.y + h - 0.3; y += 0.18)
    fine.box(
      [s.x - w * 0.7, y, s.z + d],
      [s.x + w * 0.7, y + 0.06, s.z + d + 0.06],
      scale(PENT, 0.7),
    );
}

/** A stepped deco crown: two setback tiers and a spire. */
export function crown(detail: Geo, fine: Geo, collide: Geo, s: RoofSpot, stone: RGB, gold: RGB) {
  const tiers = [
    { r: 2.2, h: 1.6 },
    { r: 1.4, h: 1.5 },
    { r: 0.7, h: 1.2 },
  ];
  let y = s.y;
  for (const t of tiers) {
    detail.box([s.x - t.r, y, s.z - t.r], [s.x + t.r, y + t.h, s.z + t.r], stone, ['-y']);
    detail.box(
      [s.x - t.r - 0.06, y + t.h - 0.12, s.z - t.r - 0.06],
      [s.x + t.r + 0.06, y + t.h, s.z + t.r + 0.06],
      gold,
    );
    collide.box([s.x - t.r, y, s.z - t.r], [s.x + t.r, y + t.h, s.z + t.r], stone);
    y += t.h;
  }
  detail.cylinder(s.x, s.z, y, y + 3.2, 0.18, 6, gold, {}, 0);
  fine.cylinder(s.x, s.z, y + 1.0, y + 1.15, 0.32, 8, gold, { top: true, bottom: true });
}

export function vents(fine: Geo, s: RoofSpot, k: number) {
  fine.cylinder(s.x, s.z, s.y, s.y + 0.9, 0.22, 8, VENT, {});
  fine.cylinder(
    s.x,
    s.z,
    s.y + 0.9,
    s.y + 1.15,
    0.36,
    8,
    scale(VENT, 0.85),
    { top: true, bottom: true },
    0.05,
  );
  const x = s.x + (k > 0.5 ? 0.6 : -0.6);
  fine.box([x - 0.35, s.y, s.z - 0.3], [x + 0.35, s.y + 0.5, s.z + 0.3], scale(VENT, 0.9));
}

export function antenna(fine: Geo, s: RoofSpot, h: number) {
  fine.box([s.x - 0.04, s.y, s.z - 0.04], [s.x + 0.04, s.y + h, s.z + 0.04], STEEL);
  for (const k of [0.55, 0.75, 0.92])
    fine.box(
      [s.x - 0.5 * (1.1 - k), s.y + h * k, s.z - 0.025],
      [s.x + 0.5 * (1.1 - k), s.y + h * k + 0.04, s.z + 0.025],
      STEEL,
    );
}
