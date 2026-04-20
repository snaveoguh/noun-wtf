// ── BuildPieces — Fortnite primitives (wall / floor / ramp) ──────────
//
// Self-registering 3D primitives for the BuildMode system. Each piece
// renders its geometry in Three.js units and registers collision with
// the StructureRegistry in tile-world units (×WORLD_SCALE_INV). That
// way, the moment a BuildFloor lands, the locomotion topHeight sampler
// will treat it as standable; a BuildRamp's five stepped AABBs read as
// a walkable staircase even though visually it's a single angled plane.
//
// Every paintable face uses Paintable from @nouns/graffiti/r3f so users
// can tag what they build — consistent with walls, cars, and dumpsters
// elsewhere in CityBlock.

import { useEffect, type ReactNode } from 'react';
import { Paintable } from '@nouns/graffiti/r3f';
import { registerStructure, unregisterStructure, type StructureOpts } from './structures';

// Keep in sync with CityBlock.
const WORLD_SCALE = 0.1;
const TJ_TO_TILE = 1 / WORLD_SCALE; // multiply three.js → tile-world

// ── Shared hook ──────────────────────────────────────────────────────

/**
 * Register a rectangular solid at (x, z) in Three.js coords with footprint
 * (w, d) and top-height h. Handles cleanup on unmount. Identical contract
 * to CityBlock's `useStructure` — we intentionally duplicate it here so
 * buildPieces stays standalone.
 */
function useStructure(
  id: string,
  x: number,
  z: number,
  w: number,
  d: number,
  h: number,
  opts?: Pick<StructureOpts, 'topMaterial' | 'solid'>,
): void {
  useEffect(() => {
    registerStructure(
      id,
      { x: x * TJ_TO_TILE, y: z * TJ_TO_TILE, w: w * TJ_TO_TILE, h: d * TJ_TO_TILE },
      {
        topHeight: h * TJ_TO_TILE,
        topMaterial: opts?.topMaterial,
        solid: opts?.solid,
      },
    );
    return () => unregisterStructure(id);
  }, [id, x, z, w, d, h, opts?.topMaterial, opts?.solid]);
}

// ── Common prop types ────────────────────────────────────────────────

export interface BuildPieceCommonProps {
  id: string;
  position: [number, number, number];
  rotationY?: number;
  paintable?: boolean;
  /** Optional uniform scale — default 1. Applied visually + to collision. */
  scale?: number;
}

// ── BuildWall ────────────────────────────────────────────────────────
//
// 2u wide × 3u tall × 0.2u thick slab. Solid AABB footprint of 2×0.3
// (slightly padded depth so the wall registers reliably). Paintable on
// both front and back faces.

const WALL_W = 2;
const WALL_H = 3;
const WALL_T = 0.2;

export function BuildWall({
  id,
  position,
  rotationY = 0,
  paintable = true,
  scale = 1,
}: BuildPieceCommonProps): ReactNode {
  const w = WALL_W * scale;
  const h = WALL_H * scale;
  const t = WALL_T * scale;
  // Footprint depth uses a slightly padded 0.3 so the solid AABB is robust
  // against near-axis misses when rotation is odd.
  useStructure(id, position[0], position[2], w, Math.max(t, 0.3), h, {
    topMaterial: 'stone',
  });
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* Core slab */}
      <mesh position={[0, h / 2, 0]}>
        <boxGeometry args={[w, h, t]} />
        <meshStandardMaterial color="#7b8a99" roughness={0.85} metalness={0.05} />
      </mesh>
      {/* Placement outline — faint neon rim to read as "placed" */}
      <mesh position={[0, h / 2, 0]}>
        <boxGeometry args={[w + 0.04, h + 0.04, t + 0.02]} />
        <meshBasicMaterial color="#4cf0ff" transparent opacity={0.08} />
      </mesh>
      {paintable && (
        <>
          <Paintable
            surfaceId={`${id}-front`}
            width={w * 0.9}
            height={h * 0.9}
            position={[0, h / 2, t / 2 + 0.002]}
            frameColor={null}
          />
          <Paintable
            surfaceId={`${id}-back`}
            width={w * 0.9}
            height={h * 0.9}
            position={[0, h / 2, -(t / 2 + 0.002)]}
            rotation={[0, Math.PI, 0]}
            frameColor={null}
          />
        </>
      )}
    </group>
  );
}

// ── BuildFloor ───────────────────────────────────────────────────────
//
// 3u × 3u × 0.2u flat panel. `solid: false` so the sides don't block
// walking — the top is reached via topHeight. Paintable top face.

const FLOOR_W = 3;
const FLOOR_D = 3;
const FLOOR_T = 0.2;

export function BuildFloor({
  id,
  position,
  rotationY = 0,
  paintable = true,
  scale = 1,
}: BuildPieceCommonProps): ReactNode {
  const w = FLOOR_W * scale;
  const d = FLOOR_D * scale;
  const t = FLOOR_T * scale;
  useStructure(id, position[0], position[2], w, d, t, {
    topMaterial: 'wood',
    solid: false,
  });
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* Slab */}
      <mesh position={[0, t / 2, 0]}>
        <boxGeometry args={[w, t, d]} />
        <meshStandardMaterial color="#a1886b" roughness={0.9} metalness={0.02} />
      </mesh>
      {/* Outline */}
      <mesh position={[0, t / 2, 0]}>
        <boxGeometry args={[w + 0.04, t + 0.04, d + 0.04]} />
        <meshBasicMaterial color="#4cf0ff" transparent opacity={0.08} />
      </mesh>
      {paintable && (
        <Paintable
          surfaceId={`${id}-top`}
          width={w * 0.92}
          height={d * 0.92}
          position={[0, t + 0.001, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          frameColor={null}
        />
      )}
    </group>
  );
}

// ── BuildRamp ────────────────────────────────────────────────────────
//
// Fortnite-style 45° ramp: 3u base × 3u rise × 0.1u thick. Visually one
// slanted mesh; collision approximated with 5 stepped AABBs underneath,
// each w=3u, d=0.6u, at heights 0.6, 1.2, 1.8, 2.4, 3.0u. The steps are
// short enough that the locomotion sampler reads them as walkable at
// our climb tolerance, giving the player the feel of a smooth ramp.

const RAMP_W = 3;
const RAMP_D = 3;
const RAMP_H = 3;
const RAMP_STEPS = 5;

export function BuildRamp({
  id,
  position,
  rotationY = 0,
  paintable = true,
  scale = 1,
}: BuildPieceCommonProps): ReactNode {
  const w = RAMP_W * scale;
  const d = RAMP_D * scale;
  const h = RAMP_H * scale;
  const stepDepth = d / RAMP_STEPS;
  const stepHeight = h / RAMP_STEPS;

  // 5 stepped AABBs — each registered as its own sub-structure.
  const steps = Array.from({ length: RAMP_STEPS }, (_, i) => {
    // Step i occupies local z range: [-d/2 + i*stepDepth, -d/2 + (i+1)*stepDepth]
    // Local z center = -d/2 + (i + 0.5) * stepDepth
    // top height = (i + 1) * stepHeight
    const localZ = -d / 2 + (i + 0.5) * stepDepth;
    const top = (i + 1) * stepHeight;
    return { i, localZ, top };
  });

  // Rotate each step's local offset by rotationY to get world-space center.
  const cos = Math.cos(rotationY);
  const sin = Math.sin(rotationY);

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {steps.map(({ i, localZ, top }) => (
        <RampStep
          key={i}
          id={`${id}-step-${i}`}
          worldX={position[0] + 0 * cos - localZ * sin}
          worldZ={position[2] + 0 * sin + localZ * cos}
          w={w}
          d={stepDepth + 0.02 /* pad to overlap neighbors */}
          top={top}
        />
      ))}
      {/* Visual slanted plank — covers the staircase so it reads as a ramp */}
      <mesh position={[0, h / 2, 0]} rotation={[Math.atan2(h, d), 0, 0]}>
        <boxGeometry args={[w, 0.1, Math.sqrt(d * d + h * h)]} />
        <meshStandardMaterial color="#8b6f47" roughness={0.9} metalness={0.02} />
      </mesh>
      {/* Outline */}
      <mesh position={[0, h / 2, 0]} rotation={[Math.atan2(h, d), 0, 0]}>
        <boxGeometry args={[w + 0.04, 0.12, Math.sqrt(d * d + h * h) + 0.04]} />
        <meshBasicMaterial color="#4cf0ff" transparent opacity={0.08} />
      </mesh>
      {paintable && (
        <Paintable
          surfaceId={`${id}-top`}
          width={w * 0.9}
          height={Math.sqrt(d * d + h * h) * 0.9}
          position={[0, h / 2 + 0.051, 0]}
          rotation={[-Math.PI / 2 + Math.atan2(h, d), 0, 0]}
          frameColor={null}
        />
      )}
    </group>
  );
}

// One step of a BuildRamp — registers its own AABB in world space so the
// rotation of the parent ramp is accounted for.
function RampStep({
  id,
  worldX,
  worldZ,
  w,
  d,
  top,
}: {
  id: string;
  worldX: number;
  worldZ: number;
  w: number;
  d: number;
  top: number;
}): ReactNode {
  // NOTE: we purposely don't rotate the AABB — tile-world registry is
  // axis-aligned. For ramps whose rotation isn't 0/90/180/270 the
  // footprint will be a slight over-approximation. That's the tradeoff
  // until structures.ts supports rotated AABBs.
  useStructure(id, worldX, worldZ, w, d, top, { topMaterial: 'wood' });
  return null;
}

// ── BuildLamp — simple proc lamppost (no GLB dependency) ─────────────
//
// Intentionally self-contained so BuildMode doesn't reach into CityBlock's
// internal Lamppost closure. Keeps the API surface identical to the other
// primitives.

export function BuildLamp({
  id,
  position,
  rotationY = 0,
  scale = 1,
}: BuildPieceCommonProps): ReactNode {
  const s = scale;
  useStructure(id, position[0], position[2], 0.3 * s, 0.3 * s, 3.5 * s, {
    topMaterial: 'metal',
  });
  return (
    <group position={position} rotation={[0, rotationY, 0]} scale={s}>
      {/* Base */}
      <mesh position={[0, 0.15, 0]}>
        <cylinderGeometry args={[0.25, 0.3, 0.3, 8]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.7} />
      </mesh>
      {/* Pole */}
      <mesh position={[0, 1.75, 0]}>
        <cylinderGeometry args={[0.08, 0.1, 3.2, 8]} />
        <meshStandardMaterial color="#2a2a2a" roughness={0.5} metalness={0.4} />
      </mesh>
      {/* Arm */}
      <mesh position={[0.4, 3.4, 0]} rotation={[0, 0, -Math.PI / 2.3]}>
        <cylinderGeometry args={[0.06, 0.06, 0.8, 6]} />
        <meshStandardMaterial color="#2a2a2a" roughness={0.5} metalness={0.4} />
      </mesh>
      {/* Housing */}
      <mesh position={[0.7, 3.45, 0]}>
        <boxGeometry args={[0.35, 0.2, 0.35]} />
        <meshStandardMaterial color="#1a1a1a" />
      </mesh>
      {/* Bulb */}
      <mesh position={[0.7, 3.3, 0]}>
        <sphereGeometry args={[0.15, 8, 8]} />
        <meshStandardMaterial
          color="#ffeecc"
          emissive="#ffddaa"
          emissiveIntensity={1.8}
          roughness={0.3}
        />
      </mesh>
      <pointLight position={[0.7, 3.3, 0]} color="#ffddaa" intensity={2} distance={8} decay={2} />
    </group>
  );
}

// ── BuildCar — low-poly parked car (proc) ────────────────────────────

const CAR_L = 3.8;
const CAR_W = 1.6;
const CAR_H = 1.2;

export function BuildCar({
  id,
  position,
  rotationY = 0,
  paintable = true,
  scale = 1,
}: BuildPieceCommonProps): ReactNode {
  const s = scale;
  const L = CAR_L * s;
  const W = CAR_W * s;
  const H = CAR_H * s;
  useStructure(id, position[0], position[2], L, W, H, { topMaterial: 'metal' });
  const glossy = { color: '#b71c1c', roughness: 0.28, metalness: 0.45 } as const;
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* Body */}
      <mesh position={[0, 0.45 * s, 0]}>
        <boxGeometry args={[L, 0.5 * s, W]} />
        <meshStandardMaterial {...glossy} />
      </mesh>
      {/* Cabin */}
      <mesh position={[0, 0.95 * s, 0]}>
        <boxGeometry args={[1.8 * s, 0.55 * s, W - 0.15 * s]} />
        <meshStandardMaterial {...glossy} />
      </mesh>
      {/* Wheels */}
      {[
        [L / 2 - 0.7 * s, 0.25 * s, W / 2 - 0.02 * s],
        [L / 2 - 0.7 * s, 0.25 * s, -W / 2 + 0.02 * s],
        [-L / 2 + 0.7 * s, 0.25 * s, W / 2 - 0.02 * s],
        [-L / 2 + 0.7 * s, 0.25 * s, -W / 2 + 0.02 * s],
      ].map(([x, y, z], i) => (
        <mesh key={i} position={[x, y, z]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.28 * s, 0.28 * s, 0.18 * s, 12]} />
          <meshStandardMaterial color="#0a0a0a" roughness={0.95} />
        </mesh>
      ))}
      {paintable && (
        <>
          <Paintable
            surfaceId={`${id}-door-l`}
            width={L * 0.55}
            height={0.5 * s}
            position={[0, 0.45 * s, W / 2 + 0.002]}
            frameColor={null}
          />
          <Paintable
            surfaceId={`${id}-door-r`}
            width={L * 0.55}
            height={0.5 * s}
            position={[0, 0.45 * s, -(W / 2 + 0.002)]}
            rotation={[0, Math.PI, 0]}
            frameColor={null}
          />
        </>
      )}
    </group>
  );
}

// ── BuildDumpster — simple proc dumpster w/ paintable sides ──────────

const DUMP_W = 2.6;
const DUMP_D = 1.3;
const DUMP_H = 1.3;

export function BuildDumpster({
  id,
  position,
  rotationY = 0,
  paintable = true,
  scale = 1,
}: BuildPieceCommonProps): ReactNode {
  const s = scale;
  const W = DUMP_W * s;
  const D = DUMP_D * s;
  const H = DUMP_H * s;
  useStructure(id, position[0], position[2], W, D, H, { topMaterial: 'metal' });
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <mesh position={[0, H / 2, 0]}>
        <boxGeometry args={[W, H, D]} />
        <meshStandardMaterial color="#2e5a3e" roughness={0.85} />
      </mesh>
      <mesh position={[0, H + 0.04 * s, 0]}>
        <boxGeometry args={[W + 0.05 * s, 0.08 * s, D + 0.05 * s]} />
        <meshStandardMaterial color="#1f3d2b" roughness={0.9} />
      </mesh>
      {paintable && (
        <>
          <Paintable
            surfaceId={`${id}-front`}
            width={W * 0.92}
            height={H * 0.85}
            position={[0, H / 2 + 0.02 * s, D / 2 + 0.002]}
            frameColor={null}
          />
          <Paintable
            surfaceId={`${id}-back`}
            width={W * 0.92}
            height={H * 0.85}
            position={[0, H / 2 + 0.02 * s, -(D / 2 + 0.002)]}
            rotation={[0, Math.PI, 0]}
            frameColor={null}
          />
        </>
      )}
    </group>
  );
}

// ── BuildBodega — compact storefront with paintable shutter ──────────

const BODEGA_W = 6;
const BODEGA_D = 2.5;
const BODEGA_H = 4;

export function BuildBodega({
  id,
  position,
  rotationY = 0,
  paintable = true,
  scale = 1,
}: BuildPieceCommonProps): ReactNode {
  const s = scale;
  const W = BODEGA_W * s;
  const D = BODEGA_D * s;
  const H = BODEGA_H * s;
  useStructure(id, position[0], position[2], W, D, H, { topMaterial: 'stone' });
  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* Body */}
      <mesh position={[0, H / 2, 0]}>
        <boxGeometry args={[W, H, D]} />
        <meshStandardMaterial color="#5a4634" roughness={0.95} />
      </mesh>
      {/* Awning */}
      {[0, 1, 2, 3].map(i => (
        <mesh key={i} position={[-W / 2 + 0.75 * s + i * 1.5 * s, H * 0.65, D / 2 + 0.35 * s]}>
          <boxGeometry args={[1.45 * s, 0.15 * s, 0.7 * s]} />
          <meshStandardMaterial color={i % 2 === 0 ? '#c62828' : '#fafafa'} roughness={0.75} />
        </mesh>
      ))}
      {paintable && (
        <>
          <Paintable
            surfaceId={`${id}-shutter`}
            width={W - 0.7 * s}
            height={H * 0.5}
            position={[0, H * 0.3, D / 2 + 0.08 * s]}
            baseFill="#3e4a5a"
            frameColor={null}
          />
          <Paintable
            surfaceId={`${id}-side`}
            width={D * 0.9}
            height={H * 0.7}
            position={[W / 2 + 0.002, H * 0.38, 0]}
            rotation={[0, Math.PI / 2, 0]}
            baseFill="#4a3a2a"
            frameColor={null}
          />
        </>
      )}
    </group>
  );
}
