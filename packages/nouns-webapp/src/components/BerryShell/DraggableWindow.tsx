import { useEffect, useRef, useState, type ReactNode } from 'react';

import { GlassWindow } from '@/liquid-sand/glass';
import { Close, Maximize, Minimize } from '@/liquid-sand/icons';

import { type BerryWindowState, windowStore } from './store/windowStore';

interface DraggableWindowProps {
  win: BerryWindowState;
  children: ReactNode;
}

/**
 * Liquid Sand traffic-light orb. A small frosted-glass disc in muted sepia
 * with the monoline glyph on hover. Three tones (close/min/max) follow the
 * same warm sepia palette — they read as "berry red, sand yellow, olive
 * green" rather than the macOS primary trio.
 */
function MonolineOrb({
  tone,
  label,
  Icon,
  hover,
  onClick,
}: {
  tone: 'close' | 'min' | 'max';
  label: string;
  Icon: typeof Close;
  hover: boolean;
  onClick: () => void;
}) {
  const colorByTone: Record<typeof tone, string> = {
    close: '#c2492f', // var(--ls-danger), warm berry red
    min: '#d4b67a', // var(--ls-sand-300), sand yellow
    max: '#7a8b3c', // var(--ls-success), olive green
  };
  return (
    <button
      type="button"
      data-role="traffic-light"
      aria-label={label}
      onClick={onClick}
      style={{
        width: 14,
        height: 14,
        padding: 0,
        borderRadius: 999,
        border: 'none',
        background: colorByTone[tone],
        boxShadow:
          'inset 0 1px 0 rgba(255, 250, 240, 0.45), inset 0 -1px 0 rgba(60,45,25,0.18), 0 0 0 1px var(--ls-border-glass)',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'rgba(60,45,25,0.85)',
        transition: 'transform var(--ls-dur-fast) var(--ls-ease-spring)',
      }}
      onPointerDown={e => {
        // Prevent the drag handler on the title bar from also firing.
        e.stopPropagation();
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'scale(1.08)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'scale(1)';
      }}
    >
      <span
        data-role="traffic-light"
        aria-hidden="true"
        style={{
          opacity: hover ? 1 : 0,
          transition: 'opacity var(--ls-dur-fast) var(--ls-ease-soft)',
          display: 'inline-flex',
        }}
      >
        <Icon size={9} />
      </span>
    </button>
  );
}

/**
 * DraggableWindow — drag by titlebar, focus on mousedown anywhere, traffic
 * lights act as close/minimize/maximize. Resizable from the SE corner.
 *
 * Liquid Sand chrome: wraps the inner content in <GlassWindow>, swaps the
 * Aqua-era gel buttons for monoline orbs that show their glyph on hover, and
 * uses the warm sand glow ring on the active window. All the original
 * behavior (drag, resize, focus on click, double-click maximize) is preserved.
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
  const displayY = win.isMaximized ? 28 : win.y;
  const displayW = win.isMaximized ? vw : win.width;
  const displayH = win.isMaximized ? vh - 28 - 76 : win.height;

  // Custom titlebar: monoline orbs on the left, centered title.
  const titlebar = (
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
        gap: 'var(--ls-s-2)',
        // GlassWindow gives us h-9 / 36px and the gradient — fill it.
        height: '100%',
        cursor: win.isMaximized ? 'default' : 'grab',
        touchAction: 'none',
        userSelect: 'none',
        width: '100%',
      }}
    >
      <div
        style={{ display: 'flex', gap: 6, alignItems: 'center' }}
        onMouseEnter={() => setHoverLights(true)}
        onMouseLeave={() => setHoverLights(false)}
      >
        <MonolineOrb
          tone="close"
          label="Close"
          Icon={Close}
          hover={hoverLights}
          onClick={() => windowStore.close(win.id)}
        />
        <MonolineOrb
          tone="min"
          label="Minimize"
          Icon={Minimize}
          hover={hoverLights}
          onClick={() => windowStore.minimize(win.id)}
        />
        <MonolineOrb
          tone="max"
          label="Maximize"
          Icon={Maximize}
          hover={hoverLights}
          onClick={() => windowStore.maximize(win.id)}
        />
      </div>
      <div
        style={{
          flex: 1,
          textAlign: 'center',
          fontFamily: 'var(--ls-font-sans)',
          fontSize: 12,
          fontWeight: 500,
          color: 'var(--ls-fg-primary)',
          letterSpacing: 0.1,
          // Compensate for the orb cluster on the left so the title sits visually centered.
          paddingRight: 60,
          opacity: win.isFocused ? 1 : 0.55,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {win.title}
      </div>
    </div>
  );

  return (
    <GlassWindow
      role="dialog"
      aria-label={win.title}
      onPointerDown={() => windowStore.focus(win.id)}
      active={win.isFocused}
      showTrafficLights={false}
      titlebar={titlebar}
      titlebarClassName="px-2"
      contentClassName="bg-transparent"
      style={{
        position: 'absolute',
        left: displayX,
        top: displayY,
        width: displayW,
        height: displayH,
        zIndex: win.zIndex,
        // GlassWindow already handles backdrop-filter + the inset glass shadow;
        // we only override what we need (geometry + zIndex).
        fontFamily: 'var(--ls-font-sans)',
      }}
    >
      <div
        style={{
          position: 'relative',
          height: '100%',
          minHeight: 0,
          overflow: 'auto',
        }}
      >
        {children}
        {/* Resize handle (SE) — kept inside the content well so it doesn't
            clip against the rounded glass shell. */}
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
              position: 'sticky',
              float: 'right',
              right: 0,
              bottom: 0,
              width: 14,
              height: 14,
              marginLeft: 'auto',
              marginTop: -14,
              cursor: 'nwse-resize',
              background:
                'linear-gradient(135deg, transparent 0%, transparent 45%, var(--ls-fg-muted) 45%, var(--ls-fg-muted) 55%, transparent 55%, transparent 75%, var(--ls-fg-muted) 75%, var(--ls-fg-muted) 85%, transparent 85%)',
              opacity: 0.5,
              touchAction: 'none',
            }}
          />
        )}
      </div>
    </GlassWindow>
  );
}
