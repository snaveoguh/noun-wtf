/**
 * LilNounsProposals — Shows Lil Nouns governance proposals sourced from the
 * Goldsky subgraph via our Ponder API proxy (falls back to on-chain multicall
 * if the proxy is unreachable). Each row links out to lilnouns.wtf in a new tab.
 */
import { FC, useEffect, useState } from 'react';

import {
  fetchLilNounsProposalsFromProxy,
  fetchLilNounsProposalsOnchain,
  type LilNounsProposal,
} from '@/lib/marketplace/governance';

const STATUS_COLORS: Record<string, string> = {
  PENDING: '#a78bfa',
  ACTIVE: '#22d3ee',
  CANCELLED: '#94a3b8',
  DEFEATED: '#f87171',
  SUCCEEDED: '#34d399',
  QUEUED: '#fbbf24',
  EXPIRED: '#8c8d92',
  EXECUTED: '#4ade80',
  VETOED: '#e40536',
  OBJECTION_PERIOD: '#fb923c',
  UPDATABLE: '#60a5fa',
};

function statusLabel(status: string): string {
  if (status === 'OBJECTION_PERIOD') return 'Objection';
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase();
}

function statusColor(status: string): string {
  return STATUS_COLORS[status] ?? '#8c8d92';
}

const LilNounsProposals: FC = () => {
  const [proposals, setProposals] = useState<LilNounsProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Proxy first (full titles + abstain votes + timestamps). Fall back to
    // direct on-chain multicall if the proxy is down.
    (async () => {
      try {
        const list = await fetchLilNounsProposalsFromProxy();
        if (cancelled) return;
        // Sort newest first and cap at 25 to match the prior on-chain UX.
        const top = list.sort((a, b) => b.id - a.id).slice(0, 25);
        setProposals(top);
        if (top.length === 0) setError('No proposals found.');
      } catch {
        try {
          const list = await fetchLilNounsProposalsOnchain(25);
          if (cancelled) return;
          setProposals(list);
          if (list.length === 0) setError('No proposals found on-chain.');
        } catch {
          if (!cancelled) setError('Failed to load Lil Nouns proposals.');
        }
      }
    })().finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 20px 60px' }}>
      {/* Header */}
      <div style={{ padding: '24px 0 16px' }}>
        <span
          style={{ color: '#8c8d92', fontSize: '1.2rem', fontFamily: "'Londrina Solid', cursive" }}
        >
          Governance
        </span>
        <h1
          style={{
            fontSize: '2.5rem',
            fontFamily: "'Londrina Solid', cursive",
            color: '#14141f',
            margin: '4px 0 8px',
            fontWeight: 400,
          }}
        >
          Lil Nouns
        </h1>
        <p
          style={{
            color: '#666',
            fontFamily: "'PT Root UI', sans-serif",
            fontSize: '0.95rem',
            margin: '0 0 16px',
          }}
        >
          Lil Nouns is a CC0 experiment forked from Nouns DAO. Proposals are read directly from the
          Lil Nouns Governor contract. Click a proposal to view and vote on lilnouns.wtf.
        </p>
      </div>

      {loading && (
        <div
          style={{
            textAlign: 'center',
            padding: '40px 0',
            color: '#8c8d92',
            fontSize: '0.85rem',
          }}
        >
          Loading proposals...
        </div>
      )}

      {!loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {proposals.map(p => {
            const totalVotes = p.forVotes + p.againstVotes + p.abstainVotes;
            const forPct = totalVotes > 0 ? (p.forVotes / totalVotes) * 100 : 0;
            const color = statusColor(p.status);

            return (
              <a
                key={p.id}
                href={`/vote/${p.id}?dao=lil`}
                style={{
                  display: 'block',
                  padding: '16px 20px',
                  borderRadius: 16,
                  border: '1px solid #e2e3e8',
                  textDecoration: 'none',
                  color: 'inherit',
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = '#ff638d')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#e2e3e8')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span
                    style={{
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 6,
                      background: color + '20',
                      color,
                    }}
                  >
                    {statusLabel(p.status)}
                  </span>
                  <span style={{ color: '#8c8d92', fontSize: '0.75rem' }}>#{p.id}</span>
                  <span style={{ color: '#8c8d92', fontSize: '0.7rem', marginLeft: 'auto' }}>
                    ↗ lilnouns.wtf
                  </span>
                </div>

                <div
                  style={{
                    fontSize: '1rem',
                    fontWeight: 700,
                    fontFamily: "'PT Root UI', sans-serif",
                    marginBottom: 8,
                    lineHeight: 1.3,
                  }}
                >
                  {p.title}
                </div>

                {totalVotes > 0 && (
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <div
                      style={{
                        flex: 1,
                        height: 6,
                        borderRadius: 3,
                        background: '#f4f4f8',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${forPct}%`,
                          height: '100%',
                          borderRadius: 3,
                          background: '#43b369',
                        }}
                      />
                    </div>
                    <span style={{ fontSize: '0.65rem', color: '#8c8d92', whiteSpace: 'nowrap' }}>
                      {p.forVotes} for · {p.againstVotes} against
                    </span>
                  </div>
                )}
              </a>
            );
          })}

          {proposals.length === 0 && error != null && (
            <div
              style={{
                textAlign: 'center',
                padding: '40px',
                color: '#8c8d92',
                fontSize: '0.85rem',
              }}
            >
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default LilNounsProposals;
