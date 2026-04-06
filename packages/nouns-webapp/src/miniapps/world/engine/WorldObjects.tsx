// ── World Objects — Billboards, WinnieVan, MechanicSign ─────────────
//
// Decorative world props: roadside billboards, a rusty 1975 Winnebago,
// and a weathered mechanic sign. Pure R3F, no external models.

import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// ── Canvas texture helper ──────────────────────────────────────────────

function createTextTexture(
  text: string,
  width = 512,
  height = 256,
  opts: {
    font?: string;
    color?: string;
    bg?: string;
    lineHeight?: number;
  } = {},
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Background
  ctx.fillStyle = opts.bg ?? '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Text
  ctx.fillStyle = opts.color ?? '#111111';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fontSize = Math.floor(height * 0.28);
  ctx.font = `bold ${fontSize}px ${opts.font ?? 'monospace'}`;

  // Word-wrap into lines
  const words = text.split(' ');
  const lines: string[] = [];
  let current = '';
  for (const w of words) {
    const test = current ? `${current} ${w}` : w;
    if (ctx.measureText(test).width > width * 0.85) {
      if (current) lines.push(current);
      current = w;
    } else {
      current = test;
    }
  }
  if (current) lines.push(current);

  const lh = opts.lineHeight ?? fontSize * 1.3;
  const startY = height / 2 - ((lines.length - 1) * lh) / 2;
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], width / 2, startY + i * lh);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// ── Billboard ──────────────────────────────────────────────────────────

interface BillboardProps {
  position: [number, number, number];
  text: string;
  url?: string;
  rotation?: number; // Y-axis rotation in radians
}

export function Billboard({
  position,
  text,
  url,
  rotation = 0,
}: BillboardProps) {
  const groupRef = useRef<THREE.Group>(null);
  const boardRef = useRef<THREE.Mesh>(null);

  const texture = useMemo(
    () =>
      createTextTexture(text, 512, 256, {
        bg: '#f5f5f0',
        color: '#222222',
        font: 'monospace',
      }),
    [text],
  );

  // Dispose texture on unmount
  useEffect(() => () => texture.dispose(), [texture]);

  // Post dimensions
  const postHeight = 2.2;
  const postRadius = 0.04;
  const boardWidth = 1.2;
  const boardHeight = 0.6;

  // Slight lean for character
  const tiltX = 0.03;
  const tiltZ = 0.02;

  return (
    <group
      ref={groupRef}
      position={position}
      rotation={[tiltX, rotation, tiltZ]}
      onClick={() => {
        if (url) window.open(url, '_blank', 'noopener');
      }}
    >
      {/* Wooden post */}
      <mesh position={[0, postHeight / 2, 0]}>
        <cylinderGeometry args={[postRadius, postRadius * 1.2, postHeight, 8]} />
        <meshStandardMaterial color="#8B4513" roughness={0.85} />
      </mesh>

      {/* Board backing (slightly thicker than the face) */}
      <mesh position={[0, postHeight + boardHeight / 2 + 0.05, 0]}>
        <boxGeometry args={[boardWidth + 0.06, boardHeight + 0.06, 0.06]} />
        <meshStandardMaterial color="#8B4513" roughness={0.8} />
      </mesh>

      {/* Board face with text */}
      <mesh
        ref={boardRef}
        position={[0, postHeight + boardHeight / 2 + 0.05, 0.035]}
      >
        <planeGeometry args={[boardWidth, boardHeight]} />
        <meshStandardMaterial map={texture} roughness={0.5} />
      </mesh>

      {/* Shadow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[0.2, 8]} />
        <meshBasicMaterial color="#000" transparent opacity={0.15} />
      </mesh>
    </group>
  );
}

// ── Default billboard set (convenience) ─────────────────────────────

Billboard.defaults = [
  { text: 'probe.wtf', url: 'https://probe.wtf' },
  { text: 'YOUR AD HERE \u2310\u25E7-\u25E7', url: undefined },
  { text: 'pooter.world', url: 'https://pooter.world' },
];

// ── WinnieVan ──────────────────────────────────────────────────────────

interface WinnieVanProps {
  position: [number, number, number];
  rotation?: number;
}

export function WinnieVan({ position, rotation = 0 }: WinnieVanProps) {
  const groupRef = useRef<THREE.Group>(null);

  // Subtle idle suspension bounce
  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.elapsedTime;
    // Two frequencies for a more organic bounce
    const bounce =
      Math.sin(t * 1.1) * 0.008 + Math.sin(t * 2.3 + 0.7) * 0.004;
    groupRef.current.position.y = position[1] + bounce;
  });

  // Rust patches — random darker spots baked once
  const rustPatches = useMemo(() => {
    const patches: { pos: [number, number, number]; scale: [number, number, number]; color: string }[] = [];
    const rng = (seed: number) => {
      let s = seed;
      return () => {
        s = (s * 16807) % 2147483647;
        return s / 2147483647;
      };
    };
    const rand = rng(42);
    for (let i = 0; i < 8; i++) {
      const side = rand() > 0.5 ? 1 : -1;
      patches.push({
        pos: [
          side * (0.51 + rand() * 0.01),
          0.3 + rand() * 0.5,
          -0.6 + rand() * 1.2,
        ],
        scale: [0.01, 0.1 + rand() * 0.15, 0.1 + rand() * 0.2],
        color: rand() > 0.5 ? '#5a3a0a' : '#3d2b0f',
      });
    }
    return patches;
  }, []);

  // Body dimensions
  const bodyW = 1.0; // width
  const bodyH = 0.9; // height
  const bodyL = 2.4; // length
  const wheelR = 0.18;
  const wheelW = 0.1;

  return (
    <group ref={groupRef} position={position} rotation={[0, rotation, 0]}>
      {/* ── Main body ─────────────────────────────────────── */}
      <mesh position={[0, bodyH / 2 + wheelR * 0.7, 0]}>
        <boxGeometry args={[bodyW, bodyH, bodyL]} />
        <meshStandardMaterial color="#8B6914" roughness={0.9} />
      </mesh>

      {/* Faded paint stripe (side panels) */}
      {[-1, 1].map((side) => (
        <mesh
          key={`stripe-${side}`}
          position={[side * (bodyW / 2 + 0.005), bodyH / 2 + wheelR * 0.7 + 0.1, 0]}
          rotation={[0, side === 1 ? 0 : Math.PI, 0]}
        >
          <planeGeometry args={[bodyL, bodyH * 0.35]} />
          <meshStandardMaterial
            color="#554433"
            roughness={0.95}
            transparent
            opacity={0.6}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}

      {/* ── Cab / rounded front ───────────────────────────── */}
      <mesh position={[0, bodyH / 2 + wheelR * 0.7, bodyL / 2 + 0.25]}>
        <boxGeometry args={[bodyW * 0.95, bodyH * 0.85, 0.5]} />
        <meshStandardMaterial color="#666666" roughness={0.85} />
      </mesh>

      {/* Windshield */}
      <mesh position={[0, bodyH * 0.55 + wheelR * 0.7, bodyL / 2 + 0.51]}>
        <planeGeometry args={[bodyW * 0.75, bodyH * 0.4]} />
        <meshStandardMaterial
          color="#1a2a4a"
          transparent
          opacity={0.7}
          roughness={0.1}
          metalness={0.3}
        />
      </mesh>

      {/* Side windows */}
      {[-1, 1].map((side) =>
        [0.3, -0.2, -0.7].map((zOff, i) => (
          <mesh
            key={`win-${side}-${i}`}
            position={[
              side * (bodyW / 2 + 0.005),
              bodyH * 0.55 + wheelR * 0.7,
              zOff,
            ]}
            rotation={[0, Math.PI / 2, 0]}
          >
            <planeGeometry args={[0.35, 0.3]} />
            <meshStandardMaterial
              color="#1a2a4a"
              transparent
              opacity={0.6}
              side={THREE.DoubleSide}
              roughness={0.1}
            />
          </mesh>
        )),
      )}

      {/* ── Roof rack ─────────────────────────────────────── */}
      <mesh position={[0, bodyH + wheelR * 0.7 + 0.06, -0.2]}>
        <boxGeometry args={[bodyW * 0.8, 0.04, bodyL * 0.6]} />
        <meshStandardMaterial color="#444444" roughness={0.7} metalness={0.4} />
      </mesh>
      {/* Rack rails */}
      {[-1, 1].map((side) => (
        <mesh
          key={`rail-${side}`}
          position={[side * (bodyW * 0.38), bodyH + wheelR * 0.7 + 0.04, -0.2]}
        >
          <boxGeometry args={[0.03, 0.08, bodyL * 0.6]} />
          <meshStandardMaterial color="#333333" roughness={0.6} metalness={0.5} />
        </mesh>
      ))}

      {/* ── Bumper (front) ────────────────────────────────── */}
      <mesh position={[0, wheelR * 0.7 + 0.08, bodyL / 2 + 0.52]}>
        <boxGeometry args={[bodyW * 1.05, 0.12, 0.08]} />
        <meshStandardMaterial color="#888888" roughness={0.5} metalness={0.6} />
      </mesh>

      {/* ── Bumper (rear) ─────────────────────────────────── */}
      <mesh position={[0, wheelR * 0.7 + 0.08, -bodyL / 2 - 0.02]}>
        <boxGeometry args={[bodyW * 1.05, 0.12, 0.08]} />
        <meshStandardMaterial color="#888888" roughness={0.5} metalness={0.6} />
      </mesh>

      {/* ── Exhaust pipe ──────────────────────────────────── */}
      <mesh
        position={[bodyW * 0.3, wheelR * 0.4, -bodyL / 2 - 0.12]}
        rotation={[Math.PI / 2, 0, 0]}
      >
        <cylinderGeometry args={[0.03, 0.035, 0.2, 8]} />
        <meshStandardMaterial color="#333333" roughness={0.6} metalness={0.5} />
      </mesh>

      {/* ── Wheels (4, slightly squashed for deflated look) ── */}
      {[
        [-bodyW * 0.4, wheelR * 0.65, bodyL * 0.32],
        [bodyW * 0.4, wheelR * 0.65, bodyL * 0.32],
        [-bodyW * 0.4, wheelR * 0.65, -bodyL * 0.32],
        [bodyW * 0.4, wheelR * 0.65, -bodyL * 0.32],
      ].map((pos, i) => (
        <group key={`wheel-${i}`} position={pos as [number, number, number]}>
          {/* Tire — squashed Y for flat look */}
          <mesh rotation={[0, 0, Math.PI / 2]} scale={[0.85, 1, 1]}>
            <cylinderGeometry args={[wheelR, wheelR, wheelW, 12]} />
            <meshStandardMaterial color="#222222" roughness={0.95} />
          </mesh>
          {/* Hub */}
          <mesh rotation={[0, 0, Math.PI / 2]} scale={[0.85, 1, 1]}>
            <cylinderGeometry args={[wheelR * 0.45, wheelR * 0.45, wheelW + 0.01, 8]} />
            <meshStandardMaterial color="#999999" roughness={0.4} metalness={0.6} />
          </mesh>
        </group>
      ))}

      {/* ── Rust patches ──────────────────────────────────── */}
      {rustPatches.map((patch, i) => (
        <mesh
          key={`rust-${i}`}
          position={patch.pos}
          scale={patch.scale}
        >
          <boxGeometry args={[1, 1, 1]} />
          <meshStandardMaterial color={patch.color} roughness={1} />
        </mesh>
      ))}

      {/* ── Shadow ────────────────────────────────────────── */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <planeGeometry args={[bodyW * 1.2, bodyL * 1.1]} />
        <meshBasicMaterial color="#000" transparent opacity={0.18} />
      </mesh>
    </group>
  );
}

// ── MechanicSign ───────────────────────────────────────────────────────

interface MechanicSignProps {
  position: [number, number, number];
  rotation?: number;
}

export function MechanicSign({ position, rotation = 0 }: MechanicSignProps) {
  const groupRef = useRef<THREE.Group>(null);
  const signRef = useRef<THREE.Group>(null);

  const texture = useMemo(
    () =>
      createTextTexture("PIPE'S MECHANIC", 512, 192, {
        bg: '#8B7355',
        color: '#2a1a0a',
        font: 'serif',
      }),
    [],
  );

  useEffect(() => () => texture.dispose(), [texture]);

  // Gentle wind sway
  useFrame(({ clock }) => {
    if (!signRef.current) return;
    const t = clock.elapsedTime;
    // Sign board swings on chains
    signRef.current.rotation.z =
      Math.sin(t * 0.8) * 0.04 + Math.sin(t * 1.7 + 1.2) * 0.02;
    signRef.current.rotation.x =
      Math.sin(t * 0.6 + 0.5) * 0.015;
  });

  const postHeight = 2.0;
  const postRadius = 0.035;
  const signWidth = 1.0;
  const signHeight = 0.4;
  const armWidth = signWidth + 0.2; // crossbar extends past sign
  const armY = postHeight + 0.05;

  // Chain attach points
  const chainSpacing = signWidth * 0.35;
  const chainLength = 0.25;

  return (
    <group ref={groupRef} position={position} rotation={[0.03, rotation, 0.02]}>
      {/* Post */}
      <mesh position={[0, postHeight / 2, 0]}>
        <cylinderGeometry args={[postRadius, postRadius * 1.15, postHeight, 8]} />
        <meshStandardMaterial color="#8B7355" roughness={0.9} />
      </mesh>

      {/* Crossbar / arm */}
      <mesh position={[0, armY, 0]}>
        <boxGeometry args={[armWidth, 0.06, 0.06]} />
        <meshStandardMaterial color="#8B7355" roughness={0.85} />
      </mesh>

      {/* Hanging sign group (swings) */}
      <group ref={signRef} position={[0, armY, 0]}>
        {/* Chains / ropes (thin cylinders) */}
        {[-chainSpacing, chainSpacing].map((xOff, i) => (
          <mesh
            key={`chain-${i}`}
            position={[xOff, -chainLength / 2 - 0.03, 0]}
          >
            <cylinderGeometry args={[0.008, 0.008, chainLength, 4]} />
            <meshStandardMaterial
              color="#8a7a5a"
              roughness={0.7}
              metalness={0.3}
            />
          </mesh>
        ))}

        {/* Sign board */}
        <mesh position={[0, -chainLength - signHeight / 2 - 0.03, 0]}>
          <boxGeometry args={[signWidth, signHeight, 0.05]} />
          <meshStandardMaterial color="#8B7355" roughness={0.9} />
        </mesh>

        {/* Text face (front) */}
        <mesh position={[0, -chainLength - signHeight / 2 - 0.03, 0.028]}>
          <planeGeometry args={[signWidth * 0.92, signHeight * 0.85]} />
          <meshStandardMaterial map={texture} roughness={0.6} />
        </mesh>

        {/* Text face (back — same text) */}
        <mesh
          position={[0, -chainLength - signHeight / 2 - 0.03, -0.028]}
          rotation={[0, Math.PI, 0]}
        >
          <planeGeometry args={[signWidth * 0.92, signHeight * 0.85]} />
          <meshStandardMaterial map={texture} roughness={0.6} />
        </mesh>
      </group>

      {/* Shadow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <circleGeometry args={[0.15, 8]} />
        <meshBasicMaterial color="#000" transparent opacity={0.12} />
      </mesh>
    </group>
  );
}
