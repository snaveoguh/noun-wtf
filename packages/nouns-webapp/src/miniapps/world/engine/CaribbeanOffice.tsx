/**
 * CaribbeanOffice — Colorful wooden beach shack with "SERIOUS OFFICE" sign.
 * Interior: table with seats, whiteboard (graffiti wall).
 * Players can sit in seats (E key) and pan camera while seated.
 */
import { useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import { registerStructure, unregisterStructure } from './structures';

// Scale factor used throughout the world (tile-world = Three.js × 10).
const WORLD_SCALE = 0.1;

// ── Dimensions ──────────────────────────────────────────────────────
const SHACK_W = 5; // width (X)
const SHACK_D = 6; // depth (Z)
const SHACK_H = 3.2; // wall height
const ROOF_H = 1.5; // peak above walls
const DOOR_W = 1.2;
const DOOR_H = 2.2;

// ── Position (southeast coast) ──────────────────────────────────────
export const OFFICE_X = 62; // Three.js world X
export const OFFICE_Z = 62; // Three.js world Z
export const OFFICE_Y = 0.35; // ground level

// ── Seat positions (relative to office center, world coords) ────────
export const OFFICE_SEATS = [
  { x: OFFICE_X - 0.8, z: OFFICE_Z - 0.5, rotation: Math.PI / 2, label: 'Seat 1' },
  { x: OFFICE_X + 0.8, z: OFFICE_Z - 0.5, rotation: -Math.PI / 2, label: 'Seat 2' },
  { x: OFFICE_X - 0.8, z: OFFICE_Z + 0.5, rotation: Math.PI / 2, label: 'Seat 3' },
  { x: OFFICE_X + 0.8, z: OFFICE_Z + 0.5, rotation: -Math.PI / 2, label: 'Seat 4' },
];

// ── Graffiti wall (whiteboard on back wall) ─────────────────────────
export const OFFICE_WHITEBOARD_WALL = {
  id: 'wall-office-whiteboard' as const,
  worldX: OFFICE_X,
  worldZ: OFFICE_Z + SHACK_D / 2 - 0.3,
  rotation: Math.PI,
  label: 'WHITEBOARD',
};

// ── Colors (Caribbean palette) ──────────────────────────────────────
const WALL_COLORS = ['#E8A838', '#3CB4A0', '#E85D75', '#5B8DEF']; // gold, teal, coral, blue
const ROOF_COLOR = '#C74A3C'; // rusty red corrugated
const TRIM_COLOR = '#F5E6C8'; // cream trim
const FLOOR_COLOR = '#8B7355'; // dark wood
const PLANK_COLORS = ['#C6913A', '#B88430', '#D4A04A', '#A87828']; // wood plank variety

// ── Wooden plank texture helper ─────────────────────────────────────
function WoodPlanks({
  width,
  height,
  color,
  position,
  rotation,
}: {
  width: number;
  height: number;
  color: string;
  position: [number, number, number];
  rotation?: [number, number, number];
}) {
  const planks = useMemo(() => {
    const items: { y: number; h: number; color: string; gap: boolean }[] = [];
    let y = -height / 2;
    const plankH = 0.18;
    const gapH = 0.02;
    while (y < height / 2) {
      const isGap = Math.random() < 0.08;
      items.push({
        y: y + plankH / 2,
        h: plankH,
        color: PLANK_COLORS[Math.floor(Math.random() * PLANK_COLORS.length)],
        gap: isGap,
      });
      y += plankH + gapH;
    }
    return items;
  }, [height]);

  return (
    <group position={position} rotation={rotation ? rotation : undefined}>
      {/* Base color */}
      <mesh>
        <planeGeometry args={[width, height]} />
        <meshStandardMaterial color={color} roughness={0.9} side={THREE.DoubleSide} />
      </mesh>
      {/* Plank lines */}
      {planks.map((p, i) =>
        p.gap ? null : (
          <mesh key={i} position={[0, p.y, 0.005]}>
            <planeGeometry args={[width, 0.01]} />
            <meshBasicMaterial
              color="#00000022"
              transparent
              opacity={0.15}
              side={THREE.DoubleSide}
            />
          </mesh>
        ),
      )}
    </group>
  );
}

// ── Main Component ──────────────────────────────────────────────────

export default function CaribbeanOffice() {
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    const tileX = OFFICE_X / WORLD_SCALE;
    const tileY = OFFICE_Z / WORLD_SCALE;
    const tileW = SHACK_W / WORLD_SCALE;
    const tileH = SHACK_D / WORLD_SCALE;
    const tileTop = (SHACK_H + ROOF_H) / WORLD_SCALE;

    registerStructure(
      'office',
      { x: tileX, y: tileY, w: tileW, h: tileH },
      {
        topHeight: tileTop,
        topMaterial: 'wood',
      },
    );
    return () => unregisterStructure('office');
  }, []);

  return (
    <group ref={groupRef} position={[OFFICE_X, OFFICE_Y, OFFICE_Z]}>
      {/* ── Floor ── */}
      <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[SHACK_W, SHACK_D]} />
        <meshStandardMaterial color={FLOOR_COLOR} roughness={0.95} side={THREE.DoubleSide} />
      </mesh>

      {/* ── Walls (4 sides, with door opening in front) ── */}
      {/* Back wall (solid) */}
      <WoodPlanks
        width={SHACK_W}
        height={SHACK_H}
        color={WALL_COLORS[0]}
        position={[0, SHACK_H / 2, -SHACK_D / 2]}
      />
      {/* Left wall */}
      <WoodPlanks
        width={SHACK_D}
        height={SHACK_H}
        color={WALL_COLORS[1]}
        position={[-SHACK_W / 2, SHACK_H / 2, 0]}
        rotation={[0, Math.PI / 2, 0]}
      />
      {/* Right wall */}
      <WoodPlanks
        width={SHACK_D}
        height={SHACK_H}
        color={WALL_COLORS[2]}
        position={[SHACK_W / 2, SHACK_H / 2, 0]}
        rotation={[0, -Math.PI / 2, 0]}
      />
      {/* Front wall — two panels with door gap */}
      <WoodPlanks
        width={(SHACK_W - DOOR_W) / 2}
        height={SHACK_H}
        color={WALL_COLORS[3]}
        position={[-(SHACK_W / 2 - (SHACK_W - DOOR_W) / 4), SHACK_H / 2, SHACK_D / 2]}
        rotation={[0, Math.PI, 0]}
      />
      <WoodPlanks
        width={(SHACK_W - DOOR_W) / 2}
        height={SHACK_H}
        color={WALL_COLORS[3]}
        position={[SHACK_W / 2 - (SHACK_W - DOOR_W) / 4, SHACK_H / 2, SHACK_D / 2]}
        rotation={[0, Math.PI, 0]}
      />
      {/* Door header */}
      <mesh position={[0, DOOR_H + (SHACK_H - DOOR_H) / 2, SHACK_D / 2]}>
        <boxGeometry args={[DOOR_W + 0.1, SHACK_H - DOOR_H, 0.08]} />
        <meshStandardMaterial color={WALL_COLORS[3]} roughness={0.85} />
      </mesh>

      {/* ── Door frame (cream trim) ── */}
      <mesh position={[-DOOR_W / 2 - 0.04, DOOR_H / 2, SHACK_D / 2 + 0.02]}>
        <boxGeometry args={[0.08, DOOR_H, 0.08]} />
        <meshStandardMaterial color={TRIM_COLOR} roughness={0.7} />
      </mesh>
      <mesh position={[DOOR_W / 2 + 0.04, DOOR_H / 2, SHACK_D / 2 + 0.02]}>
        <boxGeometry args={[0.08, DOOR_H, 0.08]} />
        <meshStandardMaterial color={TRIM_COLOR} roughness={0.7} />
      </mesh>
      <mesh position={[0, DOOR_H + 0.04, SHACK_D / 2 + 0.02]}>
        <boxGeometry args={[DOOR_W + 0.16, 0.08, 0.08]} />
        <meshStandardMaterial color={TRIM_COLOR} roughness={0.7} />
      </mesh>

      {/* ── Roof (corrugated peak) ── */}
      <mesh position={[-SHACK_W / 4 - 0.3, SHACK_H + ROOF_H / 2, 0]} rotation={[0, 0, 0.45]}>
        <boxGeometry args={[SHACK_W / 2 + 1.2, 0.06, SHACK_D + 1]} />
        <meshStandardMaterial
          color={ROOF_COLOR}
          roughness={0.8}
          metalness={0.3}
          side={THREE.DoubleSide}
        />
      </mesh>
      <mesh position={[SHACK_W / 4 + 0.3, SHACK_H + ROOF_H / 2, 0]} rotation={[0, 0, -0.45]}>
        <boxGeometry args={[SHACK_W / 2 + 1.2, 0.06, SHACK_D + 1]} />
        <meshStandardMaterial
          color={ROOF_COLOR}
          roughness={0.8}
          metalness={0.3}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* ── SIGN: "SERIOUS OFFICE" ── */}
      <group position={[0, SHACK_H + 0.3, SHACK_D / 2 + 0.15]}>
        {/* Sign board */}
        <mesh>
          <boxGeometry args={[2.8, 0.6, 0.06]} />
          <meshStandardMaterial color="#1a1a2e" roughness={0.5} />
        </mesh>
        {/* Sign text — rendered as a canvas texture */}
        <mesh position={[0, 0, 0.035]}>
          <planeGeometry args={[2.6, 0.5]} />
          <SignTextMaterial text="SERIOUS OFFICE" />
        </mesh>
      </group>

      {/* ── Table (center of room) ── */}
      <group position={[0, 0, 0]}>
        {/* Table top */}
        <mesh position={[0, 0.75, 0]}>
          <boxGeometry args={[2.2, 0.08, 1.2]} />
          <meshStandardMaterial color="#A0785A" roughness={0.85} />
        </mesh>
        {/* Table legs */}
        {[
          [-0.9, -0.5],
          [-0.9, 0.5],
          [0.9, -0.5],
          [0.9, 0.5],
        ].map(([lx, lz], i) => (
          <mesh key={i} position={[lx, 0.36, lz]}>
            <boxGeometry args={[0.08, 0.72, 0.08]} />
            <meshStandardMaterial color="#6B4A30" roughness={0.9} />
          </mesh>
        ))}
      </group>

      {/* ── Chairs (4 seats around table) ── */}
      {[
        { x: -1.4, z: 0, ry: Math.PI / 2 },
        { x: 1.4, z: 0, ry: -Math.PI / 2 },
        { x: 0, z: -0.9, ry: 0 },
        { x: 0, z: 0.9, ry: Math.PI },
      ].map((chair, i) => (
        <group key={i} position={[chair.x, 0, chair.z]} rotation={[0, chair.ry, 0]}>
          {/* Seat */}
          <mesh position={[0, 0.45, 0]}>
            <boxGeometry args={[0.5, 0.06, 0.5]} />
            <meshStandardMaterial color={WALL_COLORS[i]} roughness={0.8} />
          </mesh>
          {/* Back rest */}
          <mesh position={[0, 0.75, -0.22]}>
            <boxGeometry args={[0.5, 0.55, 0.06]} />
            <meshStandardMaterial color={WALL_COLORS[i]} roughness={0.8} />
          </mesh>
          {/* Legs */}
          {[
            [-0.2, -0.2],
            [-0.2, 0.2],
            [0.2, -0.2],
            [0.2, 0.2],
          ].map(([lx, lz], j) => (
            <mesh key={j} position={[lx, 0.22, lz]}>
              <cylinderGeometry args={[0.03, 0.03, 0.44, 6]} />
              <meshStandardMaterial color="#5C4033" roughness={0.9} />
            </mesh>
          ))}
        </group>
      ))}

      {/* ── Whiteboard (on back wall interior) ── */}
      <group position={[0, 1.8, -SHACK_D / 2 + 0.08]}>
        {/* Board frame */}
        <mesh>
          <boxGeometry args={[2.5, 1.5, 0.06]} />
          <meshStandardMaterial color="#333" roughness={0.5} />
        </mesh>
        {/* White surface */}
        <mesh position={[0, 0, 0.035]}>
          <planeGeometry args={[2.3, 1.35]} />
          <meshStandardMaterial color="#f8f8f8" roughness={0.3} />
        </mesh>
        {/* "WHITEBOARD" label */}
        <mesh position={[0, -0.85, 0.04]}>
          <planeGeometry args={[1.2, 0.15]} />
          <SignTextMaterial text="WHITEBOARD" fontSize={14} bgColor="#333" />
        </mesh>
      </group>

      {/* ── Window shutters (left + right walls) ── */}
      {[-1, 1].map(side => (
        <group key={side} position={[side * (SHACK_W / 2 + 0.02), SHACK_H * 0.55, 0.5]}>
          <mesh rotation={[0, Math.PI / 2, 0]}>
            <planeGeometry args={[0.8, 0.6]} />
            <meshStandardMaterial color="#2a1a0e" roughness={0.9} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}

      {/* ── Interior light ── */}
      <pointLight position={[0, SHACK_H - 0.3, 0]} color="#ffe4b5" intensity={2} distance={8} />

      {/* ── Ground shadow ── */}
      <mesh position={[0, 0.005, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[SHACK_W + 1, SHACK_D + 1]} />
        <meshBasicMaterial color="#000" transparent opacity={0.12} side={THREE.DoubleSide} />
      </mesh>

      {/* ── Potted plants by door ── */}
      {[-0.9, 0.9].map((px, i) => (
        <group key={i} position={[px, 0, SHACK_D / 2 + 0.5]}>
          <mesh position={[0, 0.2, 0]}>
            <cylinderGeometry args={[0.15, 0.12, 0.35, 8]} />
            <meshStandardMaterial color="#8B4513" roughness={0.9} />
          </mesh>
          <mesh position={[0, 0.5, 0]}>
            <sphereGeometry args={[0.25, 8, 8]} />
            <meshStandardMaterial color="#228B22" roughness={0.8} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

// ── Sign text as canvas texture ─────────────────────────────────────

function SignTextMaterial({
  text,
  fontSize = 24,
  bgColor = '#1a1a2e',
}: {
  text: string;
  fontSize?: number;
  bgColor?: string;
}) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, 512, 128);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold ${fontSize}px "Londrina Solid", "PT Root UI", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 64);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }, [text, fontSize, bgColor]);

  return <meshBasicMaterial map={texture} />;
}
