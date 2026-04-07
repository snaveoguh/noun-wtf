// ── GraffitiUI — In-scene freehand spray paint ──────────────────────
//
// Press G near a wall → fullscreen crosshair overlay, drag to spray.
// Draws directly onto a 256x256 canvas. On close, saves to PartyKit.

import { useCallback, useEffect, useRef } from 'react';
import { saveGraffitiTag } from './graffiti';

interface SprayUIProps {
  wallId: string;
  playerId: string;
  paintColor: string;
  ws: WebSocket | null;
  onClose: () => void;
}

const SIZE = 256;
const SPRAY_RADIUS = 8;

export function GraffitiUI({ wallId, playerId, paintColor, ws, onClose }: SprayUIProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);

  // Initialize canvas with wall base color
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = '#c8c0b4';
    ctx.fillRect(0, 0, SIZE, SIZE);
    // Add some grit/texture
    for (let i = 0; i < 300; i++) {
      ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
      ctx.fillRect(
        Math.random() * SIZE,
        Math.random() * SIZE,
        1 + Math.random() * 2,
        1 + Math.random() * 2,
      );
    }
  }, []);

  const sprayAt = useCallback(
    (x: number, y: number) => {
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;
      for (let i = 0; i < 15; i++) {
        const angle = Math.random() * Math.PI * 2;
        const dist = Math.random() * SPRAY_RADIUS;
        const px = x + Math.cos(angle) * dist;
        const py = y + Math.sin(angle) * dist;
        if (px < 0 || px >= SIZE || py < 0 || py >= SIZE) continue;
        const sz = 1 + Math.floor(Math.random() * 3);
        ctx.globalAlpha = 0.3 + Math.random() * 0.5;
        ctx.fillStyle = paintColor;
        ctx.fillRect(px, py, sz, sz);
      }
      ctx.globalAlpha = 1;
    },
    [paintColor],
  );

  const getPos = (e: React.PointerEvent): [number, number] => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return [0, 0];
    return [
      ((e.clientX - rect.left) / rect.width) * SIZE,
      ((e.clientY - rect.top) / rect.height) * SIZE,
    ];
  };

  const onDown = useCallback(
    (e: React.PointerEvent) => {
      drawingRef.current = true;
      const [x, y] = getPos(e);
      sprayAt(x, y);
    },
    [sprayAt],
  );

  const onMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drawingRef.current) return;
      const [x, y] = getPos(e);
      sprayAt(x, y);
    },
    [sprayAt],
  );

  const onUp = useCallback(() => {
    drawingRef.current = false;
  }, []);

  const handleClose = useCallback(() => {
    const c = canvasRef.current;
    if (c && ws) {
      const base64 = c.toDataURL('image/png');
      saveGraffitiTag(ws, wallId, base64, playerId);
    }
    onClose();
  }, [ws, wallId, playerId, onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key.toLowerCase() === 'g') {
        e.preventDefault();
        e.stopPropagation();
        handleClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [handleClose]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 40,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        background: 'rgba(0,0,0,0.4)',
        cursor: 'crosshair',
      }}
    >
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        style={{
          width: '70vmin',
          height: '70vmin',
          maxWidth: 600,
          maxHeight: 600,
          border: `3px solid ${paintColor}`,
          borderRadius: 4,
          boxShadow: `0 0 30px ${paintColor}40`,
          imageRendering: 'pixelated',
          touchAction: 'none',
        }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={onUp}
      />
      <div
        style={{
          marginTop: 16,
          fontFamily: 'monospace',
          fontSize: 14,
          color: '#fff',
          textShadow: '0 2px 4px rgba(0,0,0,0.8)',
          textAlign: 'center',
        }}
      >
        <span
          style={{
            display: 'inline-block',
            width: 14,
            height: 14,
            background: paintColor,
            borderRadius: 3,
            verticalAlign: 'middle',
            marginRight: 8,
            border: '1px solid rgba(255,255,255,0.3)',
          }}
        />
        DRAG TO SPRAY &middot; [ESC] or [G] TO FINISH
      </div>
    </div>
  );
}
