// ── Facade plan for the whole plaza (pure, tested) ──────────────────────
//
// GLB wall rectangles + building footprints + the interiors' doors →
// one BuildingPlan per building: its style, its wall stretches cut into
// storeys and bays, its window openings, its door, its sign and (on brick
// and loft buildings, where a street wall has room) a fire escape.

import type { BuildingDoor } from '../../interiors/contract';
import type { Footprint } from '../../interiors/doors';
import type { BuildingPlan, EscapePlacement, SegmentPlan } from './details';
import type { FaceRect } from './faces';
import type { DoorRect, WallRect } from './layout';

import { SIGN_SLOTS } from './atlas';
import { checkEscape, minEscapeLength, planEscape } from './escape';
import {
  cellsFor,
  escapeSpan,
  meetingCuts,
  overlapsDoor,
  rectsOverlap,
  roofFor,
  segmentFace,
  windowsOf,
} from './layout';
import { assignStyles, STOREY, STYLE_INFO } from './styles';

/** A world AABB (balconies, awnings…) that a fire escape must stay clear of. */
export interface Obstacle {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface PlanInput {
  faces: readonly FaceRect[];
  fps: readonly Footprint[];
  doors: readonly BuildingDoor[];
  /** Things on the walls a fire escape mustn't run into. */
  obstacles?: readonly Obstacle[];
  /** Painted pieces and screens on the walls (graffiti, the mural): no relief over them. */
  decals?: readonly FaceRect[];
  /** Door id prefix for this area's buildings ('plaza:'). */
  area?: string;
}

/** A door as a rect on a face, if it's on that face (and inside [s0, s1]). */
export function doorOnFace(d: BuildingDoor, f: FaceRect, s0: number, s1: number): DoorRect | null {
  const plane = f.nz !== 0 ? d.z : d.x;
  const s = f.nz !== 0 ? d.x : d.z;
  // The door faces out of this wall and sits on it (a few cm proud)
  const nx = Math.sin(d.yaw);
  const nz = Math.cos(d.yaw);
  if (nx * f.nx + nz * f.nz < 0.9) return null;
  if (Math.abs(plane - f.at) > 0.2) return null;
  if (s < s0 - 0.05 || s > s1 + 0.05) return null;
  return { s, width: d.width, height: 2.6 };
}

/** The s-ranges along a face that obstacles stand in, over heights [y0, y1]. */
function blockedOn(f: FaceRect, obs: readonly Obstacle[], y0: number, y1: number, reach: number) {
  const out: [number, number][] = [];
  for (const o of obs) {
    if (o.maxY < y0 || o.minY > y1) continue;
    // In front of this wall, within reach
    const d0 =
      f.nz !== 0
        ? f.nz > 0
          ? o.minZ - f.at
          : f.at - o.maxZ
        : f.nx > 0
          ? o.minX - f.at
          : f.at - o.maxX;
    const d1 =
      f.nz !== 0
        ? f.nz > 0
          ? o.maxZ - f.at
          : f.at - o.minZ
        : f.nx > 0
          ? o.maxX - f.at
          : f.at - o.minX;
    if (d1 < -0.05 || d0 > reach) continue;
    out.push(f.nz !== 0 ? [o.minX, o.maxX] : [o.minZ, o.maxZ]);
  }
  return out;
}

/** Decals lying on a face (same facing, within a few cm of it), clipped to [s0, s1]. */
export function decalsOn(
  face: FaceRect,
  s0: number,
  s1: number,
  decals: readonly FaceRect[],
): WallRect[] {
  const out: WallRect[] = [];
  for (const d of decals) {
    if (d.nx !== face.nx || d.nz !== face.nz) continue;
    const off = face.nz !== 0 ? (d.at - face.at) * face.nz : (d.at - face.at) * face.nx;
    if (off < -0.02 || off > 0.15) continue;
    if (d.s1 <= s0 || d.s0 >= s1) continue;
    out.push({ s0: Math.max(s0, d.s0), s1: Math.min(s1, d.s1), y0: d.y0, y1: d.y1 });
  }
  return out;
}

export function planBuildings(input: PlanInput): BuildingPlan[] {
  const area = input.area ?? 'plaza:';
  const fps = input.fps;
  const styles = assignStyles(fps);
  const byKey = new Map<string, BuildingPlan>();
  const doorOf = new Map<string, BuildingDoor>();
  for (const d of input.doors) if (d.id.startsWith(area)) doorOf.set(d.id.slice(area.length), d);
  const get = (fp: Footprint): BuildingPlan => {
    let b = byKey.get(fp.key);
    if (b === undefined) {
      const st = styles.get(fp.key)!;
      b = {
        key: fp.key,
        fp,
        style: st.style,
        variant: st.variant,
        seed: st.seed,
        segments: [],
        escape: null,
        sign: null,
      };
      byKey.set(fp.key, b);
    }
    return b;
  };
  for (const face of input.faces) {
    for (const seg of segmentFace(face, fps, meetingCuts(face, input.faces))) {
      const owner = seg.fp ?? seg.styleOf;
      if (owner === null) continue;
      const b = get(owner);
      const roof = roofFor(owner.ground + owner.height, face);
      const door =
        seg.fp !== null && doorOf.has(seg.fp.key)
          ? doorOnFace(doorOf.get(seg.fp.key)!, face, seg.s0, seg.s1)
          : null;
      const cells = cellsFor(seg, STYLE_INFO[b.style].bay, roof);
      const decals = decalsOn(face, seg.s0, seg.s1, input.decals ?? []);
      const windows = windowsOf(cells, b.style).filter(
        w =>
          (door === null || !overlapsDoor(w, door)) && !decals.some(r => rectsOverlap(r, w, 0.15)),
      );
      const sp: SegmentPlan = { seg, face, cells, windows, door, decals };
      b.segments.push(sp);
    }
  }
  const out = [...byKey.values()].sort((p, q) => (p.key < q.key ? -1 : p.key > q.key ? 1 : 0));
  // Signs for the buildings you can walk into, in a stable order
  let slot = 0;
  for (const b of out)
    if (doorOf.has(b.key) && slot < SIGN_SLOTS && b.segments.some(s => s.door !== null))
      b.sign = slot++;
  // Fire escapes
  for (const b of out) {
    if (!STYLE_INFO[b.style].fireEscape || b.fp === null) continue;
    b.escape = placeEscape(b, input.obstacles ?? []);
  }
  return out;
}

/** Fire escape on the building's longest full-height street wall, if one fits. */
export function placeEscape(
  b: BuildingPlan,
  obstacles: readonly Obstacle[],
): EscapePlacement | null {
  const fp = b.fp;
  if (fp === null) return null;
  if (fp.ground + fp.height < 2 * STOREY - 0.1) return null;
  const minLen = minEscapeLength();
  const cands = b.segments
    .filter(
      s =>
        s.seg.fp === fp &&
        s.seg.kind === 'front' &&
        s.seg.cover <= STOREY + 0.01 &&
        s.seg.s1 - s.seg.s0 >= minLen + 0.7,
    )
    .sort((p, q) => q.seg.s1 - q.seg.s0 - (p.seg.s1 - p.seg.s0));
  for (const sp of cands) {
    const roof = roofFor(fp.ground + fp.height, sp.face);
    if (roof < 2 * STOREY - 0.1) continue;
    const blocked = blockedOn(sp.face, obstacles, STOREY, sp.face.y1 + 1.5, 2.6);
    const span = escapeSpan(sp.seg.s0, sp.seg.s1, sp.door, blocked, [6.8, 6.4, minLen]);
    if (span === null) continue;
    const spec = { length: span.length, roof, parapet: sp.face.y1, parapetDepth: 0.25 };
    const plan = planEscape(spec);
    if (plan === null || checkEscape(plan, spec).length > 0) continue;
    return { face: sp.face, a: span.a, b: span.b, ladderAtS1: span.ladderAtS1, plan };
  }
  return null;
}
