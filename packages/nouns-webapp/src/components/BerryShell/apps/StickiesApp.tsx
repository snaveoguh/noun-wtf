/**
 * StickiesApp — sand-tone post-it notes that live inside the Stickies window.
 *
 * Each sticky is a draggable + resizable mini-window inside the parent
 * BerryOS window. We don't piggy-back on `windowStore` because stickies are
 * scoped to this app's surface (they shouldn't show up in the focus stack
 * alongside Calculator, etc.).
 *
 * HIG / Liquid Sand notes:
 *   - The note paper is intentionally SOLID (no glass / no backdrop blur).
 *     Glass over text fails 4.5:1 contrast and HIG flags it as a no-go.
 *   - Title bar uses Silkscreen 11pt for the date pill — keeps the chrome
 *     readable at small sizes and matches the rest of BerryOS chrome.
 *   - Body uses 17pt SF (system stack) at line-height 1.35 — HIG body size
 *     for editing comfort.
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
  /** Creation timestamp (ms). Drives the title-bar date pill. */
  createdAt: number;
}

const STORAGE_KEY = 'berry.stickies';

// SAND-TONE sticky palette — solid (no alpha tricks) so the note paper stays
// on the right side of the contrast line. Each entry has a `paper` body, a
// `head` title strip, and a `border` hairline. Tones drift through the warm
// sand spectrum so cycling colours doesn't feel like jumping shells.
const COLORS: ReadonlyArray<{ paper: string; head: string; border: string; ink: string }> = [
  // canary sand
  { paper: '#fdf3b2', head: '#f4e389', border: '#c8b14a', ink: '#3d3110' },
  // dusty rose
  { paper: '#f8d4d4', head: '#efb6b6', border: '#c47a7a', ink: '#3a1a1a' },
  // pale sky
  { paper: '#d4ebf8', head: '#b6d6ef', border: '#7a9bc4', ink: '#0f2a3d' },
  // mint
  { paper: '#d6f0d6', head: '#b6e0b6', border: '#7ab07a', ink: '#143a14' },
  // lavender
  { paper: '#e6d6f0', head: '#cab6e0', border: '#9c7ab0', ink: '#26143a' },
];

function readStickies(): Sticky[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null || raw === '') return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    // Migration: old stickies (pre date-pill) lack `createdAt`. We type the
    // raw record as `Partial<Sticky>` while validating, then backfill the
    // missing field in a single explicit construction below — no spread +
    // override, so there's no duplicate-key shadowing.
    return parsed
      .filter(
        (s): s is Partial<Sticky> & Pick<Sticky, 'id' | 'text'> =>
          s !== null &&
          typeof s === 'object' &&
          typeof (s as Partial<Sticky>).id === 'string' &&
          typeof (s as Partial<Sticky>).text === 'string',
      )
      .map(
        (s): Sticky => ({
          id: s.id,
          text: s.text,
          x: typeof s.x === 'number' ? s.x : 16,
          y: typeof s.y === 'number' ? s.y : 36,
          w: typeof s.w === 'number' ? s.w : 220,
          h: typeof s.h === 'number' ? s.h : 200,
          color: typeof s.color === 'number' ? s.color : 0,
          z: typeof s.z === 'number' ? s.z : 1,
          // Backfill `createdAt` for stickies persisted before the field existed.
          createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now(),
        }),
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

/** Format a sticky's createdAt timestamp into a tiny date pill (e.g. "MAY 03"). */
function formatStickyDate(ts: number): string {
  try {
    const d = new Date(ts);
    const month = d.toLocaleString('en-US', { month: 'short' }).toUpperCase();
    const day = String(d.getDate()).padStart(2, '0');
    return `${month} ${day}`;
  } catch {
    return '';
  }
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

function StickyNoteCard({
  sticky,
  onUpdate,
  onClose,
  onCycleColor,
  onFocus,
  parentRef,
}: StickyNoteProps): ReactElement {
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
        w: Math.max(140, d.startW + dx),
        h: Math.max(120, d.startH + dy),
      });
    }
  };

  const onPointerUp = () => {
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
        // Solid sand-tone paper — NO glass / NO backdrop blur. Text contrast
        // and edit comfort win over translucent prettiness here.
        background: c.paper,
        border: `1px solid ${c.border}`,
        borderRadius: 'var(--ls-r-md)',
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 1px 2px rgba(60,45,25,0.10), 0 6px 14px rgba(60,45,25,0.18)',
        zIndex: sticky.z,
        overflow: 'hidden',
        fontFamily: 'var(--ls-font-sans)',
      }}
      onPointerDown={onFocus}
    >
      {/* Title bar — Silkscreen 11pt date pill on a slightly darker tone of
          the paper. Drag handle. Buttons are HIG 28pt min hit-area. */}
      <div
        onPointerDown={onHeaderPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          height: 28,
          background: c.head,
          borderBottom: `1px solid ${c.border}`,
          display: 'flex',
          alignItems: 'center',
          padding: '0 8px',
          gap: 8,
          cursor: 'grab',
          userSelect: 'none',
          touchAction: 'none',
        }}
      >
        <button
          type="button"
          data-sticky-action
          aria-label="Close sticky"
          title="Close sticky"
          onClick={onClose}
          className="inline-flex items-center justify-center"
          style={{
            width: 18,
            height: 18,
            borderRadius: 'var(--ls-r-full)',
            background: 'rgba(255, 95, 86, 0.92)',
            border: '1px solid rgba(183, 60, 51, 0.6)',
            padding: 0,
            cursor: 'pointer',
            color: 'rgba(255,255,255,0.95)',
          }}
        >
          <Close size={10} strokeWidth={2.5} />
        </button>
        <button
          type="button"
          data-sticky-action
          aria-label="Cycle color"
          title="Cycle color"
          onClick={onCycleColor}
          className="inline-flex items-center justify-center"
          style={{
            width: 18,
            height: 18,
            borderRadius: 'var(--ls-r-full)',
            background: 'rgba(255, 189, 46, 0.92)',
            border: '1px solid rgba(184, 128, 28, 0.6)',
            padding: 0,
            cursor: 'pointer',
            color: 'rgba(60,45,25,0.85)',
          }}
        >
          <Brush size={10} strokeWidth={2.5} />
        </button>
        <span style={{ flex: 1 }} />
        {/* Date pill — Silkscreen 11pt per app brief. */}
        <span
          aria-hidden
          style={{
            fontFamily: 'var(--ls-font-display)',
            fontSize: 11,
            lineHeight: 1,
            letterSpacing: 0.6,
            color: c.ink,
            opacity: 0.7,
            fontVariantNumeric: 'tabular-nums',
            userSelect: 'none',
          }}
        >
          {formatStickyDate(sticky.createdAt)}
        </span>
      </div>

      {/* Body — HIG body 17pt SF, line-height 1.35 for editing comfort. */}
      <textarea
        value={sticky.text}
        onChange={e => onUpdate({ ...sticky, text: e.target.value })}
        placeholder="Type a note…"
        style={{
          flex: 1,
          width: '100%',
          background: 'transparent',
          border: 'none',
          padding: 12,
          resize: 'none',
          outline: 'none',
          fontFamily: 'var(--ls-font-sans)',
          fontSize: 'var(--ls-text-lg)',
          color: c.ink,
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
    const w = 220;
    const h = 200;
    // Cascade — offset 18px from the last sticky if any, else center-ish.
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
        createdAt: Date.now(),
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
        // Soft sand cross-hatch backdrop — readable behind solid stickies.
        background:
          'repeating-linear-gradient(45deg, var(--ls-sand-50) 0 8px, var(--ls-sand-100) 8px 16px)',
        overflow: 'hidden',
      }}
    >
      {/* New sticky button — floating GlassButton action */}
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
  defaultWindow: { w: 320, h: 320 },
  capabilities: [],
});

export default StickiesApp;
