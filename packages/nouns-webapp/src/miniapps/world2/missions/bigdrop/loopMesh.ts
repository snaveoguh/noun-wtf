// ── The Big Drop's loops: the structure (geometry only, loop-local) ─────
//
// One loop = two meshes and one collider, all in loop-local coordinates
// (X across the line, Y up off the pad, Z down it; origin at the bottom of
// the circle: see loopPath.ts), so the float32 buffers stay within ~100 m
// of their object's origin:
//   • solid (vertex colours, one lit material): an ice deck between white
//     parapets on a deep Nouns-red box beam, swept round the helix; a
//     red/white kerbed funnel apron that catches the whole lane; a red
//     tower either side with struts and a crossbeam over the top, and a
//     giant pair of noggles on the crossbeam, facing riders on the way in;
//   • neon (unlit): cyan and magenta strips along the parapet tops and the
//     funnel kerbs, and a glow line round the outside of the circle;
//   • collider: the towers, struts and crossbeam, and the circle's
//     parapet walls (the deck itself isn't one: the ride owns the rider
//     there, and a floor in the way would only trip the ground physics).

import type { LoopShape, LoopSample } from './loopPath';

import * as THREE from 'three';

import { NOG_RED, NOGGLES } from '../../../../components/NounOS/home/introScene';

import { circleLength, laneAt, loopShift, newSample, rideLength, sampleLoop } from './loopPath';

const RED = new THREE.Color(NOG_RED);
const RED_DARK = new THREE.Color(NOG_RED).multiplyScalar(0.62);
const WHITE = new THREE.Color(0xffffff);
const BLACK = new THREE.Color(0x111111);
const ICE_A = new THREE.Color(0xbfeeff);
const ICE_B = new THREE.Color(0x9fdcf7);
const PARAPET = new THREE.Color(0xf2f7ff);
const STEEL = new THREE.Color(0xd8263a);
const CYAN = new THREE.Color(0x3cf4ff);
const MAGENTA = new THREE.Color(0xff3df0);
const GLOW = new THREE.Color(0xfff27a);

/** Parapet height and thickness, and the depth of the red beam under the deck (m). */
export const PARAPET_H = 1.05;
const PARAPET_T = 0.35;
export const BEAM_D = 1.4;
const TOWER_HALF = 1.1;
const TOWER_GAP = 2.4;

/** A growable Float32Array. */
class F32 {
  a = new Float32Array(4096);
  n = 0;
  push3(x: number, y: number, z: number) {
    if (this.n + 3 > this.a.length) {
      const b = new Float32Array(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = x;
    this.a[this.n++] = y;
    this.a[this.n++] = z;
  }
  get array() {
    return this.a.slice(0, this.n);
  }
}

/** One mesh's buffers: indexed quads, four vertices each (flat-shaded faces). */
class Buf {
  pos = new F32();
  nor = new F32();
  col = new F32();
  idx: number[] = [];

  /** Quad a-b-c-d (any winding; it's turned to face n). */
  quad(
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    d: THREE.Vector3,
    n: THREE.Vector3,
    col: THREE.Color,
  ) {
    _e1.subVectors(b, a);
    _e2.subVectors(c, a);
    const flip = _e1.cross(_e2).dot(n) < 0;
    const i = this.pos.n / 3;
    for (const v of [a, b, c, d]) {
      this.pos.push3(v.x, v.y, v.z);
      this.nor.push3(n.x, n.y, n.z);
      this.col.push3(col.r, col.g, col.b);
    }
    if (flip) this.idx.push(i, i + 3, i + 2, i, i + 2, i + 1);
    else this.idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.array, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(this.nor.array, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col.array, 3));
    g.setIndex(new THREE.BufferAttribute(Uint32Array.from(this.idx), 1));
    g.computeBoundingSphere();
    return g;
  }
}

/** Collider triangles (positions only). */
class Tris {
  pos = new F32();
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3) {
    for (const v of [a, b, c, a, c, d]) this.pos.push3(v.x, v.y, v.z);
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos.array, 3));
    return g;
  }
}

const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
const _n = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();

/** One cross-section of a sweep: where it is and its axes. */
interface Ring {
  p: THREE.Vector3;
  /** Across (lateral). */
  s: THREE.Vector3;
  /** Up off the deck. */
  c: THREE.Vector3;
  /** Half width of the deck here, and parapet height. */
  hw: number;
  ph: number;
  /** Arc length (for colour bands). */
  u: number;
  /** On the circle (its parapets collide). */
  circle: boolean;
}

/** A profile edge: from (s, c) to (s, c) in the ring's plane, facing (ns, nc). */
interface Edge {
  a: (r: Ring) => [number, number];
  b: (r: Ring) => [number, number];
  n: [number, number];
  col: (r: Ring, i: number) => THREE.Color;
  collide?: boolean;
}

function at(r: Ring, sc: [number, number], out: THREE.Vector3) {
  return out.copy(r.p).addScaledVector(r.s, sc[0]).addScaledVector(r.c, sc[1]);
}

function sweep(rings: Ring[], edges: Edge[], buf: Buf, tris: Tris | null) {
  for (let i = 0; i + 1 < rings.length; i++) {
    const r0 = rings[i]!;
    const r1 = rings[i + 1]!;
    for (const e of edges) {
      at(r0, e.a(r0), _a);
      at(r0, e.b(r0), _b);
      at(r1, e.b(r1), _c);
      at(r1, e.a(r1), _d);
      _n.copy(r0.s).multiplyScalar(e.n[0]).addScaledVector(r0.c, e.n[1]).normalize();
      buf.quad(_a, _b, _c, _d, _n, e.col(r0, i));
      if (tris !== null && e.collide === true && r0.circle && r1.circle) tris.quad(_a, _b, _c, _d);
    }
  }
}

/** Axis-aligned box (loop-local), into the mesh and optionally the collider. */
function box(
  buf: Buf,
  tris: Tris | null,
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number,
  col: THREE.Color,
  side: THREE.Color = col,
) {
  const v = (x: number, y: number, z: number, o: THREE.Vector3) => o.set(x, y, z);
  const faces: [number[][], [number, number, number], THREE.Color][] = [
    [
      [
        [x1, y0, z0],
        [x1, y1, z0],
        [x1, y1, z1],
        [x1, y0, z1],
      ],
      [1, 0, 0],
      side,
    ],
    [
      [
        [x0, y0, z0],
        [x0, y0, z1],
        [x0, y1, z1],
        [x0, y1, z0],
      ],
      [-1, 0, 0],
      side,
    ],
    [
      [
        [x0, y1, z0],
        [x0, y1, z1],
        [x1, y1, z1],
        [x1, y1, z0],
      ],
      [0, 1, 0],
      col,
    ],
    [
      [
        [x0, y0, z0],
        [x1, y0, z0],
        [x1, y0, z1],
        [x0, y0, z1],
      ],
      [0, -1, 0],
      side,
    ],
    [
      [
        [x0, y0, z1],
        [x1, y0, z1],
        [x1, y1, z1],
        [x0, y1, z1],
      ],
      [0, 0, 1],
      col,
    ],
    [
      [
        [x0, y0, z0],
        [x0, y1, z0],
        [x1, y1, z0],
        [x1, y0, z0],
      ],
      [0, 0, -1],
      col,
    ],
  ];
  for (const [q, n, c] of faces) {
    v(q[0]![0]!, q[0]![1]!, q[0]![2]!, _a);
    v(q[1]![0]!, q[1]![1]!, q[1]![2]!, _b);
    v(q[2]![0]!, q[2]![1]!, q[2]![2]!, _c);
    v(q[3]![0]!, q[3]![1]!, q[3]![2]!, _d);
    _n.set(n[0], n[1], n[2]);
    buf.quad(_a, _b, _c, _d, _n, c);
    tris?.quad(_a, _b, _c, _d);
  }
}

/** A box along a→b, half sizes w (as near local X as it can) and d. */
function beam(
  buf: Buf,
  tris: Tris | null,
  a: THREE.Vector3,
  b: THREE.Vector3,
  w: number,
  d: number,
  col: THREE.Color,
) {
  const ax = new THREE.Vector3().subVectors(b, a).normalize();
  const e1 = new THREE.Vector3(1, 0, 0);
  if (Math.abs(e1.dot(ax)) > 0.9) e1.set(0, 0, 1);
  e1.addScaledVector(ax, -e1.dot(ax)).normalize();
  const e2 = new THREE.Vector3().crossVectors(ax, e1);
  const c = (p: THREE.Vector3, s1: number, s2: number) =>
    p
      .clone()
      .addScaledVector(e1, s1 * w)
      .addScaledVector(e2, s2 * d);
  // Each long face: its two corners round the section, and its normal
  const sides: [[number, number], [number, number], THREE.Vector3][] = [
    [[1, -1], [1, 1], e1],
    [[-1, -1], [-1, 1], e1.clone().negate()],
    [[-1, 1], [1, 1], e2],
    [[-1, -1], [1, -1], e2.clone().negate()],
  ];
  for (const [u, v, n] of sides) {
    const p0 = c(a, u[0], u[1]);
    const p1 = c(a, v[0], v[1]);
    const p2 = c(b, v[0], v[1]);
    const p3 = c(b, u[0], u[1]);
    buf.quad(p0, p1, p2, p3, n, col);
    tris?.quad(p0, p1, p2, p3);
  }
  for (const [p, n] of [
    [a, ax.clone().negate()],
    [b, ax],
  ] as const) {
    const q0 = c(p, -1, -1);
    const q1 = c(p, 1, -1);
    const q2 = c(p, 1, 1);
    const q3 = c(p, -1, 1);
    buf.quad(q0, q1, q2, q3, n, col);
    tris?.quad(q0, q1, q2, q3);
  }
}

function ringAt(s: LoopSample, u: number, hw: number, ph: number, circle: boolean): Ring {
  const p = new THREE.Vector3(s.px, s.py, s.pz);
  const c = new THREE.Vector3(s.cx, s.cy, s.cz);
  const t = new THREE.Vector3(s.tx, s.ty, s.tz);
  // Across = up × along, so (across, up, along) is right-handed like (X, Y, Z)
  const sv = new THREE.Vector3().crossVectors(c, t).normalize();
  return { p, s: sv, c, hw, ph, u, circle };
}

const band = (r: Ring) => (Math.floor(r.u / 3) % 2 === 0 ? ICE_A : ICE_B);

/** The riding lane: deck, parapets and the red beam under it. */
function laneEdges(): Edge[] {
  const pt = PARAPET_T;
  const bd = BEAM_D;
  return [
    { a: r => [-r.hw, 0], b: r => [r.hw, 0], n: [0, 1], col: band },
    { a: r => [r.hw, 0], b: r => [r.hw, r.ph], n: [-1, 0], col: () => PARAPET, collide: true },
    { a: r => [r.hw, r.ph], b: r => [r.hw + pt, r.ph], n: [0, 1], col: () => RED },
    { a: r => [r.hw + pt, r.ph], b: r => [r.hw + pt, -bd], n: [1, 0], col: () => RED },
    { a: r => [r.hw + pt, -bd], b: r => [-r.hw - pt, -bd], n: [0, -1], col: () => RED_DARK },
    { a: r => [-r.hw - pt, -bd], b: r => [-r.hw - pt, r.ph], n: [-1, 0], col: () => RED },
    { a: r => [-r.hw - pt, r.ph], b: r => [-r.hw, r.ph], n: [0, 1], col: () => RED },
    { a: r => [-r.hw, r.ph], b: r => [-r.hw, 0], n: [1, 0], col: () => PARAPET, collide: true },
  ];
}

/** A square neon tube along the sweep at (s, c), side `w`. */
function tubeEdges(
  s: (r: Ring) => number,
  c: (r: Ring) => number,
  w: number,
  col: THREE.Color,
): Edge[] {
  const h = w / 2;
  return [
    { a: r => [s(r) - h, c(r) + w], b: r => [s(r) + h, c(r) + w], n: [0, 1], col: () => col },
    { a: r => [s(r) + h, c(r)], b: r => [s(r) + h, c(r) + w], n: [1, 0], col: () => col },
    { a: r => [s(r) - h, c(r) + w], b: r => [s(r) - h, c(r)], n: [-1, 0], col: () => col },
    { a: r => [s(r) - h, c(r)], b: r => [s(r) + h, c(r)], n: [0, -1], col: () => col },
  ];
}

export interface LoopGeometry {
  solid: THREE.BufferGeometry;
  neon: THREE.BufferGeometry;
  /** Loop-local; rotate into peak axes before handing it to setCollider. */
  collider: THREE.BufferGeometry;
  /** Where the side towers stand (loop-local X), for the camera. */
  towerX: [number, number];
}

/** Build one loop's geometry. `segs` = circle segments per turn. */
/** The snow round a loop, in loop-local terms. */
export interface LoopGround {
  /** World up in loop-local axes (the pad may slope). */
  up: THREE.Vector3;
  /** Distance from a loop-local point straight (world) down to the snow (m). */
  depth(x: number, y: number, z: number): number;
}

/** A level pad at Y = 0. */
export const LEVEL: LoopGround = { up: new THREE.Vector3(0, 1, 0), depth: (_x, y) => y };

export function buildLoopGeometry(
  sh: LoopShape,
  segs: number,
  ground: LoopGround = LEVEL,
): LoopGeometry {
  const solid = new Buf();
  const neon = new Buf();
  const tris = new Tris();
  const A = sh.approach;
  const W = loopShift(sh);
  const s = newSample();

  // ── The funnel apron: the whole lane narrowing onto the deck ──
  const fun: Ring[] = [];
  const blendEnd = A * 0.8;
  const fsteps = 26;
  for (let i = 0; i <= fsteps; i++) {
    const u = -sh.funnel + ((blendEnd + sh.funnel) * i) / fsteps;
    const k0 = Math.min(1, Math.max(0, u / blendEnd));
    const k = k0 * k0 * (3 - 2 * k0);
    sampleLoop(sh, u, s);
    // Same blend the ride uses: centre from the line (X = 0) to the lane
    s.px = (-W / 2) * k;
    fun.push(ringAt(s, u, sh.catchHalf * (1 - k) + (sh.hw + 0.2) * k, 0.3, false));
  }
  const kerb = (_r: Ring, i: number) => (i % 2 === 0 ? RED : WHITE);
  const K = 0.8;
  sweep(
    fun,
    [
      { a: r => [-r.hw, 0.04], b: r => [r.hw, 0.04], n: [0, 1], col: band },
      { a: r => [r.hw, 0.04], b: r => [r.hw, r.ph], n: [-1, 0], col: kerb },
      { a: r => [r.hw, r.ph], b: r => [r.hw + K, r.ph], n: [0, 1], col: kerb },
      { a: r => [r.hw + K, r.ph], b: r => [r.hw + K, -0.8], n: [1, 0], col: () => RED },
      { a: r => [-r.hw - K, -0.8], b: r => [-r.hw - K, r.ph], n: [-1, 0], col: () => RED },
      { a: r => [-r.hw - K, r.ph], b: r => [-r.hw, r.ph], n: [0, 1], col: kerb },
      { a: r => [-r.hw, r.ph], b: r => [-r.hw, 0.04], n: [1, 0], col: kerb },
    ],
    solid,
    null,
  );
  sweep(
    fun,
    [
      ...tubeEdges(
        r => r.hw + K,
        r => r.ph,
        0.16,
        CYAN,
      ),
      ...tubeEdges(
        r => -r.hw - K,
        r => r.ph,
        0.16,
        MAGENTA,
      ),
    ],
    neon,
    null,
  );

  // ── The lane: the last of the approach, the circle, the runout ──
  const lane: Ring[] = [];
  const C = circleLength(sh);
  const end = rideLength(sh);
  const push = (u: number, circle: boolean) => {
    sampleLoop(sh, u, s);
    // The parapets rise out of the funnel's kerbs over the first few metres
    const ph = PARAPET_H * Math.min(1, Math.max(0.28, (u - blendEnd) / 6 + 0.28));
    lane.push(ringAt(s, u, sh.hw, ph, circle));
  };
  for (let i = 0; i <= 6; i++) push(blendEnd - 0.5 + ((A - blendEnd + 0.5) * i) / 6, false);
  const n = segs * sh.turns;
  for (let i = 1; i <= n; i++) push(A + (C * i) / n, true);
  for (let i = 1; i <= 8; i++) push(end + (sh.runout * i) / 8, false);
  sweep(lane, laneEdges(), solid, tris);
  const pt = PARAPET_T;
  sweep(
    lane,
    [
      ...tubeEdges(
        r => r.hw + pt / 2,
        r => r.ph,
        0.34,
        CYAN,
      ),
      ...tubeEdges(
        r => -r.hw - pt / 2,
        r => r.ph,
        0.34,
        MAGENTA,
      ),
    ],
    neon,
    null,
  );
  // A glow line round the outside of the circle (it reads from kilometres off)
  sweep(
    lane.filter(r => r.circle),
    tubeEdges(
      () => 0,
      () => -BEAM_D - 0.55,
      0.55,
      GLOW,
    ),
    neon,
    null,
  );

  // ── Towers, struts, crossbeam ──
  // The masts stand plumb (world up), whatever the pad's slope, down to the snow
  const R = sh.R;
  const bd = BEAM_D;
  const up = ground.up;
  const xL = laneAt(sh, 0) - sh.hw - pt - TOWER_GAP - TOWER_HALF;
  const xR = laneAt(sh, Math.PI * 2 * sh.turns) + sh.hw + pt + TOWER_GAP + TOWER_HALF;
  const topY = 2 * R + bd;
  const beamY0 = topY + 0.1;
  const beamY1 = topY + 1.9;
  const masts: THREE.Vector3[] = [];
  for (const x of [xL, xR]) {
    const top = new THREE.Vector3(x, beamY1, 0);
    const foot = top.clone().addScaledVector(up, -(ground.depth(x, beamY1, 0) + 3));
    beam(solid, tris, foot, top, TOWER_HALF, TOWER_HALF, STEEL);
    beam(solid, tris, foot, foot.clone().addScaledVector(up, 4.2), 2.4, 2.4, RED_DARK);
    masts.push(top);
  }
  box(solid, tris, xL - TOWER_HALF, beamY0, -1.2, xR + TOWER_HALF, beamY1, 1.2, RED);
  // Struts from each mast to its ring, at the sides of the circle
  const strut = (mast: THREE.Vector3, phi: number) => {
    const lane0 = laneAt(sh, phi);
    const z = Math.sin(phi) * R;
    const q = new THREE.Vector3(
      mast.x < 0 ? lane0 - sh.hw - pt : lane0 + sh.hw + pt,
      R * (1 - Math.cos(phi)),
      z + (z > 0 ? bd / 2 : -bd / 2),
    );
    // Square onto the mast's line
    const k = _e1.subVectors(mast, q).dot(up);
    const m = mast.clone().addScaledVector(up, -k);
    beam(solid, tris, q, m, 0.55, 0.55, STEEL);
  };
  strut(masts[0]!, Math.PI / 2);
  strut(masts[0]!, (3 * Math.PI) / 2);
  const lastTurn = Math.PI * 2 * (sh.turns - 1);
  strut(masts[1]!, lastTurn + Math.PI / 2);
  strut(masts[1]!, lastTurn + (3 * Math.PI) / 2);

  // ── The noggles on top, facing the riders coming down ──
  const cols = NOGGLES[0]!.length;
  const rows = NOGGLES.length;
  const width = xR - xL + 10;
  const px = width / cols;
  const depth = 1.4;
  const y0 = beamY1;
  const colour = (k: string) => (k === 'R' ? RED : k === 'W' ? WHITE : BLACK);
  for (let row = 0; row < rows; row++) {
    const line = NOGGLES[row]!;
    let x = 0;
    while (x < cols) {
      const k = line[x]!;
      let e = x + 1;
      while (e < cols && line[e] === k) e++;
      if (k !== '.') {
        // Seen from up the line (looking +Z), the viewer's right is −X
        const xa = (cols / 2 - e) * px;
        const xb = (cols / 2 - x) * px;
        const ya = y0 + (rows - 1 - row) * px;
        box(solid, null, xa, ya, -depth / 2, xb, ya + px, depth / 2, colour(k), RED_DARK);
      }
      x = e;
    }
  }
  return {
    solid: solid.geometry(),
    neon: neon.geometry(),
    collider: tris.geometry(),
    towerX: [xL, xR],
  };
}
