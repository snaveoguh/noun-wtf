// ── Outfit → the rigged Noun's lower half (three.js side of outfit.ts) ──
//
// Cheap on purpose: no new GLBs, no extra skinned meshes.
//   • Shape: the GLB's NounPants / NounShoe / NounSole geometries get a
//     per-style variant (vertices pushed in or out around the leg / foot
//     axis in bind space), built once per style and shared by every rider.
//     Shorts split the trouser mesh into material groups: pants above the
//     knee, skin calves, white socks over the ankles.
//   • Colour: small canvas textures in the GLB's UV layout (stripes,
//     pockets, panels, tread), cached per style + colour, shared.
//   • Extras: at most two tiny meshes per part (cargo pockets on the thigh
//     bones, high-top / boot collars on the shin bones, slide straps on the
//     foot bones), placed in bind space and re-expressed in bone space so
//     they ride with the animation. The screen-space ink pass outlines them.
//
// Bind-space numbers come from the GLB (character_manifest.json): legs at
// x = ±0.09, knee (shin bone) y = 0.30, ankle (foot bone) y = 0.085, soles
// at y = 0, toes toward +Z.

import * as THREE from 'three';

import { toToon } from '../render/Toon';

import { PANTS_COLORS, SHOE_COLORS, type Outfit, type PantsStyle, type ShoeStyle } from './outfit';

const LEG_X = 0.09;
const LEG_Z = 0.005;
const FOOT_Z = 0.06;
/** Shorts: triangles whose centre is below this are calf (skin / sock). */
const SHORTS_CUT = 0.318;
/** …and below this, sock. */
const SOCK_TOP = 0.15;

const smooth = (e0: number, e1: number, x: number) => {
  const t = THREE.MathUtils.clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Ankle-high shoes pull the trouser hem in so the collar shows. */
const tucks = (pants: PantsStyle, shoes: ShoeStyle) =>
  (shoes === 'hightop' || shoes === 'boot') && pants !== 'baggy' && pants !== 'shorts';

/** Radial scale of the trouser leg at bind height y (1 = the GLB's cargos). */
export function pantsScale(style: PantsStyle, y: number, tucked = false): number {
  let s: number;
  switch (style) {
    case 'baggy':
      // Roomy thighs, wide stacked hems over the shoes
      s = 1.2 + 0.38 * smooth(0.45, 0.1, y);
      break;
    case 'cargo':
      s = 1.12;
      break;
    case 'track':
      // Relaxed, cuffed at the ankle
      s = 1.05 - 0.14 * smooth(0.2, 0.12, y);
      break;
    case 'shorts':
      s = y >= 0.335 ? 1.2 : y <= 0.325 ? 0.78 : 1;
      break;
    case 'skinny':
      s = 0.8;
      break;
  }
  if (tucked && y < 0.24) s *= 1 - 0.2 * smooth(0.24, 0.17, y);
  return s;
}

// ── Geometry variants (shared per source geometry + style) ──────────────

const variants = new WeakMap<THREE.BufferGeometry, Map<string, THREE.BufferGeometry>>();

function variant(
  base: THREE.BufferGeometry,
  key: string,
  build: (g: THREE.BufferGeometry) => void,
): THREE.BufferGeometry {
  let m = variants.get(base);
  if (m === undefined) variants.set(base, (m = new Map()));
  let g = m.get(key);
  if (g === undefined) {
    g = base.clone();
    build(g);
    g.computeBoundingBox();
    g.computeBoundingSphere();
    m.set(key, g);
  }
  return g;
}

/** The trouser geometry for a style (groups: 0 pants, 1 skin, 2 sock for shorts). */
export function pantsGeometry(
  base: THREE.BufferGeometry,
  style: PantsStyle,
  tucked = false,
): THREE.BufferGeometry {
  return variant(base, `${style}${tucked ? '+t' : ''}`, g => {
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const leg = smooth(0.6, 0.47, y);
      if (leg <= 0) continue;
      const cx = x >= 0 ? LEG_X : -LEG_X;
      const k = 1 + (pantsScale(style, y, tucked) - 1) * leg;
      p.setXYZ(
        i,
        cx + (x - cx) * k,
        style === 'baggy' && y < 0.1 ? y - 0.012 : y,
        LEG_Z + (z - LEG_Z) * k,
      );
    }
    p.needsUpdate = true;
    if (style === 'shorts') splitShorts(g);
  });
}

/** Reorder the trouser triangles into pants / skin / sock material groups. */
function splitShorts(g: THREE.BufferGeometry) {
  const idx = g.index;
  if (idx === null) return;
  const p = g.attributes.position as THREE.BufferAttribute;
  const buckets: number[][] = [[], [], []];
  for (let t = 0; t < idx.count; t += 3) {
    const a = idx.getX(t);
    const b = idx.getX(t + 1);
    const c = idx.getX(t + 2);
    const cy = (p.getY(a) + p.getY(b) + p.getY(c)) / 3;
    buckets[cy >= SHORTS_CUT ? 0 : cy >= SOCK_TOP ? 1 : 2].push(a, b, c);
  }
  const all = [...buckets[0], ...buckets[1], ...buckets[2]];
  g.setIndex(all);
  g.clearGroups();
  let start = 0;
  buckets.forEach((b, mi) => {
    if (b.length > 0) g.addGroup(start, b.length, mi);
    start += b.length;
  });
}

interface ShoeShape {
  /** Upper: xz scale about the foot axis, y scale above the sole line. */
  xz: number;
  len: number;
  up: number;
  /** Sole: xz and y scale (thickness), extra heel lift. */
  soleXz: number;
  soleY: number;
  heel: number;
}

const SHOE_SHAPE: Record<ShoeStyle, ShoeShape> = {
  skate: { xz: 1.12, len: 1.04, up: 1.08, soleXz: 1.12, soleY: 1.3, heel: 0 },
  hightop: { xz: 1.04, len: 1, up: 1.12, soleXz: 1.05, soleY: 1.15, heel: 0 },
  runner: { xz: 0.94, len: 1.04, up: 0.86, soleXz: 0.96, soleY: 1.15, heel: 0.45 },
  boot: { xz: 1.08, len: 1.02, up: 1.1, soleXz: 1.1, soleY: 1.45, heel: 0.2 },
  slide: { xz: 0.94, len: 0.98, up: 0.66, soleXz: 1.06, soleY: 1.5, heel: 0 },
};

/** Shoe upper (`sole` false) or sole geometry for a style. */
export function shoeGeometry(
  base: THREE.BufferGeometry,
  style: ShoeStyle,
  sole: boolean,
): THREE.BufferGeometry {
  const s = SHOE_SHAPE[style];
  return variant(base, `${style}${sole ? ':sole' : ''}`, g => {
    const p = g.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      const cx = x >= 0 ? LEG_X : -LEG_X;
      const xz = sole ? s.soleXz : s.xz;
      // Heel lift: 1 at the heel (z ≈ -0.1), 0 from mid-foot forward
      const heel = 1 + s.heel * smooth(0.06, -0.1, z);
      const ny = sole ? y * s.soleY * heel : 0.042 + (y - 0.042) * s.up + (heel - 1) * 0.03;
      p.setXYZ(i, cx + (x - cx) * xz, ny, FOOT_Z + (z - FOOT_Z) * xz * s.len);
    }
    p.needsUpdate = true;
  });
}

// ── Textures (canvas, in the GLB's UV layout, cached per style + colour) ──

const TEX = 128;
const texCache = new Map<string, THREE.CanvasTexture>();

const css = (hex: number) => `#${(hex & 0xffffff).toString(16).padStart(6, '0')}`;
function shade(hex: number, k: number) {
  const c = new THREE.Color(hex);
  if (k < 1) c.multiplyScalar(k);
  else c.lerp(new THREE.Color(0xffffff), k - 1);
  return c.getHex();
}
const luma = (hex: number) =>
  (0.299 * ((hex >> 16) & 255) + 0.587 * ((hex >> 8) & 255) + 0.114 * (hex & 255)) / 255;
/** A detail colour that reads on `hex` (white on dark, near-black on light). */
const contrast = (hex: number) => (luma(hex) > 0.62 ? 0x24242a : 0xf4f1ea);

function makeTexture(
  key: string,
  paint: (r: (u0: number, v0: number, u1: number, v1: number, hex: number) => void) => void,
) {
  const hit = texCache.get(key);
  if (hit !== undefined) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = TEX;
  const ctx = c.getContext('2d');
  if (ctx !== null) {
    paint((u0, v0, u1, v1, hex) => {
      ctx.fillStyle = css(hex);
      const x0 = Math.round(u0 * TEX);
      const y0 = Math.round(v0 * TEX);
      ctx.fillRect(
        x0,
        y0,
        Math.max(1, Math.round(u1 * TEX) - x0),
        Math.max(1, Math.round(v1 * TEX) - y0),
      );
    });
  }
  const t = new THREE.CanvasTexture(c);
  t.flipY = false; // glTF UVs
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  texCache.set(key, t);
  return t;
}

/**
 * Trouser texture. UV layout (the GLB's): side seam column u ≈ 0.25 (outer
 * leg), front u ≈ 0.375, v 0 = waist → 1 = hem, pocket patch u .55–.95 / v .6–.9.
 */
export function pantsTexture(style: PantsStyle, color: number) {
  const base = PANTS_COLORS[color]?.hex ?? PANTS_COLORS[0].hex;
  return makeTexture(`p:${style}:${color}`, r => {
    r(0, 0, 1, 1, base);
    switch (style) {
      case 'baggy':
        // Worn knees and a light top-stitched outseam
        r(0.32, 0.42, 0.45, 0.72, shade(base, 1.18));
        r(0.246, 0, 0.256, 1, shade(base, 1.35));
        r(0, 0.95, 1, 1, shade(base, 0.82));
        break;
      case 'cargo':
        r(0.55, 0.6, 0.95, 0.9, shade(base, 0.82));
        r(0.55, 0.6, 0.95, 0.65, shade(base, 0.7));
        r(0.244, 0, 0.256, 1, shade(base, 0.8));
        break;
      case 'track': {
        const s = contrast(base);
        r(0.212, 0, 0.232, 1, s);
        r(0.268, 0, 0.288, 1, s);
        r(0, 0.93, 1, 1, shade(base, 0.75));
        break;
      }
      case 'shorts':
        r(0.244, 0, 0.256, 1, shade(base, 0.8));
        r(0, 0.5, 1, 0.56, shade(base, 0.85));
        break;
      case 'skinny':
        r(0.246, 0, 0.256, 1, shade(base, 0.78));
        // Ripped knees
        r(0.35, 0.5, 0.41, 0.53, 0xe9dccb);
        r(0.36, 0.555, 0.4, 0.57, 0xe9dccb);
        break;
    }
  });
}

/**
 * Shoe texture (shared by upper and sole). Upper: v 0 (heel) → 0.6 (toe),
 * u .125 inner side, .375 top, .625 outer side. Sole: v .62–.98.
 */
export function shoeTexture(style: ShoeStyle, color: number) {
  const base = SHOE_COLORS[color]?.hex ?? SHOE_COLORS[0].hex;
  const det = contrast(base);
  return makeTexture(`s:${style}:${color}`, r => {
    const sole = (hex: number, tread: number) => {
      r(0, 0.6, 1, 1, hex);
      for (const [u0, u1] of [
        [0.14, 0.2],
        [0.33, 0.5],
        [0.64, 0.72],
      ])
        r(u0, 0.6, u1, 1, tread);
    };
    switch (style) {
      case 'skate':
        r(0, 0, 1, 0.6, base);
        r(0.06, 0.07, 0.2, 0.37, det);
        r(0.66, 0.07, 0.8, 0.37, det);
        r(0.38, 0.23, 0.5, 0.35, det);
        sole(0xf4f1ea, 0x2a2a30);
        break;
      case 'hightop':
        r(0, 0, 1, 0.6, base);
        r(0, 0.5, 1, 0.6, 0xf4f1ea); // toe cap
        r(0.68, 0.08, 0.78, 0.2, det); // ankle badge
        r(0.06, 0.08, 0.16, 0.2, det);
        for (let v = 0.26; v < 0.48; v += 0.06) r(0.34, v, 0.46, v + 0.025, 0xf4f1ea); // laces
        sole(0xf4f1ea, shade(base, 0.8));
        break;
      case 'runner':
        r(0, 0, 1, 0.6, base);
        // Stepped swoosh on both sides
        for (let i = 0; i < 4; i++) {
          r(0.04 + i * 0.03, 0.1 + i * 0.08, 0.14 + i * 0.03, 0.2 + i * 0.08, det);
          r(0.6 + i * 0.03, 0.1 + i * 0.08, 0.7 + i * 0.03, 0.2 + i * 0.08, det);
        }
        r(0.38, 0, 0.5, 0.1, det); // heel tab
        sole(0xf4f1ea, luma(base) > 0.62 ? 0x2d5fd8 : base);
        break;
      case 'boot': {
        r(0, 0, 1, 0.6, base);
        r(0, 0, 1, 0.1, shade(base, 0.72)); // heel counter
        r(0, 0.48, 1, 0.6, shade(base, 0.8)); // toe cap
        for (let v = 0.16; v < 0.46; v += 0.06) r(0.35, v, 0.45, v + 0.02, 0x2a1d14);
        sole(0x3a2a1e, 0x22180f);
        break;
      }
      case 'slide':
        // The upper is a white sock; the slide is the sole + strap
        r(0, 0, 1, 0.6, 0xf2f0ea);
        r(0, 0, 1, 0.06, 0xd9d6cf);
        sole(base, shade(base, 0.75));
        break;
    }
  });
}

// ── Small parts ─────────────────────────────────────────────────────────

const partMats = new Map<number, THREE.MeshStandardMaterial>();
function partMat(hex: number, toon: boolean): THREE.Material {
  let m = partMats.get(hex);
  if (m === undefined) {
    m = new THREE.MeshStandardMaterial({ color: hex, roughness: 0.85, side: THREE.DoubleSide });
    partMats.set(hex, m);
  }
  return toon ? toToon(m) : m;
}

let partGeo: {
  pocket: THREE.BoxGeometry;
  flap: THREE.BoxGeometry;
  collar: THREE.CylinderGeometry;
  shaft: THREE.CylinderGeometry;
  strap: THREE.BoxGeometry;
} | null = null;
function getPartGeo() {
  if (partGeo !== null) return partGeo;
  partGeo = {
    pocket: new THREE.BoxGeometry(0.03, 0.1, 0.1),
    flap: new THREE.BoxGeometry(0.036, 0.026, 0.11),
    // Unit-height collars, scaled per rider
    collar: new THREE.CylinderGeometry(1, 1.04, 1, 8, 1, true),
    shaft: new THREE.CylinderGeometry(1.08, 1, 1, 8, 1, true),
    strap: new THREE.BoxGeometry(0.2, 0.04, 0.09),
  };
  return partGeo;
}

/** Widest trouser radius around a leg between y0 and y1 (bind space). */
function legRadius(g: THREE.BufferGeometry, side: number, y0: number, y1: number) {
  const p = g.attributes.position as THREE.BufferAttribute;
  let r = 0;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    if (y < y0 || y > y1 || x * side < 0.01) continue;
    r = Math.max(r, Math.hypot(x - side * LEG_X, p.getZ(i) - LEG_Z));
  }
  return r;
}

interface LegBones {
  thigh: THREE.Bone;
  shin: THREE.Bone;
  foot: THREE.Bone;
}

/**
 * Dresses one rigged Noun model. Find the trouser / shoe / sole meshes by
 * material name once; `apply()` swaps geometry, textures and parts. Works
 * before or after toonify() (it reads whatever material is on the mesh).
 */
export class OutfitDresser {
  private pants: THREE.SkinnedMesh[] = [];
  private shoes: THREE.SkinnedMesh[] = [];
  private soles: THREE.SkinnedMesh[] = [];
  private skin: THREE.Mesh | null = null;
  private legs: LegBones[] = [];
  private skeleton: THREE.Skeleton | null = null;
  private bindMatrix = new THREE.Matrix4();
  private pantsParts: THREE.Object3D[] = [];
  private shoeParts: THREE.Object3D[] = [];
  private shoePartsHidden = false;
  /** Each mesh's GLB geometry (the variants are built from it). */
  private base = new Map<THREE.Mesh, THREE.BufferGeometry>();

  constructor(model: THREE.Object3D) {
    model.traverse(o => {
      const m = o as THREE.SkinnedMesh;
      if (!m.isMesh) return;
      const mat = Array.isArray(m.material) ? m.material[0] : m.material;
      const n = mat?.name ?? '';
      if (/nounpants/i.test(n)) this.pants.push(m);
      else if (/nounshoe/i.test(n)) this.shoes.push(m);
      else if (/nounsole/i.test(n)) this.soles.push(m);
      else if (/nounskin/i.test(n)) this.skin = m;
      if (m.isSkinnedMesh && this.skeleton === null) {
        this.skeleton = m.skeleton;
        this.bindMatrix.copy(m.bindMatrix);
      }
      this.base.set(m, m.geometry);
    });
    const bone = (name: string) => {
      const want = name.replace(/[.:_]/g, '').toLowerCase();
      return (this.skeleton?.bones.find(b => b.name.replace(/[.:_]/g, '').toLowerCase() === want) ??
        null) as THREE.Bone | null;
    };
    for (const s of ['l', 'r']) {
      const thigh = bone(`thigh${s}`);
      const shin = bone(`shin${s}`);
      const foot = bone(`foot${s}`);
      if (thigh !== null && shin !== null && foot !== null) this.legs.push({ thigh, shin, foot });
    }
  }

  get ok() {
    return this.pants.length > 0 || this.shoes.length > 0;
  }

  /** Hide the collars / straps (inline skates go over the shoes). */
  setShoePartsHidden(hidden: boolean) {
    this.shoePartsHidden = hidden;
    for (const o of this.shoeParts) o.visible = !hidden;
  }

  apply(o: Outfit) {
    const isToon = (m: THREE.Material | undefined) =>
      (m as THREE.MeshToonMaterial | undefined)?.isMeshToonMaterial === true;
    const tucked = tucks(o.pants, o.shoes);
    const pantsTex = pantsTexture(o.pants, o.pantsColor);
    let toon = false;
    for (const m of this.pants) {
      const cur = Array.isArray(m.material) ? m.material : [m.material];
      // Group 0 is always the trouser material (toonify maps arrays in place)
      const own = cur[0];
      toon = toon || isToon(own);
      const mat = own as THREE.MeshStandardMaterial;
      mat.map = pantsTex;
      mat.color.set(0xffffff);
      const base = this.base.get(m) ?? m.geometry;
      m.geometry = pantsGeometry(base, o.pants, tucked);
      if (o.pants === 'shorts') {
        const skinMat = (this.skin?.material as THREE.Material | undefined) ?? own;
        m.material = [own, skinMat, partMat(0xf4f2ec, isToon(own))];
      } else {
        m.material = own;
      }
    }
    const shoeTex = shoeTexture(o.shoes, o.shoeColor);
    for (const [list, sole] of [
      [this.shoes, false],
      [this.soles, true],
    ] as const) {
      for (const m of list) {
        const mat = (
          Array.isArray(m.material) ? m.material[0] : m.material
        ) as THREE.MeshStandardMaterial;
        toon = toon || isToon(mat);
        mat.map = shoeTex;
        mat.color.set(0xffffff);
        m.geometry = shoeGeometry(this.base.get(m) ?? m.geometry, o.shoes, sole);
      }
    }
    this.buildParts(o, toon);
  }

  private clearParts(list: THREE.Object3D[]) {
    for (const p of list) p.removeFromParent();
    list.length = 0;
  }

  /** Author a part in bind space at `pos`, then hang it on `bone`. */
  private attach(
    mesh: THREE.Mesh,
    bone: THREE.Bone,
    pos: THREE.Vector3,
    scale?: THREE.Vector3,
  ): THREE.Mesh {
    mesh.position.copy(pos);
    if (scale !== undefined) mesh.scale.copy(scale);
    mesh.updateMatrix();
    const i = this.skeleton?.bones.indexOf(bone) ?? -1;
    // Bind space → bone space (what skinning does to the GLB's own vertices)
    const inv = i >= 0 ? this.skeleton!.boneInverses[i].clone() : new THREE.Matrix4();
    mesh.applyMatrix4(inv.multiply(this.bindMatrix));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = 'outfitPart';
    bone.add(mesh);
    return mesh;
  }

  private buildParts(o: Outfit, toon: boolean) {
    this.clearParts(this.pantsParts);
    this.clearParts(this.shoeParts);
    if (this.legs.length !== 2) return;
    const g = getPartGeo();
    const pantsHex = PANTS_COLORS[o.pantsColor]?.hex ?? PANTS_COLORS[0].hex;
    const shoeHex = SHOE_COLORS[o.shoeColor]?.hex ?? SHOE_COLORS[0].hex;
    const pantsGeo = this.pants[0]?.geometry ?? null;
    this.legs.forEach((leg, i) => {
      const side = i === 0 ? 1 : -1;
      if (o.pants === 'cargo' && pantsGeo !== null) {
        // Thigh pockets on the outer leg, just proud of the cloth
        const r = legRadius(pantsGeo, side, 0.36, 0.46);
        const x = side * (LEG_X + r + 0.008);
        const pocket = new THREE.Mesh(g.pocket, partMat(shade(pantsHex, 0.84), toon));
        this.pantsParts.push(this.attach(pocket, leg.thigh, new THREE.Vector3(x, 0.39, LEG_Z)));
        const flap = new THREE.Mesh(g.flap, partMat(shade(pantsHex, 0.68), toon));
        this.pantsParts.push(
          this.attach(flap, leg.thigh, new THREE.Vector3(x + side * 0.004, 0.445, LEG_Z)),
        );
      }
      if ((o.shoes === 'hightop' || o.shoes === 'boot') && pantsGeo !== null) {
        const boot = o.shoes === 'boot';
        const y0 = 0.1;
        const y1 = boot ? 0.27 : 0.21;
        // Hug the (tucked) trouser leg; baggy hems simply stack over it
        const r = Math.max(0.072, Math.min(0.11, legRadius(pantsGeo, side, y0 + 0.03, y1) + 0.01));
        const hex = boot ? shade(shoeHex, 0.86) : shoeHex;
        const m = new THREE.Mesh(boot ? g.shaft : g.collar, partMat(hex, toon));
        this.shoeParts.push(
          this.attach(
            m,
            leg.shin,
            new THREE.Vector3(side * LEG_X, (y0 + y1) / 2, LEG_Z - 0.008),
            new THREE.Vector3(r, y1 - y0, r * 1.05),
          ),
        );
        if (!boot) {
          // Padded white rim
          const rim = new THREE.Mesh(g.collar, partMat(0xf4f1ea, toon));
          this.shoeParts.push(
            this.attach(
              rim,
              leg.shin,
              new THREE.Vector3(side * LEG_X, y1 + 0.008, LEG_Z - 0.008),
              new THREE.Vector3(r + 0.006, 0.02, (r + 0.006) * 1.05),
            ),
          );
        }
      } else if (o.shoes === 'slide') {
        const strap = new THREE.Mesh(g.strap, partMat(shoeHex, toon));
        this.shoeParts.push(
          this.attach(strap, leg.foot, new THREE.Vector3(side * LEG_X, 0.085, 0.07)),
        );
      }
    });
    for (const p of this.shoeParts) p.visible = !this.shoePartsHidden;
  }
}
