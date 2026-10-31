// ── NOUNS CAMP, built: the shell's insides, the mess, the window, the stair ──
//
// Built once with the level (Game.start, before the level is toonified and
// its collision is built), in the room frame (site.ts) under one group at
// the room's origin. Everything goes through the interiors kit and merges
// by material: solid (vertex colours), glow (the bare bulb), art (the
// atlas: books, whiteboard, poster, notice, tag) and glass (the shards
// left in the frame), so the room is four draw calls. The fire escape is
// facades/escape.ts's tower stair, drawn and collided by buildEscape, one
// more. Collision: a box per solid piece, and the stair's own prisms.

import type { CampSite } from './site';
import type { Item, Layout, Palette } from '../../interiors/layout';
import type { EscapePlacement } from '../facades/details';

import * as THREE from 'three';

import { boxesToGeometry, buildItem } from '../../interiors/build';
import { Kit, box, boxAt, cyl, kitMaterials, panel, shade, sphere } from '../../interiors/kit';
import { mulberry32, pick } from '../../interiors/rng';
import { buildEscape } from '../facades/details';
import { planTowerEscape, type TowerEscapePlan } from '../facades/escape';
import { Geo } from '../facades/geom';

import { buildCampArt, type CampArt } from './art';
import { campLayout, solidBox, type CampLayout, type Piece } from './layout';
import { CAMP_RAMP, rampSides, rampSurface } from './miniramp';

/** Lanes start this far out from the plaza face (no bands on CAMP's face). */
export const STAIR_INSET = 0.03;

export interface CampBuild {
  group: THREE.Group;
  /** Collision meshes (world space): the furniture, the stair. */
  collision: THREE.Mesh[];
  layout: CampLayout;
  stair: TowerEscapePlan | null;
  art: CampArt;
  /** The bulb flickers. */
  animate(t: number): void;
  stats: { drawCalls: number; triangles: number };
  dispose(): void;
}

export interface CampWorld {
  /** The ring roof's height east of the tower (where the stair lands). */
  roof: number;
  /** Its parapet's top and depth (in from the facade line). */
  parapet: number;
  parapetDepth: number;
  /** World x of the tower's base east edge (the stair lands past it). */
  towerMaxX: number;
}

const PALETTE: Palette = {
  wall: 0xd9d1c0,
  wall2: 0xa2937c,
  floor: 0x9a7650,
  floor2: 0x7d5e40,
  trim: 0x4a4038,
  ceiling: 0xe2dccd,
  wood: 0x8a6440,
  fabric: 0x6f7f5a,
  accent: 0xc0533a,
  metal: 0x8a9096,
};
const LAYOUT_STUB = { kind: 'home', items: [], h: 3.5 } as unknown as Layout;

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();

export function buildCamp(site: CampSite, world: CampWorld, opts: { low: boolean }): CampBuild {
  const winX0 = site.window.x0 - site.origin.x;
  const winX1 = site.window.x1 - site.origin.x;
  const layout = campLayout(site.w, site.d, site.h, winX0, winX1);
  const art = buildCampArt();
  const kit = new Kit();
  const rnd = mulberry32(0xca3b);
  const at = (x: number, y: number, z: number, yaw = 0, roll = 0, pitch = 0, s = 1) => {
    _e.set(pitch, yaw, roll, 'YXZ');
    kit.frame.compose(new THREE.Vector3(x, y, z), _q.setFromEuler(_e), new THREE.Vector3(s, s, s));
  };
  const reset = () => kit.frame.identity();

  shell(kit, site, layout, rnd);
  windowFrame(kit, site, winX0, winX1, rnd);
  for (const q of layout.pieces) {
    kit.tag = q.type;
    piece(kit, q, art, at);
    reset();
  }

  // The kitchen's cups and jars would be instanced meshes, a draw call per
  // shape: the cupboards were cleared out when they condemned it
  kit.small.clear();
  const mats = kitMaterials(art.texture);
  const built = kit.build(mats, !opts.low);
  const group = new THREE.Group();
  group.name = 'NounsCamp';
  for (const m of built.meshes) group.add(m);
  group.position.set(site.origin.x, site.origin.y, site.origin.z);
  group.updateMatrixWorld(true);

  // Collision: the solid pieces
  const boxes = layout.pieces
    .filter(q => q.solid)
    .map(q => {
      const b = solidBox(q);
      const o = site.origin;
      return new THREE.Box3(
        new THREE.Vector3(o.x + b.minX, o.y, o.z + b.minZ),
        new THREE.Vector3(o.x + b.maxX, o.y + Math.max(0.3, b.h), o.z + b.maxZ),
      );
    });
  const collision: THREE.Mesh[] = [];
  // The mini ramp collides as its own surface (skateable), not a box
  const ramp = layout.pieces.find(q => q.type === 'miniramp');
  const rampTris: number[] = [];
  if (ramp !== undefined) {
    const t = rampSurface(CAMP_RAMP);
    const o = site.origin;
    for (let i = 0; i < t.length; i += 3)
      rampTris.push(o.x + ramp.x + t[i]!, o.y + t[i + 1]!, o.z + ramp.z + t[i + 2]!);
  }
  const furn = new THREE.Mesh(boxesToGeometry(boxes, rampTris));
  furn.name = 'COL_Camp';
  furn.updateMatrixWorld(true);
  collision.push(furn);

  // The fire escape, off the window's walkway down onto the roof east of the tower
  const L = site.tier.maxX - site.tier.minX;
  const bottom = world.parapet + 0.2;
  const landU0 = world.towerMaxX - site.tier.minX + 0.5;
  const stair = planTowerEscape({
    length: L,
    top: site.floorY,
    bottom,
    inset: STAIR_INSET,
    exitEnd: 'B',
    exit: landU0 + 2.4 - L,
    land: { u0: landU0, u1: landU0 + 2, roof: world.roof, depth: world.parapetDepth },
  });
  let stairTris = 0;
  let stairMat: THREE.Material | null = null;
  const disposeGeo: THREE.BufferGeometry[] = [];
  if (stair !== null) {
    const place: EscapePlacement = {
      face: {
        nx: 0,
        nz: -1,
        at: site.faceZ,
        s0: site.tier.minX,
        s1: site.tier.maxX,
        y0: bottom,
        y1: site.floorY,
        lm: null,
      },
      a: site.tier.minX,
      b: site.tier.maxX,
      ladderAtS1: true,
      plan: stair,
    };
    const detail = new Geo();
    const fine = new Geo();
    const collide = new Geo();
    buildEscape(detail, fine, collide, place, opts.low);
    detail.append(fine);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(detail.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(detail.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(detail.col, 3));
    g.computeBoundingBox();
    g.computeBoundingSphere();
    stairMat = new THREE.MeshStandardMaterial({
      name: 'camp_escape',
      vertexColors: true,
      roughness: 0.8,
      metalness: 0.1,
    });
    const mesh = new THREE.Mesh(g, stairMat);
    mesh.name = 'CampEscape';
    mesh.castShadow = !opts.low;
    mesh.receiveShadow = true;
    // In world space: under the level root, not the room's group
    const holder = new THREE.Group();
    holder.name = 'CampEscapeHolder';
    holder.add(mesh);
    holder.position.set(-site.origin.x, -site.origin.y, -site.origin.z);
    group.add(holder);
    group.updateMatrixWorld(true);
    stairTris = detail.pos.length / 9;
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(collide.pos, 3));
    const cm = new THREE.Mesh(cg);
    cm.name = 'COL_CampEscape';
    cm.updateMatrixWorld(true);
    collision.push(cm);
    disposeGeo.push(g, cg);
  }

  // The bulb buzzes and catches
  const glow = mats.glow as THREE.MeshBasicMaterial;
  const animate = (t: number) => {
    const s = Math.sin(t * 1.7) + Math.sin(t * 4.3 + 1);
    const out = s > 1.55 || (t % 7.3 > 7.0 && t % 7.3 < 7.12);
    glow.color.setScalar(out ? 0.25 : 0.95 + 0.05 * Math.sin(t * 50));
  };
  return {
    group,
    collision,
    layout,
    stair,
    art,
    animate,
    stats: {
      drawCalls: built.meshes.length + (stair !== null ? 1 : 0),
      triangles: Math.round(built.triangles + stairTris),
    },
    dispose() {
      for (const d of built.disposables) d.dispose();
      for (const m of new Set(Object.values(mats))) m.dispose();
      stairMat?.dispose();
      for (const g of disposeGeo) g.dispose();
      for (const c of collision) c.geometry.dispose();
      art.dispose();
      group.removeFromParent();
    },
  };
}

// ── The shell: floor, walls, ceiling, all wrecked ──────────────────────

/** Inner faces sit this far inside the tower's shell (no shared planes). */
const IN = 0.03;

function shell(kit: Kit, site: CampSite, l: CampLayout, rnd: () => number) {
  kit.tag = 'shell';
  const W = l.w / 2;
  const D = l.d;
  const H = l.h;
  const P = PALETTE;
  // Floorboards along x, a few missing, dust in patches
  const plank = 0.22;
  for (let z = 0; z < D - 1e-3; z += plank) {
    const z1 = Math.min(D, z + plank);
    let x = -W;
    while (x < W - 1e-3) {
      const len = 1.2 + rnd() * 2.4;
      const x1 = Math.min(W, x + len);
      const r = rnd();
      if (r < 0.04 && z > 0.6) {
        // a board gone: the joists show
        kit.add(boxAt(x, x1, -0.03, -0.005, z + 0.01, z1 - 0.01), 0x2a2018);
      } else {
        const c =
          r < 0.2
            ? 0x9a8a72
            : shade(pick(rnd, [P.floor, P.floor2, shade(P.floor, 0.1)]), (rnd() - 0.5) * 0.12);
        kit.add(boxAt(x + 0.004, x1 - 0.004, -0.03, 0.02, z + 0.004, z1 - 0.004), c);
      }
      x = x1;
    }
  }
  // Walls: dirty two-tone, a dado rail, skirting; the plaza wall round the window
  const walls: { a: [number, number]; along: 'x' | 'z'; at: number; n: 1 | -1 }[] = [
    { a: [-W, W], along: 'x', at: D - IN, n: -1 }, // back
    { a: [0, D], along: 'z', at: -W + IN, n: 1 }, // west
    { a: [0, D], along: 'z', at: W - IN, n: -1 }, // east
  ];
  const winX0 = site.window.x0 - site.origin.x;
  const winX1 = site.window.x1 - site.origin.x;
  const winY1 = site.window.y1 - site.floorY;
  const T = 0.02;
  const slab = (
    along: 'x' | 'z',
    at: number,
    n: number,
    a0: number,
    a1: number,
    y0: number,
    y1: number,
    c: number,
    out = 0,
  ) => {
    const f = at + n * out;
    if (along === 'x')
      kit.add(boxAt(a0, a1, y0, y1, Math.min(f, f - n * T), Math.max(f, f - n * T)), c);
    else kit.add(boxAt(Math.min(f, f - n * T), Math.max(f, f - n * T), y0, y1, a0, a1), c);
  };
  const dado = 1.0;
  const wallRuns = [
    ...walls,
    { a: [-W, winX0] as [number, number], along: 'x' as const, at: IN, n: 1 as const },
    { a: [winX1, W] as [number, number], along: 'x' as const, at: IN, n: 1 as const },
  ];
  for (const w of wallRuns) {
    slab(w.along, w.at, w.n, w.a[0], w.a[1], 0, dado, P.wall2);
    slab(w.along, w.at, w.n, w.a[0], w.a[1], dado, H, P.wall);
    slab(w.along, w.at, w.n, w.a[0], w.a[1], dado - 0.03, dado + 0.03, P.trim, 0.02);
    slab(w.along, w.at, w.n, w.a[0], w.a[1], 0, 0.12, P.trim, 0.015);
    // Damp stains and plaster blown off down to the brick
    const len = w.a[1] - w.a[0];
    for (let i = 0; i < Math.round(len / 2.2); i++) {
      const a = w.a[0] + 0.3 + rnd() * (len - 0.9);
      const y = 0.5 + rnd() * (H - 1.4);
      const s = 0.3 + rnd() * 0.6;
      slab(
        w.along,
        w.at,
        w.n,
        a,
        a + s,
        y,
        y + s * (0.5 + rnd()),
        pick(rnd, [0x8b7a5e, 0x6e6152, 0xa0563c]),
        0.006,
      );
    }
  }
  // Over the window
  slab('x', IN, 1, winX0, winX1, winY1, H, P.wall);
  // The window's reveals (the wall's thickness, painted)
  kit.add(boxAt(winX0, winX0 + T, 0, winY1, -0.3, 0), P.wall2);
  kit.add(boxAt(winX1 - T, winX1, 0, winY1, -0.3, 0), P.wall2);
  kit.add(boxAt(winX0, winX1, winY1 - T, winY1, -0.3, 0), P.wall2);
  // Ceiling, with a hole where a tile came down (over the ceiling_panel)
  const hole = l.pieces.find(q => q.type === 'ceiling_panel');
  const hx = hole?.x ?? 0;
  const hz = hole?.z ?? 0;
  const rects: [number, number, number, number][] = [
    [-W, W, 0, hz - 0.6],
    [-W, W, hz + 0.6, D],
    [-W, hx - 0.6, hz - 0.6, hz + 0.6],
    [hx + 0.6, W, hz - 0.6, hz + 0.6],
  ];
  for (const [x0, x1, z0, z1] of rects)
    if (x1 > x0 && z1 > z0) kit.add(boxAt(x0, x1, H - IN - 0.03, H - IN, z0, z1), P.ceiling);
  // Through the hole: dark void and a dangling cable
  kit.add(boxAt(hx - 0.6, hx + 0.6, H - IN + 0.02, H - IN + 0.05, hz - 0.6, hz + 0.6), 0x1b1714);
  kit.add(cyl(0.008, 0.008, 0.9, 4, hx + 0.2, H - 0.95, hz - 0.1), 0x111111);
  // Water stains on the ceiling
  for (let i = 0; i < 4; i++) {
    const x = (rnd() * 2 - 1) * (W - 1);
    const z = 1 + rnd() * (D - 2);
    if (Math.abs(x - hx) < 1 && Math.abs(z - hz) < 1) continue;
    const s = 0.5 + rnd() * 0.8;
    kit.add(boxAt(x, x + s, H - IN - 0.04, H - IN - 0.032, z, z + s * 0.8), 0xa8987a);
  }
}

/** What's left of the window: the frame, glass teeth along its edges. */
function windowFrame(kit: Kit, site: CampSite, x0: number, x1: number, rnd: () => number) {
  kit.tag = 'window';
  const y1 = site.window.y1 - site.floorY;
  const iron = 0x2a2d33;
  const z0 = -0.2;
  const z1 = -0.12;
  kit.add(boxAt(x0 + 0.02, x0 + 0.1, 0, y1 - 0.02, z0, z1), iron);
  kit.add(boxAt(x1 - 0.1, x1 - 0.02, 0, y1 - 0.02, z0, z1), iron);
  kit.add(boxAt(x0 + 0.02, x1 - 0.02, y1 - 0.1, y1 - 0.02, z0, z1), iron);
  // Mullions: one bent, one hanging off its top fixing
  const m1 = x0 + (x1 - x0) / 3;
  const m2 = x0 + ((x1 - x0) * 2) / 3;
  kit.add(boxAt(m1 - 0.04, m1 + 0.04, y1 - 1.1, y1 - 0.1, z0, z1), iron);
  kit.frame.compose(
    new THREE.Vector3(m2, y1 - 0.1, (z0 + z1) / 2),
    _q2.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.35),
    new THREE.Vector3(1, 1, 1),
  );
  kit.add(boxAt(-0.04, 0.04, -1.9, 0, -0.04, 0.04), iron);
  kit.frame.identity();
  // Glass teeth on the frame's edges
  const tooth = (x: number, y: number, up: boolean, s: number) => {
    const g = new THREE.BufferGeometry();
    const h = (up ? 1 : -1) * s;
    const v = [x - s * 0.4, y, -0.16, x + s * 0.5, y, -0.16, x + rnd() * 0.1, y + h, -0.16];
    g.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [...v, v[0]!, v[1]!, v[2]! + 0.01, v[6]!, v[7]!, v[8]! + 0.01, v[3]!, v[4]!, v[5]! + 0.01],
        3,
      ),
    );
    g.computeVertexNormals();
    kit.add(g, 0xbfe3f0, 'glass');
  };
  for (let x = x0 + 0.2; x < x1 - 0.2; x += 0.25 + rnd() * 0.4) {
    if (rnd() < 0.7) tooth(x, y1 - 0.1, false, 0.08 + rnd() * 0.3);
    if (rnd() < 0.35) tooth(x, 0.02, true, 0.05 + rnd() * 0.14);
  }
  for (let y = 0.3; y < y1 - 0.3; y += 0.3 + rnd() * 0.5)
    if (rnd() < 0.5) tooth(x1 - 0.12, y, rnd() < 0.5, 0.1 + rnd() * 0.2);
  // Shards on the floor inside
  for (let i = 0; i < 14; i++) {
    const x = x0 + rnd() * (x1 - x0);
    const z = 0.1 + rnd() * 1.2;
    kit.add(
      boxAt(x, x + 0.04 + rnd() * 0.1, 0.02, 0.026, z, z + 0.03 + rnd() * 0.08),
      0xd6eef5,
      'glass',
    );
  }
}

// ── The pieces ─────────────────────────────────────────────────────────

type At = (
  x: number,
  y: number,
  z: number,
  yaw?: number,
  roll?: number,
  pitch?: number,
  s?: number,
) => void;

const item = (type: Item['type'], q: Piece, seed: number, over: Partial<Item> = {}): Item => ({
  type,
  x: 0,
  z: 0,
  rot: 0,
  w: q.w,
  d: q.d,
  h: q.h,
  solid: true,
  seed,
  ...over,
});

const TUB_COLS = [0xf6c6d8, 0xd7f0e2, 0xf4ead2, 0x8a5a3a, 0xf6c6d8, 0xbfe0f6];

function piece(kit: Kit, q: Piece, art: CampArt, at: At) {
  const P = PALETTE;
  const r = mulberry32(0xb00c + Math.round(q.x * 97 + q.z * 131 + q.v));
  switch (q.type) {
    case 'sofa': {
      // One leg gone: it sags to the left
      at(q.x, -0.04, q.z, q.yaw, 0.05);
      buildItem(
        kit,
        item('sofa', q, 7),
        P,
        mulberry32(7),
        { slots: [], named: new Map() } as never,
        LAYOUT_STUB,
      );
      // Stuffing out of a torn cushion, a stain
      for (let i = 0; i < 4; i++)
        kit.add(sphere(0.08 + r() * 0.06, -0.5 + r() * 0.5, 0.52, r() * 0.3, 6, 4), 0xf1ece0);
      kit.add(boxAt(0.2, 0.7, 0.505, 0.51, -0.05, 0.3), 0x4e5240);
      break;
    }
    case 'coffee_table': {
      at(q.x, 0, q.z, q.yaw);
      buildItem(
        kit,
        item('coffee_table', q, 3),
        { ...P, wood: 0x5b4330 },
        mulberry32(3),
        { slots: [], named: new Map() } as never,
        LAYOUT_STUB,
      );
      // Rings from cans, a crushed can
      kit.add(cyl(0.035, 0.035, 0.005, 8, -0.4, q.h, 0.15), 0x3f2d1f);
      kit.add(cyl(0.035, 0.035, 0.005, 8, 0.45, q.h, -0.2), 0x3f2d1f);
      kit.add(cyl(0.036, 0.03, 0.05, 8, -0.5, q.h, -0.18), 0xc23a2b);
      break;
    }
    case 'armchair_tipped': {
      // On its back
      at(q.x, q.d / 2, q.z, q.yaw, 0, -Math.PI / 2);
      buildItem(
        kit,
        item('armchair', q, 11),
        { ...P, fabric: 0x8a5a4a },
        mulberry32(11),
        { slots: [], named: new Map() } as never,
        LAYOUT_STUB,
      );
      break;
    }
    case 'chair_tipped': {
      at(q.x, q.w / 2, q.z, q.yaw, Math.PI / 2);
      buildItem(
        kit,
        item('chair', q, 5),
        P,
        mulberry32(5),
        { slots: [], named: new Map() } as never,
        LAYOUT_STUB,
      );
      break;
    }
    case 'kitchen': {
      at(q.x, 0, q.z, q.yaw);
      buildItem(
        kit,
        item('kitchen', q, 13),
        { ...P, wood: 0x6e7a6a },
        mulberry32(13),
        { slots: [], named: new Map() } as never,
        LAYOUT_STUB,
      );
      // A cupboard door off its hinge, dishes piled
      kit.add(boxAt(-0.9, -0.5, 0.02, 0.05, 0.4, 0.95), 0x6e7a6a);
      for (let i = 0; i < 4; i++)
        kit.add(cyl(0.11, 0.09, 0.025, 10, 0.5 + r() * 0.1, 0.93 + i * 0.03, 0.05), 0xe8e4da);
      break;
    }
    case 'pool_table': {
      at(q.x, 0, q.z, q.yaw);
      buildItem(
        kit,
        item('pool_table', q, 19),
        P,
        mulberry32(19),
        { slots: [], named: new Map() } as never,
        LAYOUT_STUB,
      );
      break;
    }
    case 'miniramp': {
      at(q.x, 0, q.z);
      const s = CAMP_RAMP;
      const top = new THREE.BufferGeometry();
      top.setAttribute('position', new THREE.Float32BufferAttribute(rampSurface(s, false), 3));
      top.computeVertexNormals();
      kit.add(top, 0xc8a46a);
      const sides = new THREE.BufferGeometry();
      sides.setAttribute('position', new THREE.Float32BufferAttribute(rampSides(s), 3));
      sides.computeVertexNormals();
      kit.add(sides, 0x8a6a42);
      // Steel coping on both lips, a NOUNS CAMP stripe on the flat
      const lip = s.length / 2 - s.deck;
      for (const sx of [-1, 1])
        kit.add(
          cyl(0.03, 0.03, s.width, 8)
            .rotateX(Math.PI / 2)
            .translate(sx * lip, s.height, 0),
          0xb8bec6,
        );
      kit.add(boxAt(-0.9, 0.9, 0.001, 0.004, -0.12, 0.12), 0xf3322c);
      break;
    }
    case 'fridge': {
      at(q.x, 0, q.z, q.yaw);
      buildItem(
        kit,
        item('fridge', q, 17),
        P,
        mulberry32(17),
        { slots: [], named: new Map() } as never,
        LAYOUT_STUB,
      );
      break;
    }
    case 'bookshelf_down': {
      // Fallen on its face, books spilled out round it
      at(q.x, 0, q.z, q.yaw);
      kit.add(boxAt(-q.w / 2, q.w / 2, 0, 0.36, -q.d / 2, q.d / 2), shade(P.wood, -0.25));
      kit.add(
        boxAt(-q.w / 2 + 0.03, q.w / 2 - 0.03, 0.36, 0.38, -q.d / 2 + 0.05, q.d / 2 - 0.05),
        shade(P.wood, -0.1),
      );
      for (let i = 0; i < 12; i++) {
        const x = (r() - 0.5) * (q.w + 1.4);
        const z = (r() - 0.5) * (q.d + 0.8);
        if (Math.abs(x) < q.w / 2 + 0.05 && Math.abs(z) < q.d / 2 + 0.05) continue;
        at(q.x + x, 0, q.z + z, r() * 6, r() < 0.5 ? Math.PI / 2 : 0);
        kit.add(
          box(0.05, 0.24, 0.17, 0, -0.025, 0),
          pick(r, [0xc23a2b, 0x2c6fb0, 0xf2c94c, 0x2f8a5f, 0x222222]),
        );
      }
      break;
    }
    case 'lamp_down': {
      at(q.x, 0.03, q.z, q.yaw, Math.PI / 2 - 0.04);
      kit.add(cyl(0.015, 0.015, 1.5, 6), 0x2b2b2b);
      kit.add(cyl(0.14, 0.14, 0.03, 10), 0x2b2b2b);
      kit.add(cyl(0.12, 0.22, 0.26, 10, 0, 1.45), 0xd8cdb0);
      break;
    }
    case 'mattress': {
      at(q.x, 0, q.z, q.yaw);
      kit.add(boxAt(-q.w / 2, q.w / 2, 0, q.h, -q.d / 2, q.d / 2), 0xd9d2bf);
      kit.add(boxAt(-q.w / 2 + 0.1, 0.2, q.h - 0.005, q.h + 0.002, -0.2, 0.35), 0xb4a47a); // the stain
      kit.add(
        boxAt(-q.w / 2 + 0.05, q.w / 2 - 0.2, q.h, q.h + 0.08, -0.1, q.d / 2 - 0.1),
        0x5a6f8f,
      ); // a sleeping bag
      kit.add(
        boxAt(-q.w / 2 + 0.1, -q.w / 2 + 0.7, q.h, q.h + 0.12, -q.d / 2 + 0.08, -q.d / 2 + 0.45),
        0xf1ece0,
      );
      break;
    }
    case 'whiteboard': {
      // Hanging off one screw
      at(q.x, q.y, q.z, q.yaw, 0.045);
      kit.add(boxAt(-q.w / 2 - 0.04, q.w / 2 + 0.04, -0.04, q.h + 0.04, -0.02, 0.02), 0x9aa3aa);
      kit.addArt(panel(q.w, q.h, 0, q.h / 2, 0.025), art.slot.whiteboard);
      kit.add(boxAt(-q.w / 2, q.w / 2, -0.06, -0.03, 0, 0.09), 0x9aa3aa); // the tray
      kit.add(cyl(0.012, 0.012, 0.13, 6, 0.3, -0.02, 0.05).rotateZ(Math.PI / 2), 0xe8332a);
      break;
    }
    case 'poster': {
      at(q.x, q.y, q.z, q.yaw, -0.07);
      kit.addArt(panel(q.w, q.h, 0, q.h / 2, 0.004), art.slot.poster);
      break;
    }
    case 'notice': {
      at(q.x, q.y, q.z, q.yaw, 0.03);
      kit.addArt(panel(q.w, q.h, 0, q.h / 2, 0.003), art.slot.notice);
      break;
    }
    case 'tag': {
      at(q.x, q.y, q.z, q.yaw);
      kit.addArt(panel(q.w, q.h, 0, q.h / 2, 0.003), art.slot.tag);
      break;
    }
    case 'boarded_door': {
      at(q.x, 0, q.z, q.yaw);
      kit.add(boxAt(-q.w / 2 - 0.08, q.w / 2 + 0.08, 0, q.h + 0.08, -0.01, 0.04), P.trim);
      kit.add(boxAt(-q.w / 2, q.w / 2, 0, q.h, 0.0, 0.05), 0x3b3530);
      // Planks nailed across
      for (const [y, a] of [
        [0.45, 0.12],
        [1.05, -0.18],
        [1.7, 0.08],
      ] as const) {
        const f = kit.frame.clone();
        kit.frame.multiply(
          new THREE.Matrix4().compose(
            new THREE.Vector3(0, y, 0.08),
            _q2.setFromAxisAngle(new THREE.Vector3(0, 0, 1), a),
            new THREE.Vector3(1, 1, 1),
          ),
        );
        kit.add(
          boxAt(-q.w / 2 - 0.2, q.w / 2 + 0.2, -0.08, 0.08, -0.025, 0.025),
          shade(0xa88a5a, (r() - 0.5) * 0.3),
        );
        kit.frame.copy(f);
      }
      break;
    }
    case 'tape': {
      at(q.x, q.y, q.z, q.yaw);
      for (const a of [0.85, -0.85]) {
        const f = kit.frame.clone();
        kit.frame.multiply(
          new THREE.Matrix4().compose(
            new THREE.Vector3(0, q.h / 2, 0.13),
            _q2.setFromAxisAngle(new THREE.Vector3(0, 0, 1), a),
            new THREE.Vector3(1, 1, 1),
          ),
        );
        kit.add(boxAt(-q.w / 2, q.w / 2, -0.04, 0.04, -0.005, 0.005), 0xf2c230);
        for (let x = -q.w / 2 + 0.1; x < q.w / 2 - 0.1; x += 0.2)
          kit.add(boxAt(x, x + 0.08, -0.04, 0.04, 0.004, 0.008), 0x1a1a1a);
        kit.frame.copy(f);
      }
      break;
    }
    case 'bulb': {
      at(q.x, q.y, q.z);
      kit.add(cyl(0.006, 0.006, q.h - 0.1, 4, 0, 0.1), 0x111111);
      kit.add(cyl(0.025, 0.025, 0.05, 8, 0, 0.06), 0x2b2b2b);
      kit.add(sphere(0.055, 0, 0.03, 0, 8, 6), 0xffe2a0, 'glow');
      break;
    }
    case 'ceiling_panel': {
      // Hinged off one edge, hanging down
      at(q.x - q.w / 2, q.y + 1.07, q.z, q.yaw, -1.0);
      kit.add(boxAt(0, q.w, -0.03, 0, -q.d / 2, q.d / 2), PALETTE.ceiling);
      break;
    }
    case 'trash': {
      at(q.x, 0, q.z, q.yaw);
      for (let i = 0; i < 3; i++) {
        const s = q.h * (0.5 + r() * 0.4);
        const g = sphere(
          s / 2,
          (r() - 0.5) * q.w * 0.6,
          s * 0.4,
          (r() - 0.5) * q.d * 0.6,
          7,
          5,
        ).scale(1, 0.8, 1);
        kit.add(g, pick(r, [0x1d1f22, 0x2a2c30, 0x3a3a2a]));
        kit.add(cyl(0.02, 0.04, 0.08, 5, (r() - 0.5) * 0.1, s * 0.8, 0), 0x1d1f22);
      }
      break;
    }
    case 'tub': {
      // Empty ice cream tubs: some upright and licked clean, some on their side
      const side = q.v % 3 === 1;
      const col = TUB_COLS[q.v % TUB_COLS.length]!;
      at(q.x, side ? 0.07 : 0, q.z, q.yaw, side ? Math.PI / 2 : 0);
      kit.add(cyl(0.085, 0.07, 0.13, 10, 0, side ? -0.065 : 0), col);
      kit.add(cyl(0.075, 0.075, 0.005, 10, 0, side ? 0.062 : 0.128), 0x5a4030);
      kit.add(cyl(0.086, 0.086, 0.02, 10, 0, side ? -0.03 : 0.07), 0xffffff);
      if (!side) {
        // the lid, dropped beside it, and the spoon
        at(q.x + 0.16 * Math.cos(q.yaw), 0, q.z + 0.16 * Math.sin(q.yaw), q.yaw);
        kit.add(cyl(0.09, 0.09, 0.012, 10), shade(col, -0.15));
        kit.add(boxAt(0.1, 0.22, 0, 0.008, -0.01, 0.01), 0xf4f1ea);
      }
      break;
    }
    case 'can': {
      const down = q.v % 2 === 0;
      at(q.x, down ? 0.034 : 0, q.z, q.yaw, down ? Math.PI / 2 : 0);
      kit.add(
        cyl(0.034, 0.034, 0.12, 8, 0, down ? -0.06 : 0),
        pick(r, [0xc23a2b, 0x2c6fb0, 0xd8d8d8, 0x2f8a5f, 0xf2c94c]),
      );
      break;
    }
    case 'bottle': {
      at(q.x, 0.035, q.z, q.yaw, Math.PI / 2);
      kit.add(cyl(0.035, 0.035, 0.2, 8, 0, -0.1), pick(r, [0x2f6a3a, 0x6a3a1a, 0x9fc6b0]));
      kit.add(cyl(0.012, 0.03, 0.08, 6, 0, 0.1), pick(r, [0x2f6a3a, 0x6a3a1a]));
      break;
    }
    case 'debris': {
      at(q.x, 0, q.z, q.yaw);
      for (let i = 0; i < 3; i++) {
        const s = 0.04 + r() * 0.12;
        const g = boxAt(-s, s, 0, s * 0.6, -s * 0.7, s * 0.7)
          .rotateY(r() * 3)
          .translate((r() - 0.5) * 0.3, 0, (r() - 0.5) * 0.3);
        kit.add(g, pick(r, [0xd8d2c4, 0xb9b2a4, 0x9a9184, 0xa0563c]));
      }
      break;
    }
    case 'book_stack': {
      // Closed copies of MEME VALUE, the top one's cover up
      const n = q.v;
      const t = 0.026;
      const s = 0.25;
      for (let i = 0; i < n; i++) {
        at(q.x, q.y + i * t, q.z, q.yaw + (r() - 0.5) * 0.35);
        kit.add(boxAt(-s / 2, s / 2, 0, t, -s / 2, s / 2), 0xf6f4ee);
        kit.addArt(panel(s - 0.01, t - 0.008, 0, t / 2, s / 2 + 0.001), art.slot.edge);
        if (i === n - 1)
          kit.addArt(
            panel(s, s)
              .rotateX(-Math.PI / 2)
              .translate(0, t + 0.001, 0),
            art.slot.cover,
          );
      }
      break;
    }
    case 'book_open': {
      // A copy lying open at its page, the spine a little proud
      at(q.x, q.y, q.z, q.yaw);
      const s = 0.25;
      kit.add(boxAt(-s, s, 0, 0.012, -s / 2, s / 2), 0xf6f4ee);
      kit.add(boxAt(-0.012, 0.012, 0, 0.02, -s / 2, s / 2), 0xe2ddd0);
      kit.addArt(
        panel(2 * s - 0.01, s - 0.008)
          .rotateX(-Math.PI / 2)
          .translate(0, 0.0135, 0),
        art.slot.spread[q.v % art.slot.spread.length]!,
      );
      break;
    }
    default:
      break;
  }
}
