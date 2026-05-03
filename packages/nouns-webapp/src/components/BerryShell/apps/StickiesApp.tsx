/**
 * StickiesApp — yellow post-it notes that live inside the Stickies window.
 *
 * Each sticky is a draggable + resizable mini-window inside the parent
 * BerryOS window. We don't piggy-back on `windowStore` because stickies are
 * scoped to this app's surface (they shouldn't show up in the focus stack
 * alongside Calculator, etc.).
 *
 * Persistence:
 *   localStorage key `berry.stickies` — full sticky array.
 *
 * Self-registers via `berryRegistry.register(...)`.
 */
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';

import { GlassButton } from '@/liquid-sand/glass';
import { Brush, Close, StickyNote } from '@/liquid-sand/icons';

import { berryRegistry } from '../system/berryRegistry';

// ---------------------------------------------------------------------------
// Types + persistence
// ---------------------------------------------------------------------------

interface Sticky {
  id: string;
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Index into COLORS — colour cycle on click. */
  color: number;
  z: number;
}

const STORAGE_KEY = 'berry.stickies';

// Sand-tinted sticky palette — warm pastels reading well on the sand backdrop.
const COLORS: ReadonlyArray<{ bg: string; head: string; border: string }> = [
  { bg: 'rgba(255, 245, 168, 0.92)', head: 'rgba(255, 227, 90, 0.95)', border: 'rgba(212, 190, 62, 0.65)' }, // canary
  { bg: 'rgba(255, 209, 209, 0.92)', head: 'rgba(255, 155, 155, 0.95)', border: 'rgba(212, 115, 115, 0.65)' }, // pink
  { bg: 'rgba(209, 240, 255, 0.92)', head: 'rgba(155, 217, 255, 0.95)', border: 'rgba(115, 169, 212, 0.65)' }, // blue
  { bg: 'rgba(212, 255, 212, 0.92)', head: 'rgba(155, 240, 155, 0.95)', border: 'rgba(115, 196, 115, 0.65)' }, // green
  { bg: 'rgba(232, 209, 255, 0.92)', head: 'rgba(200, 155, 255, 0.95)', border: 'rgba(156, 115, 212, 0.65)' }, // purple
];

function readStickies(): Sticky[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (s): s is Sticky =>
        !!s &&
        typeof s === 'object' &&
        typeof (s as Sticky).id === 'string' &&
        typeof (s as Sticky).text === 'string',
    );
  } catch {
    return [];
  }
}

function writeStickies(stickies: Sticky[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(stickies));
  } catch {
    /* quota / disabled — silently degrade */
  }
}

function genId(): string {
  return `sticky-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// Single sticky note — draggable header, resize handle in bottom-right.
// ---------------------------------------------------------------------------

interface StickyNoteProps {
  sticky: Sticky;
  onUpdate: (next: Sticky) => void;
  onClose: () => void;
  onCycleColor: () => void;
  onFocus: () => void;
  parentRef: React.RefObject<HTMLDivElement | null>;
}

function StickyNoteCard({ sticky, onUpdate, onClose, onCycleColor, onFocus, parentRef }: StickyNoteProps): ReactElement {
  const c = COLORS[sticky.color % COLORS.length];

  // Drag state — track a single pointer. Pointer capture keeps us receiving
  // moves even if the cursor leaves the parent.
  const dragRef = useRef<{
    mode: 'move' | 'resize' | null;
    startX: number;
    startY: number;
    startStickyX: number;
    startStickyY: number;
    startW: number;
    startH: number;
    pointerId: number;
  } | null>(null);

  const onHeaderPointerDown = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('[data-sticky-action]')) return;
    onFocus();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      mode: 'move',
      startX: e.clientX,
      startY: e.clientY,
      startStickyX: sticky.x,
      startStickyY: sticky.y,
      startW: sticky.w,
      startH: sticky.h,
      pointerId: e.pointerId,
    };
  };

  const onResizePointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    onFocus();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      mode: 'resize',
      startX: e.clientX,
      startY: e.clientY,
      startStickyX: sticky.x,
      startStickyY: sticky.y,
      startW: sticky.w,
      startH: sticky.h,
      pointerId: e.pointerId,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (d.mode === 'move') {
      const parent = parentRef.current;
      const maxX = parent ? parent.clientWidth - sticky.w : 99999;
      const maxY = parent ? parent.clientHeight - sticky.h : 99999;
      onUpdate({
        ...sticky,
        x: Math.max(0, Math.min(maxX, d.startStickyX + dx)),
        y: Math.max(0, Math.min(maxY, d.startStickyY + dy)),
      });
    } else if (d.mode === 'resize') {
      onUpdate({
        ...sticky,
        w: Math.max(110, d.startW + dx),
        h: Math.max(80, d.startH + dy),
      });
    }
  };

  const onPointerUp = (_e: React.PointerEvent) => {
    dragRef.current = null;
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: sticky.x,
        top: sticky.y,
        width: sticky.w,
        height: sticky.h,
        background: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: 'var(--ls-r-md)',
        display: 'flex',
        flexDirection: 'column',
        boxShadow:
          'var(--ls-shadow-inset-glass), 0 6px 14px rgba(60,45,25,0.18), 0 1px 3px rgba(60,45,25,0.12)',
        zIndex: sticky.z,
        overflow: 'hidden',
        fontFamily: 'var(--ls-font-sans)',
        backdropFilter: 'blur(var(--ls-blur-subtle))',
        WebkitBackdropFilter: 'blur(var(--ls-blur-subtle))',
      }}
      onPointerDown={onFocus}
    >
      {/* Header — drag handle + close + color */}
      <div
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          height: 22,
          background: c.head,
          borderBottom: `1px solid ${c.border}`,
          display: 'flex',
          alignItems: 'center',
          padding: '0 6px',
          gap: 6,
          cursor: 'grab',
          userSelect: 'none',
          touchAction: 'none',
        }}
      >
        <button
          type="button"
          data-sticky-action
          aria-label="Close sticky"
          onClick={onClose}
          className="inline-flex items-center justify-center"
          style={{
            width: 14,
            height: 14,
            borderRadius: 'var(--ls-r-full)',
            background: 'rgba(255, 95, 86, 0.9)',
            border: '1px solid rgba(183, 60, 51, 0.6)',
            padding: 0,
            cursor: 'pointer',
            color: 'rgba(255,255,255,0.9)',
          }}
        >
          <Close size={9} strokeWidth={2.5} />
        </button>
        <button
          type="button"
          data-sticky-action
          aria-label="Cycle color"
          onClick={onCycleColor}
          className="inline-flex items-center justify-center"
          style={{
            width: 14,
            height: 14,
            borderRadius: 'var(--ls-r-full)',
            background: 'rgba(255, 189, 46, 0.9)',
            border: '1px solid rgba(184, 128, 28, 0.6)',
            padding: 0,
            cursor: 'pointer',
            color: 'rgba(60,45,25,0.85)',
          }}
        >
          <Brush size={8} strokeWidth={2.5} />
        </button>
        <span style={{ flex: 1 }} />
      </div>

      {/* Editable text */}
      <textarea
        value={sticky.text}
        onChange={e => onUpdate({ ...sticky, text: e.target.value })}
        placeholder="Type a note…"
        style={{
          flex: 1,
          width: '100%',
          background: 'transparent',
          border: 'none',
          padding: 8,
          resize: 'none',
          outline: 'none',
          fontFamily: 'var(--ls-font-sans)',
          fontSize: 12,
          color: 'var(--ls-sand-900)',
          lineHeight: 1.4,
          boxSizing: 'border-box',
        }}
      />

      {/* Resize handle */}
      <div
        onPointerDown={onResizePointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          position: 'absolute',
          right: 0,
          bottom: 0,
          width: 14,
          height: 14,
          cursor: 'nwse-resize',
          background:
            'linear-gradient(135deg, transparent 0 50%, rgba(60,45,25,0.18) 50% 60%, transparent 60% 70%, rgba(60,45,25,0.18) 70% 80%, transparent 80%)',
          touchAction: 'none',
        }}
        aria-label="Resize sticky"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

function StickiesApp(): ReactElement {
  const [stickies, setStickies] = useState<Sticky[]>(() => readStickies());
  const parentRef = useRef<HTMLDivElement>(null);
  const nextZ = useRef<number>(stickies.reduce((m, s) => Math.max(m, s.z), 1) + 1);

  // Persist on every change.
  useEffect(() => {
    writeStickies(stickies);
  }, [stickies]);

  const update = useCallback((next: Sticky) => {
    setStickies(prev => prev.map(s => (s.id === next.id ? next : s)));
  }, []);

  const focusSticky = useCallback((id: string) => {
    setStickies(prev => prev.map(s => (s.id === id ? { ...s, z: nextZ.current++ } : s)));
  }, []);

  const closeSticky = useCallback((id: string) => {
    setStickies(prev => prev.filter(s => s.id !== id));
  }, []);

  const cycleColor = useCallback((id: string) => {
    setStickies(prev =>
      prev.map(s => (s.id === id ? { ...s, color: (s.color + 1) % COLORS.length } : s)),
    );
  }, []);

  const addSticky = useCallback(() => {
    const parent = parentRef.current;
    const w = 160;
    const h = 130;
    // Cascade — offset 16px from the last sticky if any, else center-ish.
    const last = stickies.length ? stickies[stickies.length - 1] : null;
    const baseX = last ? last.x + 18 : 16;
    const baseY = last ? last.y + 18 : 36;
    const maxX = parent ? Math.max(0, parent.clientWidth - w - 4) : 200;
    const maxY = parent ? Math.max(0, parent.clientHeight - h - 4) : 200;
    setStickies(prev => [
      ...prev,
      {
        id: genId(),
        text: '',
        x: Math.min(baseX, maxX),
        y: Math.min(baseY, maxY),
        w,
        h,
        color: (last?.color ?? -1) + 1,
        z: nextZ.current++,
      },
    ]);
  }, [stickies]);

  // Auto-spawn first sticky if storage is empty so the app isn't a void.
  useEffect(() => {
    if (stickies.length === 0) {
      const t = window.setTimeout(() => addSticky(), 100);
      return () => window.clearTimeout(t);
    }
    // empty cleanup — nothing to do on remount when stickies already exist
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={parentRef}
      style={{
        position: 'relative',
        height: '100%',
        width: '100%',
        // Soft sand cross-hatch backdrop — readable behind translucent stickies.
        background:
          'repeating-linear-gradient(45deg, var(--ls-sand-50) 0 8px, var(--ls-sand-100) 8px 16px)',
        overflow: 'hidden',
      }}
    >
      {/* New sticky button — floating glass action */}
      <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 100000 }}>
        <GlassButton
          variant="default"
          size="sm"
          onClick={addSticky}
          title="New sticky"
          aria-label="New sticky"
        >
          <StickyNote size={14} />
          New
        </GlassButton>
      </div>

      {stickies.map(s => (
        <StickyNoteCard
          key={s.id}
          sticky={s}
          parentRef={parentRef}
          onUpdate={update}
          onClose={() => closeSticky(s.id)}
          onCycleColor={() => cycleColor(s.id)}
          onFocus={() => focusSticky(s.id)}
        />
      ))}
    </div>
  );
}

berryRegistry.register({
  id: 'stickies',
  name: 'Stickies',
  icon: '📝',
  component: StickiesApp,
  defaultWindow: { w: 200, h: 200 },
  capabilities: [],
});

export default StickiesApp;
