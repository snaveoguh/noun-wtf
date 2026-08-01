/**
 * CrystalBall — Compact 3D ASCII noun prediction, spinning in a glowing orb.
 *
 * Polls /api/agent/predict every ~12s for the predicted next Noun seed,
 * renders it as a miniature 3D ASCII voxel landscape inside a CSS crystal ball.
 * Shows block number, next Noun ID, and auction countdown.
 */
import { FC, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ImageData, getNounData } from '@noundry/nouns-assets';
import { ImageDataV2, getNounDataV2 } from '@nouns/assets';
import { OrbitControls } from '@react-three/drei';
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

interface AsciiVoxel {
  x: number;
  z: number;
  y: number;
  r: number;
  g: number;
  b: number;
  charIndex: number;
}

interface PredictResponse {
  block: number;
  nextNounId: number;
  seed: NounSeed | null;
  traits: Record<string, string> | null;
  auctionEnd: number;
  auctionEnded: boolean;
  running: boolean;
  checkedAt: string;
  /** DAO the seed was computed for. The API labels this from NOUNIRL_WATCH_DAO
   * — the watcher can be pointed at either DAO, so never assume v1. */
  dao?: 'v1' | 'v2';
}

// ─── Constants ──────────────────────────────────────────────────────────────

const ASCII_CHARS = '.:-=+*#%@\u2588';
const MAX_HEIGHT = 6; // slightly shorter for compact view

// ─── Char Texture Cache ─────────────────────────────────────────────────────

const cbCharCache: THREE.CanvasTexture[] = [];

function getCBCharTexture(index: number): THREE.CanvasTexture {
  if (cbCharCache[index] != null) return cbCharCache[index];
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
  cbCharCache[index] = texture;
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

// ─── Seed → Voxels ──────────────────────────────────────────────────────────

function seedToVoxels(seed: NounSeed, isV2: boolean = false): AsciiVoxel[] {
  // For NounV2 nouns, use ImageDataV2 from the workspace `@nouns/assets` package
  // which mirrors the on-chain V2 descriptor (founder traits + extended palette).
  // V1 keeps using `@noundry/nouns-assets` from npm.
  const { parts, background } = isV2 ? getNounDataV2(seed) : getNounData(seed);
  const palette = isV2 ? ImageDataV2.palette : ImageData.palette;

  const colorGrid: string[][] = Array.from({ length: 32 }, () => Array(32).fill(background));

  for (let p = 0; p < parts.length; p++) {
    const { bounds, pairs } = decodeRLE(parts[p].data);
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
      voxels.push({ x: col, z: row, y: height, r, g, b, charIndex });
    }
  }
  return voxels;
}

// ─── Instanced Character Group (compact, no split) ──────────────────────────

function CBCharGroup({ voxels, charIndex }: { voxels: AsciiVoxel[]; charIndex: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const texture = useMemo(() => getCBCharTexture(charIndex), [charIndex]);
  const geometry = useMemo(() => new THREE.PlaneGeometry(0.95, 0.95), []);
  const mat = useMemo(() => new THREE.Matrix4(), []);
  const rot = useMemo(() => new THREE.Matrix4().makeRotationX(-Math.PI / 2), []);
  const col = useMemo(() => new THREE.Color(), []);

  useFrame(({ clock }) => {
    const mesh = meshRef.current;
    if (!mesh || voxels.length === 0) return;
    const t = clock.getElapsedTime();
    for (let i = 0; i < voxels.length; i++) {
      const v = voxels[i];
      const wave =
        Math.sin(t * 1.5 + v.x * 0.4 + v.z * 0.4) * 0.6 +
        Math.sin(t * 0.9 + v.x * 0.25 - v.z * 0.2) * 0.3;
      mat.makeTranslation(v.x - 15.5, v.y + wave, v.z - 15.5);
      mat.multiply(rot);
      mesh.setMatrixAt(i, mat);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh || voxels.length === 0) return;
    for (let i = 0; i < voxels.length; i++) {
      const v = voxels[i];
      const hexStr =
        '#' +
        v.r.toString(16).padStart(2, '0') +
        v.g.toString(16).padStart(2, '0') +
        v.b.toString(16).padStart(2, '0');
      col.set(hexStr);
      mesh.setColorAt(i, col);
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [voxels, col]);

  if (voxels.length === 0) return null;

  return (
    // eslint-disable-next-line react/no-unknown-property
    <instancedMesh ref={meshRef} args={[geometry, undefined, voxels.length]}>
      {/* eslint-disable react/no-unknown-property */}
      <meshBasicMaterial
        map={texture}
        transparent
        alphaTest={0.1}
        side={THREE.DoubleSide}
        depthWrite
      />
      {/* eslint-enable react/no-unknown-property */}
    </instancedMesh>
  );
}

// ─── Crystal Ball 3D Scene ──────────────────────────────────────────────────

function CrystalScene({ voxels }: { voxels: AsciiVoxel[] }) {
  const charGroups = useMemo(() => {
    const groups = new Map<number, AsciiVoxel[]>();
    for (const v of voxels) {
      if (!groups.has(v.charIndex)) groups.set(v.charIndex, []);
      groups.get(v.charIndex)!.push(v);
    }
    return Array.from(groups.entries());
  }, [voxels]);

  return (
    <group>
      {charGroups.map(([charIndex, group]) => (
        <CBCharGroup key={charIndex} charIndex={charIndex} voxels={group} />
      ))}
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

// ─── Main CrystalBall Component ─────────────────────────────────────────────

export type { PredictResponse, NounSeed };

interface CrystalBallProps {
  size?: number; // px, default 180
  interactive?: boolean; // enable drag-rotate + zoom (default false)
  onPredict?: (prediction: PredictResponse) => void; // callback with prediction data
  /**
   * When provided, the component treats this as the authoritative prediction
   * and skips its own /api/agent/predict polling. Used by callers (e.g. the
   * DAO-switched crystal ball page) that need to drive the orb from a
   * different data source such as an on-chain v2 auction read.
   */
  predictionOverride?: PredictResponse | null;
  /**
   * When true, decode seeds with V2 ImageData (workspace `@nouns/assets`)
   * so V2-only founder traits render correctly. Default false → V1 behavior.
   */
  isV2?: boolean;
}

const CrystalBall: FC<CrystalBallProps> = ({
  size = 180,
  interactive = false,
  onPredict,
  predictionOverride,
  isV2 = false,
}) => {
  const [prediction, setPrediction] = useState<PredictResponse | null>(predictionOverride ?? null);
  const [, setTick] = useState(0); // force re-render for countdown
  const pollRef = useRef<ReturnType<typeof setInterval>>(undefined);
  const countdownRef = useRef<ReturnType<typeof setInterval>>(undefined);

  // When the parent drives the prediction externally, skip the internal
  // polling entirely and just mirror the override into local state so the
  // existing render pipeline keeps working.
  const externallyControlled = predictionOverride !== undefined;

  useEffect(() => {
    if (externallyControlled) {
      setPrediction(predictionOverride ?? null);
    }
  }, [externallyControlled, predictionOverride]);

  // Poll the fast predict endpoint
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

  // Poll every 3s everywhere — realtime block tracking matters
  const pollInterval = 3_000;

  useEffect(() => {
    if (externallyControlled) return;
    fetchPrediction();
    pollRef.current = setInterval(fetchPrediction, pollInterval);
    return () => clearInterval(pollRef.current);
  }, [externallyControlled, fetchPrediction, pollInterval]);

  // Update countdown every second
  useEffect(() => {
    countdownRef.current = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(countdownRef.current);
  }, []);

  // When the parent drives the prediction, its isV2 prop is authoritative.
  // When self-polling, trust the API's dao label instead — the watcher can be
  // pointed at either DAO, and decoding a V2 seed with V1 art renders the
  // wrong noun (or crashes on V2-only indices, e.g. body 31).
  const effectiveIsV2 = externallyControlled ? isV2 : (prediction?.dao ?? 'v1') === 'v2';

  const voxels = useMemo(() => {
    if (!prediction?.seed) return null;
    return seedToVoxels(prediction.seed, effectiveIsV2);
  }, [prediction?.seed, effectiveIsV2]);

  const countdown =
    prediction?.auctionEnd != null && prediction.auctionEnd > 0
      ? formatCountdown(prediction.auctionEnd)
      : null;
  const isNounOClock = prediction?.auctionEnded ?? false;

  return (
    <div
      style={{
        width: size,
        height: size + 52, // extra space for info below the orb
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 4,
      }}
    >
      {/* The orb */}
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          overflow: 'hidden',
          position: 'relative',
          background: 'radial-gradient(circle at 35% 35%, rgba(40,40,60,0.9), rgba(5,5,15,0.95))',
          boxShadow: isNounOClock
            ? '0 0 20px rgba(239,68,68,0.4), 0 0 40px rgba(239,68,68,0.15), inset 0 0 30px rgba(239,68,68,0.1)'
            : '0 0 20px rgba(100,200,255,0.15), 0 0 40px rgba(100,200,255,0.05), inset 0 0 30px rgba(100,150,255,0.08)',
          border: isNounOClock
            ? '1px solid rgba(239,68,68,0.3)'
            : '1px solid rgba(100,200,255,0.15)',
          transition: 'box-shadow 0.5s, border-color 0.5s',
        }}
      >
        {/* Glass highlight */}
        <div
          style={{
            position: 'absolute',
            top: '8%',
            left: '15%',
            width: '35%',
            height: '20%',
            background: 'radial-gradient(ellipse, rgba(255,255,255,0.12), transparent)',
            borderRadius: '50%',
            pointerEvents: 'none',
            zIndex: 10,
          }}
        />

        {voxels ? (
          <Canvas
            camera={{ position: [0, 24, 26], fov: 55 }}
            style={{ width: '100%', height: '100%' }}
            gl={{ antialias: false, alpha: true, powerPreference: 'low-power' }}
            onCreated={({ gl }) => {
              gl.setClearColor(0x000000, 0);
            }}
            frameloop="always"
            dpr={1} // force 1x DPR for speed
          >
            <Suspense fallback={null}>
              {/* eslint-disable react/no-unknown-property */}
              <ambientLight intensity={0.7} />
              <pointLight position={[0, 12, 0]} intensity={0.3} color="#aaccff" />
              {/* eslint-enable react/no-unknown-property */}

              <CrystalScene voxels={voxels} />

              <OrbitControls
                enableDamping
                dampingFactor={0.05}
                autoRotate
                autoRotateSpeed={interactive ? 1.5 : 3}
                enableZoom={interactive}
                enablePan={false}
                enableRotate={interactive}
                minDistance={interactive ? 10 : undefined}
                maxDistance={interactive ? 60 : undefined}
                target={[0, MAX_HEIGHT * 0.25, 0]}
              />
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
              fontSize: 10,
              color: 'rgba(100,200,255,0.3)',
              letterSpacing: '0.1em',
            }}
          >
            SCRYING...
          </div>
        )}

        {/* Noun O'Clock indicator */}
        {isNounOClock && (
          <div
            style={{
              position: 'absolute',
              bottom: '12%',
              left: '50%',
              transform: 'translateX(-50%)',
              fontFamily: '"Courier New", monospace',
              fontSize: 8,
              fontWeight: 800,
              color: '#ef4444',
              letterSpacing: '0.15em',
              textShadow: '0 0 8px rgba(239,68,68,0.6)',
              whiteSpace: 'nowrap',
              zIndex: 10,
              animation: 'pulse 1.5s ease-in-out infinite',
            }}
          >
            NOUN O&apos;CLOCK
          </div>
        )}
      </div>

      {/* Info below the orb */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 2,
          fontFamily: '"Courier New", monospace',
          lineHeight: 1.3,
        }}
      >
        {prediction && (
          <>
            <div style={{ fontSize: 10, color: '#666', letterSpacing: '0.05em' }}>
              <span style={{ color: prediction.running ? '#4ade80' : '#ef4444' }}>
                {prediction.running ? '\u25CF' : '\u25CB'}
              </span>{' '}
              NOUN #{prediction.nextNounId}
              {prediction.block > 0 && (
                <span style={{ color: '#444', marginLeft: 6 }}>BLK {prediction.block}</span>
              )}
            </div>
            {countdown && (
              <div
                style={{
                  fontSize: 9,
                  color: isNounOClock ? '#ef4444' : '#555',
                  letterSpacing: '0.08em',
                }}
              >
                {isNounOClock ? 'AUCTION ENDED' : countdown}
              </div>
            )}
          </>
        )}
      </div>

      {/* Pulse animation */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
      `}</style>
    </div>
  );
};

export default CrystalBall;
