// ── Atmosphere — Birds, Clouds, Animated Ocean, Dolphins ─────────────
// All animations driven by useFrame. Instanced meshes where possible.

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { MAP_SIZE, TILE_UNITS, CORE_SIZE } from './types';
import { COAST_POINTS, ISLAND_RADIUS_TILES } from './tilemap';

// ── Constants ────────────────────────────────────────────────────────

const TERRAIN_SIZE = MAP_SIZE * TILE_UNITS; // 1024 — full map edge
const CENTER = (CORE_SIZE / 2) * TILE_UNITS; // 51.2 — island centre (spawn)
const ISLAND_RADIUS = ISLAND_RADIUS_TILES * TILE_UNITS; // ~296
const OCEAN_Y = -0.15;

// ── Bird Flocks ──────────────────────────────────────────────────────
// 3 flocks of 5-8 birds, each a V-shape silhouette with animated wing flap.
// Uses InstancedMesh for all wing planes across a single flock.

interface FlockConfig {
  count: number;
  radius: number;
  height: number;
  speed: number;
  wingSpeed: number;
}

const FLOCKS: FlockConfig[] = [
  { count: 7, radius: 20, height: 12, speed: 0.15, wingSpeed: 4 },
  { count: 5, radius: 28, height: 16, speed: 0.1, wingSpeed: 3.5 },
  { count: 8, radius: 15, height: 10, speed: 0.2, wingSpeed: 5 },
];

function Flock({ config, seed }: { config: FlockConfig; seed: number }) {
  const { count, radius, height, speed, wingSpeed } = config;

  // Each bird has 2 wings = 2 instances. Total instances = count * 2.
  const instanceCount = count * 2;
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  // Per-bird offsets (angle offset around circle, slight height jitter, phase offset)
  const birdData = useMemo(() => {
    const rng = (i: number) => Math.sin(seed * 1000 + i * 137.5) * 0.5 + 0.5;
    return Array.from({ length: count }, (_, i) => ({
      angleOffset: (i / count) * Math.PI * 2 + rng(i) * 0.4,
      heightOffset: (rng(i + 50) - 0.5) * 2,
      radiusOffset: (rng(i + 100) - 0.5) * 4,
      flapPhase: rng(i + 200) * Math.PI * 2,
    }));
  }, [count, seed]);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.elapsedTime;

    for (let b = 0; b < count; b++) {
      const bd = birdData[b];
      const angle = t * speed + bd.angleOffset;
      const r = radius + bd.radiusOffset;

      const bx = CENTER + Math.cos(angle) * r;
      const bz = CENTER + Math.sin(angle) * r;
      const by = height + bd.heightOffset + Math.sin(t * 0.3 + bd.flapPhase) * 0.5;

      // Wing flap angle: oscillate between -0.4 and 0.4 rad
      const flapAngle = Math.sin(t * wingSpeed + bd.flapPhase) * 0.4;

      // Heading tangent to circle
      const heading = angle + Math.PI / 2;

      for (let w = 0; w < 2; w++) {
        const side = w === 0 ? 1 : -1;
        dummy.position.set(bx, by, bz);
        // Rotate to face heading, then tilt wing
        dummy.rotation.set(0, heading, side * (0.3 + flapAngle));
        // Offset wing from center
        dummy.translateX(side * 0.12);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        meshRef.current.setMatrixAt(b * 2 + w, dummy.matrix);
      }
    }
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, instanceCount]} frustumCulled={false}>
      <planeGeometry args={[0.25, 0.06]} />
      <meshBasicMaterial color="#1a1a2e" side={THREE.DoubleSide} />
    </instancedMesh>
  );
}

export function BirdFlocks() {
  return (
    <group>
      {FLOCKS.map((config, i) => (
        <Flock key={i} config={config} seed={i + 1} />
      ))}
    </group>
  );
}

// ── Cloud Layer ──────────────────────────────────────────────────────
// 18 billboard cloud sprites using InstancedMesh + custom shader for
// soft circular shapes with transparency.

const CLOUD_COUNT = 18;

function makeCloudData(count: number) {
  const data: Array<{
    x: number;
    y: number;
    z: number;
    scale: number;
    opacity: number;
    driftSpeed: number;
    phase: number;
  }> = [];
  for (let i = 0; i < count; i++) {
    const rng = (s: number) => Math.sin(i * 127.1 + s * 311.7) * 0.5 + 0.5;
    data.push({
      x: CENTER + (rng(0) - 0.5) * TERRAIN_SIZE * 1.4,
      y: 8 + rng(1) * 7, // 8-15 units
      z: CENTER + (rng(2) - 0.5) * TERRAIN_SIZE * 1.4,
      scale: 2 + rng(3) * 4, // 2-6
      opacity: 0.3 + rng(4) * 0.3, // 0.3-0.6
      driftSpeed: 0.3 + rng(5) * 0.5,
      phase: rng(6) * Math.PI * 2,
    });
  }
  return data;
}

export function CloudLayer() {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const cloudData = useMemo(() => makeCloudData(CLOUD_COUNT), []);

  // Custom shader material for soft circular clouds
  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uOpacity: { value: 0.5 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        uniform float uOpacity;
        void main() {
          float d = distance(vUv, vec2(0.5));
          float alpha = smoothstep(0.5, 0.15, d) * uOpacity;
          gl_FragColor = vec4(1.0, 1.0, 1.0, alpha);
        }
      `,
    });
  }, []);

  useFrame(({ clock, camera }) => {
    if (!meshRef.current) return;
    const t = clock.elapsedTime;

    for (let i = 0; i < CLOUD_COUNT; i++) {
      const c = cloudData[i];
      // Slow drift in X with wraparound
      const driftX = c.x + t * c.driftSpeed;
      const wrappedX = ((driftX + TERRAIN_SIZE * 0.7) % (TERRAIN_SIZE * 1.4)) - TERRAIN_SIZE * 0.2;

      // Billboard: face camera
      dummy.position.set(wrappedX, c.y, c.z);
      dummy.quaternion.copy(camera.quaternion);
      dummy.scale.setScalar(c.scale);
      dummy.updateMatrix();
      meshRef.current.setMatrixAt(i, dummy.matrix);
    }
    meshRef.current.instanceMatrix.needsUpdate = true;

    // Vary global opacity slightly over time
    material.uniforms.uOpacity.value = 0.45 + Math.sin(t * 0.1) * 0.05;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, CLOUD_COUNT]}
      material={material}
      frustumCulled={false}
    >
      <planeGeometry args={[1, 1]} />
    </instancedMesh>
  );
}

// ── Animated Ocean ───────────────────────────────────────────────────
// Plane with vertex displacement (sine waves) and color variation.
// Includes foam particles near the shore boundary.

const OCEAN_SEGMENTS = 220;

export function AnimatedOcean() {
  const meshRef = useRef<THREE.Mesh>(null);
  const foamRef = useRef<THREE.Points>(null);

  // Custom ocean shader
  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uDeepColor: { value: new THREE.Color('#1a4f8a') },
        uShallowColor: { value: new THREE.Color('#3b7dd8') },
        uCenter: { value: new THREE.Vector2(CENTER, CENTER) },
      },
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying float vDepth;
        varying vec3 vWorldPos;
        void main() {
          vec3 pos = position;
          // Multi-frequency sine wave displacement
          // Long swell — the plane is ~1700u across so keep frequencies
          // low enough for the mesh to resolve them.
          float wave1 = sin(pos.x * 0.45 + uTime * 0.8) * 0.07;
          float wave2 = sin(pos.y * 0.6 + uTime * 1.2) * 0.05;
          float wave3 = sin((pos.x + pos.y) * 0.25 + uTime * 0.5) * 0.09;
          pos.z += wave1 + wave2 + wave3;

          vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
          // Depth: distance from terrain center (further = deeper)
          // Shallow inside the island (lakes, rivers, the surf) → deep out at sea.
          vDepth = (length(vWorldPos.xz - vec2(${CENTER.toFixed(1)}, ${CENTER.toFixed(1)})) - ${ISLAND_RADIUS.toFixed(1)}) / 150.0 + 0.3;
          vDepth = clamp(vDepth, 0.0, 1.0);

          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uDeepColor;
        uniform vec3 uShallowColor;
        uniform float uTime;
        varying float vDepth;
        varying vec3 vWorldPos;
        void main() {
          vec3 color = mix(uShallowColor, uDeepColor, vDepth);

          // Subtle shimmer
          float shimmer = sin(vWorldPos.x * 3.0 + uTime) * sin(vWorldPos.z * 3.0 + uTime * 0.7) * 0.05;
          color += shimmer;

          // White cap highlights on peaks
          float wave = sin(vWorldPos.x * 1.5 + uTime * 0.8) + sin(vWorldPos.z * 2.0 + uTime * 1.2);
          float foam = smoothstep(1.4, 1.8, wave) * 0.3;
          color = mix(color, vec3(1.0), foam);

          gl_FragColor = vec4(color, 0.82);
        }
      `,
    });
  }, []);

  // Foam particles near shore
  const foamGeo = useMemo(() => {
    const count = 540;
    const positions = new Float32Array(count * 3);
    // Scatter foam along the sampled coastline (first sea tile per bearing).
    const pts = COAST_POINTS;
    for (let i = 0; i < count; i++) {
      const cp = pts.length ? pts[i % pts.length] : null;
      const bx = cp ? (cp.tx + 0.5) * TILE_UNITS : CENTER;
      const bz = cp ? (cp.ty + 0.5) * TILE_UNITS : CENTER;
      positions[i * 3] = bx + (Math.random() - 0.5) * 6;
      positions[i * 3 + 1] = OCEAN_Y + 0.02 + Math.random() * 0.05;
      positions[i * 3 + 2] = bz + (Math.random() - 0.5) * 6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geo;
  }, []);

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;

    // Animate foam particles — bob and drift slightly
    if (foamRef.current) {
      const pos = foamRef.current.geometry.attributes.position;
      const arr = pos.array as Float32Array;
      const t = clock.elapsedTime;
      for (let i = 0; i < pos.count; i++) {
        arr[i * 3 + 1] = OCEAN_Y + 0.02 + Math.sin(t * 2 + i * 0.5) * 0.03;
      }
      pos.needsUpdate = true;
    }
  });

  const size = TERRAIN_SIZE * 1.7;

  return (
    <group>
      {/* Ocean surface */}
      <mesh
        ref={meshRef}
        rotation={[-Math.PI / 2, 0, 0]}
        position={[CENTER, OCEAN_Y, CENTER]}
        material={material}
      >
        <planeGeometry args={[size, size, OCEAN_SEGMENTS, OCEAN_SEGMENTS]} />
      </mesh>

      {/* Foam particles */}
      <points ref={foamRef} geometry={foamGeo}>
        <pointsMaterial
          color="#ffffff"
          size={0.15}
          transparent
          opacity={0.5}
          depthWrite={false}
          sizeAttenuation
        />
      </points>
    </group>
  );
}

// ── Dolphins ─────────────────────────────────────────────────────────
// Occasional dolphin jumping in a parabolic arc from the ocean.
// Random trigger every 30-60 seconds. Splash particles on entry/exit.

interface DolphinState {
  active: boolean;
  time: number; // progress through jump (0-1)
  duration: number; // total jump time in seconds
  startX: number;
  startZ: number;
  angle: number; // heading
  jumpHeight: number;
  nextSpawn: number; // countdown to next jump
  splashPhase: 'none' | 'launch' | 'land';
  splashTimer: number;
}

const JUMP_DISTANCE = 4;

function createDolphinState(): DolphinState {
  return {
    active: false,
    time: 0,
    duration: 2,
    startX: 0,
    startZ: 0,
    angle: 0,
    jumpHeight: 2,
    nextSpawn: 10 + Math.random() * 20, // first one comes sooner
    splashPhase: 'none',
    splashTimer: 0,
  };
}

export function Dolphins() {
  const groupRef = useRef<THREE.Group>(null);
  const dolphinRef = useRef<THREE.Mesh>(null);
  const splashRef = useRef<THREE.Points>(null);
  const stateRef = useRef<DolphinState>(createDolphinState());

  // Splash particle geometry (reused)
  const splashGeo = useMemo(() => {
    const count = 30;
    const positions = new Float32Array(count * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geo;
  }, []);

  // Spawn a new dolphin jump at a random ocean position
  const spawnJump = () => {
    const s = stateRef.current;
    // Just off a random stretch of coast (8–20 tiles out from the surf).
    const cp = COAST_POINTS.length
      ? COAST_POINTS[Math.floor(Math.random() * COAST_POINTS.length)]
      : null;
    const angle = cp ? cp.angle : Math.random() * Math.PI * 2;
    const out = (8 + Math.random() * 12) * TILE_UNITS;
    s.startX = (cp ? (cp.tx + 0.5) * TILE_UNITS : CENTER) + Math.cos(angle) * out;
    s.startZ = (cp ? (cp.ty + 0.5) * TILE_UNITS : CENTER) + Math.sin(angle) * out;
    s.angle = angle + Math.PI * 0.5 + (Math.random() - 0.5) * 0.5;
    s.jumpHeight = 1.5 + Math.random() * 1.5;
    s.duration = 1.8 + Math.random() * 0.8;
    s.time = 0;
    s.active = true;
    s.splashPhase = 'launch';
    s.splashTimer = 0.3;
  };

  const spawnSplashParticles = (x: number, z: number) => {
    if (!splashRef.current) return;
    const pos = splashRef.current.geometry.attributes.position;
    const arr = pos.array as Float32Array;
    for (let i = 0; i < 30; i++) {
      arr[i * 3] = x + (Math.random() - 0.5) * 1.0;
      arr[i * 3 + 1] = OCEAN_Y + Math.random() * 0.8;
      arr[i * 3 + 2] = z + (Math.random() - 0.5) * 1.0;
    }
    pos.needsUpdate = true;
  };

  useFrame((_, delta) => {
    const s = stateRef.current;

    if (!s.active) {
      s.nextSpawn -= delta;
      if (s.nextSpawn <= 0) {
        spawnJump();
      }
      // Hide dolphin below water
      if (dolphinRef.current) {
        dolphinRef.current.visible = false;
      }
      // Fade splash
      if (splashRef.current) {
        (splashRef.current.material as THREE.PointsMaterial).opacity = Math.max(
          0,
          (splashRef.current.material as THREE.PointsMaterial).opacity - delta * 3,
        );
      }
      return;
    }

    s.time += delta / s.duration;

    if (s.time >= 1) {
      // Jump complete
      s.active = false;
      s.nextSpawn = 30 + Math.random() * 30;
      s.splashPhase = 'land';
      s.splashTimer = 0.4;
      // Splash on landing
      const endX = s.startX + Math.cos(s.angle) * JUMP_DISTANCE;
      const endZ = s.startZ + Math.sin(s.angle) * JUMP_DISTANCE;
      spawnSplashParticles(endX, endZ);
      if (splashRef.current) {
        (splashRef.current.material as THREE.PointsMaterial).opacity = 0.8;
      }
      return;
    }

    // Launch splash
    if (s.splashPhase === 'launch') {
      s.splashTimer -= delta;
      if (s.splashTimer <= 0) s.splashPhase = 'none';
      if (s.time < 0.1) {
        spawnSplashParticles(s.startX, s.startZ);
        if (splashRef.current) {
          (splashRef.current.material as THREE.PointsMaterial).opacity = 0.7;
        }
      }
    }

    // Position dolphin on parabolic arc
    const t = s.time;
    const px = s.startX + Math.cos(s.angle) * JUMP_DISTANCE * t;
    const pz = s.startZ + Math.sin(s.angle) * JUMP_DISTANCE * t;
    // Parabolic: y = -4h * (t-0.5)^2 + h  (peaks at t=0.5)
    const py = OCEAN_Y + s.jumpHeight * (-4 * (t - 0.5) * (t - 0.5) + 1);

    if (dolphinRef.current) {
      dolphinRef.current.visible = py > OCEAN_Y;
      dolphinRef.current.position.set(px, py, pz);
      // Rotate to face direction + pitch based on velocity
      const pitch = Math.atan2(-8 * s.jumpHeight * (t - 0.5), JUMP_DISTANCE);
      dolphinRef.current.rotation.set(0, s.angle, pitch);
    }

    // Fade splash particles
    if (splashRef.current && s.splashPhase === 'none') {
      const mat = splashRef.current.material as THREE.PointsMaterial;
      mat.opacity = Math.max(0, mat.opacity - delta * 2);
    }
  });

  return (
    <group ref={groupRef}>
      {/* Dolphin body — elongated sphere scaled to dolphin shape */}
      <mesh ref={dolphinRef} visible={false} scale={[2.5, 0.8, 0.8]}>
        <sphereGeometry args={[0.2, 8, 6]} />
        <meshStandardMaterial color="#2a3d5c" roughness={0.4} metalness={0.1} />
      </mesh>

      {/* Splash particles */}
      <points ref={splashRef} geometry={splashGeo}>
        <pointsMaterial
          color="#ffffff"
          size={0.12}
          transparent
          opacity={0}
          depthWrite={false}
          sizeAttenuation
        />
      </points>
    </group>
  );
}
