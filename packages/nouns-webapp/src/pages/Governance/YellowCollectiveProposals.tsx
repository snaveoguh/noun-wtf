/**
 * YellowCollectiveProposals — Shows YC governance proposals from Base
 * and Nouns proposals mirrored to YC's Snapshot space.
 */
import { FC, useEffect, useState } from 'react';

import { Link } from 'react-router';
import { formatEther } from 'viem';

import { baseClient } from '@/lib/baseClient';
import { fetchSpaceProposals, SnapshotProposal } from '@/lib/snapshot';

// ─── Constants ──────────────────────────────────────────────────────────────

const BUILDER_SUBGRAPH =
  'https://api.goldsky.com/api/public/project_cm33ek8kjx6pz010i2c3w8z25/subgraphs/nouns-builder-base-mainnet/latest/gn';
const YC_TOKEN_ADDRESS = '0x220e41499cf4d93a3629a5509410cbf9e6e0b109';
const YC_TREASURY = '0x55333306a4c6e74eb9e23a521a24fb78be2de92c';
// ─── Types ──────────────────────────────────────────────────────────────────

interface YCProposal {
  id: string;
  proposalNumber: number;
  title: string;
  description: string;
  proposer: string;
  forVotes: number;
  againstVotes: number;
  abstainVotes: number;
  voteStart: number;
  voteEnd: number;
  executed: boolean;
  canceled: boolean;
  queued: boolean;
}

type ProposalTab = 'yc' | 'nouns';

// ─── Helpers ────────────────────────────────────────────────────────────────

function getStatus(p: YCProposal): { label: string; color: string } {
  if (p.canceled) return { label: 'Canceled', color: '#94a3b8' };
  if (p.executed) return { label: 'Executed', color: '#4ade80' };
  if (p.queued) return { label: 'Queued', color: '#fbbf24' };
  const now = Math.floor(Date.now() / 1000);
  if (now < p.voteStart) return { label: 'Pending', color: '#a78bfa' };
  if (now <= p.voteEnd) return { label: 'Active', color: '#22d3ee' };
  if (p.forVotes > p.againstVotes) return { label: 'Succeeded', color: '#34d399' };
  return { label: 'Defeated', color: '#f87171' };
}

function getSnapshotStatus(p: SnapshotProposal): { label: string; color: string } {
  switch (p.state) {
    case 'active':
      return { label: 'Voting', color: '#22d3ee' };
    case 'closed': {
      const forIdx = p.choices.indexOf('For');
      const againstIdx = p.choices.indexOf('Against');
      const forScore = forIdx >= 0 ? p.scores[forIdx] : 0;
      const againstScore = againstIdx >= 0 ? p.scores[againstIdx] : 0;
      if (forScore > againstScore) return { label: 'For', color: '#43b369' };
      if (againstScore > forScore) return { label: 'Against', color: '#e40536' };
      return { label: 'Tied', color: '#fbbf24' };
    }
    case 'pending':
      return { label: 'Pending', color: '#a78bfa' };
    default:
      return { label: p.state, color: '#8c8d92' };
  }
}

function timeRemaining(endTimestamp: number): string {
  const diff = endTimestamp - Math.floor(Date.now() / 1000);
  if (diff <= 0) return 'Ended';
  const days = Math.floor(diff / 86400);
  const hours = Math.floor((diff % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h left`;
  const mins = Math.floor((diff % 3600) / 60);
  return hours > 0 ? `${hours}h ${mins}m left` : `${mins}m left`;
}

function getTitle(desc: string): string {
  return (desc.split('\n')[0] || '').replace(/^#\s*/, '').slice(0, 80) || 'Untitled';
}

// ─── Data fetching ──────────────────────────────────────────────────────────

async function fetchYCProposals(): Promise<YCProposal[]> {
  const res = await fetch(BUILDER_SUBGRAPH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: `{
        proposals(
          first: 100,
          where: { dao: "${YC_TOKEN_ADDRESS}" },
          orderBy: proposalNumber,
          orderDirection: desc
        ) {
          id
          proposalNumber
          title
          description
          proposer { id }
          forVotes
          againstVotes
          abstainVotes
          voteStart
          voteEnd
          executed
          canceled
          queued
        }
      }`,
    }),
  });
  const json = await res.json();
  return (json?.data?.proposals ?? []).map((p: Record<string, unknown>) => ({
    ...p,
    proposer: (p.proposer as { id?: string } | null)?.id ?? '',
    forVotes: Number(p.forVotes),
    againstVotes: Number(p.againstVotes),
    abstainVotes: Number(p.abstainVotes),
    voteStart: Number(p.voteStart),
    voteEnd: Number(p.voteEnd),
  }));
}

async function fetchYCTreasuryBalance(): Promise<string | null> {
  try {
    const balance = await baseClient.getBalance({ address: YC_TREASURY as `0x${string}` });
    return Number(formatEther(balance)).toFixed(2);
  } catch {
    return null;
  }
}

// ─── Component ──────────────────────────────────────────────────────────────

const YellowCollectiveProposals: FC = () => {
  const [tab, setTab] = useState<ProposalTab>('yc');
  const [ycProposals, setYcProposals] = useState<YCProposal[]>([]);
  const [snapshotProposals, setSnapshotProposals] = useState<SnapshotProposal[]>([]);
  const [treasuryEth, setTreasuryEth] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetchYCProposals(),
      fetchYCTreasuryBalance(),
      fetchSpaceProposals().catch(() => {
        setSnapshotError('Snapshot space not yet active');
        return [] as SnapshotProposal[];
      }),
    ])
      .then(([props, bal, snap]) => {
        setYcProposals(props);
        setTreasuryEth(bal);
        setSnapshotProposals(snap);
      })
      .finally(() => setLoading(false));
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
          YC (beta)
        </h1>
        <p
          style={{
            color: '#666',
            fontFamily: "'PT Root UI', sans-serif",
            fontSize: '0.95rem',
            margin: '0 0 16px',
          }}
        >
          An onchain culture club on Base, powered by Nouns Builder. Vote with your Collective Nouns
          on YC proposals or on mirrored Nouns DAO proposals via Snapshot.
        </p>

        {/* Treasury */}
        {treasuryEth && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 16px',
              borderRadius: 12,
              border: '1px solid #e2e3e8',
              fontSize: '0.85rem',
              fontFamily: "'PT Root UI', sans-serif",
            }}
          >
            <span style={{ color: '#8c8d92' }}>Treasury</span>
            <span
              style={{
                fontWeight: 700,
                fontFamily: "'Londrina Solid', cursive",
                fontSize: '1.1rem',
              }}
            >
              Ξ {treasuryEth}
            </span>
            <span style={{ color: '#8c8d92', fontSize: '0.7rem' }}>(Base)</span>
          </div>
        )}
      </div>

      {/* Sub-tabs: YC Proposals / Nouns Votes */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
        <button
          onClick={() => setTab('yc')}
          style={{
            padding: '6px 16px',
            borderRadius: 16,
            fontSize: '0.8rem',
            fontWeight: 700,
            border: 'none',
            cursor: 'pointer',
            background: tab === 'yc' ? '#FFC700' : '#f4f4f8',
            color: tab === 'yc' ? '#14141f' : '#8c8d92',
          }}
        >
          YC Proposals ({ycProposals.length})
        </button>
        <button
          onClick={() => setTab('nouns')}
          style={{
            padding: '6px 16px',
            borderRadius: 16,
            fontSize: '0.8rem',
            fontWeight: 700,
            border: 'none',
            cursor: 'pointer',
            background: tab === 'nouns' ? '#14141f' : '#f4f4f8',
            color: tab === 'nouns' ? '#fff' : '#8c8d92',
          }}
        >
          Nouns Votes ({snapshotProposals.length})
        </button>
      </div>

      {loading && (
        <div
          style={{ textAlign: 'center', padding: '40px 0', color: '#8c8d92', fontSize: '0.85rem' }}
        >
          Loading proposals...
        </div>
      )}

      {/* YC Proposals (from Base Governor) */}
      {tab === 'yc' && !loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {ycProposals.map(p => {
            const status = getStatus(p);
            const totalVotes = p.forVotes + p.againstVotes + p.abstainVotes;
            const forPct = totalVotes > 0 ? (p.forVotes / totalVotes) * 100 : 0;

            return (
              <a
                key={p.id}
                href={`https://nouns.build/dao/base/${YC_TOKEN_ADDRESS}/vote/${p.proposalNumber}`}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'block',
                  padding: '16px 20px',
                  borderRadius: 16,
                  border: '1px solid #e2e3e8',
                  textDecoration: 'none',
                  color: 'inherit',
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = '#FFC700')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#e2e3e8')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span
                    style={{
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 6,
                      background: status.color + '20',
                      color: status.color,
                    }}
                  >
                    {status.label}
                  </span>
                  <span style={{ color: '#8c8d92', fontSize: '0.75rem' }}>#{p.proposalNumber}</span>
                  <span style={{ color: '#8c8d92', fontSize: '0.7rem', marginLeft: 'auto' }}>
                    {timeRemaining(p.voteEnd)}
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
                  {p.title || getTitle(p.description)}
                </div>

                {/* Vote bar */}
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

          {ycProposals.length === 0 && (
            <div
              style={{
                textAlign: 'center',
                padding: '40px',
                color: '#8c8d92',
                fontSize: '0.85rem',
              }}
            >
              No proposals found.
            </div>
          )}
        </div>
      )}

      {/* Nouns Votes (from Snapshot / metagov) */}
      {tab === 'nouns' && !loading && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {snapshotError && (
            <div
              style={{
                padding: '20px',
                borderRadius: 16,
                border: '1px solid #fbbf24',
                background: '#fefce8',
                fontSize: '0.85rem',
                color: '#854d0e',
                textAlign: 'center',
              }}
            >
              {snapshotError}. The metagov bot will mirror Nouns proposals here once the Snapshot
              space <strong>yellowcollective.eth</strong> is created and the bot is deployed.
            </div>
          )}

          {snapshotProposals.map(p => {
            const status = getSnapshotStatus(p);
            const forIdx = p.choices.indexOf('For');
            const againstIdx = p.choices.indexOf('Against');
            const forScore = forIdx >= 0 ? p.scores[forIdx] : 0;
            const againstScore = againstIdx >= 0 ? p.scores[againstIdx] : 0;
            const total = p.scores_total || 1;

            return (
              <Link
                key={p.id}
                to={`/vote/${p.nounsProposalId || p.id}?dao=yc&snap=${p.id}`}
                style={{
                  display: 'block',
                  padding: '16px 20px',
                  borderRadius: 16,
                  border: '1px solid #e2e3e8',
                  textDecoration: 'none',
                  color: 'inherit',
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = '#14141f')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#e2e3e8')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span
                    style={{
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 6,
                      background: status.color + '20',
                      color: status.color,
                    }}
                  >
                    {status.label}
                  </span>
                  {p.nounsProposalId && (
                    <span style={{ color: '#8c8d92', fontSize: '0.75rem' }}>
                      Nouns #{p.nounsProposalId}
                    </span>
                  )}
                  <span style={{ color: '#8c8d92', fontSize: '0.7rem', marginLeft: 'auto' }}>
                    {timeRemaining(p.end)}
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

                {/* Score bar */}
                {p.scores_total > 0 && (
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <div
                      style={{
                        flex: 1,
                        height: 6,
                        borderRadius: 3,
                        background: '#f4f4f8',
                        overflow: 'hidden',
                        display: 'flex',
                      }}
                    >
                      <div
                        style={{
                          width: `${(forScore / total) * 100}%`,
                          height: '100%',
                          background: '#43b369',
                        }}
                      />
                      <div
                        style={{
                          width: `${(againstScore / total) * 100}%`,
                          height: '100%',
                          background: '#e40536',
                        }}
                      />
                    </div>
                    <span style={{ fontSize: '0.65rem', color: '#8c8d92', whiteSpace: 'nowrap' }}>
                      {Math.round(forScore)} for · {Math.round(againstScore)} against
                    </span>
                  </div>
                )}
              </Link>
            );
          })}

          {snapshotProposals.length === 0 && !snapshotError && (
            <div
              style={{
                textAlign: 'center',
                padding: '40px',
                color: '#8c8d92',
                fontSize: '0.85rem',
              }}
            >
              No mirrored Nouns proposals yet. The metagov bot will create them here.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default YellowCollectiveProposals;
