/**
 * NounVoxel3D — Full 3D extruded voxel Noun (predictive display).
 *
 * - Strips background, renders only noun art as cubes
 * - Glasses protrude from face
 * - Saturated colors for vivid appearance
 * - Light/dark silhouette toggle
 * - Uses meshStandardMaterial with proper lighting
 */
import { FC, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ImageData, getNounData } from '@noundry/nouns-assets';
import { OrbitControls } from '@react-three/drei';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';

import { buildNounGeometries, seedToLayers } from '@nouns/voxel-engine';

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

// ─── Scene ──────────────────────────────────────────────────────────────────

type ViewMode = 'color' | 'silhouette';

function VoxelScene({ layers, mode }: { layers: { body: any[]; bling: any[]; glasses: any[] }; mode: ViewMode }) {
  const { bodyGeo, blingGeo, glassesGeo } = useMemo(() => buildNounGeometries(layers), [layers]);
  const isColor = mode === 'color';

  const renderMesh = (geo: THREE.BufferGeometry | null, roughness: number) => {
    if (!geo) return null;
    return (
      <>
        <mesh geometry={geo}>
          {isColor
            ? <meshStandardMaterial vertexColors roughness={roughness} metalness={0.0} />
            : <meshStandardMaterial color="#0a0a12" roughness={0.9} />
          }
        </mesh>
        {!isColor && (
          <mesh geometry={geo}>
            <meshBasicMaterial color="#1a2a5a" wireframe transparent opacity={0.15} />
          </mesh>
        )}
      </>
    );
  };

  return (
    <group>
      {/* eslint-disable react/no-unknown-property */}
      <ambientLight intensity={0.6} />
      <directionalLight position={[15, 25, 30]} intensity={0.7} />
      <directionalLight position={[-10, -5, -15]} intensity={0.1} />
      <directionalLight position={[-5, 10, -20]} intensity={0.15} />

      {renderMesh(bodyGeo, 0.8)}
      {renderMesh(blingGeo, 0.6)}
      {renderMesh(glassesGeo, 0.6)}
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
      return seedToLayers(prediction.seed, getNounData, ImageData.palette);
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
          border: '1px solid rgba(100,200,255,0.3)',
          background: mode === 'silhouette' ? 'rgba(10,10,20,0.9)' : 'rgba(40,40,60,0.8)',
          color: mode === 'silhouette' ? '#6ab0ff' : '#ccc',
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
