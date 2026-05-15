/**
 * AsciiNoun — 3D ASCII art representation of a Noun.
 *
 * Decodes a Noun's seed into a 32x32 pixel grid, then renders each pixel
 * as a COLORED ASCII CHARACTER at a HEIGHT based on its brightness.
 * Bright pixels → tall dense chars (█ @ #), dark → short sparse chars (. : -)
 *
 * Features:
 * - Per-character wave animation (rippling terrain)
 * - Gene/trait split mode (explodes into body, head, glasses, accessory, background)
 * - Auto-rotating orbit camera with user interaction
 *
 * Uses InstancedMesh per character type (10 groups) for efficient rendering.
 */
import { FC, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ImageData, getNounData } from '@noundry/nouns-assets';
import { ImageDataV2, getNounDataV2 } from '@nouns/assets';
import { Html, OrbitControls } from '@react-three/drei';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

// ─── Types ──────────────────────────────────────────────────────────────────

interface NounSeed {
  background: number;
  body: number;
  accessory: number;
  head: number;
  glasses: number;
}

export interface AsciiVoxel {
  x: number;
  z: number; // row (depth axis)
  y: number; // base height (brightness-derived)
  r: number;
  g: number;
  b: number;
  charIndex: number;
  partIndex: number; // 0=background, 1=body, 2=accessory, 3=head, 4=glasses
}

// ─── Constants ──────────────────────────────────────────────────────────────

// Ordered by visual density: sparse → dense
const ASCII_CHARS = '.:-=+*#%@\u2588'; // . : - = + * # % @ █
const MAX_HEIGHT = 8;

const PART_NAMES = ['BG', 'BODY', 'ACC', 'HEAD', 'GLASSES'];
const PART_COLORS = ['#8b8b8b', '#e06c75', '#e5c07b', '#61afef', '#c678dd'];

// Split offsets — how far apart each gene group floats in split mode
const SPLIT_OFFSETS = [
  -12, // background (bottom)
  -4, // body
  4, // accessory
  12, // head
  20, // glasses (top)
];

// ─── Character Textures (canvas-rendered, cached) ───────────────────────────

const charTextureCache: THREE.CanvasTexture[] = [];

function getCharTexture(index: number): THREE.CanvasTexture {
  if (charTextureCache[index]) return charTextureCache[index];

  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, size, size);
  ctx.font = `bold ${size * 0.82}px "Courier New", "Consolas", monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(ASCII_CHARS[index], size / 2, size / 2);

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  charTextureCache[index] = texture;
  return texture;
}

// ─── RLE Decoder ────────────────────────────────────────────────────────────

function decodeRLE(data: string) {
  const hex = data.replace(/^0x/, '');
  const bounds = {
    top: parseInt(hex.substring(2, 4), 16),
    right: parseInt(hex.substring(4, 6), 16),
    bottom: parseInt(hex.substring(6, 8), 16),
    left: parseInt(hex.substring(8, 10), 16),
  };
  const pairs: [number, number][] =
    hex
      .substring(10)
      .match(/.{1,4}/g)
      ?.map(r => [parseInt(r.substring(0, 2), 16), parseInt(r.substring(2, 4), 16)]) ?? [];
  return { bounds, pairs };
}

// ─── Seed → ASCII Voxels (with part tracking) ──────────────────────────────

export function seedToAsciiVoxels(seed: NounSeed, isV2 = false): AsciiVoxel[] {
  const { parts, background } = isV2 ? getNounDataV2(seed) : getNounData(seed);
  const palette = (isV2 ? ImageDataV2 : ImageData).palette;

  // Build 32x32 grids — color + which part painted it
  const colorGrid: string[][] = Array.from({ length: 32 }, () => Array(32).fill(background));
  const partGrid: number[][] = Array.from(
    { length: 32 },
    () => Array(32).fill(0), // 0 = background
  );

  for (let p = 0; p < parts.length; p++) {
    const { bounds, pairs } = decodeRLE(parts[p].data);
    let x = bounds.left;
    let y = bounds.top;
    for (const [runLength, colorIndex] of pairs) {
      for (let i = 0; i < runLength; i++) {
        if (colorIndex !== 0 && y < 32 && x < 32) {
          colorGrid[y][x] = palette[colorIndex];
          partGrid[y][x] = p + 1; // 1=body, 2=accessory, 3=head, 4=glasses
        }
        x++;
        if (x >= bounds.right) {
          x = bounds.left;
          y++;
        }
      }
    }
  }

  // Convert to ASCII voxels
  const voxels: AsciiVoxel[] = [];
  const numChars = ASCII_CHARS.length;

  for (let row = 0; row < 32; row++) {
    for (let col = 0; col < 32; col++) {
      const hex = colorGrid[row][col];
      if (!hex) continue;

      const r = parseInt(hex.substring(0, 2), 16);
      const g = parseInt(hex.substring(2, 4), 16);
      const b = parseInt(hex.substring(4, 6), 16);

      const brightness = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      const charIndex = Math.min(numChars - 1, Math.floor(brightness * numChars));
      const height = (1 - brightness) * MAX_HEIGHT;

      voxels.push({
        x: col,
        z: 31 - row,
        y: height,
        r,
        g,
        b,
        charIndex,
        partIndex: partGrid[row][col],
      });
    }
  }
  return voxels;
}

// ─── Animated Character Group ──────────────────────────────────────────────

export function CharacterGroup({
  voxels,
  charIndex,
  splitAmount,
}: {
  voxels: AsciiVoxel[];
  charIndex: number;
  splitAmount: number; // 0 = assembled, 1 = fully split
}) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const texture = useMemo(() => getCharTexture(charIndex), [charIndex]);
  const geometry = useMemo(() => new THREE.PlaneGeometry(0.95, 0.95), []);

  // Persistent matrix/color helpers
  const mat = useMemo(() => new THREE.Matrix4(), []);
  const rot = useMemo(() => new THREE.Matrix4().makeRotationX(-Math.PI / 2), []);
  const col = useMemo(() => new THREE.Color(), []);

  // Animate every frame — wave ripple + split offset
  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh || voxels.length === 0) return;

    const t = clock.getElapsedTime();

    for (let i = 0; i < voxels.length; i++) {
      const v = voxels[i];

      // Wave animation — sine ripple across the grid
      const wave =
        Math.sin(t * 1.2 + v.x * 0.35 + v.z * 0.35) * 0.8 +
        Math.sin(t * 0.7 + v.x * 0.2 - v.z * 0.15) * 0.4;

      // Split offset — push each gene group to its own level
      const splitOffset = SPLIT_OFFSETS[v.partIndex] * splitAmount;

      const finalY = v.y + wave + splitOffset;

      mat.makeTranslation(v.x - 15.5, finalY, v.z - 15.5);
      mat.multiply(rot);
      mesh.setMatrixAt(i, mat);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  // Set colors once (they don't change per frame)
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || voxels.length === 0) return;

    for (let i = 0; i < voxels.length; i++) {
      const v = voxels[i];
      col.setRGB(v.r / 255, v.g / 255, v.b / 255);
      mesh.setColorAt(i, col);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [voxels, col]);

  if (voxels.length === 0) return null;

  return (
    <instancedMesh ref={meshRef} args={[geometry, undefined, voxels.length]}>
      <meshBasicMaterial
        map={texture}
        transparent
        alphaTest={0.1}
        side={THREE.DoubleSide}
        depthWrite={true}
      />
    </instancedMesh>
  );
}

// ─── Part Label (floating text in 3D when split) ───────────────────────────

function PartLabel({
  partIndex,
  splitAmount,
  count,
}: {
  partIndex: number;
  splitAmount: number;
  count: number;
}) {
  if (splitAmount < 0.3 || count === 0) return null;

  const y = SPLIT_OFFSETS[partIndex] * splitAmount + MAX_HEIGHT * 0.5;

  return (
    <Html
      position={[-18, y, 0]}
      style={{
        opacity: Math.min(1, (splitAmount - 0.3) / 0.3),
        transition: 'opacity 0.3s',
        pointerEvents: 'none',
        userSelect: 'none',
      }}
    >
      <div
        style={{
          fontFamily: '"Courier New", monospace',
          fontSize: '0.65rem',
          fontWeight: 800,
          color: PART_COLORS[partIndex],
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
          whiteSpace: 'nowrap',
          textShadow: '0 0 8px rgba(0,0,0,0.5)',
        }}
      >
        {PART_NAMES[partIndex]}
        <span style={{ opacity: 0.5, marginLeft: 4, fontSize: '0.5rem' }}>{count}px</span>
      </div>
    </Html>
  );
}

// ─── ASCII Scene ─────────────────────────────────────────────────────────────

function AsciiScene({ voxels, splitAmount }: { voxels: AsciiVoxel[]; splitAmount: number }) {
  const groupRef = useRef<THREE.Group>(null);

  // Group voxels by character type
  const charGroups = useMemo(() => {
    const groups = new Map<number, AsciiVoxel[]>();
    for (const v of voxels) {
      if (!groups.has(v.charIndex)) groups.set(v.charIndex, []);
      groups.get(v.charIndex)!.push(v);
    }
    return Array.from(groups.entries());
  }, [voxels]);

  // Count voxels per part (for labels)
  const partCounts = useMemo(() => {
    const counts = [0, 0, 0, 0, 0];
    for (const v of voxels) counts[v.partIndex]++;
    return counts;
  }, [voxels]);

  return (
    <group ref={groupRef}>
      {charGroups.map(([charIndex, group]) => (
        <CharacterGroup
          key={charIndex}
          charIndex={charIndex}
          voxels={group}
          splitAmount={splitAmount}
        />
      ))}
      {/* Part labels when split */}
      {PART_NAMES.map((_, i) => (
        <PartLabel key={i} partIndex={i} splitAmount={splitAmount} count={partCounts[i]} />
      ))}
    </group>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

interface AsciiNounProps {
  seed: {
    background: number;
    body: number;
    accessory: number;
    head: number;
    glasses: number;
  };
  /** Decode seed against V2 ImageData/palette instead of V1 noundry. */
  isV2?: boolean;
}

const AsciiNounCanvas: FC<AsciiNounProps> = ({ seed, isV2 = false }) => {
  const voxels = useMemo(() => seedToAsciiVoxels(seed, isV2), [seed, isV2]);
  const [isSplit, setIsSplit] = useState(false);
  const [splitAmount, setSplitAmount] = useState(0);

  // r3f's <Canvas> uses ResizeObserver via react-use-measure to size its
  // internal canvas. When this component mounts inside an absolutely-
  // positioned parent that just appeared (e.g. switching from 3D to ASCII
  // tab), the observer sometimes never fires its initial measurement and
  // the canvas stays at the HTML default 300x150 — rendering a blank
  // hero. Forcing a window resize after mount nudges r3f to re-measure
  // the parent and size the canvas correctly. Cheap and idempotent.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const fire = () => window.dispatchEvent(new Event('resize'));
    let r2 = 0;
    // Two ticks: the first catches the layout-settled paint, the second
    // covers cases where the parent's size changed between paints (e.g.
    // tab-bar reflow on first ASCII activation).
    const r1 = requestAnimationFrame(() => {
      fire();
      r2 = requestAnimationFrame(fire);
    });
    return () => {
      cancelAnimationFrame(r1);
      if (r2) cancelAnimationFrame(r2);
    };
  }, []);

  // Smooth animate split amount
  useEffect(() => {
    const target = isSplit ? 1 : 0;
    let raf: number;

    const animate = () => {
      setSplitAmount(prev => {
        const diff = target - prev;
        if (Math.abs(diff) < 0.005) return target;
        raf = requestAnimationFrame(animate);
        return prev + diff * 0.06;
      });
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [isSplit]);

  const toggleSplit = useCallback(() => setIsSplit(s => !s), []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas
        camera={{ position: [0, 28, 30], fov: 50 }}
        style={{ width: '100%', height: '100%' }}
        gl={{ antialias: true, alpha: true }}
        // Fire resize observer immediately so the canvas sizes to parent
        // on first paint instead of staying at 300x150.
        resize={{ debounce: 0 }}
        onCreated={({ gl }) => {
          gl.setClearColor(0x000000, 0);
        }}
      >
        <Suspense fallback={null}>
          <ambientLight intensity={0.8} />
          <directionalLight position={[20, 30, 15]} intensity={0.5} />
          <pointLight position={[0, 15, 0]} intensity={0.3} color="#ffcc88" />

          <AsciiScene voxels={voxels} splitAmount={splitAmount} />

          <OrbitControls
            enableDamping
            dampingFactor={0.08}
            autoRotate
            autoRotateSpeed={isSplit ? 0.8 : 1.5}
            minDistance={isSplit ? 30 : 20}
            maxDistance={isSplit ? 100 : 70}
            enablePan={false}
            target={[0, isSplit ? MAX_HEIGHT * 0.5 + 4 : MAX_HEIGHT * 0.3, 0]}
            maxPolarAngle={Math.PI * 0.85}
            minPolarAngle={Math.PI * 0.05}
          />
        </Suspense>
      </Canvas>

      {/* Split toggle button */}
      <button
        onClick={toggleSplit}
        style={{
          position: 'absolute',
          bottom: 10,
          right: 10,
          background: isSplit ? 'rgba(198, 120, 221, 0.3)' : 'rgba(255, 255, 255, 0.15)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          border: `1px solid ${isSplit ? 'rgba(198, 120, 221, 0.5)' : 'rgba(255, 255, 255, 0.25)'}`,
          borderRadius: 8,
          padding: '5px 12px',
          color: isSplit ? '#c678dd' : 'rgba(255, 255, 255, 0.7)',
          fontSize: '0.6rem',
          fontWeight: 800,
          fontFamily: '"Courier New", monospace',
          letterSpacing: '0.08em',
          textTransform: 'uppercase',
          cursor: 'pointer',
          transition: 'all 0.2s ease',
          zIndex: 10,
          // The auction hero wrapper sets pointer-events: none in scroll
          // mode (so the page scrolls through the canvas). The SPLIT button
          // is a UI control, not the canvas — opt back in so users can
          // toggle gene split without first switching to grab mode.
          pointerEvents: 'auto',
        }}
        onMouseEnter={e => {
          e.currentTarget.style.background = isSplit
            ? 'rgba(198, 120, 221, 0.45)'
            : 'rgba(255, 255, 255, 0.25)';
        }}
        onMouseLeave={e => {
          e.currentTarget.style.background = isSplit
            ? 'rgba(198, 120, 221, 0.3)'
            : 'rgba(255, 255, 255, 0.15)';
        }}
        title={isSplit ? 'Merge genes' : 'Split into gene layers'}
      >
        {isSplit ? '\u{1F9EC} MERGE' : '\u{1F9EC} SPLIT'}
      </button>
    </div>
  );
};

export default AsciiNounCanvas;
