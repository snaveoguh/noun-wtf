/**
 * ClipboardApp — history view of the BerryOS clipboard ring buffer.
 *
 * Each entry is colour-coded by detected type, click to re-copy (which also
 * mirrors back to the native clipboard), filterable by free-text search,
 * and bulk-clearable.
 *
 * NOTE: this app would normally self-register against the future
 * `berryRegistry.register({ id: 'clipboard', ... })` API the registry agent
 * is building. While that API is in flight we export the registry entry
 * separately (`clipboardAppEntry`) so it can be merged into the static
 * `APP_REGISTRY` (or whatever shape lands) without touching this file.
 */

import { useMemo, useState, type CSSProperties } from 'react';

import {
  clearAll,
  clipboardStore,
  pickHistory,
  removeItem,
  type BerryClipboardItem,
  type BerryClipboardType,
} from '../system/clipboard';

const TYPE_ORDER: BerryClipboardType[] = ['address', 'url', 'noun-id', 'text'];

const TYPE_COLORS: Record<BerryClipboardType, { bg: string; fg: string; label: string }> = {
  address: { bg: '#1f6feb', fg: '#fff', label: 'ADDR' },
  url: { bg: '#0f9b8e', fg: '#fff', label: 'URL' },
  'noun-id': { bg: '#d6336c', fg: '#fff', label: 'NOUN' },
  text: { bg: '#475569', fg: '#fff', label: 'TEXT' },
};

const labelStyle: CSSProperties = {
  fontFamily: 'var(--theme-font-display)',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 1,
  color: 'var(--theme-text-muted)',
};

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function ClipboardRow({ item, onPick, onRemove }: {
  item: BerryClipboardItem;
  onPick: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const colors = TYPE_COLORS[item.type];
  return (
    <li
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 8px',
        borderBottom: '1px dotted var(--theme-feed-row-border)',
      }}
    >
      <span
        style={{
          background: colors.bg,
          color: colors.fg,
          fontFamily: 'var(--theme-font-display)',
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: 0.5,
          padding: '2px 6px',
          borderRadius: 4,
          minWidth: 44,
          textAlign: 'center',
        }}
      >
        {colors.label}
      </span>
      <button
        type="button"
        onClick={() => onPick(item.id)}
        title="Click to re-copy"
        style={{
          flex: 1,
          textAlign: 'left',
          background: 'transparent',
          border: 'none',
          fontFamily: 'var(--theme-font-mono, ui-monospace, monospace)',
          fontSize: 12,
          color: 'var(--theme-text-primary)',
          cursor: 'pointer',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          padding: 0,
        }}
      >
        {item.content}
      </button>
      <span style={{ ...labelStyle, fontSize: 10 }}>{timeAgo(item.timestamp)}</span>
      <button
        type="button"
        onClick={() => onRemove(item.id)}
        title="Remove from history"
        aria-label="Remove from history"
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--theme-text-muted)',
          cursor: 'pointer',
          padding: '0 4px',
          fontSize: 12,
        }}
      >
        ×
      </button>
    </li>
  );
}

export default function ClipboardApp() {
  const items = clipboardStore.useSelector(s => s.items);
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<BerryClipboardType | 'all'>('all');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter(it => {
      if (typeFilter !== 'all' && it.type !== typeFilter) return false;
      if (!q) return true;
      return it.content.toLowerCase().includes(q);
    });
  }, [items, query, typeFilter]);

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        fontFamily: 'var(--theme-font-display)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: 8,
          borderBottom: '1px solid var(--theme-border)',
          background: 'var(--theme-bg-tertiary)',
        }}
      >
        <input
          type="search"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Search clipboard…"
          style={{
            flex: 1,
            padding: '4px 8px',
            border: '1px solid var(--theme-border)',
            borderRadius: 4,
            fontSize: 12,
            background: 'var(--theme-bg-primary)',
            color: 'var(--theme-text-primary)',
          }}
        />
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value as BerryClipboardType | 'all')}
          style={{
            padding: '3px 6px',
            border: '1px solid var(--theme-border)',
            borderRadius: 4,
            fontSize: 11,
            background: 'var(--theme-bg-primary)',
            color: 'var(--theme-text-primary)',
          }}
        >
          <option value="all">All</option>
          {TYPE_ORDER.map(t => (
            <option key={t} value={t}>
              {TYPE_COLORS[t].label}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => {
            if (window.confirm('Clear clipboard history?')) clearAll();
          }}
          style={{
            padding: '3px 8px',
            border: '1px solid var(--theme-border)',
            borderRadius: 4,
            fontSize: 11,
            background: 'var(--theme-bg-primary)',
            color: 'var(--theme-text-primary)',
            cursor: 'pointer',
          }}
        >
          Clear
        </button>
      </div>
      <div style={{ flex: 1, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <div
            style={{
              padding: 24,
              textAlign: 'center',
              color: 'var(--theme-text-muted)',
              fontSize: 12,
            }}
          >
            {items.length === 0
              ? 'Nothing copied yet. Anything you copy in BerryOS will land here.'
              : 'No matches.'}
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {filtered.map(item => (
              <ClipboardRow
                key={item.id}
                item={item}
                onPick={pickHistory}
                onRemove={removeItem}
              />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/**
 * Forward-compatible registry entry. When the registry agent ships
 * `berryRegistry.register({...})`, that one-liner can call this object
 * and the app will appear in the dock + Apple menu without further work.
 */
export const clipboardAppEntry = {
  id: 'clipboard',
  appId: 'clipboard',
  name: 'Clipboard',
  title: 'Clipboard',
  icon: '📋',
  emoji: '📋',
  component: ClipboardApp,
  Component: ClipboardApp,
  defaultWindow: { w: 380, h: 460 },
  width: 380,
  height: 460,
  capabilities: ['clipboard'] as const,
} as const;
