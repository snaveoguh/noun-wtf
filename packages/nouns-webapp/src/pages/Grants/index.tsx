import { useEffect, useState } from 'react';

import { Link } from 'react-router';
import { toast } from 'sonner';
import { formatEther } from 'viem';
import { useBalance, useBlockNumber } from 'wagmi';

import ShortAddress from '@/components/ShortAddress';
import { SMALL_GRANTS_TREASURY_ADDRESS } from '@/contracts/small-grants-treasury';

import classes from './Grants.module.css';
import { fetchGrantsFromChain } from './grantsChainFallback';

const API_BASE = (
  (import.meta.env.VITE_MAINNET_SUBGRAPH as string | undefined) ??
  'https://spirited-flexibility-production-3c30.up.railway.app'
).replace(/\/graphql\/?$/, '');

interface Grant {
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
}

/**
 * Pick a human-readable title from a markdown-ish description. We strip
 * HTML comments first because the NounIRL gasless flow embeds a
 * `<!-- SIGNER:0x... -->` hint as the first line — without this the
 * card just shows the comment instead of the actual proposal title.
 */
function getTitle(desc: string) {
  const stripped = desc
    // Drop HTML comments wherever they appear (multiline-aware).
    .replace(/<!--[\s\S]*?-->/g, '')
    // Strip leading whitespace + blank lines so the first *meaningful*
    // line wins regardless of how many blank lines the comment left.
    .replace(/^[\s\r\n]+/, '');
  const firstLine = stripped.split('\n')[0] ?? '';
  return firstLine.replace(/^#+\s*/, '').slice(0, 80) || 'Untitled';
}

const RELAYER_ADDRESS = '0xacc74b39976d50522621f54c18dc85e2822ec22c';

function statusColor(status: string): string {
  switch (status) {
    case 'ACTIVE':
      return '#22d3ee';
    case 'SUCCEEDED':
      return '#34d399';
    case 'QUEUED':
      return '#fbbf24';
    case 'EXECUTED':
      return '#4ade80';
    case 'DEFEATED':
      return '#f87171';
    case 'CANCELED':
      return '#94a3b8';
    case 'EXPIRED':
      return '#94a3b8';
    default:
      return '#666';
  }
}

export default function GrantsPage() {
  const [grants, setGrants] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);
  const { data: blockNumber } = useBlockNumber({ watch: true });
  const { data: balance } = useBalance({ address: SMALL_GRANTS_TREASURY_ADDRESS });

  useEffect(() => {
    toast.error('Noun Grants is experimental. Unaudited contract — use at your own risk.', {
      duration: 8000,
      id: 'grants-risk-warning',
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    const normalize = (items: Grant[]): Grant[] =>
      items.map(g => ({
        id: Number(g.id),
        proposer: g.proposer ?? '',
        signer: (g as Grant & { signer?: string }).signer ?? null,
        description: g.description ?? '',
        status: g.status ?? 'ACTIVE',
        forVotes: Number(g.forVotes ?? 0),
        againstVotes: Number(g.againstVotes ?? 0),
        abstainVotes: Number(g.abstainVotes ?? 0),
        startBlock: String(g.startBlock ?? '0'),
        endBlock: String(g.endBlock ?? '0'),
        executionETA: g.executionETA != null ? String(g.executionETA) : null,
        createdAt: String(g.createdAt ?? ''),
      }));

    // Try the REST endpoint first (single request, bypasses Fastly
    // chunked-encoding truncation). If it 502s — Railway is currently
    // stuck post-NounV2 launch — fall back to reading the
    // SmallGrantsTreasury contract directly via wagmi/viem multicall.
    (async () => {
      try {
        const res = await fetch(`${API_BASE}/api/grants`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const items: Grant[] = await res.json();
        if (cancelled) return;
        if (items.length > 0) {
          setGrants(normalize(items));
          setLoading(false);
          return;
        }
        // 200 + empty list → still try the chain in case the API is
        // running but the indexer is behind.
        const chain = await fetchGrantsFromChain();
        if (!cancelled) setGrants(normalize(chain));
      } catch (e) {
        console.warn('[Grants] /api/grants unavailable, trying chain fallback:', e);
        try {
          const chain = await fetchGrantsFromChain();
          if (!cancelled) setGrants(normalize(chain));
        } catch (chainErr) {
          console.error('[Grants] Chain fallback also failed:', chainErr);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const treasuryEth = balance ? formatEther(balance.value) : '0';

  return (
    <div className={classes.container}>
      <div className={classes.header}>
        <div className={classes.titleRow}>
          <h1 className={classes.title}>Small Grants</h1>
          <span className={classes.treasury}>{parseFloat(treasuryEth).toFixed(4)} ETH</span>
        </div>
        <p className={classes.subtitle}>
          24-hour governance. No quorum. 12hr vote + 12hr timelock.
          <br />A proposal passes with just 1 FOR vote if nobody votes AGAINST.
        </p>
        <Link to="/grants/create" className={classes.createBtn}>
          + Create Grant Proposal
        </Link>
      </div>

      {loading && <p className={classes.loading}>Loading grants...</p>}

      {!loading && grants.length === 0 && (
        <div className={classes.empty}>
          <p>No grants yet. Be the first to propose one.</p>
        </div>
      )}

      <div className={classes.list}>
        {grants.map(g => {
          const title = getTitle(g.description);
          const totalVotes = g.forVotes + g.againstVotes;
          const forPct = totalVotes > 0 ? (g.forVotes / totalVotes) * 100 : 50;
          // Status is computed server-side (DEFEATED/SUCCEEDED derived from endBlock + vote tallies)
          const isActive = g.status === 'ACTIVE';
          const displayStatus = g.status;
          const blocksLeft =
            isActive && blockNumber != null ? Number(BigInt(g.endBlock) - (blockNumber ?? 0n)) : 0;
          const hoursLeft = Math.max(0, (blocksLeft * 12) / 3600);

          return (
            <Link key={g.id} to={`/grants/${g.id}`} className={classes.card}>
              <div className={classes.cardHeader}>
                <span className={classes.grantId}>Grant #{g.id}</span>
                <span className={classes.status} style={{ color: statusColor(displayStatus) }}>
                  {displayStatus}
                  {isActive === true && ` (${hoursLeft.toFixed(1)}h left)`}
                </span>
              </div>
              <div className={classes.cardTitle}>{title}</div>
              <div className={classes.cardMeta}>
                <span>
                  {g.proposer.toLowerCase() === RELAYER_ADDRESS ? (
                    g.signer ? (
                      <>
                        by <ShortAddress address={g.signer as `0x${string}`} />
                        <span style={{ color: '#6b7280', fontSize: '0.75rem', marginLeft: '0.35rem' }}>
                          (GASLESS VIA NOUNIRL)
                        </span>
                      </>
                    ) : (
                      <span style={{ color: '#6b7280', fontSize: '0.75rem' }}>
                        GASLESS VIA NOUNIRL
                      </span>
                    )
                  ) : (
                    <>by <ShortAddress address={g.proposer as `0x${string}`} /></>
                  )}
                </span>
                <span>
                  {g.forVotes} FOR / {g.againstVotes} AGAINST
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
