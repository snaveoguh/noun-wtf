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

const COLORS: ReadonlyArray<{ bg: string; head: string; border: string }> = [
  { bg: '#fff5a8', head: '#ffe35a', border: '#d4be3e' }, // canary yellow
  { bg: '#ffd1d1', head: '#ff9b9b', border: '#d47373' }, // pink
  { bg: '#d1f0ff', head: '#9bd9ff', border: '#73a9d4' }, // blue
  { bg: '#d4ffd4', head: '#9bf09b', border: '#73c473' }, // green
  { bg: '#e8d1ff', head: '#c89bff', border: '#9c73d4' }, // purple
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

function StickyNote({ sticky, onUpdate, onClose, onCycleColor, onFocus, parentRef }: StickyNoteProps): ReactElement {
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
        borderRadius: 2,
        display: 'flex',
        flexDirection: 'column',
        boxShadow:
          '0 6px 12px rgba(0, 0, 0, 0.18), 0 1px 3px rgba(0, 0, 0, 0.12), inset 0 1px 0 rgba(255, 255, 255, 0.5)',
        zIndex: sticky.z,
        overflow: 'hidden',
        fontFamily: 'var(--theme-font-display)',
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
          height: 18,
          background: c.head,
          borderBottom: `1px solid ${c.border}`,
          display: 'flex',
          alignItems: 'center',
          padding: '0 4px',
          gap: 4,
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
          style={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            background: '#ff5f56',
            border: '1px solid #b73c33',
            padding: 0,
            cursor: 'pointer',
          }}
        />
        <button
          type="button"
          data-sticky-action
          aria-label="Cycle color"
          onClick={onCycleColor}
          style={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            background: '#ffbd2e',
            border: '1px solid #b8801c',
            padding: 0,
            cursor: 'pointer',
          }}
        />
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
          fontFamily: 'var(--theme-font-display)',
          fontSize: 12,
          color: '#222',
          lineHeight: 1.35,
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
            'linear-gradient(135deg, transparent 0 50%, rgba(0,0,0,0.18) 50% 60%, transparent 60% 70%, rgba(0,0,0,0.18) 70% 80%, transparent 80%)',
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
        background: 'repeating-linear-gradient(45deg, #f4eee2 0 8px, #ede6d4 8px 16px)',
        overflow: 'hidden',
      }}
    >
      {/* New sticky button */}
      <button
        type="button"
        onClick={addSticky}
        title="New sticky"
        style={{
          position: 'absolute',
          top: 6,
          right: 6,
          zIndex: 100000,
          width: 26,
          height: 26,
          borderRadius: 4,
          background: 'rgba(255, 255, 255, 0.7)',
          border: '1px solid rgba(0, 0, 0, 0.3)',
          fontSize: 16,
          fontFamily: 'var(--theme-font-display)',
          cursor: 'pointer',
          padding: 0,
          lineHeight: 1,
        }}
      >
        +
      </button>

      {stickies.map(s => (
        <StickyNote
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
