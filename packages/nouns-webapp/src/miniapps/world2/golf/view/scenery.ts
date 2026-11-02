// ── Noun Golf view: buildings, flags, signs and course dressing (pure) ───
//
// Everything is procedural boxes / cylinders / quads (kit.ts), merged per
// material:
//   solid   vertex-coloured, the game's toon look (buildings, poles, tee
//           markers, benches, ball washers, yardage posts, rakes, the
//           range's bays / canopy / boards, the entrance arch, the noggles)
//   glass   the clubhouse / pro shop fronts (one transparent material)
//   signs   textured quads on the signs atlas (tee signs, distance boards,
//           building boards, the entrance)
//   flags   the 19 hole flags + the range's (flags atlas), waved on the CPU
// plus the buildings' collider boxes.

import type { Building, CourseLayout, Hole } from '../contract';
import type { GolfCourse } from '../course/surface';

import { polyAt } from '../course/shapes';
import { toWorld, uYaw } from '../course/site';

import { FLAG_GRID, FLAG_PLAIN, SIGN_CELL, SIGN_GRID, buildingCell, cellUv } from './atlas';
import { MeshBuf, type ColliderBox, type MeshData } from './kit';

const WHITE = 0xf7f4ee;
const CREAM = 0xf2ead8;
const STONE = 0xd8cfbd;
const DARK = 0x23262b;
const RED = 0xe8322c;
const GREEN_DK = 0x1f5e35;
const WOOD = 0x8a5a3c;
const WOOD_LT = 0xc08b5c;
const INSIDE = 0x4a3f36;
const LENS_W = 0xffffff;
const LENS_B = 0x111111;

export interface Scenery {
  solid: MeshData;
  glass: MeshData;
  signs: MeshData;
  flags: FlagSet;
  colliders: ColliderBox[];
}

export interface FlagSet {
  data: MeshData;
  /** Per flag: first vertex, and the pole top + direction it flies. */
  flags: { v0: number; x: number; y: number; z: number; yaw: number; phase: number }[];
  /** Columns × rows of vertices per flag. */
  cols: number;
  rows: number;
  /** Flag size (m). */
  w: number;
  h: number;
}

const W = { x: 0, z: 0 };
const AT = { x: 0, z: 0, yaw: 0 };

/** Mini noggles (⌐◨-◨): lens size s, facing local +z, centred on (x, y, z). */
function noggles(b: MeshBuf, x: number, y: number, z: number, s: number, depth: number, frame = RED) {
  const t = s * 0.18;
  const gap = s * 0.3;
  const lx = [x - (s + gap) / 2, x + (s + gap) / 2];
  for (const cx of lx) {
    b.box(cx, y + s / 2 - t / 2, z, s, t, depth, frame);
    b.box(cx, y - s / 2 + t / 2, z, s, t, depth, frame);
    b.box(cx - s / 2 + t / 2, y, z, t, s - 2 * t, depth, frame);
    b.box(cx + s / 2 - t / 2, y, z, t, s - 2 * t, depth, frame);
    const inner = s - 2 * t;
    b.box(cx - inner / 4, y, z, inner / 2, inner, depth * 0.7, LENS_W);
    b.box(cx + inner / 4, y, z, inner / 2, inner, depth * 0.7, LENS_B);
  }
  // Bridge + the arm off the left lens (⌐)
  b.box(x, y + s * 0.12, z, gap + t, t, depth, frame);
  const ax = lx[0] - s / 2 - s * 0.32;
  b.box(ax, y + s * 0.12, z, s * 0.64, t, depth, frame);
  b.box(ax - s * 0.32 + t / 2, y + s * 0.12 - s * 0.22, z, t, s * 0.44, depth, frame);
}

function boardPanel(
  signs: MeshBuf,
  solid: MeshBuf,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  yaw: number,
  cell: number,
  frame = DARK,
) {
  const nx = Math.sin(yaw);
  const nz = Math.cos(yaw);
  solid.box(x - nx * 0.06, y, z - nz * 0.06, w + 0.16, h + 0.16, 0.1, frame, yaw);
  signs.panel(x + nx * 0.005, y, z + nz * 0.005, w, h, yaw, 0xffffff, cellUv(cell, SIGN_GRID));
}

// ── Buildings ───────────────────────────────────────────────────────────

function clubhouse(b: Building, solid: MeshBuf, glass: MeshBuf, signs: MeshBuf, cols: ColliderBox[]) {
  const { hw, hl } = b;
  for (const m of [solid, glass, signs]) m.setFrame(b.x, b.y, b.z, b.yaw);
  // Plinth + steps
  solid.box(0, 0.15, 0.5, 2 * hw + 3, 0.6, 2 * hl + 4, STONE);
  solid.box(0, -0.05, hl + 3.4, 10, 0.3, 1.6, STONE);
  // Ground floor: three walls, a glass front, the room behind it
  const gh = 4.2;
  solid.box(0, 0.45 + gh / 2, -hl + 0.3, 2 * hw, gh, 0.6, CREAM);
  for (const s of [-1, 1]) solid.box(s * (hw - 0.3), 0.45 + gh / 2, 0, 0.6, gh, 2 * hl, CREAM);
  solid.box(0, 0.45 + gh / 2 - 0.1, -0.4, 2 * hw - 1.4, gh - 0.3, 2 * hl - 1.8, INSIDE);
  glass.box(0, 0.45 + gh / 2, hl - 0.25, 2 * hw - 1.2, gh - 0.1, 0.12, 0xffffff);
  for (let x = -hw + 0.6; x <= hw - 0.5; x += 3.1) solid.box(x, 0.45 + gh / 2, hl - 0.15, 0.2, gh, 0.26, DARK);
  // Doors: a dark gap mid-front
  solid.box(0, 0.45 + 1.3, hl - 0.05, 2.6, 2.6, 0.1, DARK);
  // First floor slab, with a canopy over the front terrace
  const sy = 0.45 + gh + 0.25;
  solid.box(0, sy, 1.3, 2 * hw + 1.2, 0.5, 2 * hl + 3.8, WHITE);
  // Upper floor, set back
  const uhw = hw - 4;
  const uhl = hl - 3.5;
  const uz = -2;
  const uh = 3.6;
  const uy = sy + 0.25;
  solid.box(0, uy + uh / 2, uz - uhl + 0.3, 2 * uhw, uh, 0.6, CREAM);
  for (const s of [-1, 1]) solid.box(s * (uhw - 0.3), uy + uh / 2, uz, 0.6, uh, 2 * uhl, CREAM);
  solid.box(0, uy + uh / 2, uz - 0.3, 2 * uhw - 1.4, uh - 0.2, 2 * uhl - 1.4, INSIDE);
  glass.box(0, uy + uh / 2, uz + uhl - 0.25, 2 * uhw - 1.2, uh - 0.1, 0.12, 0xffffff);
  for (let x = -uhw + 0.6; x <= uhw - 0.5; x += 2.6) solid.box(x, uy + uh / 2, uz + uhl - 0.15, 0.18, uh, 0.24, DARK);
  const ry = uy + uh + 0.25;
  solid.box(0, ry, uz, 2 * uhw + 1, 0.5, 2 * uhl + 1, WHITE);
  // Terrace railing round the front of the slab
  const tz = 1.3 + hl + 1.9 - 0.15;
  solid.box(0, sy + 1.25, tz, 2 * hw + 1.1, 0.1, 0.1, DARK);
  for (let x = -hw; x <= hw + 0.1; x += 2) solid.box(x, sy + 0.75, tz, 0.08, 1, 0.08, DARK);
  for (const s of [-1, 1]) solid.box(s * (hw + 0.5), sy + 1.25, 1.3, 0.1, 0.1, 2 * hl + 3.6, DARK);
  // Parasols + tables on the terrace
  for (const x of [-hw + 4, -5, 5, hw - 4]) {
    const z = tz - 3;
    solid.cyl(x, sy + 0.25, z, 0.05, 0.05, 2.5, 6, DARK);
    solid.cyl(x, sy + 2.45, z, 1.8, 0.05, 0.6, 10, x < 0 ? RED : 0xffd23a, false);
    solid.cyl(x, sy + 0.95, z, 0.6, 0.6, 0.06, 10, WHITE);
  }
  // The NOUN LINKS board on the terrace, the noggles on the roof
  boardPanel(signs, solid, 0, sy + 2.2, tz - 0.4, 5.6, 2.8, 0, SIGN_CELL.club, GREEN_DK);
  const ny = ry + 0.25;
  for (const x of [-3.2, 3.2]) solid.box(x, ny + 0.8, uz, 0.3, 1.6, 0.3, DARK);
  noggles(solid, 0.9, ny + 1.6 + 2.2, uz, 4.4, 0.6);
  cols.push(
    { x: b.x, y: b.y, z: b.z, hw: hw + 0.2, hl: hl + 0.2, h: sy + 0.25, yaw: b.yaw },
    frameBox(b, 0, uz, uhw, uhl, sy, ry + 0.25 - sy),
  );
}

/** A collider box offset in a building's frame. */
function frameBox(b: Building, lx: number, lz: number, hw: number, hl: number, y0: number, h: number): ColliderBox {
  const c = Math.cos(b.yaw);
  const s = Math.sin(b.yaw);
  return { x: b.x + lx * c + lz * s, y: b.y + y0, z: b.z - lx * s + lz * c, hw, hl, h, yaw: b.yaw };
}

function simple(
  b: Building,
  solid: MeshBuf,
  glass: MeshBuf,
  signs: MeshBuf,
  cols: ColliderBox[],
  o: { wall: number; trim: number; glassFront: boolean; gable?: number; door?: boolean },
) {
  const { hw, hl, h } = b;
  for (const m of [solid, glass, signs]) m.setFrame(b.x, b.y, b.z, b.yaw);
  solid.box(0, 0.05, 0, 2 * hw + 1.2, 0.3, 2 * hl + 1.2, STONE);
  const wh = o.gable !== undefined ? h - o.gable : h - 0.4;
  if (o.glassFront) {
    solid.box(0, wh / 2, -0.3, 2 * hw, wh, 2 * hl - 0.6, o.wall);
    solid.box(0, wh / 2, hl - 1.2, 2 * hw - 1, wh - 0.4, 0.1, INSIDE);
    glass.box(0, wh / 2, hl - 0.35, 2 * hw - 0.8, wh - 0.3, 0.1, 0xffffff);
    for (const s of [-1, 1]) solid.box(s * (hw - 0.2), wh / 2, hl - 0.4, 0.4, wh, 0.5, o.trim);
  } else {
    solid.box(0, wh / 2, 0, 2 * hw, wh, 2 * hl, o.wall);
    if (o.door) solid.box(0, wh * 0.4, hl + 0.02, hw * 1.1, wh * 0.8, 0.06, o.trim);
    else solid.box(0, wh * 0.55, hl + 0.02, hw * 0.9, wh * 0.4, 0.06, 0x9fd3e8);
  }
  if (o.gable !== undefined) solid.gable(0, wh, 0, 2 * hw + 0.6, 2 * hl + 0.8, o.gable, o.trim, o.wall);
  else {
    solid.box(0, wh + 0.2, 0, 2 * hw + 0.8, 0.4, 2 * hl + 0.8, o.trim);
    // Awning over the front
    solid.box(0, wh - 0.6, hl + 0.9, 2 * hw - 0.4, 0.1, 1.8, GREEN_DK);
  }
  const top = o.gable !== undefined ? wh + o.gable * 0.45 : wh + 1.1;
  const sw = Math.min(2 * hw - 0.6, 4.2);
  const sz = o.gable !== undefined ? hl + 0.42 : hl + 0.35;
  boardPanel(signs, solid, 0, o.gable !== undefined ? wh - 0.6 : top, sz, sw, sw / 2, 0, buildingCell(b.id));
  cols.push({ x: b.x, y: b.y, z: b.z, hw, hl, h, yaw: b.yaw });
}

function bar19(b: Building, solid: MeshBuf, signs: MeshBuf, cols: ColliderBox[]) {
  const { hw, hl, h } = b;
  for (const m of [solid, signs]) m.setFrame(b.x, b.y, b.z, b.yaw);
  solid.box(0, 0.05, 0.8, 2 * hw + 2, 0.3, 2 * hl + 3, WOOD_LT);
  // The back: a wooden shack, open to the front
  const bz = -hl / 2;
  solid.box(0, h / 2, bz, 2 * hw, h, hl, WOOD);
  solid.box(0, h + 0.2, bz, 2 * hw + 0.6, 0.4, hl + 0.6, DARK);
  // Bottles on shelves on its front face
  const bottles = [0x2f8f4f, 0xe8a23a, 0x9b2a2a, 0xdedede, 0x3a6fd8];
  for (const y of [1.6, 2.3])
    for (let i = 0; i < 14; i++)
      solid.box(-hw + 1.2 + i * ((2 * hw - 2.4) / 13), y, 0.08, 0.16, 0.42, 0.16, bottles[(i + y * 3) % 5 | 0]);
  for (const y of [1.36, 2.06]) solid.box(0, y, 0.12, 2 * hw - 1.6, 0.06, 0.34, WOOD_LT);
  // Counter + stools
  solid.box(0, 0.55, 2.2, 2 * hw - 2.4, 1.1, 0.8, WOOD);
  solid.box(0, 1.14, 2.2, 2 * hw - 2.1, 0.08, 1.0, WOOD_LT);
  for (let i = 0; i < 6; i++) {
    const x = -hw + 2 + i * ((2 * hw - 4) / 5);
    solid.cyl(x, 0.2, 3.3, 0.05, 0.05, 0.62, 5, DARK);
    solid.cyl(x, 0.82, 3.3, 0.24, 0.24, 0.08, 8, RED);
  }
  // Striped awning on posts
  const stripes = 9;
  const sw = (2 * hw) / stripes;
  for (let i = 0; i < stripes; i++)
    solid.box(-hw + sw * (i + 0.5), 3.4, hl / 2 + 0.6, sw, 0.12, hl + 1.2, i % 2 === 0 ? RED : WHITE);
  for (const s of [-1, 1]) solid.cyl(s * (hw - 0.3), 0.2, hl + 0.9, 0.08, 0.08, 3.2, 6, WHITE);
  // THE 19TH HOLE up top, a noggles beside it
  boardPanel(signs, solid, -1.2, h + 1.5, bz + hl / 2 + 0.1, 5, 2.5, 0, buildingCell('bar19'), RED);
  noggles(solid, hw - 2.2, h + 1.4, bz + hl / 2, 1.1, 0.25);
  cols.push(frameBox(b, 0, bz, hw, hl / 2, 0, h + 0.4), frameBox(b, 0, 2.2, hw - 1.2, 0.4, 0, 1.15));
}

// ── Course dressing ─────────────────────────────────────────────────────

function teeStuff(C: GolfCourse, h: Hole, solid: MeshBuf, signs: MeshBuf) {
  const t = h.tee;
  const s = h.teeSpot;
  // Tee markers: mini red noggles either side of the spot
  for (const side of [-1, 1]) {
    const fx = Math.sin(t.yaw);
    const fz = Math.cos(t.yaw);
    const mx = s.x + fz * side * 3.2 + fx * 0.6;
    const mz = s.z - fx * side * 3.2 + fz * 0.6;
    solid.setFrame(mx, C.height(mx, mz) + 0.03, mz, t.yaw + Math.PI);
    noggles(solid, 0.1, 0.17, 0, 0.26, 0.12);
  }
  // The hole's sign on the right at the back, facing back up the tee
  const fx = Math.sin(t.yaw);
  const fz = Math.cos(t.yaw);
  const side = t.hw + 2.4;
  const back = -(t.hl - 2.5);
  const sx = t.x + fz * side + fx * back;
  const sz = t.z - fx * side + fz * back;
  const gy = C.height(sx, sz);
  for (const m of [solid, signs]) m.setFrame(sx, gy, sz, t.yaw + Math.PI);
  for (const px of [-0.75, 0.75]) solid.box(px, 0.6, 0, 0.1, 1.2, 0.1, GREEN_DK);
  boardPanel(signs, solid, 0, 1.55, 0, 1.8, 0.9, 0, SIGN_CELL.hole(h.n), GREEN_DK);
  // Bench + ball washer on the left
  const bx = t.x - fz * (t.hw + 3) + fx * back;
  const bz = t.z + fx * (t.hw + 3) + fz * back;
  solid.setFrame(bx, C.height(bx, bz), bz, t.yaw - Math.PI / 2);
  bench(solid);
  const wx = bx + fx * 3;
  const wz = bz + fz * 3;
  solid.setFrame(wx, C.height(wx, wz), wz, t.yaw);
  solid.cyl(0, 0, 0, 0.07, 0.07, 0.95, 6, DARK);
  solid.box(0, 1.05, 0, 0.32, 0.36, 0.22, 0x2f6fe0);
  solid.box(0.2, 1.1, 0, 0.08, 0.06, 0.06, DARK);
}

function bench(b: MeshBuf) {
  for (const z of [-0.12, 0.02, 0.16]) b.box(0, 0.45, z, 1.7, 0.05, 0.12, WOOD_LT);
  b.box(0, 0.78, -0.24, 1.7, 0.32, 0.05, WOOD_LT);
  for (const x of [-0.75, 0.75]) {
    b.box(x, 0.22, 0, 0.07, 0.45, 0.42, DARK);
    b.box(x, 0.62, -0.22, 0.06, 0.5, 0.06, DARK);
  }
}

function pinStuff(C: GolfCourse, h: Hole, solid: MeshBuf) {
  const p = h.pin;
  solid.setFrame(p.x, p.y, p.z, 0);
  solid.cyl(0, 0, 0, 0.022, 0.022, 2.35, 6, WHITE, true);
  solid.ring(0, 0.055, 0, 0.0, 0.054, 10, 0x0c0c0c);
  solid.ring(0, 0.056, 0, 0.054, 0.085, 10, WHITE);
  // Yardage posts on the fairway's edge (100 red, 150 white, 200 blue)
  if (h.par !== 3 && h.fairway !== null) {
    const marks: [number, number][] = [
      [100, RED],
      [150, WHITE],
      [200, 0x2f6fe0],
    ];
    for (const [d, col] of marks) {
      const s = h.length - d;
      if (s < 60) continue;
      polyAt(h.line, s, AT);
      let half = 18;
      let best = Infinity;
      h.fairway.pts.forEach((q, i) => {
        const dd = Math.hypot(q.x - AT.x, q.z - AT.z);
        if (dd < best) {
          best = dd;
          half = h.fairway!.half[i];
        }
      });
      const fx = Math.sin(AT.yaw);
      const fz = Math.cos(AT.yaw);
      const x = AT.x + fz * (half + 1.5);
      const z = AT.z - fx * (half + 1.5);
      solid.setFrame(x, C.height(x, z), z, AT.yaw);
      solid.cyl(0, 0, 0, 0.08, 0.08, 0.85, 6, col);
      solid.cyl(0, 0.85, 0, 0.11, 0.02, 0.12, 6, col, false);
    }
  }
  // A rake by each bunker
  for (const bk of h.bunkers) {
    const s = bk.shape;
    const x = s.x + 1.2;
    const z = s.z + 0.8;
    solid.setFrame(x, C.height(x, z) + 0.06, z, (s.x * 7) % 6.28);
    solid.box(0, 0, 0, 0.04, 0.04, 1.6, 0xd9b48a);
    solid.box(0, 0, 0.82, 0.55, 0.05, 0.06, DARK);
  }
}

function range(C: GolfCourse, L: CourseLayout, solid: MeshBuf, signs: MeshBuf) {
  const R = L.range;
  const yaw = R.yaw;
  for (const bay of R.bays) {
    solid.setFrame(bay.x, bay.y, bay.z, yaw);
    solid.box(0, 0.03, 0, 1.6, 0.06, 1.6, 0x2d6a3e);
    solid.box(0, 0.07, 0.2, 0.16, 0.04, 0.16, WHITE);
    solid.box(0.9, 0.0, -0.5, 0.5, 0.35, 0.4, DARK);
    for (const s of [-5, 5]) {
      solid.box(s, 0.7, -0.4, 0.06, 1.4, 2.4, WHITE);
      solid.box(s, 1.6, -3.0, 0.22, 3.2, 0.22, DARK);
    }
    solid.box(0, 3.25, -2.0, 10.1, 0.22, 3.4, GREEN_DK);
  }
  // Distance boards: on the far side of each target from the line
  const t0 = R.tee;
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  R.targets.forEach((t, i) => {
    const dx = t.x - t0.x;
    const dz = t.z - t0.z;
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    const bx = lx - Math.sign(lx) * (t.r + 7);
    const x = t0.x + bx * c + lz * s;
    const z = t0.z - bx * s + lz * c;
    const gy = C.height(x, z);
    for (const m of [solid, signs]) m.setFrame(x, gy, z, yaw + Math.PI);
    for (const px of [-1.2, 1.2]) solid.box(px, 1.2, 0, 0.14, 2.4, 0.14, DARK);
    boardPanel(signs, solid, 0, 2.9, 0, 3.4, 1.7, 0, SIGN_CELL.board(i));
  });
}

function entrance(C: GolfCourse, solid: MeshBuf, signs: MeshBuf, cols: ColliderBox[]) {
  // At the course's −u end, where the GO DOWN line side comes in, facing out
  toWorld(-38, 40, W);
  const yaw = uYaw(-38) + Math.PI;
  const y = C.height(W.x, W.z);
  for (const m of [solid, signs]) m.setFrame(W.x, y, W.z, yaw);
  for (const sx of [-6.5, 6.5]) {
    solid.box(sx, 3.2, 0, 1.4, 6.6, 1.4, STONE);
    solid.box(sx, 6.65, 0, 1.7, 0.3, 1.7, WHITE);
  }
  solid.box(0, 6.2, 0, 14.4, 1.2, 1.0, GREEN_DK);
  boardPanel(signs, solid, 0, 8.3, 0.05, 7.2, 3.6, 0, SIGN_CELL.entrance, GREEN_DK);
  noggles(solid, 0.5, 11.4, 0, 1.6, 0.4);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  for (const sx of [-6.5, 6.5])
    cols.push({ x: W.x + sx * c, y: y - 0.5, z: W.z - sx * s, hw: 0.7, hl: 0.7, h: 7.4, yaw });
}

// ── Flags ───────────────────────────────────────────────────────────────

export const FLAG = { w: 0.92, h: 0.6, cols: 5, rows: 3, pole: 2.35 };

function flagSet(L: CourseLayout, ox: number, oz: number): FlagSet {
  const b = new MeshBuf(ox, oz, true);
  const flags: FlagSet['flags'] = [];
  const add = (x: number, y: number, z: number, cell: number, pole: number) => {
    // Flags fly downhill-ish (+X) with a little per-flag variety
    const yaw = Math.PI / 2 + Math.sin(x * 0.37 + z * 0.11) * 0.5;
    const [u0, v0, u1, v1] = cellUv(cell, FLAG_GRID);
    const v = b.count;
    b.setFrame(x, y + pole, z, yaw);
    for (let r = 0; r < FLAG.rows; r++)
      for (let c = 0; c < FLAG.cols; c++) {
        const fu = c / (FLAG.cols - 1);
        const fv = r / (FLAG.rows - 1);
        // Along the flag = local +z (the yaw it flies), down = −y
        b.vert(0, -FLAG.h * fv, FLAG.w * fu, 1, 0, 0, { r: 1, g: 1, b: 1 }, u0 + (u1 - u0) * fu, v1 - (v1 - v0) * fv);
      }
    for (let r = 0; r < FLAG.rows - 1; r++)
      for (let c = 0; c < FLAG.cols - 1; c++) {
        const a = v + r * FLAG.cols + c;
        b.tri(a, a + FLAG.cols, a + 1);
        b.tri(a + 1, a + FLAG.cols, a + FLAG.cols + 1);
      }
    flags.push({ v0: v, x: x - ox, y: y + pole, z: z - oz, yaw, phase: (x * 0.13 + z * 0.29) % 6.28 });
  };
  for (const h of L.holes) add(h.pin.x, h.pin.y, h.pin.z, h.n - 1, FLAG.pole);
  for (const t of L.range.targets) add(t.x, t.y, t.z, FLAG_PLAIN, FLAG.pole);
  return { data: b.data(), flags, cols: FLAG.cols, rows: FLAG.rows, w: FLAG.w, h: FLAG.h };
}

/**
 * Wave the flags (positions in place, `pos` = the flag mesh's position
 * array): a travelling ripple that grows towards the fly end.
 */
export function waveFlags(set: FlagSet, pos: Float32Array, t: number, wind = 1) {
  const { cols, rows, w, h } = set;
  for (const f of set.flags) {
    const fx = Math.sin(f.yaw);
    const fz = Math.cos(f.yaw);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const fu = c / (cols - 1);
        const fv = r / (rows - 1);
        const k = (f.v0 + r * cols + c) * 3;
        const ph = t * 5.2 + f.phase - fu * 2.6;
        const side = Math.sin(ph) * 0.11 * fu * wind;
        const along = w * fu * (1 - 0.04 * wind * (1 + Math.cos(ph)) * fu);
        const droop = 0.05 * fu * fu * (1 - wind * 0.5);
        pos[k] = f.x + fx * along + fz * side;
        pos[k + 1] = f.y - h * fv - droop + Math.sin(ph * 0.7) * 0.02 * fu;
        pos[k + 2] = f.z + fz * along - fx * side;
      }
  }
}

// ── Everything ──────────────────────────────────────────────────────────

/** Build the course's static scenery, positions relative to (ox, oz). */
export function buildScenery(C: GolfCourse, ox: number, oz: number): Scenery {
  const out: { scenery: Scenery | null } = { scenery: null };
  const it = sceneryGen(C, ox, oz, out);
  while (it.next().done !== true);
  return out.scenery!;
}

/** buildScenery in slices: yields after each building and every few holes. */
export function* sceneryGen(C: GolfCourse, ox: number, oz: number, out: { scenery: Scenery | null }): Generator<void> {
  const L = C.layout;
  const solid = new MeshBuf(ox, oz);
  const glass = new MeshBuf(ox, oz);
  const signs = new MeshBuf(ox, oz, true);
  const cols: ColliderBox[] = [];
  for (const b of L.buildings) {
    switch (b.id) {
      case 'clubhouse':
        clubhouse(b, solid, glass, signs, cols);
        break;
      case 'bar19':
        bar19(b, solid, signs, cols);
        break;
      case 'proshop':
        simple(b, solid, glass, signs, cols, { wall: CREAM, trim: GREEN_DK, glassFront: true });
        break;
      case 'starter':
        simple(b, solid, glass, signs, cols, { wall: WHITE, trim: RED, glassFront: false, gable: 1.2 });
        break;
      case 'rangehut':
        simple(b, solid, glass, signs, cols, { wall: CREAM, trim: GREEN_DK, glassFront: true });
        break;
      case 'barn':
        simple(b, solid, glass, signs, cols, { wall: 0xb3372f, trim: WHITE, glassFront: false, gable: 1.8, door: true });
        break;
    }
    yield;
  }
  for (const h of L.holes) {
    teeStuff(C, h, solid, signs);
    pinStuff(C, h, solid);
    yield;
  }
  range(C, L, solid, signs);
  entrance(C, solid, signs, cols);
  yield;
  const flags = flagSet(L, ox, oz);
  yield;
  out.scenery = {
    solid: solid.data(),
    glass: glass.data(),
    signs: signs.data(),
    flags,
    colliders: cols,
  };
}
