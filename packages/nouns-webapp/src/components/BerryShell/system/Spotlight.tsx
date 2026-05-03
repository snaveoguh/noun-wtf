/**
 * Spotlight — Mac-style command palette for BerryOS.
 *
 * Mounts globally, hidden by default. Toggled by:
 *   - `cmd+space` (registered as a default global hotkey at boot)
 *   - `spotlight:toggle` event from anywhere (e.g. a menu item)
 *
 * Result categories (in order):
 *   Calculator  — only when query parses as a safe arithmetic expression
 *   Apps        — fuzzy match against berryRegistry (or APP_REGISTRY fallback)
 *   Settings    — hardcoded list of common settings panes
 *   Web search  — always present as a final fallback
 *
 * Notifications + recent files are SKIPPED gracefully when their stores don't
 * exist yet — see optional resolvers below.
 *
 * Keyboard:
 *   ↑ / ↓        cycle selection
 *   Enter        launch selected
 *   Escape       close
 *   Cmd+Space    toggle (registered globally — Spotlight just listens to the
 *                spotlight:toggle event the hotkey emits)
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { APP_REGISTRY, type BerryAppDef } from '../apps/registry';
import { windowStore } from '../store/windowStore';

import { berryBus } from './eventBus';
import { fuzzySearch } from './fuzzy';
import './spotlightEvents';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

interface AppResult {
  type: 'app';
  id: string;
  title: string;
  subtitle: string;
  emoji: string;
}
interface SettingResult {
  type: 'setting';
  id: string;
  title: string;
  subtitle: string;
  emoji: string;
  /** Specific settings pane to focus, if any. */
  pane?: string;
}
interface WebResult {
  type: 'web';
  id: string;
  title: string;
  subtitle: string;
  emoji: string;
  query: string;
}
interface CalcResult {
  type: 'calc';
  id: string;
  title: string;
  subtitle: string;
  emoji: string;
  value: string;
}

type SpotlightResult = AppResult | SettingResult | WebResult | CalcResult;

interface ResultGroup {
  label: string;
  items: SpotlightResult[];
}

// ---------------------------------------------------------------------------
// Optional registry — prefer the bus-side registry if another agent has
// shipped it, fall back to the static APP_REGISTRY otherwise.
// ---------------------------------------------------------------------------

interface OptionalBerryRegistry {
  list: () => Array<{
    id?: string;
    appId?: string;
    name?: string;
    title?: string;
    icon?: string;
    emoji?: string;
    description?: string;
  }>;
}

function loadAppCandidates(): AppResult[] {
  // Try the runtime registry first if the boot agent has wired one onto window.
  const runtime = (typeof window !== 'undefined'
    ? (window as unknown as { berryRegistry?: OptionalBerryRegistry }).berryRegistry
    : undefined);

  if (runtime && typeof runtime.list === 'function') {
    try {
      return runtime.list().map(entry => ({
        type: 'app' as const,
        id: entry.id ?? entry.appId ?? entry.name ?? '',
        title: entry.title ?? entry.name ?? entry.id ?? entry.appId ?? '',
        subtitle: entry.description ?? 'Application',
        emoji: entry.emoji ?? entry.icon ?? '🪟',
      })).filter(r => r.id);
    } catch {
      // fall through to static registry
    }
  }

  return Object.values(APP_REGISTRY).map((def: BerryAppDef) => ({
    type: 'app' as const,
    id: def.appId,
    title: def.title,
    subtitle: 'Application',
    emoji: def.emoji,
  }));
}

const SETTINGS_LIST: SettingResult[] = [
  {
    type: 'setting',
    id: 'settings:theme',
    title: 'Theme',
    subtitle: 'Switch site theme',
    emoji: '🎨',
    pane: 'theme',
  },
  {
    type: 'setting',
    id: 'settings:permissions',
    title: 'Permissions',
    subtitle: 'Manage app permissions',
    emoji: '🔐',
    pane: 'permissions',
  },
  {
    type: 'setting',
    id: 'settings:notifications',
    title: 'Notifications',
    subtitle: 'Notification preferences',
    emoji: '🔔',
    pane: 'notifications',
  },
];

// ---------------------------------------------------------------------------
// Calculator — strict whitelist; falsy result → not shown.
// ---------------------------------------------------------------------------

const CALC_RX = /^[\d\s+\-*/().]+$/;

function tryCalc(query: string): string | null {
  const q = query.trim();
  if (q.length < 2) return null;
  if (!CALC_RX.test(q)) return null;
  // Need at least one operator to avoid "12" → "12" noise.
  if (!/[+\-*/]/.test(q)) return null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
    const value = new Function('"use strict"; return (' + q + ')')();
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    // Round to a sane precision so floating point doesn't surprise.
    const rounded = Math.round(value * 1e10) / 1e10;
    return String(rounded);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Spotlight() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── open/close lifecycle ────────────────────────────────────────────────
  // (open() helper removed — `toggle()` below covers the open path.)

  const closeSpot = useCallback(() => {
    setOpen(false);
    setQuery('');
    setSelectedIndex(0);
    berryBus.emit('spotlight:closed', {});
  }, []);

  const toggle = useCallback(() => {
    setOpen(prev => {
      const next = !prev;
      if (next) {
        setQuery('');
        setSelectedIndex(0);
        berryBus.emit('spotlight:opened', {});
        setTimeout(() => inputRef.current?.focus(), 0);
      } else {
        berryBus.emit('spotlight:closed', {});
      }
      return next;
    });
  }, []);

  useEffect(() => {
    return berryBus.on('spotlight:toggle', () => toggle());
  }, [toggle]);

  // ── results ─────────────────────────────────────────────────────────────
  const groups = useMemo<ResultGroup[]>(() => {
    const out: ResultGroup[] = [];
    const trimmed = query.trim();

    // Calculator (top of list when valid).
    const calc = tryCalc(trimmed);
    if (calc !== null) {
      out.push({
        label: 'Calculator',
        items: [
          {
            type: 'calc',
            id: 'calc:' + trimmed,
            title: `${trimmed} = ${calc}`,
            subtitle: 'Press Enter to copy',
            emoji: '🧮',
            value: calc,
          },
        ],
      });
    }

    // Apps.
    const apps = loadAppCandidates();
    const appMatches = trimmed
      ? fuzzySearch(trimmed, apps, app => [app.title, app.id])
      : apps.map(a => ({ item: a, score: 0 }));
    if (appMatches.length) {
      out.push({
        label: 'Apps',
        items: appMatches.slice(0, 6).map(m => m.item),
      });
    }

    // Settings.
    const settingMatches = trimmed
      ? fuzzySearch(trimmed, SETTINGS_LIST, s => [s.title, s.subtitle])
      : SETTINGS_LIST.map(s => ({ item: s, score: 0 }));
    if (settingMatches.length && (trimmed || out.length === 0)) {
      // When no query, show settings only as a courtesy if there are no apps.
      if (trimmed) {
        out.push({ label: 'Settings', items: settingMatches.slice(0, 4).map(m => m.item) });
      }
    }

    // Web search — only when the user has typed something.
    if (trimmed) {
      out.push({
        label: 'Web',
        items: [
          {
            type: 'web',
            id: 'web:' + trimmed,
            title: `Search the web for "${trimmed}"`,
            subtitle: 'Open DuckDuckGo in a new tab',
            emoji: '🌐',
            query: trimmed,
          },
        ],
      });
    }

    return out;
  }, [query]);

  // Flatten for keyboard navigation.
  const flatResults = useMemo(() => groups.flatMap(g => g.items), [groups]);

  useEffect(() => {
    // Reset selection when results change.
    setSelectedIndex(0);
  }, [query]);

  // ── action dispatch ─────────────────────────────────────────────────────
  const launch = useCallback(
    (result: SpotlightResult) => {
      if (result.type === 'app') {
        berryBus.emit('app:launching', { appId: result.id, source: 'event' });
        berryBus.emit('spotlight:launched', { appId: result.id });
        const def = APP_REGISTRY[result.id];
        if (def) {
          windowStore.open({
            appId: def.appId,
            title: def.title,
            icon: def.emoji,
            width: def.width,
            height: def.height,
          });
        }
      } else if (result.type === 'setting') {
        const def = APP_REGISTRY['settings'];
        if (def) {
          windowStore.open({
            appId: def.appId,
            title: def.title,
            icon: def.emoji,
            width: def.width,
            height: def.height,
          });
        }
        berryBus.emit('spotlight:launched', { appId: 'settings' });
      } else if (result.type === 'web') {
        const url = `https://duckduckgo.com/?q=${encodeURIComponent(result.query)}`;
        if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer');
      } else if (result.type === 'calc') {
        try {
          if (typeof navigator !== 'undefined' && navigator.clipboard) {
            void navigator.clipboard.writeText(result.value);
          }
        } catch {
          // ignore — clipboard requires secure context
        }
      }
      closeSpot();
    },
    [closeSpot],
  );

  // ── keyboard handlers within the modal ──────────────────────────────────
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeSpot();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(i => Math.min(i + 1, Math.max(flatResults.length - 1, 0)));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(i => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const target = flatResults[selectedIndex];
        if (target) launch(target);
      }
    },
    [closeSpot, flatResults, launch, selectedIndex],
  );

  if (!open) return null;

  // ── render ──────────────────────────────────────────────────────────────
  let runningIdx = 0;
  return (
    <div
      role="dialog"
      aria-label="Spotlight"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 5000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '15vh',
        background: 'rgba(0, 0, 0, 0.18)',
      }}
      onMouseDown={e => {
        if (e.target === e.currentTarget) closeSpot();
      }}
    >
      <div
        ref={containerRef}
        data-spotlight
        style={{
          width: 520,
          maxWidth: 'calc(100vw - 32px)',
          maxHeight: '70vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'rgba(28, 28, 32, 0.78)',
          color: '#f5f5f7',
          backdropFilter: 'blur(28px) saturate(180%)',
          WebkitBackdropFilter: 'blur(28px) saturate(180%)',
          borderRadius: 8,
          border: '1px solid rgba(255, 255, 255, 0.12)',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.55), 0 4px 12px rgba(0, 0, 0, 0.4)',
          fontFamily: 'system-ui, -apple-system, "SF Pro Display", "Helvetica Neue", sans-serif',
        }}
      >
        {/* Search input */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 18px',
            borderBottom: flatResults.length ? '1px solid rgba(255,255,255,0.08)' : 'none',
          }}
        >
          <span aria-hidden style={{ fontSize: 20, opacity: 0.65 }}>
            🔍
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Spotlight Search"
            aria-label="Spotlight search"
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              color: '#f5f5f7',
              fontSize: 22,
              fontFamily: 'inherit',
              padding: 0,
            }}
          />
        </div>

        {/* Results */}
        {flatResults.length > 0 && (
          <div
            style={{
              overflowY: 'auto',
              padding: '6px 0 8px 0',
            }}
          >
            {groups.map(group => (
              <div key={group.label} style={{ padding: '4px 0' }}>
                <div
                  style={{
                    fontSize: 11,
                    textTransform: 'uppercase',
                    letterSpacing: 0.6,
                    color: 'rgba(245, 245, 247, 0.45)',
                    padding: '4px 18px 6px',
                  }}
                >
                  {group.label}
                </div>
                {group.items.map(item => {
                  const idx = runningIdx++;
                  const selected = idx === selectedIndex;
                  return (
                    <div
                      key={item.id}
                      role="option"
                      aria-selected={selected}
                      onMouseEnter={() => setSelectedIndex(idx)}
                      onMouseDown={e => {
                        e.preventDefault();
                        launch(item);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '8px 18px',
                        cursor: 'default',
                        background: selected ? 'rgba(80, 130, 220, 0.65)' : 'transparent',
                      }}
                    >
                      <span aria-hidden style={{ fontSize: 22, lineHeight: 1 }}>
                        {item.emoji}
                      </span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 14,
                            fontWeight: 500,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {item.title}
                        </div>
                        <div
                          style={{
                            fontSize: 12,
                            color: selected ? 'rgba(255,255,255,0.85)' : 'rgba(245,245,247,0.55)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {item.subtitle}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
