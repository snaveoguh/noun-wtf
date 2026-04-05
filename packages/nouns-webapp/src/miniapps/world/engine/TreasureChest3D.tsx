// ── 3D Treasure Chest on Island ──────────────────────────────────────
// Glowing chest near spawn. Press E to open deposit modal.
// Pulses when items are waiting for next drop party.

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface TreasureChest3DProps {
  position: [number, number, number];
  pendingCount: number; // number of pending deposits
  onInteract: () => void; // called when player presses E near chest
  playerDistance: number; // distance from player to chest
}

export function TreasureChest3D({ position, pendingCount, playerDistance }: TreasureChest3DProps) {
  const groupRef = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.PointLight>(null);
  const lidRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.elapsedTime;

    // Pulse glow when items pending
    if (glowRef.current) {
      const baseBright = pendingCount > 0 ? 2 : 0.5;
      const pulse = pendingCount > 0 ? Math.sin(t * 2) * 0.5 + 0.5 : 0;
      glowRef.current.intensity = baseBright + pulse;
    }

    // Lid slightly open when player is near
    if (lidRef.current) {
      const targetOpen = playerDistance < 3 ? -0.4 : 0;
      lidRef.current.rotation.x += (targetOpen - lidRef.current.rotation.x) * 0.05;
    }

    // Gentle hover
    groupRef.current.position.y = position[1] + Math.sin(t * 0.8) * 0.03;
  });

  const isNear = playerDistance < 3;

  return (
    <group ref={groupRef} position={position}>
      {/* Chest base */}
      <mesh position={[0, 0.25, 0]}>
        <boxGeometry args={[0.8, 0.5, 0.5]} />
        <meshStandardMaterial color="#8B4513" roughness={0.8} />
      </mesh>

      {/* Chest rim/band */}
      <mesh position={[0, 0.35, 0]}>
        <boxGeometry args={[0.85, 0.08, 0.55]} />
        <meshStandardMaterial color="#DAA520" metalness={0.6} roughness={0.3} />
      </mesh>

      {/* Chest lid */}
      <mesh ref={lidRef} position={[0, 0.52, -0.22]} rotation={[0, 0, 0]}>
        <boxGeometry args={[0.8, 0.15, 0.5]} />
        <meshStandardMaterial color="#A0522D" roughness={0.7} />
      </mesh>

      {/* Lock */}
      <mesh position={[0, 0.35, 0.26]}>
        <boxGeometry args={[0.1, 0.12, 0.05]} />
        <meshStandardMaterial color="#DAA520" metalness={0.8} roughness={0.2} />
      </mesh>

      {/* Inner glow */}
      <pointLight
        ref={glowRef}
        position={[0, 0.5, 0]}
        color={pendingCount > 0 ? '#ffcc00' : '#886622'}
        intensity={0.5}
        distance={3}
      />

      {/* Interaction prompt */}
      {isNear && (
        <sprite position={[0, 1.2, 0]} scale={[1.5, 0.3, 1]}>
          <spriteMaterial color="#ffffff" transparent opacity={0.9} />
        </sprite>
      )}

      {/* Pending count floating text */}
      {pendingCount > 0 && (
        <sprite position={[0, 0.9, 0]} scale={[0.8, 0.25, 1]}>
          <spriteMaterial color="#ffcc00" transparent opacity={0.8} />
        </sprite>
      )}

      {/* Shadow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[0.5, 12]} />
        <meshBasicMaterial color="#000" transparent opacity={0.15} />
      </mesh>
    </group>
  );
}

// ── Dropped Item 3D (glowing pickup orb) ─────────────────────────────

interface DroppedItem3DProps {
  position: [number, number, number];
  itemType: 'erc20' | 'erc721' | 'eth';
  claimed: boolean;
}

export function DroppedItem3D({ position, itemType, claimed }: DroppedItem3DProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!meshRef.current || claimed) return;
    const t = clock.elapsedTime;
    // Float and spin
    meshRef.current.position.y = position[1] + 0.3 + Math.sin(t * 2) * 0.1;
    meshRef.current.rotation.y = t * 1.5;
  });

  if (claimed) return null;

  const color = itemType === 'eth' ? '#627eea' : itemType === 'erc721' ? '#ff6b6b' : '#4ecdc4';

  return (
    <group position={position}>
      <mesh ref={meshRef} position={[0, 0.3, 0]}>
        <octahedronGeometry args={[0.15, 0]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.5}
          metalness={0.3}
          roughness={0.2}
        />
      </mesh>
      <pointLight position={[0, 0.3, 0]} color={color} intensity={1} distance={2} />
      {/* Shadow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[0.15, 8]} />
        <meshBasicMaterial color="#000" transparent opacity={0.1} />
      </mesh>
    </group>
  );
}
