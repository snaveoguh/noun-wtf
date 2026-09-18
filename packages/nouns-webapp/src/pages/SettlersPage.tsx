/**
 * SettlersPage — three leaderboards over the same auction history.
 *
 *   Settlers — who called settleCurrentAndCreateNewAuction. That tx mints
 *              noun N and opens the next auction. Source: the indexer's
 *              settler map (tx.from of AuctionSettled), NOT the auction
 *              winner. V1 nounder nouns (every 10th, id <= 1820) were never
 *              auctioned, so they inherit the settler of N-1.
 *   Curators — settler(N-1). Settling N-1 rolls the block hash that seeds
 *              N's traits, so that wallet effectively chose what N looks like.
 *   Winners  — highest bidder per auction. This is what the whole page used
 *              to show while calling itself "Settlers".
 *
 * Settler/curator maps come from `@/lib/settlerMaps` (GET /api/settlers, with
 * a static snapshot fallback) so these counts agree with the /gamer profile
 * and the probe dropdowns. Winners still come from the auctions table.
 */
import { FC, useCallback, useEffect, useMemo, useState } from 'react';

import { ImageData, getNounData } from '@noundry/nouns-assets';
import { buildSVG } from '@nouns/sdk';

import { SettlersSkeleton } from '@/components/Skeleton';
import { loadSettlerMaps, type SettlerMaps } from '@/lib/settlerMaps';
import { isBurnedSeed, useNounSeeds, type INounSeed } from '@/wrappers/nounToken';

const API_URL: string =
  (import.meta.env.VITE_MAINNET_SUBGRAPH as string | undefined) ??
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

type TabKey = 'settlers' | 'curators' | 'winners';

const TABS: { key: TabKey; label: string; blurb: string }[] = [
  {
    key: 'settlers',
    label: '⛏️ Settlers',
    blurb:
      'Who actually called settle — the transaction that mints the Noun and opens the next auction. Nounder Nouns (every 10th, up to 1820) were never auctioned, so they inherit the settler of the Noun before them.',
  },
  {
    key: 'curators',
    label: '🎲 Curators',
    blurb:
      'Settling Noun N−1 rolls the block hash that seeds Noun N’s traits. These are the wallets whose settle transaction decided what each Noun actually looks like.',
  },
  {
    key: 'winners',
    label: '🏆 Winners',
    blurb: 'Auction winners — who’s collected the most Nouns, and what they paid.',
  },
];

interface BoardRow {
  address: string;
  nouns: number[];
  count: number;
  /** Winners only — total ETH paid across their wins. */
  totalEth?: bigint;
}

function shortenAddress(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatEth(wei: bigint) {
  const eth = Number(wei) / 1e18;
  return eth.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Render a Noun from its real onchain seed. Burned/missing seeds return null. */
function nounSvgFromSeed(seed: INounSeed | undefined): string | null {
  if (!seed || isBurnedSeed(seed)) return null;
  try {
    const { parts, background } = getNounData(seed);
    return `data:image/svg+xml;base64,${btoa(buildSVG(parts, ImageData.palette, background))}`;
  } catch {
    return null;
  }
}

/** nounId -> address map into leaderboard rows, highest count first. */
function boardFromMap(map: Record<string, string>): BoardRow[] {
  const grouped = new Map<string, number[]>();
  for (const [id, addr] of Object.entries(map)) {
    const arr = grouped.get(addr);
    if (arr) arr.push(Number(id));
    else grouped.set(addr, [Number(id)]);
  }
  const rows: BoardRow[] = [];
  for (const [address, nouns] of grouped) {
    nouns.sort((a, b) => b - a);
    rows.push({ address, nouns, count: nouns.length });
  }
  return rows.sort((a, b) => b.count - a.count);
}

const SettlersPage: FC = () => {
  const [auctions, setAuctions] = useState<AuctionData[]>([]);
  const [maps, setMaps] = useState<SettlerMaps | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>('settlers');
  const seeds = useNounSeeds();

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [auctionRes, settlerMaps] = await Promise.all([
        fetch(API_URL, {
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
        }),
        loadSettlerMaps('v1'),
      ]);
      if (!auctionRes.ok) throw new Error(`HTTP ${auctionRes.status}`);
      const json = await auctionRes.json();
      setAuctions(json.data?.auctions?.items ?? []);
      setMaps(settlerMaps);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const settlerBoard = useMemo(() => (maps ? boardFromMap(maps.settlers) : []), [maps]);
  const curatorBoard = useMemo(() => (maps ? boardFromMap(maps.curated) : []), [maps]);

  const winnerBoard = useMemo(() => {
    const map = new Map<string, BoardRow>();
    for (const a of auctions) {
      // Skip burned auctions even if a stale row still has a 0x0 winner set —
      // nobody collected those Nouns.
      if (a.burned === true || !a.settled) continue;
      if (a.winner == null || a.winner.length === 0) continue;
      const addr = a.winner.toLowerCase();
      const existing = map.get(addr) ?? { address: addr, nouns: [], totalEth: 0n, count: 0 };
      existing.nouns.push(Number(a.nounId));
      existing.totalEth = (existing.totalEth ?? 0n) + BigInt(a.amount ?? '0');
      existing.count += 1;
      map.set(addr, existing);
    }
    for (const row of map.values()) row.nouns.sort((a, b) => b - a);
    return Array.from(map.values()).sort((a, b) => b.count - a.count);
  }, [auctions]);

  const totalEth = auctions.reduce(
    (sum, a) => (a.burned === true ? sum : sum + BigInt(a.amount ?? '0')),
    0n,
  );

  const clientBreakdown = useMemo(() => {
    const map = new Map<number, number>();
    for (const a of auctions) {
      if (!a.settled || a.clientId == null) continue;
      map.set(a.clientId, (map.get(a.clientId) ?? 0) + 1);
    }
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [auctions]);

  const board = tab === 'settlers' ? settlerBoard : tab === 'curators' ? curatorBoard : winnerBoard;
  const activeTab = TABS.find(t => t.key === tab)!;
  const noun = tab === 'winners' ? 'winner' : tab === 'curators' ? 'curator' : 'settler';

  const stats: { label: string; value: string }[] =
    tab === 'winners'
      ? [
          {
            label: 'Auctions Won',
            value: auctions.filter(a => a.settled && a.burned !== true).length.toLocaleString(),
          },
          { label: 'Total ETH', value: formatEth(totalEth) },
          { label: 'Unique Winners', value: winnerBoard.length.toLocaleString() },
          {
            label: 'Client #37 Wins',
            value: (clientBreakdown.find(c => c[0] === 37)?.[1] ?? 0).toLocaleString(),
          },
        ]
      : [
          {
            label: tab === 'curators' ? 'Nouns Curated' : 'Nouns Settled',
            value: board.reduce((n, r) => n + r.count, 0).toLocaleString(),
          },
          {
            label: tab === 'curators' ? 'Unique Curators' : 'Unique Settlers',
            value: board.length.toLocaleString(),
          },
          {
            label: tab === 'curators' ? 'Top Curator' : 'Top Settler',
            value: board.length > 0 ? String(board[0].count) : '—',
          },
        ];

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="mb-1 text-4xl font-bold">⛏️ Settlers</h1>
      <p style={{ color: '#666', fontSize: '0.9rem', marginBottom: '1rem', textTransform: 'none' }}>
        Every Noun is minted by someone calling settle. This is who.
      </p>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            style={{
              padding: '6px 14px',
              borderRadius: '9999px',
              border: tab === t.key ? '2px solid #000' : '1px solid #ddd',
              background: tab === t.key ? '#000' : '#fff',
              color: tab === t.key ? '#fff' : '#555',
              fontSize: '0.8rem',
              fontWeight: 700,
              cursor: 'pointer',
              textTransform: 'none',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <p
        style={{
          color: '#666',
          fontSize: '0.8rem',
          marginBottom: '1.5rem',
          textTransform: 'none',
          lineHeight: 1.5,
        }}
      >
        {activeTab.blurb}
      </p>

      {loading && <SettlersSkeleton />}

      {error && (
        <div className="rounded-lg bg-red-50 p-4 text-sm text-red-600">
          {error}
          <button type="button" onClick={fetchAll} className="ml-2 underline">
            Retry
          </button>
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
            {stats.map(s => (
              <StatCard key={s.label} label={s.label} value={s.value} />
            ))}
          </div>

          {/* Client ID breakdown — auction-level data, only meaningful on Winners */}
          {tab === 'winners' && clientBreakdown.length > 0 && (
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
          <h2 className="mb-3 text-lg font-bold">
            {tab === 'settlers'
              ? 'Settler Leaderboard'
              : tab === 'curators'
                ? 'Curator Leaderboard'
                : 'Winner Leaderboard'}
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {board.slice(0, 50).map((row, rank) => (
              <div
                key={row.address}
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
                onMouseEnter={e => {
                  (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)';
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLElement).style.transform = 'none';
                }}
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

                {/* Noun thumbnails — real onchain seeds */}
                <div style={{ display: 'flex', flexShrink: 0, marginRight: '4px' }}>
                  {row.nouns.slice(0, 5).map(id => {
                    const svg = nounSvgFromSeed(seeds?.[String(id)]);
                    return svg ? (
                      <img
                        key={id}
                        src={svg}
                        alt={`Noun ${id}`}
                        title={`Noun ${id}`}
                        loading="lazy"
                        style={{
                          width: '24px',
                          height: '24px',
                          borderRadius: '4px',
                          marginLeft: '-4px',
                          border: '1px solid #fff',
                          imageRendering: 'pixelated' as const,
                        }}
                      />
                    ) : (
                      <span
                        key={id}
                        title={`Noun ${id}`}
                        style={{
                          width: '24px',
                          height: '24px',
                          borderRadius: '4px',
                          marginLeft: '-4px',
                          border: '1px solid #fff',
                          background: 'rgba(0,0,0,0.06)',
                          flexShrink: 0,
                        }}
                      />
                    );
                  })}
                  {row.nouns.length > 5 && (
                    <span
                      style={{
                        fontSize: '0.6rem',
                        color: '#999',
                        marginLeft: '4px',
                        alignSelf: 'center',
                      }}
                    >
                      +{row.nouns.length - 5}
                    </span>
                  )}
                </div>

                {/* Address */}
                <a
                  href={`https://etherscan.io/address/${row.address}`}
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
                  {shortenAddress(row.address)}
                </a>

                {/* Stats */}
                <span
                  style={{ fontSize: '0.75rem', fontWeight: 700, color: '#333', flexShrink: 0 }}
                >
                  {row.count} noun{row.count > 1 ? 's' : ''}
                </span>
                {row.totalEth !== undefined && (
                  <span style={{ fontSize: '0.7rem', color: '#888', flexShrink: 0 }}>
                    {formatEth(row.totalEth)} ETH
                  </span>
                )}
              </div>
            ))}
          </div>

          {board.length > 50 && (
            <p
              style={{ textAlign: 'center', color: '#999', fontSize: '0.8rem', marginTop: '16px' }}
            >
              Showing top 50 of {board.length.toLocaleString()} unique {noun}s
            </p>
          )}

          {/* Stale-data notice — the lib falls back to a hand-made snapshot when
              the indexer serves empty tables (~10-15 min after each deploy). */}
          {tab !== 'winners' && maps?.source === 'snapshot' && (
            <p
              style={{
                textAlign: 'center',
                color: '#b45309',
                fontSize: '0.7rem',
                marginTop: '8px',
              }}
            >
              Indexer unavailable — showing a cached snapshot, which may be a day or so behind.
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
      <div
        style={{
          fontSize: '0.65rem',
          fontWeight: 700,
          color: '#888',
          marginTop: '4px',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}
      >
        {label}
      </div>
    </div>
  );
}

export default SettlersPage;
