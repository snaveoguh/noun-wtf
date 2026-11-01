// CAMP pet: design concepts (not game code).
//
// Four variations of one original mascot, a hairless flying mouse built from
// voxels like a Noun, wearing the real hip-rose noggles (read pixel for pixel
// from the asset PNG at runtime, never redrawn). Rendered with the game's own
// toon materials + ink outline next to a real NounCharacter for scale.
//
// Driven by scripts/camp-pet/render.cjs (headless Chromium through the vite
// dev server); sheets.py lays the frames out into contact sheets.

import { EffectComposer, EffectPass, NormalPass, RenderPass } from 'postprocessing';
import * as THREE from 'three';

// the canonical 32x32 Nouns art (public/sprites' copy is a different, upscaled file)
import hipRoseUrl from '../../../nouns-assets/images/v0/4-glasses/glasses-hip-rose.png';

import {
  loadCharacterAssets,
  NounCharacter,
  type CharacterAssets,
} from '../../src/miniapps/world2/character/NounCharacter';
import { ClampEffect, InkOutlineEffect, toonify } from '../../src/miniapps/world2/render/Toon';

// ── Variants ─────────────────────────────────────────────────────────────

export type WingStyle = 'bat' | 'pixel' | 'stub' | 'leaf';
export type Face = 'teeth' | 'smile' | 'cat' | 'o';

export interface Variant {
  id: string;
  name: string;
  /** Voxel edge (m). */
  v: number;
  skin: number;
  shade: number;
  ear: number;
  belly: number;
  nose: number;
  cheek: number;
  wing: number;
  wingBone: number;
  wingTip: number;
  /** Head half-extents (voxels) and superellipse power (2 round … 8 cube). */
  head: [number, number, number];
  headP: number;
  body: [number, number, number];
  bodyP: number;
  /** Ear radius (voxels), height ratio, splay (rad). */
  earR: number;
  earH: number;
  earSplay: number;
  wings: WingStyle;
  wingSpan: number;
  tail: number;
  legs: number;
  face: Face;
}

// Every colour is from the Nouns palette (nouns-assets image-data.json).
export const VARIANTS: Variant[] = [
  {
    id: 'mochi',
    name: 'MOCHI',
    v: 0.0165,
    skin: 0xe4afa3,
    shade: 0xd18687,
    ear: 0xff82ad,
    belly: 0xf9e8dd,
    nose: 0xd26451,
    cheek: 0xff82ad,
    wing: 0xd596a6,
    wingBone: 0xd18687,
    wingTip: 0xd596a6,
    head: [7.5, 6.5, 6.5],
    headP: 3.2,
    body: [5, 5, 5],
    bodyP: 2.8,
    earR: 6,
    earH: 1,
    earSplay: 0.42,
    wings: 'bat',
    wingSpan: 10,
    tail: 12,
    legs: 1,
    face: 'teeth',
  },
  {
    id: 'nub',
    name: 'NUB',
    v: 0.0165,
    skin: 0xfeb9d5,
    shade: 0xff82ad,
    ear: 0xff638d,
    belly: 0xfee3f3,
    nose: 0xff638d,
    cheek: 0xff638d,
    wing: 0xfee3f3,
    wingBone: 0xff82ad,
    wingTip: 0xff638d,
    head: [7, 6.5, 6.5],
    headP: 7,
    body: [4.5, 4.5, 4.5],
    bodyP: 5,
    earR: 5,
    earH: 0.85,
    earSplay: 0.3,
    wings: 'pixel',
    wingSpan: 9,
    tail: 10,
    legs: 1,
    face: 'smile',
  },
  {
    id: 'zip',
    name: 'ZIP',
    v: 0.0165,
    skin: 0xfd8b5b,
    shade: 0xd26451,
    ear: 0xfeb9d5,
    belly: 0xeeb78c,
    nose: 0xb9185c,
    cheek: 0xe9265c,
    wing: 0xf38b7c,
    wingBone: 0xd26451,
    wingTip: 0xf38b7c,
    head: [6.5, 6, 6],
    headP: 3.6,
    body: [4, 4.5, 6],
    bodyP: 3,
    earR: 4.5,
    earH: 1.2,
    earSplay: 0.3,
    wings: 'bat',
    wingSpan: 15,
    tail: 15,
    legs: 2,
    face: 'cat',
  },
  {
    id: 'bean',
    name: 'BEAN',
    v: 0.0165,
    skin: 0xf9e8dd,
    shade: 0xe4afa3,
    ear: 0xfeb9d5,
    belly: 0xfff0ee,
    nose: 0xfb4694,
    cheek: 0xff82ad,
    wing: 0xd4ff3a,
    wingBone: 0xd4ff3a,
    wingTip: 0xd4ff3a,
    head: [8, 7, 7],
    headP: 3,
    body: [4, 3.5, 4],
    bodyP: 2.6,
    earR: 4,
    earH: 1,
    earSplay: 0.55,
    wings: 'leaf',
    wingSpan: 5,
    tail: 8,
    legs: 1,
    face: 'o',
  },
];

// ── Voxel meshing ────────────────────────────────────────────────────────

type Vox = Map<string, number>;
const key = (x: number, y: number, z: number) => `${x},${y},${z}`;

const FACES: [number[], number[][]][] = [
  [
    [1, 0, 0],
    [
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
      [1, 0, 1],
    ],
  ],
  [
    [-1, 0, 0],
    [
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
      [0, 0, 0],
    ],
  ],
  [
    [0, 1, 0],
    [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
  ],
  [
    [0, -1, 0],
    [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
  ],
  [
    [0, 0, 1],
    [
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
      [0, 0, 1],
    ],
  ],
  [
    [0, 0, -1],
    [
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
      [1, 0, 0],
    ],
  ],
];

/** Mesh voxels (integer cells) into one geometry, cells scaled by `s` (m) and shifted by -origin. */
function meshVox(vox: Vox, s: number, origin: THREE.Vector3, depth = 1): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Color();
  for (const [k, hex] of vox) {
    const [x, y, z] = k.split(',').map(Number) as [number, number, number];
    c.setHex(hex);
    for (const [n, quad] of FACES) {
      if (vox.has(key(x + n[0]!, y + n[1]!, z + n[2]!))) continue;
      const b = pos.length / 3;
      for (const q of quad) {
        pos.push(
          (x + q[0]! - origin.x) * s,
          (y + q[1]! - origin.y) * s,
          (z + q[2]! * depth - origin.z) * s,
        );
        nor.push(n[0]!, n[1]!, n[2]!);
        col.push(c.r, c.g, c.b);
      }
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}

const MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });

/** Superellipsoid fill: cells whose centres lie inside. */
function blob(
  out: Vox,
  c: [number, number, number],
  r: [number, number, number],
  p: number,
  col: (x: number, y: number, z: number, u: [number, number, number]) => number,
) {
  for (let x = Math.floor(c[0] - r[0]); x <= Math.ceil(c[0] + r[0]); x++)
    for (let y = Math.floor(c[1] - r[1]); y <= Math.ceil(c[1] + r[1]); y++)
      for (let z = Math.floor(c[2] - r[2]); z <= Math.ceil(c[2] + r[2]); z++) {
        const u: [number, number, number] = [
          (x + 0.5 - c[0]) / r[0],
          (y + 0.5 - c[1]) / r[1],
          (z + 0.5 - c[2]) / r[2],
        ];
        if (Math.abs(u[0]) ** p + Math.abs(u[1]) ** p + Math.abs(u[2]) ** p <= 1)
          out.set(key(x, y, z), col(x, y, z, u));
      }
}

// ── The noggles, from the real asset ─────────────────────────────────────

interface NogPx {
  x: number;
  y: number;
  hex: number;
}
let noggles: { px: NogPx[]; w: number; h: number } | null = null;

/** hip-rose, read pixel for pixel off the PNG (cropped to its pixels). */
async function loadNoggles(): Promise<NonNullable<typeof noggles>> {
  if (noggles !== null) return noggles;
  const img = new Image();
  img.src = hipRoseUrl;
  await img.decode();
  const cv = document.createElement('canvas');
  cv.width = img.width;
  cv.height = img.height;
  const g = cv.getContext('2d')!;
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, img.width, img.height).data;
  const all: NogPx[] = [];
  for (let y = 0; y < img.height; y++)
    for (let x = 0; x < img.width; x++) {
      const i = (y * img.width + x) * 4;
      if (d[i + 3]! < 128) continue;
      all.push({ x, y, hex: (d[i]! << 16) | (d[i + 1]! << 8) | d[i + 2]! });
    }
  const x0 = Math.min(...all.map(p => p.x));
  const y0 = Math.min(...all.map(p => p.y));
  const px = all.map(p => ({ x: p.x - x0, y: p.y - y0, hex: p.hex }));
  noggles = {
    px,
    w: Math.max(...px.map(p => p.x)) + 1,
    h: Math.max(...px.map(p => p.y)) + 1,
  };
  return noggles;
}

// ── Building one pet ─────────────────────────────────────────────────────

export interface Pet {
  v: Variant;
  root: THREE.Group;
  parts: Record<string, THREE.Group>;
  /** Toggleable face bits. */
  bits: Record<string, THREE.Object3D>;
  /** Height (m) from the feet to the top of the ears, standing. */
  height: number;
}

function buildPet(v: Variant, nog: NonNullable<typeof noggles>): Pet {
  const s = v.v;
  const root = new THREE.Group();
  const parts: Record<string, THREE.Group> = {};
  const bits: Record<string, THREE.Object3D> = {};
  const legLen = v.legs;
  // Pet space (voxels): +z forward, +y up, feet on y = 0.
  const bodyC: [number, number, number] = [0, legLen + v.body[1], -1];
  const headC: [number, number, number] = [
    0,
    bodyC[1] + v.body[1] * 0.55 + v.head[1] * 0.8,
    bodyC[2] + v.body[2] * 0.35,
  ];

  const part = (name: string, parent: string | null, pivot: [number, number, number], vox: Vox) => {
    const g = new THREE.Group();
    const pv = new THREE.Vector3(...pivot);
    g.userData.pivot = pv;
    const par = parent === null ? null : parts[parent]!;
    const pp = par === null ? new THREE.Vector3() : (par.userData.pivot as THREE.Vector3);
    g.position.copy(pv).sub(pp).multiplyScalar(s);
    if (vox.size > 0) {
      const m = new THREE.Mesh(meshVox(vox, s, pv), MAT);
      m.castShadow = true;
      m.receiveShadow = false;
      g.add(m);
    }
    (par ?? root).add(g);
    parts[name] = g;
    return g;
  };

  // Body: belly patch on the front.
  const body: Vox = new Map();
  blob(body, bodyC, v.body, v.bodyP, (_x, _y, _z, u) =>
    u[2] > 0.35 && Math.abs(u[0]) < 0.6 && u[1] < 0.5 ? v.belly : v.skin,
  );
  part('body', null, [0, bodyC[1] - v.body[1] * 0.6, bodyC[2]], body);

  // Head
  const head: Vox = new Map();
  blob(head, headC, v.head, v.headP, (_x, y, _z, u) =>
    u[1] < -0.55 && u[2] > 0.2
      ? v.belly
      : y < headC[1] - v.head[1] * 0.2 && u[2] < -0.5
        ? v.shade
        : v.skin,
  );
  const front = Math.max(
    ...[...head.keys()].map(k => Number(k.split(',')[2])).filter(Number.isFinite),
  );
  // Nose, cheeks
  const fy = Math.round(headC[1] - v.head[1] * 0.35);
  head.set(key(0, fy, front + 1), v.nose);
  head.set(key(-1, fy, front + 1), v.nose);
  const cheekX = Math.round(v.head[0] * 0.62);
  for (const sx of [-1, 1]) {
    const cx = sx < 0 ? -cheekX - 1 : cheekX;
    const zc = [...head.keys()]
      .map(k => k.split(',').map(Number) as [number, number, number])
      .filter(([x, y]) => x === cx && y === fy)
      .reduce((m, [, , z]) => Math.max(m, z), -99);
    if (zc > -99) {
      head.set(key(cx, fy, zc), v.cheek);
      head.set(key(cx + (sx < 0 ? 1 : -1), fy, zc), v.cheek);
    }
  }
  part('head', 'body', [0, headC[1] - v.head[1] * 0.75, headC[2] - 1], head);

  // Mouth variants as separate bits (one shows at a time).
  const my = fy - 2;
  const mouth = (name: string, cells: [number, number, number][]) => {
    const m: Vox = new Map();
    for (const [x, y, hex] of cells) {
      let z = -99;
      for (let zz = front; zz > front - 20; zz--)
        if (head.has(key(x, y, zz))) {
          z = zz;
          break;
        }
      m.set(key(x, y, z + 1), hex);
    }
    const g = part(name, 'head', [0, headC[1] - v.head[1] * 0.75, headC[2] - 1], new Map());
    const mesh = new THREE.Mesh(meshVox(m, s, g.userData.pivot as THREE.Vector3, 0.15), MAT);
    g.add(mesh);
    bits[name] = g;
  };
  const DARK = 0x552e52; // nouns palette deep plum (mouth)
  const WHITE = 0xffffff;
  const TONGUE = 0xfb4694;
  if (v.face === 'teeth')
    mouth('mouth', [
      [-1, my, WHITE],
      [0, my, WHITE],
      [-2, my + 1, DARK],
      [1, my + 1, DARK],
    ]);
  else if (v.face === 'smile')
    mouth('mouth', [
      [-2, my + 1, DARK],
      [-1, my, DARK],
      [0, my, DARK],
      [1, my + 1, DARK],
    ]);
  else if (v.face === 'cat')
    mouth('mouth', [
      [-2, my, DARK],
      [-1, my + 1, DARK],
      [0, my + 1, DARK],
      [1, my, DARK],
    ]);
  else
    mouth('mouth', [
      [-1, my, DARK],
      [0, my, DARK],
    ]);
  mouth('mouthOpen', [
    [-2, my + 1, DARK],
    [-1, my + 1, DARK],
    [0, my + 1, DARK],
    [1, my + 1, DARK],
    [-2, my, DARK],
    [-1, my, TONGUE],
    [0, my, TONGUE],
    [1, my, DARK],
  ]);
  // Closed eyes (under the noggles; seen when they're pushed up to sleep)
  const ey = Math.round(headC[1] + v.head[1] * 0.2);
  const ex = Math.round(v.head[0] * 0.45);
  mouth('eyesShut', [
    [-ex - 2, ey, DARK],
    [-ex - 1, ey - 1, DARK],
    [-ex, ey, DARK],
    [ex - 1, ey, DARK],
    [ex, ey - 1, DARK],
    [ex + 1, ey, DARK],
  ]);

  // Noggles: one pixel = (lens span) / 13 so the lenses cover the face.
  {
    const lensW = 13; // columns 3..15 of the 16 px art
    const np = ((v.head[0] * 2 + 1) * s) / (lensW + 2);
    const g = new THREE.Group();
    const geo = new THREE.BoxGeometry(np, np, np * 0.7);
    const byCol = new Map<number, THREE.Vector3[]>();
    for (const p of nog.px) {
      const list = byCol.get(p.hex) ?? [];
      // centre the lenses (cols 3..15) on the face; art x → -pet x (the art faces the viewer)
      list.push(
        new THREE.Vector3(-(p.x - 3 - (lensW - 1) / 2) * np, -(p.y - (nog.h - 1) / 2) * np, 0),
      );
      byCol.set(p.hex, list);
    }
    for (const [hex, list] of byCol) {
      const im = new THREE.InstancedMesh(
        geo,
        new THREE.MeshStandardMaterial({ color: hex, roughness: 1 }),
        list.length,
      );
      list.forEach((p, i) => im.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p)));
      im.castShadow = true;
      g.add(im);
    }
    // Hinge at the top of the head so sleep can push them up.
    const headPart = parts.head!;
    const hp = headPart.userData.pivot as THREE.Vector3;
    const hinge = new THREE.Group();
    const topY = headC[1];
    hinge.position.set(0, (topY - hp.y) * s, (headC[2] - hp.z) * s);
    hinge.userData.pivot = new THREE.Vector3(0, topY, headC[2]);
    headPart.add(hinge);
    g.position.set(0, (ey + 0.5 - topY) * s, (front + 1 - headC[2]) * s + np * 0.35);
    hinge.add(g);
    parts.noggles = hinge;
  }

  // Ears: discs (or squares for a cube-ish head) with a coloured inside.
  for (const sx of [-1, 1]) {
    const ear: Vox = new Map();
    const R = v.earR;
    const H = R * v.earH;
    const ex0 = sx * (v.head[0] * 0.42 + R * 0.4);
    const base: [number, number, number] = [ex0, headC[1] + v.head[1] * 0.6, headC[2] - 1];
    const sq = v.headP > 5;
    for (let a = -Math.ceil(R); a <= Math.ceil(R); a++)
      for (let b = 0; b <= Math.ceil(H * 2); b++) {
        const u = (a + 0.5) / R;
        const w = (b + 0.5 - H) / H;
        const inside = sq ? Math.abs(u) ** 6 + Math.abs(w) ** 6 <= 1 : u * u + w * w <= 1;
        if (!inside) continue;
        const inner = (sq ? Math.max(Math.abs(u), Math.abs(w)) : Math.hypot(u, w)) < 0.62 && b > 1;
        const x = Math.round(base[0] + a);
        const y = Math.round(base[1] + b);
        ear.set(key(x, y, Math.round(base[2])), v.skin);
        ear.set(key(x, y, Math.round(base[2]) + 1), inner ? v.ear : v.skin);
      }
    part(sx < 0 ? 'earR' : 'earL', 'head', base, ear);
  }

  // Wings, built flat in the pet's x-y plane from the shoulder outward.
  for (const sx of [-1, 1]) {
    const w: Vox = new Map();
    const span = v.wingSpan;
    const sh: [number, number, number] = [
      sx * (v.body[0] * 0.7),
      bodyC[1] + v.body[1] * 0.35,
      bodyC[2] - v.body[2] * 0.3,
    ];
    const zc = Math.round(sh[2]);
    const put = (a: number, b: number, hex: number) =>
      w.set(key(Math.round(sh[0] + sx * a) - (sx < 0 ? 1 : 0), Math.round(sh[1] + b), zc), hex);
    if (v.wings === 'bat') {
      const fingers = [0.5, 0.78, 1].map(f => f * span);
      for (let a = 0; a <= span; a++) {
        const top = Math.round(Math.sin((a / span) * Math.PI * 0.9) * span * 0.32);
        // scalloped trailing edge rising to each finger tip
        let edge = -span * 0.55 * (1 - a / span) ** 0.8;
        for (const f of fingers) edge = Math.max(edge, -Math.abs(a - f) * 0.8 - (f / span) * 2);
        edge = Math.min(edge, top - 1);
        for (let b = Math.round(edge); b <= top; b++) put(a, b, b === top ? v.wingBone : v.wing);
      }
      for (const f of fingers.slice(0, 2)) {
        const n = Math.round(f);
        for (let i = 0; i <= n; i++) {
          const a = Math.round((i / n) * f);
          const top = Math.round(Math.sin((a / span) * Math.PI * 0.9) * span * 0.32);
          const tip = -Math.round((f / span) * 2);
          const b = Math.round(top + (tip - top) * ((a - f * 0.55) / (f * 0.45)));
          if (a > f * 0.55) put(a, Math.min(top, b), v.wingBone);
        }
      }
    } else if (v.wings === 'pixel') {
      // stepped 8-bit wing: rows shrink downward, pink tips
      const rows = [span, span - 1, span - 2, span - 4, span - 6];
      rows.forEach((len, r) => {
        for (let a = 0; a < len; a++)
          put(a, 2 - r, a >= len - 2 ? v.wingTip : r === 0 ? v.wingBone : v.wing);
      });
    } else if (v.wings === 'leaf') {
      // two little acid-green rounded flaps (fast, bee-like)
      for (let a = 0; a <= span; a++)
        for (let b = -3; b <= 3; b++)
          if (((a - span / 2) / (span / 2 + 0.5)) ** 2 + (b / 3) ** 2 <= 1) put(a, b + 1, v.wing);
    } else {
      for (let a = 0; a <= span; a++)
        for (let b = -2; b <= 2; b++)
          if ((a / (span + 0.5)) ** 2 + (b / 2.5) ** 2 <= 1) put(a, b, v.wing);
    }
    part(sx < 0 ? 'wingR' : 'wingL', 'body', sh, w);
  }

  // Tail: a chain of thin segments from the rump, each its own joint.
  {
    const segLen = 2;
    const n = Math.round(v.tail / segLen);
    let parent = 'body';
    let p: [number, number, number] = [0, bodyC[1] - v.body[1] * 0.45, bodyC[2] - v.body[2] + 0.5];
    for (let i = 0; i < n; i++) {
      const seg: Vox = new Map();
      for (let j = 0; j < segLen; j++)
        seg.set(
          key(-1 + 0, Math.round(p[1]), Math.round(p[2]) - 1 - j),
          i === n - 1 && j === segLen - 1 ? v.nose : v.shade,
        );
      // tail voxels at x=-1..0 would be 1 wide; keep it 1 wide, centred
      const fixed: Vox = new Map();
      for (const [k, hex] of seg) {
        const [x, y, z] = k.split(',').map(Number) as [number, number, number];
        fixed.set(key(x, y, z), hex);
      }
      const name = `tail${i}`;
      part(name, parent, [p[0] - 0.5, Math.round(p[1]), Math.round(p[2])], fixed);
      parent = name;
      p = [p[0], p[1], p[2] - segLen];
    }
  }

  // Legs: little front paws and chunkier hind feet, pivoting at the hip.
  const legDefs: [string, number, number, number, number][] = [
    // name, x, z, width, length(fwd)
    ['legFL', -1, bodyC[2] + v.body[2] * 0.4, 3, 3],
    ['legFR', 1, bodyC[2] + v.body[2] * 0.4, 3, 3],
    ['legBL', -1, bodyC[2] - v.body[2] * 0.4, 3, 4],
    ['legBR', 1, bodyC[2] - v.body[2] * 0.4, 3, 4],
  ];
  for (const [name, sx, z, wdt, len] of legDefs) {
    const lx = sx * Math.max(1.5, v.body[0] * 0.42);
    const leg: Vox = new Map();
    const hipY = legLen + 1;
    for (let y = 0; y <= hipY; y++)
      for (let a = 0; a < wdt; a++)
        for (let b = 0; b < (y === 0 ? len : 3); b++)
          leg.set(
            key(Math.round(lx) - (sx < 0 ? wdt : 0) + a, y, Math.round(z) + b - 1),
            y === 0 ? v.shade : v.skin,
          );
    part(name, 'body', [lx, hipY, z], leg);
  }

  const box = new THREE.Box3().setFromObject(root);
  return { v, root, parts, bits, height: box.max.y - box.min.y };
}

// ── Poses ────────────────────────────────────────────────────────────────

export type PoseName = 'stand' | 'idle' | 'happy' | 'sleep' | 'run' | 'fly' | 'perch';

function rest(p: Pet) {
  for (const g of Object.values(p.parts)) {
    g.rotation.set(0, 0, 0);
    g.scale.set(1, 1, 1);
  }
  p.root.position.set(0, 0, 0);
  p.root.rotation.set(0, 0, 0);
  p.parts.body!.position.y = (p.parts.body!.userData.pivot as THREE.Vector3).y * p.v.v;
  p.bits.mouth!.visible = true;
  p.bits.mouthOpen!.visible = false;
  p.bits.eyesShut!.visible = false;
  p.parts.earL!.rotation.z = -p.v.earSplay * 0.5;
  p.parts.earR!.rotation.z = p.v.earSplay * 0.5;
  p.parts.earL!.rotation.y = -0.35;
  p.parts.earR!.rotation.y = 0.35;
}

function wingsFolded(p: Pet, amt = 1) {
  // tuck along the body sides, tips pointing back
  p.parts.wingL!.rotation.set(0, 1.35 * amt, -0.35 * amt);
  p.parts.wingR!.rotation.set(0, -1.35 * amt, 0.35 * amt);
  p.parts.wingL!.scale.set(1 - 0.5 * amt, 1 - 0.25 * amt, 1);
  p.parts.wingR!.scale.set(1 - 0.5 * amt, 1 - 0.25 * amt, 1);
}
function wingsOpen(p: Pet, flap: number, sweep = 0.25) {
  p.parts.wingL!.rotation.set(0, sweep, flap);
  p.parts.wingR!.rotation.set(0, -sweep, -flap);
}
function curlTail(p: Pet, up: number, curl: number, side = 0) {
  for (let i = 0; p.parts[`tail${i}`] !== undefined; i++) {
    const t = p.parts[`tail${i}`]!;
    t.rotation.x = i === 0 ? up : curl;
    t.rotation.y = side * (i === 0 ? 1 : 0.4);
  }
}

/** Pose the pet. `phase` 0..1 is the gait / flap cycle for the moving poses. */
export function pose(p: Pet, name: PoseName, phase = 0.25) {
  rest(p);
  const s = p.v.v;
  const P = p.parts;
  const tw = Math.PI * 2 * phase;
  switch (name) {
    case 'stand':
      wingsFolded(p);
      curlTail(p, 0.55, 0.42);
      break;
    case 'idle':
      wingsFolded(p, 0.9);
      P.head!.rotation.z = 0.12;
      P.earL!.rotation.z = -0.25;
      P.earR!.rotation.z = 0.1;
      curlTail(p, 0.7, 0.45, 0.3);
      break;
    case 'happy': {
      p.root.position.y = 0.16;
      p.root.rotation.y = 0.5;
      P.body!.rotation.x = -0.12;
      P.head!.rotation.x = -0.25;
      wingsOpen(p, 0.55, 0.1);
      P.earL!.rotation.z = -p.v.earSplay;
      P.earR!.rotation.z = p.v.earSplay;
      P.legFL!.rotation.x = -1.6;
      P.legFR!.rotation.x = -1.3;
      P.legBL!.rotation.x = 0.5;
      P.legBR!.rotation.x = 0.3;
      curlTail(p, 1.0, 0.45, 0.2);
      p.bits.mouth!.visible = false;
      p.bits.mouthOpen!.visible = true;
      break;
    }
    case 'sleep': {
      // a loaf: belly on the floor, paws tucked, chin down, noggles pushed
      // up on the forehead, eyes shut, ears flopped, tail wrapped round
      const drop = (p.parts.legFL!.userData.pivot as THREE.Vector3).y * s * 0.9;
      P.body!.position.y -= drop;
      P.head!.rotation.x = 0.22;
      P.head!.rotation.z = 0.12;
      P.noggles!.rotation.x = -0.95;
      P.earL!.rotation.z = -p.v.earSplay - 0.5;
      P.earR!.rotation.z = p.v.earSplay + 0.5;
      P.earL!.rotation.x = -0.3;
      P.earR!.rotation.x = -0.3;
      wingsFolded(p, 1.05);
      for (const l of ['legFL', 'legFR']) P[l]!.rotation.x = -1.45;
      for (const l of ['legBL', 'legBR']) P[l]!.rotation.x = 1.45;
      curlTail(p, -0.35, 0.0, 0.0);
      for (let i = 0; P[`tail${i}`] !== undefined; i++)
        P[`tail${i}`]!.rotation.y = i === 0 ? 1.0 : 0.38;
      p.bits.eyesShut!.visible = true;
      p.bits.mouth!.visible = true;
      break;
    }
    case 'run': {
      const b = Math.abs(Math.sin(tw));
      p.root.position.y = b * 0.05;
      P.body!.rotation.x = 0.22;
      P.head!.rotation.x = -0.18;
      P.legFL!.rotation.x = Math.sin(tw) * 0.9;
      P.legFR!.rotation.x = Math.sin(tw + 0.6) * 0.9;
      P.legBL!.rotation.x = Math.sin(tw + Math.PI) * 1.0;
      P.legBR!.rotation.x = Math.sin(tw + Math.PI + 0.6) * 1.0;
      P.earL!.rotation.x = -0.55;
      P.earR!.rotation.x = -0.55;
      wingsFolded(p, 0.8);
      curlTail(p, -0.15, -0.05, Math.sin(tw) * 0.3);
      p.bits.mouth!.visible = false;
      p.bits.mouthOpen!.visible = true;
      break;
    }
    case 'fly': {
      P.body!.rotation.x = 0.45;
      P.head!.rotation.x = -0.4;
      wingsOpen(p, Math.sin(tw) * 0.7 + 0.15, 0.15);
      for (const l of ['legFL', 'legFR', 'legBL', 'legBR']) P[l]!.rotation.x = 0.9;
      P.earL!.rotation.x = -0.45;
      P.earR!.rotation.x = -0.45;
      curlTail(p, -0.3, -0.12, 0.2);
      break;
    }
    case 'perch': {
      // sitting up: hind legs forward, body upright, paws on the edge
      const drop = (P.body!.userData.pivot as THREE.Vector3).y * s * 0.55;
      P.body!.position.y -= drop;
      P.body!.rotation.x = -0.35;
      P.head!.rotation.x = 0.28;
      P.head!.rotation.z = -0.1;
      P.legBL!.rotation.x = -1.3;
      P.legBR!.rotation.x = -1.3;
      P.legFL!.rotation.x = -0.4;
      P.legFR!.rotation.x = -0.2;
      wingsFolded(p, 0.95);
      curlTail(p, -0.6, -0.15, 0.6);
      break;
    }
  }
  p.root.updateMatrixWorld(true);
}

// ── Stage ────────────────────────────────────────────────────────────────

let stage: {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  composer: EffectComposer;
  sun: THREE.DirectionalLight;
  set: THREE.Group;
  assets: CharacterAssets;
  nog: NonNullable<typeof noggles>;
} | null = null;

const W = 900;
const H = 900;

export async function setup() {
  if (stage !== null) return;
  document.body.innerHTML = '';
  document.body.style.margin = '0';
  const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.BasicShadowMap;
  document.body.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xe1d7d5);
  const camera = new THREE.PerspectiveCamera(30, W / H, 0.05, 1000);
  const sun = new THREE.DirectionalLight(0xfff1dc, 1.7);
  sun.position.set(4, 9, 6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -4;
  sc.right = 4;
  sc.top = 4;
  sc.bottom = -4;
  sc.near = 0.5;
  sc.far = 30;
  sun.shadow.bias = -0.0012;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x8a7a68, 0.75));
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(300, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xe1d7d5 }),
  );
  const catcher = new THREE.Mesh(
    new THREE.CircleGeometry(300, 48).rotateX(-Math.PI / 2),
    new THREE.ShadowMaterial({ color: 0x552e52, opacity: 0.32 }),
  );
  catcher.position.y = 0.001;
  catcher.receiveShadow = true;
  scene.add(ground, catcher);
  const set = new THREE.Group();
  scene.add(set);

  // The game's toon post: normals for creases + ink outline + clamp
  const composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
  composer.addPass(new RenderPass(scene, camera));
  const normalPass = new NormalPass(scene, camera);
  composer.addPass(normalPass);
  composer.addPass(
    new EffectPass(
      camera,
      new InkOutlineEffect({ normalBuffer: normalPass.texture, thickness: 2.0 }),
    ),
  );
  composer.addPass(new EffectPass(camera, new ClampEffect()));
  composer.setSize(W, H);

  const [assets, nog] = await Promise.all([loadCharacterAssets(), loadNoggles()]);
  stage = { renderer, scene, camera, composer, sun, set, assets, nog };
}

export interface ShotSpec {
  variant: string;
  pose: PoseName;
  phase?: number;
  /** Camera yaw round the subject (deg; 0 = front), pitch (deg), distance (m). */
  yaw: number;
  pitch?: number;
  dist?: number;
  /** Look-at height (m). */
  lookY?: number;
  /** Rider + follow mode. */
  rider?: 'head' | 'beside' | 'fly' | 'scale';
  /** Rotate the pet (deg) about y. */
  petYaw?: number;
}

const RIDER_SEED = { background: 0, body: 13, accessory: 12, head: 22, glasses: 0 };

function makeRider(assets: CharacterAssets, clip: string, onBoard: boolean, t: number) {
  const ch = new NounCharacter(RIDER_SEED, assets);
  ch.setBoardType('skate');
  ch.board.visible = onBoard;
  toonify(ch.root);
  ch.play({ clip, fade: 0 });
  for (let i = 0; i < Math.round(t * 60); i++)
    ch.update(1 / 60, { lean: 0, travelled: i * 0.05, riding: onBoard, grounded: true });
  ch.root.updateMatrixWorld(true);
  return ch;
}

export async function shot(spec: ShotSpec): Promise<string> {
  await setup();
  const st = stage!;
  st.set.clear();
  if (spec.variant === 'lineup') return lineup(spec);
  const v = VARIANTS.find(x => x.id === spec.variant)!;
  const pet = buildPet(v, st.nog);
  toonify(pet.root);
  pose(pet, spec.pose, spec.phase ?? 0.25);
  pet.root.rotation.y += ((spec.petYaw ?? 0) * Math.PI) / 180;
  st.set.add(pet.root);
  let look = new THREE.Vector3(0, spec.lookY ?? pet.height * 0.45, 0);

  if (spec.rider !== undefined) {
    const mode = spec.rider;
    const ch = makeRider(
      st.assets,
      mode === 'beside' ? 'run' : mode === 'fly' ? 'skate_push' : 'idle',
      mode === 'fly',
      mode === 'beside' ? 0.42 : 1.2,
    );
    st.set.add(ch.root);
    ch.root.updateMatrixWorld(true);
    const hb = new THREE.Box3().setFromObject(ch.head!);
    if (mode === 'head') {
      pet.root.position.set((hb.min.x + hb.max.x) / 2, hb.max.y, (hb.min.z + hb.max.z) / 2 + 0.05);
    } else if (mode === 'beside') {
      pet.root.position.set(-0.7, pet.root.position.y, 0.6);
    } else if (mode === 'fly') {
      pet.root.position.set(0.95, hb.min.y + (hb.max.y - hb.min.y) * 0.45, 0.35);
    } else {
      pet.root.position.set(-1.0, pet.root.position.y, 0.3);
    }
    pet.root.updateMatrixWorld(true);
    const all = new THREE.Box3().setFromObject(st.set);
    look = all.getCenter(new THREE.Vector3());
  }

  const yaw = (spec.yaw * Math.PI) / 180;
  const pitch = ((spec.pitch ?? 14) * Math.PI) / 180;
  const fit = new THREE.Box3().setFromObject(st.set);
  if (spec.rider === 'head') {
    // the head + the pet on it, with a bit of shoulder
    fit.copy(new THREE.Box3().setFromObject(pet.root));
    fit.union(new THREE.Box3().setFromObject(st.set.children[1]!));
    fit.min.y = fit.max.y - 1.35;
  } else if (spec.rider === 'beside') {
    // the pet at the rider's heels, the rider's head just in
    fit.max.y = 1.55;
  } else if (spec.rider === 'fly') {
    // the pet at the rider's shoulder: chest up
    fit.min.y = fit.max.y - 1.25;
  }
  const sph = fit.getBoundingSphere(new THREE.Sphere());
  look.copy(sph.center);
  const dist =
    spec.dist ?? (sph.radius / Math.sin(THREE.MathUtils.degToRad(st.camera.fov / 2))) * 1.02;
  st.camera.position.set(
    look.x + Math.sin(yaw) * Math.cos(pitch) * dist,
    look.y + Math.sin(pitch) * dist,
    look.z + Math.cos(yaw) * Math.cos(pitch) * dist,
  );
  st.camera.lookAt(look);
  st.sun.target.position.copy(look);
  st.sun.position.copy(look).add(new THREE.Vector3(4, 9, 6));
  st.composer.render();
  return st.renderer.domElement.toDataURL('image/png');
}

/** Every variant standing in a row beside one rider. */
function lineup(spec: ShotSpec): string {
  const st = stage!;
  const ch = makeRider(st.assets, 'idle', false, 1.2);
  st.set.add(ch.root);
  let x = 0.85;
  for (const v of VARIANTS) {
    const pet = buildPet(v, st.nog);
    toonify(pet.root);
    pose(pet, spec.pose);
    pet.root.position.set(x, 0, 0.1);
    pet.root.rotation.y = -0.25;
    st.set.add(pet.root);
    x += 0.62;
  }
  const sph = new THREE.Box3().setFromObject(st.set).getBoundingSphere(new THREE.Sphere());
  const yaw = (spec.yaw * Math.PI) / 180;
  const pitch = ((spec.pitch ?? 6) * Math.PI) / 180;
  const dist = (sph.radius / Math.sin(THREE.MathUtils.degToRad(st.camera.fov / 2))) * 1.0;
  st.camera.position.set(
    sph.center.x + Math.sin(yaw) * Math.cos(pitch) * dist,
    sph.center.y + Math.sin(pitch) * dist,
    sph.center.z + Math.cos(yaw) * Math.cos(pitch) * dist,
  );
  st.camera.lookAt(sph.center);
  st.sun.target.position.copy(sph.center);
  st.sun.position.copy(sph.center).add(new THREE.Vector3(4, 9, 6));
  st.composer.render();
  return st.renderer.domElement.toDataURL('image/png');
}

/** Sizes, for the report. */
export async function measure() {
  await setup();
  const st = stage!;
  const out: Record<string, number> = {};
  for (const v of VARIANTS) {
    const p = buildPet(v, st.nog);
    pose(p, 'stand');
    out[v.id] = +new THREE.Box3().setFromObject(p.root).getSize(new THREE.Vector3()).y.toFixed(2);
  }
  const ch = makeRider(st.assets, 'idle', false, 1);
  const b = new THREE.Box3().setFromObject(ch.root);
  const hb = new THREE.Box3().setFromObject(ch.head!);
  out.rider = +(b.max.y - b.min.y).toFixed(2);
  out.riderHeadW = +(hb.max.x - hb.min.x).toFixed(2);
  out.riderHeadTop = +hb.max.y.toFixed(2);
  return out;
}

(window as unknown as { petConcepts: unknown }).petConcepts = { shot, measure, setup, VARIANTS };
