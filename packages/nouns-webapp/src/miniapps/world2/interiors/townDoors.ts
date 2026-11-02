// ── Doors in the mountain towns and Noun Jersey ───────────────────────────
//
// Towns (towns/): each town's look builds its props through a TownBuilder.
// Running that same build once more into a recorder, in an identity frame
// (town coords v'/u straight onto x/z, pad level at 0), gives every solid
// part it collides with as a box in town coords, plus where each sign went.
// Parts that overlap are one building (a body, its false front, its roof);
// the building-sized ones (tall enough, a real footprint, standing on the
// pad) get doors from doors.ts, facing main street (v' = 0), named by the
// sign on them. The result only depends on the town's own build, so it's
// the same on every client and every visit; it's computed once per town,
// the first time you come near.
//
// Noun Jersey's buildings are few and hand-placed (world/mountain/
// NounJerseyPark.ts), so its doors are a table mirroring that layout: the
// four shops, four houses and the high school. The corner board shop
// keeps its own door (it opens the deck designer).

import type { BuildingDoor, InteriorKind } from './contract';
import type { NjFrame } from '../world/mountain/nounJersey';

import * as THREE from 'three';

import { beachSigns, buildBeach } from '../towns/beach';
import { buildCowboy, cowboySigns } from '../towns/cowboy';
import { TownBuilder, type Atlas, type SignSpec } from '../towns/kit';
import { buildAll } from '../towns/road/look';
import { SIDE_LOOKS } from '../towns/road/looks';
import { isSideTown } from '../towns/road/places';
import {
  LAGOON,
  townToWorld,
  townYaw,
  type GrownTown,
  type LineTown,
  type PadFrame,
  type TownFrame,
} from '../towns/site';
import { WEIRD_TOWNS } from '../towns/weird';
import { njToWorld, njYaw } from '../world/mountain/nounJersey';

import { planDoors, reachable, rectKey, type DoorPlan, type Footprint, type Rect } from './doors';
import { identify } from './names';

export interface Look {
  signs(): SignSpec[];
  build(b: TownBuilder, ground: (vp: number, u: number) => number): void;
}

const LOOKS: Record<LineTown, Look> = {
  cowboy: { signs: cowboySigns, build: buildCowboy },
  beach: { signs: beachSigns, build: buildBeach },
  ...WEIRD_TOWNS,
};

/** A town's look: the line towns' builds, or every part of a side town's (road/). */
export function lookOf(id: GrownTown): Look {
  if (!isSideTown(id)) return LOOKS[id];
  const look = SIDE_LOOKS[id];
  return { signs: look.signs, build: b => buildAll(look, b) };
}

/** A collided part in town coords. */
export interface Part extends Rect {
  minY: number;
  maxY: number;
}

/** What a town's build put down: solid parts and signs (town coords). */
export interface TownRecord {
  parts: Part[];
  signs: { key: string; text: string; x: number; y: number; z: number }[];
}

class Recorder extends TownBuilder {
  readonly signsAt: { key: string; x: number; y: number; z: number }[] = [];

  override sign(key: string, m: THREE.Matrix4, x: number, y: number, z: number) {
    const p = new THREE.Vector3(x, y, z).applyMatrix4(m);
    this.signsAt.push({ key, x: p.x, y: p.y, z: p.z });
  }
}

/** Identity copy of a frame: town (v', u) → (x, z), pad at y 0. */
export function identityFrame<F extends PadFrame>(f: F): F {
  return { ...f, ox: 0, oz: 0, fx: 0, fz: 1, rx: 1, rz: 0, side: 1, P: 0, yaw: 0 };
}

/** Run a town's build into a recorder (town coords). */
export function recordTown(id: GrownTown, f: TownFrame): TownRecord {
  return recordLook(lookOf(id), f);
}

/** Run any look's build into a recorder (town coords): towns, stations. */
export function recordLook(look: Look, f: PadFrame): TownRecord {
  const atlas: Atlas = { texture: null as unknown as THREE.CanvasTexture, slots: new Map() };
  const b = new Recorder(identityFrame(f), new THREE.Vector3(), atlas);
  look.build(b, () => 0);
  const parts: Part[] = [];
  const box = new THREE.Box3();
  for (const g of b.col) {
    g.computeBoundingBox();
    box.copy(g.boundingBox!);
    parts.push({
      minX: box.min.x,
      maxX: box.max.x,
      minZ: box.min.z,
      maxZ: box.max.z,
      minY: box.min.y,
      maxY: box.max.y,
    });
    g.dispose();
  }
  for (const k of ['solid', 'ground', 'thin', 'glow'] as const)
    for (const g of b.geo[k]) g.dispose();
  for (const g of b.signs) g.dispose();
  const text = new Map(
    look.signs().map(s => [s.key, s.lines[0]?.text.replace(/\s+/g, ' ').trim() ?? s.key]),
  );
  return {
    parts,
    signs: b.signsAt.map(s => ({ ...s, text: text.get(s.key) ?? s.key })),
  };
}

const area = (r: Rect) => (r.maxX - r.minX) * (r.maxZ - r.minZ);

function overlapArea(a: Rect, b: Rect): number {
  const ox = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
  const oz = Math.min(a.maxZ, b.maxZ) - Math.max(a.minZ, b.minZ);
  return ox > 0 && oz > 0 ? ox * oz : 0;
}

/** Building-sized: a real footprint, tall enough, standing on the pad. */
export function isBuildingPart(p: Part): boolean {
  const w = p.maxX - p.minX;
  const d = p.maxZ - p.minZ;
  // Standing ON the pad (minY ≈ 0): boulders and rocks sunk into it aren't buildings
  return (
    Math.min(w, d) >= 3 &&
    w * d >= 14 &&
    p.maxY - Math.max(0, p.minY) >= 2.6 &&
    p.minY < 1.2 &&
    p.minY > -0.3
  );
}

/** Group parts that overlap (body + false front + roof) into buildings. */
export function groupBuildings(parts: readonly Part[]): Part[] {
  const bodies = parts.filter(isBuildingPart);
  const out: Part[] = [];
  for (const p of [...bodies].sort((a, b) => area(b) - area(a))) {
    const hit = out.find(o => overlapArea(o, p) > 0.25 * Math.min(area(o), area(p)));
    if (hit === undefined) {
      out.push({ ...p });
      continue;
    }
    hit.minX = Math.min(hit.minX, p.minX);
    hit.maxX = Math.max(hit.maxX, p.maxX);
    hit.minZ = Math.min(hit.minZ, p.minZ);
    hit.maxZ = Math.max(hit.maxZ, p.maxZ);
    hit.minY = Math.min(hit.minY, p.minY);
    hit.maxY = Math.max(hit.maxY, p.maxY);
  }
  // Attachments standing against a building (a false front just proud of
  // the body, an airlock porch) are part of it: its door is theirs
  for (const p of parts) {
    if (isBuildingPart(p) || p.maxY < 2.4 || p.minY > 1.2 || p.minY < -0.3) continue;
    if (area(p) > 40) continue;
    const grown = {
      minX: p.minX - 0.05,
      maxX: p.maxX + 0.05,
      minZ: p.minZ - 0.05,
      maxZ: p.maxZ + 0.05,
    };
    const hit = out.find(o => overlapArea(o, grown) > 0 && area(o) > area(p));
    if (hit === undefined) continue;
    hit.minX = Math.min(hit.minX, p.minX);
    hit.maxX = Math.max(hit.maxX, p.maxX);
    hit.minZ = Math.min(hit.minZ, p.minZ);
    hit.maxZ = Math.max(hit.maxZ, p.maxZ);
  }
  return out;
}

/** Height of the walkable surface (boardwalk, steps, sidewalk) under (x, z), pad = 0. */
function floorAt(parts: readonly Part[], x: number, z: number): number {
  let y = 0;
  for (const p of parts)
    if (
      p.maxY <= 1.0 &&
      p.minY < 0.5 &&
      x > p.minX &&
      x < p.maxX &&
      z > p.minZ &&
      z < p.maxZ &&
      p.maxY > y
    )
      y = p.maxY;
  return y;
}

/** A town's door plan in town coords (x = v', z = u, y above the pad). */
export function townDoorPlanLocal(
  id: GrownTown,
  f: TownFrame,
  rec: TownRecord = recordTown(id, f),
): DoorPlan & { footprints: Footprint[] } {
  return lookDoorPlanLocal(`town:${id}`, f, rec);
}

/**
 * Any look's door plan in its own coords (x = v', z = u, y above the pad):
 * buildings face the street at v' = 0 (a town's main street, a station's road).
 */
export function lookDoorPlanLocal(
  areaId: string,
  f: PadFrame & { lake?: TownFrame['lake'] },
  rec: TownRecord,
): DoorPlan & { footprints: Footprint[] } {
  const buildings = groupBuildings(rec.parts);
  const fps: Footprint[] = buildings.map(b => {
    // The sign on (or just in front of) this building names it
    const signs = rec.signs.filter(
      s => s.x > b.minX - 1.5 && s.x < b.maxX + 1.5 && s.z > b.minZ - 1.5 && s.z < b.maxZ + 1.5,
    );
    signs.sort(
      (a, c) => Math.abs(a.x) - Math.abs(c.x) || Math.abs(a.y - 4) - Math.abs(c.y - 4) || a.z - c.z,
    );
    return {
      minX: b.minX,
      maxX: b.maxX,
      minZ: b.minZ,
      maxZ: b.maxZ,
      key: rectKey(b),
      height: b.maxY,
      ground: 0,
      sign: signs[0]?.text,
    };
  });
  // Everything else tall enough to stand in a doorway: posts, towers, tanks
  const blockers = rec.parts.filter(
    p =>
      p.maxY - Math.max(0, p.minY) > 1.1 &&
      p.minY < 1.6 &&
      !buildings.some(b => overlapArea(b, p) > 0.5 * Math.max(1e-6, area(p))),
  );
  const pad: Rect = { minX: f.vmin, maxX: f.vmax, minZ: 0, maxZ: f.Lf };
  const walkable = reachable(
    [...fps, ...blockers],
    pad,
    { x: 0, z: f.Lf / 2 },
    {
      open: (x, z) => !inLagoon(f, x, z),
    },
  );
  const plan = planDoors(fps, {
    area: areaId,
    street: b => ({ x: 0, z: (b.minZ + b.maxZ) / 2 }),
    blockers,
    clear: (x, z, nx, nz) => walkable(x + nx * 0.9, z + nz * 0.9),
  });
  // Door sills: on the boardwalk / sidewalk in front where there is one
  for (const d of plan.doors) {
    const nx = Math.sin(d.yaw);
    const nz = Math.cos(d.yaw);
    d.y = floorAt(rec.parts, d.x + nx * 0.6, d.z + nz * 0.6);
  }
  return { ...plan, footprints: fps };
}

function inLagoon(f: PadFrame & { lake?: TownFrame['lake'] }, vp: number, u: number): boolean {
  if (!f.lagoon) return false;
  const L = f.lake ?? LAGOON;
  return vp > L.v0 - 2 && vp < L.v3 + 2 && u > L.uIn0 - 2 && u < f.Lf - L.uIn1 + 2;
}

const cache = new Map<GrownTown, BuildingDoor[]>();

/** A town's doors in world space (computed once per session). */
export function townDoors(id: GrownTown, f: TownFrame): BuildingDoor[] {
  const hit = cache.get(id);
  if (hit !== undefined) return hit;
  const out = planToWorld(townDoorPlanLocal(id, f), f, () => f.P);
  cache.set(id, out);
  return out;
}

/** A local door plan → world doors; `floor(u)` is the pad's height at u. */
export function planToWorld(
  plan: DoorPlan,
  f: PadFrame,
  floor: (u: number) => number,
): BuildingDoor[] {
  const p = { x: 0, z: 0 };
  const out = plan.doors.map(d => {
    const w = townToWorld(f, d.x, d.z, p);
    const nx = Math.sin(d.yaw);
    const nz = Math.cos(d.yaw);
    const fp = d.footprint!;
    const corners = [
      [fp.minX, fp.minZ],
      [fp.maxX, fp.minZ],
      [fp.minX, fp.maxZ],
      [fp.maxX, fp.maxZ],
    ].map(([x, z]) => ({ ...townToWorld(f, x!, z!, { x: 0, z: 0 }) }));
    return {
      ...d,
      x: w.x,
      z: w.z,
      y: floor(d.z) + d.y,
      yaw: townYaw(f, nx, nz),
      footprint: {
        minX: Math.min(...corners.map(c => c.x)),
        maxX: Math.max(...corners.map(c => c.x)),
        minZ: Math.min(...corners.map(c => c.z)),
        maxZ: Math.max(...corners.map(c => c.z)),
        height: fp.height,
      },
    };
  });
  return out;
}

// ── Noun Jersey ─────────────────────────────────────────────────────────

/**
 * Its buildings in park coords (a across from Main St's kerb, b downhill),
 * each facing Main St (−a): front face a, centre b, width w (along b),
 * depth d (into +a), the door's offset along the front (local x) and its
 * sill height. Mirrors buildPark in NounJerseyPark.ts.
 */
export const NJ_BUILDINGS: {
  key: string;
  a: number;
  b: number;
  w: number;
  d: number;
  h: number;
  doorX: number;
  doorW: number;
  sill: number;
  name: string;
  kind: InteriorKind;
}[] = [
  ...['PIZZA', 'LAUNDRY', 'DELI', 'ARCADE'].map((name, i) => ({
    key: `shop${i}`,
    a: 21,
    b: 2 + 13 * i + 6.5,
    w: 12.6,
    d: 12,
    h: 4.6,
    doorX: 12.6 / 2 - 1.9,
    doorW: 1.3,
    sill: 0.15,
    name,
    kind: (['cafe', 'laundromat', 'cafe', 'arcade'] as const)[i]!,
  })),
  ...[0, 1, 2, 3].map(k => ({
    key: `house${k}`,
    a: 25,
    b: 82 + 17 * k + 10.5,
    w: 11,
    d: 12,
    h: 5.6,
    doorX: 0,
    doorW: 1.2,
    sill: 0.6,
    name: ['The Pixels', 'The Squares', 'The Lenses', 'The Frames'][k]!,
    kind: 'home' as const,
  })),
  {
    key: 'school',
    a: 92,
    b: 34,
    w: 56,
    d: 26,
    h: 8.6,
    doorX: 0,
    doorW: 2.2,
    sill: 1.2,
    name: 'Noun Jersey High Gym',
    kind: 'gym',
  },
];

const _nj = { x: 0, z: 0 };

/** Noun Jersey's doors in world space. */
export function njDoors(f: NjFrame): BuildingDoor[] {
  const yaw = njYaw(f, -1, 0);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return NJ_BUILDINGS.map(b => {
    const o = njToWorld(f, b.a, b.b, _nj);
    const ox = o.x;
    const oz = o.z;
    // Prop-local (x along the front, z out of it) → world, as njShopDoor does
    const at = (lx: number, lz: number) => ({ x: ox + lx * c + lz * s, z: oz - lx * s + lz * c });
    const door = at(b.doorX, 0.08);
    const corners = [at(-b.w / 2, 0), at(b.w / 2, 0), at(-b.w / 2, -b.d), at(b.w / 2, -b.d)];
    const id = `jersey:${b.key}`;
    const who = identify(id, 'jersey', b.w * b.d, b.name, b.kind);
    return {
      id,
      area: 'jersey',
      x: door.x,
      y: f.P + b.sill,
      z: door.z,
      yaw,
      width: b.doorW,
      footprint: {
        minX: Math.min(...corners.map(q => q.x)),
        maxX: Math.max(...corners.map(q => q.x)),
        minZ: Math.min(...corners.map(q => q.z)),
        maxZ: Math.max(...corners.map(q => q.z)),
        height: b.h,
      },
      kind: who.kind,
      name: who.name,
    };
  });
}
