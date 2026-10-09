// ── Hand-modelled 3D heads (3DNouns set) ─────────────────────────────────
//
// 224 of the 258 heads have a proper 3D model in /models/heads/3dnouns,
// in Nouns pixel units. They replace the inflated pixel-art head once
// loaded; heads without a model keep the generated one. Alignment reuses
// the per-head nudges the auction page's 3D view was tuned with, which
// put each model in the same centred pixel frame as the 2D art.

import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { getHeadOffset } from '@/lib/headNudges';

interface ManifestEntry {
  traitIndex: number;
  traitName: string;
  threeDNounsGlb?: string | null;
}

let manifest: Promise<ManifestEntry[]> | null = null;
function getManifest() {
  manifest ??= fetch('/models/heads/manifest.json')
    .then(r => (r.ok ? (r.json() as Promise<ManifestEntry[]>) : []))
    .catch(() => []);
  return manifest;
}

const templates = new Map<string, Promise<THREE.Object3D | null>>();
const glassesTex = new Map<number, Promise<THREE.Texture | null>>();

function isGlasses(o: THREE.Object3D) {
  return o.name === 'GlassesUV' || o.name.toLowerCase().includes('glasses');
}

async function loadTemplate(url: string, traitName: string): Promise<THREE.Object3D | null> {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const gltf: GLTF = await new GLTFLoader().loadAsync(url);
  const scene = gltf.scene;
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
      .catch(() => null);
    glassesTex.set(i, p);
  }
  return p;
}

/**
 * The 3D model for a head with the given glasses, in the 2D art's centred
 * pixel frame (x right, y up, front = +z), or null if there's no model.
 */
export async function loadGlbHead(head: number, glasses: number): Promise<THREE.Object3D | null> {
  const entry = (await getManifest())[head];
  const url = entry?.threeDNounsGlb;
  if (!entry || !url) return null;
  let t = templates.get(url);
  if (t === undefined) {
    t = loadTemplate(url, entry.traitName).catch(() => null);
    templates.set(url, t);
  }
  const tpl = await t;
  if (!tpl) return null;
  const head3d = tpl.clone();
  const tex = await loadGlassesTexture(glasses);
  head3d.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !isGlasses(m)) return;
    // The model ships one pair of glasses; swap in this Noun's
    if (tex === null) {
      m.visible = false;
      return;
    }
    const mat = (m.material as THREE.MeshStandardMaterial).clone();
    tex.flipY = mat.map?.flipY ?? false;
    mat.map = tex;
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -4;
    mat.polygonOffsetUnits = -4;
    m.material = mat;
    m.renderOrder = 1;
  });
  return head3d;
}
