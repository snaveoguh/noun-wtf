import { FC } from 'react';

import { Link } from 'react-router';

import { ProposalState, useAllProposals } from '@/wrappers/nounsDao';

const STATUS_LABELS: Record<number, string> = {
  [ProposalState.PENDING]: 'Pending',
  [ProposalState.ACTIVE]: 'Active',
  [ProposalState.UPDATABLE]: 'Updatable',
  [ProposalState.QUEUED]: 'Queued',
  [ProposalState.OBJECTION_PERIOD]: 'Objection',
  [ProposalState.SUCCEEDED]: 'Succeeded',
};

const STATUS_COLORS: Record<number, { bg: string; color: string }> = {
  [ProposalState.PENDING]: { bg: '#43b369', color: '#fff' },
  [ProposalState.ACTIVE]: { bg: '#43b369', color: '#fff' },
  [ProposalState.UPDATABLE]: { bg: '#fff', color: '#dc9e46' },
  [ProposalState.QUEUED]: { bg: '#8c8d92', color: '#fff' },
  [ProposalState.OBJECTION_PERIOD]: { bg: '#fff', color: '#e40536' },
  [ProposalState.SUCCEEDED]: { bg: '#4965d0', color: '#fff' },
};

/**
 * Condensed widget showing active/pending/queued proposals.
 * Designed to sit inside the NounsIntroSection where the dream button used to be.
 */
const ActiveProposalsWidget: FC = () => {
  const { data: proposals, loading } = useAllProposals();

  // Filter to only "live" proposals
  const active = (proposals ?? []).filter(
    p =>
      p.status === ProposalState.ACTIVE ||
      p.status === ProposalState.PENDING ||
      p.status === ProposalState.UPDATABLE ||
      p.status === ProposalState.QUEUED ||
      p.status === ProposalState.OBJECTION_PERIOD ||
      p.status === ProposalState.SUCCEEDED,
  );

  if (loading && active.length === 0) {
    return (
      <div style={{ marginTop: 12, opacity: 0.5, fontSize: '0.8rem', fontFamily: "'PT Root UI'" }}>
        Loading proposals...
      </div>
    );
  }

  if (active.length === 0) return null;

  return (
    <div style={{ marginTop: 16, maxWidth: 420 }}>
      <div
        style={{
          fontFamily: "'Londrina Solid'",
          fontSize: '1.1rem',
          fontWeight: 400,
          color: '#000',
          marginBottom: 8,
          letterSpacing: '0.02em',
        }}
      >
        Vote on Active Proposals
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {active
          .slice()
          .reverse()
          .slice(0, 8)
          .map(p => {
            const statusStyle = STATUS_COLORS[p.status] ?? { bg: '#8c8d92', color: '#fff' };
            const statusLabel = STATUS_LABELS[p.status] ?? '?';

            return (
              <Link
                key={p.id}
                to={`/vote/${p.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  padding: '8px 12px',
                  borderRadius: 10,
                  border: '1px solid #e2e3e8',
                  background: '#f4f4f8',
                  textDecoration: 'none',
                  color: 'inherit',
                  fontFamily: "'PT Root UI'",
                  fontWeight: 700,
                  fontSize: '0.8rem',
                  transition: 'background 0.15s',
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.background = '#fff';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.background = '#f4f4f8';
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    overflow: 'hidden',
                    minWidth: 0,
                  }}
                >
                  <span style={{ color: '#8c8d92', flexShrink: 0 }}>{p.id}</span>
                  <span
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {p.title}
                  </span>
                </div>

                <span
                  style={{
                    flexShrink: 0,
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 6,
                    background: statusStyle.bg,
                    color: statusStyle.color,
                    border:
                      p.status === ProposalState.UPDATABLE
                        ? '1.5px solid #f0ad4e'
                        : p.status === ProposalState.OBJECTION_PERIOD
                          ? '1.5px solid #e40536'
                          : '1.5px solid transparent',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {statusLabel}
                </span>
              </Link>
            );
          })}
      </div>

      <Link
        to="/vote"
        style={{
          display: 'inline-block',
          marginTop: 8,
          fontSize: '0.75rem',
          fontWeight: 700,
          fontFamily: "'PT Root UI'",
          color: '#8c8d92',
          textDecoration: 'none',
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLElement).style.color = '#000';
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLElement).style.color = '#8c8d92';
        }}
      >
        View all proposals →
      </Link>
    </div>
  );
};

export default ActiveProposalsWidget;
