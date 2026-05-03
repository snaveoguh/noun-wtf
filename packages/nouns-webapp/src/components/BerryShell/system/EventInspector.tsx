/**
 * Event Inspector — draggable always-on-top panel for live demo of the bus.
 *
 * Features:
 *   - Hovers above all windows when toggled on.
 *   - Real-time stream of last ~20 events.
 *   - Click any row to expand the full payload as pretty JSON.
 *   - Cmd+Shift+I toggles visibility (registered with hotkeyManager when
 *     available, falls back to a window-level keydown listener so the
 *     toggle works even before the inspector mounts).
 *
 * Mount this inside BerryShell once (see `mount.tsx`) — it self-manages
 * visibility via a tiny external store so any code can toggle it via
 * `eventInspector.toggle()` regardless of where the component lives.
 */

import { useEffect, useRef, useState, useSyncExternalStore, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { GlassChip, GlassPanel } from '@/liquid-sand/glass';
import { Close as CloseIcon, CpuChip } from '@/liquid-sand/icons';

import { hotkeyManager } from './hotkeys';
import { berryBus } from './eventBus';
import {
  CATEGORY_COLOR,
  categoryFor,
  compactJson,
  formatTime,
  MONO_FONT,
  subtleButtonStyle,
} from './devtoolsStyles';
import {
  startBusHistory,
  subscribeHistory,
  type BusHistoryEntry,
} from './busHistory';

/* ----------------------------------------------------------------------- */
/* Visibility store                                                         */
/* ----------------------------------------------------------------------- */

type Listener = () => void;
let visible = false;
const visListeners = new Set<Listener>();

function notifyVisibility(): void {
  visListeners.forEach(l => l());
}

export const eventInspector = {
  toggle(): void {
    visible = !visible;
    notifyVisibility();
  },
  show(): void {
    if (visible) return;
    visible = true;
    notifyVisibility();
  },
  hide(): void {
    if (!visible) return;
    visible = false;
    notifyVisibility();
  },
  isVisible(): boolean {
    return visible;
  },
  subscribe(l: Listener): () => void {
    visListeners.add(l);
    return () => visListeners.delete(l);
  },
};

/* ----------------------------------------------------------------------- */
/* Hotkey wiring — installed once at module load                            */
/* ----------------------------------------------------------------------- */

let hotkeyInstalled = false;
function installHotkey(): void {
  if (hotkeyInstalled || typeof window === 'undefined') return;
  hotkeyInstalled = true;
  try {
    hotkeyManager.register({
      id: 'devtools-event-inspector-toggle',
      combo: 'cmd+shift+i',
      description: 'Toggle Event Inspector',
      scope: 'global',
      preventDefault: true,
      handler: () => eventInspector.toggle(),
    });
  } catch {
    // hotkeyManager may not be available in a future minimal build — fall
    // back to a raw window listener so the combo still works.
  }
  // Belt-and-braces: also listen at the document level so the inspector
  // toggle survives even if the hotkey manager is reset by tests.
  window.addEventListener(
    'keydown',
    e => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        (e.key === 'i' || e.key === 'I' || e.code === 'KeyI')
      ) {
        e.preventDefault();
        e.stopPropagation();
        eventInspector.toggle();
      }
    },
    true,
  );
}

if (typeof window !== 'undefined') installHotkey();

/* ----------------------------------------------------------------------- */
/* Self-mount portal                                                        */
/*                                                                          */
/* The inspector lives outside the BerryShell window manager (it floats     */
/* above all windows). Because we can't edit BerryShell, we mount our own   */
/* React root into a fresh <div> appended to <body> on first import.        */
/* React reconciles inside that root completely independently of the main   */
/* app — there's no portal magic, just a second tree.                       */
/* ----------------------------------------------------------------------- */

let mounted = false;
let mountRoot: Root | null = null;

function ensureMounted(): void {
  if (mounted || typeof document === 'undefined') return;
  mounted = true;
  const host = document.createElement('div');
  host.setAttribute('data-berryos-event-inspector-host', '');
  // Lock the host so it can't intercept layout — the inner panel uses
  // `position: fixed` so it positions itself relative to the viewport.
  host.style.position = 'fixed';
  host.style.top = '0';
  host.style.left = '0';
  host.style.width = '0';
  host.style.height = '0';
  host.style.zIndex = '99999';
  host.style.pointerEvents = 'none';
  document.body.appendChild(host);
  mountRoot = createRoot(host);
  // Wrapper re-enables pointer events on the panel itself.
  mountRoot.render(
    <div style={{ pointerEvents: 'auto' }}>
      <EventInspector />
    </div>,
  );
}

if (typeof window !== 'undefined') {
  // Wait a tick so EventInspector's own component definition is finalised
  // before we render it (also makes Vite HMR happy).
  setTimeout(() => ensureMounted(), 0);
}

/* ----------------------------------------------------------------------- */
/* Component                                                                */
/* ----------------------------------------------------------------------- */

/**
 * Pretty-print a payload for the expanded row. Falls back to `String(value)`
 * if JSON.stringify throws (cyclic refs, BigInts, etc.).
 */
function tryPretty(payload: unknown): string {
  try {
    return JSON.stringify(payload, null, 2);
  } catch {
    return String(payload);
  }
}

interface Pos {
  x: number;
  y: number;
}

const DEFAULT_POS: Pos = { x: 80, y: 80 };
const PANEL_W = 380;
const PANEL_H = 460;
const TAIL = 20;

export default function EventInspector(): ReactElement | null {
  const isVisible = useSyncExternalStore(
    cb => eventInspector.subscribe(cb),
    () => visible,
    () => false,
  );

  useEffect(() => {
    startBusHistory();
  }, []);

  const [pos, setPos] = useState<Pos>(DEFAULT_POS);
  const [entries, setEntries] = useState<BusHistoryEntry[]>([]);
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [sticky, setSticky] = useState(true);

  useEffect(() => {
    if (!isVisible) return undefined;
    // Snapshot first so we don't show an empty panel right after toggle.
    setEntries(prev => prev.length ? prev : []);
    const off = subscribeHistory(entry => {
      setEntries(prev => {
        const next = [entry, ...prev];
        if (next.length > TAIL) next.length = TAIL;
        return next;
      });
    });
    return off;
  }, [isVisible]);

  const dragRef = useRef<{ id: number; ox: number; oy: number } | null>(null);
  useEffect(() => {
    function onMove(e: PointerEvent) {
      if (!dragRef.current || dragRef.current.id !== e.pointerId) return;
      const { ox, oy } = dragRef.current;
      const maxX = window.innerWidth - PANEL_W;
      const maxY = window.innerHeight - 80;
      setPos({
        x: Math.max(0, Math.min(maxX, e.clientX - ox)),
        y: Math.max(24, Math.min(maxY, e.clientY - oy)),
      });
    }
    function onUp(e: PointerEvent) {
      if (dragRef.current?.id === e.pointerId) dragRef.current = null;
    }
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  if (!isVisible) return null;

  return (
    <GlassPanel
      role="dialog"
      aria-label="Event Inspector"
      blur="heavy"
      radius="md"
      style={{
        position: 'fixed',
        top: pos.y,
        left: pos.x,
        width: PANEL_W,
        maxHeight: PANEL_H,
        zIndex: 99999,
        // Keep the inspector text-readable on the warm sand backdrop —
        // override the default Liquid Sand foreground with the dense devtools
        // greys so the existing event log styling reads as "system console".
        color: '#dcdce0',
        backgroundColor: 'rgba(20, 14, 6, 0.78)',
        fontFamily: MONO_FONT,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        padding: 0,
      }}
    >
      <div
        onPointerDown={e => {
          e.preventDefault();
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
          dragRef.current = {
            id: e.pointerId,
            ox: e.clientX - pos.x,
            oy: e.clientY - pos.y,
          };
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          background:
            'linear-gradient(180deg, rgba(60,45,25,0.55) 0%, rgba(20,14,6,0.55) 100%)',
          borderBottom: '1px solid var(--ls-border-glass)',
          cursor: 'grab',
          touchAction: 'none',
          userSelect: 'none',
          color: 'var(--ls-fg-on-dark)',
        }}
      >
        <CpuChip size={14} />
        <span style={{ fontSize: 12, fontWeight: 600, letterSpacing: 0.3 }}>
          Event Inspector
        </span>
        <span style={{ color: '#8e8e93', fontSize: 10, marginLeft: 4 }}>
          ⌘⇧I to toggle
        </span>
        <span style={{ flex: 1 }} />
        <GlassChip
          tone={sticky ? 'success' : 'neutral'}
          size="xs"
          onClick={() => setSticky(s => !s)}
          style={{ cursor: 'pointer' }}
          title="Pin to top of stream"
        >
          {sticky ? 'Live' : 'Paused'}
        </GlassChip>
        <button
          type="button"
          onClick={() => eventInspector.hide()}
          style={{
            ...subtleButtonStyle,
            background: 'transparent',
            color: 'var(--ls-fg-on-dark)',
            border: '1px solid var(--ls-border-glass)',
            padding: '2px 6px',
            display: 'inline-flex',
            alignItems: 'center',
          }}
          title="Hide (⌘⇧I)"
        >
          <CloseIcon size={10} />
        </button>
      </div>
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '4px 6px',
          fontSize: 11,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {entries.length === 0 && (
          <div style={{ padding: 12, color: '#8e8e93', textAlign: 'center' }}>
            no events yet — interact with the desktop
          </div>
        )}
        {entries.map(e => {
          const c = CATEGORY_COLOR[categoryFor(e.name)];
          const isExpanded = expanded.has(e.id);
          return (
            <div
              key={e.id}
              onClick={() =>
                setExpanded(prev => {
                  const next = new Set(prev);
                  if (next.has(e.id)) next.delete(e.id);
                  else next.add(e.id);
                  return next;
                })
              }
              style={{
                padding: '4px 6px',
                borderLeft: `3px solid ${c.dot}`,
                background: isExpanded ? 'rgba(255,255,255,0.06)' : 'transparent',
                borderRadius: 4,
                marginBottom: 2,
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                <span style={{ color: '#8e8e93', fontSize: 10 }}>
                  {formatTime(e.timestamp)}
                </span>
                <span style={{ color: c.dot, fontWeight: 600 }}>{e.name}</span>
                {e.sourceAppId && (
                  <span style={{ color: '#5856d6', marginLeft: 'auto', fontSize: 10 }}>
                    «{e.sourceAppId}»
                  </span>
                )}
              </div>
              {!isExpanded && (
                <div
                  style={{
                    color: '#aeaeae',
                    fontSize: 10,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {compactJson(e.payload, 200)}
                </div>
              )}
              {isExpanded && (
                <pre
                  style={{
                    margin: '4px 0 0 0',
                    padding: 6,
                    background: 'rgba(0,0,0,0.4)',
                    borderRadius: 4,
                    fontSize: 10.5,
                    color: '#e0e0e0',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {tryPretty(e.payload)}
                </pre>
              )}
            </div>
          );
        })}
      </div>
      <div
        style={{
          padding: '4px 8px',
          borderTop: '1px solid rgba(255,255,255,0.08)',
          fontSize: 10,
          color: '#8e8e93',
          display: 'flex',
          justifyContent: 'space-between',
        }}
      >
        <span>last {entries.length}/{TAIL} events</span>
        <button
          type="button"
          onClick={() => {
            // Ping the bus so the user can see the inspector reflect itself.
            try {
              berryBus.emit('system:bootComplete', {});
            } catch {
              /* event map mismatch — ignore */
            }
          }}
          style={{
            ...subtleButtonStyle,
            background: 'transparent',
            border: '1px solid #48484a',
            color: '#aeaeae',
            fontSize: 9,
            padding: '0 6px',
          }}
        >
          ping
        </button>
      </div>
    </GlassPanel>
  );
}
