// ── GravityZones — low-grav + high-grav marked floor areas ───────────
//
// Two 5×5u zones drawn as thin black rings on the floor. A few floating
// white marker cubes bob above the low-grav zone for readability; the
// high-grav zone shows downward-pointing chevron arrows on the floor
// texture (via canvas texture, cheap, single draw).
//
// External impulses are applied to the player MovementBody each frame:
//   LOW  grav zone: body.vz += 0.15 * dt  (pushes up — slower fall)
//   HIGH grav zone: body.vz -= 0.30 * dt  (pushes down — heavier)
//
// This is intentionally a small nudge layered on top of the normal
// locomotion gravity; we do NOT replace or modify locomotion.ts.
//
// Player body coords are tile-world (x,y). Zones are authored in
// three.js world units and converted internally via TJ_TO_TILE.

import { useMemo, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';

import type { MovementBody } from '../../engine/movementBody';
import { getPlayerBodyForDojo } from './dojoState';

const TJ_TO_TILE = 10;
const ZONE_SIZE = 5; // three.js units, 5×5
const ZONE_SIZE_TILE = ZONE_SIZE * TJ_TO_TILE;

// ── Chevron texture for high-grav zone ───────────────────────────────

function makeChevronTexture(): THREE.CanvasTexture {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  // Transparent background
  ctx.clearRect(0, 0, size, size);
  ctx.strokeStyle = '#0a0a0a';
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Three downward chevrons stacked
  const cx = size / 2;
  const spacing = 50;
  for (let i = 0; i < 3; i++) {
    const cy = size / 2 - spacing + i * spacing;
    ctx.beginPath();
    ctx.moveTo(cx - 40, cy - 20);
    ctx.lineTo(cx, cy + 20);
    ctx.lineTo(cx + 40, cy - 20);
    ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 2;
  tex.needsUpdate = true;
  return tex;
}

// ── Zone base render ─────────────────────────────────────────────────

interface ZoneVisualProps {
  /** Local position (relative to GravityZones parent group) */
  center: [number, number, number];
  /** Optional floor texture (e.g. chevrons) */
  floorTexture?: THREE.Texture;
}

function ZoneRing({ center, floorTexture }: ZoneVisualProps): ReactNode {
  // Outer ring + inner edge for crispness.
  return (
    <group position={center}>
      {/* Floor texture plate (only for high-grav zone) */}
      {floorTexture && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
          <planeGeometry args={[ZONE_SIZE * 0.85, ZONE_SIZE * 0.85]} />
          <meshBasicMaterial map={floorTexture} transparent opacity={0.8} />
        </mesh>
      )}
      {/* Outer black ring outline — torus lying flat */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
        <torusGeometry args={[ZONE_SIZE / 2, 0.04, 8, 64]} />
        <meshBasicMaterial color="#0a0a0a" />
      </mesh>
      {/* Inner thinner ring for layered look */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.018, 0]}>
        <torusGeometry args={[ZONE_SIZE / 2 - 0.25, 0.015, 6, 48]} />
        <meshBasicMaterial color="#0a0a0a" transparent opacity={0.6} />
      </mesh>
    </group>
  );
}

// ── Low-grav floating cubes (vibe decoration) ───────────────────────

function LowGravMarkers({ center }: { center: [number, number, number] }): ReactNode {
  const groupRef = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    const g = groupRef.current;
    if (!g) return;
    const t = clock.elapsedTime;
    // Bob each child independently using its userData phase.
    g.children.forEach((child, i) => {
      const phase = i * 1.3;
      child.position.y = (child.userData.baseY as number) + Math.sin(t + phase) * 0.15;
    });
  });
  const cubes: Array<{ x: number; z: number; y: number; size: number }> = [
    { x: -0.8, z: -0.5, y: 1.6, size: 0.35 },
    { x: 0.6, z: 0.7, y: 2.1, size: 0.3 },
    { x: 1.1, z: -0.9, y: 2.4, size: 0.25 },
    { x: -1.2, z: 0.8, y: 1.9, size: 0.3 },
  ];
  return (
    <group ref={groupRef} position={center}>
      {cubes.map((c, i) => (
        <mesh key={i} position={[c.x, c.y, c.z]} userData={{ baseY: c.y }}>
          <boxGeometry args={[c.size, c.size, c.size]} />
          <meshStandardMaterial color="#ffffff" roughness={0.85} />
        </mesh>
      ))}
    </group>
  );
}

// ── Main ─────────────────────────────────────────────────────────────

export interface GravityZonesProps {
  /** Group origin in three.js world units. */
  position?: [number, number, number];
  /**
   * Optional getter for the live player body. If omitted, falls back to
   * the module-level `getPlayerBodyForDojo()` (set from WorldPage's
   * game-logic tick as a later integration step).
   */
  getPlayerBody?: () => MovementBody | null;
}

export function GravityZones({
  position = [0, 0, -10],
  getPlayerBody,
}: GravityZonesProps): ReactNode {
  const chevron = useMemo(() => makeChevronTexture(), []);

  // Local zone centers relative to `position`.
  // Low-grav zone on the west (-X), high-grav zone on the east (+X).
  const lowCenter: [number, number, number] = [-3.5, 0, 0];
  const highCenter: [number, number, number] = [3.5, 0, 0];

  // Precompute zone AABBs in tile-world coords for per-frame checks.
  const [lowAABB, highAABB] = useMemo(() => {
    const lowCenterTileX = (position[0] + lowCenter[0]) * TJ_TO_TILE;
    const lowCenterTileY = (position[2] + lowCenter[2]) * TJ_TO_TILE;
    const highCenterTileX = (position[0] + highCenter[0]) * TJ_TO_TILE;
    const highCenterTileY = (position[2] + highCenter[2]) * TJ_TO_TILE;
    const half = ZONE_SIZE_TILE / 2;
    return [
      { x: lowCenterTileX, y: lowCenterTileY, half },
      { x: highCenterTileX, y: highCenterTileY, half },
    ];
  }, [position]);

  useFrame((_state, delta) => {
    const body = getPlayerBody ? getPlayerBody() : getPlayerBodyForDojo();
    if (!body) return;
    const dt = delta;
    // AABB containment checks — 2D on tile x/y.
    const inLow =
      body.x >= lowAABB.x - lowAABB.half &&
      body.x <= lowAABB.x + lowAABB.half &&
      body.y >= lowAABB.y - lowAABB.half &&
      body.y <= lowAABB.y + lowAABB.half;
    const inHigh =
      body.x >= highAABB.x - highAABB.half &&
      body.x <= highAABB.x + highAABB.half &&
      body.y >= highAABB.y - highAABB.half &&
      body.y <= highAABB.y + highAABB.half;
    if (inLow) body.vz += 0.15 * dt;
    if (inHigh) body.vz -= 0.3 * dt;
  });

  return (
    <group position={position}>
      {/* Low-grav zone */}
      <ZoneRing center={lowCenter} />
      <LowGravMarkers center={lowCenter} />

      {/* High-grav zone */}
      <ZoneRing center={highCenter} floorTexture={chevron} />
    </group>
  );
}

export default GravityZones;
