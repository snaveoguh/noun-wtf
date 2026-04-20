// ── FriesPortal — giant voxel-fries monument that doubles as the portal
//                  into fried world.
//
// Rebuilds the 5×7 pixel fries accessory from LolLogo at world scale and
// mounts it as an interactable. Walking within proximity shows an [E]
// ENTER FRIED WORLD prompt; pressing E swaps the world.
//
// Replaces / complements the FriedMirror — same contract, fryer vibes.

import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';

import { useWorldStore } from '../shared/useWorldStore';

// Duplicated from components/LolLogo (kept in sync manually) so this 3D
// portal stays self-contained — parent file doesn't need to export.
const FRIES_PIXELS: [number, number, string][] = [
  [0, 0, '#ffc110'],
  [1, 0, '#b87b11'],
  [2, 0, '#ffc110'],
  [3, 0, '#b87b11'],
  [4, 0, '#ffc110'],
  [0, 1, '#ffc110'],
  [1, 1, '#b87b11'],
  [2, 1, '#ffc110'],
  [3, 1, '#b87b11'],
  [4, 1, '#ffc110'],
  [0, 2, '#e11833'],
  [1, 2, '#e11833'],
  [2, 2, '#e11833'],
  [3, 2, '#e11833'],
  [4, 2, '#e11833'],
  [0, 3, '#e11833'],
  [1, 3, '#ffc110'],
  [2, 3, '#ffc110'],
  [3, 3, '#ffc110'],
  [4, 3, '#e11833'],
  [0, 4, '#e11833'],
  [1, 4, '#ffc110'],
  [2, 4, '#ffc110'],
  [3, 4, '#e11833'],
  [4, 4, '#e11833'],
  [0, 5, '#e11833'],
  [1, 5, '#ffc110'],
  [2, 5, '#e11833'],
  [3, 5, '#e11833'],
  [4, 5, '#e11833'],
  [0, 6, '#e11833'],
  [1, 6, '#e11833'],
  [2, 6, '#e11833'],
  [3, 6, '#e11833'],
  [4, 6, '#e11833'],
];
const FRIES_HEIGHT = 7;

interface FriesPortalProps {
  /** World-space position to place the base of the monument (y is ground level). */
  position: [number, number, number];
  /** Tile-space player ref for proximity detection (matches FriedMirror). */
  playerRef: React.RefObject<{ x: number; y: number } | null>;
  /** World-unit scale for converting tile coords → world coords (default 0.1). */
  worldScale?: number;
  /** Voxel cube size. Default 1 → monument is 5u × 7u. */
  voxelSize?: number;
}

// Build a set of "fry-top" pixels (rows 0-1) so we can emissive them separately.
const FRY_TOP_ROWS = new Set([0, 1]);

export function FriesPortal({
  position,
  playerRef,
  worldScale = 0.1,
  voxelSize = 1.6, // 5×1.6 = 8u wide, 7×1.6 = 11.2u tall — monumental
}: FriesPortalProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [nearby, setNearby] = useState(false);

  // Precompute each pixel's mesh config (color, isFryTop for emissive).
  const voxels = useMemo(
    () =>
      FRIES_PIXELS.map(([x, y, color]) => ({
        x,
        y,
        color,
        isFryTop: FRY_TOP_ROWS.has(y),
      })),
    [],
  );

  // Proximity detection + idle hover animation.
  useFrame(state => {
    const g = groupRef.current;
    if (!g) return;
    // Idle bob + slow rotate so it reads as alive.
    const t = state.clock.elapsedTime;
    g.rotation.y = t * 0.15;
    g.position.y = position[1] + Math.sin(t * 0.9) * 0.25;

    // Proximity check — player.x/y are TILE coords, convert to world.
    const p = playerRef.current;
    if (!p) return;
    const px = p.x * worldScale;
    const pz = p.y * worldScale;
    const dx = px - position[0];
    const dz = pz - position[2];
    const dist = Math.sqrt(dx * dx + dz * dz);
    const isNearby = dist < 6; // generous for a monument
    if (isNearby !== nearby) setNearby(isNearby);
  });

  // E → enter fried world when nearby (matches FriedMirror's contract).
  useEffect(() => {
    if (!nearby) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'e' && e.key !== 'E') return;
      const s = useWorldStore.getState();
      if (s.current !== 'white' || s.transition !== 'idle') return;
      s.enterWorld('fried');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [nearby]);

  // Fries monument centered on (0, 0, 0) inside the group — we offset by
  // group position + lift half the height above the baseline.
  // Pixel (0,0) is top-left in art; in 3D we want pixel y=0 at TOP of monument.
  const halfW = ((5 - 1) / 2) * voxelSize;
  const totalH = FRIES_HEIGHT * voxelSize;

  return (
    <group ref={groupRef} position={position}>
      {voxels.map(v => {
        // Center horizontally, anchor vertically so y=0 row is at top.
        const px = v.x * voxelSize - halfW;
        const py = totalH - v.y * voxelSize - voxelSize / 2;
        return (
          <mesh key={`${v.x}-${v.y}`} position={[px, py, 0]}>
            <boxGeometry args={[voxelSize, voxelSize, voxelSize]} />
            <meshStandardMaterial
              color={v.color}
              emissive={v.color}
              emissiveIntensity={v.isFryTop ? 0.55 : 0.25}
              roughness={0.55}
              metalness={0.1}
            />
          </mesh>
        );
      })}

      {/* Shadow disc under the monument */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <circleGeometry args={[halfW + voxelSize, 32]} />
        <meshBasicMaterial color="#d0c0a0" transparent opacity={0.35} />
      </mesh>

      {nearby && (
        <Html
          position={[0, totalH + 1.4, 0]}
          center
          distanceFactor={14}
          style={{ pointerEvents: 'none' }}
        >
          <div
            style={{
              fontFamily: 'monospace',
              fontSize: '14px',
              fontWeight: 'bold',
              color: '#ffc110',
              background: 'rgba(0,0,0,0.85)',
              border: '1px solid #ffc110',
              padding: '6px 10px',
              letterSpacing: '2px',
              whiteSpace: 'nowrap',
              userSelect: 'none',
              textShadow: '0 0 6px #ffc110',
            }}
          >
            [E] ENTER FRIED WORLD
          </div>
        </Html>
      )}
    </group>
  );
}

// Helper so WorldPage can register E-press → enterWorld without having to
// recompute distance twice. Returns true if the player is currently inside
// the portal's trigger radius AND world is 'white'.
export function tryEnterFriedViaFries(
  playerWorldX: number,
  playerWorldZ: number,
  portalX: number,
  portalZ: number,
  triggerRadius = 6,
): boolean {
  const current = useWorldStore.getState().current;
  if (current !== 'white') return false;
  const dx = playerWorldX - portalX;
  const dz = playerWorldZ - portalZ;
  if (dx * dx + dz * dz > triggerRadius * triggerRadius) return false;
  useWorldStore.getState().enterWorld('fried');
  return true;
}

export default FriesPortal;
