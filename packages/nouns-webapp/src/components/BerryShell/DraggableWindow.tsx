import { useEffect, useRef, useState, type ReactNode } from 'react';

import { type BerryWindowState, windowStore } from './store/windowStore';

interface DraggableWindowProps {
  win: BerryWindowState;
  children: ReactNode;
}

// Aqua-era gel buttons: radial highlight on top, soft inner shadow, subtle ring.
// Each light layers a base color with a top-left specular highlight.
const trafficLightBase: React.CSSProperties = {
  width: 13,
  height: 13,
  padding: 0,
  borderRadius: 999,
  border: '1px solid rgba(0, 0, 0, 0.45)',
  boxShadow:
    'inset 0 1px 0.5px rgba(255, 255, 255, 0.85), inset 0 -1px 1px rgba(0, 0, 0, 0.18), 0 0.5px 0 rgba(255, 255, 255, 0.4)',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 10,
  lineHeight: 1,
  fontWeight: 700,
  color: 'rgba(0, 0, 0, 0.6)',
  textShadow: '0 0.5px 0 rgba(255, 255, 255, 0.6)',
};

const trafficLightClose: React.CSSProperties = {
  background:
    'radial-gradient(circle at 35% 25%, #ff9a92 0%, #ff5f56 45%, #d92e26 100%)',
};
const trafficLightMin: React.CSSProperties = {
  background:
    'radial-gradient(circle at 35% 25%, #ffe187 0%, #ffbd2e 45%, #d99517 100%)',
};
const trafficLightMax: React.CSSProperties = {
  background:
    'radial-gradient(circle at 35% 25%, #8fefa0 0%, #27c93f 45%, #1aa12f 100%)',
};

// Pinstripe pattern for active titlebar — alternating 1px lines in the System
// 7 / Platinum spirit, layered over the Aqua gradient for subtle depth.
const PINSTRIPE_BG =
  'repeating-linear-gradient(0deg, rgba(0,0,0,0.04) 0px, rgba(0,0,0,0.04) 1px, transparent 1px, transparent 2px), linear-gradient(180deg, #f6f6f6 0%, #d6d6d6 50%, #c8c8c8 100%)';
const PINSTRIPE_BG_INACTIVE =
  'repeating-linear-gradient(0deg, rgba(0,0,0,0.025) 0px, rgba(0,0,0,0.025) 1px, transparent 1px, transparent 2px), linear-gradient(180deg, #ececec 0%, #dadada 100%)';

/**
 * DraggableWindow — drag by titlebar, focus on mousedown anywhere, traffic
 * lights act as close/minimize/maximize. Resizable from the SE corner.
 *
 * State is held in the BerryShell windowStore (see ./store/windowStore.ts).
 * This is a deep port of BerryCC0/berry's WindowManager + Window components,
 * compressed into one file and stripped of features we're not yet using
 * (snap zones, expose, mobile sheets, era theming).
 */
export default function DraggableWindow({ win, children }: DraggableWindowProps) {
  const [hoverLights, setHoverLights] = useState(false);
  const dragStateRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(
    null,
  );
  const resizeStateRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);

  // Bind global pointermove/up so dragging keeps working when the cursor
  // leaves the title bar.
  useEffect(() => {
    function onPointerMove(e: PointerEvent) {
      if (dragStateRef.current && e.pointerId === dragStateRef.current.pointerId) {
        const { offsetX, offsetY } = dragStateRef.current;
        windowStore.move(win.id, e.clientX - offsetX, e.clientY - offsetY);
      } else if (resizeStateRef.current && e.pointerId === resizeStateRef.current.pointerId) {
        const { startX, startY, startW, startH } = resizeStateRef.current;
        windowStore.resize(win.id, startW + (e.clientX - startX), startH + (e.clientY - startY));
      }
    }
    function onPointerUp(e: PointerEvent) {
      if (dragStateRef.current?.pointerId === e.pointerId) dragStateRef.current = null;
      if (resizeStateRef.current?.pointerId === e.pointerId) resizeStateRef.current = null;
    }
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
    };
  }, [win.id]);

  if (win.isMinimized) return null;

  // Compute display geometry — maximize fills viewport between menu bar + dock.
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const displayX = win.isMaximized ? 0 : win.x;
  const displayY = win.isMaximized ? 24 : win.y;
  const displayW = win.isMaximized ? vw : win.width;
  const displayH = win.isMaximized ? vh - 24 - 76 : win.height;

  return (
    <div
      role="dialog"
      aria-label={win.title}
      onPointerDown={() => windowStore.focus(win.id)}
      style={{
        position: 'absolute',
        left: displayX,
        top: displayY,
        width: displayW,
        height: displayH,
        zIndex: win.zIndex,
        background: 'var(--theme-bg-card)',
        border: '1px solid var(--theme-border-strong)',
        // Aqua-style soft drop shadow when focused, lighter when not. Keep the
        // 1px inner bevel for the System 7-era window outline so it doesn't
        // look completely modern.
        boxShadow: win.isFocused
          ? 'inset 1px 1px 0 var(--theme-bevel-light), inset -1px -1px 0 var(--theme-bevel-dark), 0 8px 24px rgba(0, 0, 0, 0.28), 0 2px 6px rgba(0, 0, 0, 0.18)'
          : 'inset 1px 1px 0 var(--theme-bevel-light), inset -1px -1px 0 var(--theme-bevel-dark), 0 4px 12px rgba(0, 0, 0, 0.18)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        overflow: 'hidden',
        fontFamily: 'var(--theme-font-display)',
      }}
    >
      {/* Title bar — drag handle */}
      <div
        onPointerDown={e => {
          // Only the bar itself should start drag; traffic lights handle their own clicks.
          if ((e.target as HTMLElement).dataset.role === 'traffic-light') return;
          if (win.isMaximized) return; // don't drag a maximized window
          e.preventDefault();
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
          dragStateRef.current = {
            pointerId: e.pointerId,
            offsetX: e.clientX - win.x,
            offsetY: e.clientY - win.y,
          };
          windowStore.focus(win.id);
        }}
        onDoubleClick={() => windowStore.maximize(win.id)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '4px 8px',
          background: win.isFocused ? PINSTRIPE_BG : PINSTRIPE_BG_INACTIVE,
          borderBottom: '1px solid var(--theme-border-strong)',
          boxShadow: win.isFocused
            ? 'inset 0 1px 0 rgba(255,255,255,0.9), inset 0 -1px 0 rgba(0,0,0,0.08)'
            : 'inset 0 1px 0 rgba(255,255,255,0.6)',
          minHeight: 22,
          userSelect: 'none',
          cursor: win.isMaximized ? 'default' : 'grab',
          touchAction: 'none',
        }}
      >
        <div
          style={{ display: 'flex', gap: 6, alignItems: 'center' }}
          onMouseEnter={() => setHoverLights(true)}
          onMouseLeave={() => setHoverLights(false)}
        >
          <button
            type="button"
            data-role="traffic-light"
            aria-label="Close"
            onClick={() => windowStore.close(win.id)}
            style={{ ...trafficLightBase, ...trafficLightClose }}
          >
            <span data-role="traffic-light" aria-hidden="true">
              {hoverLights ? '×' : ''}
            </span>
          </button>
          <button
            type="button"
            data-role="traffic-light"
            aria-label="Minimize"
            onClick={() => windowStore.minimize(win.id)}
            style={{ ...trafficLightBase, ...trafficLightMin }}
          >
            <span data-role="traffic-light" aria-hidden="true">
              {hoverLights ? '−' : ''}
            </span>
          </button>
          <button
            type="button"
            data-role="traffic-light"
            aria-label="Maximize"
            onClick={() => windowStore.maximize(win.id)}
            style={{ ...trafficLightBase, ...trafficLightMax }}
          >
            <span data-role="traffic-light" aria-hidden="true">
              {hoverLights ? '+' : ''}
            </span>
          </button>
        </div>
        <div
          style={{
            flex: 1,
            textAlign: 'center',
            fontSize: 12,
            fontWeight: 700,
            color: 'var(--theme-text-primary)',
            letterSpacing: 0.3,
            // Compensate for the stoplight cluster on the left so the title
            // sits visually centered in the bar.
            paddingRight: 61,
            opacity: win.isFocused ? 1 : 0.55,
            textShadow: win.isFocused ? '0 1px 0 rgba(255,255,255,0.7)' : 'none',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {win.title}
        </div>
      </div>

      {/* Content well */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          background: 'var(--theme-bg-tertiary)',
        }}
      >
        {children}
      </div>

      {/* Resize handle (SE) */}
      {!win.isMaximized && (
        <div
          onPointerDown={e => {
            e.preventDefault();
            e.stopPropagation();
            (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
            resizeStateRef.current = {
              pointerId: e.pointerId,
              startX: e.clientX,
              startY: e.clientY,
              startW: win.width,
              startH: win.height,
            };
            windowStore.focus(win.id);
          }}
          aria-hidden="true"
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: 14,
            height: 14,
            cursor: 'nwse-resize',
            background:
              'linear-gradient(135deg, transparent 0%, transparent 45%, var(--theme-border-strong) 45%, var(--theme-border-strong) 55%, transparent 55%, transparent 75%, var(--theme-border-strong) 75%, var(--theme-border-strong) 85%, transparent 85%)',
            touchAction: 'none',
          }}
        />
      )}
    </div>
  );
}
