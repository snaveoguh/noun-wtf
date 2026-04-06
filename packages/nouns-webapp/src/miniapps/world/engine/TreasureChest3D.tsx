// ── 3D Treasure Chest — Nouns treasurechest head extruded thick ──────
// Uses the actual Nouns "head-treasurechest" pixel art from @noundry/nouns-assets,
// extruded into a chunky voxel block with animated lid and gold glow.

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import {
  buildNounGeometries,
  seedToLayers,
  type LayerVisibility,
} from '@nouns/voxel-engine';
import { ImageData, getNounData } from '@noundry/nouns-assets';

const CHEST_VIS: LayerVisibility = { body: false, accessory: false, head: true, glasses: false };
const CHEST_SCALE = 0.04; // chunky size

// Treasure chest seed — uses head-treasurechest (index 239)
const CHEST_SEED = { background: 0, body: 0, accessory: 0, head: 239, glasses: 0 };

interface TreasureChest3DProps {
  position: [number, number, number];
  pendingCount: number;
  onInteract: () => void;
  playerDistance: number;
}

export function TreasureChest3D({ position, pendingCount, playerDistance }: TreasureChest3DProps) {
  const groupRef = useRef<THREE.Group>(null);
  const lidRef = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.PointLight>(null);
  const particlesRef = useRef<THREE.Points>(null);

  // Build voxel geometry from Nouns treasurechest head
  const chestGeo = useMemo(() => {
    try {
      const layers = seedToLayers(CHEST_SEED, getNounData, ImageData.palette, CHEST_VIS);
      return buildNounGeometries(layers);
    } catch {
      return { bodyGeo: null, blingGeo: null, headGeo: null, glassesGeo: null };
    }
  }, []);

  // Gold sparkle particles
  const particleGeo = useMemo(() => {
    const count = 30;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 1.5;
      positions[i * 3 + 1] = Math.random() * 2;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 1.5;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geo;
  }, []);

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.elapsedTime;

    // Gentle float
    groupRef.current.position.y = position[1] + Math.sin(t * 0.6) * 0.03;

    // Lid opens when player approaches
    if (lidRef.current) {
      const targetRot = playerDistance < 3 ? -0.6 : 0;
      lidRef.current.rotation.x += (targetRot - lidRef.current.rotation.x) * 0.05;
    }

    // Gold glow pulses when items pending
    if (glowRef.current) {
      const base = pendingCount > 0 ? 3 : 0.8;
      const pulse = pendingCount > 0 ? Math.sin(t * 2.5) * 1.5 + 1.5 : 0;
      glowRef.current.intensity = base + pulse;
    }

    // Sparkle particles float up when items pending
    if (particlesRef.current && pendingCount > 0) {
      particlesRef.current.visible = true;
      const pos = particlesRef.current.geometry.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        let y = pos.getY(i);
        y += 0.01 + Math.random() * 0.005;
        if (y > 2.5) y = 0;
        pos.setY(i, y);
      }
      pos.needsUpdate = true;
      particlesRef.current.rotation.y = t * 0.3;
    } else if (particlesRef.current) {
      particlesRef.current.visible = false;
    }
  });

  const isNear = playerDistance < 3;

  return (
    <group ref={groupRef} position={position}>
      {/* Main chest body — Nouns treasurechest voxels, extruded thick */}
      <group scale={[CHEST_SCALE, CHEST_SCALE, CHEST_SCALE]} position={[0, 0.5, 0]}>
        {chestGeo.headGeo && (
          <mesh geometry={chestGeo.headGeo}>
            <meshBasicMaterial vertexColors toneMapped={false} />
          </mesh>
        )}
      </group>

      {/* Lid — duplicate the top portion, hinged at back */}
      <group ref={lidRef} position={[0, 1.0, -0.3]}>
        <mesh position={[0, 0.05, 0.3]}>
          <boxGeometry args={[0.9, 0.12, 0.6]} />
          <meshStandardMaterial color="#8B4513" roughness={0.7} />
        </mesh>
        {/* Gold band on lid */}
        <mesh position={[0, 0.12, 0.3]}>
          <boxGeometry args={[0.95, 0.04, 0.65]} />
          <meshStandardMaterial color="#DAA520" metalness={0.7} roughness={0.2} />
        </mesh>
      </group>

      {/* Gold glow from inside */}
      <pointLight
        ref={glowRef}
        position={[0, 0.8, 0]}
        color="#ffaa00"
        intensity={0.8}
        distance={5}
      />

      {/* Gold sparkle particles */}
      <points ref={particlesRef} visible={false}>
        <primitive object={particleGeo} attach="geometry" />
        <pointsMaterial
          color="#ffdd44"
          size={0.04}
          transparent
          opacity={0.8}
          sizeAttenuation
        />
      </points>

      {/* Interact prompt */}
      {isNear && (
        <group position={[0, 1.8, 0]}>
          {/* "Press E" text would go here — using sprite for now */}
          <sprite scale={[1.2, 0.2, 1]}>
            <spriteMaterial color="#ffffff" transparent opacity={0.8} />
          </sprite>
        </group>
      )}

      {/* Pending count badge */}
      {pendingCount > 0 && (
        <sprite position={[0.5, 1.3, 0]} scale={[0.4, 0.4, 1]}>
          <spriteMaterial color="#ff4444" transparent opacity={0.9} />
        </sprite>
      )}

      {/* Shadow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[0.6, 16]} />
        <meshBasicMaterial color="#000" transparent opacity={0.2} />
      </mesh>
    </group>
  );
}

// ── Dropped Item 3D (glowing pickup orb) ─────────────────────────────

interface DroppedItem3DProps {
  position: [number, number, number];
  itemType: 'eth' | 'erc20' | 'erc721';
  claimed: boolean;
}

export function DroppedItem3D({ position, itemType, claimed }: DroppedItem3DProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  useFrame(({ clock }) => {
    if (!meshRef.current || claimed) return;
    const t = clock.elapsedTime;
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
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[0.15, 8]} />
        <meshBasicMaterial color="#000" transparent opacity={0.1} />
      </mesh>
    </group>
  );
}
