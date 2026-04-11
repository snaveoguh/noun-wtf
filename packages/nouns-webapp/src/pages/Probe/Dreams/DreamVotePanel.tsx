import { FC, useState } from 'react';

import { toast } from 'sonner';
import { useAccount } from 'wagmi';

import { Button } from '@/components/ui/button';
import { NOUN_WTF_CLIENT_ID } from '@/config';
import { useReadNounsGovernorQuorumVotes } from '@/contracts';
import {
  useCastRefundableVote,
  useCastRefundableVoteWithReason,
} from '@/wrappers/nounsDao';
import { useUserVotes } from '@/wrappers/nounToken';

interface Props {
  proposalId: number;
  forVotes: number;
  againstVotes: number;
  abstainVotes: number;
}

const DreamVotePanel: FC<Props> = ({ proposalId, forVotes, againstVotes, abstainVotes }) => {
  const { address } = useAccount();
  const availableVotes = useUserVotes();
  const hasVotes = availableVotes && availableVotes > 0;
  const { castRefundableVote } = useCastRefundableVote();
  const { castRefundableVoteWithReason } = useCastRefundableVoteWithReason();

  // @ts-expect-error — wagmi deep type instantiation issue with generated hooks
  const { data: quorumVotes } = useReadNounsGovernorQuorumVotes({
    args: [BigInt(proposalId)],
    query: { enabled: proposalId > 0 },
  }) as { data: bigint | undefined };

  const [reason, setReason] = useState('');
  const [voting, setVoting] = useState(false);
  const [showReasonField, setShowReasonField] = useState(false);

  const totalVotes = forVotes + againstVotes + abstainVotes;
  const quorum = quorumVotes ? Number(quorumVotes) : 0;

  const handleVote = async (support: number) => {
    if (!address || !hasVotes) return;
    setVoting(true);
    try {
      if (reason.trim()) {
        await castRefundableVoteWithReason({
          args: [BigInt(proposalId), support, reason.trim(), NOUN_WTF_CLIENT_ID],
        });
      } else {
        await castRefundableVote({
          args: [BigInt(proposalId), support, NOUN_WTF_CLIENT_ID],
        });
      }
      toast.success('Vote cast!');
    } catch (err) {
      console.error('Failed to vote:', err);
      toast.error(err instanceof Error ? err.message : 'Failed to vote');
    } finally {
      setVoting(false);
    }
  };

  const VoteBar = ({ label, count, color }: { label: string; count: number; color: string }) => {
    const pct = quorum > 0 ? Math.min(100, (count / quorum) * 100) : 0;
    return (
      <div className="flex items-center gap-3">
        <span className="w-16 text-xs font-bold" style={{ color }}>
          {label}
        </span>
        <div className="h-3 flex-1 overflow-hidden rounded-full bg-gray-100">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, backgroundColor: color }}
          />
        </div>
        <span className="w-8 text-right text-xs font-bold">{count}</span>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <h4 className="font-bold">Vote Tally</h4>

      <div className="space-y-2">
        <VoteBar label="For" count={forVotes} color="#43A855" />
        <VoteBar label="Against" count={againstVotes} color="#D7002A" />
        <VoteBar label="Abstain" count={abstainVotes} color="#ABABAB" />
      </div>

      {quorum > 0 && (
        <p className="text-xs text-gray-500">
          Quorum: {totalVotes} / {quorum} votes
        </p>
      )}

      {/* Vote buttons */}
      {hasVotes && address && (
        <div className="space-y-2 border-t pt-3">
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => handleVote(1)}
              disabled={voting}
              className="flex-1 bg-green-600 hover:bg-green-700"
            >
              For
            </Button>
            <Button
              size="sm"
              onClick={() => handleVote(0)}
              disabled={voting}
              className="flex-1 bg-red-600 hover:bg-red-700"
            >
              Against
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => handleVote(2)}
              disabled={voting}
              className="flex-1"
            >
              Abstain
            </Button>
          </div>
          <button
            onClick={() => setShowReasonField(!showReasonField)}
            className="text-xs text-gray-500 underline"
          >
            {showReasonField ? 'Hide reason' : 'Add reason'}
          </button>
          {showReasonField && (
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="Why are you voting this way?"
              rows={2}
              className="border-border w-full rounded-lg border px-3 py-2 text-sm"
            />
          )}
        </div>
      )}
    </div>
  );
};

export default DreamVotePanel;
