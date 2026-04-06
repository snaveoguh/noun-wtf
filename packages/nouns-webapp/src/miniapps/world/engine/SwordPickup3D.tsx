// ── 3D Sword Pickup — Spinning Sword on Ground ─────────────────────
//
// Simple sword mesh: long thin box (blade, silver metallic)
//                   + short box (handle, brown)
//                   + small box (guard, gold)
// Glow effect, auto-pickup on walk-over.
// Same pattern as WeaponPickup3D.tsx — spinning, bobbing, ground ring.

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// ── Build sword mesh (shared geometry) ──────────────────────────────

function createSwordShape(): THREE.Group {
  const group = new THREE.Group();

  // Blade — long thin box, silver metallic
  const bladeMat = new THREE.MeshStandardMaterial({
    color: '#c0c0c0',
    metalness: 0.9,
    roughness: 0.15,
    emissive: new THREE.Color('#333344'),
  });
  const bladeGeo = new THREE.BoxGeometry(0.06, 0.7, 0.015);
  const blade = new THREE.Mesh(bladeGeo, bladeMat);
  blade.position.y = 0.45; // blade extends up from guard
  group.add(blade);

  // Blade tip — tapered using a small triangle-ish box
  const tipGeo = new THREE.ConeGeometry(0.03, 0.12, 4);
  const tip = new THREE.Mesh(tipGeo, bladeMat);
  tip.position.y = 0.86;
  group.add(tip);

  // Guard — small wide box, gold
  const guardMat = new THREE.MeshStandardMaterial({
    color: '#daa520',
    metalness: 0.8,
    roughness: 0.25,
    emissive: new THREE.Color('#443300'),
  });
  const guardGeo = new THREE.BoxGeometry(0.18, 0.04, 0.04);
  const guard = new THREE.Mesh(guardGeo, guardMat);
  guard.position.y = 0.1;
  group.add(guard);

  // Handle — short box, brown leather
  const handleMat = new THREE.MeshStandardMaterial({
    color: '#8B4513',
    metalness: 0.1,
    roughness: 0.9,
  });
  const handleGeo = new THREE.BoxGeometry(0.05, 0.2, 0.035);
  const handle = new THREE.Mesh(handleGeo, handleMat);
  handle.position.y = -0.02;
  group.add(handle);

  // Pommel — small sphere at bottom of handle
  const pommelGeo = new THREE.SphereGeometry(0.035, 6, 6);
  const pommel = new THREE.Mesh(pommelGeo, guardMat);
  pommel.position.y = -0.13;
  group.add(pommel);

  return group;
}

// ── Build hand-held sword mesh (for Character3D handslot.r) ─────────

export function buildHandSword(): THREE.Group {
  const group = new THREE.Group();

  const bladeMat = new THREE.MeshBasicMaterial({ color: '#c0c0c0' });
  const guardMat = new THREE.MeshBasicMaterial({ color: '#daa520' });
  const handleMat = new THREE.MeshBasicMaterial({ color: '#8B4513' });

  // Blade — pointing forward (+Z in hand local space)
  const bladeGeo = new THREE.BoxGeometry(0.4, 0.12, 5.0);
  const blade = new THREE.Mesh(bladeGeo, bladeMat);
  blade.position.z = 2.8;
  group.add(blade);

  // Blade tip
  const tipGeo = new THREE.ConeGeometry(0.2, 0.8, 4);
  const tip = new THREE.Mesh(tipGeo, bladeMat);
  tip.rotation.x = -Math.PI / 2;
  tip.position.z = 5.5;
  group.add(tip);

  // Guard — perpendicular crossbar
  const guardGeo = new THREE.BoxGeometry(1.4, 0.3, 0.3);
  const guard = new THREE.Mesh(guardGeo, guardMat);
  guard.position.z = 0.2;
  group.add(guard);

  // Handle
  const handleGeo = new THREE.BoxGeometry(0.3, 0.3, 1.2);
  const handle = new THREE.Mesh(handleGeo, handleMat);
  handle.position.z = -0.5;
  group.add(handle);

  // Pommel
  const pommelGeo = new THREE.SphereGeometry(0.22, 6, 6);
  const pommel = new THREE.Mesh(pommelGeo, guardMat);
  pommel.position.z = -1.2;
  group.add(pommel);

  return group;
}

// ── SwordPickup3D Component ─────────────────────────────────────────

interface SwordPickup3DProps {
  position: [number, number, number];
  picked: boolean;
}

const SWORD_GLOW_COLOR = '#88aaff';

export function SwordPickup3D({ position, picked }: SwordPickup3DProps) {
  const groupRef = useRef<THREE.Group>(null);
  const swordRef = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.PointLight>(null);

  useFrame(({ clock }) => {
    if (!groupRef.current || picked) return;
    const t = clock.elapsedTime;

    // Spin on Y axis — classic pickup rotation
    if (swordRef.current) {
      swordRef.current.rotation.y = t * 2.0;
    }

    // Bob up and down
    groupRef.current.position.y = position[1] + 0.5 + Math.sin(t * 1.5) * 0.1;

    // Glow pulse
    if (glowRef.current) {
      glowRef.current.intensity = 2.0 + Math.sin(t * 3) * 0.8;
    }
  });

  if (picked) return null;

  return (
    <group ref={groupRef} position={position}>
      {/* The spinning sword */}
      <group ref={swordRef} scale={[1.5, 1.5, 1.5]}>
        <primitive object={createSwordShape()} />
      </group>

      {/* Glow light */}
      <pointLight
        ref={glowRef}
        position={[0, 0.4, 0]}
        color={SWORD_GLOW_COLOR}
        intensity={2.0}
        distance={4}
      />

      {/* Ground glow ring */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <ringGeometry args={[0.2, 0.4, 16]} />
        <meshBasicMaterial
          color={SWORD_GLOW_COLOR}
          transparent
          opacity={0.5}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Ambient glow halo around the sword */}
      <mesh position={[0, 0.4, 0]}>
        <sphereGeometry args={[0.3, 12, 12]} />
        <meshBasicMaterial
          color={SWORD_GLOW_COLOR}
          transparent
          opacity={0.08}
          side={THREE.BackSide}
        />
      </mesh>

      {/* Shadow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[0.25, 12]} />
        <meshBasicMaterial color="#000" transparent opacity={0.15} />
      </mesh>
    </group>
  );
}

export { createSwordShape };
