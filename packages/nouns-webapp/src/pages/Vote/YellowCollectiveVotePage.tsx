/**
 * YellowCollectiveVotePage — Detail view for a Nouns proposal mirrored
 * to Yellow Collective's Snapshot space. Shows vote tallies, individual
 * votes with reasons, and (when Snapshot space is live) voting UI.
 */
import { FC, useCallback, useEffect, useState } from 'react';

import { useNavigate, useParams, useSearchParams } from 'react-router';
import { useAccount } from 'wagmi';

import {
  fetchProposalVotes,
  fetchSpaceProposals,
  SnapshotProposal,
  SnapshotVote,
} from '@/lib/snapshot';

// ─── Helpers ────────────────────────────────────────────────────────────────

function shortenAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function choiceLabel(choice: number, choices: string[]): string {
  return choices[choice - 1] || `Choice ${choice}`;
}

function choiceColor(choice: number, choices: string[]): string {
  const label = (choices[choice - 1] || '').toLowerCase();
  if (label === 'for') return '#43b369';
  if (label === 'against') return '#e40536';
  return '#8c8d92';
}

function timeString(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ─── Component ──────────────────────────────────────────────────────────────

const YellowCollectiveVotePage: FC = () => {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const snapId = searchParams.get('snap');
  const { address } = useAccount();

  const [proposal, setProposal] = useState<SnapshotProposal | null>(null);
  const [votes, setVotes] = useState<SnapshotVote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Voting state
  const [selectedChoice, setSelectedChoice] = useState<number | null>(null);
  const [voteReason, setVoteReason] = useState('');
  const [showAllVotes, setShowAllVotes] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        // Find the proposal — either by snapshot ID or by Nouns proposal ID in title
        const proposals = await fetchSpaceProposals();
        let found: SnapshotProposal | undefined;

        if (snapId) {
          found = proposals.find(p => p.id === snapId);
        }
        if (!found && id) {
          found = proposals.find(p => p.nounsProposalId === id);
        }

        if (!found) {
          setError('Proposal not found in Snapshot space');
          setLoading(false);
          return;
        }

        setProposal(found);

        const v = await fetchProposalVotes(found.id);
        setVotes(v);
      } catch (e: unknown) {
        setError((e instanceof Error ? e.message : String(e)).slice(0, 120));
      } finally {
        setLoading(false);
      }
    })();
  }, [id, snapId]);

  const handleVote = useCallback(async () => {
    if (selectedChoice === null || proposal === null) return;
    // TODO: Implement Snapshot.js vote signing when space is live
    alert(
      `Snapshot voting is not yet connected.\n\nYou selected: ${choiceLabel(selectedChoice, proposal.choices)}\nReason: ${voteReason || '(none)'}\n\nThe yellowcollective.eth Snapshot space needs to be created first.`,
    );
  }, [selectedChoice, proposal, voteReason]);

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div
        style={{ textAlign: 'center', padding: '80px 20px', color: '#8c8d92', fontSize: '0.85rem' }}
      >
        Loading proposal...
      </div>
    );
  }

  if (error || !proposal) {
    return (
      <div style={{ maxWidth: 700, margin: '0 auto', padding: '40px 20px', textAlign: 'center' }}>
        <div style={{ color: '#e40536', fontSize: '0.85rem', marginBottom: 16 }}>
          {error || 'Proposal not found'}
        </div>
        <button
          onClick={() => navigate('/vote?dao=yc')}
          style={{
            padding: '8px 20px',
            borderRadius: 10,
            border: '1px solid #e2e3e8',
            background: '#fff',
            cursor: 'pointer',
            fontSize: '0.8rem',
          }}
        >
          Back to Yellow Collective
        </button>
      </div>
    );
  }

  const isActive = proposal.state === 'active';
  const visibleVotes = showAllVotes ? votes : votes.slice(0, 20);

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 20px 60px' }}>
      {/* Back */}
      <button
        onClick={() => navigate('/vote?dao=yc')}
        style={{
          margin: '16px 0 8px',
          padding: '6px 12px',
          borderRadius: 8,
          border: '1px solid #e2e3e8',
          background: '#fff',
          cursor: 'pointer',
          fontSize: '0.75rem',
          color: '#8c8d92',
        }}
      >
        ← Yellow Collective
      </button>

      {/* Header */}
      <div style={{ padding: '16px 0 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <span
            style={{
              fontSize: '0.75rem',
              fontWeight: 700,
              padding: '3px 10px',
              borderRadius: 8,
              background:
                proposal.state === 'active'
                  ? '#22d3ee20'
                  : proposal.state === 'closed'
                    ? '#f4f4f8'
                    : '#a78bfa20',
              color:
                proposal.state === 'active'
                  ? '#22d3ee'
                  : proposal.state === 'closed'
                    ? '#8c8d92'
                    : '#a78bfa',
            }}
          >
            {proposal.state === 'active'
              ? 'Voting Active'
              : proposal.state === 'closed'
                ? 'Voting Closed'
                : 'Pending'}
          </span>
          {proposal.nounsProposalId && (
            <a
              href={`/vote/${proposal.nounsProposalId}`}
              style={{ fontSize: '0.75rem', color: '#8c8d92', textDecoration: 'underline' }}
            >
              View Nouns Prop #{proposal.nounsProposalId}
            </a>
          )}
        </div>

        <h1
          style={{
            fontSize: '2rem',
            fontFamily: "'Londrina Solid', cursive",
            fontWeight: 400,
            margin: '0 0 8px',
            color: '#14141f',
          }}
        >
          {proposal.title}
        </h1>

        <div style={{ fontSize: '0.75rem', color: '#8c8d92' }}>
          by {shortenAddress(proposal.author)} · {timeString(proposal.start)} →{' '}
          {timeString(proposal.end)}
        </div>
      </div>

      {/* Two-column: votes + voting panel */}
      <div
        style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 24, alignItems: 'start' }}
      >
        {/* Left: Vote overview + activity */}
        <div>
          {/* Vote overview bars */}
          <div
            style={{
              padding: 20,
              borderRadius: 16,
              border: '1px solid #e2e3e8',
              marginBottom: 16,
            }}
          >
            {proposal.choices.map((choice, i) => {
              const score = proposal.scores[i] || 0;
              const pct = proposal.scores_total > 0 ? (score / proposal.scores_total) * 100 : 0;
              const color = choiceColor(i + 1, proposal.choices);

              return (
                <div
                  key={choice}
                  style={{ marginBottom: i < proposal.choices.length - 1 ? 12 : 0 }}
                >
                  <div
                    style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}
                  >
                    <span style={{ fontSize: '0.8rem', fontWeight: 700, color }}>{choice}</span>
                    <span style={{ fontSize: '0.75rem', color: '#8c8d92' }}>
                      {Math.round(score)} votes ({pct.toFixed(1)}%)
                    </span>
                  </div>
                  <div
                    style={{
                      height: 8,
                      borderRadius: 4,
                      background: '#f4f4f8',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${pct}%`,
                        height: '100%',
                        borderRadius: 4,
                        background: color,
                        transition: 'width 0.3s',
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Vote activity */}
          <div style={{ borderRadius: 16, border: '1px solid #e2e3e8', overflow: 'hidden' }}>
            <div
              style={{
                padding: '12px 20px',
                borderBottom: '1px solid #e2e3e8',
                fontSize: '0.85rem',
                fontWeight: 700,
                fontFamily: "'Londrina Solid', cursive",
                display: 'flex',
                justifyContent: 'space-between',
              }}
            >
              <span>Votes</span>
              <span
                style={{
                  color: '#8c8d92',
                  fontFamily: "'PT Root UI', sans-serif",
                  fontWeight: 400,
                  fontSize: '0.75rem',
                }}
              >
                {votes.length} total
              </span>
            </div>

            {visibleVotes.map(v => (
              <div
                key={v.id}
                style={{
                  padding: '10px 20px',
                  borderBottom: '1px solid #f4f4f8',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: choiceColor(v.choice, proposal.choices),
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontSize: '0.8rem', fontWeight: 600, fontFamily: 'monospace' }}>
                    {shortenAddress(v.voter)}
                  </span>
                  <span
                    style={{
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      color: choiceColor(v.choice, proposal.choices),
                    }}
                  >
                    {choiceLabel(v.choice, proposal.choices)}
                  </span>
                  <span style={{ fontSize: '0.7rem', color: '#8c8d92', marginLeft: 'auto' }}>
                    {Math.round(v.vp)} votes
                  </span>
                </div>
                {v.reason && (
                  <div
                    style={{
                      fontSize: '0.75rem',
                      color: '#666',
                      paddingLeft: 16,
                      whiteSpace: 'pre-wrap',
                      lineHeight: 1.4,
                    }}
                  >
                    {v.reason}
                  </div>
                )}
              </div>
            ))}

            {votes.length > 20 && !showAllVotes && (
              <button
                onClick={() => setShowAllVotes(true)}
                style={{
                  width: '100%',
                  padding: '10px',
                  border: 'none',
                  cursor: 'pointer',
                  background: '#f4f4f8',
                  fontSize: '0.75rem',
                  color: '#8c8d92',
                  fontWeight: 600,
                }}
              >
                Show all {votes.length} votes
              </button>
            )}

            {votes.length === 0 && (
              <div
                style={{
                  padding: '24px',
                  textAlign: 'center',
                  color: '#8c8d92',
                  fontSize: '0.8rem',
                }}
              >
                No votes yet
              </div>
            )}
          </div>
        </div>

        {/* Right: Voting panel (sticky) */}
        <div style={{ position: 'sticky', top: 80 }}>
          <div
            style={{
              padding: 20,
              borderRadius: 16,
              border: '1px solid #e2e3e8',
            }}
          >
            <div
              style={{
                fontSize: '0.9rem',
                fontWeight: 700,
                marginBottom: 12,
                fontFamily: "'Londrina Solid', cursive",
              }}
            >
              Cast Your Vote
            </div>

            {!isActive ? (
              <div style={{ fontSize: '0.8rem', color: '#8c8d92' }}>
                Voting is {proposal.state === 'pending' ? 'not yet active' : 'closed'}.
              </div>
            ) : !address ? (
              <div style={{ fontSize: '0.8rem', color: '#8c8d92' }}>
                Connect your wallet to vote with Yellow Collective tokens.
              </div>
            ) : (
              <>
                {/* Vote buttons */}
                <div style={{ display: 'flex', flexDirection: 'row', gap: 6, marginBottom: 12 }}>
                  {proposal.choices.map((choice, i) => {
                    const choiceNum = i + 1;
                    const color = choiceColor(choiceNum, proposal.choices);
                    const isSelected = selectedChoice === choiceNum;

                    return (
                      <button
                        key={choice}
                        onClick={() => setSelectedChoice(isSelected ? null : choiceNum)}
                        title={choice}
                        style={{
                          flex: 1,
                          padding: '10px',
                          borderRadius: 10,
                          border: `2px solid ${isSelected ? color : '#e2e3e8'}`,
                          background: isSelected ? color + '15' : '#fff',
                          cursor: 'pointer',
                          fontSize: '1.2rem',
                          transition: 'all 0.15s',
                          textAlign: 'center',
                        }}
                      >
                        {choice === 'For' ? '👍' : choice === 'Against' ? '👎' : '🤷'}
                      </button>
                    );
                  })}
                </div>

                {/* Reason */}
                <textarea
                  placeholder="Add a reason (optional)"
                  value={voteReason}
                  onChange={e => setVoteReason(e.target.value)}
                  rows={3}
                  style={{
                    width: '100%',
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: '1px solid #e2e3e8',
                    fontSize: '0.8rem',
                    fontFamily: "'PT Root UI', sans-serif",
                    resize: 'vertical',
                    outline: 'none',
                  }}
                />

                {/* Submit */}
                <button
                  onClick={handleVote}
                  disabled={selectedChoice === null}
                  style={{
                    width: '100%',
                    marginTop: 8,
                    padding: '10px',
                    borderRadius: 10,
                    border: 'none',
                    cursor: selectedChoice !== null ? 'pointer' : 'default',
                    background: selectedChoice !== null ? '#FFC700' : '#f4f4f8',
                    color: selectedChoice !== null ? '#14141f' : '#8c8d92',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    transition: 'all 0.15s',
                  }}
                >
                  Submit Vote
                </button>

                <div
                  style={{
                    fontSize: '0.65rem',
                    color: '#8c8d92',
                    marginTop: 8,
                    textAlign: 'center',
                  }}
                >
                  Votes are signed off-chain via Snapshot (no gas required)
                </div>
              </>
            )}
          </div>

          {/* Proposal body snippet */}
          {proposal.body && (
            <div
              style={{
                marginTop: 12,
                padding: 16,
                borderRadius: 16,
                border: '1px solid #e2e3e8',
                maxHeight: 300,
                overflow: 'auto',
                fontSize: '0.75rem',
                color: '#666',
                lineHeight: 1.5,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {proposal.body.slice(0, 500)}
              {proposal.body.length > 500 && '...'}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default YellowCollectiveVotePage;
