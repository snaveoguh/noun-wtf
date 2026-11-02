// ── MOCHI, the voxel model: one skinned mesh, one draw ─────────────────────
//
// Built from voxels like a Noun: superellipsoid blobs (head, body), disc
// ears, bat wings, a tail of little segments, stubby legs, and the hip-rose
// noggles from the Nouns art (noggles.ts). Every part is rigidly bound to
// its own bone, so the whole pet is ONE SkinnedMesh with vertex colours:
// one draw (plus its shadow), no textures (nothing for the texture diet to
// shrink). Face bits that swap (open mouth, shut eyes) are bones scaled to
// nothing when hidden.

import type { PetPose } from './pose';

import * as THREE from 'three';

import { hipRoseNoggles } from './noggles';

/** One look's shape + colours (all Nouns palette). Voxel units unless noted. */
export interface PetSpec {
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
  head: [number, number, number];
  headP: number;
  body: [number, number, number];
  bodyP: number;
  earR: number;
  earSplay: number;
  wingSpan: number;
  tail: number;
  legs: number;
}

/** MOCHI exactly as on the owner's pick (.claude/camp-pet-shots/concepts/mochi.png). */
export const MOCHI: PetSpec = {
  v: 0.0165,
  skin: 0xe4afa3,
  shade: 0xd18687,
  ear: 0xff82ad,
  belly: 0xf9e8dd,
  nose: 0xd26451,
  cheek: 0xff82ad,
  wing: 0xd596a6,
  wingBone: 0xd18687,
  head: [7.5, 6.5, 6.5],
  headP: 3.2,
  body: [5, 5, 5],
  bodyP: 2.8,
  earR: 6,
  earSplay: 0.42,
  wingSpan: 10,
  tail: 12,
  legs: 1,
};

const DARK = 0x552e52; // mouth, shut eyes (Nouns palette plum)
const WHITE = 0xffffff;
const TONGUE = 0xfb4694;

export const BONES = [
  'root',
  'body',
  'head',
  'noggles',
  'earL',
  'earR',
  'wingL',
  'wingR',
  'legFL',
  'legFR',
  'legBL',
  'legBR',
  'mouth',
  'mouthOpen',
  'eyesShut',
  'tail0',
  'tail1',
  'tail2',
  'tail3',
  'tail4',
  'tail5',
] as const;
type BoneName = (typeof BONES)[number];
const PARENT: Record<BoneName, BoneName | null> = {
  root: null,
  body: 'root',
  head: 'body',
  noggles: 'head',
  earL: 'head',
  earR: 'head',
  wingL: 'body',
  wingR: 'body',
  legFL: 'body',
  legFR: 'body',
  legBL: 'body',
  legBR: 'body',
  mouth: 'head',
  mouthOpen: 'head',
  eyesShut: 'head',
  tail0: 'body',
  tail1: 'tail0',
  tail2: 'tail1',
  tail3: 'tail2',
  tail4: 'tail3',
  tail5: 'tail4',
};

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

/** Accumulates quads for one skinned geometry. */
class Builder {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  skin: number[] = [];
  idx: number[] = [];
  private c = new THREE.Color();

  /** Voxels (integer cells) scaled by s; `depth` scales the cells' z extent (decals). */
  vox(vox: Vox, s: number, bone: number, depth = 1, ox = 0, oy = 0, oz = 0) {
    for (const [k, hex] of vox) {
      const [x, y, z] = k.split(',').map(Number) as [number, number, number];
      this.cell(
        x,
        y,
        z,
        s,
        hex,
        bone,
        n => vox.has(key(x + n[0]!, y + n[1]!, z + n[2]!)),
        depth,
        ox,
        oy,
        oz,
      );
    }
  }

  cell(
    x: number,
    y: number,
    z: number,
    s: number,
    hex: number,
    bone: number,
    hidden: (n: number[]) => boolean,
    depth = 1,
    ox = 0,
    oy = 0,
    oz = 0,
  ) {
    this.c.setHex(hex);
    for (const [n, quad] of FACES) {
      if (hidden(n)) continue;
      const b = this.pos.length / 3;
      for (const q of quad) {
        this.pos.push(ox + (x + q[0]!) * s, oy + (y + q[1]!) * s, oz + (z + q[2]! * depth) * s);
        this.nor.push(n[0]!, n[1]!, n[2]!);
        this.col.push(this.c.r, this.c.g, this.c.b);
        this.skin.push(bone, 0, 0, 0);
      }
      this.idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
    }
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.skin, 4));
    const w = new Float32Array((this.skin.length / 4) * 4);
    for (let i = 0; i < w.length; i += 4) w[i] = 1;
    g.setAttribute('skinWeight', new THREE.BufferAttribute(w, 4));
    g.setIndex(this.idx);
    return g;
  }
}

function blob(
  out: Vox,
  c: [number, number, number],
  r: [number, number, number],
  p: number,
  col: (u: [number, number, number], y: number) => number,
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
          out.set(key(x, y, z), col(u, y));
      }
}

export interface PetRig {
  mesh: THREE.SkinnedMesh;
  bones: Record<BoneName, THREE.Bone>;
  /** Rest positions (bone.position at bind), for drops. */
  rest: Record<BoneName, THREE.Vector3>;
  /** Hip height (m), for the sit / sleep drop. */
  hip: number;
  /** Standing height (m). */
  height: number;
  /** The material (each pet its own: the perch warmth is per pet). */
  material: THREE.Material & { emissive?: THREE.Color; emissiveIntensity?: number };
}

const geoCache = new Map<
  PetSpec,
  { geo: THREE.BufferGeometry; pivots: Record<BoneName, THREE.Vector3>; hip: number }
>();

/** Build the geometry + bone pivots once per look; every pet shares them. */
function build(spec: PetSpec) {
  const hit = geoCache.get(spec);
  if (hit !== undefined) return hit;
  const s = spec.v;
  const B = new Builder();
  const bi = (n: BoneName) => BONES.indexOf(n);
  const pivots = {} as Record<BoneName, THREE.Vector3>;
  const legLen = spec.legs;
  const bodyC: [number, number, number] = [0, legLen + spec.body[1], -1];
  const headC: [number, number, number] = [
    0,
    bodyC[1] + spec.body[1] * 0.55 + spec.head[1] * 0.8,
    bodyC[2] + spec.body[2] * 0.35,
  ];
  const pv = (n: BoneName, p: [number, number, number]) =>
    (pivots[n] = new THREE.Vector3(p[0] * s, p[1] * s, p[2] * s));
  pv('root', [0, 0, 0]);

  // Body, belly patch on the front
  const body: Vox = new Map();
  blob(body, bodyC, spec.body, spec.bodyP, u =>
    u[2] > 0.35 && Math.abs(u[0]) < 0.6 && u[1] < 0.5 ? spec.belly : spec.skin,
  );
  pv('body', [0, bodyC[1] - spec.body[1] * 0.6, bodyC[2]]);
  B.vox(body, s, bi('body'));

  // Head, nose, cheeks
  const head: Vox = new Map();
  blob(head, headC, spec.head, spec.headP, (u, y) =>
    u[1] < -0.55 && u[2] > 0.2
      ? spec.belly
      : y < headC[1] - spec.head[1] * 0.2 && u[2] < -0.5
        ? spec.shade
        : spec.skin,
  );
  const front = Math.max(...[...head.keys()].map(k => Number(k.split(',')[2])));
  const fy = Math.round(headC[1] - spec.head[1] * 0.35);
  head.set(key(0, fy, front + 1), spec.nose);
  head.set(key(-1, fy, front + 1), spec.nose);
  const surface = (x: number, y: number) => {
    for (let z = front + 1; z > front - 20; z--) if (head.has(key(x, y, z))) return z;
    return front;
  };
  const cheekX = Math.round(spec.head[0] * 0.62);
  for (const cx of [-cheekX - 1, cheekX, -cheekX, cheekX - 1])
    head.set(key(cx, fy, surface(cx, fy)), spec.cheek);
  pv('head', [0, headC[1] - spec.head[1] * 0.75, headC[2] - 1]);
  B.vox(head, s, bi('head'));

  // Face bits: thin decals just off the head's surface
  const decal = (n: BoneName, cells: [number, number, number][]) => {
    const m: Vox = new Map();
    for (const [x, y, hex] of cells) m.set(key(x, y, surface(x, y) + 1), hex);
    pivots[n] = pivots.head.clone();
    B.vox(m, s, bi(n), 0.15);
  };
  const my = fy - 2;
  decal('mouth', [
    [-1, my, WHITE],
    [0, my, WHITE],
    [-2, my + 1, DARK],
    [1, my + 1, DARK],
  ]);
  decal('mouthOpen', [
    [-2, my + 1, DARK],
    [-1, my + 1, DARK],
    [0, my + 1, DARK],
    [1, my + 1, DARK],
    [-2, my, DARK],
    [-1, my, TONGUE],
    [0, my, TONGUE],
    [1, my, DARK],
  ]);
  const ey = Math.round(headC[1] + spec.head[1] * 0.2);
  const ex = Math.round(spec.head[0] * 0.45);
  decal('eyesShut', [
    [-ex - 2, ey, DARK],
    [-ex - 1, ey - 1, DARK],
    [-ex, ey, DARK],
    [ex - 1, ey, DARK],
    [ex, ey - 1, DARK],
    [ex + 1, ey, DARK],
  ]);

  // Noggles: the art's lens span (columns 3..15) across the face, hinged at
  // the head's middle so sleep can push them up onto the forehead
  {
    const nog = hipRoseNoggles();
    const lensW = 13;
    const np = ((spec.head[0] * 2 + 1) * s) / (lensW + 2);
    pv('noggles', [0, headC[1], headC[2]]);
    const cy = (ey + 0.5) * s;
    const cz = (front + 1) * s + np * 0.35;
    const filled = new Set(nog.px.map(p => `${p.x},${p.y}`));
    for (const p of nog.px) {
      // art x runs to the viewer's right = the pet's left (−x in pet space)
      const X = -(p.x - 3 - (lensW - 1) / 2) * np;
      const Y = cy - (p.y - (nog.h - 1) / 2) * np;
      B.cell(
        0,
        0,
        0,
        np,
        p.hex,
        bi('noggles'),
        n =>
          n[2] === 0 && n[1] === 0
            ? filled.has(`${p.x - n[0]!},${p.y}`)
            : n[2] === 0 && n[0] === 0
              ? filled.has(`${p.x},${p.y - n[1]!}`)
              : false,
        0.7,
        X - np / 2,
        Y - np / 2,
        cz - np * 0.35,
      );
    }
  }

  // Ears: discs, the inside pink
  for (const sx of [-1, 1]) {
    const ear: Vox = new Map();
    const R = spec.earR;
    const ex0 = sx * (spec.head[0] * 0.42 + R * 0.4);
    const base: [number, number, number] = [ex0, headC[1] + spec.head[1] * 0.6, headC[2] - 1];
    for (let a = -Math.ceil(R); a <= Math.ceil(R); a++)
      for (let b = 0; b <= Math.ceil(R * 2); b++) {
        const u = (a + 0.5) / R;
        const w = (b + 0.5 - R) / R;
        if (u * u + w * w > 1) continue;
        const inner = Math.hypot(u, w) < 0.62 && b > 1;
        const x = Math.round(base[0] + a);
        const y = Math.round(base[1] + b);
        ear.set(key(x, y, Math.round(base[2])), spec.skin);
        ear.set(key(x, y, Math.round(base[2]) + 1), inner ? spec.ear : spec.skin);
      }
    const n: BoneName = sx < 0 ? 'earR' : 'earL';
    pv(n, base);
    B.vox(ear, s, bi(n));
  }

  // Bat wings, flat from the shoulder outward
  for (const sx of [-1, 1]) {
    const w: Vox = new Map();
    const span = spec.wingSpan;
    const sh: [number, number, number] = [
      sx * (spec.body[0] * 0.7),
      bodyC[1] + spec.body[1] * 0.35,
      bodyC[2] - spec.body[2] * 0.3,
    ];
    const zc = Math.round(sh[2]);
    const put = (a: number, b: number, hex: number) =>
      w.set(key(Math.round(sh[0] + sx * a) - (sx < 0 ? 1 : 0), Math.round(sh[1] + b), zc), hex);
    const fingers = [0.5, 0.78, 1].map(f => f * span);
    for (let a = 0; a <= span; a++) {
      const top = Math.round(Math.sin((a / span) * Math.PI * 0.9) * span * 0.32);
      let edge = -span * 0.55 * (1 - a / span) ** 0.8;
      for (const f of fingers) edge = Math.max(edge, -Math.abs(a - f) * 0.8 - (f / span) * 2);
      edge = Math.min(edge, top - 1);
      for (let b = Math.round(edge); b <= top; b++)
        put(a, b, b === top ? spec.wingBone : spec.wing);
    }
    const n: BoneName = sx < 0 ? 'wingR' : 'wingL';
    pv(n, sh);
    B.vox(w, s, bi(n));
  }

  // Tail: six little segments off the rump, each its own joint
  {
    const n = 6;
    const segLen = Math.max(1, Math.round(spec.tail / n));
    let p: [number, number, number] = [
      0,
      bodyC[1] - spec.body[1] * 0.45,
      bodyC[2] - spec.body[2] + 0.5,
    ];
    for (let i = 0; i < n; i++) {
      const seg: Vox = new Map();
      for (let j = 0; j < segLen; j++)
        seg.set(
          key(-1, Math.round(p[1]), Math.round(p[2]) - 1 - j),
          i === n - 1 && j === segLen - 1 ? spec.nose : spec.shade,
        );
      const nm = `tail${i}` as BoneName;
      pv(nm, [p[0] - 0.5, Math.round(p[1]), Math.round(p[2])]);
      B.vox(seg, s, bi(nm));
      p = [p[0], p[1], p[2] - segLen];
    }
  }

  // Stubby legs: little front paws, chunkier back feet
  const legDefs: [BoneName, number, number, number][] = [
    ['legFL', 1, bodyC[2] + spec.body[2] * 0.4, 3],
    ['legFR', -1, bodyC[2] + spec.body[2] * 0.4, 3],
    ['legBL', 1, bodyC[2] - spec.body[2] * 0.4, 4],
    ['legBR', -1, bodyC[2] - spec.body[2] * 0.4, 4],
  ];
  const hipY = legLen + 1;
  for (const [n, sx, z, len] of legDefs) {
    const lx = sx * Math.max(1.5, spec.body[0] * 0.42);
    const leg: Vox = new Map();
    for (let y = 0; y <= hipY; y++)
      for (let a = 0; a < 3; a++)
        for (let b = 0; b < (y === 0 ? len : 3); b++)
          leg.set(
            key(Math.round(lx) - (sx < 0 ? 3 : 0) + a, y, Math.round(z) + b - 1),
            y === 0 ? spec.shade : spec.skin,
          );
    pv(n, [lx, hipY, z]);
    B.vox(leg, s, bi(n));
  }

  const geo = B.geometry();
  geo.computeBoundingBox();
  // sitting / sleeping lowers the body by about its pivot's height
  const out = { geo, pivots, hip: pivots.body.y };
  geoCache.set(spec, out);
  return out;
}

/** A new pet rig (shared geometry, its own bones + material). */
export function makePet(spec: PetSpec = MOCHI, material?: THREE.Material): PetRig {
  const { geo, pivots, hip } = build(spec);
  const bones = {} as Record<BoneName, THREE.Bone>;
  const rest = {} as Record<BoneName, THREE.Vector3>;
  for (const n of BONES) {
    const b = new THREE.Bone();
    b.name = n;
    const par = PARENT[n];
    b.position.copy(pivots[n]);
    if (par !== null) b.position.sub(pivots[par]);
    rest[n] = b.position.clone();
    bones[n] = b;
    if (par !== null) bones[par].add(b);
  }
  const mat =
    material ??
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0, name: 'pet' });
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.name = 'pet';
  mesh.add(bones.root);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(BONES.map(n => bones[n])));
  // any pose stays within ~1.6x the standing box (wings out, a hop)
  mesh.computeBoundingSphere();
  mesh.boundingSphere!.radius *= 1.6;
  const height = geo.boundingBox!.max.y - geo.boundingBox!.min.y;
  return { mesh, bones, rest, hip, height, material: mat as PetRig['material'] };
}

/** Set the rig's bones from a pose (the root is placed by the caller). */
export function applyPose(r: PetRig, p: PetPose) {
  const B = r.bones;
  B.root.position.set(0, p.lift, 0);
  B.root.rotation.set(0, p.spin, 0);
  B.body.position.copy(r.rest.body);
  B.body.position.y -= p.drop;
  B.body.rotation.set(p.body[0], p.body[1], p.body[2]);
  B.head.rotation.set(p.head[0], p.head[1], p.head[2]);
  B.noggles.rotation.set(p.noggles, 0, 0);
  B.earL.rotation.set(p.earL[0], p.earL[1], p.earL[2]);
  B.earR.rotation.set(p.earR[0], p.earR[1], p.earR[2]);
  B.wingL.rotation.set(p.wingL[0], p.wingL[1], p.wingL[2]);
  B.wingR.rotation.set(p.wingR[0], p.wingR[1], p.wingR[2]);
  const fx = 1 - 0.5 * p.fold;
  const fy = 1 - 0.25 * p.fold;
  B.wingL.scale.set(fx, fy, 1);
  B.wingR.scale.set(fx, fy, 1);
  B.tail0.rotation.set(p.tailUp, p.tailSide, 0);
  for (const n of ['tail1', 'tail2', 'tail3', 'tail4', 'tail5'] as const)
    B[n].rotation.set(p.tailCurl, p.tailSide * 0.4, 0);
  B.legFL.rotation.set(p.legs[0], 0, 0);
  B.legFR.rotation.set(p.legs[1], 0, 0);
  B.legBL.rotation.set(p.legs[2], 0, 0);
  B.legBR.rotation.set(p.legs[3], 0, 0);
  const open = p.mouthOpen > 0.5;
  B.mouth.scale.setScalar(open ? 1e-4 : 1);
  B.mouthOpen.scale.setScalar(open ? 1 : 1e-4);
  B.eyesShut.scale.setScalar(p.eyesShut > 0.5 ? 1 : 1e-4);
}
