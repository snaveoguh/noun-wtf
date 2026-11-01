/**
 * TreasuryCorridor — Main 3D scene.
 * Immersive first-person corridor with live treasury data panels.
 */
import { FC, useState, useCallback, Suspense } from 'react';

import { Canvas } from '@react-three/fiber';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import { Link } from 'react-router';

import Corridor from './Corridor';
import DataPanels from './DataPanels';
import NounCharacter from './NounCharacter';
import { useStatsData } from './useStatsData';

// ─── HUD ────────────────────────────────────────────────────────────────────
// The hint and the /nonsense link sit in a bar above the scene, so the canvas
// stays full-bleed under it with no controls on it; the read-outs (progress,
// % explored, auto-walk) stay overlaid on the scene's bottom edge.

const HUDBar: FC = () => (
  <div
    style={{
      display: 'flex',
      flexWrap: 'wrap',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 8,
      padding: '8px 12px',
      background: '#050510',
      borderBottom: '1px solid var(--theme-divider)',
      fontFamily: "'PT Root UI', monospace, sans-serif",
      fontSize: '0.75rem',
      flex: 'none',
    }}
  >
    <span style={{ color: 'var(--theme-text-muted)', minWidth: 0 }}>
      WASD / Arrows to move, Click + drag to look, Space for auto-walk
    </span>
    {/* The same treasury figures, flat and explained */}
    <Link
      to="/nonsense"
      className="inline-flex items-center [@media(pointer:coarse)]:min-h-10"
      style={{
        color: '#d4ff3a',
        background: 'rgba(0,0,0,0.6)',
        padding: '4px 10px',
        borderRadius: 6,
        border: '1px solid var(--theme-divider)',
        textDecoration: 'none',
      }}
    >
      treasury in plain numbers: what it holds, where it went →
    </Link>
  </div>
);

const HUD: FC<{ playerZ: number; autoWalk: boolean }> = ({ playerZ, autoWalk }) => {
  const progress = Math.min(100, Math.max(0, (-playerZ / 240) * 100));

  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 10,
        fontFamily: "'PT Root UI', monospace, sans-serif",
      }}
    >
      {/* Progress bar — bottom */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: 3,
          background: '#0a0a1a',
        }}
      >
        <div
          style={{
            width: `${progress}%`,
            height: '100%',
            background: 'linear-gradient(90deg, #fbbf24, #ec4899, #60a5fa)',
            transition: 'width 0.1s linear',
          }}
        />
      </div>

      {/* Depth indicator — bottom right */}
      <div
        style={{
          position: 'absolute',
          bottom: 12,
          right: 16,
          fontSize: '0.75rem',
          color: 'var(--theme-text-muted)',
          fontFamily: 'monospace',
        }}
      >
        {progress.toFixed(0)}% explored
      </div>

      {/* Auto-walk indicator */}
      {autoWalk && (
        <div
          style={{
            position: 'absolute',
            bottom: 12,
            left: 16,
            fontSize: '0.75rem',
            color: '#fbbf24',
            background: 'rgba(0,0,0,0.5)',
            padding: '3px 8px',
            borderRadius: 4,
            border: '1px solid #3b3011',
          }}
        >
          AUTO-WALK ▶
        </div>
      )}
    </div>
  );
};

// ─── Loading Screen ─────────────────────────────────────────────────────────

const LoadingScreen: FC = () => (
  <div
    style={{
      position: 'absolute',
      inset: 0,
      background: '#050510',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 20,
      fontFamily: "'PT Root UI', sans-serif",
    }}
  >
    <div
      style={{
        fontSize: '2rem',
        color: '#fbbf24',
        marginBottom: 16,
        animation: 'pulse 2s ease-in-out infinite',
      }}
    >
      🐚
    </div>
    <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Loading Treasury Corridor...</div>
    <style>{`
      @keyframes pulse {
        0%, 100% { opacity: 0.5; transform: scale(1); }
        50% { opacity: 1; transform: scale(1.1); }
      }
    `}</style>
  </div>
);

// ─── Main Component ─────────────────────────────────────────────────────────

const TreasuryCorridor: FC = () => {
  const data = useStatsData();
  const [playerZ, setPlayerZ] = useState(4);
  const [autoWalk, setAutoWalk] = useState(false);

  const handlePositionChange = useCallback((z: number) => {
    setPlayerZ(z);
  }, []);

  // Listen for auto-walk toggle
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === ' ') {
      setAutoWalk(prev => !prev);
    }
  }, []);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        flex: '1 1 auto',
        minHeight: 360,
        background: '#050510',
      }}
      onKeyDown={handleKeyDown}
    >
      <HUDBar />
      {/* The 3D scene: its in-world panels are art and slide off its edges as you walk. */}
      <div
        data-responsive-art-ok
        style={{
          position: 'relative',
          flex: '1 1 auto',
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {data.loading && <LoadingScreen />}

        <Canvas
          camera={{ fov: 70, near: 0.1, far: 300, position: [0, 2.5, 4] }}
          gl={{
            antialias: true,
            toneMapping: 3, // ACESFilmicToneMapping
            toneMappingExposure: 1.2,
          }}
          dpr={[1, 1.5]}
          style={{ background: '#050510' }}
        >
          <Suspense fallback={null}>
            <Corridor />
            <NounCharacter onPositionChange={handlePositionChange} />
            <DataPanels data={data} playerZ={playerZ} />

            {/* Post-processing */}
            <EffectComposer>
              <Bloom luminanceThreshold={0.2} luminanceSmoothing={0.9} intensity={0.8} />
            </EffectComposer>
          </Suspense>
        </Canvas>

        <HUD playerZ={playerZ} autoWalk={autoWalk} />
      </div>
    </div>
  );
};

export default TreasuryCorridor;
