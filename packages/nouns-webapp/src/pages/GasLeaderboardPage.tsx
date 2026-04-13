import { FC, useCallback, useEffect, useMemo, useState } from 'react';

const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ??
  (import.meta.env.VITE_MAINNET_SUBGRAPH as string | undefined) ??
  'https://spirited-flexibility-production-3c30.up.railway.app';

type GasAction =
  | 'bidding'
  | 'settling'
  | 'proposing'
  | 'voting'
  | 'queuing'
  | 'executing'
  | 'canceling'
  | 'creating_candidate'
  | 'updating_candidate'
  | 'canceling_candidate'
  | 'sponsoring'
  | 'feedback'
  | 'grant_proposing'
  | 'grant_voting'
  | 'grant_admin'
  | 'delegation'
  | 'other';

const ACTION_LABELS: Record<GasAction, string> = {
  bidding: 'Bidding',
  settling: 'Settling',
  proposing: 'Proposing',
  voting: 'Voting',
  queuing: 'Queuing',
  executing: 'Executing',
  canceling: 'Canceling',
  creating_candidate: 'Creating Candidates',
  updating_candidate: 'Updating Candidates',
  canceling_candidate: 'Canceling Candidates',
  sponsoring: 'Sponsoring',
  feedback: 'Feedback',
  grant_proposing: 'Grant Proposals',
  grant_voting: 'Grant Voting',
  grant_admin: 'Grant Admin',
  delegation: 'Delegation',
  other: 'Other',
};

interface GasEntryData {
  address: string;
  totalGasCostEth: number;
  totalRefundEth: number;
  netGasCostEth: number;
  txCount: number;
  byAction: Partial<Record<GasAction, { txCount: number; gasCostEth: number }>>;
}

interface GasLeaderboardData {
  entries: GasEntryData[];
  meta: {
    totalTransactions: number;
    totalGasEth: number;
    totalRefundEth: number;
    uniqueAddresses: number;
    lastUpdated: number;
  };
}

type SortField = 'netGas' | 'totalGas' | 'refunds' | 'txCount';

function shortenAddress(addr: string) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatEth(eth: number) {
  if (eth >= 1)
    return eth.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (eth >= 0.001)
    return eth.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 });
  if (eth > 0)
    return eth.toLocaleString(undefined, { minimumFractionDigits: 6, maximumFractionDigits: 6 });
  return '0';
}

function topAction(entry: GasEntryData): string {
  let best: { action: GasAction; gas: number } | null = null;
  for (const [k, v] of Object.entries(entry.byAction) as [
    GasAction,
    { txCount: number; gasCostEth: number },
  ][]) {
    if (!best || v.gasCostEth > best.gas) best = { action: k, gas: v.gasCostEth };
  }
  return best ? ACTION_LABELS[best.action] : '';
}

const GasLeaderboardPage: FC = () => {
  const [data, setData] = useState<GasLeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ensMap, setEnsMap] = useState<Record<string, string>>({});

  // Controls
  const [sortField, setSortField] = useState<SortField>('netGas');
  const [sortAsc, setSortAsc] = useState(false);
  const [actionFilter, setActionFilter] = useState<GasAction | 'all'>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 50;

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_URL}/api/gas-leaderboard`);
      if (res.status === 202) {
        setBuilding(true);
        setLoading(false);
        // Poll until ready
        const poll = setInterval(async () => {
          try {
            const r = await fetch(`${API_URL}/api/gas-leaderboard`);
            if (r.ok && r.status === 200) {
              const json = await r.json();
              if (json.entries != null) {
                clearInterval(poll);
                setData(json);
                setBuilding(false);
              }
            }
          } catch {}
        }, 3000);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.entries != null) {
        setData(json);
        setBuilding(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ENS resolution for visible rows
  const resolveEns = useCallback(
    async (addresses: string[]) => {
      const unresolved = addresses.filter(a => !(a.toLowerCase() in ensMap));
      if (unresolved.length < 1) return;
      try {
        const res = await fetch(`${API_URL}/api/ens?addresses=${unresolved.join(',')}`);
        if (!res.ok) return;
        const json = await res.json();
        setEnsMap(prev => {
          const next = { ...prev };
          for (const [addr, name] of Object.entries(json)) {
            if (typeof name === 'string' && name.length > 0) next[addr.toLowerCase()] = name;
          }
          return next;
        });
      } catch {}
    },
    [ensMap],
  );

  // Filtered and sorted entries
  const processed = useMemo(() => {
    if (!data) return [];
    let entries = data.entries;

    // Filter by action
    if (actionFilter !== 'all') {
      entries = entries.filter(
        e => e.byAction[actionFilter] != null && e.byAction[actionFilter]!.txCount > 0,
      );
    }

    // Filter by search
    if (search.length > 0) {
      const q = search.toLowerCase();
      entries = entries.filter(e => {
        if (e.address.toLowerCase().includes(q)) return true;
        const ens = ensMap[e.address.toLowerCase()];
        if (ens != null && ens.toLowerCase().includes(q)) return true;
        return false;
      });
    }

    // Sort
    const sorted = [...entries].sort((a, b) => {
      let av: number, bv: number;
      if (actionFilter !== 'all') {
        // When filtering by action, sort by that action's gas
        av = a.byAction[actionFilter]?.gasCostEth ?? 0;
        bv = b.byAction[actionFilter]?.gasCostEth ?? 0;
        if (sortField === 'txCount') {
          av = a.byAction[actionFilter]?.txCount ?? 0;
          bv = b.byAction[actionFilter]?.txCount ?? 0;
        }
      } else {
        switch (sortField) {
          case 'totalGas':
            av = a.totalGasCostEth;
            bv = b.totalGasCostEth;
            break;
          case 'refunds':
            av = a.totalRefundEth;
            bv = b.totalRefundEth;
            break;
          case 'txCount':
            av = a.txCount;
            bv = b.txCount;
            break;
          default:
            av = a.netGasCostEth;
            bv = b.netGasCostEth;
            break;
        }
      }
      return sortAsc ? av - bv : bv - av;
    });

    return sorted;
  }, [data, actionFilter, search, sortField, sortAsc, ensMap]);

  // Paginated view
  const totalPages = Math.ceil(processed.length / PAGE_SIZE);
  const pageEntries = processed.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  // Resolve ENS for visible page
  useEffect(() => {
    if (pageEntries.length > 0) {
      resolveEns(pageEntries.map(e => e.address));
    }
  }, [pageEntries, resolveEns]);

  // Reset page when filters change
  const prevFilter = useMemo(
    () => ({ actionFilter, search, sortField, sortAsc }),
    [actionFilter, search, sortField, sortAsc],
  );
  useEffect(() => {
    if (page !== 0) setPage(0);
  }, [prevFilter]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else {
      setSortField(field);
      setSortAsc(false);
    }
  };

  const sortIndicator = (field: SortField) => {
    if (sortField !== field) return '';
    return sortAsc ? ' \u25B2' : ' \u25BC';
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="mb-1 text-4xl font-bold">Gas Leaderboard</h1>
      <p
        style={{ color: '#666', fontSize: '0.9rem', marginBottom: '1.5rem', textTransform: 'none' }}
      >
        How much gas each address has spent interacting with Nouns DAO contracts. Voting gas is
        refunded by the DAO — tracked separately.
      </p>

      {loading && !building && (
        <div style={{ textAlign: 'center', padding: '60px 0', color: '#888' }}>
          Loading gas data...
        </div>
      )}

      {building && (
        <div
          style={{
            textAlign: 'center',
            padding: '60px 20px',
            color: '#888',
            border: '2px dashed #ddd',
            borderRadius: '12px',
            margin: '20px 0',
          }}
        >
          <div style={{ fontSize: '1.5rem', marginBottom: '8px' }}>Compiling gas data...</div>
          <div style={{ fontSize: '0.8rem', textTransform: 'none' }}>
            Fetching transactions from all Nouns contracts via Etherscan. This takes ~15 seconds on
            first load.
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg bg-red-50 p-4 text-sm text-red-600">
          {error}
          <button type="button" onClick={fetchData} className="ml-2 underline">
            Retry
          </button>
        </div>
      )}

      {data && (
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
            <StatCard label="Total Gas Spent" value={`${formatEth(data.meta.totalGasEth)} ETH`} />
            <StatCard label="Vote Refunds" value={`${formatEth(data.meta.totalRefundEth)} ETH`} />
            <StatCard
              label="Net Gas Spent"
              value={`${formatEth(data.meta.totalGasEth - data.meta.totalRefundEth)} ETH`}
            />
            <StatCard label="Unique Addresses" value={data.meta.uniqueAddresses.toLocaleString()} />
            <StatCard
              label="Total Transactions"
              value={data.meta.totalTransactions.toLocaleString()}
            />
          </div>

          {/* Filter bar */}
          <div
            style={{
              display: 'flex',
              gap: '8px',
              marginBottom: '16px',
              flexWrap: 'wrap',
              alignItems: 'center',
            }}
          >
            <select
              value={actionFilter}
              onChange={e => setActionFilter(e.target.value as GasAction | 'all')}
              style={{
                padding: '6px 12px',
                borderRadius: '8px',
                border: '1px solid #ccc',
                fontSize: '0.8rem',
                fontWeight: 600,
                background: '#fff',
                cursor: 'pointer',
              }}
            >
              <option value="all">All Actions</option>
              {(Object.entries(ACTION_LABELS) as [GasAction, string][]).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>

            <input
              type="text"
              placeholder="Search address or ENS..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{
                padding: '6px 12px',
                borderRadius: '8px',
                border: '1px solid #ccc',
                fontSize: '0.8rem',
                flex: 1,
                minWidth: '180px',
                textTransform: 'none',
              }}
            />

            <span style={{ fontSize: '0.7rem', color: '#999', marginLeft: 'auto' }}>
              {processed.length.toLocaleString()} address{processed.length !== 1 ? 'es' : ''}
              {data.meta.lastUpdated && (
                <> &middot; Updated {new Date(data.meta.lastUpdated).toLocaleString()}</>
              )}
            </span>
          </div>

          {/* Table (scrollable on mobile) */}
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            {/* Table header */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '40px minmax(120px,1fr) 100px 90px 100px 70px 120px',
                minWidth: '560px',
                gap: '8px',
                padding: '8px 16px',
                fontSize: '0.65rem',
                fontWeight: 700,
                color: '#888',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                borderBottom: '2px solid #eee',
                marginBottom: '4px',
              }}
            >
              <span>#</span>
              <span>Address</span>
              <SortHeader
                label="Total Gas"
                field="totalGas"
                current={sortField}
                onClick={handleSort}
                indicator={sortIndicator}
              />
              <SortHeader
                label="Refunds"
                field="refunds"
                current={sortField}
                onClick={handleSort}
                indicator={sortIndicator}
              />
              <SortHeader
                label="Net Gas"
                field="netGas"
                current={sortField}
                onClick={handleSort}
                indicator={sortIndicator}
              />
              <SortHeader
                label="Txs"
                field="txCount"
                current={sortField}
                onClick={handleSort}
                indicator={sortIndicator}
              />
              <span>Top Action</span>
            </div>

            {/* Rows */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {pageEntries.map((entry, i) => {
                const rank = page * PAGE_SIZE + i + 1;
                const ens = ensMap[entry.address.toLowerCase()];
                const actionGas = actionFilter !== 'all' ? entry.byAction[actionFilter] : null;

                return (
                  <div
                    key={entry.address}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '40px minmax(120px,1fr) 100px 90px 100px 70px 120px',
                      minWidth: '560px',
                      gap: '8px',
                      padding: '10px 16px',
                      borderRadius: '10px',
                      border: '1px solid #eee',
                      background: rank <= 3 ? ['#fffbeb', '#f8fafc', '#fef3c7'][rank - 1] : '#fff',
                      alignItems: 'center',
                      fontSize: '0.8rem',
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
                        fontSize: rank <= 3 ? '1.1rem' : '0.8rem',
                        color: rank <= 3 ? ['#d97706', '#64748b', '#b45309'][rank - 1] : '#999',
                      }}
                    >
                      {rank}
                    </span>

                    {/* Address */}
                    <a
                      href={`https://etherscan.io/address/${entry.address}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontFamily: 'monospace',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        color: '#333',
                        textDecoration: 'none',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        textTransform: 'none',
                      }}
                      title={entry.address}
                    >
                      {ens || shortenAddress(entry.address)}
                    </a>

                    {/* Total Gas */}
                    <span style={{ fontWeight: 700, fontSize: '0.75rem' }}>
                      {actionGas
                        ? formatEth(actionGas.gasCostEth)
                        : formatEth(entry.totalGasCostEth)}
                    </span>

                    {/* Refunds */}
                    <span
                      style={{
                        fontSize: '0.75rem',
                        color: entry.totalRefundEth > 0 ? '#16a34a' : '#ccc',
                      }}
                    >
                      {entry.totalRefundEth > 0 ? formatEth(entry.totalRefundEth) : '-'}
                    </span>

                    {/* Net Gas */}
                    <span style={{ fontWeight: 700, fontSize: '0.75rem' }}>
                      {formatEth(entry.netGasCostEth)}
                    </span>

                    {/* Tx Count */}
                    <span style={{ fontSize: '0.75rem', color: '#666' }}>
                      {actionGas ? actionGas.txCount : entry.txCount}
                    </span>

                    {/* Top Action */}
                    <span
                      style={{
                        fontSize: '0.65rem',
                        color: '#888',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {topAction(entry)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          {/* end scroll wrapper */}

          {/* Pagination */}
          {totalPages > 1 && (
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: '12px',
                marginTop: '20px',
                fontSize: '0.8rem',
              }}
            >
              <button
                type="button"
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                style={{
                  padding: '4px 12px',
                  borderRadius: '6px',
                  border: '1px solid #ccc',
                  background: page === 0 ? '#f5f5f5' : '#fff',
                  cursor: page === 0 ? 'default' : 'pointer',
                  fontWeight: 600,
                  color: page === 0 ? '#ccc' : '#333',
                }}
              >
                Prev
              </button>
              <span style={{ color: '#666' }}>
                Page {page + 1} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page >= totalPages - 1}
                style={{
                  padding: '4px 12px',
                  borderRadius: '6px',
                  border: '1px solid #ccc',
                  background: page >= totalPages - 1 ? '#f5f5f5' : '#fff',
                  cursor: page >= totalPages - 1 ? 'default' : 'pointer',
                  fontWeight: 600,
                  color: page >= totalPages - 1 ? '#ccc' : '#333',
                }}
              >
                Next
              </button>
            </div>
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
      <div style={{ fontSize: '1.3rem', fontWeight: 900, lineHeight: 1 }}>{value}</div>
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

function SortHeader({
  label,
  field,
  current,
  onClick,
  indicator,
}: {
  label: string;
  field: SortField;
  current: SortField;
  onClick: (f: SortField) => void;
  indicator: (f: SortField) => string;
}) {
  return (
    <span
      onClick={() => onClick(field)}
      style={{
        cursor: 'pointer',
        userSelect: 'none',
        color: current === field ? '#333' : '#888',
        fontWeight: current === field ? 900 : 700,
      }}
    >
      {label}
      {indicator(field)}
    </span>
  );
}

export default GasLeaderboardPage;
