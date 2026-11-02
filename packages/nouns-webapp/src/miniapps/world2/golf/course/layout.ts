// ── Noun Golf: NOUN LINKS, the 19 holes (pure geometry) ──────────────────
//
// Holes are laid out in the course frame (site.ts: u along the contour, v
// outward/downhill) and turned into world shapes here. Heights are filled
// in afterwards by surface.ts (finalize), because tee and green levels are
// part of the surface itself.
//
//   v = −350 (uphill, the cut bank)
//       │  inner band   5 6 7 8   (range)   17 16 15 14
//       │  middle       4   9  CLUBHOUSE  18   13
//       │  outer band   3 2 1   19   10 11 12
//   v = +350 (downhill, the view)
//        u = 0 ………………… 1500 ………………… 3000
//
// The front nine loops the west half from the clubhouse and back, the back
// nine the east half; the 19th, THE NOGGLE, runs from beside the clubhouse
// down to a green shaped like the noggles, next to the 19th hole bar.

import type {
  Bunker,
  BuggySpot,
  Building,
  CourseLayout,
  Hole,
  Pond,
  Range,
  Ribbon,
  Shape,
  Tree,
  V2,
} from '../contract';

import { hashInts, vnoise } from '../../world/mountain/config';

import {
  polyAt,
  polyDist,
  polyLength,
  ribbonDist,
  shapeDist,
  shapeRadius,
  unionDist,
} from './shapes';
import { CORE, BOUNDS, SITE, courseBase, toCourse, toWorld, vYaw } from './site';

type UV = [number, number];

interface WaterDef {
  /** Where along the hole: metres from the tee (s) or back from the green (back). */
  s?: number;
  back?: number;
  /** −1 left, +1 right (of the line, looking down it), 0 on it. */
  side: -1 | 0 | 1;
  off: number;
  r: number;
  /** Stretch, and whether it runs along the line (else across it). */
  sx: number;
  along: boolean;
}

interface HoleDef {
  par: 3 | 4 | 5;
  name: string;
  hcp: number;
  pts: UV[];
  water?: WaterDef[];
  /** Green radius (m) and stretch; extra raise (m). */
  gr: number;
  gsx: number;
  raise?: number;
  /** Raised tee (m), for the par 3s that play down a hill. */
  teeRaise?: number;
  special?: 'island' | 'noggle';
  /** Fairway bunker sides: [first landing, second landing] (0 = none). */
  fb?: [number, number];
}

// prettier-ignore
const DEFS: HoleDef[] = [
  { par: 4, name: 'FIRST NOUN', hcp: 9, pts: [[1430, 205], [1040, 250]], gr: 15, gsx: 1.25, fb: [1, 0] },
  { par: 5, name: 'THE LONG WALK', hcp: 3, pts: [[1010, 290], [760, 282], [520, 250]], gr: 14, gsx: 1.3, fb: [-1, 1],
    water: [{ back: 38, side: -1, off: 26, r: 17, sx: 1.6, along: true }] },
  { par: 3, name: 'CLIFF TOP', hcp: 15, pts: [[490, 288], [335, 268]], gr: 14, gsx: 1.1, teeRaise: 2.2 },
  { par: 4, name: 'UP THE HILL', hcp: 5, pts: [[280, 298], [140, 190], [100, -20]], gr: 15, gsx: 1.2, fb: [1, 0],
    water: [{ s: 170, side: 1, off: 46, r: 20, sx: 1.4, along: false }] },
  { par: 4, name: 'TURNING BACK', hcp: 7, pts: [[60, -120], [150, -250], [420, -270]], gr: 14, gsx: 1.3, fb: [-1, 0] },
  { par: 3, name: 'SHORT STACK', hcp: 17, pts: [[450, -222], [620, -172]], gr: 13, gsx: 1.15 },
  { par: 5, name: 'THE LAKE', hcp: 1, pts: [[660, -262], [920, -272], [1180, -232]], gr: 15, gsx: 1.35, fb: [1, -1],
    water: [{ back: 150, side: 1, off: 42, r: 28, sx: 2.2, along: true }] },
  { par: 4, name: 'DOGLEG', hcp: 11, pts: [[1160, -140], [820, -60]], gr: 14, gsx: 1.2, fb: [-1, 0] },
  { par: 4, name: 'HOMEWARD', hcp: 13, pts: [[980, 50], [1400, 40]], gr: 15, gsx: 1.25, fb: [1, 0] },
  { par: 4, name: 'THE CREEK', hcp: 8, pts: [[1570, 205], [1960, 250]], gr: 15, gsx: 1.2, fb: [-1, 0],
    water: [{ back: 70, side: 0, off: 0, r: 9, sx: 4.2, along: false }] },
  { par: 5, name: 'GO FOR IT', hcp: 2, pts: [[1990, 290], [2240, 282], [2480, 250]], gr: 14, gsx: 1.3, fb: [1, 0],
    water: [{ back: 30, side: 0, off: 0, r: 13, sx: 2.3, along: false }] },
  { par: 3, name: 'THE EDGE', hcp: 16, pts: [[2510, 288], [2665, 268]], gr: 13, gsx: 1.2, teeRaise: 1.6 },
  { par: 4, name: 'SUMMIT', hcp: 4, pts: [[2720, 298], [2860, 190], [2900, -20]], gr: 15, gsx: 1.2, fb: [-1, 0],
    water: [{ s: 150, side: -1, off: 44, r: 19, sx: 1.5, along: true }] },
  { par: 4, name: 'BUNKER HILL', hcp: 10, pts: [[2940, -120], [2850, -250], [2580, -270]], gr: 14, gsx: 1.3, fb: [1, -1] },
  { par: 3, name: 'ISLAND', hcp: 12, pts: [[2550, -222], [2380, -172]], gr: 13, gsx: 1.1, special: 'island' },
  { par: 5, name: 'MOONSHOT', hcp: 6, pts: [[2340, -262], [2080, -272], [1820, -232]], gr: 15, gsx: 1.3, fb: [-1, 1],
    water: [{ s: 230, side: 1, off: 40, r: 24, sx: 1.8, along: true }] },
  { par: 4, name: 'THE GAP', hcp: 14, pts: [[1840, -140], [2180, -60]], gr: 14, gsx: 1.2, fb: [1, 0] },
  { par: 5, name: 'HOME STRAIGHT', hcp: 18, pts: [[2150, 50], [1850, 62], [1600, 40]], gr: 16, gsx: 1.3, fb: [-1, 0],
    water: [{ back: 95, side: -1, off: 34, r: 24, sx: 2.3, along: true }] },
  { par: 3, name: 'THE NOGGLE', hcp: 19, pts: [[1500, 112], [1500, 278]], gr: 0, gsx: 1, special: 'noggle',
    water: [{ back: 30, side: 0, off: 0, r: 11, sx: 2.6, along: false }] },
];

const W = { x: 0, z: 0 };
const C = { u: 0, v: 0 };
const AT = { x: 0, z: 0, yaw: 0 };

function uv(p: UV): V2 {
  toWorld(p[0], p[1], W);
  return { x: W.x, z: W.z };
}

const rnd = (n: number, salt: number) => hashInts(n, salt, 0x6f1f);
const sgn = (n: number, salt: number) => (rnd(n, salt) < 0.5 ? -1 : 1);

function blob(
  x: number,
  z: number,
  r: number,
  sx: number,
  yawAlong: number,
  n: number,
  salt: number,
): Shape {
  const w = (q: number) => (rnd(n, salt + q) - 0.5) * 0.18;
  return {
    kind: 'blob',
    x,
    z,
    r,
    sx,
    rot: yawAlong - Math.PI / 2,
    k: [w(1), w(2), w(3) * 0.6, w(4) * 0.6],
  };
}

/** Offset (x, z) by `along` m along yaw and `side` m to its right. */
function off(x: number, z: number, yaw: number, along: number, side: number): V2 {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  return { x: x + fx * along + fz * side, z: z + fz * along - fx * side };
}

function buildHole(d: HoleDef, n: number): Hole {
  const line = d.pts.map(uv);
  const length = polyLength(line);
  const teeYaw = Math.atan2(line[1].x - line[0].x, line[1].z - line[0].z);
  const last = line.length - 1;
  const aYaw = Math.atan2(line[last].x - line[last - 1].x, line[last].z - line[last - 1].z);
  const g = line[last];

  const tc = off(line[0].x, line[0].z, teeYaw, -2, 0);
  const tee: Shape & { kind: 'rect' } = {
    kind: 'rect',
    x: tc.x,
    z: tc.z,
    hw: d.par === 3 ? 5.5 : 6.5,
    hl: d.par === 3 ? 7 : 10,
    yaw: teeYaw,
    round: 1.6,
  };

  // Green
  let green: Shape[];
  let gcx = g.x;
  let gcz = g.z;
  let R = d.gr;
  let pin: V2;
  if (d.special === 'noggle') {
    // Two square lenses side by side across the approach, a bridge between
    const L1 = off(g.x, g.z, aYaw, 0, -9.5);
    const L2 = off(g.x, g.z, aYaw, 0, 9.5);
    const arm = off(g.x, g.z, aYaw, 0, -20);
    green = [
      { kind: 'rect', x: L1.x, z: L1.z, hw: 7, hl: 7, yaw: aYaw, round: 1.4 },
      { kind: 'rect', x: L2.x, z: L2.z, hw: 7, hl: 7, yaw: aYaw, round: 1.4 },
      { kind: 'rect', x: g.x, z: g.z, hw: 3.2, hl: 1.8, yaw: aYaw, round: 0.6 },
      { kind: 'rect', x: arm.x, z: arm.z, hw: 4.5, hl: 1.8, yaw: aYaw, round: 0.6 },
    ];
    R = 16;
    pin = off(L2.x, L2.z, aYaw, 1.5, 1.5);
  } else {
    green = [blob(g.x, g.z, d.gr, d.gsx, aYaw, n, 10)];
    const pa = (rnd(n, 20) - 0.5) * 0.8 * d.gr * d.gsx;
    const ps = (rnd(n, 21) - 0.5) * 0.8 * d.gr;
    pin = off(g.x, g.z, aYaw, pa, ps);
    gcx = g.x;
    gcz = g.z;
  }

  // Water first (the island green's level depends on it)
  const water: Pond[] = [];
  for (const [i, w] of (d.water ?? []).entries()) {
    const s = w.s !== undefined ? w.s : length - (w.back ?? 0);
    polyAt(line, s, AT);
    const p = off(AT.x, AT.z, AT.yaw, 0, w.side * w.off);
    const yaw = w.along ? AT.yaw : AT.yaw + Math.PI / 2;
    water.push({ shapes: [blob(p.x, p.z, w.r, w.sx, yaw, n, 40 + i * 7)], level: 0 });
  }
  if (d.special === 'island') {
    water.push({ shapes: [blob(g.x, g.z, d.gr + 23, 1.15, aYaw, n, 90)], level: 0 });
  }

  // Green plane: rises away from the tee ~2 %, a seeded lean across
  const lean = (rnd(n, 30) - 0.5) * 0.026;
  const back = 0.016 + rnd(n, 31) * 0.012;
  const fx = Math.sin(aYaw);
  const fz = Math.cos(aYaw);
  toCourse(gcx, gcz, C);
  const raise = d.raise ?? 0.45 + rnd(n, 32) * 0.5;
  const greenPlane = {
    cx: gcx,
    cz: gcz,
    y0: courseBase(gcx, gcz, C.v) + raise,
    gx: fx * back + fz * lean,
    gz: fz * back - fx * lean,
  };

  // Fairway
  let fairway: Ribbon | null = null;
  const sEnd = length - R * 0.85;
  const s0 = d.par === 3 ? length - R - 38 : Math.max(85, length * (d.par === 5 ? 0.2 : 0.28));
  if (sEnd > s0 + 10) {
    const pts: V2[] = [];
    const half: number[] = [];
    const steps = Math.max(2, Math.ceil((sEnd - s0) / 14));
    const base = d.par === 3 ? 9 : d.par === 5 ? 18 : 17;
    for (let i = 0; i <= steps; i++) {
      const s = s0 + ((sEnd - s0) * i) / steps;
      polyAt(line, s, AT);
      pts.push({ x: AT.x, z: AT.z });
      const taper = d.par === 3 ? 1 : 1 - 0.38 * Math.max(0, Math.min(1, (s - (sEnd - 50)) / 50));
      const start = Math.min(1, 0.6 + (s - s0) / 40);
      half.push(base * taper * start + 2.4 * vnoise(s / 45, n * 3.1, 0x6f2f));
    }
    fairway = { pts, half };
  }

  // Bunkers: fairway (driver landing, par 5 second landing), greenside
  const bunkers: Bunker[] = [];
  const fb = d.fb ?? [0, 0];
  const landings = [Math.min(238, length - 120), length - 105];
  fb.forEach((side, i) => {
    if (side === 0 || fairway === null) return;
    const s = landings[i];
    if (s < s0 + 10 || s > sEnd - 20) return;
    polyAt(line, s, AT);
    const hf = ribbonHalfAt(fairway, AT.x, AT.z);
    const p = off(AT.x, AT.z, AT.yaw, 0, side * (hf + 4));
    bunkers.push({ shape: blob(p.x, p.z, 6.5, 1.9, AT.yaw, n, 60 + i), depth: 0.75 });
  });
  const gb = d.par === 3 ? 3 : 2;
  const gSide = sgn(n, 70);
  for (let i = 0; i < gb; i++) {
    const ang = (i === 0 ? 1 : i === 1 ? -1 : 0) * gSide * (0.95 + rnd(n, 71 + i) * 0.5);
    const yaw = aYaw + Math.PI + ang;
    const dist = R * (d.special === 'noggle' ? 1.35 : d.gsx * 0.95) + 5;
    if (d.special === 'island') continue;
    // Round the green's edge, never into it
    let p = off(g.x, g.z, yaw, dist, 0);
    for (let k = 0; k < 20 && unionDist(green, p.x, p.z) < 5.5 * 1.7 + 3; k++)
      p = off(p.x, p.z, yaw, 1, 0);
    if (i === 2) {
      // Behind
      let q = off(g.x, g.z, aYaw, R * d.gsx + 5, 0);
      for (let k = 0; k < 20 && unionDist(green, q.x, q.z) < 5.5 * 1.8 + 3; k++)
        q = off(q.x, q.z, aYaw, 1, 0);
      bunkers.push({ shape: blob(q.x, q.z, 5.5, 1.8, aYaw + Math.PI / 2, n, 80 + i), depth: 0.8 });
      continue;
    }
    bunkers.push({ shape: blob(p.x, p.z, 5.5, 1.7, yaw + Math.PI / 2, n, 80 + i), depth: 0.85 });
  }

  // A bunker never shares a bank with a pond (its floor would sit under the water)
  const dry = bunkers.filter(b =>
    water.every(w => unionDist(w.shapes, b.shape.x, b.shape.z) > shapeRadius(b.shape) + 4),
  );

  // Pin height and tee spot height are filled in by finalize()
  return {
    n,
    par: d.par,
    name: d.name,
    hcp: d.hcp,
    tee,
    teeSpot: { x: line[0].x, y: 0, z: line[0].z },
    line,
    length,
    fairway,
    green,
    pin: { x: pin.x, y: 0, z: pin.z },
    greenPlane,
    bunkers: dry,
    water,
    roughHalf: 22,
  };
}

function ribbonHalfAt(r: Ribbon, x: number, z: number): number {
  let best = Infinity;
  let h = r.half[0];
  r.pts.forEach((p, i) => {
    const d = Math.hypot(p.x - x, p.z - z);
    if (d < best) {
      best = d;
      h = r.half[i];
    }
  });
  return h;
}

/** Extra settings the surface needs per hole (tee raise, specials). */
export interface HoleExtra {
  teeRaise: number;
  special?: 'island' | 'noggle';
}

export interface LayoutBuild {
  layout: CourseLayout;
  extra: HoleExtra[];
  /** Pads under buildings (flattened), clubhouse first. */
}

function rect(
  u: number,
  v: number,
  hw: number,
  hl: number,
  yaw: number,
  round = 2,
): Shape & { kind: 'rect' } {
  toWorld(u, v, W);
  return { kind: 'rect', x: W.x, z: W.z, hw, hl, yaw, round };
}

export function buildLayout(): LayoutBuild {
  const holes = DEFS.map((d, i) => buildHole(d, i + 1));
  const extra = DEFS.map(d => ({ teeRaise: d.teeRaise ?? 0.5, special: d.special }));
  const yOut = vYaw(1500);
  const yIn = yOut + Math.PI;

  // Clubhouse pad, the putting green, the range
  const pads: { shape: Shape; y: number }[] = [];
  const clubPad = rect(1500, -16, 58, 31, yOut, 6);
  pads.push({ shape: clubPad, y: 0 });
  const rangeTee = rect(1500, -82, 46, 6, yIn, 2);
  pads.push({ shape: rangeTee, y: 0 });
  toWorld(1500, 46, W);
  const puttingGreen: Shape = blob(W.x, W.z, 12, 1.55, yOut + Math.PI / 2, 99, 1);

  const B = (
    id: Building['id'],
    u: number,
    v: number,
    hw: number,
    hl: number,
    h: number,
    yaw: number,
    label: string,
    pad: boolean,
  ): Building => {
    toWorld(u, v, W);
    if (pad)
      pads.push({
        shape: { kind: 'rect', x: W.x, z: W.z, hw: hw + 4, hl: hl + 4, yaw, round: 2 },
        y: 0,
      });
    return { id, x: W.x, z: W.z, yaw, hw, hl, h, y: 0, label };
  };
  const buildings: Building[] = [
    B('clubhouse', 1500, -27, 19, 11, 9, yOut, 'NOUN LINKS CLUBHOUSE', false),
    B('proshop', 1461, -8, 8, 6, 5, yOut, 'PRO SHOP', false),
    B('starter', 1452, 188, 2.2, 2.2, 3.2, yOut, 'STARTER', true),
    B('bar19', 1552, 306, 9, 6.5, 5.5, yIn, 'THE 19TH HOLE', true),
    B('rangehut', 1442, -84, 5, 4, 4, yIn, 'DRIVING RANGE', false),
    B('barn', 1540, -6, 7, 5, 4.5, yOut, 'BUGGIES', false),
  ];

  const bays = [];
  for (let i = 0; i < 9; i++) {
    toWorld(1460 + i * 10, -84, W);
    bays.push({ x: W.x, y: 0, z: W.z });
  }
  const targets = [50, 100, 150, 200, 250].map((dist, i) => {
    toWorld(1500 + (i % 2 === 0 ? -14 : 16), -84 - dist, W);
    return { x: W.x, z: W.z, y: 0, r: 5 + i * 1.6, dist };
  });
  const range: Range = {
    tee: rangeTee,
    bays,
    yaw: yIn,
    targets,
    area: rect(1500, -215, 52, 128, yIn, 4),
  };

  // Buggies: a row at the barn, and one by the tee of every third hole
  const buggies: BuggySpot[] = [];
  for (let i = 0; i < 6; i++) {
    toWorld(1527 + i * 4.2, 8, W);
    buggies.push({ x: W.x, y: 0, z: W.z, yaw: yOut });
  }
  for (const h of holes) {
    if (h.n % 3 !== 1) continue;
    const p = off(h.tee.x, h.tee.z, h.tee.yaw, -4, h.tee.hw + 7);
    buggies.push({ x: p.x, y: 0, z: p.z, yaw: h.tee.yaw });
  }

  const paths = buildPaths(holes, clubPad);
  const trees = buildTrees(holes, pads, puttingGreen, range, paths, buildings);

  toWorld(1446, 178, W);
  const spawnYaw = holes[0].tee.yaw;
  const layout: CourseLayout = {
    id: 'noun-links',
    name: 'NOUN LINKS',
    holes,
    par: holes.reduce((a, h) => a + h.par, 0),
    buildings,
    pads,
    puttingGreen,
    range,
    buggies,
    paths,
    trees,
    spawn: { x: W.x, y: 0, z: W.z, yaw: spawnYaw },
    core: CORE,
    bounds: BOUNDS,
  };
  return { layout, extra };
}

// ── Cart paths ──────────────────────────────────────────────────────────

const PATH_HALF = 1.3;

function offsetLine(line: V2[], side: number, dist: number): V2[] {
  return line.map((p, i) => {
    const a = line[Math.max(0, i - 1)];
    const b = line[Math.min(line.length - 1, i + 1)];
    const yaw = Math.atan2(b.x - a.x, b.z - a.z);
    return off(p.x, p.z, yaw, 0, side * dist);
  });
}

function resample(pts: V2[], step: number): V2[] {
  const L = polyLength(pts);
  const n = Math.max(1, Math.ceil(L / step));
  const out: V2[] = [];
  for (let i = 0; i <= n; i++) {
    polyAt(pts, (L * i) / n, AT);
    out.push({ x: AT.x, z: AT.z });
  }
  return out;
}

function inPlay(holes: Hole[], x: number, z: number, skip: number): boolean {
  for (const h of holes) {
    if (h.n === skip) continue;
    if (unionDist(h.green, x, z) < 4) return true;
    if (h.fairway && ribbonDist(h.fairway, x, z) < 1) return true;
    if (shapeDist(h.tee, x, z) < 2) return true;
  }
  return false;
}

function buildPaths(holes: Hole[], clubPad: Shape): Ribbon[] {
  const out: Ribbon[] = [];
  const legs: V2[][] = [];
  for (let i = 0; i < holes.length; i++) {
    const h = holes[i];
    let best: V2[] | null = null;
    let bestBad = Infinity;
    for (const side of [1, -1]) {
      const along = offsetLine(h.line, side, 33);
      const start = off(h.tee.x, h.tee.z, h.tee.yaw, -2, side * (h.tee.hw + 4));
      const gEnd = h.line[h.line.length - 1];
      const aYaw = Math.atan2(
        gEnd.x - h.line[h.line.length - 2].x,
        gEnd.z - h.line[h.line.length - 2].z,
      );
      const end = off(gEnd.x, gEnd.z, aYaw, 6, side * 30);
      const pts = resample([start, ...along.slice(1, -1), end], 12);
      let bad = 0;
      for (const p of pts)
        if (inPlay(holes, p.x, p.z, h.n) || unionDist(h.green, p.x, p.z) < 6) bad++;
      if (bad < bestBad) {
        bestBad = bad;
        best = pts;
      }
    }
    legs.push(best!);
  }
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    const next = legs[i + 1];
    // Joins the green end to the next tee (not after 9 / 18 / 19: they go home)
    const joined =
      next !== undefined && i !== 8 && i !== 17
        ? [...leg, ...resample([leg[leg.length - 1], next[0]], 12).slice(1)]
        : leg;
    out.push({ pts: joined, half: joined.map(() => PATH_HALF) });
  }
  // Home: the clubhouse pad to the 1st, 10th and 19th tees; the 9th, 18th greens back
  const home = { x: clubPad.x, z: clubPad.z };
  for (const k of [0, 9, 18, 8, 17]) {
    const leg = legs[k];
    const p = k === 8 || k === 17 ? leg[leg.length - 1] : leg[0];
    const pts = resample([home, p], 12);
    out.push({ pts, half: pts.map(() => PATH_HALF) });
  }
  return out;
}

// ── Trees ───────────────────────────────────────────────────────────────

function buildTrees(
  holes: Hole[],
  pads: { shape: Shape; y: number }[],
  pg: Shape,
  range: Range,
  paths: Ribbon[],
  buildings: Building[],
): Tree[] {
  const trees: Tree[] = [];
  const clearOf = (x: number, z: number, r: number): boolean => {
    toCourse(x, z, C);
    if (C.u < SITE.U0 + 8 || C.u > SITE.U1 - 8 || C.v < SITE.V0 + 8 || C.v > SITE.V1 - 8)
      return false;
    for (const h of holes) {
      const fw = h.fairway ? ribbonDist(h.fairway, x, z) : Infinity;
      if (fw < 9 + r) return false;
      if (polyDist(h.line, x, z) < (h.par === 3 ? 20 : 24) + r) return false;
      if (unionDist(h.green, x, z) < 16 + r) return false;
      if (shapeDist(h.tee, x, z) < 9 + r) return false;
      for (const b of h.bunkers) if (shapeDist(b.shape, x, z) < 4 + r) return false;
      for (const w of h.water) if (unionDist(w.shapes, x, z) < 3 + r) return false;
    }
    for (const p of pads) if (shapeDist(p.shape, x, z) < 6 + r) return false;
    if (shapeDist(pg, x, z) < 8 + r) return false;
    if (shapeDist(range.area, x, z) < 6 + r) return false;
    if (shapeDist(range.tee, x, z) < 8 + r) return false;
    for (const b of buildings)
      if (Math.hypot(b.x - x, b.z - z) < Math.hypot(b.hw, b.hl) + 8 + r) return false;
    for (const p of paths) if (ribbonDist(p, x, z) < 2.5 + r) return false;
    for (const t of trees) {
      const m = t.r + r;
      if ((t.x - x) ** 2 + (t.z - z) ** 2 < m * m * 0.7) return false;
    }
    return true;
  };
  const add = (x: number, z: number, seed: number) => {
    const big = rnd(seed, 1);
    const kind = (big < 0.55 ? 0 : big < 0.93 ? 1 : 2) as Tree['kind'];
    const r = kind === 0 ? 3 + rnd(seed, 2) * 1.6 : kind === 1 ? 4 + rnd(seed, 2) * 2.4 : 2.6;
    if (!clearOf(x, z, r)) return;
    const h1 =
      kind === 0 ? 11 + rnd(seed, 3) * 8 : kind === 1 ? 8 + rnd(seed, 3) * 5 : 9 + rnd(seed, 3) * 4;
    const h0 = kind === 0 ? 1.4 : kind === 1 ? 2.4 : h1 - 3;
    trees.push({
      x,
      z,
      trunk: kind === 2 ? 0.25 : 0.35 + rnd(seed, 4) * 0.15,
      r,
      h0,
      h1,
      kind,
      y: 0,
    });
  };
  // Lines of trees down both sides of every hole
  for (const h of holes) {
    const L = h.length;
    for (let s = -10, k = 0; s < L + 25; s += 11, k++) {
      polyAt(h.line, Math.max(0, Math.min(L, s)), AT);
      for (const side of [-1, 1]) {
        for (let row = 0; row < 3; row++) {
          const seed = h.n * 10007 + k * 31 + (side + 1) * 7 + row * 1009;
          if (rnd(seed, 9) < 0.35 + row * 0.12) continue;
          const lat = 30 + row * 11 + rnd(seed, 5) * 8;
          const p = off(AT.x, AT.z, AT.yaw, (rnd(seed, 6) - 0.5) * 8, side * lat);
          add(p.x, p.z, seed);
        }
      }
    }
  }
  // Scattered woods over the rest of the property
  for (let u = SITE.U0 + 20; u < SITE.U1 - 20; u += 23) {
    for (let v = SITE.V0 + 20; v < SITE.V1 - 20; v += 23) {
      const seed = (u * 977 + v * 131) | 0;
      if (rnd(seed, 11) < 0.5) continue;
      toWorld(u + (rnd(seed, 12) - 0.5) * 18, v + (rnd(seed, 13) - 0.5) * 18, W);
      add(W.x, W.z, seed);
    }
  }
  return trees;
}

export { shapeRadius };
