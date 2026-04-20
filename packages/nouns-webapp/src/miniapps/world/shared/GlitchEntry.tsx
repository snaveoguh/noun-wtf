// ── GlitchEntry — 1.2s Matrix suck/zoom cinematic ────────────────────
//
// Full-screen CSS div overlay played on first /world mount.
// Phases (total 1200ms):
//   0 – 200ms   near-black + thin horizontal scanline
//   200 – 400ms scanline splits, peak RGB chromatic aberration (magenta/cyan)
//   400 – 800ms radial zoom-rush: white div scales 10 → 1, ease-in accel
//   800 – 1200ms white settles, overlay fades out
//
// Hand-rolled with requestAnimationFrame (no CSS keyframes so we can be
// frame-precise for phase transitions). Cheap: one div + inline styles.

import { useEffect, useRef, useState } from 'react';
import { useWorldStore } from './useWorldStore';

const DURATION_MS = 1200;

export function GlitchEntry() {
  const hasSeenGlitch = useWorldStore(s => s.hasSeenGlitch);
  const markGlitchSeen = useWorldStore(s => s.markGlitchSeen);
  const [t, setT] = useState(0); // 0..1
  const [done, setDone] = useState(hasSeenGlitch);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (hasSeenGlitch) {
      setDone(true);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const elapsed = now - start;
      const progress = Math.min(elapsed / DURATION_MS, 1);
      setT(progress);
      if (progress >= 1) {
        setDone(true);
        markGlitchSeen();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [hasSeenGlitch, markGlitchSeen]);

  if (done) return null;

  // ── Phase math ─────────────────────────────────────────────────────
  // Phase A (0 – 0.167): black + scanline
  // Phase B (0.167 – 0.333): scanline splits + chromatic peak
  // Phase C (0.333 – 0.667): zoom rush (scale 10 → 1 ease-in)
  // Phase D (0.667 – 1): white settle + fade
  const tA = Math.min(t / 0.167, 1);
  const tB = Math.min(Math.max((t - 0.167) / 0.166, 0), 1);
  const tC = Math.min(Math.max((t - 0.333) / 0.334, 0), 1);
  const tD = Math.min(Math.max((t - 0.667) / 0.333, 0), 1);

  // Scanline height + split
  const scanlineHeight = tA > 0 && tC < 0.5 ? 2 + tB * 4 : 0; // thickens as it splits
  const scanlineOpacity = t < 0.4 ? 0.95 : 0;
  const scanlineY1 = 50 - tB * 12; // top half drifts up
  const scanlineY2 = 50 + tB * 12; // bottom half drifts down

  // Chromatic aberration — peaks in Phase B, fades across C
  const caMagenta = tB > 0 ? Math.max(0, Math.min(tB, 1 - tC)) : 0;
  const caCyan = caMagenta;

  // White zoom div — ease-in (t^2), scale 10 → 1 during Phase C
  const zoomScale = tC < 1 ? 10 - 9 * (1 - Math.pow(1 - tC, 2.2)) : 1;
  const zoomOpacity = tC > 0 ? Math.min(tC * 2, 1) : 0;

  // Overall container fade — fades out entirely in last phase
  const containerOpacity = 1 - tD;

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        pointerEvents: 'none',
        overflow: 'hidden',
        background: '#000',
        opacity: containerOpacity,
      }}
    >
      {/* Base black layer fades to white through phase C */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: tC > 0.3 ? '#fff' : '#000',
          transition: 'background 40ms linear',
        }}
      />

      {/* White zoom-rush disc — radial scale 10 → 1 */}
      {tC > 0 && (
        <div
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: '100vmax',
            height: '100vmax',
            marginLeft: '-50vmax',
            marginTop: '-50vmax',
            background:
              'radial-gradient(circle, #ffffff 0%, #ffffff 55%, #f0f0f0 75%, #a0a0a0 100%)',
            transform: `scale(${zoomScale})`,
            transformOrigin: '50% 50%',
            opacity: zoomOpacity,
            mixBlendMode: 'screen',
          }}
        />
      )}

      {/* Horizontal scanline — single, then splits into two */}
      {scanlineOpacity > 0 && (
        <>
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              top: `${scanlineY1}%`,
              height: scanlineHeight,
              background: 'rgba(255,255,255,0.95)',
              boxShadow: '0 0 10px rgba(255,255,255,0.5)',
              opacity: scanlineOpacity,
              transform: `translateY(-50%)`,
            }}
          />
          {tB > 0 && (
            <div
              style={{
                position: 'absolute',
                left: 0,
                right: 0,
                top: `${scanlineY2}%`,
                height: scanlineHeight,
                background: 'rgba(255,255,255,0.95)',
                boxShadow: '0 0 10px rgba(255,255,255,0.5)',
                opacity: scanlineOpacity,
                transform: `translateY(-50%)`,
              }}
            />
          )}
        </>
      )}

      {/* Magenta ghost — offset left */}
      {caMagenta > 0 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(90deg, rgba(255,0,200,0.45) 0%, rgba(255,0,200,0.2) 40%, transparent 60%)',
            mixBlendMode: 'screen',
            transform: `translateX(${-18 * caMagenta}px)`,
            opacity: caMagenta,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Cyan ghost — offset right */}
      {caCyan > 0 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(270deg, rgba(0,220,255,0.45) 0%, rgba(0,220,255,0.2) 40%, transparent 60%)',
            mixBlendMode: 'screen',
            transform: `translateX(${18 * caCyan}px)`,
            opacity: caCyan,
            pointerEvents: 'none',
          }}
        />
      )}

      {/* Thin vertical noise bars during Phase B */}
      {tB > 0.1 && tB < 0.9 && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              'repeating-linear-gradient(90deg, rgba(255,255,255,0.05) 0 1px, transparent 1px 3px)',
            opacity: 0.5,
            mixBlendMode: 'overlay',
          }}
        />
      )}
    </div>
  );
}

export default GlitchEntry;
