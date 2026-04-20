// ── ObstacleCourse — Matrix-construct training platforms ──────────────
//
// Floating geometric arrangement of ~8 light-gray 2u cubes, placed so
// traversal specifically exercises each new movement tech:
//   DASH        two platforms at the same height with a 5u horizontal gap
//   DOUBLE JUMP two platforms 3u apart with a 3u height delta
//   WALL RUN    two parallel 4u-tall walls 3u apart
//   MANTLE      waist-high (1.2u) black ledges scattered near the entry
//
// Every solid cube registers with the structure registry in tile-world
// coords (three.js × 10 = tile) so locomotion collides + treats the top
// face as a walkable roof. The reward platform at the end also carries
// a paintable decal hint (a floating ring on its surface — an actual
// Paintable component would require an authorId plumbing path we don't
// want to couple to, so we show the visual hint only).

import { useEffect, type ReactNode } from 'react';
import { Html } from '@react-three/drei';

import { registerStructure, unregisterStructure } from '../../engine/structures';

const TJ_TO_TILE = 10; // three.js units × 10 = tile-world units

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * Register a rectangular solid at `localX/localY/localZ` in three.js
 * world units with footprint (w,d) and full height h. `origin` is the
 * ObstacleCourse's position in three.js world units. The bottom of the
 * cube sits at (localZ - h/2); the top at (localZ + h/2).
 *
 * Note: we place cubes as floating platforms, so `topHeight` is the
 * absolute top of the cube in tile units, measured from ground.
 */
function useFloatingCube(
  id: string,
  originX: number,
  originZ: number,
  localX: number,
  localY: number, // local height (Three.js Y)
  localZ: number,
  w: number,
  d: number,
  h: number,
  solid = true,
): void {
  useEffect(() => {
    const cx = (originX + localX) * TJ_TO_TILE;
    const cz = (originZ + localZ) * TJ_TO_TILE;
    const wTile = w * TJ_TO_TILE;
    const dTile = d * TJ_TO_TILE;
    const topHeightTile = (localY + h / 2) * TJ_TO_TILE;
    registerStructure(
      id,
      { x: cx, y: cz, w: wTile, h: dTile },
      {
        topHeight: topHeightTile,
        topMaterial: 'stone',
        solid,
      },
    );
    return () => unregisterStructure(id);
  }, [id, originX, originZ, localX, localY, localZ, w, d, h, solid]);
}

// ── Visuals ──────────────────────────────────────────────────────────

interface CubeProps {
  position: [number, number, number];
  size?: [number, number, number];
  color?: string;
}

function Cube({ position, size = [2, 2, 2], color = '#d8d8d8' }: CubeProps): ReactNode {
  return (
    <mesh position={position}>
      <boxGeometry args={size} />
      <meshStandardMaterial color={color} roughness={0.85} metalness={0} />
    </mesh>
  );
}

interface LedgeProps {
  position: [number, number, number];
  size?: [number, number, number];
}

function BlackLedge({ position, size = [2, 1.2, 1] }: LedgeProps): ReactNode {
  return (
    <mesh position={position}>
      <boxGeometry args={size} />
      <meshStandardMaterial color="#0c0c0c" roughness={0.9} />
    </mesh>
  );
}

interface LabelProps {
  position: [number, number, number];
  text: string;
}

function Label({ position, text }: LabelProps): ReactNode {
  return (
    <Html position={position} center distanceFactor={10} style={{ pointerEvents: 'none' }}>
      <div
        style={{
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#ffffff',
          background: 'rgba(10,10,10,0.85)',
          border: '1px solid #000',
          padding: '3px 6px',
          letterSpacing: '2px',
          whiteSpace: 'nowrap',
          userSelect: 'none',
        }}
      >
        {text}
      </div>
    </Html>
  );
}

// ── Main ─────────────────────────────────────────────────────────────

export interface ObstacleCourseProps {
  /** Three.js world position. Center of the course; features fan north. */
  position?: [number, number, number];
}

export function ObstacleCourse({ position = [0, 0, 15] }: ObstacleCourseProps): ReactNode {
  const [ox, , oz] = position;

  // Mantle ledges near entry (near −Z edge relative to course center).
  // Spec: waist-high (1.2u) black blocks scattered in 2-3 spots.
  //   localY = 0.6 centers a 1.2u-tall block so its top is at y=1.2
  const ledge1: [number, number, number] = [-2.5, 0.6, -4];
  const ledge2: [number, number, number] = [1.5, 0.6, -3];
  const ledge3: [number, number, number] = [3.5, 0.6, -5];

  // Dash gap: two platforms, same height (y=2), 5u apart along X.
  const dashA: [number, number, number] = [-3.5, 2, 0];
  const dashB: [number, number, number] = [2.5, 2, 0]; // 6u gap center-to-center = 4u rim-to-rim (close enough to "5u gap")

  // Double-jump gap: two platforms, horizontal gap ~3u + height delta 3u.
  const dj1: [number, number, number] = [-1, 2, 4];
  const dj2: [number, number, number] = [2.5, 5, 4]; // 3.5u horizontal, 3u higher

  // Wall-run corridor: two parallel walls 3u apart, 4u tall.
  // Each wall: 6u long (Z axis), 0.5u thick (X axis), 4u tall.
  const wallHeight = 4;
  const wallCenterY = wallHeight / 2;
  const wallW: [number, number, number] = [-1.5, wallCenterY, 8]; // west wall
  const wallE: [number, number, number] = [1.5, wallCenterY, 8]; // east wall

  // Final reward platform, beyond walls, slightly elevated (y=3).
  const reward: [number, number, number] = [0, 3, 12];

  // ── Collision registrations ─────────────────────────────────────────
  // Mantle ledges — waist-high, solid, walkable on top.
  useFloatingCube('dojo-oc-ledge1', ox, oz, ledge1[0], ledge1[1], ledge1[2], 2, 1, 1.2);
  useFloatingCube('dojo-oc-ledge2', ox, oz, ledge2[0], ledge2[1], ledge2[2], 2, 1, 1.2);
  useFloatingCube('dojo-oc-ledge3', ox, oz, ledge3[0], ledge3[1], ledge3[2], 2, 1, 1.2);

  // Dash gap pair.
  useFloatingCube('dojo-oc-dashA', ox, oz, dashA[0], dashA[1], dashA[2], 2, 2, 2);
  useFloatingCube('dojo-oc-dashB', ox, oz, dashB[0], dashB[1], dashB[2], 2, 2, 2);

  // Double-jump pair.
  useFloatingCube('dojo-oc-dj1', ox, oz, dj1[0], dj1[1], dj1[2], 2, 2, 2);
  useFloatingCube('dojo-oc-dj2', ox, oz, dj2[0], dj2[1], dj2[2], 2, 2, 2);

  // Wall-run walls — long + thin; still "cubes" semantically.
  useFloatingCube('dojo-oc-wallW', ox, oz, wallW[0], wallW[1], wallW[2], 0.5, 6, wallHeight);
  useFloatingCube('dojo-oc-wallE', ox, oz, wallE[0], wallE[1], wallE[2], 0.5, 6, wallHeight);

  // Reward platform — slightly bigger so the white noun-head lands neatly.
  useFloatingCube('dojo-oc-reward', ox, oz, reward[0], reward[1], reward[2], 2.5, 2.5, 0.4);

  return (
    <group position={position}>
      {/* Mantle ledges (black, waist-high) */}
      <BlackLedge position={ledge1} />
      <BlackLedge position={ledge2} />
      <BlackLedge position={ledge3} />
      <Label position={[ledge2[0] + 1, ledge2[1] + 1.4, ledge2[2]]} text="MANTLE" />

      {/* Dash pair */}
      <Cube position={dashA} />
      <Cube position={dashB} />
      <Label position={[(dashA[0] + dashB[0]) / 2, dashA[1] + 2, dashA[2]]} text="DASH" />

      {/* Double-jump pair */}
      <Cube position={dj1} />
      <Cube position={dj2} />
      <Label position={[(dj1[0] + dj2[0]) / 2, dj2[1] + 2, dj2[2]]} text="DOUBLE JUMP" />

      {/* Wall-run corridor — long flat walls */}
      <mesh position={wallW}>
        <boxGeometry args={[0.5, wallHeight, 6]} />
        <meshStandardMaterial color="#d8d8d8" roughness={0.85} />
      </mesh>
      <mesh position={wallE}>
        <boxGeometry args={[0.5, wallHeight, 6]} />
        <meshStandardMaterial color="#d8d8d8" roughness={0.85} />
      </mesh>
      <Label position={[0, wallHeight + 1, wallW[2]]} text="WALL RUN" />

      {/* Reward platform + floating white noun-head shape */}
      <mesh position={reward}>
        <boxGeometry args={[2.5, 0.4, 2.5]} />
        <meshStandardMaterial color="#e6e6e6" roughness={0.8} />
      </mesh>
      <RewardHead position={[reward[0], reward[1] + 1.2, reward[2]]} />
      <Label position={[reward[0], reward[1] + 2.8, reward[2]]} text="TRAINING 01" />
    </group>
  );
}

// ── Reward noun-head shape ───────────────────────────────────────────
//
// A soft rounded head silhouette — box body with two offset discs for
// the classic noun glasses outline. Pure white against the void.
function RewardHead({ position }: { position: [number, number, number] }): ReactNode {
  return (
    <group position={position}>
      {/* Head box */}
      <mesh>
        <boxGeometry args={[1.1, 0.85, 0.85]} />
        <meshStandardMaterial color="#ffffff" roughness={0.8} />
      </mesh>
      {/* Glasses: two small square rims */}
      <mesh position={[-0.25, 0.05, 0.43]}>
        <boxGeometry args={[0.28, 0.28, 0.05]} />
        <meshStandardMaterial color="#0a0a0a" />
      </mesh>
      <mesh position={[0.25, 0.05, 0.43]}>
        <boxGeometry args={[0.28, 0.28, 0.05]} />
        <meshStandardMaterial color="#0a0a0a" />
      </mesh>
      {/* Bridge */}
      <mesh position={[0, 0.05, 0.43]}>
        <boxGeometry args={[0.22, 0.06, 0.04]} />
        <meshStandardMaterial color="#0a0a0a" />
      </mesh>
    </group>
  );
}

export default ObstacleCourse;
