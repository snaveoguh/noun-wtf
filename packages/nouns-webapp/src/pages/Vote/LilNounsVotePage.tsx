/**
 * LilNounsVotePage — Detail view for a Lil Nouns governance proposal.
 * Pulls data from our /api/lil-proposals/:id proxy (Goldsky subgraph).
 * Supports casting on-chain votes directly against the Lil Nouns governor.
 */
import type { Address } from '@/utils/types';

import { FC, useCallback, useEffect, useMemo, useState } from 'react';

import { ConnectKitButton } from 'connectkit';
import { ExternalLinkIcon } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { Link, useParams } from 'react-router';
import rehypeRaw from 'rehype-raw';
import remarkBreaks from 'remark-breaks';
import { mainnet } from 'viem/chains';
import { useAccount, useReadContract, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';

import ShortAddress from '@/components/ShortAddress';
import { LIL_NOUNS_GOVERNOR, LIL_NOUNS_GOVERNOR_ABI } from '@/lib/marketplace/governance';

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
            <ShortAddress address={proposal.proposer.id as Address} />
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

      {/* Cast vote panel — only renders on ACTIVE/OBJECTION proposals */}
      {canVote && <CastVotePanel proposalId={BigInt(proposal.id)} />}

      {/* External lilnouns.wtf link (always shown) */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap' }}>
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
                        <ShortAddress address={v.voter.id as Address} />
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

// ─── Cast vote panel ────────────────────────────────────────────────────────

const SUPPORT_OPTIONS: { value: 0 | 1 | 2; label: string; emoji: string; color: string }[] = [
  { value: 1, label: 'For', emoji: '👍', color: '#43b369' },
  { value: 0, label: 'Against', emoji: '👎', color: '#e40536' },
  { value: 2, label: 'Abstain', emoji: '🤷', color: '#8c8d92' },
];

/**
 * Casts an on-chain vote against the Lil Nouns governor.
 * Reads the user's Receipt first so we can show "already voted" instead of the form.
 */
const CastVotePanel: FC<{ proposalId: bigint }> = ({ proposalId }) => {
  const { address, isConnected, chainId } = useAccount();
  const [selected, setSelected] = useState<0 | 1 | 2 | null>(null);
  const [reason, setReason] = useState('');

  // Has this wallet already voted?
  const { data: receiptData, refetch: refetchReceipt } = useReadContract({
    address: LIL_NOUNS_GOVERNOR,
    abi: LIL_NOUNS_GOVERNOR_ABI,
    functionName: 'getReceipt',
    args: address !== undefined ? [proposalId, address] : undefined,
    chainId: mainnet.id,
    query: { enabled: address !== undefined },
  });
  const receipt = receiptData as { hasVoted: boolean; support: number; votes: bigint } | undefined;

  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
    chainId: mainnet.id,
    query: { enabled: txHash !== undefined },
  });

  useEffect(() => {
    if (isSuccess) {
      refetchReceipt();
    }
  }, [isSuccess, refetchReceipt]);

  const onWrongChain = isConnected && chainId !== undefined && chainId !== mainnet.id;

  const handleCast = useCallback(() => {
    if (selected === null) return;
    if (reason.trim().length > 0) {
      writeContract({
        address: LIL_NOUNS_GOVERNOR,
        abi: LIL_NOUNS_GOVERNOR_ABI,
        functionName: 'castVoteWithReason',
        args: [proposalId, selected, reason.trim()],
        chainId: mainnet.id,
      });
    } else {
      writeContract({
        address: LIL_NOUNS_GOVERNOR,
        abi: LIL_NOUNS_GOVERNOR_ABI,
        functionName: 'castVote',
        args: [proposalId, selected],
        chainId: mainnet.id,
      });
    }
  }, [selected, reason, writeContract, proposalId]);

  const panelStyle: React.CSSProperties = {
    background: '#fff',
    border: '1px solid #e0e0e0',
    borderRadius: 10,
    padding: 16,
    marginBottom: 20,
  };
  const labelStyle: React.CSSProperties = {
    fontSize: '0.75rem',
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: '#14141f',
    marginBottom: 8,
  };

  if (!isConnected) {
    return (
      <div style={panelStyle}>
        <div style={labelStyle}>Cast your vote</div>
        <ConnectKitButton.Custom>
          {({ show }) => (
            <button
              type="button"
              onClick={() => show?.()}
              style={{
                width: '100%',
                background: '#ff638d',
                color: '#fff',
                border: 'none',
                padding: '10px 14px',
                borderRadius: 8,
                fontSize: '0.85rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Connect wallet to vote
            </button>
          )}
        </ConnectKitButton.Custom>
      </div>
    );
  }

  if (onWrongChain) {
    return (
      <div style={panelStyle}>
        <div style={labelStyle}>Cast your vote</div>
        <p style={{ fontSize: '0.8rem', color: '#8c8d92', margin: 0 }}>
          Switch to Ethereum mainnet to vote. Lil Nouns governance is on L1.
        </p>
      </div>
    );
  }

  if (receipt?.hasVoted === true) {
    const voted = SUPPORT_OPTIONS.find(o => o.value === receipt.support);
    return (
      <div style={panelStyle}>
        <div style={labelStyle}>Your vote</div>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            borderRadius: 8,
            background: `${voted?.color ?? '#8c8d92'}1a`,
            color: voted?.color ?? '#8c8d92',
            fontSize: '0.85rem',
            fontWeight: 700,
          }}
        >
          Voted {voted?.label ?? '?'} with {Number(receipt.votes)} votes
        </div>
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div style={{ ...panelStyle, borderColor: '#43b369', background: '#e8f7ee' }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#2a8653' }}>
          ✓ Vote cast on-chain. Receipt updating…
        </div>
      </div>
    );
  }

  const disabled = selected === null || isPending || isConfirming;

  return (
    <div style={panelStyle}>
      <div style={labelStyle}>Cast your vote</div>

      {/* Support selector */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        {SUPPORT_OPTIONS.map(o => (
          <button
            key={o.value}
            type="button"
            onClick={() => setSelected(o.value)}
            title={o.label}
            style={{
              flex: 1,
              padding: '8px 10px',
              borderRadius: 8,
              border: selected === o.value ? `2px solid ${o.color}` : '1px solid #e0e0e0',
              background: selected === o.value ? `${o.color}1a` : '#fff',
              fontSize: '1.2rem',
              cursor: 'pointer',
            }}
          >
            {o.emoji}
          </button>
        ))}
      </div>

      {/* Reason textarea */}
      <textarea
        value={reason}
        onChange={e => setReason(e.target.value.slice(0, 500))}
        placeholder="Optional reason (onchain, public)…"
        rows={3}
        style={{
          width: '100%',
          padding: 10,
          borderRadius: 8,
          border: '1px solid #e0e0e0',
          fontSize: '0.85rem',
          fontFamily: 'inherit',
          resize: 'vertical',
          marginBottom: 10,
          boxSizing: 'border-box',
        }}
      />

      <button
        type="button"
        onClick={handleCast}
        disabled={disabled}
        style={{
          width: '100%',
          background: disabled ? '#e0e0e0' : '#ff638d',
          color: disabled ? '#8c8d92' : '#fff',
          border: 'none',
          padding: '10px 14px',
          borderRadius: 8,
          fontSize: '0.85rem',
          fontWeight: 700,
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'background 0.15s',
        }}
      >
        {isPending
          ? 'Confirming in wallet…'
          : isConfirming
            ? 'Submitting on-chain…'
            : selected === null
              ? 'Pick a side'
              : `Cast ${SUPPORT_OPTIONS.find(o => o.value === selected)?.label ?? ''} vote`}
      </button>

      {error !== null && (
        <p style={{ fontSize: '0.75rem', color: '#e40536', marginTop: 8 }}>
          {(error as { shortMessage?: string }).shortMessage ?? error.message}
        </p>
      )}
    </div>
  );
};

export default LilNounsVotePage;
