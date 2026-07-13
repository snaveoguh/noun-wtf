/**
 * NounV2Proposals — Shows NounV2 governance proposals read directly from
 * the NounV2Treasury contract via wagmi's useReadContracts (mirrors the
 * listing pattern in /pages/NounV2/index.tsx). Rows deep-link to
 * /nounv2/:id for the native detail + voting view.
 *
 * When VITE_NOUNV2_TREASURY_ADDRESS is unset (zero address), renders a
 * stub instead of firing contract reads.
 */
import { FC, useMemo } from 'react';

import { Link } from 'react-router';
import { useBlockNumber, useReadContract, useReadContracts } from 'wagmi';

import ShortAddress from '@/components/ShortAddress';
import {
  NOUNV2_PROPOSAL_STATE_LABELS,
  NOUNV2_TREASURY_ADDRESS,
  NounV2ProposalState,
  nounV2TreasuryAbi,
} from '@/contracts/nounv2-treasury';
import FederationMirrors from '@/pages/Governance/FederationMirrors';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

function getTitle(desc: string): string {
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

const NounV2Proposals: FC = () => {
  const { data: blockNumber } = useBlockNumber({ watch: true });

  const treasuryConfigured = NOUNV2_TREASURY_ADDRESS !== ZERO_ADDRESS;

  const { data: proposalCountData } = useReadContract({
    address: NOUNV2_TREASURY_ADDRESS,
    abi: nounV2TreasuryAbi,
    functionName: 'proposalCount',
    query: {
      enabled: treasuryConfigured,
      refetchInterval: 30_000,
    },
  });
  const proposalCount = proposalCountData != null ? Number(proposalCountData) : 0;

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
    query: { enabled: treasuryConfigured && proposalCount > 0, refetchInterval: 30_000 },
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
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '0 20px 60px' }}>
      {/* Header */}
      <div style={{ padding: '24px 0 16px' }}>
        <span
          style={{ color: '#8c8d92', fontSize: '1.2rem', fontFamily: "'Londrina Solid', cursive" }}
        >
          Governance
        </span>
        <h1
          style={{
            fontSize: '2.5rem',
            fontFamily: "'Londrina Solid', cursive",
            color: '#14141f',
            margin: '4px 0 8px',
            fontWeight: 400,
          }}
        >
          Nouns DAO V2
        </h1>
        <p
          style={{
            color: '#666',
            fontFamily: "'PT Root UI', sans-serif",
            fontSize: '0.95rem',
            margin: '0 0 16px',
          }}
        >
          NounV2 is a Nouns fork with no-reserve auctions. Governance is a single-contract governor
          + treasury; proposals require 1 NounV2 voting unit, pass after a ~12h vote, and execute
          after a 12h timelock.
        </p>
        {treasuryConfigured && (
          <Link
            to="/nounv2/create"
            style={{
              display: 'inline-block',
              padding: '8px 16px',
              borderRadius: 8,
              background: '#14141f',
              color: '#fff',
              textDecoration: 'none',
              fontFamily: "'PT Root UI', sans-serif",
              fontSize: '0.85rem',
              fontWeight: 700,
            }}
          >
            + New Proposal
          </Link>
        )}
      </div>

      {/* Federation: NounV2 → V1 meta-governance mirrors (hidden until deployed). */}
      <FederationMirrors />

      {!treasuryConfigured && (
        <div
          style={{
            padding: '20px',
            borderRadius: 12,
            background: '#fef3c7',
            border: '1px solid #fbbf24',
            color: '#92400e',
            fontFamily: "'PT Root UI', sans-serif",
            fontSize: '0.9rem',
            lineHeight: 1.5,
          }}
        >
          <strong>NounV2 not configured.</strong> Set <code>VITE_NOUNV2_TREASURY_ADDRESS</code> in
          your env after deploy — proposals will appear here once the contract address is wired up.
        </div>
      )}

      {treasuryConfigured && proposalCount === 0 && (
        <div
          style={{
            textAlign: 'center',
            padding: '40px',
            color: '#8c8d92',
            fontSize: '0.85rem',
          }}
        >
          No proposals yet. Holders with &gt;= 1 NounV2 can open the first one.
        </div>
      )}

      {treasuryConfigured && proposals.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {proposals.map(p => {
            const title = getTitle(p.description);
            const label = NOUNV2_PROPOSAL_STATE_LABELS[p.state];
            const color = statusColor(label);
            const totalVotes = Number(p.forVotes) + Number(p.againstVotes);
            const forPct = totalVotes > 0 ? (Number(p.forVotes) / totalVotes) * 100 : 0;
            const isActive = p.state === NounV2ProposalState.Active;
            const blocksLeft =
              isActive && blockNumber != null ? Number(p.endBlock - (blockNumber ?? 0n)) : 0;
            const hoursLeft = Math.max(0, (blocksLeft * 12) / 3600);

            return (
              <Link
                key={p.id}
                to={`/nounv2/${p.id}`}
                style={{
                  display: 'block',
                  padding: '16px 20px',
                  borderRadius: 16,
                  border: '1px solid #e2e3e8',
                  textDecoration: 'none',
                  color: 'inherit',
                  transition: 'border-color 0.15s',
                }}
                onMouseEnter={e => (e.currentTarget.style.borderColor = '#dc2626')}
                onMouseLeave={e => (e.currentTarget.style.borderColor = '#e2e3e8')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                  <span
                    style={{
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 6,
                      background: color + '20',
                      color,
                    }}
                  >
                    {label}
                    {isActive && blockNumber != null && ` (${hoursLeft.toFixed(1)}h)`}
                  </span>
                  <span style={{ color: '#8c8d92', fontSize: '0.75rem' }}>#{p.id}</span>
                  <span style={{ color: '#8c8d92', fontSize: '0.7rem', marginLeft: 'auto' }}>
                    View →
                  </span>
                </div>

                <div
                  style={{
                    fontSize: '1rem',
                    fontWeight: 700,
                    fontFamily: "'PT Root UI', sans-serif",
                    marginBottom: 8,
                    lineHeight: 1.3,
                  }}
                >
                  {title}
                </div>

                <div
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    fontSize: '0.75rem',
                    color: '#8c8d92',
                    marginBottom: totalVotes > 0 ? 8 : 0,
                  }}
                >
                  <span>
                    by <ShortAddress address={p.proposer} />
                  </span>
                </div>

                {totalVotes > 0 && (
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    <div
                      style={{
                        flex: 1,
                        height: 6,
                        borderRadius: 3,
                        background: '#f4f4f8',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${forPct}%`,
                          height: '100%',
                          borderRadius: 3,
                          background: '#43b369',
                        }}
                      />
                    </div>
                    <span style={{ fontSize: '0.65rem', color: '#8c8d92', whiteSpace: 'nowrap' }}>
                      {Number(p.forVotes)} for · {Number(p.againstVotes)} against
                    </span>
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default NounV2Proposals;
