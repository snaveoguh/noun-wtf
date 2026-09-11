// ── TerraformsHorizon — lofi distant skyline ───────────────────────
//
// A procedural ring of blocky chunks at the world's edge, styled after
// Mathcastles Terraforms (terraforms.art): earthy/neon color palettes,
// gridded elevations, ASCII-leaning silhouette. Purely decorative —
// no collision, no interaction, runs at minimal cost via an
// InstancedMesh.
//
// Renders around the island's horizon so the player sees distant
// dystopian towers/mountains instead of open ocean + sky.

import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

// Terraforms-inspired palettes (earth + neon mix).
// Keep saturation modest so they read as distant / hazed.
const TF_PALETTES: string[][] = [
  ['#2a2a3a', '#3a3e52', '#4a5068', '#5a6078', '#6a7090'], // cold blues
  ['#3a2a2a', '#4a3030', '#5a3838', '#6a4848', '#7a5858'], // rust
  ['#1a2a1a', '#2a3a2a', '#3a4a3a', '#4a5a4a', '#5a6a5a'], // mossy
  ['#3a2a4a', '#4a3060', '#5a3a70', '#6a4a80', '#7a5890'], // ultra-violet haze
];

// Accent neons used sparsely — only ~1 in 20 chunks gets a neon
const NEON_ACCENTS = ['#ff2e7e', '#00e5ff', '#f9a825', '#a8ff2a'];

const CHUNK_COUNT = 160; // how many distant chunks
const RING_RADIUS_MIN = 400; // inner edge of the ring — clear of the ~350u island
const RING_RADIUS_MAX = 540; // outer edge of the ring
const Y_OFFSET = -2; // sink base into fog
const JITTER = 0.6; // keep column shape consistent

// Seeded RNG so the horizon layout is stable across reloads.
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface TerraformsHorizonProps {
  /** Center point (x,z). Defaults to the island's spawn area. */
  center?: [number, number];
  /** Base height multiplier for chunks. Taller = more skyline-like. */
  heightScale?: number;
}

export function TerraformsHorizon({
  center = [51.2, 51.2],
  heightScale = 1,
}: TerraformsHorizonProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const neonRef = useRef<THREE.InstancedMesh>(null);

  // Pre-compute chunk transforms + colors once.
  const { transforms, colors, neonTransforms, neonColors } = useMemo(() => {
    const rng = mulberry32(1337);
    const dummy = new THREE.Object3D();
    const mats: THREE.Matrix4[] = [];
    const cols: THREE.Color[] = [];
    const neonMats: THREE.Matrix4[] = [];
    const neonCols: THREE.Color[] = [];
    for (let i = 0; i < CHUNK_COUNT; i++) {
      // Polar position around the center
      const theta = (i / CHUNK_COUNT) * Math.PI * 2 + rng() * JITTER;
      const r = RING_RADIUS_MIN + rng() * (RING_RADIUS_MAX - RING_RADIUS_MIN);
      const x = center[0] + Math.cos(theta) * r;
      const z = center[1] + Math.sin(theta) * r;
      // Column dimensions
      const w = 4 + rng() * 18;
      const d = 4 + rng() * 14;
      const h = (6 + Math.pow(rng(), 1.6) * 50) * heightScale;
      dummy.position.set(x, Y_OFFSET + h / 2, z);
      dummy.scale.set(w, h, d);
      dummy.rotation.y = rng() * Math.PI;
      dummy.updateMatrix();
      mats.push(dummy.matrix.clone());
      // Pick palette, then a ramp tint by height (taller = lighter top)
      const palette = TF_PALETTES[Math.floor(rng() * TF_PALETTES.length)]!;
      const tint = palette[Math.min(palette.length - 1, Math.floor((h / 60) * palette.length))]!;
      cols.push(new THREE.Color(tint));
      // 1-in-20 chunks get a thin neon accent strip on top
      if (rng() < 0.05) {
        const neon = NEON_ACCENTS[Math.floor(rng() * NEON_ACCENTS.length)]!;
        dummy.position.set(x, Y_OFFSET + h + 0.5, z);
        dummy.scale.set(w * 0.6, 0.8, d * 0.6);
        dummy.updateMatrix();
        neonMats.push(dummy.matrix.clone());
        neonCols.push(new THREE.Color(neon));
      }
    }
    return { transforms: mats, colors: cols, neonTransforms: neonMats, neonColors: neonCols };
  }, [center, heightScale]);

  // Slow breathing on the neon strips so the horizon feels alive.
  useFrame(({ clock }) => {
    const m = neonRef.current;
    if (!m) return;
    const t = clock.getElapsedTime();
    const mat = m.material as THREE.MeshStandardMaterial;
    mat.emissiveIntensity = 0.8 + 0.4 * Math.sin(t * 0.7);
  });

  // Apply transforms + colors once on mount (instance buffers aren't reactive).
  const applied = useRef(false);
  if (!applied.current && meshRef.current && neonRef.current) {
    for (let i = 0; i < transforms.length; i++) {
      meshRef.current.setMatrixAt(i, transforms[i]!);
      meshRef.current.setColorAt(i, colors[i]!);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
    if (meshRef.current.instanceColor) meshRef.current.instanceColor.needsUpdate = true;
    for (let i = 0; i < neonTransforms.length; i++) {
      neonRef.current.setMatrixAt(i, neonTransforms[i]!);
      neonRef.current.setColorAt(i, neonColors[i]!);
    }
    neonRef.current.instanceMatrix.needsUpdate = true;
    if (neonRef.current.instanceColor) neonRef.current.instanceColor.needsUpdate = true;
    applied.current = true;
  }

  return (
    <group>
      {/* Column chunks (the skyline) */}
      <instancedMesh ref={meshRef} args={[undefined, undefined, CHUNK_COUNT]} frustumCulled={false}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.95} metalness={0.05} fog={true} />
      </instancedMesh>
      {/* Neon crown strips — emissive so they glow through fog */}
      <instancedMesh
        ref={neonRef}
        args={[undefined, undefined, Math.max(1, neonTransforms.length)]}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial
          emissive="#ffffff"
          emissiveIntensity={1}
          toneMapped={false}
          fog={true}
        />
      </instancedMesh>
    </group>
  );
}
