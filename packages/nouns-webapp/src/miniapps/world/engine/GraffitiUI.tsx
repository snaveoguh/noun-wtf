// ── GraffitiUI — Freehand spray paint on walls ──────────────────────

import { useCallback, useEffect, useRef, useState } from 'react';
import { saveGraffitiTag } from './graffiti';

interface SprayUIProps {
  wallId: string;
  playerId: string;
  paintColor: string;
  ws: WebSocket | null;
  onClose: () => void;
  /** Existing tags on this wall — drawn as base layer so new paint goes on top */
  existingTags?: Array<{ imageData: string }>;
}

const SIZE = 256;
const SPRAY_RADIUS = 8;

export function GraffitiUI({ wallId, playerId, paintColor, ws, onClose, existingTags }: SprayUIProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);

  // Init canvas — load existing graffiti as base layer so new paint goes ON TOP
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d')!;

    // Base wall color + noise texture
    ctx.fillStyle = '#c8c0b4';
    ctx.fillRect(0, 0, SIZE, SIZE);
    for (let i = 0; i < 300; i++) {
      ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.08})`;
      ctx.fillRect(
        Math.random() * SIZE,
        Math.random() * SIZE,
        1 + Math.random() * 2,
        1 + Math.random() * 2,
      );
    }

    // Composite existing tags on top of base (oldest first)
    if (existingTags && existingTags.length > 0) {
      let loaded = 0;
      const images: HTMLImageElement[] = [];
      for (const tag of existingTags) {
        const img = new Image();
        img.onload = () => {
          loaded++;
          if (loaded === existingTags.length) {
            ctx.imageSmoothingEnabled = false;
            for (const loadedImg of images) {
              ctx.drawImage(loadedImg, 0, 0, SIZE, SIZE);
            }
          }
        };
        img.onerror = () => { loaded++; };
        img.src = tag.imageData;
        images.push(img);
      }
    }
  }, []);

  const spray = useCallback(
    (cx: number, cy: number) => {
      const ctx = canvasRef.current?.getContext('2d');
      if (!ctx) return;
      for (let i = 0; i < 18; i++) {
        const a = Math.random() * Math.PI * 2;
        const d = Math.random() * SPRAY_RADIUS;
        const px = cx + Math.cos(a) * d;
        const py = cy + Math.sin(a) * d;
        if (px < 0 || px >= SIZE || py < 0 || py >= SIZE) continue;
        ctx.globalAlpha = 0.25 + Math.random() * 0.55;
        ctx.fillStyle = paintColor;
        ctx.fillRect(px, py, 1 + Math.floor(Math.random() * 3), 1 + Math.floor(Math.random() * 3));
      }
      ctx.globalAlpha = 1;
    },
    [paintColor],
  );

  const toCanvasCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return [
      ((e.clientX - rect.left) / rect.width) * SIZE,
      ((e.clientY - rect.top) / rect.height) * SIZE,
    ] as const;
  };

  const handleClose = useCallback(() => {
    const c = canvasRef.current;
    if (c && ws) {
      saveGraffitiTag(ws, wallId, c.toDataURL('image/png'), playerId);
    }
    onClose();
  }, [ws, wallId, playerId, onClose]);

  useEffect(() => {
    const fn = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key.toLowerCase() === 'g') {
        e.preventDefault();
        e.stopPropagation();
        handleClose();
      }
    };
    window.addEventListener('keydown', fn, true);
    return () => window.removeEventListener('keydown', fn, true);
  }, [handleClose]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexDirection: 'column',
        background: 'rgba(0,0,0,0.5)',
      }}
      onClick={e => {
        if (e.target === e.currentTarget) handleClose();
      }}
    >
      <canvas
        ref={canvasRef}
        width={SIZE}
        height={SIZE}
        style={{
          width: 'min(70vmin, 500px)',
          height: 'min(70vmin, 500px)',
          border: `3px solid ${paintColor}`,
          borderRadius: 4,
          boxShadow: `0 0 40px ${paintColor}60`,
          imageRendering: 'pixelated',
          cursor: 'crosshair',
          touchAction: 'none',
        }}
        onMouseDown={e => {
          setDrawing(true);
          const [x, y] = toCanvasCoords(e);
          spray(x, y);
        }}
        onMouseMove={e => {
          if (drawing) {
            const [x, y] = toCanvasCoords(e);
            spray(x, y);
          }
        }}
        onMouseUp={() => setDrawing(false)}
        onMouseLeave={() => setDrawing(false)}
        onTouchStart={e => {
          e.preventDefault();
          setDrawing(true);
          const touch = e.touches[0];
          const rect = e.currentTarget.getBoundingClientRect();
          spray(
            ((touch.clientX - rect.left) / rect.width) * SIZE,
            ((touch.clientY - rect.top) / rect.height) * SIZE,
          );
        }}
        onTouchMove={e => {
          e.preventDefault();
          if (!drawing) return;
          const touch = e.touches[0];
          const rect = e.currentTarget.getBoundingClientRect();
          spray(
            ((touch.clientX - rect.left) / rect.width) * SIZE,
            ((touch.clientY - rect.top) / rect.height) * SIZE,
          );
        }}
        onTouchEnd={() => setDrawing(false)}
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
        DRAG TO SPRAY · [ESC] or [G] TO FINISH
      </div>
    </div>
  );
}
