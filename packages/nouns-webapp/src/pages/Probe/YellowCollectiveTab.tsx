/**
 * YellowCollectiveTab — Grid browser for Yellow Collective NFTs on Base.
 * Fetches token data from the Nouns Builder subgraph on Base.
 */
import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ChevronDown, X } from 'lucide-react';

// ─── Constants ──────────────────────────────────────────────────────────────

const BUILDER_SUBGRAPH =
  'https://api.goldsky.com/api/public/project_cm33ek8kjx6pz010i2c3w8z25/subgraphs/nouns-builder-base-mainnet/latest/gn';
const YC_TOKEN_ADDRESS = '0x220e41499cf4d93a3629a5509410cbf9e6e0b109';
const PAGE_SIZE = 100;

// ─── Types ──────────────────────────────────────────────────────────────────

interface YCToken {
  tokenId: number;
  name: string;
  image: string;
  owner: string;
}

type SortOption = 'id-desc' | 'id-asc';

const sortOptions: { label: string; value: SortOption }[] = [
  { label: 'Latest', value: 'id-desc' },
  { label: 'Oldest', value: 'id-asc' },
];

// ─── Data fetching ──────────────────────────────────────────────────────────

let tokenCache: YCToken[] | null = null;

async function fetchAllTokens(): Promise<YCToken[]> {
  if (tokenCache) return tokenCache;

  const all: YCToken[] = [];
  let skip = 0;
  let hasMore = true;

  while (hasMore) {
    const res = await fetch(BUILDER_SUBGRAPH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `{
          tokens(
            first: ${PAGE_SIZE},
            skip: ${skip},
            where: { dao: "${YC_TOKEN_ADDRESS}" },
            orderBy: tokenId,
            orderDirection: desc
          ) {
            tokenId
            name
            image
            owner { id }
          }
        }`,
      }),
    });

    const json = await res.json();
    const tokens = json?.data?.tokens ?? [];

    for (const t of tokens) {
      all.push({
        tokenId: Number(t.tokenId),
        name: (t.name as string) ?? `Collective Nouns #${t.tokenId}`,
        image: (t.image as string) ?? '',
        owner: (t.owner as { id?: string } | null)?.id ?? '',
      });
    }

    if (tokens.length < PAGE_SIZE) {
      hasMore = false;
    } else {
      skip += PAGE_SIZE;
    }
  }

  tokenCache = all;
  return all;
}

// ─── Owner search ───────────────────────────────────────────────────────────

function shortenAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

// ─── Component ──────────────────────────────────────────────────────────────

const YellowCollectiveTab: FC = () => {
  const [tokens, setTokens] = useState<YCToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [sort, setSort] = useState<SortOption>('id-desc');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [searchId, setSearchId] = useState('');
  // Owner dropdown
  const [ownerDropdownOpen, setOwnerDropdownOpen] = useState(false);
  const [ownerSearch, setOwnerSearch] = useState('');
  const ownerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchAllTokens()
      .then(setTokens)
      .catch((e: unknown) => setError((e instanceof Error ? e.message : String(e)).slice(0, 120)))
      .finally(() => setLoading(false));
  }, []);

  // Close owner dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ownerRef.current && !ownerRef.current.contains(e.target as Node)) {
        setOwnerDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Compute unique owners with counts
  const ownerCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tokens) {
      if (t.owner !== '') map.set(t.owner, (map.get(t.owner) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [tokens]);

  const filteredOwners = useMemo(() => {
    if (!ownerSearch) return ownerCounts.slice(0, 50);
    const q = ownerSearch.toLowerCase();
    return ownerCounts.filter(([addr]) => addr.toLowerCase().includes(q)).slice(0, 50);
  }, [ownerCounts, ownerSearch]);

  // Apply filters + sort
  const filtered = useMemo(() => {
    let result = [...tokens];

    if (searchId) {
      const id = parseInt(searchId, 10);
      if (!isNaN(id)) result = result.filter(t => t.tokenId === id);
    }
    if (ownerFilter) {
      result = result.filter(t => t.owner.toLowerCase() === ownerFilter.toLowerCase());
    }

    result.sort((a, b) => (sort === 'id-desc' ? b.tokenId - a.tokenId : a.tokenId - b.tokenId));

    return result;
  }, [tokens, sort, ownerFilter, searchId]);

  // ─── Selected token detail ────────────────────────────────────────────────

  const [selectedToken, setSelectedToken] = useState<YCToken | null>(null);

  const handleClickToken = useCallback((token: YCToken) => {
    setSelectedToken(prev => (prev?.tokenId === token.tokenId ? null : token));
  }, []);

  // ─── Render ───────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-gray-400">
        Loading Yellow Collective tokens from Base...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-red-400">
        Error: {error}
      </div>
    );
  }

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {/* Search by ID */}
        <input
          type="number"
          placeholder="Search ID..."
          value={searchId}
          onChange={e => setSearchId(e.target.value)}
          className="h-8 w-24 rounded-lg border border-gray-200 bg-white px-2 text-xs outline-none focus:border-gray-400"
        />

        {/* Owner filter */}
        <div ref={ownerRef} className="relative">
          <button
            onClick={() => setOwnerDropdownOpen(!ownerDropdownOpen)}
            className={`flex h-8 items-center gap-1 rounded-lg border px-2 text-xs ${
              ownerFilter
                ? 'border-black bg-black text-white'
                : 'border-gray-200 bg-white text-gray-600'
            }`}
          >
            {ownerFilter ? shortenAddress(ownerFilter) : 'Owner'}
            {ownerFilter ? (
              <X
                size={12}
                onClick={e => {
                  e.stopPropagation();
                  setOwnerFilter('');
                }}
                className="ml-1 cursor-pointer"
              />
            ) : (
              <ChevronDown size={12} />
            )}
          </button>

          {ownerDropdownOpen && (
            <div className="absolute left-0 top-9 z-50 max-h-64 w-64 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
              <input
                type="text"
                placeholder="Search address..."
                value={ownerSearch}
                onChange={e => setOwnerSearch(e.target.value)}
                className="w-full border-b px-3 py-2 text-xs outline-none"
                autoFocus
              />
              {filteredOwners.map(([addr, count]) => (
                <button
                  key={addr}
                  onClick={() => {
                    setOwnerFilter(addr);
                    setOwnerDropdownOpen(false);
                  }}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-xs hover:bg-gray-50"
                >
                  <span className="font-mono">{shortenAddress(addr)}</span>
                  <span className="text-gray-400">{count}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Sort */}
        <select
          value={sort}
          onChange={e => setSort(e.target.value as SortOption)}
          className="h-8 rounded-lg border border-gray-200 bg-white px-2 text-xs outline-none"
        >
          {sortOptions.map(o => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        {/* Count */}
        <span className="ml-auto text-xs text-gray-400">
          {filtered.length} / {tokens.length}
        </span>
      </div>

      {/* Token detail popover */}
      {selectedToken && (
        <div className="mb-3 flex gap-4 rounded-xl border border-gray-200 bg-white p-4">
          <img
            src={selectedToken.image}
            alt={selectedToken.name}
            className="h-32 w-32 rounded-lg"
            loading="lazy"
          />
          <div className="flex flex-col gap-1 text-sm">
            <div
              className="font-bold"
              style={{ fontFamily: "'Londrina Solid', cursive", fontSize: '1.3rem' }}
            >
              {selectedToken.name}
            </div>
            <div className="text-xs text-gray-500">
              Owner:{' '}
              <a
                href={`https://basescan.org/address/${selectedToken.owner}`}
                target="_blank"
                rel="noreferrer"
                className="font-mono text-blue-500 hover:underline"
              >
                {shortenAddress(selectedToken.owner)}
              </a>
            </div>
            <div className="mt-2 flex gap-2">
              <a
                href={`https://nouns.build/dao/base/${YC_TOKEN_ADDRESS}/${selectedToken.tokenId}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
              >
                nouns.build
              </a>
              <a
                href={`https://opensea.io/assets/base/${YC_TOKEN_ADDRESS}/${selectedToken.tokenId}`}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg border px-3 py-1 text-xs text-gray-600 hover:bg-gray-50"
              >
                OpenSea
              </a>
            </div>
          </div>
          <button
            onClick={() => setSelectedToken(null)}
            className="ml-auto self-start text-gray-400 hover:text-gray-600"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Grid — simple CSS grid, ~870 tokens is fine without virtualization */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))',
          gap: 6,
        }}
      >
        {filtered.map(token => (
          <button
            key={token.tokenId}
            onClick={() => handleClickToken(token)}
            className={`aspect-square overflow-hidden rounded-lg border transition-all hover:shadow-md ${
              selectedToken?.tokenId === token.tokenId
                ? 'border-yellow-400 ring-2 ring-yellow-300'
                : 'border-gray-100'
            }`}
            title={token.name}
          >
            <img
              src={token.image}
              alt={token.name}
              loading="lazy"
              className="h-full w-full object-cover"
              style={{ background: '#FFC700' }}
            />
          </button>
        ))}
      </div>
    </div>
  );
};

export default YellowCollectiveTab;
