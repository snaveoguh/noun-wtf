import { FC, useCallback, useEffect, useMemo, useState } from 'react';

import { ImageData, getNounData } from '@noundry/nouns-assets';
import { buildSVG } from '@nouns/sdk';

import { SettlersSkeleton } from '@/components/Skeleton';

const API_URL =
  import.meta.env.VITE_MAINNET_SUBGRAPH ||
  'https://spirited-flexibility-production-3c30.up.railway.app';

interface AuctionData {
  nounId: string;
  amount: string | null;
  winner: string | null;
  settled: boolean;
  /** Reserve-not-met settlement → noun was burned. Exclude from leaderboards. */
  burned?: boolean;
  clientId: number | null;
  startTime: string;
  endTime: string;
}

interface WinnerStats {
  address: string;
  nouns: string[];
  totalEth: bigint;
  count: number;
}

function shortenAddress(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatEth(wei: bigint) {
  const eth = Number(wei) / 1e18;
  return eth.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function nounSvg(nounId: number): string {
  try {
    const seed = {
      background: nounId % ImageData.bgcolors.length,
      body: (nounId * 3) % ImageData.images.bodies.length,
      accessory: (nounId * 7) % ImageData.images.accessories.length,
      head: (nounId * 13) % ImageData.images.heads.length,
      glasses: (nounId * 17) % ImageData.images.glasses.length,
    };
    const { parts, background } = getNounData(seed);
    const svg = buildSVG(parts, ImageData.palette, background);
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  } catch {
    return '';
  }
}

const SettlersPage: FC = () => {
  const [auctions, setAuctions] = useState<AuctionData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAuctions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: `{
            auctions(orderBy: "startTime", orderDirection: "desc", limit: 1000) {
              items {
                nounId
                amount
                winner
                settled
                burned
                clientId
                startTime
                endTime
              }
            }
          }`,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setAuctions(json.data?.auctions?.items ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAuctions();
  }, [fetchAuctions]);

  const leaderboard = useMemo(() => {
    const map = new Map<string, WinnerStats>();
    for (const a of auctions) {
      // Skip burned auctions even if a stale row still has a 0x0 winner set —
      // they didn't produce a real settler and shouldn't appear on any board.
      if (a.burned || !a.winner || !a.settled) continue;
      const addr = a.winner.toLowerCase();
      const existing = map.get(addr) || { address: a.winner, nouns: [], totalEth: 0n, count: 0 };
      existing.nouns.push(a.nounId);
      existing.totalEth += BigInt(a.amount ?? '0');
      existing.count += 1;
      map.set(addr, existing);
    }
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [auctions]);

  // Count only successfully-settled (non-burned) auctions for headline stats.
  const totalSettled = auctions.filter(a => a.settled && !a.burned).length;
  const totalEth = auctions.reduce(
    (sum, a) => (a.burned ? sum : sum + BigInt(a.amount ?? '0')),
    0n,
  );
  const uniqueWinners = leaderboard.length;

  const clientBreakdown = useMemo(() => {
    const map = new Map<number, number>();
    for (const a of auctions) {
      if (!a.settled || a.clientId == null) continue;
      map.set(a.clientId, (map.get(a.clientId) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [auctions]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-1 text-4xl font-bold">⛏️ Settlers</h1>
      <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '1.5rem', textTransform: 'none' }}>
        Auction winners leaderboard — who&apos;s collected the most Nouns.
      </p>

      {loading && <SettlersSkeleton />}

      {error && (
        <div className="rounded-lg bg-red-50 p-4 text-sm text-red-600">
          {error}
          <button onClick={fetchAuctions} className="ml-2 underline">Retry</button>
        </div>
      )}

      {!loading && !error && (
        <>
          {/* Stats bar */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: '12px',
              marginBottom: '24px',
            }}
          >
            <StatCard label="Auctions Settled" value={totalSettled.toLocaleString()} />
            <StatCard label="Total ETH" value={`${formatEth(totalEth)}`} />
            <StatCard label="Unique Winners" value={uniqueWinners.toLocaleString()} />
            <StatCard label="Client #37 Wins" value={(clientBreakdown.find(c => c[0] === 37)?.[1] ?? 0).toLocaleString()} />
          </div>

          {/* Client ID breakdown */}
          {clientBreakdown.length > 0 && (
            <div style={{ marginBottom: '24px' }}>
              <h2 className="mb-2 text-lg font-bold">Client Breakdown</h2>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {clientBreakdown.slice(0, 10).map(([clientId, count]) => (
                  <div
                    key={clientId}
                    style={{
                      padding: '4px 12px',
                      borderRadius: '9999px',
                      border: clientId === 37 ? '2px solid #7c3aed' : '1px solid #ddd',
                      background: clientId === 37 ? '#f5f0ff' : '#fafafa',
                      fontSize: '0.75rem',
                      fontWeight: 700,
                    }}
                  >
                    Client #{clientId}: {count}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Leaderboard */}
          <h2 className="mb-3 text-lg font-bold">Winner Leaderboard</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {leaderboard.slice(0, 50).map((winner, rank) => (
              <div
                key={winner.address}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 16px',
                  borderRadius: '12px',
                  border: '1px solid #eee',
                  background: rank < 3 ? ['#fffbeb', '#f8fafc', '#fef3c7'][rank] : '#fff',
                  transition: 'transform 0.1s',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'none'; }}
              >
                {/* Rank */}
                <span
                  style={{
                    fontWeight: 900,
                    fontSize: rank < 3 ? '1.2rem' : '0.9rem',
                    color: rank < 3 ? ['#d97706', '#64748b', '#b45309'][rank] : '#999',
                    width: '32px',
                    textAlign: 'center',
                    flexShrink: 0,
                  }}
                >
                  {rank < 3 ? ['🥇', '🥈', '🥉'][rank] : `#${rank + 1}`}
                </span>

                {/* Noun thumbnails */}
                <div style={{ display: 'flex', flexShrink: 0, marginRight: '4px' }}>
                  {winner.nouns.slice(0, 5).map(id => {
                    const svg = nounSvg(Number(id));
                    return svg ? (
                      <img
                        key={id}
                        src={svg}
                        alt={`Noun ${id}`}
                        style={{
                          width: '24px',
                          height: '24px',
                          borderRadius: '4px',
                          marginLeft: '-4px',
                          border: '1px solid #fff',
                          imageRendering: 'pixelated' as const,
                        }}
                      />
                    ) : null;
                  })}
                  {winner.nouns.length > 5 && (
                    <span style={{ fontSize: '0.6rem', color: '#999', marginLeft: '4px', alignSelf: 'center' }}>
                      +{winner.nouns.length - 5}
                    </span>
                  )}
                </div>

                {/* Address */}
                <a
                  href={`https://etherscan.io/address/${winner.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    fontFamily: 'monospace',
                    fontSize: '0.8rem',
                    fontWeight: 600,
                    color: '#333',
                    textDecoration: 'none',
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap' as const,
                    textTransform: 'none' as const,
                  }}
                >
                  {shortenAddress(winner.address)}
                </a>

                {/* Stats */}
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: '#333', flexShrink: 0 }}>
                  {winner.count} noun{winner.count > 1 ? 's' : ''}
                </span>
                <span style={{ fontSize: '0.7rem', color: '#888', flexShrink: 0 }}>
                  {formatEth(winner.totalEth)} ETH
                </span>
              </div>
            ))}
          </div>

          {leaderboard.length > 50 && (
            <p style={{ textAlign: 'center', color: '#999', fontSize: '0.8rem', marginTop: '16px' }}>
              Showing top 50 of {leaderboard.length} unique winners
            </p>
          )}
        </>
      )}
    </div>
  );
};

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        padding: '16px',
        borderRadius: '12px',
        border: '2px solid #000',
        background: '#fff',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: '1.5rem', fontWeight: 900, lineHeight: 1 }}>{value}</div>
      <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#888', marginTop: '4px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
    </div>
  );
}

export default SettlersPage;
