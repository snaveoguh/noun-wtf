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
  inputStyle,
  MONO_FONT,
  subtleButtonStyle,
  toolbarStyle,
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
      <div style={{ ...toolbarStyle, background: '#2c2c2e', borderBottomColor: '#3a3a3c' }}>
        <input
          style={{
            ...inputStyle,
            background: '#1d1d1f',
            border: '1px solid #3a3a3c',
            color: '#dcdce0',
          }}
          placeholder="Filter — text, prefix:, or appId:foo"
          value={filter}
          onChange={e => setFilter(e.target.value)}
        />
        <input
          style={{
            ...inputStyle,
            background: '#1d1d1f',
            border: '1px solid #3a3a3c',
            color: '#dcdce0',
            maxWidth: 200,
          }}
          placeholder="Search…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <span
          style={{
            color: search.trim() ? '#28cd41' : '#8e8e93',
            fontSize: 10,
            padding: '0 6px',
          }}
        >
          {search.trim() ? `${searched.hits} hits` : `${filtered.length} lines`}
        </span>
        <button
          type="button"
          style={{
            ...subtleButtonStyle,
            background: autoScroll
              ? 'linear-gradient(180deg, #2d7ad8 0%, #1c5fb0 100%)'
              : subtleButtonStyle.background,
            color: autoScroll ? '#fff' : subtleButtonStyle.color,
            borderColor: autoScroll ? '#0a4a90' : '#3a3a3c',
          }}
          onClick={() => setAutoScroll(s => !s)}
          title="Toggle auto-scroll to bottom"
        >
          {autoScroll ? '↓ Tail' : '↓ Tail (off)'}
        </button>
        <button
          type="button"
          style={{
            ...subtleButtonStyle,
            background: 'linear-gradient(180deg, #3a3a3c 0%, #2c2c2e 100%)',
            color: '#dcdce0',
            borderColor: '#48484a',
          }}
          onClick={() => setEntries([])}
        >
          Clear
        </button>
      </div>
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '4px 8px',
          fontSize: 11.5,
          lineHeight: 1.45,
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {searched.lines.length === 0 && (
          <div style={{ color: '#8e8e93', padding: 8 }}>
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
