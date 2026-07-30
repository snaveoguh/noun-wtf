/**
 * OnchainFeed — above-the-fold "onchain feed" band for the homepage.
 *
 * Polls /api/onchain-feed (via useOnchainFeed, mock fallback until the API
 * ships) and renders sales / bids / registrations / settlements / props across
 * Nouns, NounV2, Punks, ENS and Toadz in one of 4 switchable visual variants:
 *   1 wire          — dense news-wire rows (light)
 *   2 terminal      — dark monospace stream, site terminal aesthetic
 *   3 ticker-cards  — horizontally scrolling cards like the homepage bands
 *   4 ledger        — ultra-tight zebra table
 *
 * Variant choice persists in localStorage. A terminal-styled search input +
 * source chips filter items client-side.
 */
import { FC, ReactNode, useEffect, useMemo, useRef, useState } from 'react';

import { Bone } from '@/components/Skeleton';
import { useDraggableScroll } from '@/hooks/useDraggableScroll';
import { FeedItem, FeedSource, useOnchainFeed } from '@/hooks/useOnchainFeed';

import { displayNameFor } from './addressBook';
import AddressTag, { SOURCE_COLOR, SOURCE_LABEL, SourceGlyph } from './AddressTag';

// ─── Formatting helpers ───────────────────────────────────────────────────────

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

function formatEth(weiStr: string | null): string | null {
  if (!weiStr) return null;
  let v: number;
  try {
    v = Number(BigInt(weiStr)) / 1e18;
  } catch {
    return null;
  }
  if (!Number.isFinite(v)) return null;
  if (v === 0) return '0';
  if (v >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (v >= 1) return v.toFixed(2);
  if (v >= 0.001) return v.toFixed(3);
  return '<0.001';
}

function timeAgo(unixSec: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - unixSec);
  if (diff < 60) return `${diff}s`;
  const mins = Math.floor(diff / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function thingLabel(item: FeedItem): string {
  switch (item.source) {
    case 'nouns':
      return item.tokenId != null ? `Noun ${item.tokenId}` : 'Noun';
    case 'nounv2':
      return item.tokenId != null ? `V2 Noun ${item.tokenId}` : 'V2 Noun';
    case 'punks':
      return item.tokenId != null ? `Punk #${item.tokenId}` : 'Punk';
    case 'toadz':
      return item.tokenId != null ? `Toad #${item.tokenId}` : 'Toad';
    case 'ens':
      return item.name ?? 'ENS name';
    default:
      return item.name ?? 'item';
  }
}

/** Full one-line sentence (price inline) — wire + terminal variants. */
function sentence(item: FeedItem, price: string | null): string {
  const thing = thingLabel(item);
  switch (item.kind) {
    case 'sale':
      return price ? `${thing} sold for ${price} ETH` : `${thing} sold`;
    case 'registration':
      return `${item.name ?? thing} registered`;
    case 'bid':
      return price ? `bid ${price} on ${thing}` : `bid on ${thing}`;
    case 'settled':
      return price ? `${thing} settled — ${price} ETH` : `${thing} settled`;
    case 'transfer':
      return `${thing} transferred`;
    case 'proposal':
      return `new prop: ${item.name ?? `#${item.tokenId ?? '?'}`}`;
    case 'grant':
      return `new grant: ${item.name ?? 'untitled'}`;
    case 'mint':
      return `${thing} minted`;
    default:
      return `${thing} ${item.kind}`;
  }
}

/** Sentence without the price — ledger variant (price lives in its own column). */
function shortLine(item: FeedItem): string {
  const thing = thingLabel(item);
  switch (item.kind) {
    case 'sale':
      return `${thing} sold`;
    case 'registration':
      return `${item.name ?? thing} registered`;
    case 'bid':
      return `bid on ${thing}`;
    case 'settled':
      return `${thing} settled`;
    case 'transfer':
      return `${thing} transferred`;
    case 'proposal':
      return `new prop: ${item.name ?? `#${item.tokenId ?? '?'}`}`;
    case 'grant':
      return `new grant: ${item.name ?? 'untitled'}`;
    case 'mint':
      return `${thing} minted`;
    default:
      return `${thing} ${item.kind}`;
  }
}

// ─── Filters / variants config ────────────────────────────────────────────────

type SourceFilter = 'all' | FeedSource;

const SOURCE_CHIPS: { key: SourceFilter; label: string }[] = [
  { key: 'all', label: 'ALL' },
  { key: 'nouns', label: 'NOUNS' },
  { key: 'ens', label: 'ENS' },
  { key: 'punks', label: 'PUNKS' },
  { key: 'toadz', label: 'TOADZ' },
  { key: 'nounv2', label: 'V2' },
];

const VARIANT_KEY = 'onchainFeedVariant';
const VARIANTS = [1, 2, 3, 4] as const;
type Variant = (typeof VARIANTS)[number];

function loadVariant(): Variant {
  try {
    const v = Number(window.localStorage.getItem(VARIANT_KEY));
    if (v === 1 || v === 2 || v === 3 || v === 4) return v;
  } catch {
    /* private mode etc. */
  }
  return 4; // ledger — Hugo's pick 2026-07-30
}

// ─── Shared row bits ──────────────────────────────────────────────────────────

interface VariantProps {
  items: FeedItem[];
  resolved: Record<string, string>;
}

const PriceText: FC<{ price: string | null; color?: string }> = ({ price, color }) =>
  price ? (
    <span
      style={{
        fontFamily: MONO,
        fontWeight: 700,
        fontSize: '0.72rem',
        color: color ?? '#14141f',
        whiteSpace: 'nowrap',
        fontVariantNumeric: 'tabular-nums',
      }}
    >
      {price} ETH
    </span>
  ) : null;

// ─── V1 · wire ────────────────────────────────────────────────────────────────

const WireVariant: FC<VariantProps> = ({ items, resolved }) => (
  <div>
    {items.map(item => {
      const price = formatEth(item.valueWei);
      return (
        <div
          key={item.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '5px 14px',
            borderBottom: '1px solid rgba(0,0,0,0.05)',
            fontSize: '0.75rem',
            fontFamily: "'PT Root UI', sans-serif",
            color: '#2a2a3a',
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontFamily: MONO,
              fontSize: '0.62rem',
              color: '#9a948c',
              width: 26,
              flexShrink: 0,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {timeAgo(item.timestamp)}
          </span>
          <SourceGlyph source={item.source} size={11} />
          <span
            style={{
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              flex: 1,
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {sentence(item, price)}
            </span>
            {(item.counterparty || item.actor) && (
              <span
                style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}
                className="hidden sm:inline-flex"
              >
                <span style={{ color: '#c2bcb2' }}>—</span>
                {item.counterparty && (
                  <>
                    <AddressTag address={item.counterparty} resolved={resolved} />
                    <span style={{ color: '#c2bcb2', fontSize: '0.65rem' }}>→</span>
                  </>
                )}
                {item.actor && <AddressTag address={item.actor} resolved={resolved} />}
              </span>
            )}
          </span>
          <PriceText price={price} />
        </div>
      );
    })}
  </div>
);

// ─── V2 · terminal ────────────────────────────────────────────────────────────

const TerminalVariant: FC<VariantProps> = ({ items, resolved }) => (
  <div style={{ background: '#0c0c14', padding: '6px 0' }}>
    {items.map(item => {
      const price = formatEth(item.valueWei);
      return (
        <div
          key={item.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '3px 14px',
            fontFamily: MONO,
            fontSize: '0.7rem',
            color: '#c9c9d6',
            animation: 'ocfSlideIn 0.35s ease',
            minWidth: 0,
          }}
        >
          <span
            style={{
              color: '#55556a',
              fontSize: '0.62rem',
              width: 28,
              flexShrink: 0,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {timeAgo(item.timestamp)}
          </span>
          <span
            style={{
              color: SOURCE_COLOR[item.source],
              fontWeight: 700,
              flexShrink: 0,
              fontSize: '0.62rem',
              letterSpacing: '0.05em',
            }}
          >
            [{SOURCE_LABEL[item.source]}]
          </span>
          <span
            style={{
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {sentence(item, null)}
            </span>
            {item.actor && (
              <AddressTag address={item.actor} resolved={resolved} dark style={{ flexShrink: 0 }} />
            )}
          </span>
          <PriceText price={price} color="#22c55e" />
        </div>
      );
    })}
  </div>
);

// ─── V3 · ticker-cards ────────────────────────────────────────────────────────

const TickerCardsVariant: FC<VariantProps> = ({ items, resolved }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const animRef = useRef<number>(0);
  const pausedRef = useRef(false);
  const { onPointerDown, onClickCapture } = useDraggableScroll(scrollRef, pausedRef);

  // Auto-scroll like the other homepage bands
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || items.length === 0) return;

    const speed = 0.6;
    let pos = el.scrollLeft;
    let wasPaused = false;

    const tick = () => {
      if (pausedRef.current) {
        wasPaused = true;
      } else {
        if (wasPaused) {
          pos = el.scrollLeft;
          wasPaused = false;
        }
        pos += speed;
        const halfWidth = el.scrollWidth / 2;
        if (halfWidth > 0 && pos >= halfWidth) pos -= halfWidth;
        el.scrollLeft = pos;
      }
      animRef.current = requestAnimationFrame(tick);
    };

    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, [items]);

  // Duplicate for seamless loop (only when there's enough to scroll)
  const display = items.length > 3 ? [...items, ...items] : items;

  return (
    <div
      ref={scrollRef}
      onPointerDown={onPointerDown}
      onClickCapture={onClickCapture}
      onMouseEnter={() => {
        pausedRef.current = true;
      }}
      onMouseLeave={() => {
        pausedRef.current = false;
      }}
      style={{
        display: 'flex',
        gap: 8,
        overflow: 'hidden',
        scrollbarWidth: 'none',
        padding: '10px 14px',
        cursor: 'grab',
      }}
    >
      {display.map((item, i) => {
        const price = formatEth(item.valueWei);
        return (
          <div
            key={`${item.id}-${i}`}
            style={{
              flexShrink: 0,
              width: 190,
              borderRadius: 10,
              border: '1px solid rgba(0,0,0,0.07)',
              background: '#fff',
              boxShadow: '0 1px 4px rgba(0,0,0,0.05)',
              padding: '8px 10px',
              display: 'flex',
              flexDirection: 'column',
              gap: 5,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <SourceGlyph source={item.source} size={11} />
              <span
                style={{
                  fontSize: '0.55rem',
                  fontWeight: 800,
                  letterSpacing: '0.1em',
                  color: SOURCE_COLOR[item.source],
                }}
              >
                {SOURCE_LABEL[item.source]}
              </span>
              <span
                style={{
                  marginLeft: 'auto',
                  fontFamily: MONO,
                  fontSize: '0.58rem',
                  color: '#b0aaa0',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {timeAgo(item.timestamp)}
              </span>
            </div>
            <div
              style={{
                fontFamily: "'PT Root UI', sans-serif",
                fontSize: '0.72rem',
                fontWeight: 600,
                color: '#2a2a3a',
                lineHeight: 1.25,
                overflow: 'hidden',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
              }}
            >
              {sentence(item, null)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, minWidth: 0 }}>
              {item.actor && (
                <AddressTag address={item.actor} resolved={resolved} style={{ maxWidth: 110 }} />
              )}
              <span style={{ marginLeft: 'auto' }}>
                <PriceText price={price} />
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ─── V4 · ledger ──────────────────────────────────────────────────────────────

const LedgerVariant: FC<VariantProps> = ({ items, resolved }) => (
  <table
    style={{
      width: '100%',
      borderCollapse: 'collapse',
      fontFamily: "'PT Root UI', sans-serif",
      fontSize: '0.7rem',
      fontVariantNumeric: 'tabular-nums',
    }}
  >
    <thead>
      <tr>
        {['TIME', 'WHAT', 'WHO', 'AMOUNT'].map(h => (
          <th
            key={h}
            style={{
              position: 'sticky',
              top: 0,
              zIndex: 1,
              background: '#f6f3ef',
              textAlign: h === 'AMOUNT' ? 'right' : 'left',
              padding: '4px 14px',
              fontSize: '0.55rem',
              fontWeight: 800,
              letterSpacing: '0.12em',
              color: '#9a948c',
              borderBottom: '1px solid rgba(0,0,0,0.08)',
            }}
          >
            {h}
          </th>
        ))}
      </tr>
    </thead>
    <tbody>
      {items.map((item, i) => {
        const price = formatEth(item.valueWei);
        return (
          <tr
            key={item.id}
            style={{ background: i % 2 === 1 ? 'rgba(0,0,0,0.025)' : 'transparent' }}
          >
            <td
              style={{
                padding: '3px 14px',
                fontFamily: MONO,
                fontSize: '0.62rem',
                color: '#9a948c',
                whiteSpace: 'nowrap',
                width: 1,
              }}
            >
              {timeAgo(item.timestamp)}
            </td>
            <td style={{ padding: '3px 14px', color: '#2a2a3a', minWidth: 0 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <SourceGlyph source={item.source} size={10} />
                <span
                  style={{
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: '38vw',
                    display: 'inline-block',
                    verticalAlign: 'middle',
                  }}
                >
                  {shortLine(item)}
                </span>
              </span>
            </td>
            <td style={{ padding: '3px 14px', whiteSpace: 'nowrap', width: 1 }}>
              {item.actor ? <AddressTag address={item.actor} resolved={resolved} /> : '—'}
            </td>
            <td
              style={{
                padding: '3px 14px',
                textAlign: 'right',
                whiteSpace: 'nowrap',
                width: 1,
              }}
            >
              {price ? <PriceText price={price} /> : <span style={{ color: '#c2bcb2' }}>—</span>}
            </td>
          </tr>
        );
      })}
    </tbody>
  </table>
);

// ─── Main component ───────────────────────────────────────────────────────────

const OnchainFeed: FC = () => {
  const { items, resolved, isMock, isLoading } = useOnchainFeed();
  const [variant, setVariant] = useState<Variant>(loadVariant);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');

  const pickVariant = (v: Variant) => {
    setVariant(v);
    try {
      window.localStorage.setItem(VARIANT_KEY, String(v));
    } catch {
      /* ignore */
    }
  };

  const filtered = useMemo(() => {
    let out = items;
    if (sourceFilter !== 'all') out = out.filter(i => i.source === sourceFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      out = out.filter(item => {
        const hay = [
          item.name,
          item.kind,
          item.source,
          item.tokenId,
          item.actor,
          item.counterparty,
          displayNameFor(item.actor, resolved),
          displayNameFor(item.counterparty, resolved),
          thingLabel(item),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase();
        return hay.includes(q);
      });
    }
    return out;
  }, [items, resolved, search, sourceFilter]);

  const isDark = variant === 2;

  let body: ReactNode;
  if (isLoading) {
    body = (
      <div style={{ padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[0, 1, 2, 3, 4].map(i => (
          <Bone key={i} w="100%" h={16} delay={i * 0.08} style={{ borderRadius: 4 }} />
        ))}
      </div>
    );
  } else if (filtered.length === 0) {
    body = (
      <div
        style={{
          padding: '24px 14px',
          textAlign: 'center',
          fontFamily: MONO,
          fontSize: '0.72rem',
          color: isDark ? '#55556a' : '#9a948c',
        }}
      >
        {search.trim() ? (
          <>
            no matches for “{search.trim()}”{' '}
            <button
              type="button"
              onClick={() => setSearch('')}
              style={{
                background: 'none',
                border: 'none',
                color: '#7c3aed',
                cursor: 'pointer',
                fontFamily: MONO,
                fontSize: '0.72rem',
                padding: 0,
                textDecoration: 'underline',
              }}
            >
              clear
            </button>
          </>
        ) : (
          'no onchain activity yet — watching the chain…'
        )}
      </div>
    );
  } else if (variant === 1) {
    body = <WireVariant items={filtered} resolved={resolved} />;
  } else if (variant === 2) {
    body = <TerminalVariant items={filtered} resolved={resolved} />;
  } else if (variant === 3) {
    body = <TickerCardsVariant items={filtered} resolved={resolved} />;
  } else {
    body = <LedgerVariant items={filtered} resolved={resolved} />;
  }

  return (
    <section
      aria-label="Onchain activity feed"
      style={{
        width: '100%',
        borderBottom: '1px solid rgba(0,0,0,0.08)',
        background: isDark ? '#0c0c14' : 'rgba(255,255,255,0.6)',
      }}
    >
      <style>{`
        @keyframes ocfSlideIn {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: none; }
        }
        @keyframes ocfPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.35; }
        }
      `}</style>

      {/* ── Header row ── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 8,
          padding: '8px 14px',
          borderBottom: isDark ? '1px solid rgba(255,255,255,0.08)' : '1px solid rgba(0,0,0,0.06)',
        }}
      >
        <span
          style={{
            fontFamily: "'Londrina Solid'",
            fontSize: '1rem',
            letterSpacing: '0.06em',
            color: isDark ? '#e8e8f2' : '#14141f',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 7,
          }}
        >
          ONCHAIN
          <span
            title={
              isMock ? 'Showing bundled mock data (API not live yet)' : 'Live — refreshes every 20s'
            }
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: isMock ? '#f59e0b' : '#22c55e',
              animation: 'ocfPulse 2s ease-in-out infinite',
              display: 'inline-block',
            }}
          />
          {isMock && (
            <span
              style={{
                fontFamily: MONO,
                fontSize: '0.52rem',
                fontWeight: 700,
                letterSpacing: '0.12em',
                color: '#f59e0b',
              }}
            >
              MOCK
            </span>
          )}
        </span>

        {/* Terminal search */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            flex: '1 1 160px',
            minWidth: 120,
            maxWidth: 320,
            padding: '3px 8px',
            borderRadius: 6,
            border: isDark ? '1px solid rgba(255,255,255,0.14)' : '1px solid rgba(0,0,0,0.14)',
            background: isDark ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.8)',
            fontFamily: MONO,
          }}
        >
          <span
            style={{
              color: '#22c55e',
              fontSize: '0.7rem',
              fontWeight: 700,
              userSelect: 'none',
            }}
          >
            &gt;
          </span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="filter the chain…"
            spellCheck={false}
            aria-label="Filter onchain feed"
            style={{
              flex: 1,
              minWidth: 0,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontFamily: MONO,
              fontSize: '0.7rem',
              color: isDark ? '#e8e8f2' : '#14141f',
              caretColor: '#22c55e',
            }}
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear filter"
              style={{
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                color: isDark ? '#55556a' : '#b0aaa0',
                fontSize: '0.7rem',
                padding: 0,
                lineHeight: 1,
              }}
            >
              ✕
            </button>
          )}
        </div>

        {/* Source chips */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
          {SOURCE_CHIPS.map(chip => {
            const active = sourceFilter === chip.key;
            const chipColor = chip.key === 'all' ? '#14141f' : SOURCE_COLOR[chip.key as FeedSource];
            return (
              <button
                key={chip.key}
                type="button"
                onClick={() => setSourceFilter(chip.key)}
                style={{
                  border: 'none',
                  cursor: 'pointer',
                  padding: '2px 8px',
                  borderRadius: 999,
                  fontSize: '0.55rem',
                  fontWeight: 800,
                  letterSpacing: '0.08em',
                  fontFamily: "'PT Root UI', sans-serif",
                  background: active
                    ? chipColor
                    : isDark
                      ? 'rgba(255,255,255,0.08)'
                      : 'rgba(0,0,0,0.06)',
                  color: active ? '#fff' : isDark ? '#8b8ba0' : '#666',
                  transition: 'background 0.12s, color 0.12s',
                }}
              >
                {chip.label}
              </button>
            );
          })}
        </div>

        {/* Variant switcher */}
        <div
          style={{
            display: 'flex',
            gap: 2,
            marginLeft: 'auto',
            padding: 2,
            borderRadius: 7,
            background: isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)',
          }}
        >
          {VARIANTS.map(v => (
            <button
              key={v}
              type="button"
              onClick={() => pickVariant(v)}
              aria-pressed={variant === v}
              title={['wire', 'terminal', 'ticker', 'ledger'][v - 1]}
              style={{
                border: 'none',
                cursor: 'pointer',
                width: 20,
                height: 18,
                borderRadius: 5,
                fontSize: '0.6rem',
                fontWeight: 800,
                fontFamily: MONO,
                background: variant === v ? (isDark ? '#e8e8f2' : '#14141f') : 'transparent',
                color: variant === v ? (isDark ? '#0c0c14' : '#fff') : isDark ? '#8b8ba0' : '#888',
                transition: 'background 0.12s, color 0.12s',
              }}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ maxHeight: '40vh', overflowY: variant === 3 ? 'hidden' : 'auto' }}>{body}</div>
    </section>
  );
};

export default OnchainFeed;
