import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { formatEther } from 'viem';
import { useBalance, useBlockNumber } from 'wagmi';
import { toast } from 'sonner';

import { SMALL_GRANTS_TREASURY_ADDRESS } from '@/contracts/small-grants-treasury';

import classes from './Grants.module.css';

const API_BASE =
  import.meta.env.VITE_MAINNET_SUBGRAPH ||
  'https://spirited-flexibility-production-3c30.up.railway.app';

interface Grant {
  id: number;
  proposer: string;
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

function shortAddr(addr: string) {
  return addr ? `${addr.slice(0, 6)}..${addr.slice(-4)}` : '???';
}

function getTitle(desc: string) {
  return (desc.split('\n')[0] || '').replace(/^#\s*/, '').slice(0, 80) || 'Untitled';
}

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
    // Fetch grants without description first (Railway truncates large responses),
    // then fetch each grant's description individually
    // Railway/Fastly proxy truncates list query responses, so fetch each grant
    // individually. Only ~6 grants exist — this is fast.
    const gqlFetch = async (query: string) => {
      const res = await fetch(`${API_BASE}/graphql`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const text = await res.text();
      return JSON.parse(text);
    };

    // Discover grant IDs via minimal query, then fetch each individually
    gqlFetch(`{ grants(limit: 1, orderBy: "id", orderDirection: "desc") { items { id } } }`)
      .then(async d => {
        const maxId = Number(d.data?.grants?.items?.[0]?.id ?? 0);
        if (maxId === 0) return;
        // Fetch all grants individually in parallel
        const results = await Promise.all(
          Array.from({ length: maxId }, (_, i) => i + 1).map(id =>
            gqlFetch(`{ grant(id: "${id}") {
              id proposer description status forVotes againstVotes abstainVotes
              startBlock endBlock executionETA createdAt
            } }`)
              .then(dd => dd.data?.grant)
              .catch(() => null),
          ),
        );
        const items = results
          .filter(Boolean)
          .map((g: any) => ({
            id: Number(g.id),
            proposer: g.proposer,
            description: g.description || '',
            status: g.status || 'ACTIVE',
            forVotes: g.forVotes || 0,
            againstVotes: g.againstVotes || 0,
            abstainVotes: g.abstainVotes || 0,
            startBlock: String(g.startBlock || '0'),
            endBlock: String(g.endBlock || '0'),
            executionETA: g.executionETA ? String(g.executionETA) : null,
            createdAt: g.createdAt,
          }))
          .sort((a, b) => b.id - a.id);
        setGrants(items);
      })
      .catch(e => console.error('[Grants] Fetch failed:', e))
      .finally(() => setLoading(false));
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
          <br />
          A proposal passes with just 1 FOR vote if nobody votes AGAINST.
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
          const isActive = g.status === 'ACTIVE' && blockNumber && BigInt(g.endBlock) > blockNumber;
          const votingEnded = g.status === 'ACTIVE' && blockNumber && BigInt(g.endBlock) <= blockNumber;
          const isDefeated = votingEnded && g.forVotes <= g.againstVotes;
          const isSucceeded = votingEnded && g.forVotes > g.againstVotes;
          const displayStatus = isDefeated ? 'DEFEATED' : isSucceeded ? 'SUCCEEDED' : g.status;
          const blocksLeft = isActive ? Number(BigInt(g.endBlock) - blockNumber!) : 0;
          const hoursLeft = Math.max(0, (blocksLeft * 12) / 3600);

          return (
            <Link key={g.id} to={`/grants/${g.id}`} className={classes.card}>
              <div className={classes.cardHeader}>
                <span className={classes.grantId}>Grant #{g.id}</span>
                <span className={classes.status} style={{ color: statusColor(displayStatus) }}>
                  {displayStatus}
                  {isActive && ` (${hoursLeft.toFixed(1)}h left)`}
                </span>
              </div>
              <div className={classes.cardTitle}>{title}</div>
              <div className={classes.cardMeta}>
                <span>by {shortAddr(g.proposer)}</span>
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
