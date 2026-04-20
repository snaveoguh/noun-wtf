// ── TrainingDummies — black humanoid silhouettes for combat practice ─
//
// Three capsule+sphere figures standing in a small arc east of spawn.
// Each dummy tracks recoil and particle bursts on hit. Hitting any
// dummy triggers a brief `aimBurst` slomo (Matrix flavour). The
// `onClick` on the mesh is a placeholder for real projectile hits.
//
// Particle FX: up to 12 small black squares per burst, simple gravity
// fall + alpha fade over 600ms. Instanced mesh keeps the draw call
// count down.
//
// TODO: wire to weapon raycast in combat.ts for real projectile hits

import { useMemo, useRef, useState, type ReactNode } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

import { triggerFocus } from '../../engine/timeControl';

const RECOIL_DURATION_MS = 200;
const IDLE_RESET_MS = 1000;
const PARTICLE_COUNT = 12;
const PARTICLE_LIFETIME_MS = 600;

// ── Particle burst helper ────────────────────────────────────────────
//
// A small instanced mesh we reuse per dummy. Each instance has its own
// velocity + age. On burst, we reset all instances to the hit point.

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number; // ms
  alive: boolean;
}

function createParticles(): Particle[] {
  return Array.from({ length: PARTICLE_COUNT }, () => ({
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    age: PARTICLE_LIFETIME_MS + 1,
    alive: false,
  }));
}

function ParticleBurst({
  particlesRef,
}: {
  particlesRef: React.MutableRefObject<Particle[]>;
}): ReactNode {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((_state, delta) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const dtMs = delta * 1000;
    const particles = particlesRef.current;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      if (!p.alive) {
        // Hide off-screen
        dummy.position.set(0, -9999, 0);
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }
      p.age += dtMs;
      if (p.age >= PARTICLE_LIFETIME_MS) {
        p.alive = false;
        dummy.position.set(0, -9999, 0);
        dummy.scale.setScalar(0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
        continue;
      }
      // Gravity fall (three.js Y axis).
      p.vy -= 6 * delta;
      p.x += p.vx * delta;
      p.y += p.vy * delta;
      p.z += p.vz * delta;

      const t = p.age / PARTICLE_LIFETIME_MS;
      const scale = 0.08 * (1 - t * 0.5);
      dummy.position.set(p.x, p.y, p.z);
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, PARTICLE_COUNT]}
      frustumCulled={false}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshBasicMaterial color="#050505" />
    </instancedMesh>
  );
}

// ── Single dummy ─────────────────────────────────────────────────────

export interface TrainingDummyProps {
  /** Local position within the parent group. */
  position?: [number, number, number];
  /** Called after each hit (post-focus trigger). */
  onHit?: () => void;
}

export function TrainingDummy({ position = [0, 0, 0], onHit }: TrainingDummyProps): ReactNode {
  const bodyRef = useRef<THREE.Group>(null);
  const particles = useRef<Particle[]>(createParticles());
  const [recoilAt, setRecoilAt] = useState<number | null>(null);

  useFrame(() => {
    const group = bodyRef.current;
    if (!group) return;
    const now = performance.now();
    if (recoilAt === null) {
      // Spring-return to upright (slerp-ish).
      group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, 0, 0.25);
      return;
    }
    const age = now - recoilAt;
    if (age >= IDLE_RESET_MS) {
      setRecoilAt(null);
      return;
    }
    if (age < RECOIL_DURATION_MS) {
      // Snap back ~30° then spring return.
      const t = age / RECOIL_DURATION_MS;
      // Peak at ~35% of duration, then ease back.
      const peakT = 0.35;
      let amt: number;
      if (t < peakT) {
        amt = t / peakT;
      } else {
        amt = 1 - (t - peakT) / (1 - peakT);
      }
      // Easing (sine) for softer motion.
      const eased = Math.sin((amt * Math.PI) / 2);
      group.rotation.x = (-(30 * Math.PI) / 180) * eased;
    } else {
      // Idle wait — gentle drift back.
      group.rotation.x = THREE.MathUtils.lerp(group.rotation.x, 0, 0.2);
    }
  });

  const handleHit = (event?: { stopPropagation?: () => void }) => {
    event?.stopPropagation?.();
    setRecoilAt(performance.now());
    // Spawn particles near the top of the body (head area).
    const ps = particles.current;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      p.alive = true;
      p.age = 0;
      // Spawn at dummy head height ~1.5u + position.
      p.x = position[0] + (Math.random() - 0.5) * 0.2;
      p.y = position[1] + 1.5 + (Math.random() - 0.5) * 0.2;
      p.z = position[2] + (Math.random() - 0.5) * 0.2;
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.2 + Math.random() * 1.5;
      p.vx = Math.cos(angle) * speed;
      p.vy = 1.5 + Math.random() * 1.5;
      p.vz = Math.sin(angle) * speed * 0.3;
    }
    triggerFocus('aimBurst');
    onHit?.();
  };

  return (
    <group position={position}>
      <group ref={bodyRef} position={[0, 0, 0]}>
        {/* Capsule body — total ~1.4u tall, sits on ground.
            Three.js capsule: args = [radius, length, capSegs, radialSegs].
            Total height = length + 2*radius. radius=0.25, length=0.9 -> ~1.4u. */}
        {/* TODO: wire to weapon raycast in combat.ts for real projectile hits */}
        <mesh position={[0, 0.7, 0]} onClick={handleHit} onPointerDown={handleHit}>
          <capsuleGeometry args={[0.25, 0.9, 4, 8]} />
          <meshStandardMaterial color="#0a0a0a" roughness={0.9} />
        </mesh>
        {/* Head — sphere on top */}
        <mesh position={[0, 1.55, 0]} onClick={handleHit} onPointerDown={handleHit}>
          <sphereGeometry args={[0.22, 16, 12]} />
          <meshStandardMaterial color="#0a0a0a" roughness={0.9} />
        </mesh>
      </group>
      {/* Particle burst lives in dummy-local space so particles inherit parent transform. */}
      <ParticleBurst particlesRef={particles} />
      {/* Faint floor disc for anchoring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[0.45, 20]} />
        <meshBasicMaterial color="#d0d0d0" transparent opacity={0.35} />
      </mesh>
    </group>
  );
}

// ── Group composer ───────────────────────────────────────────────────

export interface TrainingDummiesProps {
  position?: [number, number, number];
  onHit?: () => void;
}

export function TrainingDummies({ position = [10, 0, 0], onHit }: TrainingDummiesProps): ReactNode {
  return (
    <group position={position}>
      <TrainingDummy position={[-2, 0, 0.5]} onHit={onHit} />
      <TrainingDummy position={[0, 0, -0.2]} onHit={onHit} />
      <TrainingDummy position={[2, 0, 0.5]} onHit={onHit} />
    </group>
  );
}

export default TrainingDummies;
