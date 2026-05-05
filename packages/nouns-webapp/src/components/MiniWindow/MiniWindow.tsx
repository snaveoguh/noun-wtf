import { useEffect, useRef } from 'react';

import { miniWindowStore, type MiniWindowState } from './store';

interface MiniWindowProps {
  win: MiniWindowState;
}

/**
 * Single floating window. Drag by titlebar, click anywhere to focus, × to
 * close. Themed to match the GameShell dark dashboard but mounted via a
 * portal so it floats above any shell.
 */
export default function MiniWindow({ win }: MiniWindowProps) {
  const dragStateRef = useRef<{ pointerId: number; offsetX: number; offsetY: number } | null>(null);

  useEffect(() => {
    function onPointerMove(e: PointerEvent) {
      const drag = dragStateRef.current;
      if (!drag || e.pointerId !== drag.pointerId) return;
      // Clamp so the title bar can never be dragged off-screen.
      const x = Math.max(0, Math.min(window.innerWidth - 80, e.clientX - drag.offsetX));
      const y = Math.max(0, Math.min(window.innerHeight - 32, e.clientY - drag.offsetY));
      miniWindowStore.move(win.id, x, y);
    }
    function onPointerUp(e: PointerEvent) {
      if (dragStateRef.current?.pointerId === e.pointerId) dragStateRef.current = null;
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

  return (
    <div
      role="dialog"
      aria-label={win.title}
      onPointerDown={() => miniWindowStore.focus(win.id)}
      style={{
        position: 'fixed',
        left: win.x,
        top: win.y,
        width: win.width,
        height: win.height,
        zIndex: win.zIndex,
        background: 'var(--gs-panel-bg, #0f0f14)',
        border: '1px solid var(--gs-border, rgba(255,255,255,0.08))',
        borderRadius: 12,
        boxShadow:
          '0 24px 60px rgba(0,0,0,0.55), 0 6px 18px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        color: 'var(--gs-text, #e6e6f0)',
        fontFamily: 'var(--gs-font, system-ui, -apple-system, sans-serif)',
      }}
    >
      <header
        onPointerDown={e => {
          // Capture drag handle without preventing the focus-on-mousedown on the parent.
          if (e.button !== 0) return;
          dragStateRef.current = {
            pointerId: e.pointerId,
            offsetX: e.clientX - win.x,
            offsetY: e.clientY - win.y,
          };
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 14px',
          borderBottom: '1px solid var(--gs-border, rgba(255,255,255,0.08))',
          background:
            'linear-gradient(180deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0.01) 100%)',
          cursor: 'grab',
          userSelect: 'none',
          flex: '0 0 auto',
        }}
      >
        <span
          style={{
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: 0.2,
            color: 'var(--gs-text, #e6e6f0)',
            flex: 1,
          }}
        >
          {win.title}
        </span>
        <button
          type="button"
          aria-label="Close"
          onPointerDown={e => e.stopPropagation()}
          onClick={() => miniWindowStore.close(win.id)}
          style={{
            width: 22,
            height: 22,
            borderRadius: 11,
            border: '1px solid rgba(255,255,255,0.1)',
            background: 'rgba(255,255,255,0.04)',
            color: 'var(--gs-text-muted, #9999a8)',
            fontSize: 14,
            lineHeight: 1,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
          }}
        >
          ×
        </button>
      </header>
      <div
        style={{
          flex: '1 1 auto',
          overflow: 'auto',
          padding: 16,
        }}
      >
        {win.content}
      </div>
    </div>
  );
}
