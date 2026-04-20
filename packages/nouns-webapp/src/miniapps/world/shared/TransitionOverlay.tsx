// ── TransitionOverlay — CSS white flash + grain fade for world swaps ──
//
// Full-screen div that drives the 3-phase world transition overlay:
//   pullIn  → overlay fades to white (0 → 1)
//   swap    → overlay held at full white (1)
//   pullOut → overlay fades off (1 → 0) with grain flicker
// Transition phase is driven by `useWorldStore().transition`.

import { useEffect, useState } from 'react';
import { useWorldStore } from './useWorldStore';

export function TransitionOverlay() {
  const transition = useWorldStore(s => s.transition);
  const [opacity, setOpacity] = useState(0);

  useEffect(() => {
    if (transition === 'idle') {
      setOpacity(0);
      return;
    }
    if (transition === 'pullIn') {
      // Ramp 0 → 1 over ~600ms
      const start = performance.now();
      let raf = 0;
      const tick = (now: number) => {
        const t = Math.min((now - start) / 600, 1);
        setOpacity(t);
        if (t < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }
    if (transition === 'swap') {
      setOpacity(1);
      return;
    }
    if (transition === 'pullOut') {
      const start = performance.now();
      let raf = 0;
      const tick = (now: number) => {
        const t = Math.min((now - start) / 800, 1);
        setOpacity(1 - t);
        if (t < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }
  }, [transition]);

  if (transition === 'idle' && opacity === 0) return null;

  // Grain during pullOut — gentle noise fade
  const showGrain = transition === 'pullOut';

  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9998,
        pointerEvents: 'none',
        background: '#ffffff',
        opacity,
        transition: 'none',
        overflow: 'hidden',
      }}
    >
      {showGrain && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)'/%3E%3C/svg%3E\")",
            opacity: 0.08 * opacity,
            mixBlendMode: 'overlay',
          }}
        />
      )}
    </div>
  );
}

export default TransitionOverlay;
