import { FC, useEffect, useMemo, useState } from 'react';

import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import { MessageSquare, RefreshCcw, ThumbsDown, ThumbsUp } from 'lucide-react';
import { usePublicClient } from 'wagmi';

import { stripNoggles } from '@/utils/addressAndENSDisplayUtils';
import { buildEtherscanAddressLink, buildEtherscanTxLink } from '@/utils/etherscan';
import { ensCacheKey } from '@/utils/ensLookup';
import { lookupNNSOrENS } from '@/utils/lookupNNSOrENS';

dayjs.extend(relativeTime);

export interface VoteWithReason {
  support: number; // 0=against, 1=for, 2=abstain
  votes: number;
  voter: string;
  reason?: string;
  clientId?: number;
  createdAtBlock?: string;
  createdAtTransaction?: string;
}

interface ProposalVoteActivityProps {
  votes: VoteWithReason[];
  onRevote?: (voterAddress: string, support: number) => void;
}

const SUPPORT_LABELS: Record<number, { label: string; color: string; bg: string }> = {
  1: { label: 'For', color: '#43b369', bg: 'rgba(67, 179, 105, 0.1)' },
  0: { label: 'Against', color: '#e40536', bg: 'rgba(228, 5, 54, 0.1)' },
  2: { label: 'Abstain', color: '#8c8d92', bg: 'rgba(140, 141, 146, 0.1)' },
};

const VoteActivityItem: FC<{
  vote: VoteWithReason;
  onRevote?: (voterAddress: string, support: number) => void;
}> = ({ vote, onRevote }) => {
  const publicClient = usePublicClient();
  const [ensName, setEnsName] = useState<string | null>(null);

  useEffect(() => {
    if (!publicClient || !vote.voter) return;

    // Check cache first. Cached names from before the `.noggles` strip
    // shipped may still contain the suffix — strip on read.
    const cached = localStorage.getItem(ensCacheKey(vote.voter as `0x${string}`));
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed.expires > Date.now() / 1000) {
          setEnsName(stripNoggles(parsed.name) || null);
          return;
        }
      } catch {}
    }

    lookupNNSOrENS(publicClient, vote.voter as `0x${string}`)
      .then(name => {
        if (name) {
          setEnsName(name);
          localStorage.setItem(
            ensCacheKey(vote.voter as `0x${string}`),
            JSON.stringify({ name, expires: Date.now() / 1000 + 30 * 60 }),
          );
        }
      })
      .catch(() => {});
  }, [publicClient, vote.voter]);

  const supportInfo = SUPPORT_LABELS[vote.support] ?? SUPPORT_LABELS[2];
  const displayName = ensName || `${vote.voter.slice(0, 6)}...${vote.voter.slice(-4)}`;

  return (
    <div
      style={{
        padding: '16px 0',
        borderBottom: '1px solid #e8e8ec',
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          {/* Vote direction icon */}
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: 8,
              background: supportInfo.bg,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {vote.support === 1 ? (
              <ThumbsUp size={14} color={supportInfo.color} />
            ) : vote.support === 0 ? (
              <ThumbsDown size={14} color={supportInfo.color} />
            ) : (
              <MessageSquare size={14} color={supportInfo.color} />
            )}
          </div>

          {/* Voter address */}
          <a
            href={buildEtherscanAddressLink(vote.voter)}
            target="_blank"
            rel="noreferrer"
            style={{
              fontWeight: 700,
              fontSize: '0.85rem',
              color: '#14141f',
              textDecoration: 'none',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={vote.voter}
          >
            {displayName}
          </a>

          {/* Vote direction label */}
          <span
            style={{
              fontSize: '0.75rem',
              fontWeight: 600,
              color: supportInfo.color,
              padding: '2px 8px',
              borderRadius: 6,
              background: supportInfo.bg,
              whiteSpace: 'nowrap',
            }}
          >
            {supportInfo.label}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {/* Vote weight */}
          <span
            style={{
              fontSize: '0.75rem',
              fontWeight: 700,
              color: '#8c8d92',
            }}
          >
            {vote.votes} {vote.votes === 1 ? 'vote' : 'votes'}
          </span>

          {/* Revote button */}
          {onRevote && (
            <button
              onClick={() => onRevote(vote.voter, vote.support)}
              style={{
                background: 'none',
                border: '1px solid #e2e3e8',
                borderRadius: 6,
                padding: '3px 8px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                fontSize: '0.65rem',
                fontWeight: 600,
                color: '#8c8d92',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = '#000';
                e.currentTarget.style.color = '#000';
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = '#e2e3e8';
                e.currentTarget.style.color = '#8c8d92';
              }}
              title={`Revote ${displayName}'s vote`}
            >
              <RefreshCcw size={10} />
              Revote
            </button>
          )}

          {/* TX link */}
          {vote.createdAtTransaction && (
            <a
              href={buildEtherscanTxLink(vote.createdAtTransaction)}
              target="_blank"
              rel="noreferrer"
              style={{
                fontSize: '0.65rem',
                color: '#b0b0b8',
                textDecoration: 'none',
              }}
            >
              tx
            </a>
          )}
        </div>
      </div>

      {/* Reason */}
      {vote.reason && vote.reason.trim() !== '' && (
        <div
          style={{
            marginTop: 8,
            marginLeft: 36,
            padding: '10px 14px',
            background: '#f8f8fa',
            borderRadius: 10,
            fontSize: '0.82rem',
            lineHeight: 1.5,
            color: '#3a3a4a',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
          }}
        >
          {vote.reason}
        </div>
      )}
    </div>
  );
};

type SortMode = 'recent' | 'weight' | 'for' | 'against';

const ProposalVoteActivity: FC<ProposalVoteActivityProps> = ({ votes, onRevote }) => {
  const [sortMode, setSortMode] = useState<SortMode>('recent');
  const [showAll, setShowAll] = useState(false);

  const sorted = useMemo(() => {
    const arr = [...votes];
    switch (sortMode) {
      case 'recent':
        // Sort by block descending (most recent first)
        return arr.sort(
          (a, b) => Number(b.createdAtBlock || 0) - Number(a.createdAtBlock || 0),
        );
      case 'weight':
        return arr.sort((a, b) => b.votes - a.votes);
      case 'for':
        return arr.filter(v => v.support === 1).sort((a, b) => b.votes - a.votes);
      case 'against':
        return arr.filter(v => v.support === 0).sort((a, b) => b.votes - a.votes);
      default:
        return arr;
    }
  }, [votes, sortMode]);

  const displayed = showAll ? sorted : sorted.slice(0, 20);

  return (
    <div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <h3
          style={{
            fontFamily: "'Londrina Solid'",
            fontSize: '1.5rem',
            fontWeight: 400,
            margin: 0,
          }}
        >
          Proposal Activity
        </h3>
        <div style={{ display: 'flex', gap: 4 }}>
          {(['recent', 'weight', 'for', 'against'] as SortMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => setSortMode(mode)}
              style={{
                background: sortMode === mode ? '#14141f' : '#f4f4f8',
                color: sortMode === mode ? '#fff' : '#8c8d92',
                border: 'none',
                borderRadius: 6,
                padding: '4px 10px',
                fontSize: '0.7rem',
                fontWeight: 600,
                cursor: 'pointer',
                textTransform: 'capitalize',
                transition: 'all 0.15s',
              }}
            >
              {mode}
            </button>
          ))}
        </div>
      </div>

      {displayed.length === 0 ? (
        <div
          style={{
            padding: 32,
            textAlign: 'center',
            color: '#8c8d92',
            fontSize: '0.85rem',
          }}
        >
          No votes yet
        </div>
      ) : (
        <>
          {displayed.map((vote, i) => (
            <VoteActivityItem key={`${vote.voter}-${i}`} vote={vote} onRevote={onRevote} />
          ))}
        </>
      )}

      {!showAll && sorted.length > 20 && (
        <button
          onClick={() => setShowAll(true)}
          style={{
            display: 'block',
            width: '100%',
            padding: '12px',
            background: '#f4f4f8',
            border: 'none',
            borderRadius: 10,
            marginTop: 8,
            cursor: 'pointer',
            fontSize: '0.8rem',
            fontWeight: 600,
            color: '#8c8d92',
          }}
        >
          Show all {sorted.length} votes
        </button>
      )}
    </div>
  );
};

export default ProposalVoteActivity;
