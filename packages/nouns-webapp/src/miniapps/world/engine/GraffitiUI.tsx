// ── GraffitiUI — In-scene spray paint on walls ──────────────────────
//
// When G is pressed near a wall:
//   1. Camera zooms into the wall face
//   2. A crosshair cursor appears
//   3. Mouse/touch drag = spray paint in your can's color
//   4. Freehand drawing directly on the wall's texture
//   5. ESC or G again = done, saves to PartyKit
//
// The wall texture is a shared CanvasTexture that persists.

import { useCallback, useEffect, useRef } from 'react';
import { canvasToBase64, saveGraffitiTag } from './graffiti';

interface SprayUIProps {
  /** Which wall we're spraying */
  wallId: string;
  /** Player ID for tag attribution */
  playerId: string;
  /** Paint color from the can we picked up */
  paintColor: string;
  /** PartyKit WebSocket */
  ws: WebSocket | null;
  /** Called when done spraying */
  onClose: () => void;
  /** Ref to the wall's canvas texture (256x256) */
  wallCanvasRef: React.RefObject<HTMLCanvasElement | null>;
  /** Callback to mark texture as needing update */
  onTextureUpdate: () => void;
}

const SPRAY_RADIUS = 6; // pixels on the 256x256 canvas
const SPRAY_DENSITY = 0.4; // how many dots per frame of spray

export function GraffitiUI({
  wallId,
  playerId,
  paintColor,
  ws,
  onClose,
  wallCanvasRef,
  onTextureUpdate,
}: SprayUIProps) {
  const drawingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  // Spray paint at a position on the wall canvas
  const sprayAt = useCallback(
    (canvasX: number, canvasY: number) => {
      const canvas = wallCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Spray effect — scatter dots in a radius
      for (let i = 0; i < 12; i++) {
        if (Math.random() > SPRAY_DENSITY) continue;
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * SPRAY_RADIUS;
        const px = Math.round(canvasX + Math.cos(angle) * dist);
        const py = Math.round(canvasY + Math.sin(angle) * dist);
        if (px < 0 || px >= 256 || py < 0 || py >= 256) continue;

        const size = 1 + Math.floor(Math.random() * 3);
        ctx.globalAlpha = 0.3 + Math.random() * 0.5;
        ctx.fillStyle = paintColor;
        ctx.fillRect(px, py, size, size);
      }
      ctx.globalAlpha = 1;
      onTextureUpdate();
    },
    [paintColor, wallCanvasRef, onTextureUpdate],
  );

  // Mouse/touch handlers on the overlay
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      drawingRef.current = true;
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 256;
      const y = ((e.clientY - rect.top) / rect.height) * 256;
      lastPosRef.current = { x, y };
      sprayAt(x, y);
    },
    [sprayAt],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drawingRef.current) return;
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 256;
      const y = ((e.clientY - rect.top) / rect.height) * 256;

      // Interpolate between last and current for smooth lines
      const last = lastPosRef.current;
      if (last) {
        const dx = x - last.x;
        const dy = y - last.y;
        const steps = Math.max(1, Math.floor(Math.sqrt(dx * dx + dy * dy) / 3));
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          sprayAt(last.x + dx * t, last.y + dy * t);
        }
      } else {
        sprayAt(x, y);
      }
      lastPosRef.current = { x, y };
    },
    [sprayAt],
  );

  const handlePointerUp = useCallback(() => {
    drawingRef.current = false;
    lastPosRef.current = null;
  }, []);

  // Save and close
  const handleSave = useCallback(() => {
    const canvas = wallCanvasRef.current;
    if (canvas && ws) {
      const base64 = canvasToBase64(canvas);
      saveGraffitiTag(ws, wallId, base64, playerId);
    }
    onClose();
  }, [wallCanvasRef, ws, wallId, playerId, onClose]);

  // ESC or G to finish
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key.toLowerCase() === 'g') {
        e.preventDefault();
        e.stopPropagation();
        handleSave();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [handleSave]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 40,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.3)',
        cursor: 'crosshair',
      }}
    >
      {/* The spray surface — maps to the wall texture */}
      <div
        style={{
          width: '70vmin',
          height: '70vmin',
          maxWidth: 600,
          maxHeight: 600,
          border: `3px solid ${paintColor}`,
          borderRadius: 4,
          position: 'relative',
          boxShadow: `0 0 30px ${paintColor}40`,
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        {/* Render the wall canvas as background */}
        <canvas
          ref={el => {
            // Mirror the wall canvas into this display
            if (el && wallCanvasRef.current) {
              el.width = 256;
              el.height = 256;
              const ctx = el.getContext('2d');
              if (ctx) {
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(wallCanvasRef.current, 0, 0);
              }
            }
          }}
          style={{
            width: '100%',
            height: '100%',
            imageRendering: 'pixelated',
            pointerEvents: 'none',
          }}
        />
      </div>

      {/* HUD */}
      <div
        style={{
          position: 'fixed',
          bottom: 30,
          left: '50%',
          transform: 'translateX(-50%)',
          fontFamily: 'monospace',
          fontSize: 14,
          color: '#fff',
          textShadow: '0 2px 4px rgba(0,0,0,0.8)',
          textAlign: 'center',
        }}
      >
        <div style={{ marginBottom: 8 }}>
          <span
            style={{
              display: 'inline-block',
              width: 16,
              height: 16,
              background: paintColor,
              borderRadius: 3,
              verticalAlign: 'middle',
              marginRight: 8,
              border: '1px solid rgba(255,255,255,0.3)',
            }}
          />
          SPRAY PAINTING
        </div>
        <div style={{ fontSize: 11, color: '#aaa' }}>
          DRAG TO SPRAY &middot; [ESC] or [G] TO FINISH
        </div>
      </div>
    </div>
  );
}
