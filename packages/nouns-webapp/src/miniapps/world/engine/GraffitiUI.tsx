// ── GraffitiUI — Pixel spray-paint overlay for billboards ─────────────
//
// Press G near a billboard to open a 32x32 pixel canvas (scaled to
// 512x512 on screen). Draw with mouse/touch, pick colors, change
// brush size. Save broadcasts the tag via PartyKit, cancel exits.
// The saved drawing is applied as a CanvasTexture on the billboard.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  PAINT_COLORS,
  createGraffitiCanvas,
  drawOnGraffiti,
  canvasToBase64,
  saveTag,
  saveGraffitiTag,
  type GraffitiTag,
} from './graffiti';

// ── Types ────────────────────────────────────────────────────────────

interface GraffitiUIProps {
  billboardId: string;
  playerId: string;
  /** PartyKit WebSocket for broadcasting the tag */
  ws: WebSocket | null;
  /** Called when the overlay closes (save or cancel) */
  onClose: (tag: GraffitiTag | null) => void;
}

// ── Constants ────────────────────────────────────────────────────────

const CANVAS_SIZE = 32;
const DISPLAY_SIZE = 512;
const SCALE = DISPLAY_SIZE / CANVAS_SIZE;
const BRUSH_SIZES = [1, 2, 3];

// ── Component ────────────────────────────────────────────────────────

export function GraffitiUI({ billboardId, playerId, ws, onClose }: GraffitiUIProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const displayRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const [selectedColor, setSelectedColor] = useState(PAINT_COLORS[0]);
  const [brushSize, setBrushSize] = useState(1);

  // Create the 32x32 drawing canvas on mount
  useEffect(() => {
    canvasRef.current = createGraffitiCanvas();
    renderToDisplay();
    // Block game input while overlay is open
    const blockKeys = (e: KeyboardEvent) => {
      // Allow Escape to cancel
      if (e.key === 'Escape') {
        onClose(null);
        return;
      }
      e.stopPropagation();
    };
    window.addEventListener('keydown', blockKeys, true);
    return () => window.removeEventListener('keydown', blockKeys, true);
  }, []);

  // Render the 32x32 canvas scaled up to the display canvas
  const renderToDisplay = useCallback(() => {
    const src = canvasRef.current;
    const dst = displayRef.current;
    if (!src || !dst) return;
    const ctx = dst.getContext('2d')!;
    ctx.imageSmoothingEnabled = false;
    // Checkerboard background for transparency
    for (let y = 0; y < CANVAS_SIZE; y++) {
      for (let x = 0; x < CANVAS_SIZE; x++) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#333' : '#444';
        ctx.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
      }
    }
    ctx.drawImage(src, 0, 0, DISPLAY_SIZE, DISPLAY_SIZE);
    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= CANVAS_SIZE; i++) {
      ctx.beginPath();
      ctx.moveTo(i * SCALE, 0);
      ctx.lineTo(i * SCALE, DISPLAY_SIZE);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * SCALE);
      ctx.lineTo(DISPLAY_SIZE, i * SCALE);
      ctx.stroke();
    }
  }, []);

  // Convert mouse/touch position to pixel coords
  const getPixelCoords = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    const rect = displayRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    const x = Math.floor((clientX - rect.left) / SCALE);
    const y = Math.floor((clientY - rect.top) / SCALE);
    if (x < 0 || x >= CANVAS_SIZE || y < 0 || y >= CANVAS_SIZE) return null;
    return { x, y };
  }, []);

  // Draw at pixel position
  const drawAt = useCallback(
    (x: number, y: number) => {
      if (!canvasRef.current) return;
      drawOnGraffiti(canvasRef.current, x, y, selectedColor, brushSize);
      renderToDisplay();
    },
    [selectedColor, brushSize, renderToDisplay],
  );

  const handlePointerDown = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      drawingRef.current = true;
      const coords = getPixelCoords(e);
      if (coords) drawAt(coords.x, coords.y);
    },
    [getPixelCoords, drawAt],
  );

  const handlePointerMove = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (!drawingRef.current) return;
      e.preventDefault();
      const coords = getPixelCoords(e);
      if (coords) drawAt(coords.x, coords.y);
    },
    [getPixelCoords, drawAt],
  );

  const handlePointerUp = useCallback(() => {
    drawingRef.current = false;
  }, []);

  // Save the tag
  const handleSave = useCallback(() => {
    if (!canvasRef.current) return;
    const pixels = canvasToBase64(canvasRef.current);
    const tag: GraffitiTag = {
      id: `${billboardId}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      billboardId,
      pixels,
      author: playerId,
      timestamp: Date.now(),
      color: selectedColor,
    };
    saveTag(tag);
    // Broadcast via PartyKit (legacy format)
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'world:graffiti',
          tag,
        }),
      );
      // Also persist via graffiti storage protocol
      saveGraffitiTag(ws, billboardId, pixels, playerId);
    }
    onClose(tag);
  }, [billboardId, playerId, selectedColor, ws, onClose]);

  // Clear canvas
  const handleClear = useCallback(() => {
    if (!canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d')!;
    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    renderToDisplay();
  }, [renderToDisplay]);

  // Cycle brush size
  const cycleBrush = useCallback(() => {
    setBrushSize(prev => {
      const idx = BRUSH_SIZES.indexOf(prev);
      return BRUSH_SIZES[(idx + 1) % BRUSH_SIZES.length];
    });
  }, []);

  return (
    <div style={styles.overlay}>
      <div style={styles.container}>
        {/* Title */}
        <div style={styles.title}>SPRAY PAINT - {billboardId.toUpperCase()}</div>

        {/* Canvas */}
        <canvas
          ref={displayRef}
          width={DISPLAY_SIZE}
          height={DISPLAY_SIZE}
          style={styles.canvas}
          onMouseDown={handlePointerDown}
          onMouseMove={handlePointerMove}
          onMouseUp={handlePointerUp}
          onMouseLeave={handlePointerUp}
          onTouchStart={handlePointerDown}
          onTouchMove={handlePointerMove}
          onTouchEnd={handlePointerUp}
        />

        {/* Color picker */}
        <div style={styles.colorRow}>
          {PAINT_COLORS.map(color => (
            <button
              key={color}
              onClick={() => setSelectedColor(color)}
              style={{
                ...styles.colorSwatch,
                backgroundColor: color,
                border: color === selectedColor ? '3px solid #fff' : '2px solid #666',
                transform: color === selectedColor ? 'scale(1.2)' : 'scale(1)',
              }}
            />
          ))}
        </div>

        {/* Controls row */}
        <div style={styles.controlRow}>
          <button onClick={cycleBrush} style={styles.btn}>
            BRUSH: {brushSize}px
          </button>
          <button onClick={handleClear} style={styles.btn}>
            CLEAR
          </button>
          <button onClick={handleSave} style={styles.saveBtn}>
            SAVE
          </button>
          <button onClick={() => onClose(null)} style={styles.cancelBtn}>
            CANCEL
          </button>
        </div>

        <div style={styles.hint}>ESC to cancel | Draw with mouse/touch</div>
      </div>
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: '100vw',
    height: '100vh',
    background: 'rgba(0, 0, 0, 0.85)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    cursor: 'crosshair',
  },
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '12px',
    padding: '20px',
    background: '#1a1a1a',
    border: '2px solid #555',
    borderRadius: '8px',
    maxWidth: '560px',
    width: '95vw',
  },
  title: {
    fontFamily: 'monospace',
    fontSize: '16px',
    fontWeight: 'bold',
    color: '#ff4444',
    letterSpacing: '2px',
    textTransform: 'uppercase',
  },
  canvas: {
    border: '2px solid #666',
    imageRendering: 'pixelated',
    width: '100%',
    maxWidth: `${DISPLAY_SIZE}px`,
    aspectRatio: '1',
    touchAction: 'none',
    cursor: 'crosshair',
  },
  colorRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
    justifyContent: 'center',
    padding: '4px 0',
  },
  colorSwatch: {
    width: '32px',
    height: '32px',
    borderRadius: '4px',
    cursor: 'pointer',
    transition: 'transform 0.1s, border 0.1s',
    padding: 0,
    outline: 'none',
  },
  controlRow: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  btn: {
    fontFamily: 'monospace',
    fontSize: '13px',
    fontWeight: 'bold',
    padding: '8px 16px',
    background: '#333',
    color: '#ccc',
    border: '1px solid #666',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  saveBtn: {
    fontFamily: 'monospace',
    fontSize: '13px',
    fontWeight: 'bold',
    padding: '8px 20px',
    background: '#228B22',
    color: '#fff',
    border: '1px solid #3a3',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  cancelBtn: {
    fontFamily: 'monospace',
    fontSize: '13px',
    fontWeight: 'bold',
    padding: '8px 16px',
    background: '#8B2222',
    color: '#fff',
    border: '1px solid #a33',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  hint: {
    fontFamily: 'monospace',
    fontSize: '11px',
    color: '#666',
    textAlign: 'center',
  },
};
