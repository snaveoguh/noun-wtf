// ── NYCApartmentBlock — Gritty NYC Brick Apartment Building ──────────
//
// A tall procedural building placed adjacent to the mega ramp wall:
//   - Red brick facade with depth texture and missing bricks
//   - Zigzagging fire escapes with railings
//   - Windows (some glowing) in a 3x5 grid
//   - Rooftop water tower and antenna
//   - Ground-level door with awning
//   - Dark stain patches for grit

import { useEffect, useRef, useMemo } from 'react';
import * as THREE from 'three';
import { registerStructure, unregisterStructure } from './structures';

// ── Dimensions ──────────────────────────────────────────────────────

const BUILDING_W = 4;
const BUILDING_H = 14; // taller than the ramp (12) so stairs reach top
const BUILDING_D = 3;

// Position: right next to the mega ramp's east wall
// MegaRamp is at RAMP_X=80, RAMP_Z=51.2, width=8
// Side wall is at RAMP_X + RAMP_WIDTH/2 + 0.2 = 84.2
// Place building just outside that wall
const TILE_SIZE = 16;
const WORLD_SCALE = 0.1;
const RAMP_X = 50 * TILE_SIZE * WORLD_SCALE; // 80
const RAMP_Z = 32 * TILE_SIZE * WORLD_SCALE; // 51.2

export const APARTMENT_X = RAMP_X + 4 + BUILDING_W / 2 + 0.4; // ~85.9
export const APARTMENT_Z = RAMP_Z;
export const APARTMENT_Y = 0;

// ── Seeded random for deterministic brick layout ────────────────────

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// ── Brick Detail Layer ──────────────────────────────────────────────

function BrickDetails({ face, seed }: { face: 'front' | 'back' | 'left' | 'right'; seed: number }) {
  const bricks = useMemo(() => {
    const rng = seededRandom(seed);
    const result: Array<{
      pos: [number, number, number];
      size: [number, number, number];
      color: string;
    }> = [];

    // Determine the surface dimensions and offset based on face
    let surfaceW: number, surfaceH: number;
    let transform: (x: number, y: number) => [number, number, number];

    switch (face) {
      case 'front':
        surfaceW = BUILDING_W;
        surfaceH = BUILDING_H;
        transform = (x, y) => [x - BUILDING_W / 2, y - BUILDING_H / 2, BUILDING_D / 2 + 0.01];
        break;
      case 'back':
        surfaceW = BUILDING_W;
        surfaceH = BUILDING_H;
        transform = (x, y) => [x - BUILDING_W / 2, y - BUILDING_H / 2, -BUILDING_D / 2 - 0.01];
        break;
      case 'left':
        surfaceW = BUILDING_D;
        surfaceH = BUILDING_H;
        transform = (x, y) => [-BUILDING_W / 2 - 0.01, y - BUILDING_H / 2, x - BUILDING_D / 2];
        break;
      case 'right':
        surfaceW = BUILDING_D;
        surfaceH = BUILDING_H;
        transform = (x, y) => [BUILDING_W / 2 + 0.01, y - BUILDING_H / 2, x - BUILDING_D / 2];
        break;
    }

    // Scatter individual brick bumps
    const brickW = 0.18;
    const brickH = 0.08;
    const cols = Math.floor(surfaceW / (brickW + 0.02));
    const rows = Math.floor(surfaceH / (brickH + 0.02));

    for (let r = 0; r < rows; r++) {
      const rowOffset = r % 2 === 0 ? 0 : brickW / 2;
      for (let c = 0; c < cols; c++) {
        // ~15% chance to skip (missing brick / gap)
        if (rng() < 0.15) continue;

        const x = c * (brickW + 0.02) + rowOffset + rng() * 0.01;
        const y = r * (brickH + 0.02) + rng() * 0.005;

        if (x > surfaceW - brickW / 2 || x < brickW / 2) continue;

        const shade = rng() < 0.3 ? '#6B2A2A' : rng() < 0.5 ? '#7A3232' : '#8B3A3A';
        result.push({
          pos: transform(x, y),
          size: [brickW, brickH, 0.02],
          color: shade,
        });
      }
    }

    return result;
  }, [face, seed]);

  return (
    <group>
      {bricks.map((b, i) => (
        <mesh key={i} position={b.pos}>
          <boxGeometry args={b.size} />
          <meshStandardMaterial color={b.color} roughness={0.95} />
        </mesh>
      ))}
    </group>
  );
}

// ── Fire Escapes ────────────────────────────────────────────────────

function FireEscapes() {
  // Zigzag platforms up the front face
  const platforms = useMemo(() => {
    const arr: Array<{ x: number; y: number; stairsDir: number }> = [];
    for (let i = 0; i < 5; i++) {
      const xOff = i % 2 === 0 ? -0.5 : 0.5;
      arr.push({ x: xOff, y: 1.2 + i * 1.3, stairsDir: i % 2 === 0 ? 1 : -1 });
    }
    return arr;
  }, []);

  return (
    <group position={[0, 0, BUILDING_D / 2 + 0.15]}>
      {platforms.map((p, i) => (
        <group key={i} position={[p.x, p.y - BUILDING_H / 2, 0]}>
          {/* Platform */}
          <mesh>
            <boxGeometry args={[1.0, 0.03, 0.5]} />
            <meshStandardMaterial color="#222222" metalness={0.7} roughness={0.4} />
          </mesh>
          {/* Railing - front */}
          <mesh position={[0, 0.2, 0.24]}>
            <cylinderGeometry args={[0.015, 0.015, 1.0, 6]} />
            <meshStandardMaterial color="#333333" metalness={0.8} roughness={0.3} />
          </mesh>
          {/* Railing - sides */}
          {[-0.49, 0.49].map(rx => (
            <mesh key={rx} position={[rx, 0.2, 0.12]} rotation={[Math.PI / 2, 0, 0]}>
              <cylinderGeometry args={[0.015, 0.015, 0.5, 6]} />
              <meshStandardMaterial color="#333333" metalness={0.8} roughness={0.3} />
            </mesh>
          ))}
          {/* Railing vertical posts */}
          {[-0.49, 0, 0.49].map(rx => (
            <mesh key={`post-${rx}`} position={[rx, 0.1, 0.24]}>
              <cylinderGeometry args={[0.012, 0.012, 0.2, 6]} />
              <meshStandardMaterial color="#333333" metalness={0.8} roughness={0.3} />
            </mesh>
          ))}
          {/* Stairs connecting to next level */}
          {i < 4 && (
            <mesh position={[p.stairsDir * 0.6, 0.65, 0]} rotation={[0, 0, p.stairsDir * -0.8]}>
              <boxGeometry args={[0.15, 1.3, 0.35]} />
              <meshStandardMaterial color="#1a1a1a" metalness={0.6} roughness={0.5} />
            </mesh>
          )}
        </group>
      ))}
    </group>
  );
}

// ── External Metal Stairs (ramp-facing side) ───────────────────────
// Classic NYC metal staircase: diagonal runs with landings, walkable to rooftop

function ExternalStairs() {
  const metalMat = <meshStandardMaterial color="#2a2a2a" metalness={0.8} roughness={0.3} />;
  const flights: Array<{ landingY: number; dir: number }> = [];
  const flightCount = 10; // enough flights to reach the top of the building
  const flightHeight = BUILDING_H / flightCount;

  for (let i = 0; i < flightCount; i++) {
    flights.push({
      landingY: (i + 1) * flightHeight - BUILDING_H / 2,
      dir: i % 2 === 0 ? 1 : -1, // alternate direction
    });
  }

  return (
    <group position={[-BUILDING_W / 2 - 0.6, 0, 0]}>
      {flights.map((f, i) => {
        const prevY = i === 0 ? -BUILDING_H / 2 : flights[i - 1].landingY;
        const runLength = Math.sqrt(1.2 * 1.2 + flightHeight * flightHeight);
        const angle = Math.atan2(flightHeight, 1.2);
        return (
          <group key={i}>
            {/* Landing platform */}
            <mesh position={[f.dir * 0.3, f.landingY, 0]}>
              <boxGeometry args={[1.4, 0.05, 0.8]} />
              {metalMat}
            </mesh>
            {/* Railing on landing */}
            <mesh position={[f.dir * 0.3, f.landingY + 0.35, 0.38]}>
              <boxGeometry args={[1.4, 0.03, 0.03]} />
              {metalMat}
            </mesh>
            {/* Vertical posts on landing */}
            {[-0.65, 0, 0.65].map(xo => (
              <mesh key={xo} position={[f.dir * 0.3 + xo, f.landingY + 0.18, 0.38]}>
                <cylinderGeometry args={[0.015, 0.015, 0.35, 6]} />
                {metalMat}
              </mesh>
            ))}
            {/* Diagonal stair run — a flat angled box */}
            <mesh
              position={[f.dir * -0.3, (prevY + f.landingY) / 2, 0]}
              rotation={[0, 0, f.dir * angle]}
            >
              <boxGeometry args={[runLength, 0.04, 0.6]} />
              {metalMat}
            </mesh>
            {/* Stair treads on the run */}
            {Array.from({ length: 5 }).map((_, si) => {
              const t = (si + 0.5) / 5;
              const sx = f.dir * (-0.9 + t * 1.2);
              const sy = prevY + t * flightHeight;
              return (
                <mesh key={si} position={[sx, sy, 0]}>
                  <boxGeometry args={[0.25, 0.03, 0.6]} />
                  {metalMat}
                </mesh>
              );
            })}
          </group>
        );
      })}
    </group>
  );
}

// ── Windows ─────────────────────────────────────────────────────────

function Windows() {
  const rng = seededRandom(42);
  const windows = useMemo(() => {
    const arr: Array<{
      x: number;
      y: number;
      glowing: boolean;
      glowColor: string;
    }> = [];
    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 3; col++) {
        const x = (col - 1) * 0.8;
        const y = 1.0 + row * 1.3 - BUILDING_H / 2;
        const isGlowing = rng() < 0.35;
        arr.push({
          x,
          y,
          glowing: isGlowing,
          glowColor: rng() < 0.5 ? '#ffd68a' : '#ffe4b5',
        });
      }
    }
    return arr;
  }, []);

  return (
    <group position={[0, 0, BUILDING_D / 2 - 0.02]}>
      {windows.map((w, i) => (
        <group key={i} position={[w.x, w.y, 0]}>
          {/* Window recess */}
          <mesh position={[0, 0, -0.03]}>
            <boxGeometry args={[0.35, 0.5, 0.06]} />
            <meshStandardMaterial color="#1a1a2e" roughness={0.3} metalness={0.1} />
          </mesh>
          {/* Window frame */}
          <mesh position={[0, 0, 0.01]}>
            <boxGeometry args={[0.38, 0.53, 0.01]} />
            <meshStandardMaterial color="#4a4a4a" roughness={0.7} />
          </mesh>
          {/* Warm glow for lit windows */}
          {w.glowing && (
            <>
              <mesh position={[0, 0, -0.01]}>
                <planeGeometry args={[0.32, 0.47]} />
                <meshBasicMaterial color={w.glowColor} transparent opacity={0.4} />
              </mesh>
              <pointLight
                position={[0, 0, 0.15]}
                color={w.glowColor}
                intensity={0.3}
                distance={1.2}
              />
            </>
          )}
        </group>
      ))}
    </group>
  );
}

// ── Water Tower ─────────────────────────────────────────────────────

function WaterTower() {
  return (
    <group position={[0.6, BUILDING_H / 2, -0.3]}>
      {/* Legs */}
      {[
        [-0.2, -0.2],
        [0.2, -0.2],
        [-0.2, 0.2],
        [0.2, 0.2],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.3, z]}>
          <cylinderGeometry args={[0.03, 0.03, 0.6, 6]} />
          <meshStandardMaterial color="#5a4a3a" roughness={0.9} />
        </mesh>
      ))}
      {/* Tank (cylinder) */}
      <mesh position={[0, 0.85, 0]}>
        <cylinderGeometry args={[0.3, 0.3, 0.6, 12]} />
        <meshStandardMaterial color="#6b5b4b" roughness={0.85} />
      </mesh>
      {/* Cone roof */}
      <mesh position={[0, 1.25, 0]}>
        <coneGeometry args={[0.33, 0.25, 12]} />
        <meshStandardMaterial color="#5a4a3a" roughness={0.9} />
      </mesh>
      {/* Metal bands */}
      {[0.65, 0.85, 1.05].map((y, i) => (
        <mesh key={i} position={[0, y, 0]}>
          <torusGeometry args={[0.31, 0.015, 6, 20]} />
          <meshStandardMaterial color="#444" metalness={0.7} roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

// ── Antenna ─────────────────────────────────────────────────────────

function Antenna() {
  return (
    <group position={[-0.8, BUILDING_H / 2, 0.4]}>
      {/* Main pole */}
      <mesh position={[0, 0.8, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 1.6, 6]} />
        <meshStandardMaterial color="#888" metalness={0.8} roughness={0.3} />
      </mesh>
      {/* Cross bars */}
      {[0.4, 0.8, 1.2].map((y, i) => (
        <mesh key={i} position={[0, y, 0]} rotation={[0, (i * Math.PI) / 3, 0]}>
          <boxGeometry args={[0.4, 0.015, 0.015]} />
          <meshStandardMaterial color="#777" metalness={0.7} roughness={0.4} />
        </mesh>
      ))}
      {/* Red tip light */}
      <mesh position={[0, 1.6, 0]}>
        <sphereGeometry args={[0.03, 8, 8]} />
        <meshStandardMaterial color="#ff2222" emissive="#ff2222" emissiveIntensity={2} />
      </mesh>
      <pointLight position={[0, 1.6, 0]} color="#ff2222" intensity={0.5} distance={2} />
    </group>
  );
}

// ── Door ────────────────────────────────────────────────────────────

function GroundDoor() {
  return (
    <group position={[0, -BUILDING_H / 2 + 0.55, BUILDING_D / 2 + 0.01]}>
      {/* Door */}
      <mesh>
        <boxGeometry args={[0.5, 0.9, 0.03]} />
        <meshStandardMaterial color="#3a2a1a" roughness={0.9} />
      </mesh>
      {/* Doorknob */}
      <mesh position={[0.18, 0, 0.03]}>
        <sphereGeometry args={[0.025, 8, 8]} />
        <meshStandardMaterial color="#b8860b" metalness={0.8} roughness={0.3} />
      </mesh>
      {/* Awning */}
      <mesh position={[0, 0.55, 0.2]} rotation={[0.3, 0, 0]}>
        <boxGeometry args={[0.7, 0.03, 0.4]} />
        <meshStandardMaterial color="#2a5a2a" roughness={0.8} />
      </mesh>
      {/* Awning supports */}
      {[-0.3, 0.3].map(x => (
        <mesh key={x} position={[x, 0.4, 0.15]} rotation={[0.6, 0, 0]}>
          <cylinderGeometry args={[0.01, 0.01, 0.35, 6]} />
          <meshStandardMaterial color="#333" metalness={0.7} roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

// ── Stain Patches ───────────────────────────────────────────────────

function StainPatches() {
  const stains = useMemo(() => {
    const rng = seededRandom(77);
    const arr: Array<{ pos: [number, number, number]; size: [number, number] }> = [];
    for (let i = 0; i < 8; i++) {
      const face = Math.floor(rng() * 4);
      let pos: [number, number, number];
      const sw = 0.3 + rng() * 0.5;
      const sh = 0.2 + rng() * 0.4;
      const fy = (rng() - 0.5) * BUILDING_H * 0.8;

      switch (face) {
        case 0: // front
          pos = [(rng() - 0.5) * BUILDING_W * 0.7, fy, BUILDING_D / 2 + 0.02];
          break;
        case 1: // back
          pos = [(rng() - 0.5) * BUILDING_W * 0.7, fy, -BUILDING_D / 2 - 0.02];
          break;
        case 2: // left
          pos = [-BUILDING_W / 2 - 0.02, fy, (rng() - 0.5) * BUILDING_D * 0.7];
          break;
        default: // right
          pos = [BUILDING_W / 2 + 0.02, fy, (rng() - 0.5) * BUILDING_D * 0.7];
          break;
      }
      arr.push({ pos, size: [sw, sh] });
    }
    return arr;
  }, []);

  return (
    <group>
      {stains.map((s, i) => (
        <mesh key={i} position={s.pos}>
          <planeGeometry args={s.size} />
          <meshStandardMaterial
            color="#3a2020"
            transparent
            opacity={0.3}
            roughness={1}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}

// ── For Sale Sign ───────────────────────────────────────────────────

function ForSaleSign({ position }: { position: [number, number, number] }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#cc0000';
    ctx.font = 'bold 36px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('FOR SALE', 128, 45);
    ctx.fillStyle = '#333';
    ctx.font = 'bold 16px monospace';
    ctx.fillText('sewerpipe.eth', 128, 90);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
  }, []);

  return (
    <mesh position={position}>
      <planeGeometry args={[0.6, 0.3]} />
      <meshBasicMaterial map={texture} side={THREE.DoubleSide} />
    </mesh>
  );
}

// ── Main Component ──────────────────────────────────────────────────

export function NYCApartmentBlock() {
  const groupRef = useRef<THREE.Group>(null);

  useEffect(() => {
    // Convert Three.js units → tile-world (÷ WORLD_SCALE = ×10).
    const tileX = APARTMENT_X / WORLD_SCALE;
    const tileY = APARTMENT_Z / WORLD_SCALE;
    const tileW = BUILDING_W / WORLD_SCALE;
    const tileH = BUILDING_D / WORLD_SCALE;
    const tileTop = BUILDING_H / WORLD_SCALE;

    registerStructure(
      'apt-1',
      { x: tileX, y: tileY, w: tileW, h: tileH },
      {
        topHeight: tileTop,
        topMaterial: 'stone',
        climbFaces: [
          // Fire escape runs the full west face (ramp-side), ground to roof
          { id: 'fire-escape', side: 'west', startZ: 0, endZ: tileTop, material: 'metal' },
        ],
      },
    );
    return () => unregisterStructure('apt-1');
  }, []);

  return (
    <group ref={groupRef} position={[APARTMENT_X, BUILDING_H / 2, APARTMENT_Z]}>
      {/* Main building body */}
      <mesh>
        <boxGeometry args={[BUILDING_W, BUILDING_H, BUILDING_D]} />
        <meshBasicMaterial color="#9B4A4A" />
      </mesh>

      {/* Darker depth layer — slightly smaller, offset for shadow depth */}
      <mesh position={[0, 0, 0.02]}>
        <boxGeometry args={[BUILDING_W - 0.04, BUILDING_H - 0.04, BUILDING_D - 0.04]} />
        <meshBasicMaterial color="#7B3A3A" />
      </mesh>

      {/* Brick details on each face */}
      <BrickDetails face="front" seed={101} />
      <BrickDetails face="back" seed={202} />
      <BrickDetails face="left" seed={303} />
      <BrickDetails face="right" seed={404} />

      {/* Fire escapes (front face) */}
      <FireEscapes />

      {/* External metal stairs (ramp-facing side) — walkable to roof/ramp top */}
      <ExternalStairs />

      {/* External stairs (island side) — mirrored */}
      <group scale={[-1, 1, 1]}>
        <ExternalStairs />
      </group>

      {/* Windows (front face) */}
      <Windows />

      {/* Rooftop features */}
      <WaterTower />
      <Antenna />

      {/* Ground-level door */}
      <GroundDoor />

      {/* FOR SALE sign in 2nd floor window */}
      <ForSaleSign position={[-0.8, -BUILDING_H / 2 + 4.5, BUILDING_D / 2 + 0.06]} />

      {/* Gritty stain patches */}
      <StainPatches />

      {/* Rooftop edge/parapet */}
      <mesh position={[0, BUILDING_H / 2 + 0.08, 0]}>
        <boxGeometry args={[BUILDING_W + 0.1, 0.15, BUILDING_D + 0.1]} />
        <meshStandardMaterial color="#5a2a2a" roughness={0.9} />
      </mesh>
    </group>
  );
}

// ── Burj Khalifa Skyscraper — so tall it disappears into the clouds ──

const TOWER_HEIGHT = 120; // absurdly tall
const TOWER_X = APARTMENT_X + 8;
const TOWER_Z = APARTMENT_Z - 5;

export function BurjKhalifa() {
  return (
    <group position={[TOWER_X, 0, TOWER_Z]}>
      {/* Base — wide foundation */}
      <mesh position={[0, 2, 0]}>
        <boxGeometry args={[4, 4, 4]} />
        <meshBasicMaterial color="#c0c8d0" />
      </mesh>
      {/* Lower section — wide */}
      <mesh position={[0, 15, 0]}>
        <boxGeometry args={[3, 22, 3]} />
        <meshBasicMaterial color="#b8c4d0" />
      </mesh>
      {/* Mid section — tapers */}
      <mesh position={[0, 35, 0]}>
        <boxGeometry args={[2.2, 18, 2.2]} />
        <meshBasicMaterial color="#aab8c8" />
      </mesh>
      {/* Upper section — narrower */}
      <mesh position={[0, 52, 0]}>
        <boxGeometry args={[1.6, 16, 1.6]} />
        <meshBasicMaterial color="#9cb0c0" />
      </mesh>
      {/* Spire section */}
      <mesh position={[0, 68, 0]}>
        <boxGeometry args={[1.0, 16, 1.0]} />
        <meshBasicMaterial color="#90a8b8" />
      </mesh>
      {/* Needle spire */}
      <mesh position={[0, 85, 0]}>
        <coneGeometry args={[0.4, 30, 8]} />
        <meshBasicMaterial color="#88a0b0" />
      </mesh>
      {/* Antenna tip */}
      <mesh position={[0, TOWER_HEIGHT, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 20, 6]} />
        <meshBasicMaterial color="#708090" />
      </mesh>
      {/* Window strips — horizontal lines across the tower */}
      {Array.from({ length: 25 }).map((_, i) => (
        <mesh key={i} position={[0, 5 + i * 3, 1.55]} scale={[1, 1, 1]}>
          <boxGeometry args={[2.8 - i * 0.08, 0.15, 0.02]} />
          <meshBasicMaterial color="#4a6070" />
        </mesh>
      ))}
      {/* Red blinking light at very top */}
      <pointLight
        position={[0, TOWER_HEIGHT + 10, 0]}
        color="#ff0000"
        intensity={2}
        distance={20}
      />
      {/* Cloud fog around upper half — semi-transparent white boxes */}
      {Array.from({ length: 8 }).map((_, i) => (
        <mesh
          key={`fog-${i}`}
          position={[Math.sin(i * 1.3) * 3, 60 + i * 6, Math.cos(i * 1.7) * 3]}
        >
          <sphereGeometry args={[2 + Math.random() * 2, 8, 8]} />
          <meshBasicMaterial color="#ffffff" transparent opacity={0.15} />
        </mesh>
      ))}
    </group>
  );
}

// ── Graffiti wall position (the face facing the ramp) ───────────────
// The left face of the building (-X side) faces the ramp wall

export const APARTMENT_GRAFFITI_WALL = {
  id: 'wall-apartment' as const,
  // The wall center in world coords (left face of building)
  worldX: APARTMENT_X - BUILDING_W / 2,
  worldZ: APARTMENT_Z,
  rotation: -Math.PI / 2, // facing toward the ramp (negative X direction)
  label: 'TAG THIS WALL',
};
