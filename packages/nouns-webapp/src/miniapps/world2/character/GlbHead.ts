// ── Hand-modelled 3D heads ───────────────────────────────────────────────
//
// Two sets live in /models/heads, both in Nouns pixel units:
//
// • 3dnouns — 224 of the 258 heads. Aligned with the per-head nudges the
//   auction page's 3D view was tuned with; each ships a glasses mesh whose
//   texture we swap for this Noun's glasses.
//
// • noundry — Sebastien's VoxEdit voxel heads, exported with
//   vengi-voxconvert 0.4. Same pixel frame as the 2D art (x columns match
//   exactly, y up, front = +z); each file has its own vertical origin, so
//   seating goes by bounding box. Load-time fixes, none of which touch the
//   geometry's shape:
//     - Every material is metallic (no metallicFactor → glTF default 1.0)
//       with roughness 0.1 and KHR_materials_ior. three.js turns that into
//       a mirror, which with no environment map renders black. We rebuild
//       them as plain non-metallic materials.
//     - Colour comes from 256×1 palette textures with UVs on texel centres
//       and no sampler, so three.js would mipmap + linearly filter them.
//       Palettes are sampled nearest, without mipmaps.
//     - No normals are exported; per-face normals are computed (voxels are
//       flat, and toon materials don't carry flatShading).
//     - Hundreds of primitives/materials per file are merged per palette.
//     - Each file includes a stock pair of red noggles left at the origin
//       (under the chin): the exporter dropped node transforms. They're
//       left out and the caller keeps this Noun's own voxel glasses.
//   The dropped node transforms also collapsed parts of some models onto
//   their origin. That can't be recovered from the files, so those heads
//   are listed below and only shown with ?heads=noundry-all.
//
// Which set wins: 3dnouns first, noundry for heads it lacks. ?heads=noundry
// prefers noundry wherever an intact model exists (to compare), and
// ?heads=noundry-all also shows the damaged ones.

import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

import * as THREE from 'three';

import { getHeadOffset } from '@/lib/headNudges';

export type HeadSet = '3dnouns' | 'noundry';

interface ManifestEntry {
  traitIndex: number;
  traitName: string;
  threeDNounsGlb?: string | null;
  noundryGlb?: string | null;
}

export interface GlbHeadModel {
  object: THREE.Object3D;
  set: HeadSet;
  /** False when the model has no glasses of its own (caller supplies them). */
  hasGlasses: boolean;
}

/**
 * Noundry files that match a head trait but aren't in manifest.json (the
 * names differ). Each was checked side by side against the 2D art.
 */
const NOUNDRY_EXTRA: Record<string, string> = {
  cassettetape: 'tape',
  'star-sparkles': 'star',
  'taco-classic': 'tacos',
  'green-snake': 'snake',
  'ghost-B': 'ghost',
  'shrimp-tempura': 'tempura',
  'crt-bsod': 'bsod',
  porkbao: 'bao',
  'burger-dollarmenu': 'burger',
  camcorder: 'camerarecorder',
  hardhat: 'constructionhat',
  queencrown: 'crownqueen',
  'horse-deepfried': 'deepfriedhorse',
  'diamond-blue': 'diamond',
  dictionary: 'dictionnary',
  dino: 'dinosaur',
  faberge: 'fabergeegg',
  'console-handheld': 'handheldconsole',
  'skeleton-hat': 'skeleton',
  'bubble-speech': 'speechbubble',
  thumbsup: 'thumb',
  'ruler-triangular': 'triangularruler',
  turing: 'turingmachine',
  'bigfoot-yeti': 'yeti',
};

/**
 * Noundry heads with parts visibly missing or out of place because the
 * export dropped their node transforms (front/back renders reviewed
 * against the 2D art). Shown only with ?heads=noundry-all.
 */
const NOUNDRY_DAMAGED = new Set([
  'aardvark',
  'abacus',
  'bag',
  'bank',
  'beer',
  'beet',
  'bomb',
  'box',
  'cake',
  'calendar',
  'cash-register',
  'cheese',
  'chefhat',
  'cherry',
  'cloud',
  'cookie',
  'crab',
  'duck',
  'fan',
  'film-35mm',
  'flower',
  'frog',
  'ghost-B',
  'hanger',
  'jellyfish',
  'ketchup',
  'microwave',
  'mirror',
  'moon',
  'moose',
  'mouse',
  'mustard',
  'owl',
  'paintbrush',
  'pizza',
  'pufferfish',
  'pumpkin',
  'raven',
  'sailboat',
  'saturn',
  'shark',
  'shrimp-tempura',
  'skateboard',
  'undead',
  'unicorn',
  'zebra',
]);

const HEADS_PARAM =
  typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('heads');
const PREFER_NOUNDRY = HEADS_PARAM === 'noundry' || HEADS_PARAM === 'noundry-all';
const ALLOW_DAMAGED = HEADS_PARAM === 'noundry-all';

let manifest: Promise<ManifestEntry[]> | null = null;
function getManifest() {
  manifest ??= fetch('/models/heads/manifest.json')
    .then(r => (r.ok ? (r.json() as Promise<ManifestEntry[]>) : []))
    .catch(() => [] as ManifestEntry[])
    .then(m => {
      manifestNow = m;
      return m;
    });
  return manifest;
}

function noundryUrl(e: ManifestEntry): string | null {
  if (NOUNDRY_DAMAGED.has(e.traitName) && !ALLOW_DAMAGED) return null;
  if (e.noundryGlb) return e.noundryGlb;
  const extra = NOUNDRY_EXTRA[e.traitName];
  return extra ? `/models/heads/noundry/${extra}.glb` : null;
}

function pickModel(e: ManifestEntry): { url: string; set: HeadSet } | null {
  const tdn = e.threeDNounsGlb ? { url: e.threeDNounsGlb, set: '3dnouns' as const } : null;
  const nd = noundryUrl(e);
  const ndm = nd !== null ? { url: nd, set: 'noundry' as const } : null;
  return PREFER_NOUNDRY ? (ndm ?? tdn) : (tdn ?? ndm);
}

const templates = new Map<string, Promise<THREE.Object3D | null>>();
// Resolved copies, so already-loaded heads can be built without awaiting
const templatesNow = new Map<string, THREE.Object3D | null>();
const texNow = new Map<number, THREE.Texture | null>();
let manifestNow: ManifestEntry[] | null = null;
const glassesTex = new Map<number, Promise<THREE.Texture | null>>();

/** Glasses index whose shape the 3dnouns glasses mesh can't show. */
const HIP_ROSE = 0;

function isGlasses(o: THREE.Object3D) {
  return o.name === 'GlassesUV' || o.name.toLowerCase().includes('glasses');
}

async function loadGltf(url: string): Promise<GLTF> {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  return new GLTFLoader().loadAsync(url);
}

async function load3DNouns(url: string, traitName: string): Promise<THREE.Object3D | null> {
  const scene = (await loadGltf(url)).scene;
  scene.updateMatrixWorld(true);
  const [ox, oy, oz] = getHeadOffset(traitName);
  const shift = new THREE.Matrix4().makeTranslation(ox, oy, oz);
  // Flatten to plain meshes in the 2D art's centred pixel frame
  const root = new THREE.Group();
  scene.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible) return;
    const g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    g.applyMatrix4(shift);
    const src = m.material as THREE.MeshStandardMaterial;
    const mat = new THREE.MeshStandardMaterial({
      map: src.map ?? null,
      color: src.color ?? new THREE.Color(0xffffff),
      vertexColors: m.geometry.attributes.color !== undefined,
      roughness: 0.6,
      metalness: 0,
      transparent: src.transparent,
      alphaTest: src.map !== null ? 0.5 : 0,
      side: THREE.FrontSide,
    });
    if (mat.map) {
      mat.map.magFilter = THREE.NearestFilter;
      mat.map.colorSpace = THREE.SRGBColorSpace;
    }
    const out = new THREE.Mesh(g, mat);
    out.name = m.name;
    out.castShadow = true;
    out.receiveShadow = true;
    root.add(out);
  });
  return root.children.length > 0 ? root : null;
}

/** The stock noggles every Noundry file carries, by their exact extent. */
function isStockNoggles(g: THREE.BufferGeometry) {
  g.computeBoundingBox();
  const b = g.boundingBox!;
  return (
    b.min.x === -6.5 &&
    b.min.y === -3 &&
    b.min.z === -0.5 &&
    b.max.x === 9.5 &&
    b.max.y === 3 &&
    b.max.z === 0.5
  );
}

async function loadNoundry(url: string): Promise<THREE.Object3D | null> {
  const { mergeGeometries } = await import('three/examples/jsm/utils/BufferGeometryUtils.js');
  const scene = (await loadGltf(url)).scene;
  scene.updateMatrixWorld(true);
  // Group every primitive by palette texture, then merge
  const byPalette = new Map<THREE.Texture | null, THREE.BufferGeometry[]>();
  scene.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.visible || isStockNoggles(m.geometry)) return;
    const map = (m.material as THREE.MeshStandardMaterial).map ?? null;
    // Same vertex data, new layout: per-face normals for flat voxel faces
    const g = m.geometry.index !== null ? m.geometry.toNonIndexed() : m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    for (const k of Object.keys(g.attributes))
      if (k !== 'position' && k !== 'uv') g.deleteAttribute(k);
    g.computeVertexNormals();
    const list = byPalette.get(map) ?? [];
    list.push(g);
    byPalette.set(map, list);
  });
  const root = new THREE.Group();
  for (const [map, geos] of byPalette) {
    const g = mergeGeometries(geos, false);
    if (g === null) continue;
    if (map) {
      map.magFilter = THREE.NearestFilter;
      map.minFilter = THREE.NearestFilter;
      map.generateMipmaps = false;
      map.colorSpace = THREE.SRGBColorSpace;
      map.needsUpdate = true;
    }
    const out = new THREE.Mesh(
      g,
      new THREE.MeshStandardMaterial({ map, roughness: 0.6, metalness: 0 }),
    );
    out.name = 'noundry';
    out.castShadow = true;
    out.receiveShadow = true;
    root.add(out);
  }
  return root.children.length > 0 ? root : null;
}

function loadGlassesTexture(i: number) {
  let p = glassesTex.get(i);
  if (p === undefined) {
    p = new THREE.TextureLoader()
      .loadAsync(`/models/heads/glasses-textures/${i}.png`)
      .then(t => {
        t.magFilter = THREE.NearestFilter;
        t.minFilter = THREE.NearestFilter;
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      })
      .catch(() => null)
      .then(t => {
        texNow.set(i, t);
        return t;
      });
    glassesTex.set(i, p);
  }
  return p;
}

/**
 * The 3D model for a head with the given glasses, in Nouns pixel units
 * (x right, y up, front = +z), or null if there's no model. 3dnouns models
 * come with this Noun's glasses; noundry ones come without.
 */
export async function loadGlbHead(head: number, glasses: number): Promise<GlbHeadModel | null> {
  const entry = (await getManifest())[head] as ManifestEntry | undefined;
  if (entry === undefined) return null;
  const pick = pickModel(entry);
  if (pick === null) return null;
  const tpl = await loadTemplate(pick.url, pick.set, entry.traitName);
  if (!tpl) return null;
  const tex = pick.set === '3dnouns' && glasses !== HIP_ROSE ? await loadGlassesTexture(glasses) : null;
  return assemble(tpl, pick.set, glasses, tex);
}

/**
 * The same model, synchronously, when everything it needs is already
 * loaded: `undefined` means "not ready yet" (call loadGlbHead), `null`
 * means this head has no model.
 */
export function glbHeadNow(head: number, glasses: number): GlbHeadModel | null | undefined {
  if (manifestNow === null) return undefined;
  const entry = manifestNow[head];
  if (entry === undefined) return null;
  const pick = pickModel(entry);
  if (pick === null) return null;
  if (!templatesNow.has(pick.url)) return undefined;
  const tpl = templatesNow.get(pick.url) ?? null;
  if (tpl === null) return null;
  const needsTex = pick.set === '3dnouns' && glasses !== HIP_ROSE;
  if (needsTex && !texNow.has(glasses)) return undefined;
  return assemble(tpl, pick.set, glasses, needsTex ? (texNow.get(glasses) ?? null) : null);
}

/** Whether a head has a 3D model (`undefined` until the manifest loads). */
export function headHasModel(head: number): boolean | undefined {
  if (manifestNow === null) return undefined;
  const entry = manifestNow[head];
  return entry !== undefined && pickModel(entry) !== null;
}

/** Warm the caches for a head (e.g. its neighbours in the character select). */
export function prefetchGlbHead(head: number, glasses: number) {
  void loadGlbHead(head, glasses);
}

function loadTemplate(url: string, set: HeadSet, traitName: string) {
  let t = templates.get(url);
  if (t === undefined) {
    t = (set === 'noundry' ? loadNoundry(url) : load3DNouns(url, traitName))
      .catch(() => null)
      .then(o => {
        templatesNow.set(url, o);
        return o;
      });
    templates.set(url, t);
  }
  return t;
}

function assemble(
  tpl: THREE.Object3D,
  set: HeadSet,
  glasses: number,
  tex: THREE.Texture | null,
): GlbHeadModel {
  const head3d = tpl.clone();
  head3d.userData.headSet = set;
  if (set === 'noundry') return { object: head3d, set: 'noundry', hasGlasses: false };
  // The 3dnouns glasses mesh is the square-frame shape; textures can't turn
  // it into shapes it doesn't have. Hip-rose (2 px bridge, stepped arm)
  // drops it and wears the Noun's voxel glasses built from the art instead.
  if (glasses === HIP_ROSE || tex === null) {
    const drop: THREE.Object3D[] = [];
    head3d.traverse(o => {
      if ((o as THREE.Mesh).isMesh && isGlasses(o)) drop.push(o);
    });
    for (const o of drop) o.removeFromParent();
    return { object: head3d, set: '3dnouns', hasGlasses: false };
  }
  head3d.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !isGlasses(m)) return;
    // The model ships one pair of glasses; swap in this Noun's
    const mat = (m.material as THREE.MeshStandardMaterial).clone();
    tex.flipY = mat.map?.flipY ?? false;
    mat.map = tex;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -4;
    mat.polygonOffsetUnits = -4;
    m.material = mat;
    m.renderOrder = 1;
  });
  return { object: head3d, set: '3dnouns', hasGlasses: true };
}

// Fetch the manifest up front so the first head can tell it has a model
if (typeof window !== 'undefined') void getManifest();
