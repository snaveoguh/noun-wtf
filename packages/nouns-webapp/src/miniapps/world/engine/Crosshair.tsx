// ── Crosshair — centered HUD reticle, tints red when locked on ──────

import { useEffect, useRef, useState } from 'react';
import type { AimHudSlot } from './aim';

interface CrosshairProps {
  /** Shared slot updated by aim.ts each frame. */
  slot: AimHudSlot;
  /** Whether a weapon is equipped — hides reticle otherwise. */
  visible: boolean;
}

export function Crosshair({ slot, visible }: CrosshairProps) {
  // Poll the slot at a reasonable rate; repainting a div is cheap.
  const [locked, setLocked] = useState(false);
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    if (!visible) {
      setLocked(false);
      return;
    }
    const tick = () => {
      setLocked(slot.lockedId != null);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [slot, visible]);

  if (!visible) return null;

  const color = locked ? '#ff3838' : '#ffffffaa';
  const glow = locked ? '0 0 8px #ff3838' : '0 0 4px rgba(0,0,0,0.8)';

  return (
    <div
      style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
        zIndex: 15,
        width: 34,
        height: 34,
      }}
      aria-hidden
    >
      {/* Center dot */}
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          width: locked ? 5 : 3,
          height: locked ? 5 : 3,
          borderRadius: '50%',
          background: color,
          boxShadow: glow,
          transition: 'width 80ms, height 80ms, background 80ms',
        }}
      />
      {/* Outer ring */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          border: `${locked ? 2 : 1}px solid ${color}`,
          boxShadow: glow,
          opacity: locked ? 0.95 : 0.6,
          transition: 'border 80ms, opacity 80ms',
        }}
      />
      {/* 4 tick marks (cardinal) */}
      {[0, 90, 180, 270].map(deg => (
        <div
          key={deg}
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: 2,
            height: 8,
            background: color,
            boxShadow: glow,
            transformOrigin: 'center -9px',
            transform: `translate(-50%, -100%) rotate(${deg}deg) translateY(-${locked ? 10 : 12}px)`,
            transition: 'background 80ms, transform 80ms',
          }}
        />
      ))}
    </div>
  );
}
