/**
 * BidCommentThread — scrollable thread of all bid comments for a derivative auction.
 *
 * Reads AuctionBidWithReason events via useDerivativeBidComments and renders
 * them as a reverse-chronological feed. The winning bid gets a gold accent.
 */
import type { Address } from '@/utils/types';

import { FC } from 'react';

import { formatEther } from 'viem';

import { useDerivativeBidComments, type BidComment } from '@/hooks/useDerivativeBidComments';
import { useReverseENSLookUp } from '@/utils/ensLookup';

interface Props {
  tokenId: number;
  isSettled: boolean;
  winnerAddress?: string;
}

const truncAddr = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

const fmtEth = (wei: bigint): string => {
  const n = parseFloat(formatEther(wei));
  return n < 0.001 ? n.toFixed(6) : n.toFixed(4);
};

const timeAgo = (timestamp: number): string => {
  const diff = Math.floor(Date.now() / 1000) - timestamp;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

// Sub-component so each row can call useReverseENSLookUp (hooks must be top-level)
const CommentRow: FC<{
  comment: BidComment;
  isWinner: boolean;
}> = ({ comment, isWinner }) => {
  const ens = useReverseENSLookUp(comment.bidder as Address);
  const displayName = ens || truncAddr(comment.bidder);
  const hasReason = comment.reason.trim().length > 0;

  return (
    <div
      style={{
        padding: '6px 8px',
        borderRadius: 8,
        background: 'rgba(255,255,255,0.06)',
        borderLeft: isWinner ? '3px solid #fbbf24' : '3px solid transparent',
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span>
          <span style={{ fontWeight: 600, color: 'rgba(255,255,255,0.9)' }}>{displayName}</span>
          <span style={{ color: 'rgba(255,255,255,0.4)', marginLeft: 6 }}>
            {fmtEth(comment.amount)} ETH
          </span>
        </span>
        <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: '0.5rem' }}>
          {timeAgo(comment.timestamp)}
        </span>
      </div>
      {hasReason && (
        <div
          style={{
            color: 'rgba(255,255,255,0.75)',
            lineHeight: 1.45,
            wordBreak: 'break-word',
          }}
        >
          {comment.reason}
        </div>
      )}
    </div>
  );
};

const BidCommentThread: FC<Props> = ({ tokenId, isSettled, winnerAddress }) => {
  const { comments, isLoading } = useDerivativeBidComments(tokenId, isSettled);

  // Reverse chronological (newest first)
  const sorted = [...comments].sort((a, b) => Number(b.blockNumber - a.blockNumber));

  // Only show if there's at least one comment with a reason
  const hasAnyReasons = sorted.some(c => c.reason.trim().length > 0);
  if (!hasAnyReasons && !isLoading) return null;

  const winner = winnerAddress?.toLowerCase();

  return (
    <div
      style={{
        maxHeight: 200,
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        fontFamily: "'PT Root UI', sans-serif",
        fontSize: '0.55rem',
      }}
    >
      {sorted.map((comment, i) => (
        <CommentRow
          key={`${comment.blockNumber}-${i}`}
          comment={comment}
          isWinner={!!winner && comment.bidder.toLowerCase() === winner}
        />
      ))}
    </div>
  );
};

export default BidCommentThread;
