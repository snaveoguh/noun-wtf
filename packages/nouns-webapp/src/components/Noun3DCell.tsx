/**
 * Noun3DGrid — renders ALL visible 3D nouns in a single shared Canvas.
 *
 * One WebGL context for the entire grid. Each noun is a positioned group
 * with random slow rotation. Hovering a noun eases it to front-facing.
 *
 * Uses an orthographic camera sized to the grid container so 1 unit = 1 pixel.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ImageData, getNounData } from '@noundry/nouns-assets';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { buildNounGeometries, seedToLayers } from '@nouns/voxel-engine';

import { HEAD_BASE_OFFSET, HEAD_X_NUDGE, HEAD_Y_NUDGE, HEAD_Z_NUDGE } from '@/lib/headNudges';
import type { INounSeed } from '@/wrappers/nounToken';

// ─── Types ─────────────────────────────────────────────────────────────────

interface NounCell {
  nounId: bigint;
  seed: INounSeed;
  /** X pixel position of cell center (relative to grid container) */
  cx: number;
  /** Y pixel position of cell center (relative to grid container) */
  cy: number;
  /** Cell size in pixels */
  size: number;
}

interface Noun3DGridProps {
  cells: NounCell[];
  /** Total height of the virtualized grid in pixels */
  totalHeight: number;
  /** Width of the grid container in pixels */
  containerWidth: number;
  /** Scroll offset from container top */
  scrollOffset: number;
  /** Currently hovered noun ID */
  hoveredId: bigint | null;
  /** Mouse viewport position for ocean-parting effect */
  mousePos: { x: number; y: number } | null;
}

// ─── Geometry cache ────────────────────────────────────────────────────────

const geoCache = new Map<string, ReturnType<typeof buildNounGeometries>>();

function getGeometries(seed: INounSeed) {
  const key = `${seed.head}-${seed.glasses}-${seed.body}-${seed.accessory}-${seed.background}`;
  let geos = geoCache.get(key);
  if (!geos) {
    const layers = seedToLayers(seed, getNounData, ImageData.palette);
    geos = buildNounGeometries(layers);
    geoCache.set(key, geos);
    // Evict old entries
    if (geoCache.size > 200) {
      const first = geoCache.keys().next().value;
      if (first) geoCache.delete(first);
    }
  }
  return geos;
}

// ─── GLB head loader ───────────────────────────────────────────────────────

type ManifestEntry = { traitName: string; threeDNounsGlb?: string };
let manifestPromise: Promise<ManifestEntry[]> | null = null;
function getManifest(): Promise<ManifestEntry[]> {
  if (!manifestPromise) {
    manifestPromise = fetch('/models/heads/manifest.json').then(r => r.json());
  }
  return manifestPromise;
}

/** Extracted mesh data from a GLB head — geometry + material pairs ready to render */
interface GlbMeshData {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}
const glbHeadCache = new Map<string, GlbMeshData[] | null>();
const glbLoadingSet = new Set<string>();
const glbListeners = new Map<string, Array<(meshes: GlbMeshData[] | null) => void>>();

/** Load a 3DNouns GLB head for a seed, with shared caching. Returns mesh data array or null. */
function loadGlbHead(
  seed: INounSeed,
  onLoaded: (meshes: GlbMeshData[] | null) => void,
): () => void {
  const cacheKey = `${seed.head}-${seed.glasses}`;

  // Already cached — geometry+material are shareable across instances
  if (glbHeadCache.has(cacheKey)) {
    onLoaded(glbHeadCache.get(cacheKey) ?? null);
    return () => {};
  }

  // Already loading — add listener
  if (glbLoadingSet.has(cacheKey)) {
    const listeners = glbListeners.get(cacheKey) ?? [];
    listeners.push(onLoaded);
    glbListeners.set(cacheKey, listeners);
    return () => {
      const ls = glbListeners.get(cacheKey);
      if (ls) glbListeners.set(cacheKey, ls.filter(l => l !== onLoaded));
    };
  }

  // Start loading
  glbLoadingSet.add(cacheKey);
  glbListeners.set(cacheKey, [onLoaded]);

  (async () => {
    try {
      const manifest = await getManifest();
      const entry = manifest[seed.head];
      if (!entry?.threeDNounsGlb) {
        glbHeadCache.set(cacheKey, null);
        glbListeners.get(cacheKey)?.forEach(cb => cb(null));
        return;
      }

      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader');
      const loader = new GLTFLoader();
      const gltf = await loader.loadAsync(entry.threeDNounsGlb);
      const scene = gltf.scene;

      // Swap glasses texture
      const isHipRose = seed.glasses === 0;
      if (isHipRose) {
        scene.traverse(child => {
          if (child.name === 'GlassesUV' || child.name.toLowerCase().includes('glasses'))
            child.visible = false;
        });
      } else {
        const texLoader = new THREE.TextureLoader();
        const glassesTex = await texLoader.loadAsync(`/models/heads/glasses-textures/${seed.glasses}.png`);
        glassesTex.magFilter = THREE.NearestFilter;
        glassesTex.minFilter = THREE.NearestFilter;
        glassesTex.colorSpace = THREE.SRGBColorSpace;
        scene.traverse(child => {
          if (child.name === 'GlassesUV' || child.name.toLowerCase().includes('glasses')) {
            const mesh = child as THREE.Mesh;
            const mat = mesh.material as THREE.MeshStandardMaterial;
            if (mat?.map) {
              glassesTex.flipY = mat.map.flipY;
              mat.map.dispose();
              mat.map = glassesTex;
              mat.side = THREE.FrontSide;
              mat.polygonOffset = true;
              mat.polygonOffsetFactor = -4;
              mat.polygonOffsetUnits = -4;
              mat.needsUpdate = true;
            }
            mesh.renderOrder = 1;
            mesh.position.z += 0.08;
          }
        });
      }

      // Apply per-head offset
      const offsetX = HEAD_BASE_OFFSET[0] + (HEAD_X_NUDGE[entry.traitName] ?? 0);
      const offsetY = HEAD_BASE_OFFSET[1] + (HEAD_Y_NUDGE[entry.traitName] ?? 0);
      const offsetZ = HEAD_BASE_OFFSET[2] + (HEAD_Z_NUDGE[entry.traitName] ?? 0);
      const matrix = new THREE.Matrix4().makeTranslation(offsetX, offsetY, offsetZ);
      scene.traverse(child => {
        if ((child as THREE.Mesh).isMesh && child.visible)
          (child as THREE.Mesh).geometry?.applyMatrix4(matrix);
      });
      scene.position.set(0, 0, 0);
      scene.scale.set(1, 1, 1);
      scene.updateMatrixWorld(true);

      // Extract mesh geometry+material pairs (converted to MeshBasicMaterial)
      const meshes: GlbMeshData[] = [];
      scene.traverse(child => {
        if (!(child as THREE.Mesh).isMesh || !child.visible) return;
        const mesh = child as THREE.Mesh;
        const oldMat = mesh.material as THREE.MeshStandardMaterial;
        const basicMat = new THREE.MeshBasicMaterial({
          map: oldMat.map ?? undefined,
          vertexColors: !!mesh.geometry.attributes.color,
          side: oldMat.side,
          transparent: oldMat.transparent,
          opacity: oldMat.opacity,
          toneMapped: false,
        });
        if (oldMat.polygonOffset) {
          basicMat.polygonOffset = true;
          basicMat.polygonOffsetFactor = oldMat.polygonOffsetFactor;
          basicMat.polygonOffsetUnits = oldMat.polygonOffsetUnits;
        }
        meshes.push({ geometry: mesh.geometry, material: basicMat });
      });

      glbHeadCache.set(cacheKey, meshes.length > 0 ? meshes : null);
      glbListeners.get(cacheKey)?.forEach(cb => cb(meshes.length > 0 ? meshes : null));
    } catch {
      glbHeadCache.set(cacheKey, null);
      glbListeners.get(cacheKey)?.forEach(cb => cb(null));
    } finally {
      glbLoadingSet.delete(cacheKey);
      glbListeners.delete(cacheKey);
    }
  })();

  return () => {
    const ls = glbListeners.get(cacheKey);
    if (ls) glbListeners.set(cacheKey, ls.filter(l => l !== onLoaded));
  };
}

// ─── Per-noun random spin state ────────────────────────────────────────────

/** Seeded pseudo-random for consistent spin per noun */
function nounRandom(nounId: bigint): { ax: number; ay: number; az: number; speed: number } {
  const n = Number(nounId);
  const s1 = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  const s2 = Math.sin(n * 269.5 + 183.3) * 43758.5453;
  const s3 = Math.sin(n * 419.2 + 371.9) * 43758.5453;
  const s4 = Math.sin(n * 563.7 + 521.1) * 43758.5453;
  return {
    ax: (s1 - Math.floor(s1)) * 2 - 1,
    ay: (s2 - Math.floor(s2)) * 2 - 1,
    az: (s3 - Math.floor(s3)) * 2 - 1,
    speed: 0.3 + (s4 - Math.floor(s4)) * 0.5,
  };
}

// ─── Single noun mesh group ────────────────────────────────────────────────

const _euler = new THREE.Euler();
const _qTarget = new THREE.Quaternion();
const _qSpin = new THREE.Quaternion();
const _axis = new THREE.Vector3();

const _pushEuler = new THREE.Euler();
const _pushQuat = new THREE.Quaternion();

function NounMesh({
  cell,
  isHovered,
  mousePos,
}: {
  cell: NounCell;
  isHovered: boolean;
  mousePos: { x: number; y: number } | null;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const geos = useMemo(() => getGeometries(cell.seed), [cell.seed]);
  const spin = useMemo(() => nounRandom(cell.nounId), [cell.nounId]);
  const { invalidate } = useThree();

  // Load curated GLB head (async, replaces voxel head when ready)
  const [glbMeshes, setGlbMeshes] = useState<GlbMeshData[] | null>(null);
  useEffect(() => {
    return loadGlbHead(cell.seed, meshes => {
      setGlbMeshes(meshes);
      invalidate();
    });
  }, [cell.seed.head, cell.seed.glasses]);

  useFrame((state) => {
    const g = groupRef.current;
    if (!g) return;

    // Compute mouse proximity influence (ocean-parting effect)
    const INFLUENCE_RADIUS = cell.size * 1.2; // pixels — tight radius, ~1 neighbor
    let proximity = 0; // 0 = no influence, 1 = directly on top
    let pushX = 0, pushY = 0; // direction to push away

    if (mousePos) {
      const dx = cell.cx - mousePos.x;
      const dy = cell.cy - mousePos.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < INFLUENCE_RADIUS && dist > 0.1) {
        proximity = 1 - dist / INFLUENCE_RADIUS;
        proximity = proximity * proximity; // ease-in for snappier falloff
        // Normalize push direction (away from mouse)
        pushX = dx / dist;
        pushY = dy / dist;
      }
    }

    if (proximity > 0.01) {
      // Tilt away from mouse — rotate around the axis perpendicular to push direction
      const tiltAmount = proximity * 1.2; // max ~70 degrees
      _pushEuler.set(pushY * tiltAmount, -pushX * tiltAmount, 0);
      _pushQuat.setFromEuler(_pushEuler);
      g.quaternion.slerp(_pushQuat, 0.25);
    } else {
      // Default: slow random tumble
      _axis.set(spin.ax, spin.ay, spin.az).normalize();
      _qSpin.setFromAxisAngle(_axis, state.clock.elapsedTime * spin.speed);
      g.quaternion.slerp(_qSpin, 0.08);
    }
    invalidate();
  });

  const scale = cell.size / 38;

  return (
    <group
      ref={groupRef}
      position={[cell.cx, -cell.cy, 0]}
    >
      <group scale={[scale, scale, scale]}>
        {geos.bodyGeo && (
          <mesh geometry={geos.bodyGeo}>
            <meshBasicMaterial vertexColors toneMapped={false} />
          </mesh>
        )}
        {geos.blingGeo && (
          <mesh geometry={geos.blingGeo}>
            <meshBasicMaterial vertexColors toneMapped={false} />
          </mesh>
        )}
        {glbMeshes ? (
          <>
            {glbMeshes.map((m, i) => (
              <mesh key={i} geometry={m.geometry} material={m.material} />
            ))}
          </>
        ) : (
          <>
            {geos.headGeo && (
              <mesh geometry={geos.headGeo}>
                <meshBasicMaterial vertexColors toneMapped={false} />
              </mesh>
            )}
            {geos.glassesGeo && (
              <mesh geometry={geos.glassesGeo}>
                <meshBasicMaterial vertexColors toneMapped={false} />
              </mesh>
            )}
          </>
        )}
      </group>
    </group>
  );
}

// ─── Camera sync ───────────────────────────────────────────────────────────

function CameraSync() {
  const { camera, size } = useThree();

  useEffect(() => {
    const cam = camera as THREE.OrthographicCamera;
    // Map pixel coordinates: (0,0) at top-left, (width, height) at bottom-right
    cam.left = 0;
    cam.right = size.width;
    cam.top = 0;
    cam.bottom = -size.height;
    cam.near = -500;
    cam.far = 500;
    cam.position.set(0, 0, 50);
    cam.updateProjectionMatrix();
  }, [camera, size.width, size.height]);

  return null;
}

// ─── Main grid component ───────────────────────────────────────────────────

export default function Noun3DGrid({
  cells,
  totalHeight,
  containerWidth,
  scrollOffset,
  hoveredId,
  mousePos,
}: Noun3DGridProps) {
  return (
    <Canvas
      orthographic
      camera={{ position: [0, 0, 50], zoom: 1, near: -500, far: 500 }}
      style={{
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
      }}
      gl={{ antialias: true, alpha: true }}
      frameloop="always"
    >
      <CameraSync />
      <ambientLight intensity={1.5} />
      <directionalLight position={[50, 80, 100]} intensity={0.5} />

      {cells.map(cell => (
        <NounMesh
          key={cell.nounId.toString()}
          cell={cell}
          isHovered={hoveredId === cell.nounId}
          mousePos={mousePos}
        />
      ))}
    </Canvas>
  );
}

export type { NounCell };
