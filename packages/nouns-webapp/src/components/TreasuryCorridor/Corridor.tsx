/**
 * Corridor — 3D corridor geometry: floor, walls, ceiling, fog, lighting.
 * Dark cyberpunk aesthetic matching the Neural Treasury.
 */
import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { MeshReflectorMaterial } from '@react-three/drei';
import * as THREE from 'three';

const CORRIDOR_LENGTH = 240;
const CORRIDOR_WIDTH = 16;
const CORRIDOR_HEIGHT = 8;
const WALL_OPACITY = 0.12;

// ─── Floating dust particles ────────────────────────────────────────────────

function DustParticles() {
  const count = 600;
  const ref = useRef<THREE.Points>(null);

  const [positions, velocities] = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * CORRIDOR_WIDTH * 0.8;
      pos[i * 3 + 1] = Math.random() * CORRIDOR_HEIGHT * 0.9;
      pos[i * 3 + 2] = -Math.random() * CORRIDOR_LENGTH;
      vel[i * 3] = (Math.random() - 0.5) * 0.002;
      vel[i * 3 + 1] = (Math.random() - 0.5) * 0.001;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.002;
    }
    return [pos, vel];
  }, []);

  useFrame(() => {
    if (!ref.current) return;
    const geo = ref.current.geometry;
    const posAttr = geo.getAttribute('position') as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;

    for (let i = 0; i < count; i++) {
      arr[i * 3] += velocities[i * 3];
      arr[i * 3 + 1] += velocities[i * 3 + 1];
      arr[i * 3 + 2] += velocities[i * 3 + 2];

      // Wrap around
      if (Math.abs(arr[i * 3]) > CORRIDOR_WIDTH / 2) velocities[i * 3] *= -1;
      if (arr[i * 3 + 1] < 0 || arr[i * 3 + 1] > CORRIDOR_HEIGHT) velocities[i * 3 + 1] *= -1;
      if (arr[i * 3 + 2] > 5 || arr[i * 3 + 2] < -CORRIDOR_LENGTH) velocities[i * 3 + 2] *= -1;
    }
    posAttr.needsUpdate = true;
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
          count={count}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.04}
        color="#fbbf24"
        transparent
        opacity={0.4}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}

// ─── Neon strip lights along ceiling edges ──────────────────────────────────

function NeonStrips() {
  const strips = useMemo(() => {
    const result: { x: number; z: number; color: string }[] = [];
    for (let z = 0; z > -CORRIDOR_LENGTH; z -= 20) {
      result.push({ x: -CORRIDOR_WIDTH / 2 + 0.1, z, color: '#ec4899' });
      result.push({ x: CORRIDOR_WIDTH / 2 - 0.1, z, color: '#60a5fa' });
    }
    return result;
  }, []);

  return (
    <>
      {strips.map((s, i) => (
        <group key={i} position={[s.x, CORRIDOR_HEIGHT - 0.05, s.z]}>
          <mesh>
            <boxGeometry args={[0.05, 0.05, 18]} />
            <meshStandardMaterial
              color={s.color}
              emissive={s.color}
              emissiveIntensity={2}
              toneMapped={false}
            />
          </mesh>
          <pointLight
            color={s.color}
            intensity={0.3}
            distance={12}
            decay={2}
          />
        </group>
      ))}
    </>
  );
}

// ─── Floor grid pattern ─────────────────────────────────────────────────────

function FloorGrid() {
  const gridRef = useRef<THREE.GridHelper>(null);

  return (
    <group position={[0, 0.01, -CORRIDOR_LENGTH / 2]}>
      <gridHelper
        ref={gridRef}
        args={[CORRIDOR_LENGTH, CORRIDOR_LENGTH / 2, '#1a1a3e', '#0d0d2a']}
        rotation={[0, 0, 0]}
      />
    </group>
  );
}

// ─── Main Corridor Component ────────────────────────────────────────────────

export default function Corridor() {
  return (
    <group>
      {/* Fog */}
      <fog attach="fog" args={['#050510', 1, 80]} />

      {/* Ambient + directional */}
      <ambientLight intensity={0.08} color="#1a1a3e" />
      <directionalLight
        position={[0, CORRIDOR_HEIGHT, 0]}
        intensity={0.1}
        color="#60a5fa"
      />

      {/* Floor — reflective dark surface */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, 0, -CORRIDOR_LENGTH / 2]}
      >
        <planeGeometry args={[CORRIDOR_WIDTH, CORRIDOR_LENGTH]} />
        <MeshReflectorMaterial
          mirror={0.3}
          blur={[300, 100]}
          mixBlur={0.8}
          resolution={512}
          color="#080818"
          metalness={0.9}
          roughness={0.3}
          depthScale={1}
          minDepthThreshold={0.4}
          maxDepthThreshold={1}
        />
      </mesh>

      {/* Floor grid overlay */}
      <FloorGrid />

      {/* Left wall */}
      <mesh
        position={[-CORRIDOR_WIDTH / 2, CORRIDOR_HEIGHT / 2, -CORRIDOR_LENGTH / 2]}
      >
        <planeGeometry args={[CORRIDOR_LENGTH, CORRIDOR_HEIGHT]} />
        <meshStandardMaterial
          color="#0a0a2e"
          transparent
          opacity={WALL_OPACITY}
          side={THREE.DoubleSide}
          metalness={0.8}
          roughness={0.2}
        />
      </mesh>
      {/* Rotate left wall to face inward */}
      <mesh
        position={[-CORRIDOR_WIDTH / 2, CORRIDOR_HEIGHT / 2, -CORRIDOR_LENGTH / 2]}
        rotation={[0, Math.PI / 2, 0]}
      >
        <planeGeometry args={[CORRIDOR_LENGTH, CORRIDOR_HEIGHT]} />
        <meshStandardMaterial
          color="#0a0a2e"
          transparent
          opacity={WALL_OPACITY}
          side={THREE.DoubleSide}
          metalness={0.8}
          roughness={0.2}
        />
      </mesh>

      {/* Right wall */}
      <mesh
        position={[CORRIDOR_WIDTH / 2, CORRIDOR_HEIGHT / 2, -CORRIDOR_LENGTH / 2]}
        rotation={[0, -Math.PI / 2, 0]}
      >
        <planeGeometry args={[CORRIDOR_LENGTH, CORRIDOR_HEIGHT]} />
        <meshStandardMaterial
          color="#0a0a2e"
          transparent
          opacity={WALL_OPACITY}
          side={THREE.DoubleSide}
          metalness={0.8}
          roughness={0.2}
        />
      </mesh>

      {/* Ceiling */}
      <mesh
        rotation={[Math.PI / 2, 0, 0]}
        position={[0, CORRIDOR_HEIGHT, -CORRIDOR_LENGTH / 2]}
      >
        <planeGeometry args={[CORRIDOR_WIDTH, CORRIDOR_LENGTH]} />
        <meshStandardMaterial
          color="#050510"
          metalness={0.9}
          roughness={0.1}
        />
      </mesh>

      {/* Neon light strips along ceiling edges */}
      <NeonStrips />

      {/* Dust particles */}
      <DustParticles />

      {/* Entry arch glow */}
      <pointLight position={[0, 4, 2]} intensity={1} color="#fbbf24" distance={15} decay={2} />
    </group>
  );
}
