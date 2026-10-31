// ── Interior builder: a Layout → three.js meshes + collision ─────────────
//
// The shell (floor pattern, two-tone walls with skirting and cornice, the
// ceiling and its fixtures, the door you came in by, windows onto the
// street, a partition with a doorway in homes), then every item from the
// kit, then wall decor from the room's atlas, then clutter on every
// surface. All in the room frame (layout.ts), under one group the caller
// places at the interior's pocket. Collision is the shell plus a box per
// solid item, as one position-only geometry for CollisionWorld.setDynamic.

import type { ArtAtlas } from './art';
import type { Box2, Decor, Item, Layout, Palette } from './layout';
import type { StairPlan } from './storeys';

import * as THREE from 'three';

import { GOOD_IDS } from '../trade/goods';

import { Kit, box, boxAt, cyl, kitMaterials, panel, ring, shade, sphere } from './kit';
import { itemBox } from './layout';
import { mulberry32, pick, type Rng } from './rng';
import { resolveFights } from './zfight';

/** Walls run this high (above the visible ceiling) so the camera never sees past them. */
export const WALL_TOP = 4.6;
/** Collision ceiling (the camera's probes start below it). */
export const COL_CEILING = 4.5;
const T = 0.2;

export interface BuiltInterior {
  group: THREE.Group;
  /** Collision triangles in the room frame (position only). */
  collision: THREE.BufferGeometry;
  /** Glowing bits that flicker/animate (neon, screens). */
  animate: (t: number) => void;
  dispose(): void;
  stats: { drawCalls: number; triangles: number; items: number };
}

const GOOD_COLORS: Record<string, number> = {
  ICECREAM: 0xf6d6e8,
  FRIES: 0xf2c94c,
  FISH: 0x7fb3d5,
  DRIP: 0xe8543f,
  NOGGLES: 0xf3322c,
  PIZZA: 0xf2994a,
  WATER: 0x9fd8ef,
};

const BOOK_COLS = [0xc23a2b, 0x2c6fb0, 0xf2c94c, 0x2f8a5f, 0xf4f1ea, 0x6b4a8a, 0x222222, 0xe8742b];

/** Everything in the room as kit geometry (no materials yet): tests read it. */
export function buildKit(l: Layout, atlas: Pick<ArtAtlas, 'slots' | 'named'>): Kit {
  const kit = new Kit();
  const P = l.palette;
  const rnd = mulberry32(l.seed ^ 0x5eed);
  kit.tag = 'shell';
  shell(kit, l, rnd);
  l.items.forEach(it => {
    kit.tag = it.type;
    kit.frame.compose(
      new THREE.Vector3(it.x, 0, it.z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (it.rot * Math.PI) / 2),
      new THREE.Vector3(1, 1, 1),
    );
    buildItem(kit, it, P, mulberry32(it.seed), atlas, l);
    // Stairs and the stairwell are 'solid' for the planner (nothing gets put
    // on them) but not walls: the flight's collision is its ramp (buildFlight),
    // and a box over it stopped you dead at the foot of the stairs
    if (it.solid && !WALK_THROUGH.has(it.type)) {
      const b = itemBox(it);
      kit.col.push(
        new THREE.Box3(
          new THREE.Vector3(b.minX, 0, b.minZ),
          new THREE.Vector3(b.maxX, Math.max(0.3, it.h), b.maxZ),
        ),
      );
    }
  });
  l.decor.forEach((d, i) => {
    kit.tag = `decor:${d.type}`;
    buildDecor(kit, d, i, l, atlas, mulberry32(d.seed));
  });
  // Collision: floor, walls, ceiling, partitions + items
  const W = l.w;
  const D = l.d;
  // The floor slab (with the stairwell cut out upstairs)
  const hole = l.stairs?.down ?? null;
  for (const r of subtractRect(
    { minX: -W / 2 - 1, maxX: W / 2 + 1, minZ: -1, maxZ: D + 1 },
    hole === null ? null : { minX: hole.x0, maxX: hole.x1, minZ: hole.z0, maxZ: hole.z1 },
  ))
    kit.col.push(
      new THREE.Box3(new THREE.Vector3(r.minX, -0.5, r.minZ), new THREE.Vector3(r.maxX, 0, r.maxZ)),
    );
  kit.col.push(
    new THREE.Box3(new THREE.Vector3(-W / 2 - 1, 0, -1), new THREE.Vector3(W / 2 + 1, WALL_TOP, 0)),
    new THREE.Box3(
      new THREE.Vector3(-W / 2 - 1, 0, D),
      new THREE.Vector3(W / 2 + 1, WALL_TOP, D + 1),
    ),
    new THREE.Box3(
      new THREE.Vector3(-W / 2 - 1, 0, -1),
      new THREE.Vector3(-W / 2, WALL_TOP, D + 1),
    ),
    new THREE.Box3(new THREE.Vector3(W / 2, 0, -1), new THREE.Vector3(W / 2 + 1, WALL_TOP, D + 1)),
  );
  // A ceiling, unless there's a floor above (its slab is the ceiling, open over the stairs)
  if (l.stairs?.up == null)
    kit.col.push(
      new THREE.Box3(
        new THREE.Vector3(-W / 2 - 1, COL_CEILING, -1),
        new THREE.Vector3(W / 2 + 1, COL_CEILING + 0.3, D + 1),
      ),
    );
  for (const p of l.partitions) {
    if (p.axis !== 'z') continue;
    kit.col.push(
      new THREE.Box3(
        new THREE.Vector3(p.from, 0, p.at - 0.06),
        new THREE.Vector3(p.gap[0], WALL_TOP, p.at + 0.06),
      ),
      new THREE.Box3(
        new THREE.Vector3(p.gap[1], 0, p.at - 0.06),
        new THREE.Vector3(p.to, WALL_TOP, p.at + 0.06),
      ),
      new THREE.Box3(
        new THREE.Vector3(p.gap[0], 2.25, p.at - 0.06),
        new THREE.Vector3(p.gap[1], WALL_TOP, p.at + 0.06),
      ),
    );
  }
  // Nothing laid on something else may share its plane (labels, bands,
  // lamp panels, rugs, art): pull every coplanar overlap apart. (Browser
  // checks can switch it off to show the before: `__interiorsNoZFix`.)
  if ((globalThis as { __interiorsNoZFix?: boolean }).__interiorsNoZFix !== true)
    resolveFights(kit.all());
  return kit;
}

export function buildInterior(
  l: Layout,
  atlas: ArtAtlas,
  opts: { shadows: boolean },
): BuiltInterior {
  const kit = buildKit(l, atlas);
  const collision = boxesToGeometry(kit.col, kit.colTris);

  const mats = kitMaterials(atlas.texture);
  const built = kit.build(mats, opts.shadows);
  const group = new THREE.Group();
  group.name = `Interior:${l.id}`;
  for (const m of built.meshes) group.add(m);
  // Neon and screens shimmer a little
  const glow = mats.glow as THREE.MeshBasicMaterial;
  const artGlow = mats.artGlow as THREE.MeshBasicMaterial;
  const animate = (t: number) => {
    const k = 0.92 + 0.08 * Math.sin(t * 7.3) * Math.sin(t * 2.1);
    glow.color.setScalar(k);
    artGlow.color.setScalar(0.94 + 0.06 * Math.sin(t * 3.7));
  };
  return {
    group,
    collision,
    animate,
    stats: {
      drawCalls: built.meshes.length,
      triangles: Math.round(built.triangles),
      items: l.items.length,
    },
    dispose: () => {
      for (const d of built.disposables) d.dispose();
      for (const m of new Set(Object.values(mats))) m.dispose();
      atlas.texture.dispose();
      collision.dispose();
      group.removeFromParent();
    },
  };
}

/** `b` minus `hole` as up to four rectangles (all of `b` when they don't meet). */
export function subtractRect(b: Box2, hole: Box2 | null): Box2[] {
  if (
    hole === null ||
    hole.minX >= b.maxX ||
    hole.maxX <= b.minX ||
    hole.minZ >= b.maxZ ||
    hole.maxZ <= b.minZ
  )
    return [b];
  const out: Box2[] = [];
  const z0 = Math.max(b.minZ, hole.minZ);
  const z1 = Math.min(b.maxZ, hole.maxZ);
  if (hole.minZ > b.minZ) out.push({ ...b, maxZ: hole.minZ });
  if (hole.maxZ < b.maxZ) out.push({ ...b, minZ: hole.maxZ });
  if (hole.minX > b.minX) out.push({ minX: b.minX, maxX: hole.minX, minZ: z0, maxZ: z1 });
  if (hole.maxX < b.maxX) out.push({ minX: hole.maxX, maxX: b.maxX, minZ: z0, maxZ: z1 });
  return out.filter(r => r.maxX - r.minX > 1e-4 && r.maxZ - r.minZ > 1e-4);
}

/** A kit whose `add` cuts `hole` (room frame, x/z) out of the axis-aligned boxes it's given. */
function holed(kit: Kit, hole: Box2 | null): Pick<Kit, 'add'> {
  if (hole === null) return kit;
  return {
    add(g: THREE.BufferGeometry, color: number, bucket?: Parameters<Kit['add']>[2]) {
      g.computeBoundingBox();
      const bb = g.boundingBox!;
      const parts = subtractRect(
        { minX: bb.min.x, maxX: bb.max.x, minZ: bb.min.z, maxZ: bb.max.z },
        hole,
      );
      if (parts.length === 1 && parts[0]!.minX === bb.min.x && parts[0]!.maxZ === bb.max.z) {
        kit.add(g, color, bucket);
        return;
      }
      g.dispose();
      for (const r of parts)
        kit.add(boxAt(r.minX, r.maxX, bb.min.y, bb.max.y, r.minZ, r.maxZ), color, bucket);
    },
  };
}

/** Items the planner keeps clear but you walk on / through (their own collision, if any). */
export const WALK_THROUGH: ReadonlySet<string> = new Set(['stairs', 'stairwell']);

/**
 * A straight flight in its item frame (centre of its footprint), `y0` its
 * foot: treads, risers, a stringer each side, a handrail on the open side.
 * `collide`: its ramp (a closed wedge, the feet walk up the slope) goes in.
 */
function buildFlight(kit: Kit, st: StairPlan, y0: number, P: Palette, l: Layout, collide = true) {
  const w = st.x1 - st.x0;
  const run = st.z1 - st.z0;
  const n = st.steps;
  const tread = run / n;
  const riser = st.rise / n;
  const wood = shade(P.wood, -0.05);
  const nose = shade(P.wood, 0.15);
  for (let i = 0; i < n; i++) {
    const z = -run / 2 + i * tread;
    const top = y0 + (i + 1) * riser;
    // Each step is a block down to the slope below it (no gaps to see through)
    kit.add(
      boxAt(-w / 2 + 0.05, w / 2 - 0.05, Math.max(y0, top - riser * 2.2), top, z, z + tread),
      wood,
    );
    kit.add(boxAt(-w / 2 + 0.05, w / 2 - 0.05, top - 0.03, top + 0.005, z - 0.015, z + 0.04), nose);
  }
  // Stringers: sloped slabs along both sides
  const len = Math.hypot(run, st.rise);
  const ang = Math.atan2(st.rise, run);
  for (const x of [-w / 2 + 0.025, w / 2 - 0.025])
    kit.add(
      new THREE.BoxGeometry(0.05, 0.3, len).rotateX(-ang).translate(x, y0 + st.rise / 2 + 0.05, 0),
      shade(P.trim, -0.25),
    );
  // Handrail on the room side, on posts
  const open = st.side === 'e' ? -w / 2 + 0.03 : w / 2 - 0.03;
  kit.add(
    new THREE.BoxGeometry(0.05, 0.05, len)
      .rotateX(-ang)
      .translate(open, y0 + st.rise / 2 + 0.95, 0),
    0x2b2b2b,
  );
  for (let i = 0; i <= 4; i++) {
    const f = i / 4;
    const z = -run / 2 + f * run;
    const yb = y0 + f * st.rise;
    kit.add(boxAt(open - 0.02, open + 0.02, yb, yb + 0.95, z - 0.02, z + 0.02), 0x2b2b2b);
  }
  void l;
  if (!collide) return;
  // The ramp underfoot: a closed wedge in the room frame
  const t = kit.colTris;
  const [a, b] = [st.x0, st.x1];
  const quad = (p: number[][]) =>
    t.push(...p[0]!, ...p[1]!, ...p[2]!, ...p[0]!, ...p[2]!, ...p[3]!);
  // Slope
  quad([
    [a, y0, st.z0],
    [b, y0, st.z0],
    [b, y0 + st.rise, st.z1],
    [a, y0 + st.rise, st.z1],
  ]);
  // Sides
  t.push(a, y0, st.z0, a, y0 + st.rise, st.z1, a, y0, st.z1);
  t.push(b, y0, st.z0, b, y0, st.z1, b, y0 + st.rise, st.z1);
  // Back
  quad([
    [a, y0, st.z1],
    [a, y0 + st.rise, st.z1],
    [b, y0 + st.rise, st.z1],
    [b, y0, st.z1],
  ]);
}

/** Box3 list → one non-indexed position-only geometry. */
export function boxesToGeometry(boxes: THREE.Box3[], tris: number[] = []): THREE.BufferGeometry {
  const pos: number[] = [...tris];
  const tmp = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
  const a = tmp.attributes.position as THREE.BufferAttribute;
  for (const b of boxes) {
    const sx = b.max.x - b.min.x;
    const sy = b.max.y - b.min.y;
    const sz = b.max.z - b.min.z;
    const cx = (b.max.x + b.min.x) / 2;
    const cy = (b.max.y + b.min.y) / 2;
    const cz = (b.max.z + b.min.z) / 2;
    for (let i = 0; i < a.count; i++)
      pos.push(cx + a.getX(i) * sx, cy + a.getY(i) * sy, cz + a.getZ(i) * sz);
  }
  tmp.dispose();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return g;
}

// ── Shell ────────────────────────────────────────────────────────────────

function shell(kit: Kit, l: Layout, rnd: Rng) {
  const P = l.palette;
  const W = l.w;
  const D = l.d;
  const H = l.h;
  kit.frame.identity();
  kit.base = 'shell';
  kit.tag = 'shell:floor';
  floor(kit, l, rnd);
  kit.tag = 'shell:walls';
  // Walls: inner faces at the room's edges (boxes reaching outward, tall)
  const lower = 1.05;
  const twoTone = l.kind !== 'gallery';
  const wallBox = (x0: number, x1: number, z0: number, z1: number) => {
    kit.add(boxAt(x0, x1, twoTone ? lower : 0, WALL_TOP, z0, z1), P.wall);
    if (twoTone) kit.add(boxAt(x0, x1, 0, lower, z0, z1), P.wall2);
  };
  wallBox(-W / 2 - T, W / 2 + T, -T, 0); // door wall
  wallBox(-W / 2 - T, W / 2 + T, D, D + T); // back
  wallBox(-W / 2 - T, -W / 2, 0, D); // west
  wallBox(W / 2, W / 2 + T, 0, D); // east
  // Skirting, dado rail, cornice
  const rim = (y0: number, y1: number, out: number, col: number) => {
    kit.add(boxAt(-W / 2, W / 2, y0, y1, 0, out), col);
    kit.add(boxAt(-W / 2, W / 2, y0, y1, D - out, D), col);
    kit.add(boxAt(-W / 2, -W / 2 + out, y0, y1, 0, D), col);
    kit.add(boxAt(W / 2 - out, W / 2, y0, y1, 0, D), col);
  };
  rim(0, 0.12, 0.03, P.trim);
  if (twoTone) rim(lower - 0.02, lower + 0.04, 0.035, P.trim);
  rim(H - 0.12, H, 0.06, P.trim);
  // Ceiling: one plane facing down (from above, a camera pushed up sees into the room)
  kit.add(new THREE.PlaneGeometry(W, D).rotateX(Math.PI / 2).translate(0, H, D / 2), P.ceiling);
  // The door you came in by (closed behind you), with a frame, a handle and a mat
  const dx = l.door.x;
  const dw = l.door.width;
  kit.tag = 'shell:door';
  if ((l.level ?? 0) === 0) {
    kit.add(boxAt(dx - dw / 2 - 0.12, dx + dw / 2 + 0.12, 0, 2.38, 0, 0.06), P.trim);
    kit.add(boxAt(dx - dw / 2, dx + dw / 2, 0, 2.25, 0, 0.08), shade(P.wood, -0.15));
    for (const y of [0.45, 1.35])
      kit.add(
        boxAt(dx - dw / 2 + 0.12, dx + dw / 2 - 0.12, y, y + 0.7, 0.08, 0.1),
        shade(P.wood, 0.08),
      );
    kit.add(sphere(0.045, dx + dw / 2 - 0.15, 1.05, 0.13), 0xd9b45a);
    kit.add(boxAt(dx - 0.6, dx + 0.6, 0, 0.015, 0.15, 0.95), shade(P.accent, -0.3));
    // EXIT glow over the door
    kit.add(boxAt(dx - 0.22, dx + 0.22, 2.48, 2.64, 0.02, 0.06), 0x2fbf71, 'glow');
  }
  // Partition walls (homes): with a doorway and a frame
  for (const p of l.partitions) {
    if (p.axis !== 'z') continue;
    kit.tag = 'shell:partition';
    const z0 = p.at - 0.06;
    const z1 = p.at + 0.06;
    kit.add(boxAt(p.from, p.gap[0], 0, H, z0, z1), P.wall);
    kit.add(boxAt(p.gap[1], p.to, 0, H, z0, z1), P.wall);
    kit.add(boxAt(p.gap[0], p.gap[1], 2.25, H, z0, z1), P.wall);
    kit.add(boxAt(p.gap[0] - 0.08, p.gap[1] + 0.08, 2.2, 2.32, z0 - 0.02, z1 + 0.02), P.trim);
    kit.add(boxAt(p.gap[0] - 0.08, p.gap[0], 0, 2.25, z0 - 0.02, z1 + 0.02), P.trim);
    kit.add(boxAt(p.gap[1], p.gap[1] + 0.08, 0, 2.25, z0 - 0.02, z1 + 0.02), P.trim);
    kit.add(boxAt(p.from, p.gap[0], 0, 0.1, z0 - 0.02, z1 + 0.02), P.trim);
    kit.add(boxAt(p.gap[1], p.to, 0, 0.1, z0 - 0.02, z1 + 0.02), P.trim);
  }
  // Ceiling fixtures
  for (const li of l.lights) {
    kit.tag = 'shell:light';
    kit.frame.makeTranslation(li.x, 0, li.z);
    if (li.kind === 'pendant') {
      // Short drops: the camera looks down past them from above
      const drop = Math.min(0.55, H - 2.6);
      kit.add(cyl(0.008, 0.008, drop, 4, 0, H - drop), 0x222222);
      kit.add(cyl(0.08, 0.32, 0.26, 12, 0, H - drop - 0.2), P.accent);
      kit.add(cyl(0.28, 0.28, 0.02, 12, 0, H - drop - 0.21), 0xfff2c4, 'glow');
      kit.add(sphere(0.08, 0, H - drop - 0.12, 0, 8, 6), 0xfff6d8, 'glow');
    } else if (li.kind === 'panel') {
      kit.add(boxAt(-0.6, 0.6, H - 0.05, H, -0.3, 0.3), 0xf4f7ff, 'glow');
      kit.add(boxAt(-0.65, 0.65, H - 0.03, H, -0.35, 0.35), P.trim);
    } else if (li.kind === 'neon') {
      kit.add(
        boxAt(-0.9, 0.9, H - 0.06, H - 0.02, -0.03, 0.03),
        pick(rnd, [0xff3d8b, 0x2af0ff, 0xb05cff, 0xffe14d]),
        'glow',
      );
      kit.add(sphere(0.07, 0.6, H - 0.3, 0, 8, 6), 0xffe0a8, 'glow');
      kit.add(cyl(0.006, 0.006, 0.25, 4, 0.6, H - 0.25), 0x222222);
    } else {
      kit.add(cyl(0.006, 0.006, 0.5, 4, 0, H - 0.5), 0x222222);
      kit.add(sphere(0.07, 0, H - 0.55, 0, 8, 6), 0xffe8b0, 'glow');
    }
  }
  kit.frame.identity();
  kit.base = 'solid';
}

function floor(base: Kit, l: Layout, rnd: Rng) {
  const down = l.stairs?.down ?? null;
  const kit = holed(
    base,
    down === null ? null : { minX: down.x0, maxX: down.x1, minZ: down.z0, maxZ: down.z1 },
  );
  const P = l.palette;
  const W = l.w;
  const D = l.d;
  const y0 = -0.06;
  switch (l.floorStyle) {
    case 'planks': {
      const pw = 0.22;
      for (let x = -W / 2; x < W / 2 - 1e-3; x += pw) {
        let z = -rnd() * 1.6;
        while (z < D) {
          const len = 1.2 + rnd() * 1.4;
          const c = shade(rnd() < 0.5 ? P.floor : P.floor2, (rnd() - 0.5) * 0.12);
          kit.add(
            boxAt(x, Math.min(W / 2, x + pw), y0, 0, Math.max(0, z), Math.min(D, z + len)),
            c,
          );
          z += len;
        }
      }
      kit.add(boxAt(-W / 2, W / 2, y0 - 0.02, y0 + 0.04, 0, D), shade(P.floor2, -0.35));
      break;
    }
    case 'checker':
    case 'tiles': {
      const s = l.floorStyle === 'checker' ? 0.5 : 0.6;
      for (let i = 0; i * s < W - 1e-3; i++)
        for (let j = 0; j * s < D - 1e-3; j++) {
          const x = -W / 2 + i * s;
          const z = j * s;
          const alt = l.floorStyle === 'checker' ? (i + j) % 2 === 0 : rnd() < 0.15;
          const c = alt ? P.floor2 : shade(P.floor, (rnd() - 0.5) * 0.04);
          kit.add(boxAt(x, Math.min(W / 2, x + s), y0, 0, z, Math.min(D, z + s)), c);
        }
      kit.add(boxAt(-W / 2, W / 2, y0 - 0.02, y0 + 0.05, 0, D), shade(P.floor, -0.4));
      break;
    }
    case 'carpet': {
      kit.add(boxAt(-W / 2, W / 2, y0, 0, 0, D), P.floor);
      // A border and a faint pattern
      kit.add(boxAt(-W / 2 + 0.4, W / 2 - 0.4, 0, 0.004, 0.4, D - 0.4), shade(P.floor, 0.08));
      for (let k = 0; k < 18; k++) {
        const x = -W / 2 + 0.6 + rnd() * (W - 1.2);
        const z = 0.6 + rnd() * (D - 1.2);
        kit.add(boxAt(x - 0.12, x + 0.12, 0, 0.006, z - 0.12, z + 0.12), shade(P.floor2, 0.1));
      }
      break;
    }
    default: {
      kit.add(boxAt(-W / 2, W / 2, y0, 0, 0, D), P.floor);
      for (let k = 0; k < 10; k++) {
        const x = -W / 2 + 0.5 + rnd() * (W - 1);
        const z = 0.5 + rnd() * (D - 1);
        const r = 0.3 + rnd() * 0.8;
        kit.add(boxAt(x - r, x + r, 0, 0.003, z - r * 0.6, z + r * 0.6), shade(P.floor, -0.05));
      }
      // Expansion joints
      for (let x = -W / 2 + 2; x < W / 2; x += 2)
        kit.add(boxAt(x - 0.01, x + 0.01, 0, 0.004, 0, D), shade(P.floor, -0.25));
    }
  }
}

// ── Items ────────────────────────────────────────────────────────────────

function clutterTop(
  kit: Kit,
  w: number,
  d: number,
  y: number,
  rnd: Rng,
  n: number,
  kinds: ('cup' | 'book' | 'jar' | 'plantPot' | 'bottle' | 'can' | 'box')[],
) {
  for (let k = 0; k < n; k++) {
    const shape = pick(rnd, kinds);
    const x = (rnd() - 0.5) * (w - 0.25);
    const z = (rnd() - 0.5) * (d - 0.2);
    const col =
      shape === 'plantPot'
        ? pick(rnd, [0x3f8f4a, 0x2f7a3e, 0x5aa04f])
        : shape === 'cup'
          ? pick(rnd, [0xf4f1ea, 0xc23a2b, 0x2c6fb0, 0xf2c94c])
          : pick(rnd, BOOK_COLS);
    if (shape === 'book')
      kit.addSmall('book', x, y + 0.025, z, col, Math.PI / 2 + (rnd() - 0.5) * 0.4, 1);
    else kit.addSmall(shape, x, y, z, col, rnd() * Math.PI * 2);
  }
}

function shelvesOf(
  kit: Kit,
  w: number,
  d: number,
  h: number,
  levels: number,
  col: number,
  rnd: Rng,
  fill: (y: number, rnd: Rng) => void,
) {
  // Sides, back, top, shelves
  kit.add(boxAt(-w / 2, -w / 2 + 0.04, 0, h, -d / 2, d / 2), col);
  kit.add(boxAt(w / 2 - 0.04, w / 2, 0, h, -d / 2, d / 2), col);
  kit.add(boxAt(-w / 2, w / 2, 0, h, -d / 2, -d / 2 + 0.02), shade(col, -0.2));
  for (let i = 0; i <= levels; i++) {
    const y = 0.08 + ((h - 0.12) * i) / levels;
    kit.add(boxAt(-w / 2, w / 2, y - 0.025, y, -d / 2, d / 2), col);
    if (i < levels) fill(y, rnd);
  }
}

export function buildItem(
  kit: Kit,
  it: Item,
  P: Palette,
  rnd: Rng,
  atlas: Pick<ArtAtlas, 'slots' | 'named'>,
  l: Layout,
) {
  const { w, d, h } = it;
  const fabric = pick(rnd, [P.fabric, shade(P.fabric, 0.15), P.accent, shade(P.fabric, -0.15)]);
  switch (it.type) {
    case 'sofa': {
      kit.add(boxAt(-w / 2, w / 2, 0.08, 0.42, -d / 2, d / 2), fabric);
      kit.add(boxAt(-w / 2, w / 2, 0.42, h, -d / 2, -d / 2 + 0.22), fabric);
      kit.add(boxAt(-w / 2, -w / 2 + 0.2, 0.42, 0.66, -d / 2, d / 2), shade(fabric, -0.08));
      kit.add(boxAt(w / 2 - 0.2, w / 2, 0.42, 0.66, -d / 2, d / 2), shade(fabric, -0.08));
      const n = w > 2.1 ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const x0 = -w / 2 + 0.2 + ((w - 0.4) * i) / n;
        const x1 = -w / 2 + 0.2 + ((w - 0.4) * (i + 1)) / n;
        kit.add(
          boxAt(x0 + 0.02, x1 - 0.02, 0.42, 0.5, -d / 2 + 0.22, d / 2 - 0.02),
          shade(fabric, 0.06),
        );
      }
      for (const sx of [-1, 1])
        for (const sz of [-1, 1])
          kit.add(cyl(0.03, 0.025, 0.08, 6, sx * (w / 2 - 0.08), 0, sz * (d / 2 - 0.08)), 0x2b2118);
      // Cushions
      for (let k = 0; k < 2; k++) {
        const x = (k === 0 ? -1 : 1) * (w / 2 - 0.45);
        kit.add(
          boxAt(x - 0.2, x + 0.2, 0.5, 0.86, -d / 2 + 0.2, -d / 2 + 0.34).rotateZ(
            (rnd() - 0.5) * 0.3,
          ),
          pick(rnd, [P.accent, 0xf4f1ea, 0xf2c94c]),
        );
      }
      break;
    }
    case 'armchair': {
      kit.add(boxAt(-w / 2, w / 2, 0.1, 0.44, -d / 2, d / 2), fabric);
      kit.add(boxAt(-w / 2, w / 2, 0.44, h, -d / 2, -d / 2 + 0.2), fabric);
      kit.add(boxAt(-w / 2, -w / 2 + 0.16, 0.44, 0.66, -d / 2, d / 2), shade(fabric, -0.1));
      kit.add(boxAt(w / 2 - 0.16, w / 2, 0.44, 0.66, -d / 2, d / 2), shade(fabric, -0.1));
      kit.add(
        boxAt(-w / 2 + 0.17, w / 2 - 0.17, 0.44, 0.52, -d / 2 + 0.2, d / 2),
        shade(fabric, 0.08),
      );
      for (const sx of [-1, 1])
        for (const sz of [-1, 1])
          kit.add(cyl(0.03, 0.025, 0.1, 6, sx * (w / 2 - 0.08), 0, sz * (d / 2 - 0.08)), 0x2b2118);
      break;
    }
    case 'coffee_table':
    case 'side_table':
    case 'dining_table':
    case 'desk':
    case 'cafe_table':
    case 'booth_table':
    case 'folding_table': {
      const top =
        it.type === 'cafe_table' ? 0x2b2b2b : it.type === 'folding_table' ? 0xe6e6e0 : P.wood;
      if (it.type === 'cafe_table') {
        kit.add(cyl(w / 2, w / 2, 0.04, 14, 0, h - 0.04), shade(P.wood, 0.1));
        kit.add(cyl(0.035, 0.035, h - 0.04, 6), 0x2b2b2b);
        kit.add(cyl(0.22, 0.26, 0.03, 10), 0x2b2b2b);
        clutterTop(kit, 0.4, 0.4, h, rnd, 1 + Math.floor(rnd() * 2), ['cup', 'cup', 'jar']);
      } else {
        kit.add(boxAt(-w / 2, w / 2, h - 0.05, h, -d / 2, d / 2), top);
        for (const sx of [-1, 1])
          for (const sz of [-1, 1])
            kit.add(
              boxAt(-0.03, 0.03, 0, h - 0.05, -0.03, 0.03).translate(
                sx * (w / 2 - 0.07),
                0,
                sz * (d / 2 - 0.07),
              ),
              shade(top, -0.25),
            );
        if (it.type === 'desk') {
          kit.add(
            boxAt(w / 2 - 0.5, w / 2 - 0.05, 0.05, h - 0.05, -d / 2 + 0.05, d / 2 - 0.05),
            shade(top, -0.1),
          );
          // A laptop / till
          kit.add(boxAt(-0.2, 0.2, h, h + 0.02, -0.1, 0.15), 0x9aa0a6);
          kit.add(boxAt(-0.2, 0.2, h, h + 0.26, -0.13, -0.11).rotateX(-0.25), 0x9aa0a6);
          kit.add(
            boxAt(-0.18, 0.18, h + 0.03, h + 0.24, -0.11, -0.1).rotateX(-0.25),
            0x2c6fb0,
            'glow',
          );
          kit.addSmall('plantPot', w / 2 - 0.2, h, 0.1, 0x3f8f4a);
        }
        const n =
          it.type === 'dining_table'
            ? 4
            : it.type === 'coffee_table'
              ? 3
              : it.type === 'folding_table'
                ? 0
                : 2;
        clutterTop(
          kit,
          w,
          d,
          h,
          rnd,
          n,
          it.type === 'coffee_table' ? ['book', 'cup', 'plantPot'] : ['cup', 'jar', 'bottle'],
        );
        if (it.type === 'dining_table') kit.add(cyl(0.16, 0.16, 0.02, 14, 0, h), 0xf4f1ea);
        if (it.type === 'folding_table')
          for (let k = 0; k < 4; k++)
            kit.add(
              box(0.35, 0.06, 0.3, -w / 2 + 0.3 + k * 0.38, h, (rnd() - 0.5) * 0.2),
              pick(rnd, [0xf4f1ea, 0x9fd8ef, 0xf2c94c, 0xe8543f]),
            );
      }
      break;
    }
    case 'chair':
    case 'stool': {
      const seatH = it.type === 'stool' ? 0.74 : 0.46;
      const col = pick(rnd, [P.wood, 0x2b2b2b, P.accent, shade(P.wood, -0.2)]);
      if (it.type === 'stool') {
        kit.add(
          cyl(0.19, 0.19, 0.06, 12, 0, seatH - 0.06),
          pick(rnd, [P.fabric, 0x2b2b2b, P.accent]),
        );
        kit.add(cyl(0.03, 0.04, seatH - 0.06, 6), 0x9aa0a6);
        kit.add(ring(0.15, 0.015, 0.28), 0x9aa0a6);
        kit.add(cyl(0.18, 0.2, 0.025, 10), 0x9aa0a6);
      } else {
        kit.add(boxAt(-w / 2, w / 2, seatH - 0.05, seatH, -d / 2, d / 2), col);
        kit.add(boxAt(-w / 2, w / 2, seatH, h, -d / 2, -d / 2 + 0.05), col);
        for (const sx of [-1, 1])
          for (const sz of [-1, 1])
            kit.add(
              boxAt(-0.022, 0.022, 0, seatH - 0.05, -0.022, 0.022).translate(
                sx * (w / 2 - 0.04),
                0,
                sz * (d / 2 - 0.04),
              ),
              shade(col, -0.2),
            );
      }
      break;
    }
    case 'tv': {
      kit.add(boxAt(-w / 2, w / 2, 0, 0.5, -d / 2, d / 2), shade(P.wood, -0.2));
      kit.add(boxAt(-w / 2 + 0.05, -0.02, 0.06, 0.44, d / 2, d / 2 + 0.01), shade(P.wood, 0.05));
      kit.add(boxAt(0.02, w / 2 - 0.05, 0.06, 0.44, d / 2, d / 2 + 0.01), shade(P.wood, 0.05));
      kit.add(boxAt(-0.08, 0.08, 0.5, 0.58, -0.05, 0.05), 0x222222);
      kit.add(boxAt(-0.62, 0.62, 0.58, 1.3, -0.04, 0.02), 0x111111);
      const uv = atlas.named.get('screen0');
      kit.frame.multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.025));
      if (uv !== undefined) kit.addArt(panel(1.14, 0.64, 0, 0.94, 0), uv, true);
      kit.frame.multiply(new THREE.Matrix4().makeTranslation(0, 0, -0.025));
      kit.addSmall('box', -0.45, 0.5, 0, 0x333333, 0, 0.8);
      kit.addSmall('plantPot', 0.55, 0.5, 0, 0x3f8f4a);
      break;
    }
    case 'rug':
    case 'mat': {
      const c = it.type === 'mat' ? 0x2b2f34 : pick(rnd, [P.accent, P.fabric, 0xc0533a, 0x3f6fb0]);
      kit.add(boxAt(-w / 2, w / 2, 0, 0.012, -d / 2, d / 2), c);
      if (it.type === 'rug') {
        kit.add(
          boxAt(-w / 2 + 0.12, w / 2 - 0.12, 0.012, 0.016, -d / 2 + 0.12, d / 2 - 0.12),
          shade(c, 0.25),
        );
        kit.add(boxAt(-w / 2 + 0.24, w / 2 - 0.24, 0.016, 0.02, -d / 2 + 0.24, d / 2 - 0.24), c);
      }
      break;
    }
    case 'kitchen': {
      const cab = pick(rnd, [0xf4f1ea, 0x5f8f7a, 0x2f4a6a, P.wood]);
      kit.add(boxAt(-w / 2, w / 2, 0.08, 0.88, -d / 2 + 0.02, d / 2), cab);
      kit.add(boxAt(-w / 2, w / 2, 0, 0.08, -d / 2 + 0.05, d / 2 - 0.05), 0x222222);
      kit.add(
        boxAt(-w / 2 - 0.01, w / 2 + 0.01, 0.88, 0.92, -d / 2, d / 2 + 0.02),
        pick(rnd, [0x2b2b2b, 0xe8e2d6, P.wood]),
      );
      // Doors + handles
      const n = Math.round(w / 0.6);
      for (let i = 0; i < n; i++) {
        const x0 = -w / 2 + (w * i) / n + 0.02;
        const x1 = -w / 2 + (w * (i + 1)) / n - 0.02;
        kit.add(boxAt(x0, x1, 0.12, 0.84, d / 2, d / 2 + 0.015), shade(cab, 0.06));
        kit.add(
          boxAt(
            (x0 + x1) / 2 - 0.08,
            (x0 + x1) / 2 + 0.08,
            0.74,
            0.76,
            d / 2 + 0.015,
            d / 2 + 0.035,
          ),
          0x9aa0a6,
        );
      }
      // Sink, hob, kettle, bowl of fruit
      kit.add(boxAt(-w / 2 + 0.3, -w / 2 + 0.85, 0.86, 0.925, -0.18, 0.2), 0xc0c4ca);
      kit.add(cyl(0.012, 0.012, 0.3, 5, -w / 2 + 0.575, 0.92, -0.25), 0xc0c4ca);
      kit.add(boxAt(w / 2 - 0.85, w / 2 - 0.2, 0.92, 0.93, -0.2, 0.2), 0x111111);
      for (const [x, z] of [
        [-0.18, -0.08],
        [0.15, 0.1],
      ] as const)
        kit.add(ring(0.08, 0.012, 0.935).translate(w / 2 - 0.52 + x, 0, z), 0x666666);
      kit.add(cyl(0.07, 0.08, 0.2, 10, 0.1, 0.92, -0.1), pick(rnd, [0xc23a2b, 0xf4f1ea, 0x2b2b2b]));
      kit.add(cyl(0.14, 0.1, 0.06, 10, -0.4, 0.92, 0.05), 0xf4f1ea);
      for (let k = 0; k < 4; k++)
        kit.add(
          sphere(0.04, -0.4 + (rnd() - 0.5) * 0.12, 0.99, 0.05 + (rnd() - 0.5) * 0.1, 6, 5),
          pick(rnd, [0xf2c94c, 0xc23a2b, 0x7fb069, 0xf2994a]),
        );
      clutterTop(kit, w * 0.5, d * 0.6, 0.92, rnd, 3, ['jar', 'bottle', 'cup']);
      break;
    }
    case 'fridge':
    case 'drinks_fridge':
    case 'vending': {
      const body =
        it.type === 'fridge'
          ? pick(rnd, [0xf4f1ea, 0xc0c4ca, 0x9fd8c8])
          : it.type === 'vending'
            ? pick(rnd, [0xc23a2b, 0x2c6fb0])
            : 0x2b2b2b;
      kit.add(boxAt(-w / 2, w / 2, 0, h, -d / 2, d / 2), body);
      if (it.type === 'fridge') {
        kit.add(
          boxAt(-w / 2 + 0.02, w / 2 - 0.02, h * 0.62, h * 0.63, d / 2, d / 2 + 0.01),
          shade(body, -0.25),
        );
        kit.add(
          boxAt(w / 2 - 0.12, w / 2 - 0.09, h * 0.3, h * 0.55, d / 2, d / 2 + 0.05),
          0x9aa0a6,
        );
        kit.add(
          boxAt(w / 2 - 0.12, w / 2 - 0.09, h * 0.68, h * 0.8, d / 2, d / 2 + 0.05),
          0x9aa0a6,
        );
        for (let k = 0; k < 4; k++)
          kit.add(
            boxAt(-0.08, 0.08, 0, 0.1, 0, 0.01).translate(
              (rnd() - 0.5) * 0.4,
              h * (0.7 + rnd() * 0.2),
              d / 2 + 0.005,
            ),
            pick(rnd, [0xf3322c, 0xffd400, 0x2c6fb0, 0x2fbf71]),
          );
      } else {
        // Lit glass front, stocked
        kit.add(
          boxAt(
            -w / 2 + 0.06,
            w / 2 - (it.type === 'vending' ? 0.25 : 0.06),
            0.15,
            h - 0.15,
            d / 2 - 0.02,
            d / 2,
          ),
          0xdff4ff,
          'glow',
        );
        const rows = it.type === 'vending' ? 5 : 4;
        for (let r = 0; r < rows; r++)
          for (let c = 0; c < 4; c++) {
            const x = -w / 2 + 0.15 + c * ((w - (it.type === 'vending' ? 0.45 : 0.3)) / 3.5);
            kit.addSmall(
              it.type === 'vending' ? 'box' : pick(rnd, ['bottle', 'can'] as const),
              x,
              0.2 + (r * (h - 0.4)) / rows,
              d / 2 - 0.08,
              pick(rnd, [0xf3322c, 0x2fbf71, 0xffd400, 0x2c6fb0, 0xff7ab6]),
              0,
              0.6,
            );
          }
        if (it.type === 'vending')
          kit.add(
            boxAt(w / 2 - 0.22, w / 2 - 0.06, h * 0.45, h * 0.65, d / 2, d / 2 + 0.02),
            0x111111,
          );
        kit.add(
          boxAt(-w / 2, w / 2, h - 0.15, h, d / 2, d / 2 + 0.01),
          pick(rnd, [P.accent, 0xf3322c]),
          'glow',
        );
      }
      break;
    }
    case 'stove':
      kit.add(boxAt(-w / 2, w / 2, 0, h, -d / 2, d / 2), 0xc0c4ca);
      break;
    case 'bed': {
      const frame = pick(rnd, [P.wood, shade(P.wood, -0.3), 0xf4f1ea]);
      kit.add(boxAt(-w / 2, w / 2, 0.1, 0.32, -d / 2, d / 2), frame);
      kit.add(boxAt(-w / 2, w / 2, 0, 1.0, -d / 2, -d / 2 + 0.08), frame);
      kit.add(boxAt(-w / 2 + 0.04, w / 2 - 0.04, 0.32, 0.5, -d / 2 + 0.08, d / 2 - 0.04), 0xf4f1ea);
      const duvet = pick(rnd, [P.fabric, P.accent, 0x5a8f6a, 0xf2c94c]);
      kit.add(boxAt(-w / 2 + 0.02, w / 2 - 0.02, 0.48, 0.58, -d / 2 + 0.6, d / 2 - 0.02), duvet);
      kit.add(
        boxAt(-w / 2 + 0.02, w / 2 - 0.02, 0.48, 0.6, -d / 2 + 0.55, -d / 2 + 0.75),
        shade(duvet, 0.3),
      );
      for (const x of [-w / 4, w / 4])
        kit.add(boxAt(x - 0.3, x + 0.3, 0.5, 0.66, -d / 2 + 0.12, -d / 2 + 0.45), 0xffffff);
      break;
    }
    case 'nightstand': {
      kit.add(boxAt(-w / 2, w / 2, 0, h, -d / 2, d / 2), P.wood);
      kit.add(
        boxAt(-w / 2 + 0.03, w / 2 - 0.03, h * 0.5, h - 0.05, d / 2, d / 2 + 0.01),
        shade(P.wood, 0.1),
      );
      // Lamp
      kit.add(cyl(0.06, 0.08, 0.2, 8, 0, h), pick(rnd, [0xf4f1ea, P.accent]));
      kit.add(cyl(0.09, 0.14, 0.16, 10, 0, h + 0.2), 0xffe6b0, 'glow');
      break;
    }
    case 'bookshelf':
      shelvesOf(kit, w, d, h, 5, P.wood, rnd, (y, r) => {
        let x = -w / 2 + 0.07;
        while (x < w / 2 - 0.1) {
          if (r() < 0.12) {
            kit.addSmall('plantPot', x + 0.1, y, 0, 0x3f8f4a);
            x += 0.24;
            continue;
          }
          const s = 0.8 + r() * 0.4;
          kit.addSmall('book', x + 0.03, y, (r() - 0.5) * 0.04, pick(r, BOOK_COLS), 0, s);
          x += 0.055 * s;
        }
      });
      break;
    case 'record_shelf':
      shelvesOf(kit, w, d, h, 4, shade(P.wood, -0.2), rnd, (y, r) => {
        for (let x = -w / 2 + 0.06; x < w / 2 - 0.05; x += 0.022)
          kit.addSmall(
            'record',
            x,
            y + 0.155,
            0,
            pick(r, [0x111111, 0x111111, 0xc23a2b, 0x2c6fb0, 0xf2c94c, 0xf4f1ea]),
            Math.PI / 2,
            0.95,
          );
      });
      break;
    case 'shelf':
    case 'back_shelf': {
      const goods = GOOD_IDS;
      shelvesOf(
        kit,
        w,
        d,
        h,
        it.type === 'back_shelf' ? 4 : 5,
        it.type === 'back_shelf' ? shade(P.wood, -0.1) : 0xe6e6e0,
        rnd,
        (y, r) => {
          if (l.kind === 'bar' && it.type === 'back_shelf') {
            for (let x = -w / 2 + 0.08; x < w / 2 - 0.06; x += 0.1)
              kit.addSmall(
                'bottle',
                x,
                y,
                0,
                pick(r, [0x2f8a5f, 0x8a5a2b, 0xf4f1ea, 0xc23a2b, 0x7fb3d5]),
              );
            return;
          }
          if (l.kind === 'cafe' && it.type === 'back_shelf') {
            for (let x = -w / 2 + 0.1; x < w / 2 - 0.1; x += 0.14)
              kit.addSmall(
                r() < 0.5 ? 'jar' : 'cup',
                x,
                y,
                0,
                pick(r, [0xf4f1ea, 0x6b3a22, 0xc98a4b]),
              );
            return;
          }
          const g = pick(r, goods);
          const col = GOOD_COLORS[g] ?? 0xcccccc;
          for (let x = -w / 2 + 0.1; x < w / 2 - 0.08; x += 0.18)
            kit.addSmall(
              g === 'WATER'
                ? 'bottle'
                : g === 'FRIES' || g === 'PIZZA'
                  ? 'box'
                  : g === 'NOGGLES'
                    ? 'box'
                    : 'can',
              x,
              y,
              0,
              shade(col, (r() - 0.5) * 0.15),
              0,
              g === 'NOGGLES' ? 0.6 : 1,
            );
          // Price tags
          kit.add(
            boxAt(-0.05, 0.05, y - 0.02, y + 0.02, d / 2, d / 2 + 0.01).translate(
              (r() - 0.5) * (w - 0.3),
              0,
              0,
            ),
            0xffd400,
          );
        },
      );
      break;
    }
    case 'gondola': {
      kit.add(boxAt(-w / 2, w / 2, 0, 0.1, -d / 2, d / 2), 0x9aa0a6);
      kit.add(boxAt(-w / 2, w / 2, 0.1, h, -0.03, 0.03), 0xe6e6e0);
      for (const side of [-1, 1])
        for (let lvl = 0; lvl < 3; lvl++) {
          const y = 0.15 + lvl * 0.45;
          kit.add(
            boxAt(-w / 2, w / 2, y - 0.02, y, side > 0 ? 0.03 : -d / 2, side > 0 ? d / 2 : -0.03),
            0xd6d6d0,
          );
          const g = pick(rnd, GOOD_IDS);
          for (let x = -w / 2 + 0.12; x < w / 2 - 0.1; x += 0.2)
            kit.addSmall(
              g === 'WATER' ? 'bottle' : 'box',
              x,
              y,
              side * d * 0.25,
              GOOD_COLORS[g] ?? 0xcccccc,
              0,
              0.8,
            );
        }
      kit.add(boxAt(-w / 2, w / 2, h - 0.25, h, -0.05, 0.05), P.accent);
      break;
    }
    case 'counter': {
      const front = pick(rnd, [P.wall2, P.accent, P.wood, 0x2b2b2b]);
      kit.add(boxAt(-w / 2, w / 2, 0, h - 0.05, -d / 2 + 0.05, d / 2), front);
      kit.add(
        boxAt(-w / 2 - 0.03, w / 2 + 0.03, h - 0.05, h, -d / 2, d / 2 + 0.04),
        pick(rnd, [0x2b2b2b, 0xe8e2d6, shade(P.wood, 0.1)]),
      );
      // Panels on the customer side
      for (let x = -w / 2 + 0.3; x < w / 2 - 0.2; x += 0.5)
        kit.add(boxAt(x, x + 0.4, 0.15, h - 0.2, d / 2, d / 2 + 0.015), shade(front, 0.1));
      kit.add(boxAt(-w / 2, w / 2, 0, 0.1, d / 2, d / 2 + 0.06), 0x9aa0a6);
      // Till, and the trade of the place on top
      kit.add(boxAt(-0.25, 0.1, h, h + 0.12, -0.15, 0.15), 0x2b2b2b);
      kit.add(boxAt(-0.22, 0.07, h + 0.12, h + 0.3, -0.12, -0.08).rotateX(-0.3), 0x2fbf71, 'glow');
      if (l.kind === 'cafe') {
        kit.add(boxAt(0.4, 0.85, h, h + 0.45, -0.2, 0.15), 0xc0c4ca);
        kit.add(boxAt(0.45, 0.8, h + 0.3, h + 0.33, 0.15, 0.2), 0x2b2b2b);
        clutterTop(kit, w * 0.4, 0.3, h, rnd, 4, ['cup', 'cup', 'jar']);
      } else if (l.kind === 'bar') {
        for (let k = 0; k < 3; k++)
          kit.add(cyl(0.015, 0.015, 0.35, 5, 0.6 + k * 0.12, h, -0.2), 0xc9a14a);
        clutterTop(kit, w * 0.7, 0.3, h, rnd, 5, ['bottle', 'cup']);
      } else clutterTop(kit, w * 0.5, 0.3, h, rnd, 3, ['jar', 'box', 'plantPot']);
      break;
    }
    case 'pastry_case': {
      kit.add(boxAt(-w / 2, w / 2, 0, 0.8, -d / 2, d / 2), shade(P.wood, -0.1));
      kit.add(boxAt(-w / 2, w / 2, 0.8, h, -d / 2, d / 2), 0xdff4ff, 'glass');
      kit.add(boxAt(-w / 2, w / 2, 0.8, 0.82, -d / 2, d / 2), 0xf4f1ea);
      for (let k = 0; k < 8; k++)
        kit.add(
          sphere(0.06, (rnd() - 0.5) * (w - 0.2), 0.88, (rnd() - 0.5) * (d - 0.2), 7, 5).scale(
            1,
            0.6,
            1,
          ),
          pick(rnd, [0xe8b04a, 0xe86fa6, 0xc98a4b, 0xf4e1c1]),
        );
      break;
    }
    case 'booth_bench': {
      const c = pick(rnd, [P.fabric, 0x8a2433, 0x1f6f6a]);
      kit.add(boxAt(-w / 2, w / 2, 0, 0.44, -d / 2 + 0.1, d / 2), shade(c, -0.3));
      kit.add(boxAt(-w / 2, w / 2, 0.44, 0.52, -d / 2 + 0.12, d / 2), c);
      kit.add(boxAt(-w / 2, w / 2, 0.3, h, -d / 2, -d / 2 + 0.18), c);
      break;
    }
    case 'pool_table': {
      kit.add(boxAt(-w / 2, w / 2, 0.68, 0.8, -d / 2, d / 2), shade(P.wood, -0.2));
      kit.add(boxAt(-w / 2 + 0.1, w / 2 - 0.1, 0.8, 0.82, -d / 2 + 0.1, d / 2 - 0.1), 0x1f6f3a);
      for (const [x0, x1, z0, z1] of [
        [-w / 2, w / 2, -d / 2, -d / 2 + 0.1],
        [-w / 2, w / 2, d / 2 - 0.1, d / 2],
        [-w / 2, -w / 2 + 0.1, -d / 2, d / 2],
        [w / 2 - 0.1, w / 2, -d / 2, d / 2],
      ] as const)
        kit.add(boxAt(x0, x1, 0.8, h, z0, z1), shade(P.wood, -0.3));
      for (const sx of [-1, 1])
        for (const sz of [-1, 1])
          kit.add(
            boxAt(-0.08, 0.08, 0, 0.68, -0.08, 0.08).translate(
              sx * (w / 2 - 0.2),
              0,
              sz * (d / 2 - 0.2),
            ),
            shade(P.wood, -0.35),
          );
      for (let k = 0; k < 7; k++)
        kit.add(
          sphere(0.03, (rnd() - 0.5) * (w - 0.4), 0.85, (rnd() - 0.5) * (d - 0.4), 6, 5),
          pick(rnd, [0xffffff, 0xf2c94c, 0xc23a2b, 0x2c6fb0, 0x111111]),
        );
      kit.add(
        cyl(0.008, 0.012, 1.4, 5)
          .rotateZ(Math.PI / 2 - 0.05)
          .translate(0.2, 0.86, 0.3),
        0xc9a14a,
      );
      break;
    }
    case 'jukebox': {
      kit.add(boxAt(-w / 2, w / 2, 0, h - 0.3, -d / 2, d / 2), 0x6b2f3a);
      kit.add(
        cyl(w / 2, w / 2, d, 14)
          .rotateX(Math.PI / 2)
          .translate(0, h - 0.3, 0),
        0x6b2f3a,
      );
      kit.add(
        boxAt(-w / 2 + 0.08, w / 2 - 0.08, 0.6, h - 0.35, d / 2, d / 2 + 0.01),
        0xffb347,
        'glow',
      );
      kit.add(boxAt(-w / 2 + 0.15, w / 2 - 0.15, 0.25, 0.5, d / 2, d / 2 + 0.02), 0x2af0ff, 'glow');
      break;
    }
    case 'decks': {
      kit.add(boxAt(-w / 2, w / 2, 0, 0.82, -d / 2, d / 2), 0x1f1f1f);
      kit.add(boxAt(-w / 2, w / 2, 0.82, 0.86, -d / 2, d / 2), shade(P.wood, -0.1));
      for (const x of [-0.6, 0.6]) {
        kit.add(boxAt(x - 0.25, x + 0.25, 0.86, 0.9, -0.2, 0.2), 0x2b2b2b);
        kit.add(cyl(0.16, 0.16, 0.012, 16, x, 0.9, 0), 0x111111);
        kit.add(cyl(0.05, 0.05, 0.014, 10, x, 0.9, 0), pick(rnd, [0xc23a2b, 0xf2c94c, 0x2c6fb0]));
      }
      kit.add(boxAt(-0.15, 0.15, 0.86, 0.92, -0.18, 0.18), 0x3a3a3a);
      for (let k = 0; k < 6; k++)
        kit.add(
          box(0.025, 0.012, 0.025, -0.1 + (k % 3) * 0.1, 0.92, -0.08 + Math.floor(k / 3) * 0.12),
          pick(rnd, [0x2af0ff, 0xff3d8b, 0x9dff4a]),
          'glow',
        );
      // Laptop
      kit.add(boxAt(0.25, 0.5, 0.86, 0.88, 0.05, 0.25), 0x9aa0a6);
      kit.add(boxAt(0.27, 0.48, 0.88, 1.05, 0.05, 0.06).rotateX(-0.2), 0xff3d8b, 'glow');
      break;
    }
    case 'speaker': {
      kit.add(boxAt(-w / 2, w / 2, 0, h, -d / 2, d / 2), 0x1a1a1a);
      kit.add(
        cyl(0.18, 0.18, 0.02, 14)
          .rotateX(Math.PI / 2)
          .translate(0, h * 0.35, d / 2),
        0x333333,
      );
      kit.add(
        cyl(0.08, 0.08, 0.025, 12)
          .rotateX(Math.PI / 2)
          .translate(0, h * 0.35, d / 2 + 0.005),
        0x555555,
      );
      kit.add(
        cyl(0.07, 0.07, 0.02, 12)
          .rotateX(Math.PI / 2)
          .translate(0, h * 0.78, d / 2),
        0x333333,
      );
      kit.add(box(0.04, 0.02, 0.01, 0, h * 0.95, d / 2 + 0.005), 0x2fbf71, 'glow');
      break;
    }
    case 'record_crate': {
      kit.add(boxAt(-w / 2, w / 2, 0, h, -d / 2, d / 2), pick(rnd, [0xd9a23f, 0x8a5a2b, 0x2c6fb0]));
      for (let x = -w / 2 + 0.06; x < w / 2 - 0.05; x += 0.03)
        kit.addSmall(
          'record',
          x,
          h - 0.2,
          0,
          pick(rnd, [0x111111, 0xc23a2b, 0xf2c94c, 0x2c6fb0, 0xf4f1ea, 0x2fbf71]),
          Math.PI / 2 + (rnd() - 0.5) * 0.2,
          1,
        );
      break;
    }
    case 'mic': {
      kit.add(cyl(0.16, 0.18, 0.03, 10), 0x222222);
      kit.add(cyl(0.012, 0.012, 1.4, 5, 0, 0.03), 0x9aa0a6);
      kit.add(sphere(0.045, 0, 1.5, 0.05, 8, 6), 0x555555);
      break;
    }
    case 'plinth': {
      kit.add(boxAt(-w / 2, w / 2, 0, h, -d / 2, d / 2), 0xf7f7f4);
      // A sculpture: noggles, a big head, or a stack of squares
      const s = rnd();
      if (s < 0.4) {
        const c = pick(rnd, [0xf3322c, 0x111111, 0x2c6fb0, 0xffd400]);
        for (const x of [-0.13, 0.13]) {
          kit.add(boxAt(x - 0.11, x + 0.11, h + 0.1, h + 0.32, -0.04, 0.04), c);
          kit.add(boxAt(x - 0.07, x + 0.07, h + 0.14, h + 0.28, 0.04, 0.05), 0xffffff);
        }
        kit.add(boxAt(-0.04, 0.04, h + 0.2, h + 0.24, -0.03, 0.03), c);
        kit.add(boxAt(-0.02, 0.02, h, h + 0.12, -0.02, 0.02), 0x111111);
      } else if (s < 0.7) {
        kit.add(box(0.36, 0.32, 0.3, 0, h), pick(rnd, [0xd9a23f, 0x9fd8ef, 0xe86fa6, 0x7fb069]));
        kit.add(boxAt(-0.17, 0.17, h + 0.14, h + 0.22, 0.15, 0.17), 0xf3322c);
      } else {
        let y = h;
        for (let k = 0; k < 4; k++) {
          const q = 0.32 - k * 0.06;
          kit.add(
            box(q, q * 0.8, q, (rnd() - 0.5) * 0.05, y).rotateY(rnd()),
            pick(rnd, [0xf3322c, 0x111111, 0xffd400, 0x2c6fb0, 0xf4f1ea]),
          );
          y += q * 0.8;
        }
      }
      // A label: in the Prop Museum, the prop it stands for
      const k = l.items.filter(q => q.type === 'plinth').indexOf(it);
      const card = l.theme === 'prop-museum' ? atlas.named.get(`plinth${k}`) : undefined;
      if (card !== undefined) {
        const cw = Math.min(w - 0.06, 0.42);
        kit.add(
          boxAt(-cw / 2 - 0.015, cw / 2 + 0.015, h * 0.5, h * 0.5 + cw * 0.67, d / 2, d / 2 + 0.01),
          0x111111,
        );
        kit.addArt(panel(cw, cw * 0.64, 0, h * 0.5 + cw * 0.335, d / 2 + 0.014), card);
      } else kit.add(boxAt(-0.08, 0.08, h * 0.7, h * 0.78, d / 2, d / 2 + 0.005), 0x2b2b2b);
      break;
    }
    case 'stairs': {
      const st = l.stairs?.up;
      if (st != null) buildFlight(kit, st, 0, P, l);
      break;
    }
    case 'stairwell': {
      const st = l.stairs?.down;
      if (st == null) break;
      // The flight from below, seen down the hole (its collision is the lower floor's)
      buildFlight(kit, st, -st.rise, P, l, false);
      // Rails round the hole, open at the head of the flight
      const inner = st.side === 'e' ? -w / 2 : w / 2;
      const rail = shade(P.trim, -0.35);
      kit.add(boxAt(inner - 0.03, inner + 0.03, 0, 1.0, -d / 2, d / 2), rail);
      kit.add(boxAt(-w / 2, w / 2, 0.95, 1.0, -d / 2, -d / 2 + 0.06), rail);
      for (let z = -d / 2; z <= d / 2 + 1e-6; z += d / Math.max(1, Math.round(d / 0.6)))
        kit.add(boxAt(inner - 0.02, inner + 0.02, 0, 0.97, z - 0.02, z + 0.02), rail);
      // (no walking into the hole: rail collision along the open side and the far end)
      const sx = st.side === 'e' ? st.x0 : st.x1;
      kit.col.push(
        new THREE.Box3(
          new THREE.Vector3(sx - 0.05, 0, st.z0),
          new THREE.Vector3(sx + 0.05, 1.1, st.z1),
        ),
        new THREE.Box3(
          new THREE.Vector3(st.x0, 0, st.z0 - 0.05),
          new THREE.Vector3(st.x1, 1.1, st.z0 + 0.05),
        ),
      );
      break;
    }
    case 'landing':
      break;
    case 'roof_ladder': {
      // A ladder to a hatch in the ceiling
      const top = l.h;
      for (const x of [-0.25, 0.25])
        kit.add(boxAt(x - 0.03, x + 0.03, 0, top, -0.05, 0.01), 0x6b6b6b);
      for (let y = 0.3; y < top - 0.1; y += 0.3)
        kit.add(
          cyl(0.015, 0.015, 0.5, 5)
            .rotateZ(Math.PI / 2)
            .translate(0, y, -0.02),
          0x8a8a8a,
        );
      kit.add(boxAt(-0.45, 0.45, top - 0.06, top, -0.3, 0.3), 0x3a3a3a);
      kit.add(boxAt(-0.4, 0.4, top - 0.07, top - 0.05, -0.25, 0.25), 0xffd400);
      // ROOF sign
      kit.add(boxAt(-0.22, 0.22, 2.0, 2.16, 0.02, 0.05), 0x2fbf71, 'glow');
      break;
    }
    case 'esports_rug': {
      // Off-white pile with its art on top, a hair off the floor
      kit.add(boxAt(-w / 2, w / 2, 0, 0.012, -d / 2, d / 2), 0xece6d8);
      const art = atlas.named.get('esports');
      if (art !== undefined)
        kit.addArt(
          // Lying face up, the words reading from the door (top of the art away from it)
          new THREE.PlaneGeometry(w - 0.04, d - 0.04)
            .rotateX(-Math.PI / 2)
            .rotateY(Math.PI)
            .translate(0, 0.016, 0),
          art,
        );
      break;
    }
    case 'bench': {
      const c = pick(rnd, [P.wood, 0x2b2b2b, shade(P.wood, 0.15)]);
      kit.add(boxAt(-w / 2, w / 2, h - 0.06, h, -d / 2, d / 2), c);
      for (const x of [-w / 2 + 0.12, w / 2 - 0.12])
        kit.add(boxAt(x - 0.04, x + 0.04, 0, h - 0.06, -d / 2 + 0.04, d / 2 - 0.04), 0x2b2b2b);
      break;
    }
    case 'cabinet': {
      const c = pick(rnd, [0x3b1f6b, 0x1f3b6b, 0x6b1f3b, 0x111111]);
      kit.add(boxAt(-w / 2, w / 2, 0, 1.0, -d / 2, d / 2), c);
      kit.add(boxAt(-w / 2, w / 2, 1.0, h, -d / 2, d / 2 - 0.3), c);
      // Control panel slope, screen, marquee
      kit.add(boxAt(-w / 2, w / 2, 0.95, 1.05, -d / 2, d / 2).rotateX(0.25), shade(c, 0.2));
      for (let k = 0; k < 4; k++)
        kit.add(
          cyl(0.025, 0.025, 0.03, 8, -0.25 + k * 0.12, 1.06, d / 2 - 0.15),
          pick(rnd, [0xf3322c, 0xffd400, 0x2af0ff, 0x9dff4a]),
          'glow',
        );
      kit.add(cyl(0.012, 0.012, 0.08, 5, 0.25, 1.05, d / 2 - 0.15), 0x222222);
      const uv = atlas.named.get(`screen${1 + Math.floor(rnd() * 2)}`);
      kit.frame.multiply(new THREE.Matrix4().makeTranslation(0, 0, d / 2 - 0.29));
      if (uv !== undefined) kit.addArt(panel(w - 0.14, 0.5, 0, 1.4, 0), uv, true);
      kit.frame.multiply(new THREE.Matrix4().makeTranslation(0, 0, -(d / 2 - 0.29)));
      kit.add(
        boxAt(-w / 2, w / 2, h - 0.22, h, d / 2 - 0.32, d / 2 - 0.28),
        pick(rnd, [0xff3d8b, 0x2af0ff, 0xffe14d]),
        'glow',
      );
      break;
    }
    case 'claw': {
      kit.add(boxAt(-w / 2, w / 2, 0, 0.9, -d / 2, d / 2), 0xff3d8b);
      kit.add(boxAt(-w / 2, w / 2, 0.9, h - 0.2, -d / 2, d / 2), 0xdff4ff, 'glass');
      kit.add(boxAt(-w / 2, w / 2, h - 0.2, h, -d / 2, d / 2), 0xffe14d, 'glow');
      for (let k = 0; k < 10; k++)
        kit.add(
          sphere(0.09, (rnd() - 0.5) * (w - 0.3), 1.0, (rnd() - 0.5) * (d - 0.3), 6, 5),
          pick(rnd, [0xf2c94c, 0xe86fa6, 0x7fb3d5, 0x9dff4a]),
        );
      kit.add(cyl(0.01, 0.01, 0.6, 4, 0, h - 0.8), 0x9aa0a6);
      break;
    }
    case 'barber_chair': {
      kit.add(cyl(0.25, 0.3, 0.06, 12), 0x9aa0a6);
      kit.add(cyl(0.06, 0.06, 0.4, 8, 0, 0.06), 0x9aa0a6);
      kit.add(boxAt(-w / 2, w / 2, 0.46, 0.62, -d / 2 + 0.05, d / 2 - 0.1), 0x8a2a2a);
      kit.add(boxAt(-w / 2, w / 2, 0.62, h, -d / 2 + 0.05, -d / 2 + 0.2), 0x8a2a2a);
      kit.add(boxAt(-0.15, 0.15, h, h + 0.15, -d / 2 + 0.05, -d / 2 + 0.15), 0x2b2b2b);
      for (const x of [-w / 2, w / 2 - 0.08])
        kit.add(boxAt(x, x + 0.08, 0.62, 0.74, -d / 2 + 0.1, d / 2 - 0.1), 0xc0c4ca);
      kit.add(boxAt(-0.2, 0.2, 0.2, 0.24, d / 2 - 0.15, d / 2), 0xc0c4ca);
      break;
    }
    case 'washer':
    case 'dryer': {
      const stack = it.type === 'dryer' ? 2 : 1;
      for (let s = 0; s < stack; s++) {
        const y = s * 0.95;
        kit.add(boxAt(-w / 2, w / 2, y, y + 0.93, -d / 2, d / 2), 0xf7f7f4);
        kit.add(
          cyl(0.22, 0.22, 0.03, 16)
            .rotateX(Math.PI / 2)
            .translate(0, y + 0.45, d / 2),
          0xc0c4ca,
        );
        kit.add(
          cyl(0.17, 0.17, 0.035, 16)
            .rotateX(Math.PI / 2)
            .translate(0, y + 0.45, d / 2 + 0.002),
          pick(rnd, [0x9fd8ef, 0x5fb3c9, 0xdff4ff]),
          rnd() < 0.5 ? 'glow' : 'solid',
        );
        kit.add(
          boxAt(-w / 2 + 0.05, w / 2 - 0.05, y + 0.8, y + 0.9, d / 2, d / 2 + 0.01),
          0x2b2b2b,
        );
        kit.add(box(0.04, 0.03, 0.01, w / 2 - 0.1, y + 0.83, d / 2 + 0.01), 0x2fbf71, 'glow');
      }
      if (rnd() < 0.5)
        kit.add(
          box(0.4, 0.25, 0.3, (rnd() - 0.5) * 0.2, stack * 0.95),
          pick(rnd, [0xf2c94c, 0xf4f1ea, 0xe8543f]),
        );
      break;
    }
    case 'treadmill': {
      kit.add(boxAt(-w / 2, w / 2, 0, 0.18, -d / 2, d / 2), 0x2b2b2b);
      kit.add(boxAt(-w / 2 + 0.08, w / 2 - 0.08, 0.18, 0.2, -d / 2 + 0.1, d / 2 - 0.3), 0x111111);
      for (const x of [-w / 2 + 0.05, w / 2 - 0.05])
        kit.add(
          boxAt(x - 0.03, x + 0.03, 0.18, 1.25, d / 2 - 0.2, d / 2 - 0.14).rotateX(-0.15),
          0x9aa0a6,
        );
      kit.add(boxAt(-w / 2, w / 2, 1.15, 1.3, d / 2 - 0.35, d / 2 - 0.1), 0x2b2b2b);
      kit.add(boxAt(-0.2, 0.2, 1.22, 1.3, d / 2 - 0.36, d / 2 - 0.34), 0xf2c94c, 'glow');
      break;
    }
    case 'weight_bench': {
      kit.add(boxAt(-w / 2, w / 2, 0.38, h, -d / 2, d / 2), 0xc23a2b);
      kit.add(boxAt(-0.05, 0.05, 0, 0.38, -d / 2 + 0.1, d / 2 - 0.1), 0x2b2b2b);
      for (const z of [-d / 2 + 0.1, d / 2 - 0.1])
        kit.add(boxAt(-0.22, 0.22, 0, 0.05, z - 0.04, z + 0.04), 0x2b2b2b);
      // Rack + bar with plates
      for (const x of [-0.55, 0.55])
        kit.add(boxAt(x - 0.04, x + 0.04, 0, 1.25, -d / 2 - 0.05, -d / 2 + 0.05), 0x9aa0a6);
      kit.add(
        cyl(0.015, 0.015, 1.6, 6)
          .rotateZ(Math.PI / 2)
          .translate(0, 1.1, -d / 2),
        0xc0c4ca,
      );
      for (const x of [-0.7, 0.7])
        kit.add(
          cyl(0.2, 0.2, 0.05, 14)
            .rotateZ(Math.PI / 2)
            .translate(x, 1.1, -d / 2),
          0x222222,
        );
      break;
    }
    case 'dumbbell_rack': {
      kit.add(boxAt(-w / 2, w / 2, 0.4, 0.45, -d / 2, d / 2).rotateX(0.15), 0x2b2b2b);
      for (const x of [-w / 2 + 0.05, w / 2 - 0.05])
        kit.add(boxAt(x - 0.03, x + 0.03, 0, 0.75, -0.05, 0.05), 0x2b2b2b);
      for (let k = 0; k < 6; k++) {
        const x = -w / 2 + 0.2 + k * ((w - 0.4) / 5);
        kit.add(
          cyl(0.06, 0.06, 0.28, 8)
            .rotateZ(Math.PI / 2)
            .translate(x, 0.52, 0),
          pick(rnd, [0x222222, 0xc23a2b, 0x2c6fb0]),
        );
      }
      break;
    }
    case 'water_cooler': {
      kit.add(boxAt(-w / 2, w / 2, 0, 0.95, -d / 2, d / 2), 0xf4f1ea);
      kit.add(cyl(0.15, 0.15, 0.32, 12, 0, 0.95), 0x9fd8ef, 'glass');
      kit.add(box(0.06, 0.06, 0.04, -0.06, 0.6, d / 2), 0x2c6fb0);
      kit.add(box(0.06, 0.06, 0.04, 0.06, 0.6, d / 2), 0xc23a2b);
      break;
    }
    case 'plant': {
      const pot = pick(rnd, [0xc0533a, 0xf4f1ea, 0x2b2b2b, 0xd9a23f]);
      kit.add(cyl(w * 0.32, w * 0.24, 0.42, 10), pot);
      const leaf = pick(rnd, [0x3f8f4a, 0x2f7a3e, 0x5aa04f, 0x4f8f3e]);
      if (rnd() < 0.5) {
        // Leafy: a cluster of blobs
        for (let k = 0; k < 6; k++)
          kit.add(
            sphere(
              0.16 + rnd() * 0.08,
              (rnd() - 0.5) * 0.3,
              0.55 + rnd() * (h - 0.75),
              (rnd() - 0.5) * 0.3,
              7,
              5,
            ).scale(1, 1.3, 1),
            shade(leaf, (rnd() - 0.5) * 0.2),
          );
      } else {
        // Snake plant: tall blades
        for (let k = 0; k < 7; k++) {
          const a = (k / 7) * Math.PI * 2;
          kit.add(
            boxAt(-0.03, 0.03, 0.4, 0.4 + (h - 0.45) * (0.6 + rnd() * 0.4), -0.01, 0.01)
              .rotateZ((rnd() - 0.5) * 0.3)
              .translate(Math.cos(a) * 0.08, 0, Math.sin(a) * 0.08),
            shade(leaf, (rnd() - 0.5) * 0.25),
          );
        }
      }
      break;
    }
    case 'floor_lamp': {
      kit.add(cyl(0.15, 0.17, 0.03, 10), 0x2b2b2b);
      kit.add(cyl(0.015, 0.015, h - 0.35, 5, 0, 0.03), 0x2b2b2b);
      kit.add(cyl(0.12, 0.2, 0.32, 12, 0, h - 0.34), 0xffe2a8, 'glow');
      break;
    }
    case 'bag': {
      // A heavy bag on a chain from the ceiling
      kit.add(cyl(0.005, 0.005, l.h - 1.9, 4, 0, 1.9), 0x9aa0a6);
      kit.add(cyl(0.24, 0.24, 1.1, 12, 0, 0.75), pick(rnd, [0xc23a2b, 0x2b2b2b, 0x2c6fb0]));
      kit.add(cyl(0.25, 0.25, 0.08, 12, 0, 1.25), 0x2b2b2b);
      kit.add(cyl(0.25, 0.25, 0.08, 12, 0, 0.75), 0x2b2b2b);
      kit.add(cyl(0.1, 0.24, 0.12, 12, 0, 1.85), 0x2b2b2b);
      break;
    }
    case 'wardrobe': {
      const c = pick(rnd, [P.wood, 0xf4f1ea, shade(P.wood, -0.25)]);
      kit.add(boxAt(-w / 2, w / 2, 0, h, -d / 2, d / 2), c);
      kit.add(boxAt(-0.005, 0.005, 0.1, h - 0.1, d / 2, d / 2 + 0.01), shade(c, -0.3));
      for (const x of [-0.08, 0.08])
        kit.add(boxAt(x - 0.012, x + 0.012, h * 0.45, h * 0.6, d / 2, d / 2 + 0.04), 0xc9a14a);
      kit.addSmall('box', 0, h, 0, pick(rnd, [0xd9a23f, 0xc98a4b]), rnd(), 1.4);
      break;
    }
    default:
      kit.add(boxAt(-w / 2, w / 2, 0, h, -d / 2, d / 2), P.wood);
  }
}

// ── Wall decor ───────────────────────────────────────────────────────────

/** Frame for a decor on its wall: local +z into the room, x along the wall. */
function decorFrame(kit: Kit, d: Decor, l: Layout) {
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  switch (d.wall) {
    case 'n':
      p.set(d.at, 0, l.d);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
      break;
    case 's':
      p.set(d.at, 0, 0);
      q.identity();
      break;
    case 'e':
      p.set(l.w / 2, 0, d.at);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
      break;
    default:
      p.set(-l.w / 2, 0, d.at);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
  }
  kit.frame.compose(p, q, new THREE.Vector3(1, 1, 1));
}

function buildDecor(
  kit: Kit,
  d: Decor,
  i: number,
  l: Layout,
  atlas: Pick<ArtAtlas, 'slots' | 'named'>,
  rnd: Rng,
) {
  decorFrame(kit, d, l);
  const P = l.palette;
  const uv = atlas.slots.get(i);
  const { w, h, y } = d;
  switch (d.type) {
    case 'window': {
      // Frame, sill, the view, glazing bars; curtains at home
      const fc = l.kind === 'home' || l.kind === 'cafe' ? P.trim : 0x2b2b2b;
      kit.add(boxAt(-w / 2 - 0.08, w / 2 + 0.08, y - h / 2 - 0.08, y - h / 2, 0, 0.07), fc);
      kit.add(boxAt(-w / 2 - 0.12, w / 2 + 0.12, y - h / 2 - 0.1, y - h / 2 - 0.05, 0, 0.16), fc);
      kit.add(boxAt(-w / 2 - 0.08, w / 2 + 0.08, y + h / 2, y + h / 2 + 0.08, 0, 0.07), fc);
      kit.add(boxAt(-w / 2 - 0.08, -w / 2, y - h / 2, y + h / 2, 0, 0.07), fc);
      kit.add(boxAt(w / 2, w / 2 + 0.08, y - h / 2, y + h / 2, 0, 0.07), fc);
      if (uv !== undefined) kit.addArt(panel(w, h, 0, y, 0.012), uv, true);
      kit.add(boxAt(-0.025, 0.025, y - h / 2, y + h / 2, 0.02, 0.05), fc);
      if (w > 1.2) kit.add(boxAt(-w / 2, w / 2, y - 0.02, y + 0.02, 0.02, 0.05), fc);
      if (l.kind === 'home' || l.kind === 'cafe' || l.kind === 'bar') {
        const c = pick(rnd, [P.fabric, P.accent, 0xf4f1ea]);
        for (const s of [-1, 1])
          kit.add(
            boxAt(
              s * (w / 2 + 0.05) - 0.18,
              s * (w / 2 + 0.05) + 0.18,
              y - h / 2 - 0.3,
              y + h / 2 + 0.25,
              0.08,
              0.14,
            ),
            c,
          );
        kit.add(
          cyl(0.015, 0.015, w + 0.8, 5)
            .rotateZ(Math.PI / 2)
            .translate(0, y + h / 2 + 0.28, 0.12),
          0x2b2b2b,
        );
      } else if (l.kind === 'shop' || l.kind === 'barber' || l.kind === 'laundromat') {
        // A little window display
        for (let k = 0; k < 3; k++)
          kit.addSmall(
            pick(rnd, ['box', 'jar', 'plantPot'] as const),
            (k - 1) * (w / 3),
            y - h / 2 - 0.05,
            0.1,
            pick(rnd, [0xf3322c, 0xffd400, 0x2c6fb0, 0x3f8f4a]),
          );
      }
      if (l.kind === 'home' && rnd() < 0.6)
        kit.addSmall('plantPot', w * 0.3, y - h / 2 - 0.05, 0.1, 0x3f8f4a);
      break;
    }
    case 'poster':
      if (uv !== undefined) kit.addArt(panel(w, h, 0, y, 0.02), uv);
      for (const x of [-w / 2 + 0.03, w / 2 - 0.03])
        kit.add(box(0.03, 0.03, 0.01, x, y + h / 2 - 0.05, 0.025), 0x9aa0a6);
      break;
    case 'frame':
    case 'mirror':
    case 'placard':
      kit.add(
        boxAt(-w / 2 - 0.05, w / 2 + 0.05, y - h / 2 - 0.05, y + h / 2 + 0.05, 0, 0.04),
        d.type === 'mirror'
          ? 0xc9a14a
          : d.type === 'placard'
            ? 0x111111
            : pick(rnd, [0x2b2118, 0xc9a14a, 0x111111, 0xf4f1ea]),
      );
      if (uv !== undefined) kit.addArt(panel(w, h, 0, y, 0.045), uv, d.type === 'mirror');
      if (l.kind === 'gallery') {
        // A spotlight over each piece
        kit.add(
          cyl(0.04, 0.06, 0.14, 8)
            .rotateX(0.9)
            .translate(0, y + h / 2 + 0.35, 0.25),
          0x2b2b2b,
        );
        kit.add(sphere(0.035, 0, y + h / 2 + 0.3, 0.3, 6, 5), 0xfff6d8, 'glow');
      }
      break;
    case 'menu':
      kit.add(
        boxAt(-w / 2 - 0.05, w / 2 + 0.05, y - h / 2 - 0.05, y + h / 2 + 0.05, 0, 0.04),
        shade(P.wood, -0.2),
      );
      if (uv !== undefined) kit.addArt(panel(w, h, 0, y, 0.045), uv);
      break;
    case 'neon':
      kit.add(boxAt(-w / 2, w / 2, y - h / 2, y + h / 2, 0, 0.02), 0x0b0b12);
      if (uv !== undefined) kit.addArt(panel(w, h, 0, y, 0.025), uv, true);
      break;
    case 'clock':
      kit.add(
        cyl(w / 2 + 0.03, w / 2 + 0.03, 0.04, 16)
          .rotateX(Math.PI / 2)
          .translate(0, y, 0.02),
        0x2b2b2b,
      );
      // In front of the rim (its face is at z 0.06)
      if (uv !== undefined) kit.addArt(panel(w * 0.9, h * 0.9, 0, y, 0.066), uv);
      break;
    case 'wall_shelf': {
      kit.add(boxAt(-w / 2, w / 2, y - 0.03, y, 0, 0.25), P.wood);
      for (const x of [-w / 2 + 0.1, w / 2 - 0.1])
        kit.add(boxAt(x - 0.02, x + 0.02, y - 0.18, y - 0.03, 0, 0.2), 0x2b2b2b);
      for (let x = -w / 2 + 0.1; x < w / 2 - 0.1; x += 0.16 + rnd() * 0.1) {
        const s = pick(rnd, ['book', 'jar', 'plantPot', 'cup'] as const);
        kit.addSmall(
          s,
          x,
          y,
          0.12,
          s === 'plantPot' ? 0x3f8f4a : pick(rnd, BOOK_COLS),
          s === 'book' ? Math.PI / 2 : 0,
        );
      }
      break;
    }
    case 'upper_cabinets': {
      const c = pick(rnd, [0xf4f1ea, 0x5f8f7a, 0x2f4a6a, P.wood]);
      kit.add(boxAt(-w / 2, w / 2, y - h / 2, y + h / 2, 0, 0.35), c);
      const n = Math.max(2, Math.round(w / 0.6));
      for (let k = 0; k < n; k++) {
        const x0 = -w / 2 + (w * k) / n + 0.02;
        const x1 = -w / 2 + (w * (k + 1)) / n - 0.02;
        kit.add(boxAt(x0, x1, y - h / 2 + 0.03, y + h / 2 - 0.03, 0.35, 0.365), shade(c, 0.06));
        kit.add(
          boxAt(
            (x0 + x1) / 2 - 0.01,
            (x0 + x1) / 2 + 0.01,
            y - h / 2 + 0.06,
            y - h / 2 + 0.2,
            0.365,
            0.385,
          ),
          0x9aa0a6,
        );
      }
      // Under-cabinet light strip
      kit.add(
        boxAt(-w / 2 + 0.05, w / 2 - 0.05, y - h / 2 - 0.02, y - h / 2, 0.25, 0.3),
        0xfff2c4,
        'glow',
      );
      break;
    }
  }
  kit.frame.identity();
}
