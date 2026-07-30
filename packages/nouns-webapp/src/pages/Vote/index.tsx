import type { VoteWithReason } from '@/components/ProposalVoteActivity';

import { Fragment, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import { useQuery } from '@apollo/client';
import { i18n } from '@lingui/core';
import { t } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import dayjs from 'dayjs';
import en from 'dayjs/locale/en';
import advanced from 'dayjs/plugin/advancedFormat';
import relativeTime from 'dayjs/plugin/relativeTime';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { ArrowLeft, ChevronDown, ChevronUp, Clock, ExternalLink, FileText } from 'lucide-react';
import { Spinner } from 'react-bootstrap';
import ReactMarkdown from 'react-markdown';
import { Link, useParams } from 'react-router';
import rehypeRaw from 'rehype-raw';
import remarkBreaks from 'remark-breaks';
import remarkGfm from 'remark-gfm';
import { toast } from 'sonner';
import { useAccount, useBlockNumber } from 'wagmi';

import ByLineHoverCard from '@/components/ByLineHoverCard';
import HoverCard from '@/components/HoverCard';
import InlineVotePanel from '@/components/InlineVotePanel';
import ProposalTransactions from '@/components/ProposalContent/ProposalTransactions';
import ProposalPropdates from '@/components/ProposalPropdates';
import ProposalStatus from '@/components/ProposalStatus';
import ProposalVoteActivity from '@/components/ProposalVoteActivity';
import ShortAddress from '@/components/ShortAddress';
import VotingOverview from '@/components/VotingOverview';
import { useReadNounsGovernorQuorumVotes } from '@/contracts';
import { useAppSelector } from '@/hooks';
import { useActiveLocale } from '@/hooks/useActivateLocale';
import { SUPPORTED_LOCALE_TO_DAYSJS_LOCALE, SupportedLocale } from '@/i18n/locales';
import { AVERAGE_BLOCK_TIME_IN_SECS } from '@/utils/constants';
import { buildEtherscanAddressLink, buildEtherscanTxLink } from '@/utils/etherscan';
import { processProposalDescriptionText } from '@/utils/processProposalDescriptionText';
import { isProposalUpdatable } from '@/utils/proposals';
import {
  PartialProposal,
  ProposalState,
  ProposalVersion,
  useCancelProposal,
  useExecuteProposal,
  useHasVotedOnProposal,
  useIsDaoGteV3,
  useIsForkActive,
  useProposal,
  useProposalVersions,
  useProposalVote,
  useQueueProposal,
} from '@/wrappers/nounsDao';
import { useProposalFeedback } from '@/wrappers/nounsData';
import { useUserVotesAsOfBlock } from '@/wrappers/nounToken';
import { delegateNounsAtBlockQuery, proposalVotesQuery } from '@/wrappers/subgraph';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(advanced);
dayjs.extend(relativeTime);

const getUpdatableCountdownCopy = (
  proposal: PartialProposal,
  currentBlock: bigint,
  locale: SupportedLocale,
) => {
  const timestamp = Date.now();
  const endDate =
    proposal !== undefined && currentBlock !== undefined
      ? dayjs(timestamp).add(
          AVERAGE_BLOCK_TIME_IN_SECS * Number(proposal.updatePeriodEndBlock - BigInt(currentBlock)),
          'seconds',
        )
      : undefined;

  return (
    <>
      {dayjs(endDate)
        .locale(SUPPORTED_LOCALE_TO_DAYSJS_LOCALE[locale] ?? en)
        .fromNow(true)}
    </>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// Vote Page — nouns.game–inspired redesign
// ─────────────────────────────────────────────────────────────────────────────

const VotePage = () => {
  const { id } = useParams<{ id: string }>();
  const [isQueuePending, setQueuePending] = useState(false);
  const [isExecutePending, setExecutePending] = useState(false);
  const [isCancelPending, setCancelPending] = useState(false);
  const [dataFetchPollInterval] = useState(0);
  const [isObjectionPeriod, setIsObjectionPeriod] = useState(false);
  const [forkPeriodMessage, setForkPeriodMessage] = useState<ReactNode>(<></>);
  const [isExecutable, setIsExecutable] = useState(true);
  const [showTransactions, setShowTransactions] = useState(false);
  // Description leads — what the proposal *says* matters before the tally.
  const [activeTab, setActiveTab] = useState<'vote' | 'description'>('description');
  const [revoteTarget, setRevoteTarget] = useState<{
    voter: string;
    support: number;
  } | null>(null);

  const proposal = useProposal(Number(id));
  const proposalVersions = useProposalVersions(Number(id));
  const activeLocale = useActiveLocale();
  const { _ } = useLingui();
  const { address: account } = useAccount();
  const { queueProposal, queueProposalState } = useQueueProposal();
  const { executeProposal, executeProposalState } = useExecuteProposal();
  const { cancelProposal, cancelProposalState } = useCancelProposal();
  const isDaoGteV3 = useIsDaoGteV3();
  useProposalFeedback(Number(id).toString(), dataFetchPollInterval);
  const hasVoted = useHasVotedOnProposal(BigInt(proposal?.id ?? 0n));
  const proposalVote = useProposalVote(BigInt(proposal?.id ?? 0n));
  const forkActiveState = useIsForkActive();
  const [isForkActive, setIsForkActive] = useState(false);

  const timestamp = Date.now();
  const { data: currentBlock } = useBlockNumber();

  const startDate =
    proposal !== undefined && currentBlock !== undefined
      ? dayjs(timestamp).add(
          AVERAGE_BLOCK_TIME_IN_SECS * Number(proposal.startBlock - BigInt(currentBlock)),
          'seconds',
        )
      : undefined;

  const endBlock =
    currentBlock !== undefined &&
    proposal?.endBlock !== undefined &&
    isObjectionPeriod &&
    currentBlock > proposal?.endBlock
      ? proposal?.objectionPeriodEndBlock
      : proposal?.endBlock;

  const endDate =
    proposal !== undefined && currentBlock !== undefined && endBlock !== undefined
      ? dayjs(timestamp).add(
          AVERAGE_BLOCK_TIME_IN_SECS * Number(endBlock - BigInt(currentBlock)),
          'seconds',
        )
      : undefined;

  const now = dayjs();

  // User vote eligibility — use vote snapshot block (or currentBlock-1 if earlier)
  const currentOrSnapshotBlock = useMemo(() => {
    const snapshot = proposal?.voteSnapshotBlock != null ? Number(proposal.voteSnapshotBlock) : 0;
    const current = currentBlock !== undefined ? Number(currentBlock - 1n) : 0;
    if (snapshot <= 0 && current <= 0) return undefined;
    if (snapshot <= 0) return current;
    if (current <= 0) return snapshot;
    return Math.min(snapshot, current);
  }, [currentBlock, proposal?.voteSnapshotBlock]);
  const userVotes = useUserVotesAsOfBlock(currentOrSnapshotBlock);

  // Fetch dynamic quorum directly from the governor contract
  // This returns the real-time quorum for the proposal (accounts for dynamic quorum)
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  const { data: currentQuorum } = useReadNounsGovernorQuorumVotes({
    args: [proposal !== undefined && proposal.id !== undefined ? BigInt(proposal.id) : 0n],
    query: {
      enabled: proposal !== undefined && proposal.id !== undefined,
    },
  });

  const getVersionTimestamp = (pv: ProposalVersion[]) => pv[pv.length - 1]?.createdAt;

  const hasSucceeded = proposal?.status === ProposalState.SUCCEEDED;
  const isInNonFinalState =
    proposal?.status !== undefined &&
    [
      ProposalState.UPDATABLE,
      ProposalState.PENDING,
      ProposalState.ACTIVE,
      ProposalState.SUCCEEDED,
      ProposalState.QUEUED,
      ProposalState.OBJECTION_PERIOD,
    ].includes(proposal.status);

  const signers = proposal && proposal?.signers?.map(s => s.id.toLowerCase());
  const isProposalSigner = !!(
    account &&
    proposal &&
    signers &&
    signers.includes(account?.toLowerCase())
  );
  const hasManyVersions = proposalVersions !== undefined && proposalVersions.length > 1;
  const isProposer = () => proposal?.proposer?.toLowerCase() === account?.toLowerCase();
  const isUpdateable = () => {
    if (!isDaoGteV3) return false;
    return !!(
      proposal !== undefined &&
      currentBlock !== undefined &&
      isProposalUpdatable(proposal.status, proposal.updatePeriodEndBlock, currentBlock)
    );
  };
  const isCancellable = () => isInNonFinalState && (isProposalSigner || isProposer());
  const isAwaitingStateChange = () => {
    if (hasSucceeded) return true;
    if (proposal?.status === ProposalState.QUEUED)
      return new Date() >= (proposal?.eta ?? Number.MAX_SAFE_INTEGER);
    return false;
  };

  // State change actions
  const moveStateButtonAction = hasSucceeded ? <Trans>Queue</Trans> : <Trans>Execute</Trans>;
  const moveStateAction = (() => {
    if (hasSucceeded)
      return () => {
        if (proposal?.id) return queueProposal({ args: [BigInt(proposal.id)] });
      };
    return () => {
      if (proposal?.id) {
        if (proposal?.onTimelockV1) return true;
        else return executeProposal({ args: [BigInt(proposal.id)] });
      }
    };
  })();

  const onTransactionStateChange = useCallback(
    (
      { errorMessage, status }: { status: string; errorMessage?: string },
      successMessage?: string,
      setPending?: (isPending: boolean) => void,
    ) => {
      switch (status) {
        case 'None':
          setPending?.(false);
          break;
        case 'Mining':
          setPending?.(true);
          break;
        case 'Success':
          toast.success(successMessage || _(t`Transaction Successful!`));
          setPending?.(false);
          break;
        case 'Fail':
        case 'Exception':
          toast.error(errorMessage || _(t`Please try again.`));
          setPending?.(false);
          break;
      }
    },
    [_],
  );

  useEffect(
    () => onTransactionStateChange(queueProposalState, _(t`Proposal Queued!`), setQueuePending),
    [queueProposalState, onTransactionStateChange, _],
  );
  useEffect(
    () =>
      onTransactionStateChange(executeProposalState, _(t`Proposal Executed!`), setExecutePending),
    [executeProposalState, onTransactionStateChange, _],
  );
  useEffect(
    () => onTransactionStateChange(cancelProposalState, _(t`Proposal Canceled!`), setCancelPending),
    [cancelProposalState, onTransactionStateChange, _],
  );
  useEffect(() => {
    if (forkActiveState.data) setIsForkActive(forkActiveState.data);
  }, [forkActiveState.data]);

  // Votes query
  const activeAccount = useAppSelector(state => state.account.activeAccount);
  const { query: votesQuery, variables: votesVariables } = proposalVotesQuery(proposal?.id ?? '0');
  const {
    loading,
    error,
    data: votersRaw,
  } = useQuery<{
    votes: {
      items: Array<{
        support: number;
        votes: number;
        voter: string;
        reason?: string;
        clientId?: number;
        createdAtBlock?: string;
        createdAtTransaction?: string;
      }>;
    };
  }>(votesQuery, { skip: !proposal, variables: votesVariables });

  // Delegate snapshot query (used for vote weight display)
  const voterIds = votersRaw?.votes?.items?.map(v => v.voter);
  const { query: voteSnapshotQuery, variables: voteSnapshotVariables } = delegateNounsAtBlockQuery(
    voterIds ?? [],
    BigInt(proposal?.voteSnapshotBlock ?? 0),
  );
  useQuery<{
    delegates: {
      items: Array<{ id: string; delegatedVotes: number }>;
    };
  }>(voteSnapshotQuery, {
    skip: (voterIds?.length ?? 0) === 0,
    variables: voteSnapshotVariables,
  });

  const isWalletConnected = activeAccount !== undefined;
  const isActiveForVoting =
    proposal?.status === ProposalState.ACTIVE ||
    proposal?.status === ProposalState.OBJECTION_PERIOD;

  useEffect(() => {
    if (
      isDaoGteV3 &&
      proposal !== undefined &&
      currentBlock !== undefined &&
      proposal?.objectionPeriodEndBlock !== undefined &&
      proposal.objectionPeriodEndBlock > 0 &&
      proposal?.endBlock !== undefined &&
      currentBlock > proposal.endBlock &&
      currentBlock <= proposal.objectionPeriodEndBlock
    ) {
      setIsObjectionPeriod(true);
    } else {
      setIsObjectionPeriod(false);
    }
  }, [currentBlock, proposal?.status, proposal, isDaoGteV3]);

  useEffect(() => {
    if (proposal?.status === ProposalState.QUEUED && isForkActive) {
      setForkPeriodMessage(<p>Proposals cannot be executed during a forking period</p>);
      setIsExecutable(false);
    } else if (proposal?.status === ProposalState.QUEUED && !isForkActive) {
      setIsExecutable(true);
    }
  }, [proposal?.status, isForkActive]);

  // ── Loading / error states ──────────────────────────────────────────────
  if (!proposal || loading) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '60vh',
        }}
      >
        <Spinner animation="border" style={{ color: '#8c8d92' }} />
      </div>
    );
  }
  if (error) {
    return (
      <div style={{ textAlign: 'center', padding: 40, color: '#e40536' }}>
        Failed to fetch proposal data
      </div>
    );
  }

  // Use contract's dynamic quorum when available, fall back to static Ponder value
  const quorum = currentQuorum !== undefined ? Number(currentQuorum) : proposal.quorumVotes;

  // Build vote activity data
  const voteActivityData: VoteWithReason[] = (votersRaw?.votes?.items ?? []).map(v => ({
    support: v.support,
    votes: v.votes,
    voter: v.voter,
    reason: v.reason,
    clientId: v.clientId,
    createdAtBlock: v.createdAtBlock,
    createdAtTransaction: v.createdAtTransaction,
  }));

  // Time display helpers
  const startOrEndTimeCopy = () => {
    if (startDate?.isBefore(now) === true && endDate?.isAfter(now) === true) return 'Ends';
    if (endDate?.isBefore(now) === true) return 'Ended';
    return 'Starts';
  };
  const startOrEndTimeTime = () => {
    if (startDate == null || !startDate.isBefore(now)) return startDate;
    return endDate;
  };

  const handleRevote = (voterAddress: string, support: number) => {
    setRevoteTarget({ voter: voterAddress, support });
    setActiveTab('vote');
    // Scroll to inline vote panel
    document.getElementById('inline-vote-panel')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div
      className="vote-detail-wrapper"
      style={{
        maxWidth: 960,
        margin: '0 auto',
        padding: '0 20px 60px',
        fontFamily: "'PT Root UI'",
      }}
    >
      {/* ── Back button ──────────────────────────────────────────────── */}
      <div style={{ paddingTop: 20, marginBottom: 12 }}>
        <Link
          to="/vote"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            color: '#8c8d92',
            textDecoration: 'none',
            fontSize: '0.82rem',
            fontWeight: 600,
            transition: 'color 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.color = '#14141f')}
          onMouseLeave={e => (e.currentTarget.style.color = '#8c8d92')}
        >
          <ArrowLeft size={16} />
          Back to proposals
        </Link>
      </div>

      {/* ── Proposal header ──────────────────────────────────────────── */}
      <div style={{ marginBottom: 24 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            marginBottom: 8,
          }}
        >
          <span
            style={{
              fontSize: '0.8rem',
              color: '#8c8d92',
              fontWeight: 600,
            }}
          >
            Proposal {proposal.id}
          </span>
          <ProposalStatus status={proposal.status} />
          {isObjectionPeriod && (
            <span
              style={{
                fontSize: '0.65rem',
                fontWeight: 700,
                color: '#e40536',
                padding: '2px 8px',
                borderRadius: 6,
                border: '1.5px solid #e40536',
                background: 'rgba(228, 5, 54, 0.05)',
              }}
            >
              Objection Period
            </span>
          )}
        </div>

        <h1
          style={{
            fontFamily: "'Londrina Solid'",
            fontSize: '2rem',
            fontWeight: 400,
            margin: '0 0 8px',
            lineHeight: 1.2,
          }}
        >
          {proposal.title}
        </h1>

        {/* Proposer info */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            fontSize: '0.8rem',
            color: '#8c8d92',
          }}
        >
          <span>Proposed by</span>
          <HoverCard
            hoverCardContent={(tip: string) => <ByLineHoverCard proposerAddress={tip} />}
            tip={proposal.proposer || ''}
            id="proposerHoverCard"
          >
            <a
              href={buildEtherscanAddressLink(proposal.proposer || '')}
              target="_blank"
              rel="noreferrer"
              style={{
                fontWeight: 700,
                color: '#14141f',
                textDecoration: 'none',
              }}
            >
              <ShortAddress
                address={
                  (proposal.proposer ||
                    '0x0000000000000000000000000000000000000000') as `0x${string}`
                }
                avatar={false}
              />
            </a>
          </HoverCard>

          {proposal.transactionHash && (
            <a
              href={buildEtherscanTxLink(proposal.transactionHash)}
              target="_blank"
              rel="noreferrer"
              style={{ color: '#b0b0b8' }}
            >
              <ExternalLink size={12} />
            </a>
          )}

          {proposal.signers?.length > 0 && (
            <>
              <span style={{ color: '#d0d0d4' }}>|</span>
              <span>Sponsored by</span>
              {proposal.signers.map((signer: { id: string }) => (
                <Fragment key={signer.id}>
                  <HoverCard
                    hoverCardContent={(tip: string) => <ByLineHoverCard proposerAddress={tip} />}
                    tip={signer.id}
                    id={`signer-${signer.id}`}
                  >
                    <a
                      href={buildEtherscanAddressLink(signer.id)}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        fontWeight: 700,
                        color: '#14141f',
                        textDecoration: 'none',
                      }}
                    >
                      <ShortAddress address={signer.id as `0x${string}`} avatar={false} />
                    </a>
                  </HoverCard>
                </Fragment>
              ))}
            </>
          )}
        </div>

        {/* Version info */}
        {isDaoGteV3 && (
          <div
            style={{
              marginTop: 8,
              fontSize: '0.75rem',
              color: '#8c8d92',
            }}
          >
            {hasManyVersions ? (
              <Link
                to={`/vote/${proposal.id}/history/`}
                style={{ color: '#4965d0', textDecoration: 'none' }}
              >
                <strong>Version {proposalVersions?.length}</strong>{' '}
                <span>
                  updated{' '}
                  {proposalVersions != null
                    ? dayjs.unix(Number(getVersionTimestamp(proposalVersions))).fromNow()
                    : null}
                </span>
              </Link>
            ) : (
              <>
                <strong>Version 1</strong>{' '}
                <span>
                  created{' '}
                  {proposal.createdTimestamp
                    ? dayjs.unix(Number(proposal.createdTimestamp)).fromNow()
                    : null}
                </span>
              </>
            )}
          </div>
        )}

        {/* Time info bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 10,
            fontSize: '0.75rem',
            color: '#8c8d92',
          }}
        >
          <Clock size={12} />
          <span>{startOrEndTimeCopy()}</span>
          {startOrEndTimeTime() && (
            <span style={{ fontWeight: 600, color: '#14141f' }}>
              {i18n.date(new Date(startOrEndTimeTime()?.toISOString() || 0), {
                dateStyle: 'long',
                timeStyle: 'short',
              })}
            </span>
          )}
          <span style={{ color: '#d0d0d4' }}>|</span>
          <span>Snapshot block</span>
          <span style={{ fontWeight: 600, color: '#14141f' }}>
            {String(proposal.voteSnapshotBlock)}
          </span>
        </div>
      </div>

      {/* ── Proposer actions (queue / execute / cancel / edit) ───────── */}
      {(isAwaitingStateChange() || isCancellable() || isUpdateable()) && (
        <div
          style={{
            background: '#fff',
            borderRadius: 16,
            border: '1px solid #e2e3e8',
            padding: '14px 20px',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 10,
          }}
        >
          <div style={{ fontSize: '0.82rem' }}>
            <span style={{ fontWeight: 700 }}>Proposal functions</span>
            {isProposer() && isUpdateable() && (
              <span style={{ color: '#8c8d92', marginLeft: 8 }}>
                Editable for {getUpdatableCountdownCopy(proposal, currentBlock ?? 0n, activeLocale)}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {isAwaitingStateChange() && (
              <button
                type="button"
                onClick={moveStateAction}
                disabled={isQueuePending || isExecutePending || !isExecutable}
                className="btn btn-dark"
                style={{
                  borderRadius: 8,
                  fontWeight: 700,
                  fontSize: '0.8rem',
                  padding: '8px 16px',
                }}
              >
                {isQueuePending || isExecutePending ? (
                  <Spinner animation="border" size="sm" />
                ) : (
                  <>{moveStateButtonAction} Proposal ⌐◧-◧</>
                )}
              </button>
            )}
            {isCancellable() && (
              <button
                type="button"
                onClick={() => {
                  if (proposal?.id) cancelProposal({ args: [BigInt(proposal.id)] });
                }}
                disabled={isCancelPending}
                className="btn btn-outline-danger"
                style={{
                  borderRadius: 8,
                  fontWeight: 700,
                  fontSize: '0.8rem',
                  padding: '8px 16px',
                }}
              >
                {isCancelPending ? <Spinner animation="border" size="sm" /> : 'Cancel Proposal'}
              </button>
            )}
            {isProposer() && isUpdateable() && (
              <Link
                to={`/vote/${id}/edit`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  background: '#14141f',
                  color: '#fff',
                  padding: '8px 16px',
                  borderRadius: 8,
                  fontWeight: 700,
                  fontSize: '0.8rem',
                  textDecoration: 'none',
                }}
              >
                Edit
              </Link>
            )}
          </div>
          {forkPeriodMessage}
        </div>
      )}

      {/* ── Voting Overview Bar ──────────────────────────────────────── */}
      <div style={{ marginBottom: 16 }}>
        <VotingOverview
          forVotes={proposal.forCount}
          againstVotes={proposal.againstCount}
          abstainVotes={proposal.abstainCount}
          quorum={quorum}
          isActive={isActiveForVoting}
        />
      </div>

      {/* ── Two-column layout: left = content, right = vote panel ─── */}
      <div
        className="vote-page-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 340px',
          gap: 20,
          alignItems: 'start',
        }}
      >
        {/* ── Left column ──────────────────────────────────────────── */}
        <div>
          {/* Tabs */}
          <div
            style={{
              display: 'flex',
              gap: 0,
              borderBottom: '2px solid #e2e3e8',
              marginBottom: 20,
            }}
          >
            {(['description', 'vote'] as const).map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  padding: '10px 20px',
                  background: 'none',
                  border: 'none',
                  borderBottom: activeTab === tab ? '2px solid #14141f' : '2px solid transparent',
                  marginBottom: -2,
                  cursor: 'pointer',
                  fontFamily: "'PT Root UI'",
                  fontWeight: activeTab === tab ? 700 : 500,
                  fontSize: '0.85rem',
                  color: activeTab === tab ? '#14141f' : '#8c8d92',
                  transition: 'all 0.15s',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {tab === 'vote' ? (
                  <>
                    Votes & Activity{' '}
                    <span
                      style={{
                        fontSize: '0.65rem',
                        background: '#f0f0f4',
                        padding: '1px 6px',
                        borderRadius: 4,
                        fontWeight: 600,
                      }}
                    >
                      {voteActivityData.length}
                    </span>
                  </>
                ) : (
                  <>
                    <FileText size={14} />
                    Description
                  </>
                )}
              </button>
            ))}
          </div>

          {activeTab === 'vote' ? (
            <>
              {/* Transactions (collapsible) */}
              {proposal.details != null && proposal.details.length > 0 && (
                <div
                  style={{
                    background: '#fff',
                    borderRadius: 12,
                    border: '1px solid #e2e3e8',
                    marginBottom: 20,
                    overflow: 'hidden',
                  }}
                >
                  <button
                    onClick={() => setShowTransactions(!showTransactions)}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 16px',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontFamily: "'PT Root UI'",
                      fontWeight: 700,
                      fontSize: '0.82rem',
                      color: '#14141f',
                    }}
                  >
                    <span>Proposed Transactions ({proposal.details.length})</span>
                    {showTransactions ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                  </button>
                  {showTransactions && (
                    <div
                      style={{
                        padding: '0 16px 16px',
                        borderTop: '1px solid #e2e3e8',
                      }}
                    >
                      <ProposalTransactions details={proposal.details} />
                    </div>
                  )}
                </div>
              )}

              {/* Vote activity feed */}
              <ProposalVoteActivity
                votes={voteActivityData}
                onRevote={isActiveForVoting && isWalletConnected ? handleRevote : undefined}
              />
            </>
          ) : (
            /* Description tab */
            <div
              style={{
                background: '#fff',
                borderRadius: 16,
                border: '1px solid #e2e3e8',
                padding: '24px',
                overflowWrap: 'break-word',
                wordBreak: 'break-word' as const,
                overflow: 'hidden',
              }}
            >
              {proposal.description != null && proposal.description !== '' && (
                <ReactMarkdown
                  // remarkGfm = tables / strikethrough / autolinks. Without it GFM
                  // tables render as raw `| a | b |` pipes (hit on prop 987).
                  remarkPlugins={[remarkGfm, remarkBreaks]}
                  rehypePlugins={[rehypeRaw]}
                  components={{
                    img: ({ src, alt, ...props }) => {
                      // Skip data URL images (base64 embedded) — they're often broken in proposals
                      if (src != null && src.startsWith('data:')) {
                        return (
                          <span
                            style={{
                              display: 'block',
                              padding: '12px 16px',
                              background: '#f4f4f8',
                              borderRadius: 8,
                              color: '#8c8d92',
                              fontSize: '0.8rem',
                              margin: '8px 0',
                            }}
                          >
                            Embedded image ({alt ?? 'image'})
                          </span>
                        );
                      }
                      return (
                        <img
                          {...props}
                          src={src}
                          alt={alt}
                          style={{ maxWidth: '100%', height: 'auto', borderRadius: 8 }}
                          loading="lazy"
                          onError={e => {
                            const target = e.currentTarget;
                            target.style.display = 'none';
                            const fallback = document.createElement('div');
                            fallback.style.cssText =
                              'padding:12px 16px;background:#f4f4f8;border-radius:8px;color:#8c8d92;font-size:0.8rem;margin:8px 0;';
                            fallback.textContent = `Image unavailable: ${alt ?? 'image'}`;
                            target.parentNode?.insertBefore(fallback, target.nextSibling);
                          }}
                        />
                      );
                    },
                    // Prevent pre/code blocks from overflowing
                    pre: ({ ...props }) => (
                      <pre {...props} style={{ overflowX: 'auto', maxWidth: '100%' }} />
                    ),
                    table: ({ ...props }) => (
                      <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
                        <table {...props} />
                      </div>
                    ),
                  }}
                >
                  {processProposalDescriptionText(proposal.description, proposal.title)}
                </ReactMarkdown>
              )}

              {proposal.details != null && proposal.details.length > 0 && (
                <div style={{ marginTop: 24 }}>
                  <h3
                    style={{
                      fontFamily: "'Londrina Solid'",
                      fontSize: '1.3rem',
                      fontWeight: 400,
                      marginBottom: 12,
                    }}
                  >
                    Proposed Transactions
                  </h3>
                  <ProposalTransactions details={proposal.details} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Right column (sticky vote panel) ─────────────────────── */}
        <div
          id="inline-vote-panel"
          style={{
            position: 'sticky',
            top: 90,
          }}
        >
          <InlineVotePanel
            proposalId={proposal.id}
            availableVotes={userVotes ?? 0}
            hasVoted={hasVoted}
            proposalVote={proposalVote}
            isObjectionPeriod={isObjectionPeriod}
            isActiveForVoting={isActiveForVoting}
            isWalletConnected={isWalletConnected}
            prefillReason={
              revoteTarget
                ? `Re: ${revoteTarget.voter.slice(0, 6)}...${revoteTarget.voter.slice(-4)}'s vote`
                : undefined
            }
            prefillSupport={revoteTarget?.support}
          />

          {/* Objection period alert */}
          {isObjectionPeriod && (
            <div
              style={{
                marginTop: 12,
                background: 'rgba(228, 5, 54, 0.05)',
                border: '1px solid rgba(228, 5, 54, 0.2)',
                borderRadius: 12,
                padding: '12px 16px',
                fontSize: '0.75rem',
                color: '#e40536',
                lineHeight: 1.4,
              }}
            >
              <strong style={{ display: 'block', marginBottom: 4 }}>Objection Only Period</strong>
              Voting is limited to against votes. This protects the DAO from last-minute vote
              swings.
            </div>
          )}

          {/* Propdates for this proposal */}
          <ProposalPropdates proposalId={Number(proposal.id)} />
        </div>
      </div>
    </div>
  );
};

export default VotePage;
