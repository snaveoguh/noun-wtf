import { useMemo } from 'react';

import { ProposalState, useAllProposals } from '@/wrappers/nounsDao';

const STATE_COLORS: Record<ProposalState, { bg: string; fg: string; label: string }> = {
  [ProposalState.UNDETERMINED]: { bg: '#cccccc', fg: '#333', label: '?' },
  [ProposalState.PENDING]: { bg: '#9ec5fe', fg: '#003c7a', label: 'pending' },
  [ProposalState.ACTIVE]: { bg: '#a3e4a3', fg: '#1f5b1f', label: 'active' },
  [ProposalState.CANCELLED]: { bg: '#cccccc', fg: '#555', label: 'cancelled' },
  [ProposalState.DEFEATED]: { bg: '#f5b8b8', fg: '#7a1f1f', label: 'defeated' },
  [ProposalState.SUCCEEDED]: { bg: '#b8e7b8', fg: '#1f5b1f', label: 'succeeded' },
  [ProposalState.QUEUED]: { bg: '#fce6a6', fg: '#7a5a00', label: 'queued' },
  [ProposalState.EXPIRED]: { bg: '#cccccc', fg: '#555', label: 'expired' },
  [ProposalState.EXECUTED]: { bg: '#28a745', fg: '#fff', label: 'executed' },
  [ProposalState.VETOED]: { bg: '#f5b8b8', fg: '#7a1f1f', label: 'vetoed' },
  [ProposalState.OBJECTION_PERIOD]: { bg: '#fce6a6', fg: '#7a5a00', label: 'objecting' },
  [ProposalState.UPDATABLE]: { bg: '#9ec5fe', fg: '#003c7a', label: 'updatable' },
};

/**
 * VoteApp — proposal list inside a Berry window. Sorted newest first by id.
 * Click a row to open the canonical /vote/:id page.
 */
export default function VoteApp() {
  const { data: proposals, loading } = useAllProposals();

  const sorted = useMemo(() => {
    if (!proposals) return [];
    return [...proposals].sort((a, b) => Number(b.id ?? 0) - Number(a.id ?? 0));
  }, [proposals]);

  if (loading && !sorted.length) {
    return (
      <div style={{ padding: 16, color: 'var(--theme-text-muted)', fontSize: 12 }}>
        loading proposals…
      </div>
    );
  }

  if (!sorted.length) {
    return (
      <div style={{ padding: 16, color: 'var(--theme-text-muted)', fontSize: 12 }}>
        no proposals.
      </div>
    );
  }

  return (
    <div style={{ padding: 8 }}>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {sorted.slice(0, 60).map(p => {
          const status = STATE_COLORS[p.status] ?? STATE_COLORS[ProposalState.UNDETERMINED];
          return (
            <li key={p.id ?? '?'} style={{ borderBottom: '1px dotted var(--theme-feed-row-border)' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '8px 10px',
                  textDecoration: 'none',
                  color: 'var(--theme-text-primary)',
                  fontFamily: 'var(--theme-font-display)',
                  fontSize: 13,
                  cursor: 'default',
                }}
              >
                <span
                  style={{
                    fontWeight: 700,
                    minWidth: 36,
                    color: 'var(--theme-text-muted)',
                  }}
                >
                  {p.id ?? '—'}
                </span>
                <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {p.title || 'Untitled'}
                </span>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    background: status.bg,
                    color: status.fg,
                    padding: '2px 6px',
                    borderRadius: 0,
                    border: '1px solid rgba(0,0,0,0.2)',
                    textTransform: 'uppercase',
                    letterSpacing: 0.5,
                  }}
                >
                  {status.label}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
