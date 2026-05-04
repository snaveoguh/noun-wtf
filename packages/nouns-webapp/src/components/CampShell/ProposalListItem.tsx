import type { PartialProposal } from '@/wrappers/nounsDao';
import { ProposalState } from '@/wrappers/nounsDao';

import StatusTag from './StatusTag';
import VotesTagGroup from './VotesTagGroup';
import VotingBar from './VotingBar';
import { isVotableState, toCampState } from './imported/proposals';

interface ProposalListItemProps {
  proposal: PartialProposal;
  /** Show the inline vote progress bar — only useful for active/concluded proposals. */
  showVotingBar?: boolean;
}

const truncateAddress = (addr: string) => `${addr.slice(0, 6)}…${addr.slice(-4)}`;

/**
 * Mirrors the row Camp's `<SectionedList>` renders for a proposal. Camp's
 * version pulls in a richer object (proposer ENS, signer count, vote details);
 * we make do with `PartialProposal` from the subgraph.
 */
export default function ProposalListItem({
  proposal,
  showVotingBar = false,
}: ProposalListItemProps) {
  const camp = toCampState(proposal.status);
  const isActive = isVotableState(camp);
  const showBar =
    showVotingBar &&
    (isActive ||
      proposal.status === ProposalState.SUCCEEDED ||
      proposal.status === ProposalState.QUEUED ||
      proposal.status === ProposalState.EXECUTED ||
      proposal.status === ProposalState.DEFEATED ||
      proposal.status === ProposalState.VETOED ||
      proposal.status === ProposalState.EXPIRED);

  return (
    <li
      style={{
        listStyle: 'none',
        borderBottom: '1px solid var(--theme-border-light, var(--theme-border))',
      }}
    >
      <div
        style={{
          display: 'block',
          padding: '12px 16px',
          color: 'var(--theme-text-primary)',
          textDecoration: 'none',
          cursor: 'default',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--theme-text-secondary, var(--theme-text-primary))',
              minWidth: 32,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {proposal.id}
          </span>
          <span
            style={{
              flex: 1,
              fontSize: 14,
              lineHeight: 1.35,
              fontWeight: 500,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
            }}
          >
            {proposal.title || `Proposal ${proposal.id}`}
          </span>
          <StatusTag status={proposal.status} size="sm" />
        </div>

        {showBar && (
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <VotingBar
                forVotes={proposal.forCount}
                againstVotes={proposal.againstCount}
                abstainVotes={proposal.abstainCount}
                quorumVotes={proposal.quorumVotes}
              />
            </div>
            <VotesTagGroup
              for_={proposal.forCount}
              against={proposal.againstCount}
              abstain={proposal.abstainCount}
              quorum={proposal.quorumVotes || undefined}
              highlight={
                proposal.forCount >= proposal.againstCount && proposal.forCount > 0
                  ? 'for'
                  : proposal.againstCount > proposal.forCount
                    ? 'against'
                    : undefined
              }
            />
          </div>
        )}
      </div>
    </li>
  );
}

export function ProposalListItemCompact({ proposal }: ProposalListItemProps) {
  return <ProposalListItem proposal={proposal} showVotingBar={false} />;
}

export function ProposerHint({ proposer }: { proposer?: string }) {
  if (!proposer) return null;
  return (
    <span
      style={{
        fontSize: 11,
        color: 'var(--theme-text-muted, var(--theme-text-secondary))',
      }}
    >
      by {truncateAddress(proposer)}
    </span>
  );
}
