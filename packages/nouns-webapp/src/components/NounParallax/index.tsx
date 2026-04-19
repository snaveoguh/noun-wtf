/**
 * NounParallax — 3D voxel Noun with gyro/touch/mouse tilt.
 *
 * Renders Noun as extruded voxel cubes (glasses protrude from face).
 * Three modes:
 *   - Tilt mode (default): subtle gyro/touch/mouse parallax
 *   - Interactive mode (interactive prop): full orbit/zoom/drag via OrbitControls
 *   - Editable mode (editable prop): 3D voxel editor with sculpting
 * Display mode uses unlit materials so the rendered noun matches the source
 * palette exactly instead of darkening under scene lighting.
 */
import React, { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ImageData, getNounData } from '@noundry/nouns-assets';
import {
  buildGeometryFromVoxelMap,
  buildNounGeometries,
  seedToLayers,
  BODY_DEPTH,
  BLING_DEPTH,
  HEAD_DEPTH,
  GLASSES_DEPTH,
  type EditableSceneViewState,
  type LayerVisibility,
  type NounLayers,
  type Tool,
  type VoxelMap,
} from '@nouns/voxel-engine';
import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { INounSeed } from '@/wrappers/nounToken';
import { HEAD_X_NUDGE, HEAD_Y_NUDGE, HEAD_Z_NUDGE, HEAD_BASE_OFFSET } from '@/lib/headNudges';

import classes from './NounParallax.module.css';
import SceneEnvironment from './SceneEnvironment';

// ─── Lighting Presets ───────────────────────────────────────────────────────

export type LightingPreset =
  | 'spotlight'
  | 'studio'
  | 'storefront'
  | 'sunrise'
  | 'twilight'
  | 'ambient'
  | 'none';

export const LIGHTING_PRESETS: { name: LightingPreset; label: string }[] = [
  { name: 'spotlight', label: 'SPOT' },
  { name: 'studio', label: 'STUDIO' },
  { name: 'storefront', label: 'STORE' },
  { name: 'sunrise', label: 'RISE' },
  { name: 'twilight', label: 'TWLIT' },
  { name: 'ambient', label: 'AMBI' },
  { name: 'none', label: 'NONE' },
];

// Preset configs — same shape so React reuses the same DOM elements (no unmount/remount black flash)
const LIGHT_CONFIGS: Record<
  LightingPreset,
  {
    ambient: { intensity: number; color: string };
    dir1: { position: [number, number, number]; intensity: number; color: string };
    dir2: { position: [number, number, number]; intensity: number; color: string };
    point1: { position: [number, number, number]; intensity: number; color: string };
    spot: { position: [number, number, number]; intensity: number; color: string; angle: number };
  }
> = {
  spotlight: {
    ambient: { intensity: 2.2, color: '#ffffff' },
    dir1: { position: [-8, 5, 10], intensity: 0.6, color: '#ffffff' },
    dir2: { position: [0, -5, -10], intensity: 0.2, color: '#ffffff' },
    point1: { position: [0, -5, 8], intensity: 0.3, color: '#aaccff' },
    spot: { position: [5, 20, 30], intensity: 2.0, color: '#ffffff', angle: 0.8 },
  },
  studio: {
    ambient: { intensity: 1.5, color: '#ffffff' },
    dir1: { position: [10, 15, 20], intensity: 2.0, color: '#ffffff' },
    dir2: { position: [-10, 5, -5], intensity: 0.8, color: '#ccddff' },
    point1: { position: [0, -5, -15], intensity: 0.5, color: '#ffeedd' },
    spot: { position: [5, 12, 25], intensity: 0, color: '#ffffff', angle: 0.5 },
  },
  storefront: {
    ambient: { intensity: 2.5, color: '#ffffff' },
    dir1: { position: [0, 5, 15], intensity: 1.0, color: '#ffffff' },
    dir2: { position: [0, 10, -5], intensity: 0.3, color: '#ffffff' },
    point1: { position: [0, 0, 10], intensity: 0.2, color: '#ffffff' },
    spot: { position: [5, 12, 25], intensity: 0, color: '#ffffff', angle: 0.5 },
  },
  sunrise: {
    ambient: { intensity: 1.0, color: '#334466' },
    dir1: { position: [20, 5, 10], intensity: 4.0, color: '#ffaa44' },
    dir2: { position: [-10, -3, 5], intensity: 0.5, color: '#ff8833' },
    point1: { position: [0, 0, 10], intensity: 0.2, color: '#ffcc66' },
    spot: { position: [5, 12, 25], intensity: 0, color: '#ffffff', angle: 0.5 },
  },
  twilight: {
    ambient: { intensity: 1.2, color: '#ff8844' },
    dir1: { position: [-10, 15, -5], intensity: 2.0, color: '#cc6622' },
    dir2: { position: [10, 5, 15], intensity: 0.6, color: '#6644cc' },
    point1: { position: [8, -5, 10], intensity: 1.5, color: '#ff6644' },
    spot: { position: [5, 12, 25], intensity: 0, color: '#ffffff', angle: 0.5 },
  },
  ambient: {
    ambient: { intensity: 1.0, color: '#ff88cc' },
    dir1: { position: [0, 15, 10], intensity: 0.4, color: '#ffddaa' },
    dir2: { position: [0, 0, 10], intensity: 0, color: '#ffffff' },
    point1: { position: [15, 5, 20], intensity: 3.0, color: '#ff44aa' },
    spot: { position: [-15, 8, 10], intensity: 2.5, color: '#44ffee', angle: 1.0 },
  },
  none: {
    ambient: { intensity: 0.5, color: '#ffffff' },
    dir1: { position: [0, 10, 10], intensity: 0, color: '#ffffff' },
    dir2: { position: [0, 0, 10], intensity: 0, color: '#ffffff' },
    point1: { position: [0, 0, 10], intensity: 0, color: '#ffffff' },
    spot: { position: [5, 12, 25], intensity: 0, color: '#ffffff', angle: 0.5 },
  },
};

function SceneLighting({ preset = 'spotlight' }: { preset?: LightingPreset }) {
  const c = LIGHT_CONFIGS[preset] ?? LIGHT_CONFIGS.storefront;

  return (
    <>
      <ambientLight intensity={c.ambient.intensity} color={c.ambient.color} />
      <directionalLight
        position={c.dir1.position}
        intensity={c.dir1.intensity}
        color={c.dir1.color}
      />
      <directionalLight
        position={c.dir2.position}
        intensity={c.dir2.intensity}
        color={c.dir2.color}
      />
      <pointLight
        position={c.point1.position}
        intensity={c.point1.intensity}
        color={c.point1.color}
      />
      <spotLight
        position={c.spot.position}
        intensity={c.spot.intensity}
        color={c.spot.color}
        angle={c.spot.angle}
        penumbra={0.6}
      />
    </>
  );
}

// ─── Curated Head Component (self-contained, no external hook imports) ──────

function CuratedHead({
  headIndex,
  seed,
  bodyGeo,
  showGlasses = true,
  onLoaded,
  onGlassesZ,
}: {
  headIndex: number;
  seed: INounSeed;
  bodyGeo: THREE.BufferGeometry | null;
  showGlasses?: boolean;
  onLoaded?: (loaded: boolean) => void;
  onGlassesZ?: (z: number) => void;
}) {
  const [obj, setObj] = useState<THREE.Object3D | null>(null);

  useEffect(() => {
    let cancelled = false;
    onLoaded?.(false);

    (async () => {
      try {
        const res = await fetch('/models/heads/manifest.json');
        if (!res.ok) return;
        const manifest = await res.json();
        const entry = manifest[headIndex];
        // Skip GLB for heads where the sprite extrusion looks better than the 3DNouns model
        const SKIP_GLB: Set<string> = new Set(['film-strip']);
        const glbUrl = SKIP_GLB.has(entry?.traitName) ? null : entry?.threeDNounsGlb;
        if (!glbUrl || cancelled) return;

        const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader');
        const loader = new GLTFLoader();
        const gltf = await loader.loadAsync(glbUrl);
        if (cancelled) return;

        const scene = gltf.scene;

        // Hip-rose (index 0) has a unique thicker shape the GLB mesh can't represent.
        // Hide GLB glasses for hip-rose — the voxel glasses layer will be shown instead.
        // Also hide when the user has toggled off the glasses layer.
        const isHipRose = seed.glasses === 0;
        if (isHipRose || !showGlasses) {
          scene.traverse(child => {
            if (child.name === 'GlassesUV' || child.name.toLowerCase().includes('glasses')) {
              child.visible = false;
            }
          });
        }
        if (!isHipRose && showGlasses) {
          // Swap glasses texture with pre-built one matching the seed's trait
          const glassesTexUrl = `/models/heads/glasses-textures/${seed.glasses}.png`;
          const texLoader = new THREE.TextureLoader();
          const glassesTex = await texLoader.loadAsync(glassesTexUrl);
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
                mat.depthWrite = true;
                mat.polygonOffset = true;
                mat.polygonOffsetFactor = -4;
                mat.polygonOffsetUnits = -4;
                mat.needsUpdate = true;
              }
              // Nudge glasses forward to eliminate seam with head mesh
              mesh.renderOrder = 1;
              mesh.position.z += 0.08;
              // Per-head glasses Y nudge (positive = up) — bake into geometry
              const GLASSES_Y_NUDGE: Record<string, number> = {
                cd: 1,
                'ruler-triangular': 1,
                watch: 1,
              };
              const glassesYNudge = GLASSES_Y_NUDGE[entry.traitName] ?? 0;
              if (glassesYNudge && mesh.geometry) {
                const nudgeMatrix = new THREE.Matrix4().makeTranslation(0, glassesYNudge, 0);
                mesh.geometry.applyMatrix4(nudgeMatrix);
              }
            }
          });
        }

        // All 3DNouns heads have identical bounds: x=-9..7, y=25..31, z=-0.5..0.5
        // The GLB head bottom (Y=25) needs to align with the voxel body top
        // The GLB center X (-1) needs to align with the voxel body center X (0)
        // Voxel body/head are in a grid centered at (-15.5, -15.5) to (+15.5, +15.5)
        // Head pixels sit at rows ~7-20 (Y = -8.5 to +4.5 in voxel coords)
        // So GLB Y=25 should map to voxel Y ≈ -8.5 (where head meets body)

        // Shift GLB coords to voxel coords.
        // GLB native Z spans -0.5..+0.5 (1 voxel deep).
        // Voxel body is at Z=0, depth 2.5 → front face at +1.25.
        // We want the GLB head's back face (Z=-0.5 + offset) to align
        // with the voxel body's back face (Z=-1.25), so offset = -0.75.
        // But that buries it — instead align centers: body center Z=0,
        // GLB center Z=0.25 → shift back by -0.25 to sit at Z=0.
        // Per-head nudges — imported from shared module (lib/headNudges.ts)
        const offsetX = HEAD_BASE_OFFSET[0] + (HEAD_X_NUDGE[entry.traitName] ?? 0);
        const offsetY = HEAD_BASE_OFFSET[1] + (HEAD_Y_NUDGE[entry.traitName] ?? 0);
        const offsetZ = HEAD_BASE_OFFSET[2] + (HEAD_Z_NUDGE[entry.traitName] ?? 0);

        const matrix = new THREE.Matrix4();
        matrix.makeTranslation(offsetX, offsetY, offsetZ);
        scene.traverse(child => {
          if ((child as THREE.Mesh).isMesh && child.visible) {
            (child as THREE.Mesh).geometry?.applyMatrix4(matrix);
          }
        });

        scene.position.set(0, 0, 0);
        scene.scale.set(1, 1, 1);
        scene.updateMatrixWorld(true);

        if (!cancelled) {
          // Compute front face Z from VISIBLE meshes only (hip-rose voxel glasses positioning)
          if (isHipRose) {
            const box = new THREE.Box3();
            scene.traverse(child => {
              if ((child as THREE.Mesh).isMesh && child.visible) {
                const meshBox = new THREE.Box3().setFromObject(child);
                box.union(meshBox);
              }
            });
            if (!box.isEmpty()) {
              console.log(`[CuratedHead] hip-rose front Z: ${box.max.z.toFixed(2)}`);
              onGlassesZ?.(box.max.z + 0.5);
            }
          }
          setObj(scene);
          onLoaded?.(true);
        }
      } catch {
        if (!cancelled) onLoaded?.(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [headIndex, seed?.glasses, bodyGeo, showGlasses]);

  if (!obj) return null;
  return <primitive object={obj} />;
}

// ─── Tilt config ────────────────────────────────────────────────────────────

interface Tilt {
  x: number;
  y: number;
}

const ROT_Y_DEG = 15;
const ROT_X_DEG = 10;
const ROT_Z_DEG = 2.5;

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}
function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}
const DEG = Math.PI / 180;

// ─── Voxel data helpers for disintegration ─────────────────────────────────

interface FlatVoxel {
  x: number;
  y: number;
  z: number;
  r: number;
  g: number;
  b: number;
}

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Flatten NounLayers into a single array of positioned voxels with proper z-offsets */
function layersToFlatVoxels(layers: NounLayers): FlatVoxel[] {
  const bodyZ = 0;
  const blingZ = BODY_DEPTH / 2 + BLING_DEPTH / 2;
  const headZ = BODY_DEPTH / 2 - BLING_DEPTH / 2 + 0.03;
  const glassesZ = headZ + HEAD_DEPTH / 2 + GLASSES_DEPTH / 2 + 0.02;

  const result: FlatVoxel[] = [];
  for (const p of layers.body)
    result.push({ x: p.x - 15.5, y: p.y - 15.5, z: bodyZ, r: p.r, g: p.g, b: p.b });
  for (const p of layers.bling)
    result.push({ x: p.x - 15.5, y: p.y - 15.5, z: blingZ, r: p.r, g: p.g, b: p.b });
  for (const p of layers.head)
    result.push({ x: p.x - 15.5, y: p.y - 15.5, z: headZ, r: p.r, g: p.g, b: p.b });
  for (const p of layers.glasses)
    result.push({ x: p.x - 15.5, y: p.y - 15.5, z: glassesZ, r: p.r, g: p.g, b: p.b });
  return result;
}

function seedToFlatVoxels(seed: INounSeed, layerVisibility?: LayerVisibility): FlatVoxel[] {
  const layers = seedToLayers(seed, getNounData, ImageData.palette, layerVisibility);
  return layersToFlatVoxels(layers);
}

// ─── Disintegration transition scene ────────────────────────────────────────

const TRANSITION_DURATION = 2.2;
const SCATTER_RADIUS = 25;

interface DisintegrationProps {
  oldVoxels: FlatVoxel[];
  newVoxels: FlatVoxel[];
  onComplete: () => void;
}

function DisintegrationScene({ oldVoxels, newVoxels, onComplete }: DisintegrationProps) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const timeRef = useRef(0);
  const doneRef = useRef(false);

  const count = Math.max(oldVoxels.length, newVoxels.length);

  // Pre-compute per-voxel animation data
  const animData = useMemo(() => {
    const startPositions = new Float32Array(count * 3);
    const endPositions = new Float32Array(count * 3);
    const startColors = new Float32Array(count * 3);
    const endColors = new Float32Array(count * 3);
    const scatterDirs = new Float32Array(count * 3);
    const scatterSpeeds = new Float32Array(count);
    const rotAxes = new Float32Array(count * 3);
    const rotSpeeds = new Float32Array(count);

    for (let i = 0; i < count; i++) {
      const ov = oldVoxels[i % oldVoxels.length];
      const nv = newVoxels[i % newVoxels.length];

      if (i < oldVoxels.length) {
        startPositions[i * 3] = ov.x;
        startPositions[i * 3 + 1] = ov.y;
        startPositions[i * 3 + 2] = ov.z;
        startColors[i * 3] = srgbToLinear(ov.r / 255);
        startColors[i * 3 + 1] = srgbToLinear(ov.g / 255);
        startColors[i * 3 + 2] = srgbToLinear(ov.b / 255);
      } else {
        // Extra voxels for new noun - start from scattered position
        const angle = Math.random() * Math.PI * 2;
        const elev = (Math.random() - 0.5) * Math.PI;
        startPositions[i * 3] = Math.cos(angle) * Math.cos(elev) * SCATTER_RADIUS;
        startPositions[i * 3 + 1] = Math.sin(elev) * SCATTER_RADIUS;
        startPositions[i * 3 + 2] = Math.sin(angle) * Math.cos(elev) * SCATTER_RADIUS;
        startColors[i * 3] = srgbToLinear(nv.r / 255);
        startColors[i * 3 + 1] = srgbToLinear(nv.g / 255);
        startColors[i * 3 + 2] = srgbToLinear(nv.b / 255);
      }

      if (i < newVoxels.length) {
        endPositions[i * 3] = nv.x;
        endPositions[i * 3 + 1] = nv.y;
        endPositions[i * 3 + 2] = nv.z;
        endColors[i * 3] = srgbToLinear(nv.r / 255);
        endColors[i * 3 + 1] = srgbToLinear(nv.g / 255);
        endColors[i * 3 + 2] = srgbToLinear(nv.b / 255);
      } else {
        // Extra voxels from old noun - scatter outward to disappear
        const angle = Math.random() * Math.PI * 2;
        const elev = (Math.random() - 0.5) * Math.PI;
        endPositions[i * 3] = Math.cos(angle) * Math.cos(elev) * SCATTER_RADIUS;
        endPositions[i * 3 + 1] = Math.sin(elev) * SCATTER_RADIUS;
        endPositions[i * 3 + 2] = Math.sin(angle) * Math.cos(elev) * SCATTER_RADIUS;
        endColors[i * 3] = startColors[i * 3];
        endColors[i * 3 + 1] = startColors[i * 3 + 1];
        endColors[i * 3 + 2] = startColors[i * 3 + 2];
      }

      // Random scatter direction (normalized) and speed
      const sx = Math.random() - 0.5;
      const sy = Math.random() - 0.5;
      const sz = Math.random() - 0.5;
      const sLen = Math.sqrt(sx * sx + sy * sy + sz * sz) || 1;
      scatterDirs[i * 3] = sx / sLen;
      scatterDirs[i * 3 + 1] = sy / sLen;
      scatterDirs[i * 3 + 2] = sz / sLen;
      scatterSpeeds[i] = 0.6 + Math.random() * 0.8;

      // Random per-voxel tumble rotation
      const ax = Math.random() - 0.5;
      const ay = Math.random() - 0.5;
      const az = Math.random() - 0.5;
      const aLen = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
      rotAxes[i * 3] = ax / aLen;
      rotAxes[i * 3 + 1] = ay / aLen;
      rotAxes[i * 3 + 2] = az / aLen;
      rotSpeeds[i] = (2 + Math.random() * 6) * (Math.random() < 0.5 ? 1 : -1);
    }

    return {
      startPositions,
      endPositions,
      startColors,
      endColors,
      scatterDirs,
      scatterSpeeds,
      rotAxes,
      rotSpeeds,
    };
  }, [oldVoxels, newVoxels, count]);

  // Build geometry with instanced color attribute
  const { geometry, colorAttr } = useMemo(() => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const colorArray = new Float32Array(count * 3);
    for (let i = 0; i < count * 3; i++) {
      colorArray[i] = animData.startColors[i];
    }
    const attr = new THREE.InstancedBufferAttribute(colorArray, 3);
    geo.setAttribute('color', attr);
    return { geometry: geo, colorAttr: attr };
  }, [count, animData]);

  useEffect(() => {
    return () => geometry.dispose();
  }, [geometry]);

  // Set initial instance matrices
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      dummy.position.set(
        animData.startPositions[i * 3],
        animData.startPositions[i * 3 + 1],
        animData.startPositions[i * 3 + 2],
      );
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [count, animData]);

  useFrame((_, delta) => {
    if (!meshRef.current || !groupRef.current) return;

    timeRef.current += delta;
    const t = Math.min(timeRef.current / TRANSITION_DURATION, 1);

    if (t >= 1 && !doneRef.current) {
      doneRef.current = true;
      onComplete();
      return;
    }

    // Overall group spin (full 360)
    const spinEased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    groupRef.current.rotation.y = spinEased * Math.PI * 2;
    groupRef.current.rotation.x = Math.sin(spinEased * Math.PI) * -8 * DEG;

    // Scatter + morph complete by t=0.65 so the last third of the spin shows the finished noun
    // Scatter curve: peaks around t=0.3, fully settled by t=0.65
    const scatterNorm = t < 0.65 ? t / 0.65 : 1;
    const scatterT = t < 0.65 ? Math.sin(scatterNorm * Math.PI) : 0;
    // Morph curve: starts at t=0.15, fully morphed by t=0.65
    const morphT = t < 0.15 ? 0 : t >= 0.65 ? 1 : (t - 0.15) / 0.5;
    const morphEased = morphT * morphT * (3 - 2 * morphT); // smoothstep

    const mesh = meshRef.current;
    const dummy = new THREE.Object3D();
    const axis = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const colors = colorAttr.array as Float32Array;

    for (let i = 0; i < count; i++) {
      const i3 = i * 3;

      // Lerp between start and end positions
      const baseX =
        animData.startPositions[i3] +
        (animData.endPositions[i3] - animData.startPositions[i3]) * morphEased;
      const baseY =
        animData.startPositions[i3 + 1] +
        (animData.endPositions[i3 + 1] - animData.startPositions[i3 + 1]) * morphEased;
      const baseZ =
        animData.startPositions[i3 + 2] +
        (animData.endPositions[i3 + 2] - animData.startPositions[i3 + 2]) * morphEased;

      // Add scatter offset
      const scatter = scatterT * SCATTER_RADIUS * animData.scatterSpeeds[i];
      dummy.position.set(
        baseX + animData.scatterDirs[i3] * scatter,
        baseY + animData.scatterDirs[i3 + 1] * scatter,
        baseZ + animData.scatterDirs[i3 + 2] * scatter,
      );

      // Per-voxel tumble rotation
      axis.set(animData.rotAxes[i3], animData.rotAxes[i3 + 1], animData.rotAxes[i3 + 2]);
      quat.setFromAxisAngle(axis, scatterT * animData.rotSpeeds[i] * Math.PI);
      dummy.quaternion.copy(quat);

      // Scale transitions complete by t=0.65 to match scatter/morph
      if (i >= newVoxels.length) {
        dummy.scale.setScalar(Math.max(0, 1 - t * 2));
      } else if (i >= oldVoxels.length) {
        dummy.scale.setScalar(Math.min(1, t * 2.5));
      } else {
        dummy.scale.setScalar(1);
      }

      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      // Lerp colors
      colors[i3] =
        animData.startColors[i3] + (animData.endColors[i3] - animData.startColors[i3]) * morphEased;
      colors[i3 + 1] =
        animData.startColors[i3 + 1] +
        (animData.endColors[i3 + 1] - animData.startColors[i3 + 1]) * morphEased;
      colors[i3 + 2] =
        animData.startColors[i3 + 2] +
        (animData.endColors[i3 + 2] - animData.startColors[i3 + 2]) * morphEased;
    }

    mesh.instanceMatrix.needsUpdate = true;
    colorAttr.needsUpdate = true;
  });

  return (
    <>
      {}
      <group ref={groupRef}>
        <instancedMesh ref={meshRef} args={[geometry, undefined, count]} frustumCulled={false}>
          <meshBasicMaterial vertexColors toneMapped={false} />
        </instancedMesh>
      </group>
      {}
    </>
  );
}

// ─── Inner R3F scene (tilt mode — parallax with proper lighting) ────────────

interface TiltSceneProps {
  seed?: INounSeed;
  voxelMap?: VoxelMap;
  tiltRef: React.MutableRefObject<Tilt>;
  layerVisibility?: LayerVisibility;
  autoSpin?: boolean;
  lightingPreset?: LightingPreset;
}

function TiltScene({
  seed,
  voxelMap,
  tiltRef,
  layerVisibility,
  autoSpin = false,
  lightingPreset = 'spotlight',
}: TiltSceneProps) {
  const groupRef = useRef<THREE.Group>(null);
  const currentTilt = useRef<Tilt>({ x: 0, y: 0 });
  const spinTime = useRef(0);
  const [curatedHeadLoaded, setCuratedHeadLoaded] = useState(false);
  const [glassesZ, setGlassesZ] = useState<number | null>(null);
  const prevSeedRef = useRef<string>('');
  const prevVoxelsRef = useRef<FlatVoxel[] | null>(null);

  const [transition, setTransition] = useState<{
    oldVoxels: FlatVoxel[];
    newVoxels: FlatVoxel[];
  } | null>(null);

  // Compare seed by value (not reference) so geometry rebuilds on navigation
  const seedKey = seed
    ? `${seed.background}-${seed.body}-${seed.accessory}-${seed.head}-${seed.glasses}`
    : '';

  // Compute flat voxels for current seed (used by disintegration)
  const currentVoxels = useMemo(() => {
    if (voxelMap || !seed) return null;
    return seedToFlatVoxels(seed, layerVisibility);
  }, [seedKey, layerVisibility, voxelMap]);

  // Detect seed change and trigger disintegration
  useEffect(() => {
    if (!seedKey || !currentVoxels) {
      prevSeedRef.current = seedKey;
      prevVoxelsRef.current = currentVoxels;
      return;
    }
    if (prevSeedRef.current && prevSeedRef.current !== seedKey && prevVoxelsRef.current) {
      setTransition({
        oldVoxels: prevVoxelsRef.current,
        newVoxels: currentVoxels,
      });
    }
    prevSeedRef.current = seedKey;
    prevVoxelsRef.current = currentVoxels;
  }, [seedKey, currentVoxels]);

  const handleTransitionComplete = useCallback(() => {
    setTransition(null);
  }, []);

  // Per-head depth overrides for heads that look better thicc
  const THICC_HEADS: Record<number, number> = { 108: 7 /* icepop-b */ };

  const { bodyGeo, blingGeo, headGeo, glassesGeo } = useMemo(() => {
    if (voxelMap) {
      return {
        bodyGeo: buildGeometryFromVoxelMap(voxelMap),
        blingGeo: null,
        headGeo: null,
        glassesGeo: null,
      };
    }
    if (!seed) {
      return { bodyGeo: null, blingGeo: null, headGeo: null, glassesGeo: null };
    }
    const layers = seedToLayers(seed, getNounData, ImageData.palette, layerVisibility);
    return buildNounGeometries(layers, THICC_HEADS[seed.head]);
  }, [seedKey, layerVisibility, voxelMap]);

  useEffect(() => {
    return () => {
      bodyGeo?.dispose();
      blingGeo?.dispose();
      headGeo?.dispose();
      glassesGeo?.dispose();
    };
  }, [bodyGeo, blingGeo, glassesGeo, headGeo]);

  useEffect(() => {
    spinTime.current = 0;
  }, [seedKey, voxelMap, autoSpin]);

  useFrame((_, delta) => {
    if (!groupRef.current || transition) return;

    if (autoSpin) {
      // Cinematic spin: ease-in-out rotation over ~2.5s
      spinTime.current += delta;
      const t = Math.min(spinTime.current / 2.5, 1);
      // Ease-in-out cubic
      const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      groupRef.current.rotation.y = eased * Math.PI * 2; // full 360°
      groupRef.current.rotation.x = Math.sin(eased * Math.PI) * -8 * DEG; // subtle nod
      return;
    }

    const smoothing = 0.07;
    currentTilt.current.x = lerp(currentTilt.current.x, tiltRef.current.x, smoothing);
    currentTilt.current.y = lerp(currentTilt.current.y, tiltRef.current.y, smoothing);

    const { x, y } = currentTilt.current;
    groupRef.current.rotation.y = x * ROT_Y_DEG * DEG;
    groupRef.current.rotation.x = y * -ROT_X_DEG * DEG;
    groupRef.current.rotation.z = x * -ROT_Z_DEG * DEG;
  });

  // During transition, render DisintegrationScene instead of static meshes
  if (transition) {
    return (
      <DisintegrationScene
        oldVoxels={transition.oldVoxels}
        newVoxels={transition.newVoxels}
        onComplete={handleTransitionComplete}
      />
    );
  }

  return (
    <>
      <SceneLighting preset={lightingPreset} />
      <SceneEnvironment tiltRef={tiltRef} lightingPreset={lightingPreset} />
      <group ref={groupRef}>
        {bodyGeo && (
          <mesh geometry={bodyGeo} receiveShadow>
            <meshLambertMaterial vertexColors />
          </mesh>
        )}
        {blingGeo && (
          <mesh geometry={blingGeo} receiveShadow>
            <meshLambertMaterial vertexColors />
          </mesh>
        )}
        {!curatedHeadLoaded && headGeo && (
          <mesh geometry={headGeo}>
            <meshLambertMaterial vertexColors />
          </mesh>
        )}
        {/* Show voxel glasses when: no curated head, OR hip-rose (curated head hides its GLB glasses) */}
        {glassesGeo &&
          layerVisibility?.glasses !== false &&
          (!curatedHeadLoaded || (seed?.glasses === 0 && glassesZ != null)) && (
            <group
              position={
                seed?.glasses === 0 && glassesZ != null ? [0, 0, glassesZ - 2.55] : [0, 0, 0]
              }
            >
              <mesh geometry={glassesGeo}>
                <meshLambertMaterial vertexColors />
              </mesh>
            </group>
          )}
        {seed && !voxelMap && (
          <CuratedHead
            headIndex={seed.head}
            seed={seed}
            bodyGeo={bodyGeo}
            showGlasses={layerVisibility?.glasses !== false}
            onLoaded={setCuratedHeadLoaded}
            onGlassesZ={setGlassesZ}
          />
        )}
      </group>
      {}
    </>
  );
}

// ─── Inner R3F scene (interactive mode — orbit + shadows) ────────────────────

interface InteractiveSceneProps {
  seed?: INounSeed;
  voxelMap?: VoxelMap;
  layerVisibility?: LayerVisibility;
  autoRotate?: boolean;
  interactionMode?: 'grab' | 'twist';
  lightingPreset?: LightingPreset;
}

function InteractiveScene({
  seed,
  voxelMap,
  layerVisibility,
  autoRotate = false,
  interactionMode = 'twist',
  lightingPreset = 'spotlight',
}: InteractiveSceneProps) {
  const [curatedHeadLoaded, setCuratedHeadLoaded] = useState(false);
  const [glassesZ, setGlassesZ] = useState<number | null>(null);
  // Compare seed by value (not reference) so geometry rebuilds on navigation
  const seedKey = seed
    ? `${seed.background}-${seed.body}-${seed.accessory}-${seed.head}-${seed.glasses}`
    : '';

  const { bodyGeo, blingGeo, headGeo, glassesGeo } = useMemo(() => {
    if (voxelMap) {
      return {
        bodyGeo: buildGeometryFromVoxelMap(voxelMap),
        blingGeo: null,
        headGeo: null,
        glassesGeo: null,
      };
    }
    if (!seed) {
      return { bodyGeo: null, blingGeo: null, headGeo: null, glassesGeo: null };
    }
    const layers = seedToLayers(seed, getNounData, ImageData.palette, layerVisibility);
    return buildNounGeometries(layers);
  }, [seedKey, layerVisibility, voxelMap]);

  useEffect(() => {
    return () => {
      bodyGeo?.dispose();
      blingGeo?.dispose();
      headGeo?.dispose();
      glassesGeo?.dispose();
    };
  }, [bodyGeo, blingGeo, glassesGeo, headGeo]);

  return (
    <>
      <SceneLighting preset={lightingPreset} />
      <SceneEnvironment lightingPreset={lightingPreset} />
      {bodyGeo && (
        <mesh geometry={bodyGeo} receiveShadow>
          <meshLambertMaterial vertexColors />
        </mesh>
      )}
      {blingGeo && (
        <mesh geometry={blingGeo} receiveShadow>
          <meshLambertMaterial vertexColors />
        </mesh>
      )}
      {!curatedHeadLoaded && headGeo && (
        <mesh geometry={headGeo}>
          <meshLambertMaterial vertexColors />
        </mesh>
      )}
      {glassesGeo &&
        layerVisibility?.glasses !== false &&
        (!curatedHeadLoaded || (seed?.glasses === 0 && glassesZ != null)) && (
          <group
            position={seed?.glasses === 0 && glassesZ != null ? [0, 0, glassesZ - 2.55] : [0, 0, 0]}
          >
            <mesh geometry={glassesGeo}>
              <meshLambertMaterial vertexColors />
            </mesh>
          </group>
        )}
      {seed && !voxelMap && (
        <CuratedHead
          headIndex={seed.head}
          seed={seed}
          bodyGeo={bodyGeo}
          showGlasses={layerVisibility?.glasses !== false}
          onLoaded={setCuratedHeadLoaded}
          onGlassesZ={setGlassesZ}
        />
      )}

      <OrbitControls
        enablePan={interactionMode === 'grab'}
        enableRotate={interactionMode === 'twist'}
        enableZoom
        enableDamping
        dampingFactor={0.12}
        autoRotate={autoRotate}
        autoRotateSpeed={1.3}
        screenSpacePanning
        panSpeed={0.9}
        minDistance={10}
        maxDistance={80}
        minPolarAngle={Math.PI * 0.05}
        maxPolarAngle={Math.PI * 0.95}
        mouseButtons={{
          LEFT: interactionMode === 'grab' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: interactionMode === 'grab' ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE,
        }}
        touches={{
          ONE: interactionMode === 'grab' ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE,
          TWO: interactionMode === 'grab' ? THREE.TOUCH.DOLLY_PAN : THREE.TOUCH.DOLLY_ROTATE,
        }}
      />
      {}
    </>
  );
}

// ─── Background body layers for editable mode ─────────────────────────────

/** Render non-editable body/bling/glasses as static lit meshes behind the editor.
 *  Head excluded — curated head voxeldata replaces it.
 *  Glasses included — curated data only has the head shape, not the noun's actual glasses trait.
 *  glassesZShift moves glasses to the front face of the curated head. */
function EditableBackgroundBody({
  seed,
  layerVisibility,
  lightingPreset = 'storefront',
  glassesZShift = 0,
  hideGlasses = false,
}: {
  seed: INounSeed;
  layerVisibility?: LayerVisibility;
  lightingPreset?: LightingPreset;
  glassesZShift?: number;
  /** Hide voxel glasses — used in mesh mode where GLB provides its own glasses */
  hideGlasses?: boolean;
}) {
  const seedKey = `${seed.background}-${seed.body}-${seed.accessory}-${seed.head}-${seed.glasses}`;

  const { bodyGeo, blingGeo, glassesGeo } = useMemo(() => {
    const vis: LayerVisibility = {
      body: layerVisibility?.body ?? true,
      accessory: layerVisibility?.accessory ?? true,
      head: false, // editor voxel layer has the curated head
      glasses: layerVisibility?.glasses ?? true,
    };
    const layers = seedToLayers(seed, getNounData, ImageData.palette, vis);
    const geos = buildNounGeometries(layers);
    geos.headGeo?.dispose();
    return { bodyGeo: geos.bodyGeo, blingGeo: geos.blingGeo, glassesGeo: geos.glassesGeo };
  }, [seedKey, layerVisibility]);

  useEffect(() => {
    return () => {
      bodyGeo?.dispose();
      blingGeo?.dispose();
      glassesGeo?.dispose();
    };
  }, [bodyGeo, blingGeo, glassesGeo]);

  return (
    <>
      <SceneLighting preset={lightingPreset} />
      {bodyGeo && (
        <mesh geometry={bodyGeo}>
          <meshLambertMaterial vertexColors />
        </mesh>
      )}
      {blingGeo && (
        <mesh geometry={blingGeo}>
          <meshLambertMaterial vertexColors />
        </mesh>
      )}
      {glassesGeo && !hideGlasses && (
        <group position={[0, 0, glassesZShift]}>
          <mesh geometry={glassesGeo}>
            <meshLambertMaterial vertexColors />
          </mesh>
        </group>
      )}
    </>
  );
}

// ─── Responsive camera ──────────────────────────────────────────────────────

function ResponsiveCamera({
  fullscreen,
  viewStateRef,
}: {
  fullscreen?: boolean;
  viewStateRef?: { current: EditableSceneViewState | null };
}) {
  const { camera, size } = useThree();
  useEffect(() => {
    const perspectiveCamera = camera as THREE.PerspectiveCamera;
    const savedView = viewStateRef?.current;

    if (savedView) {
      camera.position.set(...savedView.cameraPosition);
      perspectiveCamera.zoom = savedView.zoom;
      camera.lookAt(...savedView.target);
      camera.updateProjectionMatrix();
      return;
    }

    const aspect = size.width / size.height;
    if (fullscreen === true) {
      const base = aspect > 1 ? 34 : 34 / aspect;
      perspectiveCamera.position.set(0, 0, base);
    } else {
      const dist = aspect > 1 ? 38 : 38 / aspect;
      perspectiveCamera.position.set(0, 2, dist);
    }
    camera.lookAt(0, 0, 0);
    perspectiveCamera.updateProjectionMatrix();

    if (viewStateRef) {
      viewStateRef.current = {
        cameraPosition: [camera.position.x, camera.position.y, camera.position.z],
        target: [0, 0, 0],
        zoom: perspectiveCamera.zoom,
      };
    }
  }, [camera, fullscreen, size.height, size.width, viewStateRef]);
  return null;
}

// ─── Main component ─────────────────────────────────────────────────────────

/** Mesh editing config — when present, renders GLB mesh editor instead of voxels */
export interface MeshEditConfig {
  glbPath: string;
  glassesIndex: number;
  brushSize: number;
  persistenceKey: string;
  onStateChange?: () => void;
  undoRef?: React.MutableRefObject<(() => void) | null>;
  redoRef?: React.MutableRefObject<(() => void) | null>;
  sceneRef?: React.MutableRefObject<THREE.Object3D | null>;
  headOffset?: [number, number, number];
  snapshotRef?: React.MutableRefObject<(() => string | null) | null>;
}

export interface EditableConfig {
  pixels: string[][];
  initialVoxelMap?: VoxelMap | null;
  activeTool: Tool | 'build';
  activeColor: string;
  onPixelChange: (x: number, y: number, color: string) => void;
  onPixelsFill: (changes: [number, number, string][]) => void;
  onColorPick: (color: string) => void;
  voxelDepth?: number;
  interactionMode?: 'sculpt' | 'grab' | 'twist';
  visibilityMask?: boolean[][];
  displayPixels?: string[][];
  viewStateRef?: { current: EditableSceneViewState | null };
  onVoxelMapChange?: (map: VoxelMap) => void;
  /** Seed for rendering non-editable background body/glasses layers */
  backgroundSeed?: INounSeed;
  /** Which background layers to show alongside the editor */
  backgroundVisibility?: LayerVisibility;
  /** When present, use mesh editor instead of voxel editor */
  meshConfig?: MeshEditConfig;
}

interface NounParallaxProps {
  seed?: INounSeed;
  voxelMap?: VoxelMap;
  interactive?: boolean;
  interactionMode?: 'grab' | 'twist';
  fullscreen?: boolean;
  editable?: EditableConfig;
  layerVisibility?: LayerVisibility;
  /** Auto-spin for cinematic intro (one full rotation over ~2s) */
  autoSpin?: boolean;
  autoRotate?: boolean;
  pointerEnabled?: boolean;
  lightingPreset?: LightingPreset;
}

// Lazy-load EditableScene (heavy — raycasting + individual meshes)
const EditableSceneComponent = React.lazy(() => import('./VoxelEditableScene'));
// Lazy-load MeshEditableScene (GLB mesh painting — replaces voxel editor when GLB available)
const MeshEditableSceneComponent = React.lazy(() => import('./MeshEditableScene'));

const NounParallax: React.FC<NounParallaxProps> = ({
  seed,
  voxelMap,
  interactive = false,
  interactionMode = 'twist',
  fullscreen = false,
  editable,
  layerVisibility,
  autoSpin = false,
  autoRotate = false,
  pointerEnabled = true,
  lightingPreset = 'spotlight',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const tiltRef = useRef<Tilt>({ x: 0, y: 0 });
  const hasGyro = useRef(false);
  const [needsPermission, setNeedsPermission] = useState(false);
  const showPermissionHint = useCallback(() => {
    setNeedsPermission(true);
  }, []);

  // ── Mouse (desktop) — tilt mode only ──
  useEffect(() => {
    if (interactive || !pointerEnabled) return;
    const container = containerRef.current;
    if (container == null) return;

    const onMouseMove = (e: MouseEvent) => {
      if (hasGyro.current) return;
      const rect = container.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      tiltRef.current = {
        x: clamp((e.clientX - cx) / (rect.width / 2), -1, 1),
        y: clamp((e.clientY - cy) / (rect.height / 2), -1, 1),
      };
    };
    const onMouseLeave = () => {
      if (hasGyro.current) return;
      tiltRef.current = { x: 0, y: 0 };
    };

    container.addEventListener('mousemove', onMouseMove);
    container.addEventListener('mouseleave', onMouseLeave);
    return () => {
      container.removeEventListener('mousemove', onMouseMove);
      container.removeEventListener('mouseleave', onMouseLeave);
    };
  }, [interactive, pointerEnabled]);

  // ── Touch (mobile without gyro) — tilt mode only ──
  useEffect(() => {
    if (interactive || !pointerEnabled) return;
    const container = containerRef.current;
    if (container == null) return;

    const onTouchMove = (e: TouchEvent) => {
      if (hasGyro.current) return;
      const touch = e.touches[0];
      if (touch == null) return;
      const rect = container.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      tiltRef.current = {
        x: clamp((touch.clientX - cx) / (rect.width / 2), -1, 1),
        y: clamp((touch.clientY - cy) / (rect.height / 2), -1, 1),
      };
    };
    const onTouchEnd = () => {
      if (hasGyro.current) return;
      tiltRef.current = { x: 0, y: 0 };
    };

    container.addEventListener('touchmove', onTouchMove, { passive: true });
    container.addEventListener('touchend', onTouchEnd);
    container.addEventListener('touchcancel', onTouchEnd);
    return () => {
      container.removeEventListener('touchmove', onTouchMove);
      container.removeEventListener('touchend', onTouchEnd);
      container.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [interactive, pointerEnabled]);

  // ── DeviceOrientation (gyroscope) — tilt mode only ──
  useEffect(() => {
    if (interactive || !pointerEnabled) return;
    const onOrientation = (e: DeviceOrientationEvent) => {
      if (e.gamma == null || e.beta == null) return;
      hasGyro.current = true;
      tiltRef.current = {
        x: clamp(e.gamma / 30, -1, 1),
        y: clamp((e.beta - 45) / 30, -1, 1),
      };
    };

    const DOE = DeviceOrientationEvent as unknown as {
      requestPermission?: () => Promise<string>;
    };
    if (typeof DOE.requestPermission === 'function') {
      showPermissionHint();
    } else {
      window.addEventListener('deviceorientation', onOrientation);
    }
    return () => window.removeEventListener('deviceorientation', onOrientation);
  }, [interactive, pointerEnabled, showPermissionHint]);

  const requestPermission = useCallback(async () => {
    const DOE = DeviceOrientationEvent as unknown as {
      requestPermission: () => Promise<string>;
    };
    try {
      const result = await DOE.requestPermission();
      if (result === 'granted') {
        setNeedsPermission(false);
        window.addEventListener('deviceorientation', (e: DeviceOrientationEvent) => {
          if (e.gamma == null || e.beta == null) return;
          hasGyro.current = true;
          tiltRef.current = {
            x: clamp(e.gamma / 30, -1, 1),
            y: clamp((e.beta - 45) / 30, -1, 1),
          };
        });
      }
    } catch {
      // denied — touch/mouse fallback still works
    }
  }, []);

  return (
    <div
      ref={containerRef}
      data-noun-parallax-root="true"
      className={`${classes.container} ${fullscreen ? classes.fullscreen : ''}`}
      onClick={!interactive && pointerEnabled && needsPermission ? requestPermission : undefined}
      style={{ pointerEvents: pointerEnabled ? 'auto' : 'none' }}
    >
      <Canvas
        className={classes.canvas}
        style={
          fullscreen ? { position: 'absolute', inset: 0, width: '100%', height: '100%' } : undefined
        }
        camera={{ fov: 50, near: 1, far: 200 }}
        shadows
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.LinearToneMapping;
          gl.toneMappingExposure = 1.2;
        }}
        dpr={[1, 1.5]}
        frameloop="always"
        resize={{ scroll: false, debounce: { scroll: 0, resize: 0 } }}
      >
        <Suspense fallback={null}>
          <ResponsiveCamera fullscreen={fullscreen} viewStateRef={editable?.viewStateRef} />
          {editable ? (
            <>
              {editable.backgroundSeed && (
                <EditableBackgroundBody
                  seed={editable.backgroundSeed}
                  layerVisibility={editable.backgroundVisibility}
                  lightingPreset={lightingPreset}
                  glassesZShift={(() => {
                    // Voxel mode: shift glasses to front face of curated head
                    if (!editable.initialVoxelMap) return 0;
                    let maxZ = 0;
                    for (const key of editable.initialVoxelMap.keys()) {
                      const z = Number(key.split(',')[2]);
                      if (z > maxZ) maxZ = z;
                    }
                    return Math.max(0, maxZ - 2.55 + GLASSES_DEPTH);
                  })()}
                  hideGlasses={!!editable.meshConfig && editable.meshConfig.glassesIndex !== 0}
                />
              )}
              {editable.meshConfig ? (
                <MeshEditableSceneComponent
                  glbPath={editable.meshConfig.glbPath}
                  glassesIndex={editable.meshConfig.glassesIndex}
                  activeTool={editable.activeTool}
                  activeColor={editable.activeColor}
                  brushSize={editable.meshConfig.brushSize}
                  interactionMode={editable.interactionMode ?? 'sculpt'}
                  onColorPick={editable.onColorPick}
                  viewStateRef={editable.viewStateRef}
                  onStateChange={editable.meshConfig.onStateChange}
                  persistenceKey={editable.meshConfig.persistenceKey}
                  undoRef={editable.meshConfig.undoRef}
                  redoRef={editable.meshConfig.redoRef}
                  headVisible={editable.backgroundVisibility?.head ?? true}
                  glassesVisible={editable.backgroundVisibility?.glasses ?? true}
                  sceneRef={editable.meshConfig.sceneRef}
                  headOffset={editable.meshConfig.headOffset}
                  snapshotRef={editable.meshConfig.snapshotRef}
                />
              ) : (
                <EditableSceneComponent
                  pixels={editable.pixels}
                  initialVoxelMap={editable.initialVoxelMap ?? undefined}
                  activeTool={editable.activeTool === 'build' ? 'pencil' : editable.activeTool}
                  activeColor={editable.activeColor}
                  onPixelChange={editable.onPixelChange}
                  onPixelsFill={editable.onPixelsFill}
                  onColorPick={editable.onColorPick}
                  voxelDepth={editable.voxelDepth}
                  interactionMode={editable.interactionMode}
                  visibilityMask={editable.visibilityMask}
                  displayPixels={editable.displayPixels}
                  viewStateRef={editable.viewStateRef}
                  onVoxelMapChange={editable.onVoxelMapChange}
                />
              )}
            </>
          ) : interactive ? (
            <InteractiveScene
              seed={seed}
              voxelMap={voxelMap}
              layerVisibility={layerVisibility}
              autoRotate={autoRotate}
              interactionMode={interactionMode}
              lightingPreset={lightingPreset}
            />
          ) : (
            <TiltScene
              seed={seed}
              voxelMap={voxelMap}
              tiltRef={tiltRef}
              layerVisibility={layerVisibility}
              autoSpin={autoSpin}
              lightingPreset={lightingPreset}
            />
          )}
        </Suspense>
      </Canvas>
      {!interactive && pointerEnabled && needsPermission && (
        <div className={classes.permissionHint}>Tap to enable motion</div>
      )}
    </div>
  );
};

export default NounParallax;
