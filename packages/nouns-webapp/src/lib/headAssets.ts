/**
 * Head Asset System — 3-tier fallback for curated Noun head models.
 *
 * Priority: 1. Noundry (hand-crafted VoxEdit → GLB)
 *           2. 3DNouns (community GLBs from 0xFloyd/3DNouns)
 *           3. Auto-generated voxel (seedToLayers + buildNounGeometries)
 *
 * Usage:
 *   const { object, source } = await loadNounHead(seed);
 *   // object is a THREE.Object3D, source is 'noundry' | '3dnouns' | 'voxel'
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { ImageData } from '@noundry/nouns-assets';

// ─── Types ──────────────────────────────────────────────────────────────────

export type HeadSource = 'noundry' | '3dnouns' | 'voxel';

export interface HeadAssetEntry {
  traitIndex: number;
  traitName: string; // e.g. "shark", "banana"
  noundryGlb?: string; // e.g. "/models/heads/noundry/shark.glb"
  threeDNounsGlb?: string; // e.g. "/models/heads/3dnouns/HeadShark.glb"
}

export interface LoadedHead {
  object: THREE.Object3D;
  source: HeadSource;
}

export interface INounSeed {
  background: number;
  body: number;
  accessory: number;
  head: number;
  glasses: number;
}

// ─── Name Normalization ─────────────────────────────────────────────────────

/** Normalize a trait/file name for fuzzy matching across naming conventions */
export function normalizeHeadName(name: string): string {
  return name
    .replace(/\.glb$/i, '') // strip .glb extension
    .replace(/^head[-_]?/i, '') // strip "head-" or "Head" prefix
    .replace(/head$/i, '') // strip "Head" suffix (e.g. mushroomHead → mushroom)
    .replace(/[-_\s().]/g, '') // strip separators, parens, dots
    .toLowerCase();
}

// ─── Per-Source Transform Config ────────────────────────────────────────────

export const HEAD_TRANSFORMS: Record<
  HeadSource,
  {
    scale: number;
    position: [number, number, number];
    rotation: [number, number, number];
  }
> = {
  noundry: { scale: 0.02, position: [0, 0.6, 0], rotation: [0, 0, 0] },
  '3dnouns': { scale: 0.015, position: [0, 0.65, 0], rotation: [0, Math.PI, 0] },
  voxel: { scale: 0.14, position: [0, 0.65, 0], rotation: [0, 0, 0] },
};

// ─── Manifest ───────────────────────────────────────────────────────────────

// This will be populated by buildManifest() on first load
let manifest: HeadAssetEntry[] = [];
let manifestReady = false;
let manifestPromise: Promise<void> | null = null;

/**
 * Build the manifest by scanning available GLB files.
 * In production, this is a static lookup. In development, it auto-discovers files.
 */
export async function buildManifest(
  noundryFiles: string[] = [],
  threeDNounsFiles: string[] = [],
): Promise<HeadAssetEntry[]> {
  // Build normalized lookup maps
  const noundryMap = new Map<string, string>();
  for (const f of noundryFiles) {
    noundryMap.set(normalizeHeadName(f), `/models/heads/noundry/${f}`);
  }

  const tdnMap = new Map<string, string>();
  for (const f of threeDNounsFiles) {
    tdnMap.set(normalizeHeadName(f), `/models/heads/3dnouns/${f}`);
  }

  // Map each trait to available GLBs
  const heads = ImageData.images.heads;
  manifest = heads.map((h: { filename: string }, i: number) => {
    const traitName = h.filename.replace(/^head-/, '');
    const normalized = normalizeHeadName(traitName);

    return {
      traitIndex: i,
      traitName,
      noundryGlb: noundryMap.get(normalized),
      threeDNounsGlb: tdnMap.get(normalized),
    };
  });

  manifestReady = true;
  return manifest;
}

/** Auto-discover available GLBs by fetching directory listings */
export async function autoDiscoverManifest(): Promise<HeadAssetEntry[]> {
  if (manifestReady) return manifest;
  if (manifestPromise) {
    await manifestPromise;
    return manifest;
  }

  manifestPromise = (async () => {
    // Try to fetch a pre-built manifest file
    try {
      const res = await fetch('/models/heads/manifest.json');
      if (res.ok) {
        const data = await res.json();
        manifest = data;
        manifestReady = true;
        return;
      }
    } catch {
      /* no manifest file, that's ok */
    }

    // Fallback: build from known file lists
    // In dev, these would be discovered; in prod, the manifest.json should exist
    const noundryFiles: string[] = [];
    const tdnFiles: string[] = [];

    try {
      // Try loading file lists
      const [nRes, tRes] = await Promise.allSettled([
        fetch('/models/heads/noundry/index.json'),
        fetch('/models/heads/3dnouns/index.json'),
      ]);
      if (nRes.status === 'fulfilled' && nRes.value.ok) {
        noundryFiles.push(...(await nRes.value.json()));
      }
      if (tRes.status === 'fulfilled' && tRes.value.ok) {
        tdnFiles.push(...(await tRes.value.json()));
      }
    } catch {
      /* no index files */
    }

    await buildManifest(noundryFiles, tdnFiles);
  })();

  await manifestPromise;
  return manifest;
}

// ─── GLB Cache ──────────────────────────────────────────────────────────────

const glbCache = new Map<string, THREE.Object3D>();
const glbLoader = new GLTFLoader();
const MAX_CACHE = 80;

// 3DNouns GLBs: ALL heads have identical bounds: x=-9..7 (16w), y=25..31 (6h), z=-0.5..0.5 (1d)
// Voxel grid: 32x32 pixels, offset -15.5, so pixel (0,0) = world (-15.5, -15.5)
// Voxel head pixels occupy rows ~14-31, so Y range ≈ -1.5 to +15.5
// We DON'T scale — just translate the GLB so its native coords align with the voxel grid.
// GLB pixel coords are 0-31 (no offset), voxel coords are -15.5 to +15.5 (offset by -15.5)
// So: voxelY = glbY - 15.5, voxelX = glbX - 15.5
const GLB_TO_VOXEL_OFFSET_X = -15.5; // shift GLB x=0..31 to voxel x=-15.5..+15.5
const GLB_TO_VOXEL_OFFSET_Y = -15.5; // shift GLB y=0..31 to voxel y=-15.5..+15.5
const VOXEL_HEAD_CENTER_Z = 0.78;    // Z depth of head layer

async function loadGlb(url: string): Promise<THREE.Object3D> {
  const cached = glbCache.get(url);
  if (cached) return cached.clone();

  try {
    const gltf = await glbLoader.loadAsync(url);
    const scene = gltf.scene;

    // Bake transforms directly into vertex positions so clone() preserves them
    const box = new THREE.Box3().setFromObject(scene);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    // Translation only — GLB pixels are 1:1 with voxel units
    // Shift GLB native coords (0-31) to voxel coords (-15.5 to +15.5)
    const matrix = new THREE.Matrix4();
    matrix.makeTranslation(
      GLB_TO_VOXEL_OFFSET_X,
      GLB_TO_VOXEL_OFFSET_Y - 2.5,
      VOXEL_HEAD_CENTER_Z,
    );

    // Apply to all mesh geometries directly
    scene.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (mesh.geometry) {
          mesh.geometry.applyMatrix4(matrix);
        }
      }
    });

    // Reset scene transform since we baked it into geometry
    scene.position.set(0, 0, 0);
    scene.scale.set(1, 1, 1);
    scene.rotation.set(0, 0, 0);
    scene.updateMatrixWorld(true);

    // Evict oldest if cache is full
    if (glbCache.size >= MAX_CACHE) {
      const oldest = glbCache.keys().next().value;
      if (oldest) glbCache.delete(oldest);
    }

    glbCache.set(url, scene);
    return scene.clone();
  } catch {
    throw new Error(`Failed to load GLB: ${url}`);
  }
}

// ─── Main Loader ────────────────────────────────────────────────────────────

/**
 * Load a Noun head with 3-tier fallback:
 * 1. Noundry curated GLB
 * 2. 3DNouns community GLB
 * 3. Auto-generated voxel geometry
 */
export async function loadNounHead(seed: INounSeed): Promise<LoadedHead | null> {
  await autoDiscoverManifest();

  const entry = manifest[seed.head];

  // Tier 1: 3DNouns (web-ready GLBs with proper textures)
  if (entry?.threeDNounsGlb) {
    try {
      const object = await loadGlb(entry.threeDNounsGlb);
      console.log(`[HeadAssets] Loaded 3dnouns head: ${entry.traitName}`);
      return { object, source: '3dnouns' };
    } catch {
      /* fall through to next tier */
    }
  }

  // Tier 2: Noundry (converted VoxEdit — needs texture fix before enabling)
  // TODO: re-enable once noundry GLBs render with proper colors
  // if (entry?.noundryGlb) {
  //   try {
  //     const object = await loadGlb(entry.noundryGlb);
  //     return { object, source: 'noundry' };
  //   } catch { /* fall through */ }
  // }

  // No curated head available — return null, caller uses its own voxel fallback
  return null;
}

// Voxel fallback is handled by the consuming component, not here.
// This module only deals with curated GLB assets.

// ─── Manifest Stats ─────────────────────────────────────────────────────────

export function getManifestStats(): {
  total: number;
  noundry: number;
  threeDNouns: number;
  voxelOnly: number;
} {
  const total = manifest.length;
  const noundry = manifest.filter(e => e.noundryGlb).length;
  const threeDNouns = manifest.filter(e => e.threeDNounsGlb).length;
  const voxelOnly = manifest.filter(e => !e.noundryGlb && !e.threeDNounsGlb).length;
  return { total, noundry, threeDNouns, voxelOnly };
}
