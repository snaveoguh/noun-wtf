// Composed paint HUD: color wheel + brush tray + undo + close.
// Pure overlay — consumer positions it in their UI layer.

import type { HexColor } from '../core/types.js';

import { useCallback, useSyncExternalStore, type CSSProperties } from 'react';

import { usePaintSession } from '../adapters/r3f/usePaintSession.js';
import { surfaces } from '../core/registry.js';
import { paintSession, DEFAULT_PRESETS } from '../core/store.js';
import { applyStroke } from '../core/stroke.js';

import { BrushTray } from './BrushTray.js';
import { ColorWheel } from './ColorWheel.js';

export interface PaintHUDProps {
  /** Show/hide the HUD. */
  open: boolean;
  onClose?: () => void;
  /** Optional override for color presets. */
  presets?: readonly HexColor[];
  /** Hook called after undo — useful to broadcast a re-render of the surface. */
  onUndo?: (surfaceId: string) => void;
  /** Position preset. Default 'right'. */
  position?: 'right' | 'left' | 'bottom';
}

export function PaintHUD({
  open,
  onClose,
  presets = DEFAULT_PRESETS,
  onUndo,
  position = 'right',
}: PaintHUDProps) {
  const s = usePaintSession();
  const recent = useSyncExternalStore(
    cb => paintSession.subscribeRecent(cb),
    () => paintSession.getRecent(),
    () => paintSession.getRecent(),
  );

  const undo = useCallback(() => {
    const id = s.activeSurfaceId;
    if (!id) return;
    const surface = surfaces.get(id);
    if (!surface) return;
    void surface
      .undoLast((stroke, ctx, w, h) => applyStroke(stroke, ctx, w, h))
      .then(() => onUndo?.(id));
  }, [s.activeSurfaceId, onUndo]);

  if (!open) return null;

  const containerStyle: CSSProperties = {
    position: 'fixed',
    zIndex: 9000,
    padding: 16,
    background: 'rgba(12,12,14,0.92)',
    borderRadius: 12,
    border: '1px solid rgba(255,255,255,0.12)',
    boxShadow: '0 12px 40px rgba(0,0,0,0.55)',
    color: '#fff',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    width: 260,
    maxWidth: 'calc(100vw - 24px)',
    pointerEvents: 'auto',
    ...positionStyles(position),
  };

  return (
    <div style={containerStyle} onPointerDown={e => e.stopPropagation()}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ fontSize: 11, letterSpacing: 2, color: '#888' }}>PAINT</div>
        {onClose && (
          <button
            onClick={onClose}
            style={{
              width: 32,
              height: 32,
              borderRadius: 6,
              background: 'transparent',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.2)',
              cursor: 'pointer',
              fontSize: 16,
              lineHeight: 1,
            }}
            aria-label="Close paint HUD"
          >
            ×
          </button>
        )}
      </div>

      <ColorWheel
        color={s.color}
        onChange={s.setColor}
        recent={recent}
        presets={presets}
        size={220}
      />

      <BrushTray
        brush={s.brush}
        size={s.size}
        onBrushChange={s.setBrush}
        onSizeChange={s.setSize}
      />

      <div style={{ display: 'flex', gap: 6 }}>
        <button
          onClick={undo}
          disabled={!s.activeSurfaceId}
          style={{
            flex: 1,
            height: 44,
            fontFamily: 'monospace',
            fontSize: 12,
            letterSpacing: 1,
            background: 'rgba(255,255,255,0.1)',
            color: '#fff',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 6,
            cursor: s.activeSurfaceId ? 'pointer' : 'not-allowed',
            opacity: s.activeSurfaceId ? 1 : 0.5,
          }}
        >
          UNDO
        </button>
      </div>
    </div>
  );
}

function positionStyles(p: 'right' | 'left' | 'bottom'): CSSProperties {
  switch (p) {
    case 'left':
      return { left: 16, top: '50%', transform: 'translateY(-50%)' };
    case 'bottom':
      return { left: '50%', bottom: 16, transform: 'translateX(-50%)' };
    case 'right':
    default:
      return { right: 16, top: '50%', transform: 'translateY(-50%)' };
  }
}
