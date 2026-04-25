/**
 * MorphingNounVoxels — Tetris-3D voxel reshuffle between two noun seeds.
 *
 * Used by the crystal-ball miniapp's 3D mode to morph between the predicted
 * noun and its historical twin without a wrapper-level cross-fade. Each voxel
 * has its own animation state — voxels shared between seeds stay put (and
 * lerp colour if the colour changed), voxels only in the OLD seed slide /
 * fall away, voxels only in the NEW seed drop in from above. A small per-
 * voxel stagger (`(x + z) * STAGGER_PER_CELL_MS`) gives the swap a left-to-
 * right cascade feel.
 *
 * Renders the same lit + curated-head scene as InteractiveScene so the
 * matching, non-transition view looks identical to the rest of NounParallax.
 * Only the voxel layers (body / bling / glasses, plus head when no GLB is
 * available) participate in the morph; the curated head GLB just unmounts
 * + remounts because rebuilding meshes per-voxel for the GLB would explode
 * the scope of this work.
 *
 * Performance:
 *  - Single InstancedMesh sized to max(oldVoxels, newVoxels)
 *  - Per-frame matrix update only while a morph is running (the static frames
 *    fall back to a regular static instanced mesh)
 *  - Uses linear-space colours (matches the rest of NounParallax)
 */
import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';

import { ImageData, getNounData } from '@noundry/nouns-assets';
import {
  seedToLayers,
  BODY_DEPTH,
  BLING_DEPTH,
  HEAD_DEPTH,
  GLASSES_DEPTH,
  type LayerVisibility,
  type NounLayers,
} from '@nouns/voxel-engine';
import { OrbitControls } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { INounSeed } from '@/wrappers/nounToken';

// ─── Tunables ───────────────────────────────────────────────────────────────

/** Total wall-clock duration for the morph (ms). */
const MORPH_DURATION_MS = 1100;
/** Per-cell stagger across the (x+z) diagonal — small enough that the cascade
 *  reads as a wave rather than serial drops. */
const STAGGER_PER_CELL_MS = 28;
/** How far above the final position newly-entering voxels start, in voxel units. */
const ENTER_DROP_HEIGHT = 14;
/** How far below the floor leaving voxels travel before dropping out, in voxel units. */
const LEAVE_FALL_DEPTH = 18;
/** Random horizontal scatter applied to leaving voxels (units). */
const LEAVE_SCATTER = 4;

// ─── Voxel data helpers (mirror NounParallax helpers) ──────────────────────

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

function voxelKey(v: FlatVoxel): string {
  return `${v.x.toFixed(2)},${v.y.toFixed(2)},${v.z.toFixed(2)}`;
}

// ─── Per-voxel animation state ──────────────────────────────────────────────

type Phase = 'static' | 'leaving' | 'entering' | 'colorMorph';

interface AnimVoxel {
  phase: Phase;
  /** Position when phase begins. */
  startX: number;
  startY: number;
  startZ: number;
  /** Final / settled position. */
  endX: number;
  endY: number;
  endZ: number;
  /** Colour when phase begins (linear). */
  startR: number;
  startG: number;
  startB: number;
  /** Final colour (linear). */
  endR: number;
  endG: number;
  endB: number;
  /** Where this voxel sits in the cascade — drives the per-voxel start delay. */
  staggerDelayMs: number;
  /** Per-voxel duration (ms). Slightly randomised so the cascade isn't lockstep. */
  durationMs: number;
}

// Easing — easeOutBounce gives the satisfying "snap" feel of a Tetris drop.
function easeOutBounce(t: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (t < 1 / d1) return n1 * t * t;
  if (t < 2 / d1) {
    const u = t - 1.5 / d1;
    return n1 * u * u + 0.75;
  }
  if (t < 2.5 / d1) {
    const u = t - 2.25 / d1;
    return n1 * u * u + 0.9375;
  }
  const u = t - 2.625 / d1;
  return n1 * u * u + 0.984375;
}

function easeInQuad(t: number): number {
  return t * t;
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

// ─── Diff two voxel sets into per-voxel animation states ────────────────────

interface BuildResult {
  voxels: AnimVoxel[];
  /** Total wall-clock duration including the longest stagger. */
  totalDurationMs: number;
}

function buildAnimVoxels(
  oldVoxels: FlatVoxel[] | null,
  newVoxels: FlatVoxel[],
): BuildResult {
  const oldMap = new Map<string, FlatVoxel>();
  if (oldVoxels) for (const v of oldVoxels) oldMap.set(voxelKey(v), v);

  const newMap = new Map<string, FlatVoxel>();
  for (const v of newVoxels) newMap.set(voxelKey(v), v);

  const out: AnimVoxel[] = [];

  // Cascade is keyed off (x + z) so the wave sweeps across the diagonal —
  // visually distinct from a pure left-to-right or top-to-bottom drop.
  const cascade = (x: number, z: number) => (x + 16 + z * 0.6) * STAGGER_PER_CELL_MS;

  // 1) Voxels in BOTH — either static (same colour) or colour morph.
  for (const [key, nv] of newMap) {
    const ov = oldMap.get(key);
    if (!ov) continue;
    const sameColor = ov.r === nv.r && ov.g === nv.g && ov.b === nv.b;
    out.push({
      phase: sameColor ? 'static' : 'colorMorph',
      startX: nv.x,
      startY: nv.y,
      startZ: nv.z,
      endX: nv.x,
      endY: nv.y,
      endZ: nv.z,
      startR: srgbToLinear(ov.r / 255),
      startG: srgbToLinear(ov.g / 255),
      startB: srgbToLinear(ov.b / 255),
      endR: srgbToLinear(nv.r / 255),
      endG: srgbToLinear(nv.g / 255),
      endB: srgbToLinear(nv.b / 255),
      staggerDelayMs: sameColor ? 0 : cascade(nv.x, nv.z) * 0.3,
      durationMs: sameColor ? 0 : 280,
    });
  }

  // 2) Voxels only in OLD — slide / fall away.
  for (const [key, ov] of oldMap) {
    if (newMap.has(key)) continue;
    const sx = (Math.random() - 0.5) * LEAVE_SCATTER;
    out.push({
      phase: 'leaving',
      startX: ov.x,
      startY: ov.y,
      startZ: ov.z,
      endX: ov.x + sx,
      endY: ov.y - LEAVE_FALL_DEPTH,
      endZ: ov.z,
      startR: srgbToLinear(ov.r / 255),
      startG: srgbToLinear(ov.g / 255),
      startB: srgbToLinear(ov.b / 255),
      endR: srgbToLinear(ov.r / 255),
      endG: srgbToLinear(ov.g / 255),
      endB: srgbToLinear(ov.b / 255),
      staggerDelayMs: cascade(ov.x, ov.z) * 0.5,
      durationMs: 480 + Math.random() * 80,
    });
  }

  // 3) Voxels only in NEW — drop in from above with an easeOutBounce snap.
  for (const [key, nv] of newMap) {
    if (oldMap.has(key)) continue;
    out.push({
      phase: 'entering',
      startX: nv.x,
      startY: nv.y + ENTER_DROP_HEIGHT,
      startZ: nv.z,
      endX: nv.x,
      endY: nv.y,
      endZ: nv.z,
      startR: srgbToLinear(nv.r / 255),
      startG: srgbToLinear(nv.g / 255),
      startB: srgbToLinear(nv.b / 255),
      endR: srgbToLinear(nv.r / 255),
      endG: srgbToLinear(nv.g / 255),
      endB: srgbToLinear(nv.b / 255),
      staggerDelayMs: cascade(nv.x, nv.z),
      durationMs: 520 + Math.random() * 100,
    });
  }

  // Total wall-clock = max(delay + duration). Cap at MORPH_DURATION_MS so
  // the parent component knows when to stop animating.
  let total = 0;
  for (const v of out) {
    const t = v.staggerDelayMs + v.durationMs;
    if (t > total) total = t;
  }
  total = Math.min(total, MORPH_DURATION_MS);

  return { voxels: out, totalDurationMs: total };
}

// ─── Inner morph scene ──────────────────────────────────────────────────────

interface MorphSceneProps {
  oldVoxels: FlatVoxel[] | null;
  newVoxels: FlatVoxel[];
  onComplete: () => void;
  autoRotate: boolean;
}

function MorphScene({ oldVoxels, newVoxels, onComplete, autoRotate }: MorphSceneProps) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const startedAtRef = useRef<number>(0);
  const doneRef = useRef(false);

  const { voxels, totalDurationMs } = useMemo(
    () => buildAnimVoxels(oldVoxels, newVoxels),
    [oldVoxels, newVoxels],
  );

  const count = voxels.length;

  // Geometry + colour attribute
  const { geometry, colorAttr } = useMemo(() => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const colorArray = new Float32Array(Math.max(count, 1) * 3);
    for (let i = 0; i < count; i++) {
      const v = voxels[i];
      colorArray[i * 3] = v.startR;
      colorArray[i * 3 + 1] = v.startG;
      colorArray[i * 3 + 2] = v.startB;
    }
    const attr = new THREE.InstancedBufferAttribute(colorArray, 3);
    geo.setAttribute('color', attr);
    return { geometry: geo, colorAttr: attr };
  }, [voxels, count]);

  useEffect(() => {
    return () => geometry.dispose();
  }, [geometry]);

  // Initial matrices — set on mount so the first paint shows the start state.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      const v = voxels[i];
      dummy.position.set(v.startX, v.startY, v.startZ);
      dummy.rotation.set(0, 0, 0);
      // Entering voxels start at zero scale so they pop in.
      dummy.scale.setScalar(v.phase === 'entering' ? 0 : 1);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    startedAtRef.current = performance.now();
    doneRef.current = false;
  }, [count, voxels]);

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh || count === 0) return;

    const elapsed = performance.now() - startedAtRef.current;

    // Group spin: gentle rotation through the morph so the cascade is
    // legible from multiple angles. autoRotate drives the steady-state
    // rotation in the static path; while morphing we add a small tween.
    if (groupRef.current && autoRotate) {
      // Constant slow spin — matches OrbitControls autoRotate cadence.
      groupRef.current.rotation.y += 0.004;
    }

    if (elapsed >= totalDurationMs && !doneRef.current) {
      doneRef.current = true;
      // Snap everything to its final state on the last frame.
      const dummy = new THREE.Object3D();
      const colors = colorAttr.array as Float32Array;
      for (let i = 0; i < count; i++) {
        const v = voxels[i];
        const visible = v.phase !== 'leaving';
        dummy.position.set(v.endX, v.endY, v.endZ);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(visible ? 1 : 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        colors[i * 3] = v.endR;
        colors[i * 3 + 1] = v.endG;
        colors[i * 3 + 2] = v.endB;
      }
      mesh.instanceMatrix.needsUpdate = true;
      colorAttr.needsUpdate = true;
      onComplete();
      return;
    }

    if (doneRef.current) return;

    const dummy = new THREE.Object3D();
    const colors = colorAttr.array as Float32Array;

    for (let i = 0; i < count; i++) {
      const v = voxels[i];
      const localElapsed = elapsed - v.staggerDelayMs;

      let posX = v.startX;
      let posY = v.startY;
      let posZ = v.startZ;
      let scale = v.phase === 'entering' ? 0 : 1;
      let cr = v.startR;
      let cg = v.startG;
      let cb = v.startB;

      if (v.phase === 'static') {
        posX = v.endX;
        posY = v.endY;
        posZ = v.endZ;
        scale = 1;
        cr = v.endR;
        cg = v.endG;
        cb = v.endB;
      } else if (localElapsed <= 0) {
        // Waiting for stagger delay — hold the start state.
      } else {
        const tRaw = Math.min(1, localElapsed / v.durationMs);

        if (v.phase === 'entering') {
          // easeOutBounce on Y so the cube "lands" with a Tetris snap.
          const eased = easeOutBounce(tRaw);
          posX = v.endX;
          posY = v.startY + (v.endY - v.startY) * eased;
          posZ = v.endZ;
          // Ramp scale from 0→1 over the first ~25% so they pop in but
          // most of the bounce happens at full size.
          scale = Math.min(1, tRaw * 4);
        } else if (v.phase === 'leaving') {
          // easeIn on the fall — gravity-style acceleration.
          const eased = easeInQuad(tRaw);
          posX = v.startX + (v.endX - v.startX) * eased;
          posY = v.startY + (v.endY - v.startY) * eased;
          posZ = v.startZ + (v.endZ - v.startZ) * eased;
          // Shrink toward zero in the last 30% so it visually clears.
          scale = tRaw < 0.7 ? 1 : 1 - (tRaw - 0.7) / 0.3;
        } else if (v.phase === 'colorMorph') {
          const eased = smoothstep(tRaw);
          cr = v.startR + (v.endR - v.startR) * eased;
          cg = v.startG + (v.endG - v.startG) * eased;
          cb = v.startB + (v.endB - v.startB) * eased;
        }
      }

      dummy.position.set(posX, posY, posZ);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      colors[i * 3] = cr;
      colors[i * 3 + 1] = cg;
      colors[i * 3 + 2] = cb;
    }

    mesh.instanceMatrix.needsUpdate = true;
    colorAttr.needsUpdate = true;
  });

  return (
    <group ref={groupRef}>
      <instancedMesh
        ref={meshRef}
        args={[geometry, undefined, Math.max(count, 1)]}
        frustumCulled={false}
      >
        <meshBasicMaterial vertexColors toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

// ─── Static post-morph scene (re-uses the lit instanced mesh) ───────────────
//
// Once the morph finishes we keep rendering the same instanced-mesh layout so
// the visual target doesn't shift mid-frame. The auto-rotate tweens the group
// rotation continuously.

interface StaticSceneProps {
  voxels: FlatVoxel[];
  autoRotate: boolean;
}

function StaticVoxelScene({ voxels, autoRotate }: StaticSceneProps) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = voxels.length;

  const { geometry, colorAttr } = useMemo(() => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const colorArray = new Float32Array(Math.max(count, 1) * 3);
    for (let i = 0; i < count; i++) {
      colorArray[i * 3] = srgbToLinear(voxels[i].r / 255);
      colorArray[i * 3 + 1] = srgbToLinear(voxels[i].g / 255);
      colorArray[i * 3 + 2] = srgbToLinear(voxels[i].b / 255);
    }
    const attr = new THREE.InstancedBufferAttribute(colorArray, 3);
    geo.setAttribute('color', attr);
    return { geometry: geo, colorAttr: attr };
  }, [voxels, count]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < count; i++) {
      dummy.position.set(voxels[i].x, voxels[i].y, voxels[i].z);
      dummy.scale.setScalar(1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    // Re-sync colours in case voxels updated.
    const colors = colorAttr.array as Float32Array;
    for (let i = 0; i < count; i++) {
      colors[i * 3] = srgbToLinear(voxels[i].r / 255);
      colors[i * 3 + 1] = srgbToLinear(voxels[i].g / 255);
      colors[i * 3 + 2] = srgbToLinear(voxels[i].b / 255);
    }
    colorAttr.needsUpdate = true;
  }, [voxels, count, colorAttr]);

  useFrame(() => {
    if (groupRef.current && autoRotate) {
      groupRef.current.rotation.y += 0.004;
    }
  });

  return (
    <group ref={groupRef}>
      <instancedMesh
        ref={meshRef}
        args={[geometry, undefined, Math.max(count, 1)]}
        frustumCulled={false}
      >
        <meshBasicMaterial vertexColors toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

// ─── Top-level scene ────────────────────────────────────────────────────────

interface MorphingSceneProps {
  seed: INounSeed;
  autoRotate: boolean;
  layerVisibility?: LayerVisibility;
}

function MorphingScene({ seed, autoRotate, layerVisibility }: MorphingSceneProps) {
  const seedKey = `${seed.background}-${seed.body}-${seed.accessory}-${seed.head}-${seed.glasses}`;

  const currentVoxels = useMemo(
    () => seedToFlatVoxels(seed, layerVisibility),
    [seedKey, layerVisibility],
  );

  const prevSeedKeyRef = useRef<string | null>(null);
  const prevVoxelsRef = useRef<FlatVoxel[] | null>(null);

  const [transition, setTransition] = useState<{
    oldVoxels: FlatVoxel[] | null;
    newVoxels: FlatVoxel[];
    nonce: number;
  } | null>(null);
  const transitionNonceRef = useRef(0);

  // Detect seed change and trigger morph.
  useEffect(() => {
    if (prevSeedKeyRef.current && prevSeedKeyRef.current !== seedKey) {
      transitionNonceRef.current += 1;
      setTransition({
        oldVoxels: prevVoxelsRef.current,
        newVoxels: currentVoxels,
        nonce: transitionNonceRef.current,
      });
    }
    prevSeedKeyRef.current = seedKey;
    prevVoxelsRef.current = currentVoxels;
  }, [seedKey, currentVoxels]);

  return (
    <>
      <ambientLight intensity={2.5} color="#ffffff" />
      <directionalLight position={[0, 5, 15]} intensity={1.0} color="#ffffff" />

      {transition ? (
        <MorphScene
          key={transition.nonce}
          oldVoxels={transition.oldVoxels}
          newVoxels={transition.newVoxels}
          onComplete={() => setTransition(null)}
          autoRotate={autoRotate}
        />
      ) : (
        <StaticVoxelScene voxels={currentVoxels} autoRotate={autoRotate} />
      )}
    </>
  );
}

// ─── Public component ──────────────────────────────────────────────────────

export interface MorphingNounVoxelsProps {
  seed: INounSeed;
  /** Auto-rotate the noun once the morph settles. */
  autoRotate?: boolean;
  /** Allow OrbitControls drag/zoom — disabled by default (matches the orb framing). */
  interactive?: boolean;
  layerVisibility?: LayerVisibility;
}

const MorphingNounVoxels: React.FC<MorphingNounVoxelsProps> = ({
  seed,
  autoRotate = true,
  interactive = false,
  layerVisibility,
}) => {
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Canvas
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        camera={{ fov: 50, near: 1, far: 200, position: [0, 2, 38] }}
        gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
          gl.outputColorSpace = THREE.SRGBColorSpace;
          gl.toneMapping = THREE.LinearToneMapping;
          gl.toneMappingExposure = 1.2;
        }}
        dpr={[1, 1.5]}
      >
        <Suspense fallback={null}>
          <MorphingScene seed={seed} autoRotate={autoRotate} layerVisibility={layerVisibility} />
          {interactive && (
            <OrbitControls
              enablePan={false}
              enableZoom
              enableDamping
              dampingFactor={0.12}
              minDistance={10}
              maxDistance={80}
            />
          )}
        </Suspense>
      </Canvas>
    </div>
  );
};

export default MorphingNounVoxels;
