/**
 * FinderApp — sidebar + grid window over recent on-chain activity.
 *
 * Equivalent to the right-hand "Recent Activity" panel from the static
 * BerryHome scaffold, but lives in its own draggable window now and
 * follows the Apple Finder convention of a left sidebar (sources) and a
 * right pane (icons / list).
 *
 * HIG / Liquid Sand notes:
 *   - Toolbar at top is a single <GlassToolbar>. Filter chips are
 *     <GlassTabs>; "View" segment toggles between icons and list view.
 *   - Sidebar lives in a <GlassPanel>; path entries use mono font per
 *     app brief.
 *   - File tiles in the icon grid are 80pt thumbs with an 8pt gap, file
 *     names underneath at 11pt (Silkscreen) — solid sand-tone tiles
 *     (no glass over the file label).
 *   - Empty / loading states sit centered in the grid pane.
 */

import { useMemo, useState, type CSSProperties, type ReactElement } from 'react';

import { GlassChip, GlassPanel, GlassTabs, GlassToolbar } from '@/liquid-sand/glass';
import {
  ChatBubble,
  Coin,
  Info,
  Megaphone,
  Sparkle,
  StickyNote,
} from '@/liquid-sand/icons';

import { useActivityFeed, type ActivityEvent } from '@/components/TerminalFeed/useActivityFeed';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type Source = 'all' | 'auctions' | 'votes' | 'props' | 'transfers';

interface SourceDef {
  id: Source;
  label: string;
  /** Icon shown beside the source row. */
  icon: ReactElement;
  /** Predicate to filter events into this source bucket. */
  match: (event: ActivityEvent) => boolean;
}

const SOURCES: ReadonlyArray<SourceDef> = [
  { id: 'all', label: 'All Activity', icon: <Sparkle size={14} />, match: () => true },
  {
    id: 'auctions',
    label: 'Auctions',
    icon: <Coin size={14} />,
    match: e => /auction|bid|settle/i.test(e.type),
  },
  {
    id: 'votes',
    label: 'Votes',
    icon: <Megaphone size={14} />,
    match: e => /vote/i.test(e.type),
  },
  {
    id: 'props',
    label: 'Proposals',
    icon: <ChatBubble size={14} />,
    match: e => /propos|cand/i.test(e.type),
  },
  {
    id: 'transfers',
    label: 'Transfers',
    icon: <StickyNote size={14} />,
    match: e => /transfer|mint|burn/i.test(e.type),
  },
];

function eventEmoji(type: string): string {
  if (/bid/i.test(type)) return '💰';
  if (/auction|settle/i.test(type)) return '🔨';
  if (/vote/i.test(type)) return '🗳️';
  if (/propos|cand/i.test(type)) return '📜';
  if (/transfer|mint/i.test(type)) return '➡️';
  if (/burn/i.test(type)) return '🔥';
  return '📄';
}

function shortHash(hash: string): string {
  if (!hash) return '—';
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`;
}

function formatRelativeTime(ts: string): string {
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return '—';
  const diff = Date.now() - t;
  const min = Math.round(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function FinderApp() {
  const { events, loading } = useActivityFeed('');
  const [source, setSource] = useState<Source>('all');
  const [view, setView] = useState<'icons' | 'list'>('icons');

  const sourceDef = SOURCES.find(s => s.id === source) ?? SOURCES[0];
  const filtered = useMemo(
    () => events.filter(sourceDef.match).slice(0, 60),
    [events, sourceDef],
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        boxSizing: 'border-box',
        fontFamily: 'var(--ls-font-sans)',
        color: 'var(--ls-fg-primary)',
      }}
    >
      {/* Top toolbar — view switcher + breadcrumb-style path. */}
      <div style={{ padding: 12, paddingBottom: 8 }}>
        <GlassToolbar size="md" align="start" className="w-full flex-wrap">
          <GlassTabs
            size="sm"
            value={view}
            onValueChange={v => setView(v as 'icons' | 'list')}
            aria-label="Finder view"
          >
            <GlassTabs.Item value="icons">Icons</GlassTabs.Item>
            <GlassTabs.Item value="list">List</GlassTabs.Item>
          </GlassTabs>
          <span
            aria-hidden
            style={{ width: 1, height: 16, background: 'var(--ls-border-glass)', margin: '0 6px' }}
          />
          <span
            style={{
              // Mono path crumb — Finder's hallmark "where am I" indicator.
              fontFamily: 'var(--ls-font-mono)',
              fontSize: 'var(--ls-text-xs)',
              color: 'var(--ls-fg-secondary)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            ~/activity/{sourceDef.id}
          </span>
          <span className="flex-1 min-w-0" />
          <GlassChip tone="accent" size="xs">
            {filtered.length} item{filtered.length === 1 ? '' : 's'}
          </GlassChip>
        </GlassToolbar>
      </div>

      {/* Body — sidebar + content. Two columns, the sidebar is a fixed-width
          glass panel; the content pane scrolls. */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '180px 1fr',
          gap: 12,
          padding: '0 12px 12px',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        <SourceSidebar value={source} onChange={setSource} events={events} />
        <div
          style={{
            background: 'var(--ls-sand-50)',
            borderRadius: 'var(--ls-r-md)',
            border: '1px solid var(--ls-border-glass)',
            overflowY: 'auto',
            minHeight: 0,
          }}
        >
          {loading && filtered.length === 0 ? (
            <CenterMessage>Loading feed…</CenterMessage>
          ) : filtered.length === 0 ? (
            <CenterMessage>Nothing here yet.</CenterMessage>
          ) : view === 'icons' ? (
            <IconGrid events={filtered} />
          ) : (
            <ListView events={filtered} />
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

interface SourceSidebarProps {
  value: Source;
  onChange: (next: Source) => void;
  events: ActivityEvent[];
}

function SourceSidebar({ value, onChange, events }: SourceSidebarProps) {
  return (
    <GlassPanel
      blur="subtle"
      tone="light"
      radius="md"
      bordered
      style={{
        padding: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        overflowY: 'auto',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--ls-font-display)',
          fontSize: 11,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          color: 'var(--ls-fg-muted)',
          padding: '6px 8px 4px',
        }}
      >
        Sources
      </div>
      {SOURCES.map(src => {
        const count = events.filter(src.match).length;
        const active = value === src.id;
        return (
          <button
            key={src.id}
            type="button"
            onClick={() => onChange(src.id)}
            aria-pressed={active}
            style={sidebarRowStyle(active)}
          >
            <span aria-hidden style={{ color: active ? 'var(--ls-fg-on-dark)' : 'var(--ls-fg-secondary)', display: 'inline-flex' }}>
              {src.icon}
            </span>
            <span
              style={{
                flex: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                // Mono labels per app brief — sidebar reads as Finder paths.
                fontFamily: 'var(--ls-font-mono)',
                fontSize: 'var(--ls-text-xs)',
                color: active ? 'var(--ls-fg-on-dark)' : 'var(--ls-fg-primary)',
              }}
            >
              {src.label}
            </span>
            <span
              style={{
                fontVariantNumeric: 'tabular-nums',
                fontFamily: 'var(--ls-font-mono)',
                fontSize: 10,
                color: active ? 'rgba(255,250,240,0.85)' : 'var(--ls-fg-muted)',
                minWidth: 22,
                textAlign: 'right',
              }}
            >
              {count}
            </span>
          </button>
        );
      })}
    </GlassPanel>
  );
}

function sidebarRowStyle(active: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 10px',
    minHeight: 36,
    borderRadius: 'var(--ls-r-md)',
    border: 'none',
    background: active ? 'var(--ls-accent)' : 'transparent',
    color: active ? 'var(--ls-fg-on-dark)' : 'var(--ls-fg-primary)',
    cursor: 'pointer',
    textAlign: 'left',
    transition:
      'background-color var(--ls-dur-base) var(--ls-ease-soft), color var(--ls-dur-base) var(--ls-ease-soft)',
  };
}

// ---------------------------------------------------------------------------
// Icon grid + list view
// ---------------------------------------------------------------------------

function IconGrid({ events }: { events: ActivityEvent[] }) {
  return (
    <div
      role="grid"
      aria-label="Activity files"
      style={{
        display: 'grid',
        // 80pt thumbnails per app brief; 8pt gap; auto-fill so the grid
        // breathes inside narrow Finder windows.
        gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))',
        gap: 8,
        padding: 12,
      }}
    >
      {events.map((event, i) => (
        <FileTile key={`${event.txHash}-${i}`} event={event} />
      ))}
    </div>
  );
}

function FileTile({ event }: { event: ActivityEvent }) {
  return (
    <div
      role="gridcell"
      tabIndex={0}
      title={`${event.type} · block ${event.blockNumber.toLocaleString()} · ${shortHash(event.txHash)}`}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 6,
        padding: 8,
        borderRadius: 'var(--ls-r-md)',
        cursor: 'default',
        outline: 'none',
        transition: 'background-color var(--ls-dur-fast) var(--ls-ease-soft)',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.backgroundColor = 'var(--ls-sand-100)';
      }}
      onMouseLeave={e => {
        e.currentTarget.style.backgroundColor = 'transparent';
      }}
    >
      {/* 80pt thumb — solid sand tone with the type emoji centered. */}
      <div
        aria-hidden
        style={{
          width: 80,
          height: 80,
          borderRadius: 'var(--ls-r-md)',
          background: 'var(--ls-sand-100)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 36,
          lineHeight: 1,
          boxShadow:
            'inset 0 1px 0 rgba(255,250,240,0.7), 0 0 0 1px var(--ls-border-glass)',
        }}
      >
        {eventEmoji(event.type)}
      </div>
      {/* File name — Silkscreen 11pt per app brief. Single line, ellipsis. */}
      <div
        style={{
          fontFamily: 'var(--ls-font-display)',
          fontSize: 11,
          lineHeight: 1.3,
          color: 'var(--ls-fg-primary)',
          letterSpacing: 0.4,
          textAlign: 'center',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: 92,
          textTransform: 'uppercase',
        }}
      >
        {event.type.replace(/_/g, ' ')}
      </div>
      <div
        style={{
          fontFamily: 'var(--ls-font-mono)',
          fontSize: 10,
          color: 'var(--ls-fg-muted)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        #{event.blockNumber.toLocaleString()}
      </div>
    </div>
  );
}

function ListView({ events }: { events: ActivityEvent[] }) {
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {events.map((event, i) => (
        <li
          key={`${event.txHash}-${i}`}
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            padding: '12px 16px',
            gap: 12,
            minHeight: 44, // HIG touch target
            borderBottom:
              i === events.length - 1 ? 'none' : '1px solid var(--ls-border-glass)',
            fontFamily: 'var(--ls-font-sans)',
            fontSize: 'var(--ls-text-sm)',
            lineHeight: 1.4,
          }}
        >
          <span aria-hidden style={{ fontSize: 18, lineHeight: 1, width: 24, textAlign: 'center' }}>
            {eventEmoji(event.type)}
          </span>
          <span
            style={{
              fontFamily: 'var(--ls-font-display)',
              fontSize: 11,
              lineHeight: 1.4,
              fontWeight: 700,
              color: 'var(--ls-fg-primary)',
              minWidth: 110,
              textTransform: 'uppercase',
              letterSpacing: 0.6,
            }}
          >
            {event.type.replace(/_/g, ' ')}
          </span>
          <span
            style={{
              flex: 1,
              color: 'var(--ls-fg-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontFamily: 'var(--ls-font-mono)',
              fontSize: 'var(--ls-text-xs)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            block {event.blockNumber.toLocaleString()} · {shortHash(event.txHash)}
          </span>
          <span
            style={{
              color: 'var(--ls-fg-muted)',
              fontSize: 'var(--ls-text-xs)',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatRelativeTime(event.timestamp)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function CenterMessage({ children }: { children: ReactElement | string }) {
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        gap: 10,
        padding: 24,
        color: 'var(--ls-fg-muted)',
        fontFamily: 'var(--ls-font-sans)',
        fontSize: 'var(--ls-text-md)',
      }}
    >
      <Info size={22} />
      <span>{children}</span>
    </div>
  );
}
