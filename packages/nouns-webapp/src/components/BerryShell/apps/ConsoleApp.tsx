/**
 * Console — terminal-style tail of the BerryOS bus.
 *
 * Drops one line per event, monospace, dark. Intended for the "look at the
 * pipes" demo — opens, fills with activity as you click around the desktop,
 * filters and search work like real Console.app.
 *
 * Filter grammar:
 *   plain text         — substring match on event name + payload
 *   appId:foo          — only events whose source app id is "foo"
 *   <prefix>:          — e.g. "window:" matches all window events
 *
 * Search bar runs over the rendered tail; hit count updates live.
 */

import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';

import { GlassButton, GlassChip } from '@/liquid-sand/glass';

import { berryRegistry } from '../system/berryRegistry';
import {
  getHistory,
  startBusHistory,
  subscribeHistory,
  type BusHistoryEntry,
} from '../system/busHistory';
import {
  CATEGORY_COLOR,
  categoryFor,
  compactJson,
  formatTime,
  MONO_FONT,
} from '../system/devtoolsStyles';

const MAX_LINES = 1000;

function ConsoleApp(): ReactElement {
  useEffect(() => {
    startBusHistory();
  }, []);

  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [entries, setEntries] = useState<BusHistoryEntry[]>(() => getHistory().slice());

  useEffect(() => {
    const off = subscribeHistory(entry => {
      setEntries(prev => {
        const next = prev.slice(-MAX_LINES + 1);
        next.push(entry);
        return next;
      });
    });
    return off;
  }, []);

  const filtered = useMemo(() => {
    if (!filter.trim()) return entries;
    const f = filter.trim().toLowerCase();
    const appIdMatch = f.match(/^appid:(.+)$/);
    if (appIdMatch) {
      const target = appIdMatch[1]?.trim();
      return entries.filter(e => e.sourceAppId === target);
    }
    return entries.filter(
      e =>
        e.name.toLowerCase().includes(f) ||
        compactJson(e.payload, 240).toLowerCase().includes(f) ||
        (e.sourceAppId ?? '').toLowerCase().includes(f),
    );
  }, [entries, filter]);

  const searched = useMemo(() => {
    if (!search.trim()) return { lines: filtered, hits: 0 };
    const s = search.trim().toLowerCase();
    let hits = 0;
    for (const e of filtered) {
      if (
        e.name.toLowerCase().includes(s) ||
        compactJson(e.payload, 240).toLowerCase().includes(s)
      )
        hits += 1;
    }
    return { lines: filtered, hits };
  }, [filtered, search]);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!autoScroll) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [searched.lines, autoScroll]);

  // Dark terminal-input style — Console keeps its monospace dark surface
  // (intentional: terminal aesthetic) but the toolbar controls now use Glass
  // primitives so they read as part of BerryOS instead of as raw HTML.
  const darkInputStyle = {
    appearance: 'none' as const,
    border: '1px solid #3a3a3c',
    borderRadius: 'var(--ls-r-md)',
    background: '#1d1d1f',
    color: '#dcdce0',
    padding: '6px 10px',
    fontSize: 13,
    lineHeight: 1.4,
    fontFamily: MONO_FONT,
    flex: 1,
    minWidth: 0,
    outline: 'none',
    minHeight: 28,
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: '#1d1d1f',
        fontFamily: MONO_FONT,
        color: '#dcdce0',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          background: '#2c2c2e',
          borderBottom: '1px solid #3a3a3c',
        }}
      >
        <input
          style={darkInputStyle}
          placeholder="Filter — text, prefix:, or appId:foo"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          aria-label="Filter console"
        />
        <input
          style={{ ...darkInputStyle, maxWidth: 200 }}
          placeholder="Search…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          aria-label="Search console"
        />
        <GlassChip
          tone={search.trim() ? 'success' : 'neutral'}
          size="xs"
          style={{
            fontFamily: MONO_FONT,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {search.trim() ? `${searched.hits} hits` : `${filtered.length} lines`}
        </GlassChip>
        <GlassButton
          variant={autoScroll ? 'primary' : 'default'}
          size="sm"
          onClick={() => setAutoScroll(s => !s)}
          title="Toggle auto-scroll to bottom"
        >
          {autoScroll ? '↓ Tail' : '↓ Tail (off)'}
        </GlassButton>
        <GlassButton
          variant="default"
          size="sm"
          onClick={() => setEntries([])}
        >
          Clear
        </GlassButton>
      </div>
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '8px 12px',
          // HIG: 12pt monospace for terminal-style content (above 11pt floor)
          fontSize: 12,
          lineHeight: 1.5,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {searched.lines.length === 0 && (
          <div style={{ color: '#8e8e93', padding: 16, fontSize: 12, lineHeight: 1.5 }}>
            -- no events captured -- open or close a window
          </div>
        )}
        {searched.lines.map(e => {
          const cat = categoryFor(e.name);
          const c = CATEGORY_COLOR[cat];
          const matchesSearch =
            !!search.trim() &&
            (e.name.toLowerCase().includes(search.trim().toLowerCase()) ||
              compactJson(e.payload, 240)
                .toLowerCase()
                .includes(search.trim().toLowerCase()));
          return (
            <div
              key={e.id}
              style={{
                display: 'flex',
                gap: 8,
                background: matchesSearch ? 'rgba(255, 235, 59, 0.10)' : 'transparent',
                padding: '0 4px',
                borderRadius: 2,
                whiteSpace: 'pre',
              }}
            >
              <span style={{ color: '#8e8e93' }}>[{formatTime(e.timestamp)}]</span>
              <span style={{ color: c.dot, fontWeight: 600 }}>{e.name.padEnd(26, ' ')}</span>
              <span style={{ color: '#dcdce0' }}>{compactJson(e.payload, 220)}</span>
              {e.sourceAppId && (
                <span style={{ color: '#5856d6', marginLeft: 'auto' }}>«{e.sourceAppId}»</span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------------- */
/* Self-registration                                                        */
/* ----------------------------------------------------------------------- */

berryRegistry.register({
  id: 'console',
  name: 'Console',
  icon: '🖥️',
  component: ConsoleApp,
  defaultWindow: { w: 640, h: 420 },
  capabilities: ['system:lifecycle'],
});

export default ConsoleApp;
