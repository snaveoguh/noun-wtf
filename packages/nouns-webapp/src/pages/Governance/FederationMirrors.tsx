/**
 * FederationMirrors — NounV2 → V1 meta-governance.
 *
 * Lists live "mirrors" of V1 proposals from the NounsFederation contract and
 * lets connected NounV2 holders vote on how the V1 voting power delegated to
 * the federation should be cast. Reads directly from the contract via wagmi
 * (mirrors the NounV2Proposals listing pattern) so it works without the
 * indexer. Once a mirror's window closes, anyone can relay the aggregated
 * tally to V1 — the result column reflects what was (or will be) cast.
 *
 * When VITE_NOUNS_FEDERATION_ADDRESS is unset (zero address), renders nothing.
 */
import { CSSProperties, FC, useMemo, useState } from 'react';

import { Link } from 'react-router';
import {
  useAccount,
  useBlockNumber,
  useReadContract,
  useReadContracts,
  useWriteContract,
} from 'wagmi';

import {
  FederationSupport,
  NOUNS_FEDERATION_ADDRESS,
  isFederationConfigured,
  nounsFederationAbi,
} from '@/contracts/nouns-federation';

interface MirrorRow {
  id: number;
  v1ProposalId: number;
  snapshotBlock: bigint;
  endBlock: bigint;
  forVotes: bigint;
  againstVotes: bigint;
  abstainVotes: bigint;
  relayed: boolean;
  relayedSupport: number;
}

const SUPPORT_LABEL = ['Against', 'For', 'Abstain'] as const;

function mirrorStatus(m: MirrorRow, currentBlock: bigint | undefined): string {
  if (m.relayed) return 'RELAYED';
  if (currentBlock != null && currentBlock <= m.endBlock) return 'VOTING';
  return 'CLOSED';
}

function statusColor(label: string): string {
  switch (label) {
    case 'VOTING':
      return '#dc2626';
    case 'RELAYED':
      return '#16a34a';
    case 'CLOSED':
      return '#f59e0b';
    default:
      return '#666';
  }
}

/** Deterministic direction preview from the current tally (matches contract). */
function tallyDirection(m: MirrorRow): string {
  const total = m.forVotes + m.againstVotes + m.abstainVotes;
  if (total === 0n) return '—';
  if (m.forVotes > m.againstVotes) return 'For';
  if (m.againstVotes > m.forVotes) return 'Against';
  return 'Abstain';
}

const FederationMirrors: FC = () => {
  const { address } = useAccount();
  const { data: blockNumber } = useBlockNumber({ watch: true });
  const { writeContract, isPending } = useWriteContract();
  const [votingId, setVotingId] = useState<number | null>(null);

  const { data: mirrorCountData, refetch: refetchCount } = useReadContract({
    address: NOUNS_FEDERATION_ADDRESS,
    abi: nounsFederationAbi,
    functionName: 'mirrorCount',
    query: { enabled: isFederationConfigured, refetchInterval: 30_000 },
  });
  const mirrorCount = mirrorCountData != null ? Number(mirrorCountData) : 0;

  const mirrorIds = useMemo(
    () => Array.from({ length: mirrorCount }, (_, i) => BigInt(i + 1)),
    [mirrorCount],
  );

  const { data: mirrorReads, refetch: refetchMirrors } = useReadContracts({
    contracts: mirrorIds.map(id => ({
      address: NOUNS_FEDERATION_ADDRESS,
      abi: nounsFederationAbi,
      functionName: 'getMirror' as const,
      args: [id] as const,
    })),
    query: { enabled: isFederationConfigured && mirrorCount > 0, refetchInterval: 30_000 },
  });

  // Which mirrors has the connected wallet already voted on?
  const { data: votedReads } = useReadContracts({
    contracts: mirrorIds.map(id => ({
      address: NOUNS_FEDERATION_ADDRESS,
      abi: nounsFederationAbi,
      functionName: 'hasVoted' as const,
      args: [
        id,
        (address ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
      ] as const,
    })),
    query: {
      enabled: isFederationConfigured && mirrorCount > 0 && !!address,
      refetchInterval: 30_000,
    },
  });

  const mirrors = useMemo<MirrorRow[]>(() => {
    if (!mirrorReads) return [];
    const out: MirrorRow[] = [];
    for (let i = 0; i < mirrorIds.length; i++) {
      const res = mirrorReads[i];
      if (res?.status !== 'success' || res.result == null) continue;
      const m = res.result as unknown as {
        v1ProposalId: bigint;
        snapshotBlock: bigint;
        endBlock: bigint;
        forVotes: bigint;
        againstVotes: bigint;
        abstainVotes: bigint;
        relayed: boolean;
        relayedSupport: number;
      };
      out.push({
        id: Number(mirrorIds[i]),
        v1ProposalId: Number(m.v1ProposalId),
        snapshotBlock: m.snapshotBlock,
        endBlock: m.endBlock,
        forVotes: m.forVotes,
        againstVotes: m.againstVotes,
        abstainVotes: m.abstainVotes,
        relayed: m.relayed,
        relayedSupport: Number(m.relayedSupport),
      });
    }
    return out.reverse(); // newest first
  }, [mirrorReads, mirrorIds]);

  const hasVotedById = useMemo(() => {
    const map = new Map<number, boolean>();
    if (!votedReads) return map;
    for (let i = 0; i < mirrorIds.length; i++) {
      const res = votedReads[i];
      if (res?.status === 'success') map.set(Number(mirrorIds[i]), Boolean(res.result));
    }
    return map;
  }, [votedReads, mirrorIds]);

  const castVote = (mirrorId: number, support: FederationSupport) => {
    setVotingId(mirrorId);
    writeContract(
      {
        address: NOUNS_FEDERATION_ADDRESS,
        abi: nounsFederationAbi,
        functionName: 'castVote',
        args: [BigInt(mirrorId), support],
      },
      {
        onSettled: () => {
          setVotingId(null);
          void refetchCount();
          void refetchMirrors();
        },
      },
    );
  };

  // Hidden entirely until the federation contract is deployed + configured.
  if (!isFederationConfigured || mirrors.length === 0) return null;

  return (
    <div style={{ margin: '0 auto 28px', maxWidth: 900 }}>
      <div style={{ padding: '4px 0 12px' }}>
        <span
          style={{ color: '#8c8d92', fontSize: '1.2rem', fontFamily: "'Londrina Solid', cursive" }}
        >
          Federation
        </span>
        <h2
          style={{
            fontSize: '1.6rem',
            fontFamily: "'Londrina Solid', cursive",
            color: '#14141f',
            margin: '2px 0 4px',
          }}
        >
          Mirrored V1 Proposals
        </h2>
        <p style={{ color: '#8c8d92', fontSize: '0.9rem', margin: 0 }}>
          Vote with your NounV2 power on how the V1 voting power delegated to the federation is
          cast. When a mirror closes, the aggregated result is relayed to V1 as a single vote.
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {mirrors.map(m => {
          const status = mirrorStatus(m, blockNumber);
          const voting = status === 'VOTING';
          const alreadyVoted = hasVotedById.get(m.id) === true;
          const busy = isPending && votingId === m.id;
          return (
            <div
              key={m.id}
              style={{
                border: '1px solid #e2e3e8',
                borderRadius: 12,
                padding: 16,
                background: '#fff',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 12,
                }}
              >
                <div>
                  <Link
                    to={`/vote/${m.v1ProposalId}`}
                    style={{ fontWeight: 700, color: '#14141f', textDecoration: 'none' }}
                  >
                    Mirror #{m.id} → V1 Prop #{m.v1ProposalId}
                  </Link>
                  <div style={{ color: '#8c8d92', fontSize: '0.85rem', marginTop: 2 }}>
                    For {m.forVotes.toString()} · Against {m.againstVotes.toString()} · Abstain{' '}
                    {m.abstainVotes.toString()}
                  </div>
                </div>
                <span
                  style={{
                    color: statusColor(status),
                    fontWeight: 700,
                    fontSize: '0.8rem',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {status}
                </span>
              </div>

              <div style={{ marginTop: 10, fontSize: '0.85rem', color: '#57606a' }}>
                {m.relayed ? (
                  <span>
                    Relayed to V1 as <strong>{SUPPORT_LABEL[m.relayedSupport] ?? '—'}</strong>
                  </span>
                ) : (
                  <span>
                    Current outcome: <strong>{tallyDirection(m)}</strong>
                  </span>
                )}
              </div>

              {voting && (
                <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                  {alreadyVoted ? (
                    <span style={{ color: '#16a34a', fontSize: '0.85rem', fontWeight: 600 }}>
                      You voted on this mirror
                    </span>
                  ) : !address ? (
                    <span style={{ color: '#8c8d92', fontSize: '0.85rem' }}>
                      Connect a wallet to vote
                    </span>
                  ) : (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => castVote(m.id, FederationSupport.For)}
                        style={voteBtn('#16a34a', busy)}
                      >
                        For
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => castVote(m.id, FederationSupport.Against)}
                        style={voteBtn('#dc2626', busy)}
                      >
                        Against
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => castVote(m.id, FederationSupport.Abstain)}
                        style={voteBtn('#8c8d92', busy)}
                      >
                        Abstain
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

function voteBtn(color: string, busy: boolean): CSSProperties {
  return {
    border: `1px solid ${color}`,
    color: '#fff',
    background: color,
    borderRadius: 8,
    padding: '6px 16px',
    fontWeight: 600,
    fontSize: '0.85rem',
    cursor: busy ? 'not-allowed' : 'pointer',
    opacity: busy ? 0.6 : 1,
  };
}

export default FederationMirrors;
