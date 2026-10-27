// ── Level loading: Blender-baked plaza (preferred) or procedural fallback ──

import type { RailDef } from '../physics/Rails';

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { blockRoofs } from '../interiors/plazaDoors';
import {
  MINOR_CAP,
  UPLOAD_CAP,
  materialTextures,
  shrinkTexture,
  textureDiet,
} from '../render/textureDiet';

import { buildFallbackPark } from './FallbackPark';
import { buildInfills, findInfills } from './infill';
import {
  alleyCutBoxes,
  buildAlleys,
  buildRingBacks,
  cutTriangles,
  inCorridor,
  ringBands,
  seatBackdrop,
} from './mountain/Alleys';
import { MOUNTAIN } from './mountain/config';
import { seatRoofs } from './roofs';
import { buildSkyline } from './Skyline';

export interface LevelData {
  root: THREE.Object3D;
  collisionMeshes: THREE.Mesh[];
  rails: RailDef[];
  spawns: { position: THREE.Vector3; yaw: number; name?: string }[];
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
  /**
   * Endless downhill mountain all round the city. `inCorridor` says where
   * the soft clamp lets you through the ring (the alleys); once |x| or |z|
   * ≥ minZ you're out on the slope.
   */
  mountain?: { inCorridor: (x: number, z: number) => boolean; minZ: number };
}

const BASE = '/world2/level/';

interface LevelJson {
  collision?: string[];
  collisionGlb?: string;
  rails?: RailDef[];
  spawns?: { position: [number, number, number]; yaw: number; name?: string }[];
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

/** `plaza.glb` → `plaza.lite.glb` (scripts/lite-assets.py writes the phone copies). */
export function liteName(file: string): string {
  return file.replace(/\.(glb|webp|png|jpe?g)$/i, '.lite.$1');
}

/**
 * `lite`: the 'low' tier's half-size copies of the plaza and its lightmaps
 * (~3 MB instead of ~12 MB on first load); any missing copy falls back to the
 * full file.
 */
export async function loadLevel(
  renderer: THREE.WebGLRenderer,
  onProgress?: (msg: string) => void,
  opts: { lite?: boolean } = {},
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
    const glb = json.glb ?? 'plaza.glb';
    const scene =
      opts.lite === true
        ? await loadGlb(loader, BASE + liteName(glb)).catch(() => loadGlb(loader, BASE + glb))
        : await loadGlb(loader, BASE + glb);

    // Lightmaps (uv1 / TEXCOORD_1)
    const lmIntensity = json.lightMapIntensity ?? 1;
    const texLoader = new THREE.TextureLoader();
    const lmCache = new Map<string, THREE.Texture>();
    // Weak phones: shrink on load (the 512 upload cap would anyway) so the
    // full-size decoded image isn't kept
    const onLm = textureDiet.on ? (t: THREE.Texture) => shrinkTexture(t, UPLOAD_CAP) : undefined;
    const loadLm = (file: string): THREE.Texture => {
      if (opts.lite !== true) return texLoader.load(BASE + file, onLm);
      const t = texLoader.load(BASE + liteName(file), onLm, undefined, () => {
        // no lite copy: the full lightmap into the same texture
        texLoader.load(BASE + file, full => {
          t.image = full.image;
          t.needsUpdate = true;
        });
      });
      return t;
    };
    const getLm = (file: string) => {
      let t = lmCache.get(file);
      if (!t) {
        t = loadLm(file);
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
      const lmFile = json.lightmaps?.[mesh.name] ?? json.lightmaps?.[mesh.parent?.name ?? ''];
      // Lite (phones): baked-lit meshes already have their shadows in the
      // lightmap, so they skip the realtime shadow pass (~90 draw calls)
      const baked = lmFile !== undefined && mesh.geometry.attributes.uv1 !== undefined;
      mesh.castShadow = !(opts.lite === true && baked);
      mesh.receiveShadow = true;
      renderMeshes.push(mesh);
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const out = mats.map(m => {
        const mat = (m as THREE.MeshStandardMaterial).clone();
        if (lmFile !== undefined && mesh.geometry.attributes.uv1 !== undefined) {
          mat.lightMap = getLm(lmFile);
          mat.lightMapIntensity = lmIntensity;
        }
        const map = mat.map;
        if (map) map.anisotropy = renderer.capabilities.getMaxAnisotropy();
        // Weak phones: the tiling materials at 256 px (lightmaps get the 512 upload cap)
        if (textureDiet.on)
          for (const [k, t] of materialTextures(mat))
            if (k !== 'lightMap') shrinkTexture(t, MINOR_CAP);
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
    let mountain: LevelData['mountain'];
    let skylineTop = 0;
    if (collisionMeshes.some(m => m.name === 'COL_Buildings')) {
      const roofs = collisionMeshes.find(m => m.name === 'COL_Buildings') ?? null;
      // Its block tops sit at parapet height: put them on the visible roofs
      // first (the towers below sit on them too). The ring backs still go
      // up to the parapets, so they're built from a copy as baked.
      let asBaked: THREE.Mesh | null = null;
      if (roofs !== null) {
        roofs.updateWorldMatrix(true, false);
        asBaked = new THREE.Mesh(roofs.geometry.clone().applyMatrix4(roofs.matrixWorld));
        const blocks: THREE.Mesh[] = [];
        scene.traverse(o => {
          const mesh = o as THREE.Mesh;
          if (
            mesh.isMesh &&
            (/^buildings/i.test(mesh.name) || /^buildings/i.test(mesh.parent?.name ?? ''))
          )
            blocks.push(mesh);
        });
        const parapets = seatRoofs(roofs, blocks);
        if (parapets !== null) collisionMeshes.push(parapets);
        // The slots the bake left between neighbouring blocks: fill them
        const infill = buildInfills(findInfills(blockRoofs(roofs)));
        if (infill.mesh !== null) scene.add(infill.mesh);
        collisionMeshes.push(...infill.collision);
      }
      const skyline = buildSkyline(roofs);
      scene.add(skyline.group);
      skylineTop = skyline.maxY;
      collisionMeshes = collisionMeshes.filter(m => m.name !== 'COL_Boundary');
      collisionMeshes.push(...skyline.collision);
      softBounds = 93.6;
      const withMountain = new URLSearchParams(window.location.search).get('mountain') !== '0';
      if (withMountain) {
        // Three alleys through the ring: cut the baked blocks (render +
        // collision) and build the corridor walls, arches + outer wall.
        const cuts = alleyCutBoxes();
        const named = (o: THREE.Object3D, re: RegExp) =>
          re.test(o.name) || (o.parent !== null && re.test(o.parent.name));
        const backdrop: THREE.Object3D[] = [];
        scene.traverse(o => {
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          if (named(mesh, /^(buildings|decals|props)/i)) cutTriangles(mesh, cuts);
          // The backdrop city beyond the ring would float over the slopes
          // that now fall away on every side: re-seat it on the terrain
          else if (named(mesh, /^backdrop/i)) backdrop.push(mesh);
        });
        for (const b of backdrop) collisionMeshes.push(...seatBackdrop(b as THREE.Mesh));
        for (const m of collisionMeshes)
          if (/^col_(buildings|props)/i.test(m.name)) cutTriangles(m, cuts);
        if (asBaked !== null) cutTriangles(asBaked, cuts);
        const backs = buildRingBacks(asBaked);
        if (backs !== null) scene.add(backs);
        const alleys = buildAlleys();
        scene.add(alleys.group);
        collisionMeshes.push(...alleys.collision);
        // Catch floor behind the buildings, stopping at the outer wall and
        // open along the corridors
        for (const b of ringBands(85, MOUNTAIN.wallZ, 96)) {
          const m = new THREE.Mesh(
            new THREE.BoxGeometry(b.max.x - b.min.x, 0.2, b.max.z - b.min.z),
          );
          m.name = 'COL_CatchFloor';
          m.position.set((b.min.x + b.max.x) / 2, -0.3, (b.min.z + b.max.z) / 2);
          m.updateMatrixWorld(true);
          collisionMeshes.push(m);
        }
        mountain = { inCorridor, minZ: MOUNTAIN.minZ };
      } else {
        collisionMeshes.push(...catchFloor(85, 96, -0.2));
      }
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
        name: s.name,
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
      mountain,
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
