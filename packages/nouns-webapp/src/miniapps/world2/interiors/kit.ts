// ── The interior kit: low-poly, vertex-coloured, toon-friendly ─────────
//
// Everything in a room is built in its own local frame and pushed into a
// Kit, which merges it by material: `solid` (vertex colours, lit, goes
// toon), `glow` (unlit vertex colours: lamp shades, screens, neon), `art`
// and `artGlow` (the room's canvas atlas: posters, frames, menus, the view
// out of the windows), plus `glass`. Small things there are lots of
// (books, bottles, cans, records, goods) go into per-shape InstancedMeshes
// with a colour per instance. A room is about 8–12 draw calls.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export type Bucket = 'solid' | 'shell' | 'glow' | 'art' | 'artGlow' | 'glass';

const _c = new THREE.Color();

/** Bake one colour into a geometry (non-indexed; position, normal, color, uv). */
export function paint(
  g: THREE.BufferGeometry,
  color: number,
  m?: THREE.Matrix4,
): THREE.BufferGeometry {
  const geo = g.index !== null ? g.toNonIndexed() : g;
  if (geo !== g) g.dispose();
  if (m !== undefined) geo.applyMatrix4(m);
  for (const k of Object.keys(geo.attributes))
    if (k !== 'position' && k !== 'normal' && k !== 'uv') geo.deleteAttribute(k);
  if (geo.attributes.normal === undefined) geo.computeVertexNormals();
  if (geo.attributes.uv === undefined)
    geo.setAttribute(
      'uv',
      new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2),
    );
  _c.setHex(color);
  const n = geo.attributes.position.count;
  const ca = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    ca[i * 3] = _c.r;
    ca[i * 3 + 1] = _c.g;
    ca[i * 3 + 2] = _c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(ca, 3));
  geo.clearGroups();
  return geo;
}

/** Box spanning [x0, x1] × [y0, y1] × [z0, z1]. */
export function boxAt(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
  return new THREE.BoxGeometry(
    Math.max(1e-3, x1 - x0),
    Math.max(1e-3, y1 - y0),
    Math.max(1e-3, z1 - z0),
  ).translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
}

/** w × h × d box standing on y = y0, centred on (x, z). */
export function box(w: number, h: number, d: number, x = 0, y0 = 0, z = 0) {
  return new THREE.BoxGeometry(w, h, d).translate(x, y0 + h / 2, z);
}

export function cyl(rTop: number, rBot: number, h: number, seg = 10, x = 0, y0 = 0, z = 0) {
  return new THREE.CylinderGeometry(rTop, rBot, h, seg, 1).translate(x, y0 + h / 2, z);
}

export function sphere(r: number, x = 0, y = 0, z = 0, ws = 10, hs = 7) {
  return new THREE.SphereGeometry(r, ws, hs).translate(x, y, z);
}

/** A flat plane facing +z (for art / windows), centred at (x, y, z). */
export function panel(w: number, h: number, x = 0, y = 0, z = 0) {
  return new THREE.PlaneGeometry(w, h).translate(x, y, z);
}

/** A torus lying flat (a rim, a ring). */
export function ring(r: number, tube: number, y: number, seg = 16) {
  return new THREE.TorusGeometry(r, tube, 5, seg).rotateX(Math.PI / 2).translate(0, y, 0);
}

/** Shapes the instanced small props come in. */
export type SmallShape = 'book' | 'bottle' | 'can' | 'box' | 'record' | 'cup' | 'jar' | 'plantPot';

const SMALL: Record<SmallShape, () => THREE.BufferGeometry> = {
  book: () => box(0.05, 0.24, 0.17),
  bottle: () =>
    mergeGeometries(
      [cyl(0.035, 0.035, 0.2, 8), cyl(0.012, 0.03, 0.08, 6, 0, 0.2)].map(g => g.toNonIndexed()),
    )!,
  can: () => cyl(0.034, 0.034, 0.12, 8),
  box: () => box(0.16, 0.2, 0.12),
  record: () => box(0.31, 0.31, 0.012),
  cup: () => cyl(0.045, 0.035, 0.09, 8),
  jar: () => cyl(0.06, 0.06, 0.14, 8),
  plantPot: () =>
    mergeGeometries(
      [cyl(0.08, 0.06, 0.12, 8), sphere(0.11, 0, 0.2, 0, 7, 5)].map(g => g.toNonIndexed()),
    )!,
};

export class Kit {
  readonly geo: Record<Bucket, THREE.BufferGeometry[]> = {
    solid: [],
    shell: [],
    glow: [],
    art: [],
    artGlow: [],
    glass: [],
  };
  readonly small = new Map<SmallShape, { m: THREE.Matrix4; c: number }[]>();
  /** Collision boxes (room frame). */
  readonly col: THREE.Box3[] = [];
  /** The current item's frame (room frame); `add` goes through it. */
  frame = new THREE.Matrix4();

  /** Where `add` puts things by default ('shell' while building walls: they cast no shadow). */
  base: Bucket = 'solid';

  /** Add a geometry (consumed) in colour `color`, in the current frame. */
  add(g: THREE.BufferGeometry, color: number, bucket?: Bucket) {
    const b =
      bucket === undefined || (bucket === 'solid' && this.base === 'shell') ? this.base : bucket;
    this.geo[b].push(paint(g, color, this.frame));
  }

  /** A textured plane from the atlas slot (u0, v0)–(u1, v1). */
  addArt(g: THREE.BufferGeometry, uv: [number, number, number, number], glow = false) {
    const geo = g.index !== null ? g.toNonIndexed() : g;
    if (geo !== g) g.dispose();
    const a = geo.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < a.count; i++)
      a.setXY(i, a.getX(i) < 0.5 ? uv[0] : uv[2], a.getY(i) < 0.5 ? uv[1] : uv[3]);
    this.geo[glow ? 'artGlow' : 'art'].push(paint(geo, 0xffffff, this.frame));
  }

  /** A small prop instance at local (x, y, z), turned by `yaw`. */
  addSmall(shape: SmallShape, x: number, y: number, z: number, color: number, yaw = 0, s = 1) {
    const local = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw),
      new THREE.Vector3(s, s, s),
    );
    let list = this.small.get(shape);
    if (list === undefined) {
      list = [];
      this.small.set(shape, list);
    }
    list.push({ m: new THREE.Matrix4().multiplyMatrices(this.frame, local), c: color });
  }

  /** Build the meshes (one per non-empty bucket, one InstancedMesh per small shape). */
  build(
    mats: KitMaterials,
    shadows: boolean,
  ): {
    meshes: THREE.Object3D[];
    disposables: { dispose(): void }[];
    triangles: number;
  } {
    const meshes: THREE.Object3D[] = [];
    const disposables: { dispose(): void }[] = [];
    let triangles = 0;
    for (const b of Object.keys(this.geo) as Bucket[]) {
      const list = this.geo[b];
      if (list.length === 0) continue;
      const g = mergeGeometries(list, false);
      for (const q of list) q.dispose();
      if (g === null) continue;
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, mats[b]);
      mesh.name = `Interior:${b}`;
      mesh.castShadow = shadows && b === 'solid';
      mesh.receiveShadow = b === 'solid' || b === 'shell' || b === 'art';
      mesh.matrixAutoUpdate = false;
      meshes.push(mesh);
      disposables.push(g);
      triangles += g.attributes.position.count / 3;
    }
    for (const [shape, list] of this.small) {
      const g = SMALL[shape]();
      g.deleteAttribute('uv');
      const im = new THREE.InstancedMesh(g, mats.small, list.length);
      im.name = `Interior:small:${shape}`;
      list.forEach((it, i) => {
        im.setMatrixAt(i, it.m);
        im.setColorAt(i, _c.setHex(it.c));
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor !== null) im.instanceColor.needsUpdate = true;
      im.computeBoundingSphere();
      im.castShadow = false;
      im.receiveShadow = true;
      meshes.push(im);
      disposables.push(g, { dispose: () => im.dispose() });
      triangles +=
        ((g.index !== null ? g.index.count : g.attributes.position.count) / 3) * list.length;
    }
    return { meshes, disposables, triangles };
  }
}

export type KitMaterials = Record<Bucket | 'small', THREE.Material>;

/** A room's materials (the instanced small props take their colour per instance). */
export function kitMaterials(atlas: THREE.Texture): KitMaterials {
  const solid = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  solid.name = 'InteriorSolid';
  const glow = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  glow.name = 'InteriorGlow';
  const art = new THREE.MeshStandardMaterial({ map: atlas, roughness: 0.75 });
  art.name = 'InteriorArt';
  const artGlow = new THREE.MeshBasicMaterial({ map: atlas, toneMapped: false });
  artGlow.name = 'InteriorArtGlow';
  const glass = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.1,
    metalness: 0.1,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  glass.name = 'InteriorGlass';
  const small = new THREE.MeshStandardMaterial({ roughness: 0.7 });
  small.name = 'InteriorSmall';
  return { solid, shell: solid, glow, art, artGlow, glass, small };
}

/** Lighten / darken a hex colour by k (−1…1). */
export function shade(hex: number, k: number): number {
  _c.setHex(hex);
  if (k >= 0) _c.lerp(new THREE.Color(0xffffff), k);
  else _c.multiplyScalar(1 + k);
  return _c.getHex();
}

/** Free a subtree's materials (and their toon twins); `textures`: their own maps too. */
export function disposeMaterials(root: THREE.Object3D, textures = false) {
  root.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      const src = mat.userData.toonSrc as THREE.Material | undefined;
      if (textures) for (const x of [mat, src]) if (x !== undefined) disposeMaps(x);
      src?.dispose();
      mat.dispose();
    }
  });
}

const MAPS = [
  'map',
  'emissiveMap',
  'alphaMap',
  'normalMap',
  'aoMap',
  'roughnessMap',
  'metalnessMap',
] as const;

/**
 * Free a material's own textures (a character's shirt, head, board art).
 * Cached ones are re-uploaded if something else still draws them; the
 * shared toon ramp (gradientMap) is never touched.
 */
function disposeMaps(mat: THREE.Material) {
  const rec = mat as unknown as Record<string, THREE.Texture | null | undefined>;
  for (const k of MAPS) rec[k]?.dispose();
}
