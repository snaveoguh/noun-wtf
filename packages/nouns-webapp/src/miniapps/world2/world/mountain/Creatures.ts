// ── Wild things: procedural creatures ───────────────────────────────────
//
// One seed → one critter. The seed picks a body plan (quadruped, biped,
// long-neck, blob, multi-leg crawler, bird), proportions, a two/three-tone
// palette + coat pattern (stripes, spots, patches, checker, bands, belly,
// gradient — painted voxel cell by voxel cell on the body), and the bits:
// 1–5 eyes (googly, on stalks, or a pair of noggles ⌐◨-◨), ears, horns,
// antennae, snouts, buck teeth, back spikes, tails. Plus a seeded name
// ("Wobbly Grumplet").
//
// Each creature is four rigid parts so the wild layer can animate it with
// plain instance matrices (BatchedMesh, one draw call per chunk):
//   body  — origin on the ground under the creature, facing +Z
//   head  — origin at the neck joint (yaw toward riders, pitch to graze)
//   limbs — two sets swung in antiphase: legs (diagonal pairs / left-right /
//           tripods, origin on the hip line, sheared to walk) or wings /
//           arms (origin at each shoulder, rotated to flap)
// Sizes are metres with the creature's scale already baked in.

import * as THREE from 'three';

import { Rand, fbm, hash3i } from './dressingUtil';
import { GeoBuilder, hex, hsl, type ColorFn, type Paint } from './wildGeo';

export type BodyPlan = 'quad' | 'biped' | 'longneck' | 'blob' | 'crawler' | 'bird';
export type Gait = 'walk' | 'waddle' | 'hop' | 'scuttle';

export interface CreatureDef {
  seed: number;
  plan: BodyPlan;
  name: string;
  scale: number;
  body: THREE.BufferGeometry;
  head: THREE.BufferGeometry;
  /** Limb sets A / B (null = none). */
  limbs: [THREE.BufferGeometry | null, THREE.BufferGeometry | null];
  limbKind: 'leg' | 'wing';
  /** Limb pivots in body space (legs: both on the hip line). */
  pivots: [THREE.Vector3, THREE.Vector3];
  neck: THREE.Vector3;
  legLen: number;
  /** Ground → top of the head (name tag height). */
  top: number;
  gait: Gait;
  /** Stroll / scarper speeds (m/s). */
  walk: number;
  run: number;
  /** Head down to nibble the grass now and then. */
  grazes: boolean;
}

const BONE = hex(0xf2e6c8);
const WHITE = hex(0xffffff);
const INK = hex(0x14121c);
const CREAM = hex(0xfff4e0);
const NOGGLE = [0xd32a2a, 0x2a6bd3, 0x25a24a, 0xf2a20c, 0xe04fb4].map(hex);

const PLANS: [BodyPlan, number][] = [
  ['quad', 0.27],
  ['biped', 0.16],
  ['longneck', 0.12],
  ['blob', 0.15],
  ['crawler', 0.13],
  ['bird', 0.17],
];

const ADJ = [
  'Wobbly',
  'Grumpy',
  'Lesser',
  'Greater',
  'Spotted',
  'Fuzzy',
  'Sleepy',
  'Bonkers',
  'Crumbly',
  'Squishy',
  'Noble',
  'Dusty',
  'Soggy',
  'Tiny',
  'Mega',
  'Shy',
  'Sneaky',
  'Lumpy',
  'Fancy',
  'Bald',
  'Dizzy',
  'Jolly',
  'Moody',
  'Feral',
  'Cheeky',
  'Nervous',
  'Royal',
  'Wonky',
  'Speckled',
  'Lesser-Spotted',
  'Haunted',
  'Damp',
];
const START = [
  'grum',
  'snor',
  'wib',
  'bob',
  'zon',
  'muff',
  'glo',
  'quib',
  'dorp',
  'blib',
  'skro',
  'worb',
  'flum',
  'gub',
  'plon',
  'snik',
  'marp',
  'yom',
  'tib',
  'krul',
  'nou',
  'fizz',
  'wum',
  'slup',
];
const MID = ['', '', '', 'ble', 'a', 'o', 'er', 'i', 'dle', 'ster'];
const END: Record<BodyPlan, string[]> = {
  quad: ['plet', 'oo', 'ox', 'hog', 'moose', 'pup', 'kin', 'wump', 'yak', 'lope'],
  longneck: ['raffe', 'neck', 'loom', 'stalk', 'pole', 'tower', 'saur'],
  biped: ['ling', 'bert', 'oid', 'gob', 'plod', 'stomp', 'roo'],
  blob: ['blob', 'goo', 'dump', 'ooze', 'lump', 'wobble', 'jelly'],
  crawler: ['pede', 'crawl', 'skit', 'worm', 'legs', 'bug', 'scuttle'],
  bird: ['wing', 'beak', 'tweet', 'hawk', 'goose', 'flap', 'dodo'],
};

const pick = <T>(r: Rand, list: T[]): T => list[Math.floor(r.next() * list.length) % list.length];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function pickPlan(r: Rand): BodyPlan {
  let t = r.next();
  for (const [p, w] of PLANS) {
    if (t < w) return p;
    t -= w;
  }
  return 'quad';
}

/** Seeded two-word name: adjective + syllables with a body-plan ending. */
export function creatureName(seed: number, plan: BodyPlan, noggles: boolean): string {
  const r = new Rand(seed ^ 0x51ed);
  const adj = noggles && r.next() < 0.6 ? 'Noggled' : pick(r, ADJ);
  const word = pick(r, START) + pick(r, MID) + pick(r, END[plan]);
  return `${adj} ${cap(word)}`;
}

interface Palette {
  base: THREE.Color;
  second: THREE.Color;
  belly: THREE.Color;
  dark: THREE.Color;
  accent: THREE.Color;
}

function palette(r: Rand): Palette {
  const h0 = r.next();
  const scheme = r.next();
  const h1 =
    scheme < 0.4
      ? h0 + 0.5 + r.range(-0.08, 0.08)
      : scheme < 0.75
        ? h0 + r.range(0.08, 0.22) * (r.next() < 0.5 ? -1 : 1)
        : h0 + 0.33;
  const base = hsl(h0, r.range(0.45, 0.9), r.range(0.42, 0.64));
  return {
    base,
    second: hsl(h1, r.range(0.5, 0.95), r.range(0.3, 0.72)),
    belly: base.clone().lerp(CREAM, r.range(0.4, 0.7)),
    dark: hsl(h0, 0.3, r.range(0.08, 0.16)),
    accent: hsl(r.next(), 0.9, r.range(0.5, 0.62)),
  };
}

type PatternKind =
  | 'plain'
  | 'stripes'
  | 'bands'
  | 'spots'
  | 'patches'
  | 'checker'
  | 'gradient'
  | 'belly';
const PATTERNS: PatternKind[] = [
  'plain',
  'stripes',
  'bands',
  'spots',
  'spots',
  'patches',
  'patches',
  'checker',
  'gradient',
  'belly',
];

/** Coat painter in body space (y from the ground). */
function coat(r: Rand, pal: Palette, kind: PatternKind, y0: number, y1: number, seed: number) {
  const w = r.range(0.14, 0.3);
  const dens = r.range(0.18, 0.4);
  const bellyToo = kind !== 'belly' && r.next() < 0.45;
  const yb = y0 + (y1 - y0) * r.range(0.25, 0.4);
  const out = new THREE.Color();
  const fn: ColorFn = (x, y, z) => {
    let c = pal.base;
    switch (kind) {
      case 'stripes':
        if (Math.floor(z / w + 100) % 2 === 0) c = pal.second;
        break;
      case 'bands':
        if (Math.floor((y - y0) / w + 100) % 2 === 0) c = pal.second;
        break;
      case 'spots':
        if (hash3i(Math.floor(x / 0.16), Math.floor(y / 0.16), Math.floor(z / 0.16), seed) < dens)
          c = pal.second;
        break;
      case 'patches':
        if (fbm(x + y * 1.7, z - y * 0.9, 0.45, seed) > 0.08) c = pal.second;
        break;
      case 'checker':
        if ((Math.floor(x / w + 100) + Math.floor(y / w + 100) + Math.floor(z / w + 100)) % 2 === 0)
          c = pal.second;
        break;
      case 'gradient':
        return out.copy(pal.base).lerp(pal.second, Math.min(1, Math.max(0, (y - y0) / (y1 - y0))));
      case 'belly':
        break;
    }
    if ((kind === 'belly' || bellyToo) && y < yb) c = pal.belly;
    return out.copy(c);
  };
  return fn;
}

// ── Heads ───────────────────────────────────────────────────────────────

interface HeadOpts {
  /** Head box centre relative to the neck pivot. */
  cx: number;
  cy: number;
  cz: number;
  w: number;
  h: number;
  d: number;
  snout: boolean;
  stalks: boolean;
  beak: boolean;
}

function buildHead(
  b: GeoBuilder,
  r: Rand,
  pal: Palette,
  o: HeadOpts,
  paint: Paint,
  noggles: boolean,
) {
  const { cx, cy, cz, w, h, d } = o;
  b.box(cx, cy, cz, w, h, d, paint, Math.min(w, h, d) / 3);
  const front = cz + d / 2;
  // Snout / beak + nose / mouth
  let mouthZ = front;
  if (o.beak) {
    const bl = d * r.range(0.4, 0.9);
    b.box(cx, cy - h * 0.1, front + bl / 2, w * 0.32, h * 0.22, bl, pal.accent);
    b.box(
      cx,
      cy - h * 0.25,
      front + bl * 0.35,
      w * 0.28,
      h * 0.12,
      bl * 0.7,
      pal.accent.clone().multiplyScalar(0.75),
    );
  } else if (o.snout) {
    const sl = d * r.range(0.25, 0.6);
    const sw = w * r.range(0.45, 0.75);
    const sh = h * r.range(0.35, 0.5);
    const sy = cy - h / 2 + sh / 2 + h * 0.05;
    b.box(cx, sy, front + sl / 2, sw, sh, sl, pal.belly);
    b.box(cx, sy + sh * 0.2, front + sl + 0.01, sw * 0.45, sh * 0.3, 0.04, pal.dark);
    mouthZ = front + sl;
    b.box(cx, sy - sh * 0.3, mouthZ + 0.005, sw * 0.7, Math.max(0.025, sh * 0.08), 0.03, INK);
  } else {
    const mw = w * r.range(0.3, 0.7);
    b.box(cx, cy - h * 0.28, front + 0.01, mw, Math.max(0.03, h * 0.08), 0.03, INK);
    if (r.next() < 0.35) {
      // Buck teeth
      const tw = Math.max(0.035, w * 0.09);
      b.box(cx - tw * 0.6, cy - h * 0.28 - tw * 0.6, front + 0.02, tw, tw * 1.2, 0.03, WHITE);
      b.box(cx + tw * 0.6, cy - h * 0.28 - tw * 0.6, front + 0.02, tw, tw * 1.2, 0.03, WHITE);
    }
  }
  // Eyes (or noggles)
  if (noggles) {
    const L = Math.min(w * 0.36, h * 0.5);
    const frame = pick(r, NOGGLE);
    const t = L * 0.16;
    const ez = front + 0.04;
    const ey = cy + h * 0.12;
    for (const s of [-1, 1]) {
      const lx = cx + s * (L * 0.62);
      b.box(lx, ey, ez, L, L, 0.05, frame);
      b.box(lx - L * 0.17, ey, ez + 0.03, L * 0.34 - t * 0.5, L - t * 2, 0.04, WHITE);
      b.box(lx + L * 0.17, ey, ez + 0.03, L * 0.34 - t * 0.5, L - t * 2, 0.04, INK);
    }
    // Bridge + the ⌐ arm round the side
    b.box(cx, ey + L * 0.15, ez, L * 0.26, t, 0.05, frame);
    b.box(cx - L * 1.2, ey + L * 0.15, ez - 0.02, L * 0.3, t, 0.05, frame);
    b.box(cx - w / 2 - 0.02, ey + L * 0.15, cz + d * 0.1, t, t, d * 0.75, frame);
  } else {
    const n = pick(r, [1, 2, 2, 2, 2, 2, 3, 3, 4, 5]);
    const es = Math.min(w, h) * r.range(0.2, 0.34) * (n >= 4 ? 0.75 : 1);
    const spread = Math.min(w * 0.82, es * 1.35 * n);
    const googly = r.next() < 0.4;
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1) - 0.5;
      const ex = cx + t * spread;
      let ey = cy + h * (0.12 + (n >= 3 && i % 2 === 1 ? 0.18 : 0));
      let ez = front - es * 0.15;
      if (o.stalks) {
        // Eye stalks out of the top of the head
        const sh = h * r.range(0.4, 0.9);
        b.box(ex, cy + h / 2 + sh / 2, cz + d * 0.15, es * 0.22, sh, es * 0.22, pal.base);
        ey = cy + h / 2 + sh + es * 0.4;
        ez = cz + d * 0.15;
      }
      const ew = googly ? es * 1.2 : es;
      b.box(ex, ey, ez, ew, ew, es * 0.6, WHITE);
      const px = googly ? (r.next() - 0.5) * ew * 0.4 : 0;
      const py = googly ? (r.next() - 0.5) * ew * 0.4 : -ew * 0.05;
      b.box(ex + px, ey + py, ez + es * 0.33, ew * 0.48, ew * 0.48, 0.04, INK);
    }
  }
  // Ears
  const ears = pick(r, ['none', 'tall', 'tall', 'floppy', 'round', 'round', 'quad']);
  if (ears !== 'none') {
    const ew = w * r.range(0.16, 0.26);
    const el = h * r.range(0.4, 1.0);
    const sets = ears === 'quad' ? 2 : 1;
    for (let k = 0; k < sets; k++) {
      const z = cz - d * 0.15 - k * d * 0.3;
      for (const s of [-1, 1]) {
        const x = cx + s * (w / 2 - ew * 0.5);
        if (ears === 'floppy') {
          b.at(x + s * ew * 0.4, cy + h * 0.3, z, 0, 0, s * -2.2, () =>
            b.box(0, el / 2, 0, ew, el, ew * 0.4, pal.second),
          );
        } else if (ears === 'round') {
          b.box(x, cy + h / 2 + ew * 0.6, z, ew * 1.4, ew * 1.4, ew * 0.4, pal.second);
          b.box(x, cy + h / 2 + ew * 0.6, z + ew * 0.22, ew * 0.8, ew * 0.8, 0.03, pal.belly);
        } else {
          b.at(x, cy + h / 2, z, 0, 0, s * -0.25, () => {
            b.box(0, el / 2, 0, ew, el, ew * 0.45, pal.base);
            b.box(0, el / 2, ew * 0.24, ew * 0.5, el * 0.75, 0.03, pal.accent);
          });
        }
      }
    }
  }
  // Horns
  const horns = pick(r, [0, 0, 0, 1, 2, 2, 3]);
  const hornCol = r.next() < 0.6 ? BONE : pal.accent;
  for (let k = 0; k < horns; k++) {
    const t = horns === 1 ? 0 : k / (horns - 1) - 0.5;
    const curl = r.range(-0.6, 0.6);
    const hs = Math.min(w, d) * r.range(0.14, 0.24);
    b.at(cx + t * w * 0.7, cy + h / 2, cz + d * 0.1, 0, curl * 0.5, t * -1.4, () => {
      let y = 0;
      for (let i = 0; i < 4; i++) {
        const s = hs * (1 - i * 0.2);
        b.at(0, y, 0, 0, curl * i * 0.25, 0, () => b.box(0, s * 0.6, 0, s, s * 1.2, s, hornCol));
        y += s * 1.1;
      }
    });
  }
  // Antennae
  if (r.next() < 0.22) {
    const al = h * r.range(0.6, 1.4);
    for (const s of [-1, 1]) {
      b.at(cx + s * w * 0.25, cy + h / 2, cz, 0, -0.3, s * -0.35, () => {
        b.box(0, al / 2, 0, 0.035, al, 0.035, INK);
        b.box(0, al, 0, 0.1, 0.1, 0.1, pal.accent);
      });
    }
  }
}

// ── Tails + backs ───────────────────────────────────────────────────────

function buildTail(
  b: GeoBuilder,
  r: Rand,
  pal: Palette,
  x: number,
  y: number,
  z: number,
  size: number,
) {
  const kind = pick(r, ['none', 'stub', 'long', 'long', 'ball', 'fan', 'multi']);
  if (kind === 'none') return;
  if (kind === 'stub') {
    b.box(x, y, z - size * 0.15, size * 0.3, size * 0.3, size * 0.3, pal.second);
    return;
  }
  if (kind === 'ball') {
    b.box(x, y, z - size * 0.2, size * 0.45, size * 0.45, size * 0.45, WHITE);
    return;
  }
  const tails = kind === 'multi' ? 2 + Math.floor(r.next() * 2) : kind === 'fan' ? 5 : 1;
  const lift = r.range(-0.6, 0.9);
  const segs = 3 + Math.floor(r.next() * 3);
  for (let t = 0; t < tails; t++) {
    const yaw = tails === 1 ? 0 : (t / (tails - 1) - 0.5) * (kind === 'fan' ? 1.6 : 0.9);
    b.at(x, y, z, Math.PI + yaw, -lift, 0, () => {
      let zz = 0;
      for (let i = 0; i < segs; i++) {
        const s = size * 0.2 * (1 - i * 0.12) * (kind === 'fan' ? 0.7 : 1);
        const tip = i === segs - 1;
        b.box(
          0,
          0,
          zz + s * 0.6,
          s,
          s,
          s * 1.3,
          tip ? pal.accent : i % 2 === 0 ? pal.base : pal.second,
        );
        zz += s * 1.2;
      }
    });
  }
}

function spikes(
  b: GeoBuilder,
  r: Rand,
  pal: Palette,
  y: number,
  z0: number,
  z1: number,
  size: number,
) {
  const n = 3 + Math.floor(r.next() * 4);
  for (let i = 0; i < n; i++) {
    const z = z0 + ((z1 - z0) * (i + 0.5)) / n;
    const s = size * r.range(0.12, 0.22);
    b.at(0, y, z, 0, 0, Math.PI / 4, () => b.box(0, 0, 0, s, s, s * 0.5, pal.accent));
  }
}

// ── Body plans ──────────────────────────────────────────────────────────

/** Build creature `seed` (deterministic). */
export function makeCreature(seed: number): CreatureDef {
  const r = new Rand(seed);
  const plan = pickPlan(r);
  const pal = palette(r);
  const kind = pick(r, PATTERNS);
  const noggles = r.next() < 0.12;
  let scale = r.range(0.8, 1.5);
  const sz = r.next();
  if (sz < 0.08) scale = r.range(2.0, 2.8);
  else if (sz < 0.18) scale = r.range(0.5, 0.7);
  const S = new THREE.Matrix4().makeScale(scale, scale, scale);
  const body = new GeoBuilder().push(S);
  const head = new GeoBuilder().push(S);
  const la = new GeoBuilder().push(S);
  const lb = new GeoBuilder().push(S);
  let limbKind: 'leg' | 'wing' = 'leg';
  const pa = new THREE.Vector3();
  const pb = new THREE.Vector3();
  const neck = new THREE.Vector3();
  let legLen = 0;
  let top = 1;
  let gait: Gait = 'walk';
  let grazes = false;
  const stalks = (plan === 'blob' || plan === 'crawler') && r.next() < 0.5;

  if (plan === 'quad' || plan === 'longneck') {
    const long = plan === 'longneck';
    const bl = long ? r.range(0.9, 1.4) : r.range(0.9, 1.7);
    const bw = r.range(0.5, 0.95);
    const bh = r.range(0.45, 0.85);
    legLen = long ? r.range(0.8, 1.3) : r.range(0.35, 0.85);
    const lt = r.range(0.12, 0.24);
    const y0 = legLen - 0.05;
    const paint = coat(r, pal, kind, y0, y0 + bh, seed);
    body.box(0, y0 + bh / 2, 0, bw, bh, bl, paint, 0.17);
    if (r.next() < 0.25) spikes(body, r, pal, y0 + bh, -bl / 2, bl / 2, bw);
    buildTail(body, r, pal, 0, y0 + bh * 0.7, -bl / 2, bw);
    const lx = bw / 2 - lt / 2 - 0.02;
    const lz = bl / 2 - lt / 2 - 0.05;
    const sock = r.next() < 0.5 ? pal.dark : pal.belly;
    const leg = (g: GeoBuilder, x: number, z: number) => {
      g.box(x, -legLen * 0.4, z, lt, legLen * 0.8, lt, paint(x, y0 - 0.1, z).clone());
      g.box(x, -legLen * 0.9, z + 0.01, lt * 1.1, legLen * 0.2, lt * 1.15, sock);
    };
    leg(la, lx, lz);
    leg(la, -lx, -lz);
    leg(lb, -lx, lz);
    leg(lb, lx, -lz);
    pa.set(0, legLen, 0);
    pb.copy(pa);
    neck.set(0, y0 + bh * 0.75, bl / 2 - 0.05);
    const hs = bw * r.range(0.55, 0.9);
    const hw = hs * r.range(0.8, 1.2);
    const hh = hs * r.range(0.75, 1.05);
    const hd = hs * r.range(0.8, 1.3);
    if (long) {
      const nl = r.range(0.9, 2.0);
      const lean = r.range(0.15, 0.5);
      const nt = Math.max(0.16, bw * 0.35);
      head.at(0, 0, 0, 0, lean, 0, () => {
        head.box(0, nl / 2, 0, nt, nl + 0.1, nt, paint, 0.17);
        head.at(0, nl, 0, 0, -lean, 0, () =>
          buildHead(
            head,
            r,
            pal,
            {
              cx: 0,
              cy: hh * 0.2,
              cz: hd * 0.3,
              w: hw,
              h: hh,
              d: hd,
              snout: true,
              stalks,
              beak: false,
            },
            paint,
            noggles,
          ),
        );
      });
      top = neck.y + nl * Math.cos(lean) + hh;
    } else {
      buildHead(
        head,
        r,
        pal,
        {
          cx: 0,
          cy: hh * 0.3,
          cz: hd * 0.45,
          w: hw,
          h: hh,
          d: hd,
          snout: r.next() < 0.7,
          stalks,
          beak: false,
        },
        paint,
        noggles,
      );
      top = neck.y + hh * 0.9;
    }
    gait = 'walk';
    grazes = true;
  } else if (plan === 'biped') {
    const bw = r.range(0.55, 1.0);
    const bh = r.range(0.8, 1.4);
    const bl = r.range(0.45, 0.75);
    legLen = r.range(0.35, 0.8);
    const lt = r.range(0.16, 0.26);
    const y0 = legLen - 0.04;
    const paint = coat(r, pal, kind, y0, y0 + bh, seed);
    body.box(0, y0 + bh / 2, 0, bw, bh, bl, paint, 0.17);
    if (r.next() < 0.2) spikes(body, r, pal, y0 + bh * 0.6, -bl / 2, -bl / 2 + 0.01, bw);
    buildTail(body, r, pal, 0, y0 + bh * 0.25, -bl / 2, bw);
    // Little arms (T-rex or out to the sides)
    const trex = r.next() < 0.5;
    const al = bh * r.range(0.25, 0.5);
    for (const s of [-1, 1]) {
      if (trex)
        body.box(s * bw * 0.3, y0 + bh * 0.6, bl / 2 + al / 2, lt * 0.6, lt * 0.6, al, pal.second);
      else
        body.at((s * bw) / 2, y0 + bh * 0.65, 0, 0, 0, s * 0.5, () =>
          body.box(0, -al / 2, 0, lt * 0.6, al, lt * 0.6, pal.second),
        );
    }
    const foot = pal.dark;
    for (const [g, s] of [
      [la, 1],
      [lb, -1],
    ] as const) {
      g.box(s * bw * 0.27, -legLen * 0.45, 0, lt, legLen * 0.9, lt, pal.second);
      g.box(s * bw * 0.27, -legLen * 0.93, 0.06, lt * 1.15, legLen * 0.14, lt * 1.6, foot);
    }
    pa.set(0, legLen, 0);
    pb.copy(pa);
    neck.set(0, y0 + bh - 0.02, 0.02);
    const hs = bw * r.range(0.6, 1.0);
    const hh = hs * r.range(0.7, 1.0);
    buildHead(
      head,
      r,
      pal,
      {
        cx: 0,
        cy: hh / 2,
        cz: 0.05,
        w: hs * r.range(0.85, 1.15),
        h: hh,
        d: hs * r.range(0.7, 1.0),
        snout: r.next() < 0.35,
        stalks,
        beak: r.next() < 0.15,
      },
      paint,
      noggles,
    );
    top = neck.y + hh * 1.1;
    gait = 'waddle';
  } else if (plan === 'blob') {
    const w = r.range(0.8, 1.5);
    const h = w * r.range(0.6, 1.0);
    const paint = coat(r, pal, kind, 0, h, seed);
    // Stacked voxel slabs read as a squat jelly
    body.box(0, h * 0.2, 0, w, h * 0.4, w * 0.95, paint, 0.16);
    body.box(0, h * 0.55, 0, w * 0.86, h * 0.32, w * 0.82, paint, 0.16);
    body.box(0, h * 0.82, 0, w * 0.64, h * 0.24, w * 0.6, paint, 0.16);
    if (r.next() < 0.3) spikes(body, r, pal, h * 0.95, -w * 0.2, w * 0.2, w);
    // Stubby arms
    const al = w * r.range(0.25, 0.45);
    la.box(al / 2, 0, 0, al, w * 0.14, w * 0.14, pal.second);
    lb.box(-al / 2, 0, 0, al, w * 0.14, w * 0.14, pal.second);
    limbKind = 'wing';
    pa.set(w * 0.42, h * 0.45, 0.05);
    pb.set(-w * 0.42, h * 0.45, 0.05);
    neck.set(0, h * 0.62, w * 0.25);
    const hh = h * 0.35;
    buildHead(
      head,
      r,
      pal,
      {
        cx: 0,
        cy: 0,
        cz: w * 0.12,
        w: w * 0.55,
        h: hh,
        d: w * 0.2,
        snout: false,
        stalks,
        beak: false,
      },
      paint,
      noggles,
    );
    top = h * 1.15;
    gait = 'hop';
    legLen = h * 0.3;
  } else if (plan === 'crawler') {
    const n = 3 + Math.floor(r.next() * 4);
    const sl = r.range(0.28, 0.45);
    const w = r.range(0.4, 0.8);
    const h = r.range(0.25, 0.45);
    legLen = r.range(0.22, 0.4);
    const y0 = legLen;
    const paint = coat(r, pal, kind, y0, y0 + h, seed);
    const len = n * sl;
    for (let i = 0; i < n; i++) {
      const z = len / 2 - (i + 0.5) * sl;
      const s = 1 - Math.abs(i / (n - 1) - 0.4) * 0.35;
      body.box(
        0,
        y0 + (h * s) / 2,
        z,
        w * s,
        h * s,
        sl * 0.92,
        i % 2 === 0 ? paint : pal.second,
        0.15,
      );
    }
    buildTail(body, r, pal, 0, y0 + h * 0.5, -len / 2, w);
    // Splayed legs: out from the hip, then down to the ground
    const pairs = Math.min(n, 3 + Math.floor(r.next() * 3));
    const lt = Math.max(0.06, w * 0.14);
    const reach = w * r.range(0.35, 0.6);
    for (let i = 0; i < pairs; i++) {
      const z = len / 2 - ((i + 0.5) * len) / pairs;
      for (const s of [-1, 1]) {
        const g = (i + (s > 0 ? 0 : 1)) % 2 === 0 ? la : lb;
        g.box(s * (w / 2 + reach / 2), 0.02, z, reach, lt, lt, pal.second);
        g.box(s * (w / 2 + reach), -legLen / 2, z, lt, legLen, lt, pal.dark);
      }
    }
    pa.set(0, legLen, 0);
    pb.copy(pa);
    neck.set(0, y0 + h * 0.5, len / 2);
    const hs = w * r.range(0.7, 1.0);
    buildHead(
      head,
      r,
      pal,
      {
        cx: 0,
        cy: 0,
        cz: hs * 0.35,
        w: hs,
        h: hs * 0.7,
        d: hs * 0.7,
        snout: false,
        stalks,
        beak: false,
      },
      paint,
      noggles,
    );
    top = neck.y + hs * 0.8;
    gait = 'scuttle';
    grazes = true;
  } else {
    // Bird
    const bw = r.range(0.5, 0.9);
    const bh = r.range(0.5, 0.9);
    const bl = r.range(0.6, 1.1);
    legLen = r.range(0.2, 0.55);
    const y0 = legLen;
    const paint = coat(r, pal, kind, y0, y0 + bh, seed);
    body.box(0, y0 + bh / 2, 0, bw, bh, bl, paint, 0.16);
    body.box(0, y0 + bh * 0.35, bl * 0.1, bw * 0.8, bh * 0.5, bl * 0.85, pal.belly);
    // Tail feathers
    const tf = 3 + Math.floor(r.next() * 3);
    for (let i = 0; i < tf; i++) {
      const a = (i / (tf - 1) - 0.5) * 1.2;
      body.at(0, y0 + bh * 0.6, -bl / 2, Math.PI + a, -r.range(0.2, 0.8), 0, () =>
        body.box(0, 0, bl * 0.25, 0.08, 0.04, bl * 0.5, i % 2 === 0 ? pal.second : pal.accent),
      );
    }
    // Stick legs + feet
    for (const s of [-1, 1]) {
      body.box(s * bw * 0.2, legLen / 2, 0, 0.06, legLen, 0.06, pal.accent);
      body.box(s * bw * 0.2, 0.025, 0.06, 0.16, 0.05, 0.22, pal.accent);
    }
    const wl = r.range(0.5, 1.2);
    const wd = bl * r.range(0.5, 0.8);
    for (const [g, s] of [
      [la, 1],
      [lb, -1],
    ] as const) {
      for (let i = 0; i < 3; i++) {
        const x = (s * (wl * (i + 0.5))) / 3;
        g.box(
          x,
          0,
          -i * wd * 0.08,
          wl / 3 + 0.01,
          0.06,
          wd * (1 - i * 0.15),
          i === 2 ? pal.accent : pal.second,
        );
      }
    }
    limbKind = 'wing';
    pa.set(bw / 2, y0 + bh * 0.75, 0);
    pb.set(-bw / 2, y0 + bh * 0.75, 0);
    neck.set(0, y0 + bh * 0.9, bl * 0.3);
    const hs = bw * r.range(0.55, 0.8);
    buildHead(
      head,
      r,
      pal,
      {
        cx: 0,
        cy: hs * 0.45,
        cz: hs * 0.2,
        w: hs,
        h: hs,
        d: hs,
        snout: false,
        stalks: false,
        beak: true,
      },
      paint,
      noggles,
    );
    if (r.next() < 0.5) {
      // Crest
      for (let i = 0; i < 3; i++)
        head.box(0, hs * 0.95 + i * 0.06, hs * 0.2 - i * 0.08, 0.05, 0.16, 0.1, pal.accent);
    }
    top = neck.y + hs * 1.1;
    gait = 'hop';
  }

  const mul = (v: THREE.Vector3) => v.multiplyScalar(scale);
  const speedMul = Math.sqrt(scale);
  return {
    seed,
    plan,
    name: creatureName(seed, plan, noggles),
    scale,
    body: body.build(),
    head: head.build(),
    limbs: [la.empty ? null : la.build(), lb.empty ? null : lb.build()],
    limbKind,
    pivots: [mul(pa), mul(pb)],
    neck: mul(neck),
    legLen: legLen * scale,
    top: top * scale,
    gait,
    walk: r.range(0.7, 1.4) * speedMul,
    run: r.range(5, 8) * speedMul,
    grazes,
  };
}
