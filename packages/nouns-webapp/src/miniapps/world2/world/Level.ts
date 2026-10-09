// ── Level loading: Blender-baked plaza (preferred) or procedural fallback ──

import type { RailDef } from '../physics/Rails';

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { buildFallbackPark } from './FallbackPark';
import { buildSkyline } from './Skyline';

export interface LevelData {
  root: THREE.Object3D;
  collisionMeshes: THREE.Mesh[];
  rails: RailDef[];
  spawns: { position: THREE.Vector3; yaw: number }[];
  sun: { direction: THREE.Vector3; color: THREE.Color; intensity: number };
  sky: { zenith: THREE.Color; horizon: THREE.Color };
  fog: { color: THREE.Color; density: number };
  landmarks: { name: string; position: THREE.Vector3 }[];
  bounds: THREE.Box3;
  /** True when lighting comes from Blender lightmaps. */
  baked: boolean;
  /**
   * Soft play-area clamp (|x|, |z| ≤ this) applied by the player instead of
   * invisible collision walls, so there's nothing invisible to climb.
   */
  softBounds?: number;
}

const BASE = '/world2/level/';

interface LevelJson {
  collision?: string[];
  collisionGlb?: string;
  rails?: RailDef[];
  spawns?: { position: [number, number, number]; yaw: number }[];
  sun?: {
    direction: [number, number, number];
    color?: string | [number, number, number];
    intensity?: number;
  };
  sky?: { zenith?: string; horizon?: string };
  fog?: { color?: string; density?: number };
  lightmaps?: Record<string, string>;
  lightMapIntensity?: number;
  bounds?:
    | { min: [number, number, number]; max: [number, number, number] }
    | [[number, number, number], [number, number, number]];
  landmarks?: { name: string; position: [number, number, number] }[];
  glb?: string;
}

function toColor(c: unknown, fallback: number): THREE.Color {
  if (typeof c === 'string') return new THREE.Color(c);
  if (Array.isArray(c) && c.length >= 3) {
    const [r, g, b] = c as number[];
    // Accept either 0..1 or 0..255
    const k = r > 1 || g > 1 || b > 1 ? 1 / 255 : 1;
    return new THREE.Color(r * k, g * k, b * k);
  }
  return new THREE.Color(fallback);
}

function loadGlb(loader: GLTFLoader, url: string): Promise<THREE.Group> {
  return new Promise((resolve, reject) =>
    loader.load(url, g => resolve(g.scene), undefined, reject),
  );
}

export async function loadLevel(
  renderer: THREE.WebGLRenderer,
  onProgress?: (msg: string) => void,
): Promise<LevelData> {
  try {
    onProgress?.('fetching level');
    const res = await fetch(`${BASE}level.json`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`level.json ${res.status}`);
    const ct = res.headers.get('content-type') ?? '';
    if (ct.includes('text/html')) throw new Error('level.json missing (SPA fallback)');
    const json = (await res.json()) as LevelJson;
    const loader = new GLTFLoader();
    onProgress?.('loading plaza');
    const scene = await loadGlb(loader, BASE + (json.glb ?? 'plaza.glb'));

    // Lightmaps (uv1 / TEXCOORD_1)
    const lmIntensity = json.lightMapIntensity ?? 1;
    const texLoader = new THREE.TextureLoader();
    const lmCache = new Map<string, THREE.Texture>();
    const getLm = (file: string) => {
      let t = lmCache.get(file);
      if (!t) {
        t = texLoader.load(BASE + file);
        t.channel = 1;
        t.flipY = false;
        t.colorSpace = THREE.LinearSRGBColorSpace;
        lmCache.set(file, t);
      }
      return t;
    };
    const collisionNames = new Set(json.collision ?? []);
    const renderMeshes: THREE.Mesh[] = [];
    const hidden: THREE.Object3D[] = [];
    scene.traverse(obj => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      if (collisionNames.has(mesh.name) || /^(col_|collision)/i.test(mesh.name)) {
        hidden.push(mesh);
        return;
      }
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      renderMeshes.push(mesh);
      const lmFile = json.lightmaps?.[mesh.name] ?? json.lightmaps?.[mesh.parent?.name ?? ''];
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const out = mats.map(m => {
        const mat = (m as THREE.MeshStandardMaterial).clone();
        if (lmFile !== undefined && mesh.geometry.attributes.uv1 !== undefined) {
          mat.lightMap = getLm(lmFile);
          mat.lightMapIntensity = lmIntensity;
        }
        const map = mat.map;
        if (map) map.anisotropy = renderer.capabilities.getMaxAnisotropy();
        return mat;
      });
      mesh.material = Array.isArray(mesh.material) ? out : out[0];
    });
    for (const h of hidden) h.visible = false;
    scene.updateMatrixWorld(true);

    // Collision: dedicated simplified GLB if provided, else render meshes + hidden collision meshes
    let collisionMeshes: THREE.Mesh[] = [];
    try {
      onProgress?.('loading collision');
      const col = await loadGlb(loader, BASE + (json.collisionGlb ?? 'collision.glb'));
      col.updateMatrixWorld(true);
      col.traverse(o => {
        if ((o as THREE.Mesh).isMesh) collisionMeshes.push(o as THREE.Mesh);
      });
    } catch {
      collisionMeshes = [];
    }
    if (collisionMeshes.length === 0) {
      collisionMeshes = [
        ...renderMeshes,
        ...(hidden.filter(h => (h as THREE.Mesh).isMesh) as THREE.Mesh[]),
      ];
    }

    // Skyscrapers on top of the ring of buildings. The baked invisible
    // boundary box (±76.5, capped at 30 m) would wall off the rooftops and
    // put a ceiling under the towers, so swap it for a soft clamp just
    // outside the ring plus a catch floor behind the buildings.
    let softBounds: number | undefined;
    let skylineTop = 0;
    if (collisionMeshes.some(m => m.name === 'COL_Buildings')) {
      const roofs = collisionMeshes.find(m => m.name === 'COL_Buildings') ?? null;
      const skyline = buildSkyline(roofs);
      scene.add(skyline.group);
      skylineTop = skyline.maxY;
      collisionMeshes = collisionMeshes.filter(m => m.name !== 'COL_Boundary');
      collisionMeshes.push(...skyline.collision, ...catchFloor(85, 96, -0.2));
      softBounds = 93.6;
    }

    const sunDir = json.sun?.direction ?? [-0.45, -0.75, 0.48];
    const bounds = json.bounds
      ? Array.isArray(json.bounds)
        ? new THREE.Box3(new THREE.Vector3(...json.bounds[0]), new THREE.Vector3(...json.bounds[1]))
        : new THREE.Box3(
            new THREE.Vector3(...json.bounds.min),
            new THREE.Vector3(...json.bounds.max),
          )
      : new THREE.Box3().setFromObject(scene);
    bounds.max.y = Math.max(bounds.max.y, skylineTop);
    return {
      root: scene,
      collisionMeshes,
      rails: json.rails ?? [],
      spawns: (json.spawns ?? [{ position: [0, 0, 0], yaw: 0 }]).map(s => ({
        position: new THREE.Vector3(...s.position),
        yaw: s.yaw,
      })),
      sun: {
        direction: new THREE.Vector3(...sunDir).normalize(),
        color: toColor(json.sun?.color, 0xfff1dc),
        intensity: json.sun?.intensity ?? 3.2,
      },
      sky: {
        zenith: toColor(json.sky?.zenith, 0x3d7fd6),
        horizon: toColor(json.sky?.horizon, 0xcfe3f5),
      },
      fog: { color: toColor(json.fog?.color, 0xc9dcec), density: json.fog?.density ?? 0.004 },
      landmarks: (json.landmarks ?? []).map(l => ({
        name: l.name,
        position: new THREE.Vector3(...l.position),
      })),
      bounds,
      baked: !!json.lightmaps && Object.keys(json.lightmaps).length > 0,
      softBounds,
    };
  } catch (err) {
    console.info(
      '[world2] baked level unavailable, using procedural park:',
      (err as Error).message,
    );
    onProgress?.('building park');
    return buildFallbackPark();
  }
}

/** Collision-only ground ring between `inner` and `outer` (behind the buildings). */
function catchFloor(inner: number, outer: number, y: number): THREE.Mesh[] {
  const out: THREE.Mesh[] = [];
  const span = outer * 2;
  const depth = outer - inner;
  const mid = (outer + inner) / 2;
  for (const [x, z, w, d] of [
    [0, mid, span, depth],
    [0, -mid, span, depth],
    [mid, 0, depth, span],
    [-mid, 0, depth, span],
  ] as const) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.2, d));
    m.name = 'COL_CatchFloor';
    m.position.set(x, y - 0.1, z);
    m.updateMatrixWorld(true);
    out.push(m);
  }
  return out;
}
