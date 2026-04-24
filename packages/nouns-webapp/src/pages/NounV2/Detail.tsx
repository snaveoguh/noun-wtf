/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';

import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { formatEther } from 'viem';
import {
  useAccount,
  useBlockNumber,
  useReadContract,
  useReadContracts,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi';

import ShortAddress from '@/components/ShortAddress';
import {
  NOUNV2_PROPOSAL_STATE_LABELS,
  NOUNV2_TREASURY_ADDRESS,
  NounV2ProposalState,
  nounV2TreasuryAbi,
} from '@/contracts/nounv2-treasury';

import classes from './NounV2.module.css';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

function supportLabel(s: number) {
  return s === 0 ? 'AGAINST' : s === 1 ? 'FOR' : 'ABSTAIN';
}

function supportColor(s: number) {
  return s === 0 ? '#f87171' : s === 1 ? '#4ade80' : '#94a3b8';
}

export default function NounV2DetailPage() {
  const { id } = useParams<{ id: string }>();
  const proposalId = parseInt(id || '0');
  const { address: userAddr } = useAccount();
  const { data: blockNumber } = useBlockNumber({ watch: true });

  const addressMissing = NOUNV2_TREASURY_ADDRESS === ZERO_ADDRESS;
  const enabled = !!proposalId && !addressMissing;

  const [support, setSupport] = useState<number | null>(null);
  const [reason, setReason] = useState('');

  const {
    writeContractAsync,
    data: txHash,
    isPending,
  } = useWriteContract();
  const { isLoading: txMining, isSuccess: txConfirmed } = useWaitForTransactionReceipt({
    hash: txHash,
  });

  // Batch-read state + proposal + description + actions.
  const { data: reads, refetch } = useReadContracts({
    contracts: [
      {
        address: NOUNV2_TREASURY_ADDRESS,
        abi: nounV2TreasuryAbi,
        functionName: 'state' as const,
        args: [BigInt(proposalId)] as const,
      },
      {
        address: NOUNV2_TREASURY_ADDRESS,
        abi: nounV2TreasuryAbi,
        functionName: 'proposals' as const,
        args: [BigInt(proposalId)] as const,
      },
      {
        address: NOUNV2_TREASURY_ADDRESS,
        abi: nounV2TreasuryAbi,
        functionName: 'getDescription' as const,
        args: [BigInt(proposalId)] as const,
      },
      {
        address: NOUNV2_TREASURY_ADDRESS,
        abi: nounV2TreasuryAbi,
        functionName: 'getActions' as const,
        args: [BigInt(proposalId)] as const,
      },
    ],
    query: { enabled, refetchInterval: 15_000 },
  });

  const { data: receiptData } = useReadContract({
    address: NOUNV2_TREASURY_ADDRESS,
    abi: nounV2TreasuryAbi,
    functionName: 'getReceipt',
    args: userAddr ? [BigInt(proposalId), userAddr] : undefined,
    query: { enabled: enabled && !!userAddr },
  });

  // Re-fetch after a tx confirms
  if (txConfirmed) {
    // cheap way to trigger once; useReadContracts handles dedupe
    void refetch();
  }

  if (addressMissing) {
    return (
      <div className={classes.container}>
        <Link to="/nounv2" className={classes.backLink}>
          &larr; NounV2
        </Link>
        <div className={classes.missingAddress}>
          NounV2 treasury address not configured yet — set{' '}
          <code>VITE_NOUNV2_TREASURY_ADDRESS</code> after deploy.
        </div>
      </div>
    );
  }

  const stateRes = reads?.[0];
  const propRes = reads?.[1];
  const descRes = reads?.[2];
  const actionsRes = reads?.[3];

  if (!reads) {
    return (
      <div className={classes.container}>
        <p className={classes.loading}>Loading proposal...</p>
      </div>
    );
  }

  if (stateRes?.status !== 'success' || propRes?.status !== 'success') {
    return (
      <div className={classes.container}>
        <Link to="/nounv2" className={classes.backLink}>
          &larr; NounV2
        </Link>
        <p>Proposal #{proposalId} not found.</p>
      </div>
    );
  }

  const state = Number(stateRes.result) as NounV2ProposalState;
  const label = NOUNV2_PROPOSAL_STATE_LABELS[state];
  const prop = propRes.result as readonly [
    `0x${string}`,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    boolean,
    boolean,
    boolean,
  ];
  const [
    proposer,
    _snapshotBlock,
    _startBlock,
    endBlock,
    eta,
    forVotes,
    againstVotes,
    abstainVotes,
  ] = prop;

  const description = descRes?.status === 'success' ? (descRes.result as string) : '';
  const actions =
    actionsRes?.status === 'success'
      ? (actionsRes.result as readonly [
          readonly `0x${string}`[],
          readonly bigint[],
          readonly string[],
          readonly `0x${string}`[],
        ])
      : undefined;

  const receipt = receiptData as
    | { hasVoted: boolean; support: number; votes: bigint }
    | undefined;
  const hasVoted = receipt?.hasVoted === true;

  const title = (description.split('\n')[0] || '').replace(/^#\s*/, '').slice(0, 120) || 'Untitled';
  const body = description.split('\n').slice(1).join('\n').trim();

  const totalVotes = Number(forVotes) + Number(againstVotes);
  const forPct = totalVotes > 0 ? (Number(forVotes) / totalVotes) * 100 : 50;

  const isActive = state === NounV2ProposalState.Active;
  const isSucceeded = state === NounV2ProposalState.Succeeded;
  const isQueued = state === NounV2ProposalState.Queued;
  const canExecute = isQueued && eta > 0n && BigInt(Math.floor(Date.now() / 1000)) >= eta;
  const isProposer = userAddr?.toLowerCase() === proposer.toLowerCase();
  const canCancel = isProposer && !['EXECUTED', 'CANCELED'].includes(label);

  const blocksLeft =
    isActive && blockNumber != null ? Number(endBlock - (blockNumber ?? 0n)) : 0;
  const hoursLeft = Math.max(0, (blocksLeft * 12) / 3600);

  const grantTransactions = actions
    ? actions[0].map((target, i) => ({
        target,
        value: actions[1][i],
        signature: actions[2][i],
        calldata: actions[3][i],
      }))
    : [];
  const totalEth = grantTransactions.reduce(
    (sum, tx) => sum + Number(formatEther(tx.value)),
    0,
  );

  async function handleVote() {
    if (support === null) return;
    try {
      if (reason) {
        await writeContractAsync({
          address: NOUNV2_TREASURY_ADDRESS,
          abi: nounV2TreasuryAbi,
          functionName: 'castVoteWithReason',
          args: [BigInt(proposalId), support, reason],
        });
      } else {
        await writeContractAsync({
          address: NOUNV2_TREASURY_ADDRESS,
          abi: nounV2TreasuryAbi,
          functionName: 'castVote',
          args: [BigInt(proposalId), support],
        });
      }
      toast.success('Vote submitted');
    } catch (e: any) {
      toast.error(e?.shortMessage || 'Vote failed');
    }
  }

  async function handleQueue() {
    try {
      await writeContractAsync({
        address: NOUNV2_TREASURY_ADDRESS,
        abi: nounV2TreasuryAbi,
        functionName: 'queue',
        args: [BigInt(proposalId)],
      });
      toast.success('Queue submitted');
    } catch (e: any) {
      toast.error(e?.shortMessage || 'Queue failed');
    }
  }

  async function handleExecute() {
    try {
      await writeContractAsync({
        address: NOUNV2_TREASURY_ADDRESS,
        abi: nounV2TreasuryAbi,
        functionName: 'execute',
        args: [BigInt(proposalId)],
      });
      toast.success('Execute submitted');
    } catch (e: any) {
      toast.error(e?.shortMessage || 'Execute failed');
    }
  }

  async function handleCancel() {
    try {
      await writeContractAsync({
        address: NOUNV2_TREASURY_ADDRESS,
        abi: nounV2TreasuryAbi,
        functionName: 'cancel',
        args: [BigInt(proposalId)],
      });
      toast.success('Cancelled');
    } catch (e: any) {
      toast.error(e?.shortMessage || 'Cancel failed');
    }
  }

  return (
    <div className={classes.container}>
      <Link to="/nounv2" className={classes.backLink}>
        &larr; All NounV2 Proposals
      </Link>

      <div className={classes.detailHeader}>
        <h1 className={classes.detailTitle}>Proposal #{proposalId}</h1>
        <span className={classes.detailStatus} style={{ color: label ? undefined : '#888' }}>
          {label}
        </span>
      </div>

      <h2 className={classes.detailName}>{title}</h2>
      <p className={classes.detailProposer}>
        by <ShortAddress address={proposer} />
      </p>

      {isActive && (
        <div className={classes.timeBar}>
          Voting ends in ~{hoursLeft.toFixed(1)} hours ({blocksLeft} blocks)
        </div>
      )}

      <div className={classes.voteSummary}>
        <span style={{ color: '#4ade80' }}>FOR {Number(forVotes)}</span>
        <span style={{ color: '#f87171' }}>AGAINST {Number(againstVotes)}</span>
        <span style={{ color: '#94a3b8' }}>ABSTAIN {Number(abstainVotes)}</span>
      </div>
      {totalVotes > 0 && (
        <div className={classes.voteBar}>
          <div className={classes.forBar} style={{ width: `${forPct}%` }} />
        </div>
      )}

      {grantTransactions.length > 0 && (
        <div className={classes.description} style={{ marginTop: '1.5rem', paddingTop: '1rem' }}>
          <h3>Requested Funds — {totalEth} ETH</h3>
          {grantTransactions.map((tx, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '0.5rem 0',
                borderBottom: '1px solid #e5e7eb',
                fontSize: '0.85rem',
              }}
            >
              <span style={{ fontFamily: 'monospace', color: '#555' }}>
                → {tx.target.slice(0, 6)}...{tx.target.slice(-4)}
                {tx.signature && (
                  <span style={{ marginLeft: 8, color: '#888' }}>{tx.signature}</span>
                )}
              </span>
              <span style={{ fontWeight: 700 }}>{formatEther(tx.value)} ETH</span>
            </div>
          ))}
        </div>
      )}

      <div className={classes.actions}>
        {isActive && userAddr && !hasVoted && (
          <div className={classes.votePanel}>
            <div className={classes.voteButtons}>
              {[1, 0, 2].map(s => (
                <button
                  key={s}
                  className={classes.voteBtn}
                  style={
                    support === s
                      ? { borderColor: supportColor(s), color: supportColor(s) }
                      : {}
                  }
                  onClick={() => setSupport(s)}
                >
                  {supportLabel(s)}
                </button>
              ))}
            </div>
            <textarea
              className={classes.reasonInput}
              placeholder="Reason (optional)"
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={2}
            />
            <button
              className={classes.submitVote}
              disabled={support === null || isPending || txMining}
              onClick={handleVote}
            >
              {isPending ? 'Signing...' : txMining ? 'Pending...' : 'Submit Vote'}
            </button>
          </div>
        )}
        {hasVoted && receipt && (
          <p className={classes.voted}>
            You voted {supportLabel(receipt.support)} with {Number(receipt.votes)} votes.
          </p>
        )}
        {isSucceeded && (
          <button className={classes.actionBtn} onClick={handleQueue} disabled={isPending}>
            Queue for Execution
          </button>
        )}
        {canExecute && (
          <button className={classes.actionBtn} onClick={handleExecute} disabled={isPending}>
            Execute Proposal
          </button>
        )}
        {canCancel && (
          <button className={classes.cancelBtn} onClick={handleCancel} disabled={isPending}>
            Cancel
          </button>
        )}
      </div>

      {body && (
        <div className={classes.description}>
          <h3>Description</h3>
          <pre className={classes.descBody}>{body}</pre>
        </div>
      )}
    </div>
  );
}
