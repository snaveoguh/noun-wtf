/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from 'react';

import { Link } from 'react-router';
import { toast } from 'sonner';
import { formatEther, parseEther } from 'viem';
import {
  useAccount,
  useBalance,
  useBlockNumber,
  useReadContract,
  useReadContracts,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi';

import ShortAddress from '@/components/ShortAddress';
import {
  NOUNV2_AUCTION_HOUSE_ADDRESS,
  nounV2AuctionHouseAbi,
} from '@/contracts/nounv2-auction-house';
import {
  NOUNV2_PROPOSAL_STATE_LABELS,
  NOUNV2_TREASURY_ADDRESS,
  NounV2ProposalState,
  nounV2TreasuryAbi,
} from '@/contracts/nounv2-treasury';

import classes from './NounV2.module.css';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

function getTitle(desc: string) {
  return (desc.split('\n')[0] || '').replace(/^#\s*/, '').slice(0, 80) || 'Untitled';
}

function statusColor(label: string): string {
  switch (label) {
    case 'ACTIVE':
      return '#dc2626';
    case 'SUCCEEDED':
      return '#16a34a';
    case 'QUEUED':
      return '#f59e0b';
    case 'EXECUTED':
      return '#4ade80';
    case 'DEFEATED':
      return '#f87171';
    case 'CANCELED':
    case 'EXPIRED':
      return '#94a3b8';
    default:
      return '#666';
  }
}

function formatSecondsLeft(sec: number): string {
  if (sec <= 0) return 'ended';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${sec % 60}s`;
}

export default function NounV2Page() {
  const { address: userAddr } = useAccount();
  const { data: blockNumber } = useBlockNumber({ watch: true });

  const addressesMissing =
    NOUNV2_AUCTION_HOUSE_ADDRESS === ZERO_ADDRESS ||
    NOUNV2_TREASURY_ADDRESS === ZERO_ADDRESS;

  const { data: balance } = useBalance({
    address: NOUNV2_TREASURY_ADDRESS,
    query: { enabled: NOUNV2_TREASURY_ADDRESS !== ZERO_ADDRESS },
  });
  const treasuryEth = balance ? formatEther(balance.value) : '0';

  // ─── Active auction ─────────────────────────────────────────────
  const {
    data: auctionData,
    refetch: refetchAuction,
  } = useReadContract({
    address: NOUNV2_AUCTION_HOUSE_ADDRESS,
    abi: nounV2AuctionHouseAbi,
    functionName: 'auction',
    query: {
      enabled: NOUNV2_AUCTION_HOUSE_ADDRESS !== ZERO_ADDRESS,
      refetchInterval: 12_000,
    },
  });

  const { data: minBidIncrementPercentage } = useReadContract({
    address: NOUNV2_AUCTION_HOUSE_ADDRESS,
    abi: nounV2AuctionHouseAbi,
    functionName: 'minBidIncrementPercentage',
    query: { enabled: NOUNV2_AUCTION_HOUSE_ADDRESS !== ZERO_ADDRESS },
  });

  const { data: reservePrice } = useReadContract({
    address: NOUNV2_AUCTION_HOUSE_ADDRESS,
    abi: nounV2AuctionHouseAbi,
    functionName: 'reservePrice',
    query: { enabled: NOUNV2_AUCTION_HOUSE_ADDRESS !== ZERO_ADDRESS },
  });

  const auction = auctionData as
    | readonly [bigint, bigint, bigint, bigint, `0x${string}`, boolean]
    | undefined;

  const [nounId, bidAmount, _startTime, endTime, bidder, settled] = auction ?? [];

  const now = Math.floor(Date.now() / 1000);
  const secondsLeft = endTime != null ? Number(endTime) - now : 0;
  const auctionEnded = auction ? secondsLeft <= 0 : false;

  // Minimum next bid = currentBid + increment %, or reservePrice if no bids yet
  const minNextBid = useMemo(() => {
    if (!auction) return 0n;
    const inc = minBidIncrementPercentage ?? 2n;
    if (bidAmount === 0n) return reservePrice ?? 1n;
    return (bidAmount ?? 0n) + ((bidAmount ?? 0n) * BigInt(inc)) / 100n;
  }, [auction, bidAmount, minBidIncrementPercentage, reservePrice]);

  // ─── Bid form ────────────────────────────────────────────────────
  const [bidInput, setBidInput] = useState('');
  const {
    writeContractAsync,
    data: txHash,
    isPending,
    reset: resetWrite,
  } = useWriteContract();
  const { isSuccess: txConfirmed } = useWaitForTransactionReceipt({ hash: txHash });

  useEffect(() => {
    if (txConfirmed) {
      void refetchAuction();
      setBidInput('');
      resetWrite();
    }
  }, [txConfirmed, refetchAuction, resetWrite]);

  async function handleBid() {
    if (!userAddr) {
      toast.error('Connect your wallet first');
      return;
    }
    if (nounId == null) return;
    const amtStr = bidInput.trim();
    if (!amtStr) {
      toast.error('Enter a bid amount');
      return;
    }
    let value: bigint;
    try {
      value = parseEther(amtStr);
    } catch {
      toast.error('Invalid ETH amount');
      return;
    }
    if (value < minNextBid) {
      toast.error(`Min bid is ${formatEther(minNextBid)} ETH`);
      return;
    }
    try {
      await writeContractAsync({
        address: NOUNV2_AUCTION_HOUSE_ADDRESS,
        abi: nounV2AuctionHouseAbi,
        functionName: 'createBid',
        args: [nounId],
        value,
      });
      toast.success('Bid submitted');
    } catch (e: any) {
      toast.error(e?.shortMessage || 'Bid failed');
    }
  }

  async function handleSettle() {
    try {
      await writeContractAsync({
        address: NOUNV2_AUCTION_HOUSE_ADDRESS,
        abi: nounV2AuctionHouseAbi,
        functionName: 'settleCurrentAndCreateNewAuction',
      });
      toast.success('Settlement submitted');
    } catch (e: any) {
      toast.error(e?.shortMessage || 'Settle failed');
    }
  }

  // ─── Proposal list (read directly from contract — no indexer yet) ─
  const { data: proposalCountData } = useReadContract({
    address: NOUNV2_TREASURY_ADDRESS,
    abi: nounV2TreasuryAbi,
    functionName: 'proposalCount',
    query: {
      enabled: NOUNV2_TREASURY_ADDRESS !== ZERO_ADDRESS,
      refetchInterval: 30_000,
    },
  });
  const proposalCount = proposalCountData != null ? Number(proposalCountData) : 0;

  // Build one [state + proposal + description] triple per proposal.
  const proposalIds = useMemo(
    () => Array.from({ length: proposalCount }, (_, i) => BigInt(i + 1)),
    [proposalCount],
  );

  const { data: proposalReads } = useReadContracts({
    contracts: proposalIds.flatMap(id => [
      {
        address: NOUNV2_TREASURY_ADDRESS,
        abi: nounV2TreasuryAbi,
        functionName: 'state' as const,
        args: [id] as const,
      },
      {
        address: NOUNV2_TREASURY_ADDRESS,
        abi: nounV2TreasuryAbi,
        functionName: 'proposals' as const,
        args: [id] as const,
      },
      {
        address: NOUNV2_TREASURY_ADDRESS,
        abi: nounV2TreasuryAbi,
        functionName: 'getDescription' as const,
        args: [id] as const,
      },
    ]),
    query: { enabled: proposalCount > 0, refetchInterval: 30_000 },
  });

  const proposals = useMemo(() => {
    if (!proposalReads) return [];
    const out: Array<{
      id: number;
      state: NounV2ProposalState;
      proposer: `0x${string}`;
      forVotes: bigint;
      againstVotes: bigint;
      abstainVotes: bigint;
      startBlock: bigint;
      endBlock: bigint;
      description: string;
    }> = [];
    for (let i = 0; i < proposalIds.length; i++) {
      const stateRes = proposalReads[i * 3];
      const propRes = proposalReads[i * 3 + 1];
      const descRes = proposalReads[i * 3 + 2];
      if (
        stateRes?.status !== 'success' ||
        propRes?.status !== 'success' ||
        descRes?.status !== 'success'
      ) {
        continue;
      }
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
      out.push({
        id: Number(proposalIds[i]),
        state: Number(stateRes.result) as NounV2ProposalState,
        proposer: prop[0],
        startBlock: prop[2],
        endBlock: prop[3],
        forVotes: prop[5],
        againstVotes: prop[6],
        abstainVotes: prop[7],
        description: descRes.result as string,
      });
    }
    return out.reverse(); // newest first
  }, [proposalReads, proposalIds]);

  return (
    <div className={classes.container}>
      {addressesMissing && (
        <div className={classes.missingAddress}>
          <strong>NounV2 contracts not yet deployed.</strong> Set{' '}
          <code>VITE_NOUNV2_AUCTION_HOUSE_ADDRESS</code> and{' '}
          <code>VITE_NOUNV2_TREASURY_ADDRESS</code> in your env after deploy — the UI is live but
          all reads/writes are no-ops until then.
        </div>
      )}

      <div className={classes.header}>
        <div className={classes.titleRow}>
          <h1 className={classes.title}>NounV2</h1>
          <span className={classes.badge}>NEW</span>
          {balance && <span className={classes.treasury}>{parseFloat(treasuryEth).toFixed(4)} ETH</span>}
        </div>
        <p className={classes.subtitle}>
          A Nouns fork with no-reserve auctions. Proceeds route to a beneficiary. Governance is a
          single-contract governor + treasury; proposals require 1 NounV2 voting unit, pass after a
          ~12h vote, and execute after a 12h timelock.
        </p>
      </div>

      {/* ─── Active auction ──────────────────────────────────── */}
      {auction && (
        <div className={classes.auctionCard}>
          <div className={classes.auctionHeader}>
            <span className={classes.auctionLabel}>Live Auction</span>
            <span style={{ color: statusColor(settled === true ? 'EXECUTED' : 'ACTIVE') }}>
              {settled === true ? 'SETTLED' : auctionEnded ? 'ENDED — AWAITING SETTLE' : 'ACTIVE'}
            </span>
          </div>
          <h2 className={classes.auctionNoun}>
            NounV2 #{nounId != null ? nounId.toString() : '—'}
          </h2>

          <div className={classes.auctionStats}>
            <div>
              <div className={classes.auctionStatLabel}>Current Bid</div>
              <div className={classes.auctionStatValue}>
                {bidAmount != null ? formatEther(bidAmount) : '0'} ETH
              </div>
            </div>
            <div>
              <div className={classes.auctionStatLabel}>
                {auctionEnded ? 'Status' : 'Ends in'}
              </div>
              <div className={classes.auctionStatValue}>
                {auctionEnded ? 'Ended' : formatSecondsLeft(secondsLeft)}
              </div>
            </div>
            <div>
              <div className={classes.auctionStatLabel}>Top Bidder</div>
              <div className={classes.auctionStatValue}>
                {bidder && bidder !== ZERO_ADDRESS ? (
                  <ShortAddress address={bidder} />
                ) : (
                  <span style={{ color: '#aaa' }}>none</span>
                )}
              </div>
            </div>
            <div>
              <div className={classes.auctionStatLabel}>Min Next Bid</div>
              <div className={classes.auctionStatValue}>
                {formatEther(minNextBid)} ETH
              </div>
            </div>
          </div>

          {!auctionEnded && settled !== true && (
            <>
              <div className={classes.auctionBidRow}>
                <input
                  className={classes.auctionBidInput}
                  placeholder={`Min ${formatEther(minNextBid)} ETH`}
                  value={bidInput}
                  onChange={e => setBidInput(e.target.value)}
                  type="number"
                  step="0.001"
                  min="0"
                />
                <button
                  className={classes.auctionBidBtn}
                  onClick={handleBid}
                  disabled={isPending || !userAddr}
                >
                  {isPending ? 'Signing...' : userAddr ? 'Bid' : 'Connect Wallet'}
                </button>
              </div>
              {!userAddr && (
                <p className={classes.connectHint}>Connect your wallet to place a bid.</p>
              )}
            </>
          )}

          {auctionEnded && settled !== true && (
            <button
              className={classes.settleBtn}
              onClick={handleSettle}
              disabled={isPending || !userAddr}
            >
              {isPending ? 'Settling...' : 'Settle & Start Next'}
            </button>
          )}
        </div>
      )}

      {/* ─── Proposal list ───────────────────────────────────── */}
      <div className={classes.sectionTitle}>
        Governance ({proposalCount} {proposalCount === 1 ? 'proposal' : 'proposals'})
        <Link
          to="/nounv2/create"
          className={classes.createBtn}
          style={{ float: 'right', marginTop: -4 }}
        >
          + New Proposal
        </Link>
      </div>

      {proposalCount === 0 && (
        <div className={classes.empty}>
          <p>No proposals yet. Holders with {'>'}= 1 NounV2 can open the first one.</p>
        </div>
      )}

      <div className={classes.list}>
        {proposals.map(p => {
          const title = getTitle(p.description);
          const label = NOUNV2_PROPOSAL_STATE_LABELS[p.state];
          const totalVotes = Number(p.forVotes) + Number(p.againstVotes);
          const forPct = totalVotes > 0 ? (Number(p.forVotes) / totalVotes) * 100 : 50;
          const isActive = p.state === NounV2ProposalState.Active;
          const blocksLeft =
            isActive && blockNumber != null
              ? Number(p.endBlock - (blockNumber ?? 0n))
              : 0;
          const hoursLeft = Math.max(0, (blocksLeft * 12) / 3600);

          return (
            <Link key={p.id} to={`/nounv2/${p.id}`} className={classes.card}>
              <div className={classes.cardHeader}>
                <span className={classes.proposalId}>Proposal #{p.id}</span>
                <span className={classes.status} style={{ color: statusColor(label) }}>
                  {label}
                  {isActive && blockNumber != null && ` (${hoursLeft.toFixed(1)}h left)`}
                </span>
              </div>
              <div className={classes.cardTitle}>{title}</div>
              <div className={classes.cardMeta}>
                <span>
                  by <ShortAddress address={p.proposer} />
                </span>
                <span>
                  {Number(p.forVotes)} FOR / {Number(p.againstVotes)} AGAINST
                </span>
              </div>
              {totalVotes > 0 && (
                <div className={classes.voteBar}>
                  <div className={classes.forBar} style={{ width: `${forPct}%` }} />
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
