import { useMemo } from 'react';

import { useActivityFeed } from '@/components/TerminalFeed/useActivityFeed';

const labelStyle: React.CSSProperties = {
  fontFamily: 'var(--theme-font-display)',
  fontSize: 11,
  textTransform: 'uppercase',
  letterSpacing: 1,
  color: 'var(--theme-text-muted)',
  marginBottom: 6,
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
    <div style={{ padding: 12, fontFamily: 'var(--theme-font-display)' }}>
      <div style={labelStyle}>Recent Activity</div>
      {loading && recent.length === 0 ? (
        <div style={{ color: 'var(--theme-text-muted)', fontSize: 12, padding: 8 }}>
          loading feed…
        </div>
      ) : recent.length === 0 ? (
        <div style={{ color: 'var(--theme-text-muted)', fontSize: 12, padding: 8 }}>
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
                padding: '6px 4px',
                borderBottom:
                  i === recent.length - 1 ? 'none' : '1px dotted var(--theme-feed-row-border)',
                fontFamily: 'var(--theme-font-body)',
                fontSize: 13,
              }}
            >
              <span
                style={{
                  fontFamily: 'var(--theme-font-display)',
                  fontSize: 11,
                  fontWeight: 700,
                  color: 'var(--theme-accent-text)',
                  minWidth: 90,
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
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
                  paddingLeft: 8,
                }}
              >
                block {event.blockNumber.toLocaleString()}
              </span>
              <span style={{ color: 'var(--theme-text-muted)', fontSize: 11 }}>
                {new Date(event.timestamp).toLocaleTimeString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
