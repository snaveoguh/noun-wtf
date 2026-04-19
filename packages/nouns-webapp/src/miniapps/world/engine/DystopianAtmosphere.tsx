// ── Dystopian Atmosphere — Blade Runner / Cyberpunk-leaning ─────────
// Drop-in replacements for the cheerful daytime atmosphere.
// Keeps the R3F API shape so swapping is mechanical in WorldPage.tsx.
//
// Exports:
//   <DystopianSky />       — overcast gradient dome + polluted sun/moon disk
//   <SmogClouds />         — dense dark grey haze bank (replaces <CloudLayer />)
//   <Vultures />           — slow dark silhouettes circling (replaces <BirdFlocks />)
//   <RainParticles />      — angled rain streaks via THREE.Points
//   <NeonBillboards />     — distant kanji/glyph signage, emissive
//   <DystopianLighting />  — drop-in for ambient+directional+hemisphere combo
//   <DystopianFog />       — drop-in for <fog> with thicker near/far

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// ── Constants (mirrors Atmosphere.tsx so geometry lines up) ──────────

const WORLD_SCALE = 0.1;
const TILE_SIZE = 16;
const MAP_SIZE = 64;
const TERRAIN_SIZE = MAP_SIZE * TILE_SIZE * WORLD_SCALE; // 102.4
const CENTER = TERRAIN_SIZE / 2; // 51.2

// ── Dystopian Sky ────────────────────────────────────────────────────
// Large inside-out sphere with a vertical gradient (navy → sickly
// orange-brown near horizon). A single billboard disk sits near the
// horizon as a polluted sun / moon.

export function DystopianSky() {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const diskRef = useRef<THREE.Mesh>(null);

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uTopColor: { value: new THREE.Color('#0a0e1a') }, // deep navy
        uMidColor: { value: new THREE.Color('#1a2030') }, // muddy slate
        uHorizonColor: { value: new THREE.Color('#3a2a2a') }, // rust/smog
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorldPos;
        void main() {
          vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uTopColor;
        uniform vec3 uMidColor;
        uniform vec3 uHorizonColor;
        varying vec3 vWorldPos;
        void main() {
          // Height 0 = horizon, 1 = zenith
          float h = clamp(normalize(vWorldPos).y * 0.5 + 0.5, 0.0, 1.0);
          vec3 lower = mix(uHorizonColor, uMidColor, smoothstep(0.35, 0.65, h));
          vec3 color = mix(lower, uTopColor, smoothstep(0.55, 0.95, h));
          // Subtle swirling noise — cheap fake turbulence
          float swirl = sin(vWorldPos.x * 0.02 + uTime * 0.05) * 0.5 + 0.5;
          swirl *= sin(vWorldPos.z * 0.03 - uTime * 0.04) * 0.5 + 0.5;
          color += vec3(0.01, 0.005, 0.0) * swirl;
          gl_FragColor = vec4(color, 1.0);
        }
      `,
    });
  }, []);

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
    if (diskRef.current) {
      // Very slow parallax around the horizon
      const t = clock.elapsedTime * 0.008;
      const r = 85;
      diskRef.current.position.x = CENTER + Math.cos(t) * r;
      diskRef.current.position.z = CENTER + Math.sin(t) * r;
      diskRef.current.position.y = 14 + Math.sin(t * 0.7) * 1.5;
      diskRef.current.lookAt(CENTER, 2, CENTER);
    }
  });

  return (
    <group>
      <mesh ref={matRef as unknown as React.RefObject<THREE.Mesh>} position={[CENTER, 0, CENTER]}>
        <sphereGeometry args={[140, 32, 24]} />
        <primitive object={material} attach="material" />
      </mesh>
      {/* Polluted sun/moon disk */}
      <mesh ref={diskRef}>
        <circleGeometry args={[3.2, 32]} />
        <meshBasicMaterial
          color="#c88858"
          transparent
          opacity={0.55}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

// ── Smog Clouds ──────────────────────────────────────────────────────
// Layered dense grey haze — replaces the puffy white cloud layer.

const SMOG_COUNT = 22;

interface SmogDatum {
  x: number;
  y: number;
  z: number;
  scale: number;
  opacity: number;
  driftSpeed: number;
  tint: number; // 0..1 — mixes between two grey hues
}

function makeSmogData(count: number): SmogDatum[] {
  const data: SmogDatum[] = [];
  for (let i = 0; i < count; i++) {
    const rng = (s: number) => Math.sin(i * 91.7 + s * 247.1) * 0.5 + 0.5;
    data.push({
      x: CENTER + (rng(0) - 0.5) * TERRAIN_SIZE * 1.5,
      y: 6 + rng(1) * 10, // 6-16 units — thicker band, lower
      z: CENTER + (rng(2) - 0.5) * TERRAIN_SIZE * 1.5,
      scale: 4 + rng(3) * 6, // 4-10 — bigger than cheerful clouds
      opacity: 0.35 + rng(4) * 0.3,
      driftSpeed: 0.15 + rng(5) * 0.3,
      tint: rng(6),
    });
  }
  return data;
}

export function SmogClouds() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const smogData = useMemo(() => makeSmogData(SMOG_COUNT), []);

  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uColorA: { value: new THREE.Color('#2a2d36') }, // cool grey
        uColorB: { value: new THREE.Color('#3a3230') }, // warm brown-grey (pollution)
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        varying float vTint;
        attribute float tintAttr;
        void main() {
          vUv = uv;
          vTint = tintAttr;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColorA;
        uniform vec3 uColorB;
        uniform float uTime;
        varying vec2 vUv;
        varying float vTint;
        void main() {
          vec2 c = vUv - vec2(0.5);
          float d = length(c);
          // Softer, less well-defined edges — smog, not clouds
          float alpha = smoothstep(0.55, 0.05, d);
          // Internal turbulence
          float noise = sin((vUv.x + uTime * 0.02) * 18.0) * cos((vUv.y - uTime * 0.015) * 14.0);
          alpha *= 0.75 + noise * 0.1;
          vec3 color = mix(uColorA, uColorB, vTint);
          gl_FragColor = vec4(color, alpha * 0.7);
        }
      `,
    });
  }, []);

  // Per-instance tint as custom attribute
  const tintBuffer = useMemo(() => {
    const arr = new Float32Array(SMOG_COUNT);
    smogData.forEach((d, i) => {
      arr[i] = d.tint;
    });
    return new THREE.InstancedBufferAttribute(arr, 1);
  }, [smogData]);

  useFrame(({ clock, camera }) => {
    if (!meshRef.current) return;
    const t = clock.elapsedTime;
    material.uniforms.uTime.value = t;

    for (let i = 0; i < SMOG_COUNT; i++) {
      const c = smogData[i];
      const driftX = c.x + t * c.driftSpeed;
      const wrappedX =
        ((driftX + TERRAIN_SIZE * 0.75) % (TERRAIN_SIZE * 1.5)) - TERRAIN_SIZE * 0.25;

      dummy.position.set(wrappedX, c.y, c.z);
      dummy.quaternion.copy(camera.quaternion);
      dummy.scale.setScalar(c.scale);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, SMOG_COUNT]}
      material={material}
      frustumCulled={false}
    >
      <planeGeometry args={[1, 1]}>
        <primitive object={tintBuffer} attach="attributes-tintAttr" />
      </planeGeometry>
    </instancedMesh>
  );
}

// ── Vultures ─────────────────────────────────────────────────────────
// Slow dark silhouettes — barely-moving wings, long glides.

interface VultureConfig {
  radius: number;
  height: number;
  speed: number;
  phase: number;
}

const VULTURES: VultureConfig[] = [
  { radius: 22, height: 13, speed: 0.08, phase: 0 },
  { radius: 30, height: 17, speed: 0.06, phase: 2.1 },
  { radius: 17, height: 11, speed: 0.09, phase: 4.3 },
  { radius: 26, height: 15, speed: 0.05, phase: 5.8 },
];

function Vulture({ config }: { config: VultureConfig }) {
  const groupRef = useRef<THREE.Group>(null);
  const leftWingRef = useRef<THREE.Mesh>(null);
  const rightWingRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    const g = groupRef.current;
    if (!g) return;
    const t = clock.elapsedTime;
    const angle = t * config.speed + config.phase;

    const bx = CENTER + Math.cos(angle) * config.radius;
    const bz = CENTER + Math.sin(angle) * config.radius;
    const by = config.height + Math.sin(t * 0.18 + config.phase) * 0.4;

    g.position.set(bx, by, bz);
    g.rotation.y = angle + Math.PI / 2;
    // Very subtle wing flap — gliding mostly
    const flap = Math.sin(t * 0.9 + config.phase) * 0.15;
    if (leftWingRef.current) leftWingRef.current.rotation.z = 0.15 + flap;
    if (rightWingRef.current) rightWingRef.current.rotation.z = -(0.15 + flap);
  });

  return (
    <group ref={groupRef}>
      {/* Body */}
      <mesh scale={[0.18, 0.04, 0.06]}>
        <sphereGeometry args={[1, 6, 4]} />
        <meshBasicMaterial color="#0a0a12" />
      </mesh>
      {/* Left wing */}
      <mesh ref={leftWingRef} position={[0.1, 0, 0]}>
        <planeGeometry args={[0.45, 0.09]} />
        <meshBasicMaterial color="#0a0a12" side={THREE.DoubleSide} transparent opacity={0.92} />
      </mesh>
      {/* Right wing */}
      <mesh ref={rightWingRef} position={[-0.1, 0, 0]}>
        <planeGeometry args={[0.45, 0.09]} />
        <meshBasicMaterial color="#0a0a12" side={THREE.DoubleSide} transparent opacity={0.92} />
      </mesh>
    </group>
  );
}

export function Vultures() {
  return (
    <group>
      {VULTURES.map((cfg, i) => (
        <Vulture key={i} config={cfg} />
      ))}
    </group>
  );
}

// ── Rain Particles ───────────────────────────────────────────────────
// Angled streaks via THREE.Points. Wraps around the world.

interface RainParticlesProps {
  count?: number;
  /** Fall speed scalar. Default 25 — fast angled rain. */
  speed?: number;
  /** Opacity of each streak. Default 0.45. */
  opacity?: number;
}

export function RainParticles({
  count = 1400,
  speed = 25,
  opacity = 0.45,
}: RainParticlesProps = {}) {
  const pointsRef = useRef<THREE.Points>(null);
  const range = TERRAIN_SIZE * 1.2;
  const top = 32;
  const bottom = -1;

  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3] = CENTER + (Math.random() - 0.5) * range;
      arr[i * 3 + 1] = Math.random() * (top - bottom) + bottom;
      arr[i * 3 + 2] = CENTER + (Math.random() - 0.5) * range;
    }
    return arr;
  }, [count, range]);

  // Wind offset: consistent angle so rain looks slanted
  const windX = 0.35;
  const windZ = 0.12;

  useFrame((_, delta) => {
    const pts = pointsRef.current;
    if (!pts) return;
    const pos = pts.geometry.attributes.position;
    const arr = pos.array as Float32Array;
    const dy = speed * delta;
    const dx = windX * speed * delta;
    const dz = windZ * speed * delta;
    for (let i = 0; i < count; i++) {
      const yi = i * 3 + 1;
      arr[yi] -= dy;
      arr[i * 3] += dx;
      arr[i * 3 + 2] += dz;
      if (arr[yi] < bottom) {
        // Respawn near top at a random XZ
        arr[yi] = top;
        arr[i * 3] = CENTER + (Math.random() - 0.5) * range;
        arr[i * 3 + 2] = CENTER + (Math.random() - 0.5) * range;
      }
    }
    pos.needsUpdate = true;
  });

  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [positions]);

  return (
    <points ref={pointsRef} geometry={geometry} frustumCulled={false}>
      <pointsMaterial
        color="#8ea8c8"
        size={0.09}
        transparent
        opacity={opacity}
        depthWrite={false}
        sizeAttenuation
      />
    </points>
  );
}

// ── Neon Billboards ──────────────────────────────────────────────────
// Far-off emissive glyph panels, in the style of Blade Runner ads.

interface BillboardDef {
  position: [number, number, number];
  rotationY: number;
  color: string;
  glyphs: string;
  width: number;
  height: number;
}

const GLYPH_PRESETS = [
  'ノウンズ', // "Nouns" in katakana
  '未来', // "future"
  'ナイト', // "knight"
  '警告', // "warning"
  '電脳', // "cyber-brain"
  'ドリーム', // "dream"
];

function makeBillboardDefs(): BillboardDef[] {
  // Ring of billboards outside the island — far enough to read like city signs
  const defs: BillboardDef[] = [];
  const colors = ['#ff2aa7', '#00e5ff', '#ff4136', '#b967ff', '#ff9500'];
  const ringRadius = 38;
  const count = 5;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + 0.7;
    const x = CENTER + Math.cos(angle) * ringRadius;
    const z = CENTER + Math.sin(angle) * ringRadius;
    const y = 7 + (i % 2) * 3;
    defs.push({
      position: [x, y, z],
      rotationY: angle + Math.PI,
      color: colors[i % colors.length],
      glyphs: GLYPH_PRESETS[i % GLYPH_PRESETS.length],
      width: 4 + (i % 2) * 1.5,
      height: 1.8 + (i % 3) * 0.3,
    });
  }
  return defs;
}

function NeonPanel({ def, index }: { def: BillboardDef; index: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const lightRef = useRef<THREE.PointLight>(null);

  // Canvas-based emissive texture for the glyphs
  const texture = useMemo(() => {
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#05070a';
    ctx.fillRect(0, 0, 256, 128);
    // Glow border
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 6;
    ctx.strokeRect(6, 6, 244, 116);
    // Glyphs
    ctx.fillStyle = def.color;
    ctx.font = 'bold 72px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = def.color;
    ctx.shadowBlur = 20;
    ctx.fillText(def.glyphs, 128, 64);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }, [def.color, def.glyphs]);

  useFrame(({ clock }) => {
    const l = lightRef.current;
    if (!l) return;
    const t = clock.elapsedTime;
    // Slow pulse with a stutter flicker every few seconds
    const base = 0.7 + Math.sin(t * 0.6 + index) * 0.15;
    const flicker = Math.sin(t * 11 + index * 3.3) > 0.97 ? 0.3 : 1.0;
    l.intensity = base * flicker;
  });

  return (
    <group ref={groupRef} position={def.position} rotation={[0, def.rotationY, 0]}>
      {/* Panel */}
      <mesh>
        <planeGeometry args={[def.width, def.height]} />
        {texture ? (
          <meshBasicMaterial map={texture} transparent toneMapped={false} side={THREE.DoubleSide} />
        ) : (
          <meshBasicMaterial color={def.color} toneMapped={false} side={THREE.DoubleSide} />
        )}
      </mesh>
      {/* Emissive glow behind */}
      <mesh position={[0, 0, -0.05]}>
        <planeGeometry args={[def.width * 1.3, def.height * 1.5]} />
        <meshBasicMaterial color={def.color} transparent opacity={0.15} depthWrite={false} />
      </mesh>
      {/* Point light for scene-wide neon wash */}
      <pointLight ref={lightRef} color={def.color} intensity={0.7} distance={18} decay={1.8} />
    </group>
  );
}

export function NeonBillboards() {
  const defs = useMemo(() => makeBillboardDefs(), []);
  return (
    <group>
      {defs.map((def, i) => (
        <NeonPanel key={i} def={def} index={i} />
      ))}
    </group>
  );
}

// ── Dystopian Lighting ───────────────────────────────────────────────
// Drop-in replacement for the existing Lighting() — dark, cool, with
// two scene-wide pulsing rim lights (distant neon feel).

interface DystopianLightingProps {
  /** Base ambient intensity. Default 0.2. */
  ambientIntensity?: number;
  /** Directional (moonlight) intensity. Default 0.5. */
  directionalIntensity?: number;
}

export function DystopianLighting({
  ambientIntensity = 0.2,
  directionalIntensity = 0.5,
}: DystopianLightingProps = {}) {
  const cyanRef = useRef<THREE.PointLight>(null);
  const magentaRef = useRef<THREE.PointLight>(null);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (cyanRef.current) {
      cyanRef.current.intensity = 0.6 + Math.sin(t * 0.4) * 0.2;
    }
    if (magentaRef.current) {
      magentaRef.current.intensity = 0.55 + Math.sin(t * 0.5 + 1.3) * 0.2;
    }
  });

  return (
    <>
      {/* Cool low-key ambient */}
      <ambientLight intensity={ambientIntensity} color="#5a6b85" />
      {/* Low-angle moonlight — blue-grey, shallow angle for long shadows */}
      <directionalLight
        position={[-18, 14, -22]}
        intensity={directionalIntensity}
        color="#7a88aa"
      />
      {/* Hemisphere — deep navy sky, wet asphalt ground */}
      <hemisphereLight args={['#1a1f2e', '#2a2620', 0.35]} />
      {/* Distant neon rim — cyan from one side */}
      <pointLight
        ref={cyanRef}
        position={[CENTER + 50, 8, CENTER - 10]}
        color="#00e5ff"
        intensity={0.6}
        distance={90}
        decay={1.6}
      />
      {/* Distant neon rim — magenta from the other */}
      <pointLight
        ref={magentaRef}
        position={[CENTER - 45, 10, CENTER + 40]}
        color="#ff2aa7"
        intensity={0.55}
        distance={90}
        decay={1.6}
      />
    </>
  );
}

// ── Dystopian Fog ────────────────────────────────────────────────────
// Thicker, darker fog — limits visibility so the neon pops.

interface DystopianFogProps {
  /** Hex color. Default '#1a1a24' — near-black with a blue bias. */
  color?: string;
  near?: number;
  far?: number;
}

export function DystopianFog({ color = '#1a1a24', near = 18, far = 60 }: DystopianFogProps = {}) {
  return <fog attach="fog" args={[color, near, far]} />;
}
