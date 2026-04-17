/**
 * LilNounsVotePage — Detail view for a Lil Nouns governance proposal.
 * Pulls data from our /api/lil-proposals/:id proxy (Goldsky subgraph).
 * Read-only for now; casting a vote still sends users to lilnouns.wtf.
 */
import { FC, useEffect, useMemo, useState } from 'react';

import { ExternalLinkIcon } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Link, useParams } from 'react-router';
import rehypeRaw from 'rehype-raw';
import remarkBreaks from 'remark-breaks';

const API_BASE = (
  (import.meta.env.VITE_MAINNET_SUBGRAPH as string | undefined) ??
  'https://spirited-flexibility-production-3c30.up.railway.app'
).replace(/\/graphql\/?$/, '');

interface LilProposalVote {
  id: string;
  support: number; // 0=against, 1=for, 2=abstain
  votes: string;
  reason: string | null;
  blockNumber: string;
  voter: { id: string };
}

interface LilProposalDetail {
  id: string;
  title: string | null;
  description: string | null;
  status: string;
  forVotes: string;
  againstVotes: string;
  abstainVotes: string;
  quorumVotes: string;
  proposalThreshold: string;
  startBlock: string;
  endBlock: string;
  createdBlock: string;
  createdTimestamp: string;
  executionETA: string | null;
  executedTimestamp: string | null;
  canceledTimestamp: string | null;
  vetoedTimestamp: string | null;
  queuedTimestamp: string | null;
  targets: string[];
  values: string[];
  signatures: string[];
  calldatas: string[];
  totalSupply: string;
  proposer: { id: string };
  votes: LilProposalVote[];
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: '#a78bfa',
  ACTIVE: '#22d3ee',
  CANCELLED: '#94a3b8',
  CANCELED: '#94a3b8',
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

function shortAddress(addr: string): string {
  if (addr === '' || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function formatTimestamp(ts: string | null): string {
  if (ts === null || ts === '') return '';
  const d = new Date(Number(ts) * 1000);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function supportLabel(support: number): { label: string; color: string } {
  if (support === 1) return { label: 'For', color: '#43b369' };
  if (support === 0) return { label: 'Against', color: '#e40536' };
  return { label: 'Abstain', color: '#8c8d92' };
}

/** Strip "# Title" from the top of the description so the H1 doesn't duplicate the header. */
function stripLeadingTitle(description: string, title: string): string {
  const lines = description.split('\n');
  if (lines.length === 0) return description;
  const first = lines[0]?.trim() ?? '';
  const normalizedFirst = first
    .replace(/^#+\s*/, '')
    .trim()
    .toLowerCase();
  if (normalizedFirst === title.trim().toLowerCase()) {
    return lines.slice(1).join('\n').trimStart();
  }
  return description;
}

const LilNounsVotePage: FC = () => {
  const { id } = useParams<{ id: string }>();
  const [proposal, setProposal] = useState<LilProposalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAllVotes, setShowAllVotes] = useState(false);

  useEffect(() => {
    if (id === undefined) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/lil-proposals/${id}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as LilProposalDetail;
        if (!cancelled) setProposal(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load proposal.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const totalVotes = useMemo(() => {
    if (proposal === null) return 0;
    return (
      Number(proposal.forVotes) + Number(proposal.againstVotes) + Number(proposal.abstainVotes)
    );
  }, [proposal]);

  const quorum = proposal !== null ? Number(proposal.quorumVotes) : 0;
  const forVotes = proposal !== null ? Number(proposal.forVotes) : 0;
  const againstVotes = proposal !== null ? Number(proposal.againstVotes) : 0;
  const abstainVotes = proposal !== null ? Number(proposal.abstainVotes) : 0;

  if (loading) {
    return (
      <div
        style={{ textAlign: 'center', padding: '80px 20px', color: '#8c8d92', fontSize: '0.85rem' }}
      >
        Loading Lil Nouns proposal…
      </div>
    );
  }

  if (error !== null || proposal === null) {
    return (
      <div style={{ maxWidth: 700, margin: '0 auto', padding: '40px 20px', textAlign: 'center' }}>
        <div style={{ color: '#e40536', fontSize: '0.85rem', marginBottom: 16 }}>
          {error ?? 'Proposal not found.'}
        </div>
        <Link to="/vote?dao=lil" style={{ color: '#ff638d', fontSize: '0.85rem' }}>
          ← Back to Lil Nouns proposals
        </Link>
      </div>
    );
  }

  const status = proposal.status.toUpperCase();
  const statusColor = STATUS_COLORS[status] ?? '#8c8d92';
  const canVote = status === 'ACTIVE' || status === 'OBJECTION_PERIOD';
  const displayedVotes = showAllVotes ? proposal.votes : proposal.votes.slice(0, 20);
  const cleanDescription = proposal.title
    ? stripLeadingTitle(proposal.description ?? '', proposal.title)
    : (proposal.description ?? '');
  const title =
    proposal.title && proposal.title.trim() !== '' ? proposal.title : `Lil Proposal ${proposal.id}`;

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 20px' }}>
      {/* Back link */}
      <Link
        to="/vote?dao=lil"
        style={{
          display: 'inline-block',
          fontSize: '0.8rem',
          color: '#ff638d',
          textDecoration: 'none',
          marginBottom: 12,
        }}
      >
        ← All Lil Nouns proposals
      </Link>

      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: '0.75rem',
            color: '#8c8d92',
            marginBottom: 4,
          }}
        >
          <span>LIL NOUNS · #{proposal.id}</span>
          <span
            style={{
              color: statusColor,
              fontWeight: 700,
              padding: '1px 8px',
              borderRadius: 10,
              background: `${statusColor}22`,
            }}
          >
            {statusLabel(status)}
          </span>
        </div>
        <h1
          style={{
            fontFamily: "'Londrina Solid', cursive",
            fontSize: '2rem',
            lineHeight: 1.15,
            margin: 0,
            wordBreak: 'break-word',
          }}
        >
          {title}
        </h1>
        <div style={{ fontSize: '0.75rem', color: '#8c8d92', marginTop: 6 }}>
          Proposed by{' '}
          <a
            href={`https://etherscan.io/address/${proposal.proposer.id}`}
            target="_blank"
            rel="noreferrer"
            style={{ color: '#ff638d', fontFamily: 'monospace', textDecoration: 'none' }}
          >
            {shortAddress(proposal.proposer.id)}
          </a>
          {proposal.createdTimestamp !== '' && ` · ${formatTimestamp(proposal.createdTimestamp)}`}
        </div>
      </div>

      {/* Voting overview */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 8,
          marginBottom: 20,
        }}
      >
        <VoteCount label="For" value={forVotes} color="#43b369" />
        <VoteCount label="Against" value={againstVotes} color="#e40536" />
        <VoteCount label="Abstain" value={abstainVotes} color="#8c8d92" />
      </div>

      {/* Quorum bar */}
      {quorum > 0 && (
        <div style={{ marginBottom: 20 }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: '0.7rem',
              color: '#8c8d92',
              marginBottom: 4,
            }}
          >
            <span>Quorum progress</span>
            <span>
              {forVotes} / {quorum}
            </span>
          </div>
          <div
            style={{
              height: 6,
              background: '#f0f0f0',
              borderRadius: 3,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${Math.min(100, (forVotes / quorum) * 100)}%`,
                height: '100%',
                background: forVotes >= quorum ? '#43b369' : '#ff638d',
                transition: 'width 0.3s',
              }}
            />
          </div>
        </div>
      )}

      {/* Action row */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
        {canVote && (
          <a
            href={`https://lilnouns.wtf/vote/${proposal.id}`}
            target="_blank"
            rel="noreferrer"
            style={{
              background: '#ff638d',
              color: '#fff',
              padding: '6px 14px',
              borderRadius: 999,
              fontSize: '0.8rem',
              fontWeight: 700,
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            Cast vote on lilnouns.wtf
            <ExternalLinkIcon size={12} />
          </a>
        )}
        <a
          href={`https://lilnouns.wtf/vote/${proposal.id}`}
          target="_blank"
          rel="noreferrer"
          style={{
            background: '#f4f4f8',
            color: '#14141f',
            padding: '6px 14px',
            borderRadius: 999,
            fontSize: '0.8rem',
            fontWeight: 600,
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          View on lilnouns.wtf
          <ExternalLinkIcon size={12} />
        </a>
      </div>

      {/* Description */}
      {cleanDescription.trim() !== '' && (
        <div
          style={{
            background: '#fff',
            padding: '16px 20px',
            borderRadius: 8,
            border: '1px solid #f0f0f0',
            marginBottom: 24,
            lineHeight: 1.6,
            fontSize: '0.9rem',
          }}
          className="prose prose-sm max-w-none"
        >
          <ReactMarkdown remarkPlugins={[remarkBreaks]} rehypePlugins={[rehypeRaw]}>
            {cleanDescription}
          </ReactMarkdown>
        </div>
      )}

      {/* Vote activity */}
      <div style={{ marginBottom: 24 }}>
        <h2
          style={{
            fontSize: '0.85rem',
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            color: '#14141f',
            marginBottom: 10,
          }}
        >
          Vote activity ({totalVotes})
        </h2>
        {proposal.votes.length === 0 ? (
          <p style={{ fontSize: '0.8rem', color: '#8c8d92' }}>No votes yet.</p>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {displayedVotes.map(v => {
                const { label, color } = supportLabel(v.support);
                return (
                  <div
                    key={v.id}
                    style={{
                      background: '#fff',
                      border: '1px solid #f0f0f0',
                      padding: '8px 12px',
                      borderRadius: 6,
                      fontSize: '0.8rem',
                    }}
                  >
                    <div
                      style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}
                    >
                      <a
                        href={`https://etherscan.io/address/${v.voter.id}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          fontFamily: 'monospace',
                          color: '#14141f',
                          textDecoration: 'none',
                          fontWeight: 600,
                        }}
                      >
                        {shortAddress(v.voter.id)}
                      </a>
                      <span
                        style={{
                          color,
                          fontWeight: 700,
                          fontSize: '0.7rem',
                          background: `${color}1a`,
                          padding: '1px 6px',
                          borderRadius: 4,
                          textTransform: 'uppercase',
                        }}
                      >
                        {label} {v.votes}
                      </span>
                    </div>
                    {v.reason !== null && v.reason.trim() !== '' && (
                      <div style={{ color: '#5a5a5a', marginTop: 4, lineHeight: 1.4 }}>
                        {v.reason}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {proposal.votes.length > 20 && (
              <button
                type="button"
                onClick={() => setShowAllVotes(!showAllVotes)}
                style={{
                  marginTop: 10,
                  padding: '6px 12px',
                  background: 'transparent',
                  border: '1px solid #e0e0e0',
                  borderRadius: 6,
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  color: '#8c8d92',
                }}
              >
                {showAllVotes ? `Show less (20)` : `Show all (${proposal.votes.length})`}
              </button>
            )}
          </>
        )}
      </div>

      {/* Transactions */}
      {proposal.targets.length > 0 && (
        <div style={{ marginBottom: 24 }}>
          <h2
            style={{
              fontSize: '0.85rem',
              fontWeight: 700,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: 10,
            }}
          >
            Transactions
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {proposal.targets.map((target, i) => (
              <div
                key={i}
                style={{
                  background: '#fff',
                  border: '1px solid #f0f0f0',
                  padding: '8px 12px',
                  borderRadius: 6,
                  fontSize: '0.75rem',
                  fontFamily: 'monospace',
                  wordBreak: 'break-all',
                }}
              >
                <div style={{ color: '#8c8d92', marginBottom: 2 }}>
                  #{i + 1} {proposal.signatures[i] ?? ''}
                </div>
                <a
                  href={`https://etherscan.io/address/${target}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: '#14141f', fontWeight: 600, textDecoration: 'none' }}
                >
                  {target}
                </a>
                {proposal.values[i] !== '0' && (
                  <div style={{ color: '#8c8d92', marginTop: 2 }}>
                    value: {proposal.values[i]} wei
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const VoteCount: FC<{ label: string; value: number; color: string }> = ({
  label,
  value,
  color,
}) => (
  <div
    style={{
      padding: '10px 12px',
      background: `${color}0f`,
      border: `1px solid ${color}40`,
      borderRadius: 6,
    }}
  >
    <div style={{ fontSize: '0.65rem', color, fontWeight: 700, textTransform: 'uppercase' }}>
      {label}
    </div>
    <div style={{ fontSize: '1.4rem', fontWeight: 700, fontFamily: "'Londrina Solid', cursive" }}>
      {value}
    </div>
  </div>
);

export default LilNounsVotePage;
