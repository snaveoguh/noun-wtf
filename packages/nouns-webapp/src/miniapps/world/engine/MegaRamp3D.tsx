// ── MegaRamp3D — Giant skate ramp with noggles grind rail & portal ───
//
// Positioned on the eastern edge of the island.
// Island center = tile (32,32), WORLD_SCALE = 0.1, TILE_SIZE = 16.
// Eastern edge ~ tile (50, 32) → world X ≈ 50 * 16 * 0.1 = 80.
//
// Structure (top to bottom):
//   1. Platform at top — flat launch area
//   2. Quarter-pipe curved ramp surface — ExtrudeGeometry
//   3. Noggles grind rail down the center — two rectangular frames
//   4. Side walls with graffiti patches
//   5. Stairs on the side (30+ steps)
//   6. Portal at the bottom — glowing torus that teleports to top

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// ── Constants ────────────────────────────────────────────────────────

const TILE_SIZE = 16;
const WORLD_SCALE = 0.1;

// Ramp dimensions (in Three.js units, already scaled)
const RAMP_LENGTH = 20; // total length along slope
const RAMP_HEIGHT = 8; // peak height
const RAMP_WIDTH = 6; // width
const CURVE_SEGMENTS = 32;

// Position: eastern edge of island
// Island center tile (32,32) → world center = 32 * 16 * 0.1 = 51.2
// Eastern edge ~ tile 50 → 50 * 16 * 0.1 = 80
const RAMP_X = 50 * TILE_SIZE * WORLD_SCALE; // 80
const RAMP_Z = 32 * TILE_SIZE * WORLD_SCALE; // 51.2
const RAMP_Y = 0;

// Portal
const PORTAL_RADIUS = 1.5;

// ── Ramp bounds export (for skating.ts collision) ────────────────────

export const MEGA_RAMP_BOUNDS = {
  x: RAMP_X,
  z: RAMP_Z,
  length: RAMP_LENGTH,
  width: RAMP_WIDTH,
  height: RAMP_HEIGHT,
  rotation: 0, // faces along Z axis (north-south)
};

// ── Quarter-pipe surface geometry ────────────────────────────────────

function createRampGeometry(): THREE.BufferGeometry {
  const halfW = RAMP_WIDTH / 2;
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Generate vertices along the curve
  // Quarter-pipe: x = length * t, y = height * sin(t * PI/2)
  for (let j = 0; j <= 1; j++) {
    const xPos = j === 0 ? -halfW : halfW;
    for (let i = 0; i <= CURVE_SEGMENTS; i++) {
      const t = i / CURVE_SEGMENTS;
      const z = -RAMP_LENGTH / 2 + t * RAMP_LENGTH;
      const y = RAMP_HEIGHT * Math.sin(t * Math.PI / 2);

      // Surface normal (perpendicular to curve tangent in YZ plane)
      const dydz = (RAMP_HEIGHT * Math.PI / 2) * Math.cos(t * Math.PI / 2) / RAMP_LENGTH;
      const nLen = Math.sqrt(1 + dydz * dydz);

      positions.push(xPos, y, z);
      normals.push(0, 1 / nLen, -dydz / nLen);
      uvs.push(j, t);
    }
  }

  // Build triangles
  for (let i = 0; i < CURVE_SEGMENTS; i++) {
    const a = i;
    const b = i + 1;
    const c = CURVE_SEGMENTS + 1 + i;
    const d = CURVE_SEGMENTS + 1 + i + 1;

    indices.push(a, c, b);
    indices.push(b, c, d);
  }

  // Add thickness — bottom surface (offset down slightly)
  const thickness = 0.3;
  const baseVertCount = positions.length / 3;
  for (let j = 0; j <= 1; j++) {
    const xPos = j === 0 ? -halfW : halfW;
    for (let i = 0; i <= CURVE_SEGMENTS; i++) {
      const t = i / CURVE_SEGMENTS;
      const z = -RAMP_LENGTH / 2 + t * RAMP_LENGTH;
      const y = RAMP_HEIGHT * Math.sin(t * Math.PI / 2) - thickness;

      positions.push(xPos, y, z);
      normals.push(0, -1, 0);
      uvs.push(j, t);
    }
  }

  // Bottom face triangles (reversed winding)
  for (let i = 0; i < CURVE_SEGMENTS; i++) {
    const a = baseVertCount + i;
    const b = baseVertCount + i + 1;
    const c = baseVertCount + CURVE_SEGMENTS + 1 + i;
    const d = baseVertCount + CURVE_SEGMENTS + 1 + i + 1;

    indices.push(a, b, c);
    indices.push(b, d, c);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  return geo;
}

// ── Noggles Grind Rail ───────────────────────────────────────────────
//
// Two rectangular frames (the iconic noggles glasses shape) connected
// by a rail bar running the length of the ramp.

function NoggleFrames({ position }: { position: [number, number, number] }) {
  const barThickness = 0.08;
  const frameW = 0.8;
  const frameH = 0.5;

  const metalMat = useMemo(
    () => (
      <meshStandardMaterial
        color="#aaaaaa"
        metalness={0.8}
        roughness={0.2}
      />
    ),
    [],
  );

  // Single noggle frame (rectangular outline)
  const Frame = ({ offset }: { offset: number }) => (
    <group position={[offset, 0, 0]}>
      {/* Top bar */}
      <mesh position={[0, frameH / 2, 0]}>
        <boxGeometry args={[frameW, barThickness, barThickness]} />
        {metalMat}
      </mesh>
      {/* Bottom bar */}
      <mesh position={[0, -frameH / 2, 0]}>
        <boxGeometry args={[frameW, barThickness, barThickness]} />
        {metalMat}
      </mesh>
      {/* Left bar */}
      <mesh position={[-frameW / 2, 0, 0]}>
        <boxGeometry args={[barThickness, frameH, barThickness]} />
        {metalMat}
      </mesh>
      {/* Right bar */}
      <mesh position={[frameW / 2, 0, 0]}>
        <boxGeometry args={[barThickness, frameH, barThickness]} />
        {metalMat}
      </mesh>
    </group>
  );

  return (
    <group position={position}>
      {/* Left lens */}
      <Frame offset={-0.55} />
      {/* Right lens */}
      <Frame offset={0.55} />
      {/* Bridge connecting the two lenses */}
      <mesh position={[0, frameH / 2, 0]}>
        <boxGeometry args={[0.3, barThickness, barThickness]} />
        {metalMat}
      </mesh>
      {/* Temple arm (left side extending back) */}
      <mesh position={[-0.95 - 0.3, frameH / 2 - 0.05, 0]}>
        <boxGeometry args={[0.6, barThickness * 0.8, barThickness * 0.8]} />
        {metalMat}
      </mesh>
    </group>
  );
}

// ── Stairs ───────────────────────────────────────────────────────────

function RampStairs() {
  const STEP_COUNT = 32;
  const stepHeight = RAMP_HEIGHT / STEP_COUNT;
  const stepDepth = RAMP_LENGTH / STEP_COUNT;
  const stepWidth = 1.2;

  const steps = useMemo(() => {
    const arr: Array<{ y: number; z: number }> = [];
    for (let i = 0; i < STEP_COUNT; i++) {
      arr.push({
        y: i * stepHeight + stepHeight / 2,
        z: -RAMP_LENGTH / 2 + i * stepDepth + stepDepth / 2,
      });
    }
    return arr;
  }, []);

  return (
    <group position={[RAMP_WIDTH / 2 + stepWidth / 2 + 0.2, 0, 0]}>
      {steps.map((step, i) => (
        <mesh key={i} position={[0, step.y, step.z]}>
          <boxGeometry args={[stepWidth, stepHeight, stepDepth]} />
          <meshStandardMaterial color="#777777" roughness={0.8} />
        </mesh>
      ))}
      {/* Side railing */}
      <mesh position={[stepWidth / 2 + 0.05, RAMP_HEIGHT / 2, 0]}>
        <boxGeometry args={[0.1, RAMP_HEIGHT, RAMP_LENGTH]} />
        <meshStandardMaterial color="#555555" metalness={0.5} roughness={0.4} />
      </mesh>
    </group>
  );
}

// ── Teleport Portal ──────────────────────────────────────────────────

function TeleportPortal({ position }: { position: [number, number, number] }) {
  const torusRef = useRef<THREE.Mesh>(null);
  const particlesRef = useRef<THREE.Points>(null);

  const particleGeo = useMemo(() => {
    const count = 80;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count); // store a seed for animation
    for (let i = 0; i < count; i++) {
      // Random point inside circle
      const angle = Math.random() * Math.PI * 2;
      const r = Math.random() * PORTAL_RADIUS * 0.8;
      positions[i * 3] = Math.cos(angle) * r;
      positions[i * 3 + 1] = Math.sin(angle) * r;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 0.3;
      velocities[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('seed', new THREE.BufferAttribute(velocities, 1));
    return geo;
  }, []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;

    // Spin the torus slowly
    if (torusRef.current) {
      torusRef.current.rotation.z = t * 0.4;
    }

    // Swirl particles
    if (particlesRef.current) {
      const pos = particlesRef.current.geometry.attributes.position;
      const seeds = particlesRef.current.geometry.attributes.seed;
      for (let i = 0; i < pos.count; i++) {
        const seed = (seeds as THREE.BufferAttribute).getX(i);
        const angle = t * (0.5 + seed * 0.5) + seed * Math.PI * 2;
        const r = (0.3 + seed * 0.8) * PORTAL_RADIUS;
        pos.setX(i, Math.cos(angle) * r);
        pos.setY(i, Math.sin(angle) * r);
        pos.setZ(i, Math.sin(t * 2 + seed * 6) * 0.2);
      }
      pos.needsUpdate = true;
    }
  });

  return (
    <group position={position}>
      {/* Glowing torus ring */}
      <mesh ref={torusRef}>
        <torusGeometry args={[PORTAL_RADIUS, 0.12, 12, 32]} />
        <meshStandardMaterial
          color="#00ddff"
          emissive="#00ddff"
          emissiveIntensity={2}
          metalness={0.3}
          roughness={0.2}
          transparent
          opacity={0.9}
        />
      </mesh>

      {/* Inner glow disc */}
      <mesh>
        <circleGeometry args={[PORTAL_RADIUS * 0.9, 24]} />
        <meshBasicMaterial
          color="#00aaff"
          transparent
          opacity={0.3}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Particle swirl inside */}
      <points ref={particlesRef}>
        <primitive object={particleGeo} attach="geometry" />
        <pointsMaterial
          color="#88eeff"
          size={0.06}
          transparent
          opacity={0.7}
          sizeAttenuation
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </points>

      {/* Point light glow */}
      <pointLight color="#00ddff" intensity={4} distance={8} />
    </group>
  );
}

// ── Graffiti Patches (colored rectangles on side walls) ──────────────

function GraffitiPatches({ wallHeight, wallLength }: { wallHeight: number; wallLength: number }) {
  const patches = useMemo(() => {
    const colors = ['#e74c3c', '#f39c12', '#2ecc71', '#3498db', '#9b59b6', '#e91e63', '#ff5722'];
    const arr: Array<{ x: number; y: number; w: number; h: number; color: string }> = [];
    // Deterministic placement
    for (let i = 0; i < 12; i++) {
      const seed = Math.sin(i * 127.1 + 311.7) * 43758.5453;
      const frac = seed - Math.floor(seed);
      const seed2 = Math.sin(i * 269.3 + 183.1) * 31758.9;
      const frac2 = seed2 - Math.floor(seed2);
      arr.push({
        x: (frac - 0.5) * wallLength * 0.8,
        y: frac2 * wallHeight * 0.6 + wallHeight * 0.15,
        w: 0.4 + frac * 0.8,
        h: 0.3 + frac2 * 0.5,
        color: colors[i % colors.length],
      });
    }
    return arr;
  }, [wallHeight, wallLength]);

  return (
    <>
      {patches.map((p, i) => (
        <mesh key={i} position={[0.01, p.y, p.x]}>
          <planeGeometry args={[p.w, p.h]} />
          <meshBasicMaterial color={p.color} transparent opacity={0.6} />
        </mesh>
      ))}
    </>
  );
}

// ── Main Component ───────────────────────────────────────────────────

interface MegaRamp3DProps {
  playerPosition?: [number, number, number];
  onPortalEnter?: () => void;
}

export function MegaRamp3D({ playerPosition, onPortalEnter }: MegaRamp3DProps) {
  const groupRef = useRef<THREE.Group>(null);

  const rampGeo = useMemo(() => createRampGeometry(), []);

  // Portal collision check
  useFrame(() => {
    if (!playerPosition || !onPortalEnter) return;
    const portalWorldX = RAMP_X;
    const portalWorldZ = RAMP_Z - RAMP_LENGTH / 2;
    const dx = playerPosition[0] - portalWorldX;
    const dz = playerPosition[2] - portalWorldZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < PORTAL_RADIUS * 1.2 && playerPosition[1] < 1) {
      onPortalEnter();
    }
  });

  return (
    <group ref={groupRef} position={[RAMP_X, RAMP_Y, RAMP_Z]}>
      {/* ── Ramp curved surface ── */}
      <mesh geometry={rampGeo}>
        <meshStandardMaterial
          color="#999999"
          roughness={0.7}
          metalness={0.1}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* ── Side walls ── */}
      {/* Left wall */}
      <group position={[-RAMP_WIDTH / 2 - 0.15, RAMP_HEIGHT / 2, 0]}>
        <mesh>
          <boxGeometry args={[0.3, RAMP_HEIGHT, RAMP_LENGTH]} />
          <meshStandardMaterial color="#666666" roughness={0.8} />
        </mesh>
        {/* Graffiti on inner face */}
        <group position={[0.16, 0, 0]} rotation={[0, 0, 0]}>
          <GraffitiPatches wallHeight={RAMP_HEIGHT} wallLength={RAMP_LENGTH} />
        </group>
      </group>

      {/* Right wall */}
      <group position={[RAMP_WIDTH / 2 + 0.15, RAMP_HEIGHT / 2, 0]}>
        <mesh>
          <boxGeometry args={[0.3, RAMP_HEIGHT, RAMP_LENGTH]} />
          <meshStandardMaterial color="#666666" roughness={0.8} />
        </mesh>
        {/* Graffiti on inner face */}
        <group position={[-0.16, 0, 0]} rotation={[0, Math.PI, 0]}>
          <GraffitiPatches wallHeight={RAMP_HEIGHT} wallLength={RAMP_LENGTH} />
        </group>
      </group>

      {/* ── Platform at top ── */}
      <mesh position={[0, RAMP_HEIGHT, RAMP_LENGTH / 2 + 1.5]}>
        <boxGeometry args={[RAMP_WIDTH + 2, 0.4, 3]} />
        <meshStandardMaterial color="#888888" roughness={0.6} />
      </mesh>
      {/* Platform railing */}
      <mesh position={[0, RAMP_HEIGHT + 0.6, RAMP_LENGTH / 2 + 2.8]}>
        <boxGeometry args={[RAMP_WIDTH + 2, 0.8, 0.1]} />
        <meshStandardMaterial color="#555555" metalness={0.5} roughness={0.3} />
      </mesh>

      {/* ── Noggles grind rail ── */}
      {/* Main rail bar running down the center of the ramp */}
      {(() => {
        // Rail follows the ramp curve — create segmented rail
        const railSegments: Array<{ pos: [number, number, number]; rot: number }> = [];
        const segCount = 16;
        for (let i = 0; i < segCount; i++) {
          const t0 = (i + 0.5) / segCount;
          const t1 = (i + 1.5) / segCount;
          const z0 = -RAMP_LENGTH / 2 + t0 * RAMP_LENGTH;
          const z1 = -RAMP_LENGTH / 2 + t1 * RAMP_LENGTH;
          const y0 = RAMP_HEIGHT * Math.sin(t0 * Math.PI / 2) + 0.15;
          const y1 = RAMP_HEIGHT * Math.sin(t1 * Math.PI / 2) + 0.15;
          const midZ = (z0 + z1) / 2;
          const midY = (y0 + y1) / 2;
          const angle = Math.atan2(y1 - y0, z1 - z0);
          // const _len = Math.sqrt((z1 - z0) ** 2 + (y1 - y0) ** 2);
          railSegments.push({ pos: [0, midY, midZ], rot: angle });
        }
        return railSegments.map((seg, i) => (
          <mesh key={`rail-${i}`} position={seg.pos} rotation={[seg.rot, 0, 0]}>
            <cylinderGeometry args={[0.04, 0.04, RAMP_LENGTH / segCount * 1.05, 6]} />
            <meshStandardMaterial color="#aaaaaa" metalness={0.8} roughness={0.2} />
          </mesh>
        ));
      })()}

      {/* Noggles shape at the midpoint of the rail */}
      <group position={[0, RAMP_HEIGHT * Math.sin(0.5 * Math.PI / 2) + 0.5, 0]}>
        <NoggleFrames position={[0, 0, 0]} />
      </group>

      {/* ── Stairs on the right side ── */}
      <RampStairs />

      {/* ── Portal at the bottom ── */}
      <TeleportPortal position={[0, PORTAL_RADIUS + 0.3, -RAMP_LENGTH / 2 - 0.5]} />

      {/* ── Ground shadow ── */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <planeGeometry args={[RAMP_WIDTH + 4, RAMP_LENGTH + 6]} />
        <meshBasicMaterial color="#000000" transparent opacity={0.15} />
      </mesh>

      {/* ── Ambient lighting for the ramp area ── */}
      <pointLight position={[0, RAMP_HEIGHT + 2, 0]} color="#ffffff" intensity={2} distance={25} />
      <pointLight position={[0, 2, -RAMP_LENGTH / 2]} color="#88ccff" intensity={1} distance={10} />
    </group>
  );
}
