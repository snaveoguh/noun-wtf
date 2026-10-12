// ── The Noggle Bowl: walls, deck + dressing (chunk decorator) ───────────
//
// Shape, terrace and roll-in: noggleBowl.ts. The floor, transitions, bank
// and roll-in are analytic terrain (rendered + collided by the mountain
// itself); this adds what a heightfield can't hold: the steep upper walls,
// the vert, the deck around the rim (the terrain tucks under them, see
// noggleBowl.ts), plus coping, a pool-tile band, giant noggles painted on
// the floor, light towers and a hand-painted sign at the slip road.
//
// The wall mesh is swept around the rim: one station every ~1.5 m, each a
// profile from the wall's steep edge (where it leaves the terrain, flush
// and tangent) up the transition, the vert and out across the deck. The
// same triangles are the collider (chunk-local, in the chunk's dynamic
// BVH), so what you see is what you ride. Built when the chunk holding the
// bowl's centre gets its props, torn down with them.

import type { ChunkContext, ChunkDecoration, ChunkDecorator } from './MountainStream';

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

import { inkExcluded, toonify } from '../../render/Toon';

import { edgeDistance } from './config';
import {
  BOWL,
  BOWL_GEO,
  bowlAxisToWorld,
  bowlFrameNow,
  bowlSurface,
  bowlToWorld,
  bowlYaw,
  chuteV,
  steepEdge,
  vertness,
  wallH,
  type BowlFrame,
} from './noggleBowl';
import { terrainHeight } from './terrain';

const C = {
  concrete: 0xc9c3b6,
  concreteDark: 0xa9a397,
  deck: 0xddd6c8,
  tile: 0x2f6fb4,
  tileLight: 0x6fb2e6,
  steel: 0xc6ccd4,
  red: 0xd22209,
  black: 0x141414,
  white: 0xf4f4f0,
  pole: 0x5a5f68,
  lamp: 0xfff2b0,
  wood: 0xc49a62,
} as const;

const _o = { x: 0, z: 0 };
const _c = new THREE.Color();

interface Station {
  /** Rim point (bowl axis coords) and outward unit normal. */
  b: number;
  a: number;
  nb: number;
  na: number;
  /** Axis position (clamped) for the wall height / vertness. */
  bc: number;
}

/** Rim stations around the stadium, ~`step` m apart. */
function stations(step: number): Station[] {
  const { A, Rr } = BOWL;
  const out: Station[] = [];
  const nS = Math.ceil((2 * A) / step);
  const nC = Math.ceil((Math.PI * Rr) / step);
  // +a straight (shallow → deep), deep half circle, −a straight, shallow half circle
  for (let i = 0; i < nS; i++) {
    const b = -A + (2 * A * i) / nS;
    out.push({ b, a: Rr, nb: 0, na: 1, bc: b });
  }
  for (let i = 0; i < nC; i++) {
    const p = (Math.PI * i) / nC;
    out.push({
      b: A + Rr * Math.sin(p),
      a: Rr * Math.cos(p),
      nb: Math.sin(p),
      na: Math.cos(p),
      bc: A,
    });
  }
  for (let i = 0; i < nS; i++) {
    const b = A - (2 * A * i) / nS;
    out.push({ b, a: -Rr, nb: 0, na: -1, bc: b });
  }
  for (let i = 0; i < nC; i++) {
    const p = Math.PI + (Math.PI * i) / nC;
    out.push({
      b: -A + Rr * Math.sin(p),
      a: Rr * Math.cos(p),
      nb: Math.sin(p),
      na: Math.cos(p),
      bc: -A,
    });
  }
  return out;
}

/** Profile rows: inward distance d (or the rim's vert foot / top), colour, quad to the next row? */
interface Row {
  d: number;
  rim: 'foot' | 'top' | null;
  col: number;
  join: boolean;
}

function profileRows(H: number): Row[] {
  const rows: Row[] = [];
  const Rt = H - BOWL.Hv;
  // Transition: even angle steps on the quarter circle from the steep edge to vertical
  const ds = steepEdge(H);
  const a0 = Math.asin(1 - ds / Rt);
  const n = 14;
  for (let i = 0; i < n; i++) {
    const ang = a0 + ((Math.PI / 2 - a0) * i) / n;
    const d = Rt * (1 - Math.sin(ang));
    rows.push({ d, rim: null, col: i > n - 3 ? C.tileLight : C.concrete, join: true });
  }
  rows.push({ d: 0, rim: 'foot', col: C.tileLight, join: false });
  // The vert itself: a pool-tile band
  rows.push({ d: 0, rim: 'foot', col: C.tile, join: true });
  rows.push({ d: 0, rim: 'top', col: C.tile, join: false });
  // Deck
  rows.push({ d: 0, rim: 'top', col: C.deck, join: true });
  for (const d of [-1.2, -3.5, -7, -11.5, -15.5, -BOWL.deckW])
    rows.push({ d, rim: null, col: d < -BOWL.deckW + 2 ? C.concreteDark : C.deck, join: true });
  rows[rows.length - 1].join = false;
  return rows;
}

interface Built {
  /** Walls + deck (vertex colours), chunk-local; also the collider. */
  walls: THREE.BufferGeometry;
  collision: THREE.BufferGeometry;
  coping: THREE.BufferGeometry;
  decals: THREE.BufferGeometry | null;
  pool: THREE.BufferGeometry;
  props: THREE.BufferGeometry | null;
  lamps: THREE.BufferGeometry | null;
  sign: { pos: THREE.Vector3; yaw: number } | null;
  tris: number;
}

/** Sweep the walls + deck around the rim. */
function buildWalls(
  f: BowlFrame,
  origin: THREE.Vector3,
): {
  pos: number[];
  col: number[];
  rimTop: { x: number; y: number; z: number; inx: number; inz: number; w: number }[];
} {
  const st = stations(1.5);
  const pos: number[] = [];
  const col: number[] = [];
  const rimTop: { x: number; y: number; z: number; inx: number; inz: number; w: number }[] = [];
  // Per station: world points + design / terrain heights of every row
  type V = { x: number; y: number; z: number; gap: number; c: number };
  const grid: (V[] | null)[] = [];
  let rowsRef: Row[] | null = null;
  for (const s of st) {
    const wv = vertness(s.bc);
    if (wv <= 0) {
      grid.push(null);
      continue;
    }
    const H = wallH(s.bc);
    const rows = profileRows(H);
    rowsRef ??= rows;
    const vs: V[] = [];
    for (const r of rows) {
      const b = s.b - s.nb * r.d;
      const a = s.a - s.na * r.d;
      const sm = bowlSurface(f, b + BOWL_GEO.U_B, a + BOWL_GEO.VC, f.P, r.rim);
      bowlAxisToWorld(f, b, a, _o);
      vs.push({
        x: _o.x - origin.x,
        y: sm.d - origin.y,
        z: _o.z - origin.z,
        gap: sm.d - sm.t,
        c: r.col,
      });
    }
    grid.push(vs);
    // Coping line (inner edge of the deck at the top of the vert)
    const top = vs[rows.findIndex(r => r.rim === 'top')];
    bowlAxisToWorld(f, s.b - s.nb, s.a - s.na, _o);
    const ix = _o.x - origin.x - top.x;
    const iz = _o.z - origin.z - top.z;
    const il = Math.hypot(ix, iz) || 1;
    rimTop.push({ x: top.x, y: top.y, z: top.z, inx: ix / il, inz: iz / il, w: wv });
  }
  if (rowsRef === null) return { pos, col, rimTop };
  const nR = rowsRef.length;
  const push = (v: V) => {
    pos.push(v.x, v.y, v.z);
    _c.setHex(v.c);
    col.push(_c.r, _c.g, _c.b);
  };
  const N = st.length;
  for (let i = 0; i < N; i++) {
    const g0 = grid[i];
    const g1 = grid[(i + 1) % N];
    if (g0 === null || g1 === null) continue;
    const s = st[i];
    // Expected facing: into the bowl and up (world)
    bowlAxisToWorld(f, s.b - s.nb, s.a - s.na, _o);
    const ex = _o.x - origin.x - g0[0].x;
    const ez = _o.z - origin.z - g0[0].z;
    for (let j = 0; j < nR - 1; j++) {
      if (!rowsRef[j].join) continue;
      const a = g0[j];
      const b = g0[j + 1];
      const c = g1[j + 1];
      const d = g1[j];
      // Where the walls have melted into the terrain (bank end) there's nothing to add
      if (a.gap < 0.004 && b.gap < 0.004 && c.gap < 0.004 && d.gap < 0.004) continue;
      for (const [p, q, r] of [
        [a, b, c],
        [a, c, d],
      ] as V[][]) {
        const ux = q.x - p.x;
        const uy = q.y - p.y;
        const uz = q.z - p.z;
        const vx = r.x - p.x;
        const vy = r.y - p.y;
        const vz = r.z - p.z;
        const nx = uy * vz - uz * vy;
        const ny = uz * vx - ux * vz;
        const nz = ux * vy - uy * vx;
        if (nx * nx + ny * ny + nz * nz < 1e-10) continue;
        const ok = nx * ex + ny * Math.hypot(ex, ez) * 0.5 + nz * ez >= 0;
        // Wound to face into the bowl (the frame may be mirrored)
        push(p);
        if (ok) {
          push(q);
          push(r);
        } else {
          push(r);
          push(q);
        }
      }
    }
  }
  return { pos, col, rimTop };
}

/** Steel coping along the rim where the wall is vert enough to have one. */
function buildCoping(
  rim: { x: number; y: number; z: number; inx: number; inz: number; w: number }[],
) {
  const geos: THREE.BufferGeometry[] = [];
  const r = 0.2;
  for (let i = 0; i < rim.length; i++) {
    const p = rim[i];
    const q = rim[(i + 1) % rim.length];
    if (p.w < 0.35 || q.w < 0.35) continue;
    if (Math.hypot(q.x - p.x, q.z - p.z) > 4) continue;
    const a = new THREE.Vector3(p.x + p.inx * 0.08, p.y - 0.12, p.z + p.inz * 0.08);
    const b = new THREE.Vector3(q.x + q.inx * 0.08, q.y - 0.12, q.z + q.inz * 0.08);
    const d = new THREE.Vector3().subVectors(b, a);
    const len = d.length();
    const g = new THREE.CylinderGeometry(r, r, len + 0.02, 6, 1, true);
    g.translate(0, len / 2, 0);
    g.applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()),
    );
    g.translate(a.x, a.y, a.z);
    geos.push(g);
  }
  return colourAll(geos, C.steel);
}

function colourAll(geos: THREE.BufferGeometry[], hex: number): THREE.BufferGeometry {
  _c.setHex(hex);
  for (const g of geos) {
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) arr.set([_c.r, _c.g, _c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  }
  const out = mergeGeometries(
    geos.map(g => (g.index !== null ? g.toNonIndexed() : g)),
    false,
  )!;
  for (const g of geos) g.dispose();
  return out;
}

/**
 * The concrete you see where the terrain itself is the surface (floor,
 * transitions, bank, the deck around the bank): the mountain mesher only
 * knows one flat concrete tint on a coarse grid, so the bowl gets its own
 * fine, smooth-shaded skin draped a hair above it (render only; the
 * terrain stays the collider). Skipped wherever the wall mesh is.
 */
function buildPool(f: BowlFrame, origin: THREE.Vector3, step: number): THREE.BufferGeometry {
  const st = stations(step);
  // Rows ≤ 4 m apart down the transitions: a chord across a concave curve
  // rides above it, and must stay under the floor paint (+0.1 m)
  const ds = [-BOWL.deckW, -14, -9, -5, -2.5, -1, 0, 0.6, 1.5, 3, 5, 7.5, 10.5, 14, 17.5, 21];
  for (let d = 24.5; d < BOWL.Rr; d += 3.5) ds.push(d);
  ds.push(BOWL.Rr);
  const nR = ds.length;
  const pos: number[] = [];
  const col: number[] = [];
  const gap: number[] = [];
  const cLip = new THREE.Color(C.deck);
  const cTop = new THREE.Color(C.concrete);
  const cFloor = new THREE.Color(0x9f9a90);
  for (const s of st) {
    const H = wallH(s.bc);
    for (const d of ds) {
      const b = s.b - s.nb * d;
      const a = s.a - s.na * d;
      const sm = bowlSurface(f, b + BOWL_GEO.U_B, a + BOWL_GEO.VC, f.P);
      bowlAxisToWorld(f, b, a, _o);
      pos.push(_o.x - origin.x, sm.t + 0.03 - origin.y, _o.z - origin.z);
      gap.push(sm.d - sm.t);
      if (d <= 0) _c.copy(cLip);
      else _c.copy(cTop).lerp(cFloor, Math.min(1, Math.max(0, (f.P - sm.t) / H)));
      col.push(_c.r, _c.g, _c.b);
    }
  }
  const idx: number[] = [];
  const N = st.length;
  for (let i = 0; i < N; i++) {
    const i1 = (i + 1) % N;
    for (let j = 0; j < nR - 1; j++) {
      const a = i * nR + j;
      const b = i * nR + j + 1;
      const c = i1 * nR + j + 1;
      const d = i1 * nR + j;
      if (gap[a] > 0.004 || gap[b] > 0.004 || gap[c] > 0.004 || gap[d] > 0.004) continue;
      pushUp(pos, idx, a, b, c);
      pushUp(pos, idx, a, c, d);
    }
  }
  return indexed(pos, col, idx);
}

/** Triangle p, q, r wound to face up. */
function pushUp(pos: number[], idx: number[], p: number, q: number, r: number) {
  const ux = pos[q * 3] - pos[p * 3];
  const uz = pos[q * 3 + 2] - pos[p * 3 + 2];
  const vx = pos[r * 3] - pos[p * 3];
  const vz = pos[r * 3 + 2] - pos[p * 3 + 2];
  if (uz * vx - ux * vz >= 0) idx.push(p, q, r);
  else idx.push(p, r, q);
}

function indexed(pos: number[], col: number[], idx: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g.toNonIndexed();
}

/** The roll-in's skin: concrete with a red racing line down the middle. */
function buildRollIn(f: BowlFrame, origin: THREE.Vector3): THREE.BufferGeometry {
  // Paired columns at the stripe's edges: a crisp line, not a smear
  const es = [-BOWL.half - 3, -BOWL.half, -0.55, -0.55, 0.55, 0.55, BOWL.half, BOWL.half + 3];
  const cols = [
    C.concreteDark,
    C.concrete,
    C.concrete,
    C.red,
    C.red,
    C.concrete,
    C.concrete,
    C.concreteDark,
  ];
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const u0 = BOWL.uM + 20;
  const u1 = BOWL_GEO.U_RIM - 1;
  const n = Math.ceil((u1 - u0) / 3);
  for (let i = 0; i <= n; i++) {
    const u = u0 + ((u1 - u0) * i) / n;
    const vc = chuteV(u);
    es.forEach((e, j) => {
      bowlToWorld(f, u, vc + e, _o);
      const y = terrainHeight(_o.x, _o.z) + 0.05;
      pos.push(_o.x - origin.x, y - origin.y, _o.z - origin.z);
      _c.setHex(cols[j]);
      col.push(_c.r, _c.g, _c.b);
    });
  }
  const m = es.length;
  for (let i = 0; i < n; i++)
    for (let j = 0; j < m - 1; j++) {
      const a = i * m + j;
      const b = (i + 1) * m + j;
      const c = (i + 1) * m + j + 1;
      const d = i * m + j + 1;
      pushUp(pos, idx, a, b, c);
      pushUp(pos, idx, a, c, d);
    }
  return indexed(pos, col, idx);
}

/**
 * Giant noggles painted on the floor (and a ring round the deep end),
 * draped over the terrain, offset up a touch (polygon offset does the rest).
 */
function buildDecals(f: BowlFrame, origin: THREE.Vector3): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  // `lift`: the lenses sit on the red frame, a few cm up so they never z-fight it
  const quad = (b0: number, b1: number, a0: number, a1: number, hex: number, lift = 0.1) => {
    _c.setHex(hex);
    const nb = Math.max(1, Math.ceil((b1 - b0) / 3));
    const na = Math.max(1, Math.ceil((a1 - a0) / 3));
    const P: { x: number; y: number; z: number }[][] = [];
    for (let i = 0; i <= nb; i++) {
      const row: { x: number; y: number; z: number }[] = [];
      for (let j = 0; j <= na; j++) {
        const b = b0 + ((b1 - b0) * i) / nb;
        const a = a0 + ((a1 - a0) * j) / na;
        bowlAxisToWorld(f, b, a, _o);
        const y = terrainHeight(_o.x, _o.z) + lift;
        row.push({ x: _o.x - origin.x, y: y - origin.y, z: _o.z - origin.z });
      }
      P.push(row);
    }
    for (let i = 0; i < nb; i++)
      for (let j = 0; j < na; j++) {
        const a = P[i][j];
        const b = P[i + 1][j];
        const c = P[i + 1][j + 1];
        const d = P[i][j + 1];
        for (const t of [
          [a, b, c],
          [a, c, d],
        ]) {
          // Face up whichever way the frame mirrors
          const ux = t[1].x - t[0].x;
          const uz = t[1].z - t[0].z;
          const vx = t[2].x - t[0].x;
          const vz = t[2].z - t[0].z;
          const up = uz * vx - ux * vz >= 0;
          const tri = up ? t : [t[0], t[2], t[1]];
          for (const v of tri) {
            pos.push(v.x, v.y, v.z);
            col.push(_c.r, _c.g, _c.b);
          }
        }
      }
  };
  // Noggles across the floor, read from the roll-in (b = along, a = across)
  const s = 1.7;
  const lens = (ac: number) => {
    quad(-9 * s, 9 * s, ac - 9 * s, ac + 9 * s, C.red);
    quad(-6 * s, 6 * s, ac - 6 * s, ac, C.white, 0.16);
    quad(-6 * s, 6 * s, ac, ac + 6 * s, C.black, 0.16);
  };
  lens(-10.5 * s);
  lens(10.5 * s);
  quad(-2 * s, 2 * s, -1.5 * s, 1.5 * s, C.red);
  // Temple arm toward the deep end
  quad(-9 * s, -5 * s, 19.5 * s, 24 * s, C.red);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** Four light towers on the deck corners + the sign posts. */
function buildProps(f: BowlFrame, origin: THREE.Vector3) {
  const geos: THREE.BufferGeometry[] = [];
  const lamps: THREE.BufferGeometry[] = [];
  const { A, Rr, deckW } = BOWL;
  const r = Rr + deckW - 4;
  for (const [b, a] of [
    [-A, r],
    [A, r],
    [-A, -r],
    [A, -r],
  ]) {
    bowlAxisToWorld(f, b, a, _o);
    const x = _o.x - origin.x;
    const z = _o.z - origin.z;
    const y = f.P - origin.y;
    const pole = new THREE.CylinderGeometry(0.35, 0.55, 30, 8).translate(x, y + 15, z);
    geos.push(pole);
    const head = new THREE.BoxGeometry(4.2, 1.4, 1.2);
    // Face the bowl
    bowlAxisToWorld(f, 0, 0, _o);
    const yaw = Math.atan2(_o.x - origin.x - x, _o.z - origin.z - z);
    head.rotateY(yaw).translate(x, y + 30.4, z);
    geos.push(head);
    const glow = new THREE.BoxGeometry(3.8, 1.0, 0.2);
    glow
      .translate(0, 0, 0.65)
      .rotateY(yaw)
      .translate(x, y + 30.4, z);
    lamps.push(glow);
  }
  // Sign posts at the slip road (beside the lane, before the roll-in)
  const u = BOWL.uM + 40;
  const vp = chuteV(u) + BOWL.half + 4;
  bowlToWorld(f, u, vp, _o);
  const sx = _o.x - origin.x;
  const sz = _o.z - origin.z;
  const sy = terrainHeight(_o.x, _o.z) - origin.y;
  const yaw = bowlYaw(f, -1, 0);
  for (const off of [-2.2, 2.2]) {
    const post = new THREE.BoxGeometry(0.25, 3.4, 0.25).translate(off, 1.7, 0);
    post.rotateY(yaw).translate(sx, sy, sz);
    geos.push(post);
  }
  return {
    props: colourAll(geos, C.pole),
    lamps: colourAll(lamps, C.lamp),
    sign: { pos: new THREE.Vector3(sx, sy + 2.6, sz), yaw },
  };
}

let signTex: THREE.CanvasTexture | null = null;

function signTexture(): THREE.CanvasTexture | null {
  if (signTex !== null) return signTex;
  if (typeof document === 'undefined') return null;
  const cv = document.createElement('canvas');
  cv.width = 512;
  cv.height = 160;
  const g = cv.getContext('2d');
  if (g === null) return null;
  g.fillStyle = '#c49a62';
  g.fillRect(0, 0, 512, 160);
  g.fillStyle = '#7a5530';
  for (let i = 0; i < 4; i++) g.fillRect(0, 38 + i * 40, 512, 3);
  g.fillStyle = '#d22209';
  g.font = '900 64px "Arial Black", Impact, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('NOGGLE BOWL', 256, 62);
  g.fillStyle = '#141414';
  g.font = '700 38px "Arial Black", Impact, sans-serif';
  g.fillText('→ DROP IN →', 256, 122);
  signTex = new THREE.CanvasTexture(cv);
  signTex.colorSpace = THREE.SRGBColorSpace;
  return signTex;
}

let mats: {
  walls: THREE.MeshStandardMaterial;
  decal: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  lamp: THREE.MeshBasicMaterial;
  skin: THREE.MeshStandardMaterial;
} | null = null;

function materials() {
  if (mats === null) {
    const walls = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
    walls.name = 'NoggleBowlWalls';
    const decal = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -30,
    });
    const skin = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    skin.name = 'NoggleBowlSkin';
    decal.name = 'NoggleBowlPaint';
    const steel = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4 });
    steel.name = 'NoggleBowlSteel';
    const lamp = new THREE.MeshBasicMaterial({ color: C.lamp });
    lamp.name = 'NoggleBowlLamp';
    mats = { walls, decal, steel, lamp, skin };
  }
  return mats;
}

/** Stats for the debug overlay / tests. */
export const bowlStats = { drawCalls: 0, triangles: 0, collisionTriangles: 0, ms: 0 };

function build(f: BowlFrame, origin: THREE.Vector3, ctx: ChunkContext): Built {
  const w = buildWalls(f, origin);
  const flat = new THREE.BufferGeometry();
  flat.setAttribute('position', new THREE.Float32BufferAttribute(w.pos, 3));
  flat.setAttribute('color', new THREE.Float32BufferAttribute(w.col, 3));
  // Shared vertices → smooth shading down the transitions (the colour
  // bands keep their own rows, so the tile line stays crisp)
  const walls = mergeVertices(flat, 1e-3);
  flat.dispose();
  walls.computeVertexNormals();
  const collision = new THREE.BufferGeometry();
  collision.setAttribute('position', new THREE.Float32BufferAttribute(w.pos, 3));
  const coping = buildCoping(w.rimTop);
  const rich = ctx.quality !== 'low';
  const decals = buildDecals(f, origin);
  // Render-only skin: coarser on phones (the collider is the same everywhere)
  const pool = mergeGeometries(
    [buildPool(f, origin, rich ? 2 : 3.5), buildRollIn(f, origin)],
    false,
  )!;
  const pr = rich ? buildProps(f, origin) : null;
  let tris =
    (w.pos.length + coping.attributes.position.count * 3 + decals.attributes.position.count * 3) /
      9 +
    pool.attributes.position.count / 3;
  if (pr !== null)
    tris += (pr.props.attributes.position.count + pr.lamps.attributes.position.count) / 3;
  return {
    walls,
    collision,
    coping,
    decals,
    pool,
    props: pr?.props ?? null,
    lamps: pr?.lamps ?? null,
    sign: pr?.sign ?? null,
    tris,
  };
}

export function noggleBowlDecorator(): ChunkDecorator {
  return {
    id: 'nogglebowl',
    populate(ctx: ChunkContext): ChunkDecoration | null {
      // Nowhere near 42 km out: don't grow the network to find out
      const cx = ctx.origin.x + ctx.size / 2;
      const cz = ctx.origin.z + ctx.size / 2;
      if (Math.abs(edgeDistance(cx, cz) - 42400) > 3000) return null;
      const f = bowlFrameNow();
      if (f === null) return null;
      const anchor = bowlAxisToWorld(f, 0, 0, { x: 0, z: 0 });
      if (
        anchor.x < ctx.origin.x ||
        anchor.x >= ctx.origin.x + ctx.size ||
        anchor.z < ctx.origin.z ||
        anchor.z >= ctx.origin.z + ctx.size
      )
        return null;
      const t0 = performance.now();
      const p = build(f, ctx.origin, ctx);
      const M = materials();
      const root = new THREE.Group();
      root.name = 'NoggleBowl';
      const disposables: { dispose(): void }[] = [p.walls, p.coping];
      const add = (g: THREE.BufferGeometry, m: THREE.Material, name: string, shadow: boolean) => {
        g.computeBoundingSphere();
        const mesh = new THREE.Mesh(g, m);
        mesh.name = name;
        mesh.castShadow = shadow;
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        root.add(mesh);
        return mesh;
      };
      add(p.walls, M.walls, 'NoggleBowlWalls', true);
      add(p.pool, M.skin, 'NoggleBowlSkin', false);
      disposables.push(p.pool);
      const coping = add(p.coping, M.steel, 'NoggleBowlCoping', false);
      let calls = 3;
      if (p.decals !== null) {
        add(p.decals, M.decal, 'NoggleBowlPaint', false);
        disposables.push(p.decals);
        calls++;
      }
      if (p.props !== null) {
        add(p.props, M.walls, 'NoggleBowlProps', true);
        disposables.push(p.props);
        calls++;
      }
      let lamps: THREE.Mesh | null = null;
      if (p.lamps !== null) {
        lamps = add(p.lamps, M.lamp, 'NoggleBowlLamps', false);
        disposables.push(p.lamps);
        calls++;
      }
      let signMat: THREE.MeshStandardMaterial | null = null;
      const tex = p.sign !== null ? signTexture() : null;
      if (p.sign !== null && tex !== null) {
        signMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
        const sg = new THREE.BoxGeometry(5.6, 1.75, 0.12);
        // The painted face (+Z box side) toward the line
        sg.rotateY(p.sign.yaw - Math.PI / 2).translate(p.sign.pos.x, p.sign.pos.y, p.sign.pos.z);
        add(sg, signMat, 'NoggleBowlSign', true);
        disposables.push(sg, signMat);
        calls++;
      }
      if (ctx.toon) toonify(root);
      // Thin / glowing bits stay out of the ink normals pass
      inkExcluded.add(coping);
      if (lamps !== null) inkExcluded.add(lamps);
      root.updateMatrixWorld(true);
      Object.assign(bowlStats, {
        drawCalls: calls,
        triangles: Math.round(p.tris),
        collisionTriangles: p.collision.attributes.position.count / 3,
        ms: performance.now() - t0,
      });
      const collision = p.collision;
      return {
        object: root,
        collision,
        dispose: () => {
          inkExcluded.delete(coping);
          if (lamps !== null) inkExcluded.delete(lamps);
          collision.dispose();
          for (const d of disposables) d.dispose();
        },
      };
    },
  };
}
