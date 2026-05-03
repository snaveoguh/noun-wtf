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

import { useMemo, useState } from 'react';

import {
  GlassButton,
  GlassChip,
  GlassInput,
  GlassPanel,
  GlassToolbar,
} from '@/liquid-sand/glass';
import {
  Clipboard,
  Close,
  Globe,
  MagnifyingGlass,
  Trash,
  Wallet,
} from '@/liquid-sand/icons';

import {
  clearAll,
  clipboardStore,
  pickHistory,
  removeItem,
  type BerryClipboardItem,
  type BerryClipboardType,
} from '../system/clipboard';

const TYPE_ORDER: BerryClipboardType[] = ['address', 'url', 'noun-id', 'text'];

const TYPE_META: Record<
  BerryClipboardType,
  { tone: 'accent' | 'success' | 'danger' | 'neutral'; label: string }
> = {
  address: { tone: 'accent', label: 'ADDR' },
  url: { tone: 'success', label: 'URL' },
  'noun-id': { tone: 'danger', label: 'NOUN' },
  text: { tone: 'neutral', label: 'TEXT' },
};

function typeIcon(t: BerryClipboardType) {
  switch (t) {
    case 'address':
      return <Wallet size={12} />;
    case 'url':
      return <Globe size={12} />;
    case 'noun-id':
      return <Clipboard size={12} />;
    default:
      return <Clipboard size={12} />;
  }
}

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
  const meta = TYPE_META[item.type];
  return (
    <GlassPanel padded={false} radius="md" tone="auto" className="!p-2 flex items-center gap-2">
      <GlassChip tone={meta.tone} size="xs" style={{ minWidth: 56, justifyContent: 'center' }}>
        {typeIcon(item.type)}
        {meta.label}
      </GlassChip>
      <button
        type="button"
        onClick={() => onPick(item.id)}
        title="Click to re-copy"
        className="flex-1 text-left bg-transparent border-0 cursor-pointer p-0"
        style={{
          fontFamily: 'var(--ls-font-mono)',
          fontSize: 12,
          color: 'var(--ls-fg-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {item.content}
      </button>
      <span
        style={{
          fontFamily: 'var(--ls-font-mono)',
          fontSize: 10,
          color: 'var(--ls-fg-muted)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {timeAgo(item.timestamp)}
      </span>
      <button
        type="button"
        onClick={() => onRemove(item.id)}
        title="Remove from history"
        aria-label="Remove from history"
        className="bg-transparent border-0 cursor-pointer flex items-center justify-center"
        style={{
          color: 'var(--ls-fg-muted)',
          padding: '2px 4px',
        }}
      >
        <Close size={12} />
      </button>
    </GlassPanel>
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
      className="flex flex-col h-full"
      style={{
        fontFamily: 'var(--ls-font-sans)',
        color: 'var(--ls-fg-primary)',
      }}
    >
      <div className="p-2.5">
        <GlassToolbar size="md" className="w-full">
          <GlassInput
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search clipboard…"
            inputSize="sm"
            prefix={<MagnifyingGlass size={12} />}
            wrapperClassName="flex-1"
          />
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value as BerryClipboardType | 'all')}
            style={{
              padding: '4px 8px',
              border: '1px solid var(--ls-border-glass)',
              borderRadius: 'var(--ls-r-md)',
              fontSize: 11,
              background: 'var(--ls-glass-light-strong)',
              color: 'var(--ls-fg-primary)',
              fontFamily: 'inherit',
            }}
          >
            <option value="all">All</option>
            {TYPE_ORDER.map(t => (
              <option key={t} value={t}>
                {TYPE_META[t].label}
              </option>
            ))}
          </select>
          <GlassButton
            variant="ghost"
            size="sm"
            onClick={() => {
              if (window.confirm('Clear clipboard history?')) clearAll();
            }}
          >
            <Trash size={12} />
            Clear
          </GlassButton>
        </GlassToolbar>
      </div>
      <div className="flex-1 overflow-y-auto px-2.5 pb-2.5 flex flex-col gap-1.5">
        {filtered.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center text-center"
            style={{
              padding: 32,
              color: 'var(--ls-fg-muted)',
              fontSize: 12,
            }}
          >
            <Clipboard size={28} style={{ marginBottom: 8, opacity: 0.5 }} />
            {items.length === 0
              ? 'Nothing copied yet. Anything you copy in BerryOS will land here.'
              : 'No matches.'}
          </div>
        ) : (
          filtered.map(item => (
            <ClipboardRow
              key={item.id}
              item={item}
              onPick={pickHistory}
              onRemove={removeItem}
            />
          ))
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
