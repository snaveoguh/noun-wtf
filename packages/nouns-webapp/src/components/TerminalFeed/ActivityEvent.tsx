import type { CandidateTitleLookup, EnsLookup } from './eventRegistry';
import type { ActivityEvent as ActivityEventType } from './useActivityFeed';

import { useState, type CSSProperties } from 'react';

import ReactMarkdown from 'react-markdown';
import { Link } from 'react-router';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';

import ClientBadge from '@/components/ClientBadge';
import { getClientInfo } from '@/utils/clientRegistry';

import AsciiImage from './AsciiImage';
import {
  describeEvent,
  getEventDef,
  getEventLink,
  getExpandableText,
  timeAgo,
} from './eventRegistry';

interface Props {
  event: ActivityEventType;
  ensLookup?: EnsLookup;
  candidateTitleLookup?: CandidateTitleLookup;
}

const ETHERSCAN_BASE = 'https://etherscan.io/tx/';

/** Treat `https:` URLs as the only safe transport for embedded media. */
function isSafeHttpsUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url, 'https://noun.wtf');
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseClientId(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

export default function ActivityEvent({ event, ensLookup, candidateTitleLookup }: Props) {
  const [expanded, setExpanded] = useState(false);
  const data = event.data ?? {};
  const def = getEventDef(event.type, data);
  const { color, label } = def;
  const description = describeEvent(event.type, data, ensLookup, candidateTitleLookup);
  const age = timeAgo(event.timestamp);
  // Derived events (state transitions the indexer infers from block height —
  // voting started, objection period, ended…) have no tx of their own.
  const isDerived = !event.txHash;
  const expandableText = getExpandableText(event.type, data);
  const clientId = parseClientId(data.clientId);
  const clientInfo = clientId != null ? getClientInfo(clientId) : null;
  // Expand when there's long-form text, or (for reason-bearing types like
  // VOTE) when there's at least a client to name in the footer.
  const expandable = expandableText !== null || (def.expand === 'reason' && clientInfo != null);
  const isMarkdown = def.expand === 'markdown';
  const viewHref = getEventLink(event.type, data);

  // Check if this event has an image (proposals/candidates)
  const imageUrl = expanded ? (data.imageUrl as string | undefined) : undefined;

  const mutedLink: CSSProperties = {
    color: 'var(--theme-text-muted)',
    fontSize: '11px',
    flexShrink: 0,
    textDecoration: 'none',
    paddingTop: '2px',
  };
  const hoverIn = (e: React.MouseEvent) => {
    (e.target as HTMLElement).style.color = 'var(--theme-text-secondary)';
  };
  const hoverOut = (e: React.MouseEvent) => {
    (e.target as HTMLElement).style.color = 'var(--theme-text-muted)';
  };

  return (
    <div
      className="terminal-event"
      data-event-type={def.variantKey}
      data-derived={isDerived ? 'true' : undefined}
      style={
        {
          padding: '3px 0',
          borderBottom: '1px solid var(--theme-feed-row-border)',
          lineHeight: 1.35,
          opacity: isDerived ? 0.82 : 1,
          // Exposed for disco mode — the rainbow row gradient builds off this.
          // Harmless when disco is off (no rule consumes it).
          ['--event-color' as string]: color,
        } as CSSProperties
      }
    >
      {/* Main row. Child order matters: disco CSS styles the badge via
          `> div > span:nth-child(3)` (client slot, time, badge, …). */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          gap: '6px',
          cursor: expandable ? 'pointer' : 'default',
        }}
        onClick={() => {
          if (expandable) setExpanded(!expanded);
        }}
      >
        {/* Client emoji — fixed slot at the far left of the row so the
            following columns stay vertically aligned across rows even when
            an event has no clientId. */}
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '16px',
            flexShrink: 0,
            paddingTop: '1px',
          }}
          onClick={e => e.stopPropagation()}
        >
          {clientId != null && <ClientBadge clientId={clientId} size={13} />}
        </span>

        {/* Timestamp (+ `~` for derived / tx-less events) */}
        <span
          style={{
            color: 'var(--theme-text-muted)',
            fontSize: '12px',
            minWidth: '36px',
            textAlign: 'right',
            flexShrink: 0,
            paddingTop: '1px',
            whiteSpace: 'nowrap',
          }}
          title={isDerived ? 'derived from block height — no transaction' : undefined}
        >
          {age}
          {isDerived && <span style={{ opacity: 0.55 }}>~</span>}
        </span>

        {/* Type badge */}
        <span
          style={{
            color,
            fontSize: '11px',
            minWidth: '64px',
            flexShrink: 0,
            paddingTop: '2px',
            letterSpacing: '0.5px',
          }}
        >
          {label}
        </span>

        {/* Description */}
        <span
          style={{
            color: 'var(--theme-text-secondary)',
            fontSize: '13px',
            flex: 1,
            wordBreak: 'break-word',
          }}
        >
          {description}
          {expandable && (
            <span style={{ color: 'var(--theme-text-muted)', fontSize: '11px', marginLeft: '6px' }}>
              {expanded ? '▾' : '▸'}
            </span>
          )}
        </span>

        {/* View link (internal, e.g. noun / candidate / proposal / fork page). */}
        {viewHref && (
          <Link
            to={viewHref}
            style={mutedLink}
            onMouseEnter={hoverIn}
            onMouseLeave={hoverOut}
            onClick={e => e.stopPropagation()}
          >
            view
          </Link>
        )}

        {/* TX link — absent for derived events. */}
        {event.txHash && (
          <a
            href={`${ETHERSCAN_BASE}${event.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            style={mutedLink}
            onMouseEnter={hoverIn}
            onMouseLeave={hoverOut}
            onClick={e => e.stopPropagation()}
            title={event.txHash}
          >
            tx
          </a>
        )}
      </div>

      {/* Expanded content */}
      {expanded && expandable && (
        <div
          style={{
            marginTop: '8px',
            marginLeft: '112px', // align with description column (36 + 12 + 64)
            marginRight: '24px',
            padding: '10px 12px',
            background: 'var(--theme-bg-card)',
            borderLeft: `2px solid ${color}`,
            color: 'var(--theme-text-secondary)',
            fontSize: '12px',
            lineHeight: 1.7,
            wordBreak: 'break-word',
            overflowWrap: 'anywhere',
            maxHeight: '600px',
            overflowY: 'auto',
            overflowX: 'hidden',
            animation: 'terminalRowExpand 140ms ease-out',
          }}
          className="terminal-scrollbar terminal-row-expanded"
        >
          {/* ASCII art of proposal image */}
          {imageUrl && <AsciiImage imageUrl={imageUrl} cols={70} />}

          {expandableText && isMarkdown ? (
            <ReactMarkdown
              // No rehype-raw → raw HTML in the markdown is rendered as text,
              // not parsed. This is the safe-by-default react-markdown config.
              remarkPlugins={[remarkGfm, remarkBreaks]}
              components={{
                p: ({ ...props }) => <p {...props} style={{ margin: '0 0 8px' }} />,
                h1: ({ ...props }) => (
                  <h1
                    {...props}
                    style={{
                      fontSize: '14px',
                      margin: '8px 0 6px',
                      color: 'var(--theme-text-primary)',
                    }}
                  />
                ),
                h2: ({ ...props }) => (
                  <h2
                    {...props}
                    style={{
                      fontSize: '13px',
                      margin: '8px 0 6px',
                      color: 'var(--theme-text-primary)',
                    }}
                  />
                ),
                h3: ({ ...props }) => (
                  <h3
                    {...props}
                    style={{
                      fontSize: '12px',
                      margin: '6px 0 4px',
                      color: 'var(--theme-text-primary)',
                    }}
                  />
                ),
                strong: ({ ...props }) => (
                  <strong {...props} style={{ color: 'var(--theme-text-primary)' }} />
                ),
                em: ({ ...props }) => (
                  <em {...props} style={{ color: 'var(--theme-text-primary)' }} />
                ),
                code: ({ ...props }) => (
                  <code
                    {...props}
                    style={{
                      background: 'var(--theme-bg-tertiary)',
                      padding: '1px 4px',
                      borderRadius: 'var(--theme-radius-sm)',
                      fontSize: '11px',
                    }}
                  />
                ),
                pre: ({ ...props }) => (
                  <pre
                    {...props}
                    style={{
                      background: 'var(--theme-bg-tertiary)',
                      padding: '8px 10px',
                      borderRadius: 'var(--theme-radius-sm)',
                      overflowX: 'auto',
                      fontSize: '11px',
                      margin: '6px 0',
                    }}
                  />
                ),
                ul: ({ ...props }) => (
                  <ul {...props} style={{ paddingLeft: 18, margin: '4px 0' }} />
                ),
                ol: ({ ...props }) => (
                  <ol {...props} style={{ paddingLeft: 18, margin: '4px 0' }} />
                ),
                blockquote: ({ ...props }) => (
                  <blockquote
                    {...props}
                    style={{
                      borderLeft: '2px solid var(--theme-border)',
                      paddingLeft: 8,
                      margin: '6px 0',
                      color: 'var(--theme-text-muted)',
                    }}
                  />
                ),
                a: ({ href, ...props }) => {
                  if (!isSafeHttpsUrl(href)) {
                    return <span {...props} style={{ color: 'var(--theme-text-muted)' }} />;
                  }
                  return (
                    <a
                      {...props}
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={e => e.stopPropagation()}
                      style={{ color: 'var(--theme-text-link)', textDecoration: 'underline' }}
                    />
                  );
                },
                img: ({ src, alt }) => {
                  if (!isSafeHttpsUrl(src)) return null;
                  return (
                    <img
                      src={src}
                      alt={alt || ''}
                      loading="lazy"
                      style={{
                        maxWidth: '100%',
                        height: 'auto',
                        borderRadius: 6,
                        margin: '6px 0',
                        display: 'block',
                      }}
                      onError={e => {
                        (e.currentTarget as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  );
                },
              }}
            >
              {expandableText}
            </ReactMarkdown>
          ) : expandableText ? (
            <div style={{ whiteSpace: 'pre-wrap' }}>{expandableText}</div>
          ) : null}

          {/* Client attribution — "via nouns.camp" — from the ClientBadge registry. */}
          {clientInfo && (
            <div
              style={{
                marginTop: expandableText ? '6px' : 0,
                color: 'var(--theme-text-muted)',
                fontSize: '11px',
              }}
            >
              via {clientInfo.name}
              {isDerived ? ' · derived' : ''}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
