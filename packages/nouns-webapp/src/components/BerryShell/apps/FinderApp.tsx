import { useMemo } from 'react';

import { useActivityFeed } from '@/components/TerminalFeed/useActivityFeed';

// HIG 8pt grid: 16pt content padding, 11pt label, 13pt body
const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--ls-font-sans, var(--theme-font-display))',
  fontSize: 11,
  lineHeight: 1.4,
  textTransform: 'uppercase',
  letterSpacing: 0.6,
  fontWeight: 600,
  color: 'var(--theme-text-muted)',
  marginBottom: 8,
};

/**
 * FinderApp — dashboard window listing recent on-chain activity.
 * Equivalent to the right-hand "Recent Activity" panel from the static
 * BerryHome scaffold, but lives in its own draggable window now.
 */
export default function FinderApp() {
  const { events, loading } = useActivityFeed('');

  const recent = useMemo(() => events.slice(0, 12), [events]);

  return (
    <div style={{ padding: 16, fontFamily: 'var(--ls-font-sans, var(--theme-font-display))' }}>
      <div style={labelStyle}>Recent Activity</div>
      {loading && recent.length === 0 ? (
        <div style={{ color: 'var(--theme-text-muted)', fontSize: 13, lineHeight: 1.4, padding: 16 }}>
          loading feed…
        </div>
      ) : recent.length === 0 ? (
        <div style={{ color: 'var(--theme-text-muted)', fontSize: 13, lineHeight: 1.4, padding: 16 }}>
          no activity yet.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {recent.map((event, i) => (
            <li
              key={`${event.txHash}-${i}`}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '12px 8px',
                gap: 12,
                minHeight: 44,
                borderBottom:
                  i === recent.length - 1 ? 'none' : '1px dotted var(--theme-feed-row-border)',
                fontFamily: 'var(--ls-font-sans, var(--theme-font-body))',
                fontSize: 13,
                lineHeight: 1.4,
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--ls-font-sans, var(--theme-font-display))',
                  fontSize: 11,
                  lineHeight: 1.4,
                  fontWeight: 700,
                  color: 'var(--theme-accent-text)',
                  minWidth: 96,
                  textTransform: 'uppercase',
                  letterSpacing: 0.6,
                }}
              >
                {event.type.replace(/_/g, ' ')}
              </span>
              <span
                style={{
                  flex: 1,
                  color: 'var(--theme-text-secondary)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                block {event.blockNumber.toLocaleString()}
              </span>
              <span style={{ color: 'var(--theme-text-muted)', fontSize: 11, lineHeight: 1.4, fontVariantNumeric: 'tabular-nums' }}>
                {new Date(event.timestamp).toLocaleTimeString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
