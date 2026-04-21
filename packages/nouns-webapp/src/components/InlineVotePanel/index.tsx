import { FC, ReactNode, useCallback, useEffect, useState } from 'react';

import { Loader2 } from 'lucide-react';

import { NOUN_WTF_CLIENT_ID } from '@/config';
import {
  useCastRefundableVote,
  useCastRefundableVoteWithReason,
  Vote,
} from '@/wrappers/nounsDao';

interface InlineVotePanelProps {
  proposalId: string | undefined;
  availableVotes: number;
  hasVoted: boolean;
  proposalVote?: string;
  isObjectionPeriod?: boolean;
  isActiveForVoting: boolean;
  isWalletConnected: boolean;
  /** Pre-fill reason for revotes */
  prefillReason?: string;
  /** Pre-fill support direction for revotes */
  prefillSupport?: number;
  onVoteSuccess?: () => void;
}

const InlineVotePanel: FC<InlineVotePanelProps> = ({
  proposalId,
  availableVotes,
  hasVoted,
  proposalVote,
  isObjectionPeriod,
  isActiveForVoting,
  isWalletConnected,
  prefillReason,
  prefillSupport,
  onVoteSuccess,
}) => {
  const isZeroWeight = !availableVotes;

  const { castRefundableVote, castRefundableVoteState } = useCastRefundableVote();
  const { castRefundableVoteWithReason, castRefundableVoteWithReasonState } =
    useCastRefundableVoteWithReason();

  const [selectedVote, setSelectedVote] = useState<Vote | undefined>(
    prefillSupport !== undefined ? (prefillSupport as Vote) : undefined,
  );
  const [reason, setReason] = useState(prefillReason ?? '');
  const [isLoading, setIsLoading] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState<ReactNode>('');

  // Parse raw viem errors into clean user-facing messages
  const cleanError = (raw?: string): string => {
    if (!raw) return 'Transaction failed. Please try again.';
    const lower = raw.toLowerCase();
    if (lower.includes('user rejected') || lower.includes('user denied'))
      return 'Transaction was rejected in your wallet.';
    if (lower.includes('insufficient funds'))
      return 'Insufficient funds for gas.';
    if (lower.includes('already voted'))
      return 'You have already voted on this proposal.';
    if (lower.includes('voting is closed') || lower.includes('not active'))
      return 'Voting is no longer active for this proposal.';
    // Fallback: take first line only, strip contract call dumps
    const firstLine = raw.split('\n')[0];
    if (firstLine.length > 120) return 'Transaction failed. Please try again.';
    return firstLine;
  };

  const handleStateChange = useCallback(
    ({ errorMessage: err, status }: { errorMessage?: string; status: string }) => {
      switch (status) {
        case 'None':
          setIsLoading(false);
          break;
        case 'Mining':
          setIsLoading(true);
          break;
        case 'Success':
          setIsLoading(false);
          setIsSuccess(true);
          onVoteSuccess?.();
          break;
        case 'Fail':
        case 'Exception':
          setIsLoading(false);
          setErrorMessage(cleanError(err));
          break;
      }
    },
    [onVoteSuccess],
  );

  useEffect(() => {
    handleStateChange(castRefundableVoteState);
  }, [castRefundableVoteState, handleStateChange]);

  useEffect(() => {
    handleStateChange(castRefundableVoteWithReasonState);
  }, [castRefundableVoteWithReasonState, handleStateChange]);

  const submitVote = () => {
    if (selectedVote === undefined || !proposalId || isLoading) return;
    setIsLoading(true);
    setErrorMessage('');

    const trimmedReason = reason.trim();
    if (trimmedReason === '') {
      castRefundableVote({ args: [BigInt(proposalId), selectedVote, NOUN_WTF_CLIENT_ID] });
    } else {
      castRefundableVoteWithReason({
        args: [BigInt(proposalId), selectedVote, trimmedReason, NOUN_WTF_CLIENT_ID],
      });
    }
  };

  if (!isActiveForVoting) return null;

  if (hasVoted) {
    return (
      <div
        style={{
          background: '#f0faf4',
          borderRadius: 16,
          border: '1px solid #c8ecd5',
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            background: '#43b369',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span style={{ fontSize: 16 }}>{'\uD83D\uDC4D'}</span>
        </div>
        <div>
          <div style={{ fontWeight: 700, fontSize: '0.85rem' }}>
            You voted <strong>{proposalVote}</strong> on this proposal
          </div>
          <div style={{ fontSize: '0.75rem', color: '#6b6b7b' }}>
            Gas spent on voting was refunded.
          </div>
        </div>
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div
        style={{
          background: '#f0faf4',
          borderRadius: 16,
          border: '1px solid #c8ecd5',
          padding: '20px 24px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '1.2rem', marginBottom: 4 }}>🎉</div>
        <div style={{ fontWeight: 700, fontSize: '0.9rem' }}>Vote submitted!</div>
        <div style={{ fontSize: '0.75rem', color: '#6b6b7b', marginTop: 4 }}>
          {isZeroWeight
            ? 'Your zero-weight vote has been recorded onchain.'
            : 'Gas will be refunded to your wallet.'}
        </div>
      </div>
    );
  }

  if (!isWalletConnected) {
    return (
      <div
        style={{
          background: '#f4f4f8',
          borderRadius: 16,
          border: '1px solid #e2e3e8',
          padding: '20px 24px',
          textAlign: 'center',
        }}
      >
        <div style={{ fontWeight: 600, fontSize: '0.85rem', color: '#8c8d92' }}>
          Connect a wallet to vote
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        background: '#fff',
        borderRadius: 16,
        border: '1px solid #e2e3e8',
        padding: '20px 24px',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 14,
        }}
      >
        <h3
          style={{
            fontFamily: "'Londrina Solid'",
            fontSize: '1.3rem',
            fontWeight: 400,
            margin: 0,
          }}
        >
          Cast Your Vote
        </h3>
        <span style={{ fontSize: '0.75rem', color: '#8c8d92', fontWeight: 600 }}>
          {availableVotes} {availableVotes === 1 ? 'Noun' : 'Nouns'}
        </span>
      </div>

      {/* Vote buttons */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {!isObjectionPeriod && (
          <VoteButton
            selected={selectedVote === Vote.FOR}
            onClick={() => setSelectedVote(Vote.FOR)}
            color="#43b369"
            icon={<span style={{ fontSize: 20 }}>{'\uD83D\uDC4D'}</span>}
            label=""
            disabled={isLoading}
          />
        )}
        <VoteButton
          selected={selectedVote === Vote.AGAINST}
          onClick={() => setSelectedVote(Vote.AGAINST)}
          color="#e40536"
          icon={<span style={{ fontSize: 20 }}>{'\uD83D\uDC4E'}</span>}
          label=""
          disabled={isLoading}
        />
        {!isObjectionPeriod && (
          <VoteButton
            selected={selectedVote === Vote.ABSTAIN}
            onClick={() => setSelectedVote(Vote.ABSTAIN)}
            color="#8c8d92"
            icon={<span style={{ fontSize: 20 }}>{'\uD83E\uDD37'}</span>}
            label=""
            disabled={isLoading}
          />
        )}
      </div>

      {/* Reason input */}
      <textarea
        placeholder="Add a reason for your vote (optional)"
        value={reason}
        onChange={e => setReason(e.target.value)}
        rows={3}
        style={{
          width: '100%',
          padding: '10px 14px',
          borderRadius: 10,
          border: '1px solid #e2e3e8',
          fontFamily: "'PT Root UI'",
          fontSize: '0.82rem',
          resize: 'vertical',
          outline: 'none',
          transition: 'border-color 0.15s',
          background: '#fafafa',
        }}
        onFocus={e => (e.currentTarget.style.borderColor = '#000')}
        onBlur={e => (e.currentTarget.style.borderColor = '#e2e3e8')}
      />

      {errorMessage && (
        <div
          style={{
            color: '#e40536',
            fontSize: '0.75rem',
            fontWeight: 600,
            marginTop: 8,
            wordBreak: 'break-word',
          }}
        >
          {errorMessage}
        </div>
      )}

      {/* Submit */}
      <button
        onClick={submitVote}
        disabled={selectedVote === undefined || isLoading}
        style={{
          width: '100%',
          marginTop: 12,
          padding: '12px',
          borderRadius: 10,
          border: 'none',
          background: selectedVote === undefined ? '#e2e3e8' : '#14141f',
          color: selectedVote === undefined ? '#8c8d92' : '#fff',
          fontFamily: "'PT Root UI'",
          fontWeight: 700,
          fontSize: '0.85rem',
          cursor: selectedVote === undefined || isLoading ? 'not-allowed' : 'pointer',
          transition: 'all 0.15s',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
        }}
      >
        {isLoading ? (
          <>
            <Loader2 size={16} className="animate-spin" />
            Submitting...
          </>
        ) : (
          <>Submit Vote</>
        )}
      </button>

      <div
        style={{
          textAlign: 'center',
          fontSize: '0.7rem',
          color: isZeroWeight ? '#d97706' : '#b0b0b8',
          marginTop: 8,
        }}
      >
        {isZeroWeight
          ? 'Zero-weight vote — gas will not be refunded.'
          : 'Gas spent on voting will be refunded to you.'}
      </div>
    </div>
  );
};

const VoteButton: FC<{
  selected: boolean;
  onClick: () => void;
  color: string;
  icon: ReactNode;
  label: string;
  disabled: boolean;
}> = ({ selected, onClick, color, icon, label, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    style={{
      flex: 1,
      padding: '10px',
      borderRadius: 10,
      border: selected ? `2px solid ${color}` : '2px solid #e2e3e8',
      background: selected ? `${color}10` : '#fff',
      color: selected ? color : '#8c8d92',
      cursor: disabled ? 'not-allowed' : 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      fontFamily: "'PT Root UI'",
      fontWeight: 700,
      fontSize: '0.82rem',
      transition: 'all 0.15s',
    }}
  >
    {icon}
    {label}
  </button>
);

export default InlineVotePanel;
