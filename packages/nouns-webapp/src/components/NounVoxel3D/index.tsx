/**
 * NounVoxel3D — Full 3D extruded voxel Noun.
 *
 * - Strips background, renders only noun art as cubes
 * - Glasses (parts[3]) rendered as separate mesh, protruding 1px from face
 * - Saturated colors for vivid appearance
 * - Light/dark silhouette toggle
 */
import { FC, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ImageData, getNounData } from '@noundry/nouns-assets';
import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface NounSeed {
  background: number;
  body: number;
  accessory: number;
  head: number;
  glasses: number;
}

export interface PredictResponse {
  block: number;
  nextNounId: number;
  seed: NounSeed | null;
  traits: Record<string, string> | null;
  auctionEnd: number;
  auctionEnded: boolean;
  running: boolean;
  checkedAt: string;
}

interface VoxelPixel {
  x: number;
  y: number;
  r: number;
  g: number;
  b: number;
}

// ─── Color Utilities ────────────────────────────────────────────────────────

/** Boost saturation of an RGB color. factor=1.4 means 40% more saturated. */
function saturate(
  r: number,
  g: number,
  b: number,
  factor: number,
): { r: number; g: number; b: number } {
  // RGB [0-255] → HSL
  const rf = r / 255,
    gf = g / 255,
    bf = b / 255;
  const max = Math.max(rf, gf, bf),
    min = Math.min(rf, gf, bf);
  const l = (max + min) / 2;
  let h = 0,
    s = 0;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rf:
        h = ((gf - bf) / d + (gf < bf ? 6 : 0)) / 6;
        break;
      case gf:
        h = ((bf - rf) / d + 2) / 6;
        break;
      case bf:
        h = ((rf - gf) / d + 4) / 6;
        break;
    }
  }

  // Boost saturation
  s = Math.min(1, s * factor);

  // HSL → RGB
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  if (s === 0) {
    return { r: Math.round(l * 255), g: Math.round(l * 255), b: Math.round(l * 255) };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    g: Math.round(hue2rgb(p, q, h) * 255),
    b: Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  };
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

// ─── Decode parts into pixel grid ───────────────────────────────────────────

function decodeParts(
  parts: { data: string }[],
  palette: string[],
  satFactor: number,
): VoxelPixel[] {
  const colorGrid: (string | null)[][] = Array.from({ length: 32 }, () => Array(32).fill(null));

  for (const part of parts) {
    const { bounds, pairs } = decodeRLE(part.data);
    let x = bounds.left;
    let y = bounds.top;
    for (const [runLength, colorIndex] of pairs) {
      for (let i = 0; i < runLength; i++) {
        if (colorIndex !== 0 && y < 32 && x < 32) {
          colorGrid[y][x] = palette[colorIndex];
        }
        x++;
        if (x >= bounds.right) {
          x = bounds.left;
          y++;
        }
      }
    }
  }

  const pixels: VoxelPixel[] = [];
  for (let row = 0; row < 32; row++) {
    for (let col = 0; col < 32; col++) {
      const hexStr = colorGrid[row][col];
      if (!hexStr) continue;
      let r = parseInt(hexStr.substring(0, 2), 16);
      let g = parseInt(hexStr.substring(2, 4), 16);
      let b = parseInt(hexStr.substring(4, 6), 16);
      if (isNaN(r) || isNaN(g) || isNaN(b)) continue;

      // Saturate
      const sat = saturate(r, g, b, satFactor);
      r = sat.r;
      g = sat.g;
      b = sat.b;

      pixels.push({ x: col, y: 31 - row, r, g, b });
    }
  }
  return pixels;
}

// ─── Seed → separated layers ────────────────────────────────────────────────

interface NounLayers {
  body: VoxelPixel[]; // parts[0-2]: body + accessory + head
  glasses: VoxelPixel[]; // parts[3]: glasses only
}

function seedToLayers(seed: NounSeed): NounLayers {
  const { parts } = getNounData(seed);
  const palette = ImageData.palette;
  const SAT_FACTOR = 1.4;

  // Body = parts 0,1,2 (body, accessory, head)
  const body = decodeParts(parts.slice(0, 3), palette, SAT_FACTOR);

  // Glasses = part 3 only
  const glasses = decodeParts([parts[3]], palette, SAT_FACTOR);

  return { body, glasses };
}

// ─── Build merged geometry with baked vertex colors ─────────────────────────

const BODY_DEPTH = 3;
const GLASSES_DEPTH = 1;

function buildGeometry(
  pixels: VoxelPixel[],
  depth: number,
  zOffset: number,
): THREE.BufferGeometry | null {
  if (pixels.length === 0) return null;

  const boxTemplate = new THREE.BoxGeometry(1, 1, depth);
  const geometries: THREE.BufferGeometry[] = [];

  for (const p of pixels) {
    const box = boxTemplate.clone();
    box.translate(p.x - 15.5, p.y - 15.5, zOffset);

    const count = box.attributes.position.count;
    const colors = new Float32Array(count * 3);
    const r = p.r / 255;
    const g = p.g / 255;
    const b = p.b / 255;
    for (let i = 0; i < count; i++) {
      colors[i * 3] = r;
      colors[i * 3 + 1] = g;
      colors[i * 3 + 2] = b;
    }
    box.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometries.push(box);
  }

  const merged = mergeGeometries(geometries, false);
  boxTemplate.dispose();
  for (const g of geometries) g.dispose();
  return merged;
}

// ─── Scene ──────────────────────────────────────────────────────────────────

type ViewMode = 'color' | 'silhouette';

function VoxelScene({ layers, mode }: { layers: NounLayers; mode: ViewMode }) {
  // Body geometry at z=0
  const bodyGeo = useMemo(() => buildGeometry(layers.body, BODY_DEPTH, 0), [layers.body]);
  // Glasses geometry extruded 1px in front of face
  const glassesGeo = useMemo(
    () => buildGeometry(layers.glasses, GLASSES_DEPTH, BODY_DEPTH / 2 + GLASSES_DEPTH / 2),
    [layers.glasses],
  );

  const isColor = mode === 'color';

  return (
    <group>
      {/* eslint-disable react/no-unknown-property */}
      <ambientLight intensity={2} />
      <directionalLight position={[15, 25, 20]} intensity={1} />
      <directionalLight position={[-10, -10, -15]} intensity={0.5} />

      {/* Body + head + accessory */}
      {bodyGeo && (
        <>
          <mesh geometry={bodyGeo}>
            {isColor ? <meshBasicMaterial vertexColors /> : <meshBasicMaterial color="#0a0a12" />}
          </mesh>
          {/* Silhouette edge glow */}
          {!isColor && (
            <mesh geometry={bodyGeo}>
              <meshBasicMaterial color="#1a2a5a" wireframe transparent opacity={0.15} />
            </mesh>
          )}
        </>
      )}

      {/* Glasses — protruding */}
      {glassesGeo && (
        <>
          <mesh geometry={glassesGeo}>
            {isColor ? <meshBasicMaterial vertexColors /> : <meshBasicMaterial color="#0a0a12" />}
          </mesh>
          {!isColor && (
            <mesh geometry={glassesGeo}>
              <meshBasicMaterial color="#1a2a5a" wireframe transparent opacity={0.15} />
            </mesh>
          )}
        </>
      )}
      {/* eslint-enable react/no-unknown-property */}

      <OrbitControls
        enableDamping
        dampingFactor={0.08}
        autoRotate
        autoRotateSpeed={1.5}
        enableZoom
        enablePan={false}
        enableRotate
        minDistance={18}
        maxDistance={70}
        target={[0, 0, 0]}
      />
    </group>
  );
}

// ─── Countdown formatting ───────────────────────────────────────────────────

function formatCountdown(endTimestamp: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = endTimestamp - now;
  if (diff <= 0) return 'ENDED';
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  const s = diff % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ─── Main Component ─────────────────────────────────────────────────────────

interface NounVoxel3DProps {
  onPredict?: (prediction: PredictResponse) => void;
  pollInterval?: number;
}

const NounVoxel3D: FC<NounVoxel3DProps> = ({ onPredict, pollInterval = 3_000 }) => {
  const [prediction, setPrediction] = useState<PredictResponse | null>(null);
  const [mode, setMode] = useState<ViewMode>('color');
  const [, setTick] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const countdownRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const fetchPrediction = useCallback(async () => {
    try {
      const apiUrl =
        (import.meta.env.VITE_API_URL as string | undefined) ??
        'https://spirited-flexibility-production-3c30.up.railway.app';
      const res = await fetch(`${apiUrl}/api/agent/predict`);
      if (res.ok) {
        const data: PredictResponse = await res.json();
        setPrediction(data);
        onPredict?.(data);
      }
    } catch {
      /* silent */
    }
  }, [onPredict]);

  useEffect(() => {
    fetchPrediction();
    pollRef.current = setInterval(fetchPrediction, pollInterval);
    return () => clearInterval(pollRef.current);
  }, [fetchPrediction, pollInterval]);

  useEffect(() => {
    countdownRef.current = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(countdownRef.current);
  }, []);

  const layers = useMemo(() => {
    if (!prediction?.seed) return null;
    try {
      return seedToLayers(prediction.seed);
    } catch (e) {
      console.error('[NounVoxel3D] seedToLayers error:', e);
      return null;
    }
  }, [prediction?.seed]);

  const hasPixels = layers != null && (layers.body.length > 0 || layers.glasses.length > 0);

  const countdown =
    prediction?.auctionEnd != null && prediction.auctionEnd > 0
      ? formatCountdown(prediction.auctionEnd)
      : null;
  const isNounOClock = prediction?.auctionEnded ?? false;

  return (
    <div style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }}>
      {hasPixels ? (
        <Canvas
          camera={{ position: [0, 4, 35], fov: 50 }}
          style={{ width: '100%', height: '100%' }}
          gl={{ antialias: true, alpha: true }}
          onCreated={({ gl }) => {
            gl.setClearColor(0x000000, 0);
          }}
          dpr={[1, 2]}
          flat
        >
          <Suspense fallback={null}>
            <VoxelScene layers={layers!} mode={mode} />
          </Suspense>
        </Canvas>
      ) : (
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: '"Courier New", monospace',
            fontSize: 14,
            color: 'rgba(100,200,255,0.3)',
            letterSpacing: '0.15em',
          }}
        >
          SCRYING...
        </div>
      )}

      {/* Mode toggle — bottom right */}
      <button
        type="button"
        onClick={() => setMode(m => (m === 'color' ? 'silhouette' : 'color'))}
        style={{
          position: 'absolute',
          bottom: 20,
          right: 20,
          width: 36,
          height: 36,
          borderRadius: '50%',
          border: '1px solid rgba(100,200,255,0.2)',
          background: mode === 'silhouette' ? 'rgba(10,10,20,0.8)' : 'rgba(40,40,60,0.6)',
          color: mode === 'silhouette' ? '#4488cc' : '#aaa',
          fontSize: 16,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.3s',
          backdropFilter: 'blur(4px)',
        }}
        title={mode === 'color' ? 'Switch to silhouette' : 'Switch to color'}
      >
        {mode === 'color' ? '\u263E' : '\u2600'}
      </button>

      {/* HUD overlay */}
      {prediction && (
        <div
          style={{
            position: 'absolute',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 4,
            fontFamily: '"Courier New", monospace',
            pointerEvents: 'none',
          }}
        >
          <div style={{ fontSize: 12, color: '#777', letterSpacing: '0.08em' }}>
            <span style={{ color: prediction.running ? '#4ade80' : '#ef4444' }}>
              {prediction.running ? '\u25CF' : '\u25CB'}
            </span>{' '}
            NOUN #{prediction.nextNounId}
            {prediction.block > 0 && (
              <span style={{ color: '#555', marginLeft: 8 }}>BLK {prediction.block}</span>
            )}
          </div>
          {countdown && (
            <div
              style={{
                fontSize: 11,
                color: isNounOClock ? '#ef4444' : '#555',
                letterSpacing: '0.08em',
                fontWeight: isNounOClock ? 700 : 400,
              }}
            >
              {isNounOClock ? "NOUN O'CLOCK" : countdown}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default NounVoxel3D;
