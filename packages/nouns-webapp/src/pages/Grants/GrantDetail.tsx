/* eslint-disable @typescript-eslint/strict-boolean-expressions, @typescript-eslint/no-explicit-any, react/no-unescaped-entities */
import { useEffect, useState } from 'react';

import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { formatEther } from 'viem';
import {
  useAccount,
  useBlockNumber,
  useReadContract,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi';

import ShortAddress from '@/components/ShortAddress';
import {
  smallGrantsTreasuryAbi,
  SMALL_GRANTS_TREASURY_ADDRESS,
} from '@/contracts/small-grants-treasury';

import classes from './Grants.module.css';

const RELAYER_ADDRESS = '0xacc74b39976d50522621f54c18dc85e2822ec22c';

const API_BASE = (
  (import.meta.env.VITE_MAINNET_SUBGRAPH as string | undefined) ??
  'https://spirited-flexibility-production-3c30.up.railway.app'
).replace(/\/graphql\/?$/, '');

interface GrantData {
  id: number;
  proposer: string;
  signer: string | null;
  description: string;
  status: string;
  forVotes: number;
  againstVotes: number;
  abstainVotes: number;
  startBlock: string;
  endBlock: string;
  executionETA: string | null;
  createdAt: string;
  createdAtTransaction: string;
}

interface GrantVote {
  voter: string;
  support: number;
  votes: number;
  reason: string;
}

function supportLabel(s: number) {
  return s === 0 ? 'AGAINST' : s === 1 ? 'FOR' : 'ABSTAIN';
}

function supportColor(s: number) {
  return s === 0 ? '#f87171' : s === 1 ? '#4ade80' : '#94a3b8';
}

export default function GrantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const grantId = parseInt(id || '0');
  const { address: userAddr } = useAccount();
  const { data: blockNumber } = useBlockNumber({ watch: true });

  const [grant, setGrant] = useState<GrantData | null>(null);
  const [votes, setVotes] = useState<GrantVote[]>([]);
  const [statusChanges, setStatusChanges] = useState<
    Array<{ status: string; createdAtBlock: string; createdAtTransaction: string }>
  >([]);
  const [loading, setLoading] = useState(true);

  // Vote form state
  const [support, setSupport] = useState<number | null>(null);
  const [reason, setReason] = useState('');

  const { writeContractAsync, data: txHash, isPending, error: writeError } = useWriteContract();
  const {
    isSuccess: txConfirmed,
    isLoading: txMining,
    isError: txFailed,
  } = useWaitForTransactionReceipt({ hash: txHash });

  // Vote lifecycle: idle → signing → mining → confirmed / failed
  type VoteStatus = 'idle' | 'signing' | 'mining' | 'confirmed' | 'failed';
  const voteStatus: VoteStatus = txConfirmed
    ? 'confirmed'
    : txFailed
      ? 'failed'
      : txMining
        ? 'mining'
        : isPending
          ? 'signing'
          : writeError
            ? 'failed'
            : 'idle';

  // Read grant actions (transactions) directly from contract
  const { data: actions } = useReadContract({
    address: SMALL_GRANTS_TREASURY_ADDRESS,
    abi: smallGrantsTreasuryAbi,
    functionName: 'getActions',
    args: grantId ? [BigInt(grantId)] : undefined,
    query: { enabled: !!grantId },
  });

  // Parse actions into readable format
  const grantTransactions = actions
    ? (actions as [string[], bigint[], string[], string[]])[0].map((target, i) => ({
        target,
        value: (actions as [string[], bigint[], string[], string[]])[1][i],
        signature: (actions as [string[], bigint[], string[], string[]])[2][i],
        calldata: (actions as [string[], bigint[], string[], string[]])[3][i],
      }))
    : [];

  const totalEthRequested = grantTransactions.reduce(
    (sum, tx) => sum + Number(formatEther(tx.value as bigint)),
    0,
  );

  useEffect(() => {
    toast.error('Noun Grants is experimental. Unaudited contract — use at your own risk.', {
      duration: 8000,
      id: 'grants-risk-warning',
    });
  }, []);

  // Fetch grant data from REST endpoint (bypasses GraphQL truncation, status pre-computed)
  useEffect(() => {
    if (!grantId) return;
    fetch(`${API_BASE}/api/grants/${grantId}`)
      .then(r => r.json())
      .then(d => {
        if (d.grant) {
          const g = d.grant;
          setGrant({
            id: Number(g.id),
            proposer: g.proposer,
            signer: g.signer ?? null,
            description: g.description,
            status: g.status,
            forVotes: Number(g.forVotes),
            againstVotes: Number(g.againstVotes),
            abstainVotes: Number(g.abstainVotes),
            startBlock: String(g.startBlock),
            endBlock: String(g.endBlock),
            executionETA: g.executionETA ? String(g.executionETA) : null,
            createdAt: g.createdAt,
            createdAtTransaction: g.createdAtTransaction || '',
          });
        }
        if (d.votes) {
          setVotes(d.votes);
        }
        if (d.statusChanges) {
          setStatusChanges(d.statusChanges);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [grantId, txConfirmed]);

  async function handleVote() {
    if (support === null) return;
    try {
      if (reason) {
        await writeContractAsync({
          address: SMALL_GRANTS_TREASURY_ADDRESS,
          abi: smallGrantsTreasuryAbi,
          functionName: 'castVoteWithReason',
          args: [BigInt(grantId), support, reason],
        });
      } else {
        await writeContractAsync({
          address: SMALL_GRANTS_TREASURY_ADDRESS,
          abi: smallGrantsTreasuryAbi,
          functionName: 'castVote',
          args: [BigInt(grantId), support],
        });
      }
      toast.success(
        <span>
          Vote submitted!{' '}
          {txHash && (
            <a
              href={`https://etherscan.io/tx/${txHash}`}
              target="_blank"
              rel="noreferrer"
              style={{ color: '#00ff41' }}
            >
              View TX →
            </a>
          )}
        </span>,
        { duration: 10000 },
      );
    } catch (e: any) {
      toast.error(e?.shortMessage || 'Vote failed');
    }
  }

  async function handleQueue() {
    try {
      const hash = await writeContractAsync({
        address: SMALL_GRANTS_TREASURY_ADDRESS,
        abi: smallGrantsTreasuryAbi,
        functionName: 'queue',
        args: [BigInt(grantId)],
      });
      toast.success(
        <span>
          Grant queued!{' '}
          <a
            href={`https://etherscan.io/tx/${hash}`}
            target="_blank"
            rel="noreferrer"
            style={{ color: '#00ff41' }}
          >
            View TX →
          </a>
        </span>,
        { duration: 10000 },
      );
    } catch (e: any) {
      toast.error(e?.shortMessage || 'Queue failed');
    }
  }

  async function handleExecute() {
    try {
      const hash = await writeContractAsync({
        address: SMALL_GRANTS_TREASURY_ADDRESS,
        abi: smallGrantsTreasuryAbi,
        functionName: 'execute',
        args: [BigInt(grantId)],
      });
      toast.success(
        <span>
          Grant executed!{' '}
          <a
            href={`https://etherscan.io/tx/${hash}`}
            target="_blank"
            rel="noreferrer"
            style={{ color: '#00ff41' }}
          >
            View TX →
          </a>
        </span>,
        { duration: 10000 },
      );
    } catch (e: any) {
      toast.error(e?.shortMessage || 'Execution failed');
    }
  }

  async function handleCancel() {
    try {
      const hash = await writeContractAsync({
        address: SMALL_GRANTS_TREASURY_ADDRESS,
        abi: smallGrantsTreasuryAbi,
        functionName: 'cancel',
        args: [BigInt(grantId)],
      });
      toast.success(
        <span>
          Grant cancelled.{' '}
          <a
            href={`https://etherscan.io/tx/${hash}`}
            target="_blank"
            rel="noreferrer"
            style={{ color: '#ff4444' }}
          >
            View TX →
          </a>
        </span>,
        { duration: 10000 },
      );
    } catch (e: any) {
      toast.error(e?.shortMessage || 'Cancel failed');
    }
  }

  if (loading)
    return (
      <div className={classes.container}>
        <p className={classes.loading}>Loading grant...</p>
      </div>
    );
  if (!grant)
    return (
      <div className={classes.container}>
        <p>Grant #{grantId} not found</p>
      </div>
    );

  const title =
    (grant.description.split('\n')[0] || '').replace(/^#\s*/, '').slice(0, 120) || 'Untitled';
  const body = grant.description.split('\n').slice(1).join('\n').trim();
  const totalVotes = grant.forVotes + grant.againstVotes;
  const forPct = totalVotes > 0 ? (grant.forVotes / totalVotes) * 100 : 50;
  // Status is computed server-side (DEFEATED/SUCCEEDED derived from endBlock + vote tallies)
  const isActive = grant.status === 'ACTIVE';
  const isSucceeded = grant.status === 'SUCCEEDED';
  const isDefeated = grant.status === 'DEFEATED';
  const isQueued = grant.status === 'QUEUED';
  const canExecute =
    isQueued && grant.executionETA && Date.now() / 1000 >= parseInt(grant.executionETA);
  const isProposer =
    userAddr?.toLowerCase() === grant.proposer.toLowerCase() ||
    userAddr?.toLowerCase() === grant.signer?.toLowerCase();
  const hasVoted = votes.some(v => v.voter.toLowerCase() === userAddr?.toLowerCase());

  const blocksLeft = isActive ? Number(BigInt(grant.endBlock) - blockNumber!) : 0;
  const hoursLeft = Math.max(0, (blocksLeft * 12) / 3600);

  return (
    <div className={classes.container}>
      <Link to="/grants" className={classes.backLink}>
        &larr; All Grants
      </Link>

      <div className={classes.detailHeader}>
        <h1 className={classes.detailTitle}>Grant #{grant.id}</h1>
        <span
          className={classes.detailStatus}
          style={{ color: isSucceeded ? '#34d399' : isDefeated ? '#ef4444' : undefined }}
        >
          {grant.status}
        </span>
      </div>

      <h2 className={classes.detailName}>{title}</h2>
      <p className={classes.detailProposer}>
        {grant.proposer.toLowerCase() === RELAYER_ADDRESS ? (
          grant.signer ? (
            <>
              by <ShortAddress address={grant.signer as `0x${string}`} />
              <span style={{ color: '#6b7280', fontSize: '0.8rem', marginLeft: '0.4rem' }}>
                (GASLESS VIA NOUNIRL)
              </span>
            </>
          ) : (
            <span style={{ color: '#6b7280', fontSize: '0.8rem' }}>
              GASLESS VIA NOUNIRL
            </span>
          )
        ) : (
          <>by <ShortAddress address={grant.proposer as `0x${string}`} /></>
        )}
      </p>

      {isActive && (
        <div className={classes.timeBar}>
          Voting ends in ~{hoursLeft.toFixed(1)} hours ({blocksLeft} blocks)
        </div>
      )}

      {/* Vote Counts */}
      <div className={classes.voteSummary}>
        <span style={{ color: '#4ade80' }}>FOR {grant.forVotes}</span>
        <span style={{ color: '#f87171' }}>AGAINST {grant.againstVotes}</span>
        <span style={{ color: '#94a3b8' }}>ABSTAIN {grant.abstainVotes}</span>
      </div>
      {totalVotes > 0 && (
        <div className={classes.voteBar}>
          <div className={classes.forBar} style={{ width: `${forPct}%` }} />
        </div>
      )}

      {/* Requested Funds */}
      {grantTransactions.length > 0 && (
        <div className={classes.description} style={{ marginTop: '1.5rem', paddingTop: '1rem' }}>
          <h3>Requested Funds — {totalEthRequested} ETH</h3>
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
              </span>
              <span style={{ fontWeight: 700 }}>{formatEther(tx.value as bigint)} ETH</span>
            </div>
          ))}
        </div>
      )}

      {/* Action Buttons */}
      <div className={classes.actions}>
        {isActive && userAddr && !hasVoted && (
          <div className={classes.votePanel}>
            <div className={classes.voteButtons}>
              {[1, 0, 2].map(s => (
                <button
                  key={s}
                  className={`${classes.voteBtn} ${support === s ? classes.voteBtnActive : ''}`}
                  style={
                    support === s ? { borderColor: supportColor(s), color: supportColor(s) } : {}
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
              disabled={support === null || isPending || voteStatus === 'mining'}
              onClick={handleVote}
            >
              {isPending ? 'Signing...' : voteStatus === 'mining' ? 'Pending...' : 'Submit Vote'}
            </button>
            {voteStatus !== 'idle' && (
              <div className={classes.voteStatusBar} data-status={voteStatus}>
                <span className={classes.voteStatusDot} />
                <span className={classes.voteStatusText}>
                  {voteStatus === 'signing' && 'Waiting for wallet signature...'}
                  {voteStatus === 'mining' && 'Transaction pending — confirming onchain...'}
                  {voteStatus === 'confirmed' && 'Vote cast successfully'}
                  {voteStatus === 'failed' &&
                    (writeError?.message?.includes('User rejected') ||
                    writeError?.message?.includes('User denied')
                      ? 'Transaction rejected by wallet'
                      : 'Vote failed — try again')}
                </span>
                {txHash && (
                  <a
                    href={`https://etherscan.io/tx/${txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    className={classes.voteStatusTx}
                  >
                    {txHash.slice(0, 10)}...
                  </a>
                )}
              </div>
            )}
          </div>
        )}
        {hasVoted && <p className={classes.voted}>You already voted on this grant.</p>}
        {isSucceeded && (
          <button className={classes.actionBtn} onClick={handleQueue} disabled={isPending}>
            Queue for Execution
          </button>
        )}
        {canExecute && (
          <button className={classes.actionBtn} onClick={handleExecute} disabled={isPending}>
            Execute Grant
          </button>
        )}
        {isProposer && !grant.status.match(/EXECUTED|CANCELED/) && (
          <button className={classes.cancelBtn} onClick={handleCancel} disabled={isPending}>
            Cancel
          </button>
        )}
      </div>

      {/* Description */}
      {body && (
        <div className={classes.description}>
          <h3>Description</h3>
          <pre className={classes.descBody}>{body}</pre>
        </div>
      )}

      {/* Votes */}
      {votes.length > 0 && (
        <div className={classes.votesList}>
          <h3>Votes ({votes.length})</h3>
          {votes.map((v, i) => (
            <div key={i} className={classes.voteRow}>
              <span>
                <ShortAddress address={v.voter as `0x${string}`} />
              </span>
              <span style={{ color: supportColor(v.support) }}>{supportLabel(v.support)}</span>
              <span>{v.votes} votes</span>
              {v.reason && <span className={classes.voteReason}>"{v.reason}"</span>}
              {(v as any).createdAtTransaction && (
                <a
                  href={`https://etherscan.io/tx/${(v as any).createdAtTransaction}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ fontSize: '0.7rem', color: '#666', marginLeft: 8 }}
                >
                  tx
                </a>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Transaction History */}
      {(statusChanges.length > 0 || grant.createdAtTransaction) && (
        <div className={classes.votesList} style={{ marginTop: 16 }}>
          <h3>Transaction History</h3>
          {grant.createdAtTransaction && (
            <div className={classes.voteRow}>
              <span style={{ color: '#60a5fa' }}>CREATED</span>
              <a
                href={`https://etherscan.io/tx/${grant.createdAtTransaction}`}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: '0.75rem', color: '#888', fontFamily: 'monospace' }}
              >
                {grant.createdAtTransaction.slice(0, 18)}...
              </a>
            </div>
          )}
          {statusChanges.map((sc, i) => (
            <div key={i} className={classes.voteRow}>
              <span
                style={{
                  color:
                    sc.status === 'EXECUTED'
                      ? '#4ade80'
                      : sc.status === 'CANCELED'
                        ? '#f87171'
                        : sc.status === 'QUEUED'
                          ? '#fbbf24'
                          : '#94a3b8',
                }}
              >
                {sc.status}
              </span>
              <a
                href={`https://etherscan.io/tx/${sc.createdAtTransaction}`}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: '0.75rem', color: '#888', fontFamily: 'monospace' }}
              >
                {sc.createdAtTransaction.slice(0, 18)}...
              </a>
            </div>
          ))}
        </div>
      )}

      {txHash && voteStatus === 'idle' && (
        <p className={classes.txLink}>
          TX:{' '}
          <a href={`https://etherscan.io/tx/${txHash}`} target="_blank" rel="noreferrer">
            {txHash.slice(0, 16)}...
          </a>
        </p>
      )}
    </div>
  );
}
