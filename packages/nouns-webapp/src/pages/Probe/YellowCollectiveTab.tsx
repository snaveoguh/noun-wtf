/**
 * YellowCollectiveTab — Grid browser for Yellow Collective NFTs on Base.
 * Fetches token data from the Nouns Builder subgraph on Base.
 * Hover/tap a token to see traits, owner, and external links.
 * Clicking a trait in the popover filters the grid to that trait.
 */
import { FC, useEffect, useMemo, useRef, useState } from 'react';

import { ChevronDownIcon, XIcon } from 'lucide-react';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

import { BuilderTokenHoverCard } from '@/components/BuilderTokenHoverCard';
import {
  BuilderTrait,
  orderTraitsForDisplay,
  parseBuilderTraitsFromImage,
} from '@/lib/builderTraits';
import { stripNoggles } from '@/utils/addressAndENSDisplayUtils';

// ─── ENS resolution ────────────────────────────────────────────────────────

const ensClient = createPublicClient({
  chain: mainnet,
  transport: http('https://ethereum-rpc.publicnode.com'),
});
const ensCache = new Map<string, string | null>();

async function resolveENS(addresses: string[]): Promise<Map<string, string>> {
  const results = new Map<string, string>();
  const toResolve = addresses.filter(
    a =>
      a !== '' &&
      a !== '0x0000000000000000000000000000000000000000' &&
      !ensCache.has(a.toLowerCase()),
  );

  for (let i = 0; i < toResolve.length; i += 20) {
    const batch = toResolve.slice(i, i + 20);
    const settled = await Promise.allSettled(
      batch.map(async addr => {
        const name = await ensClient.getEnsName({ address: addr as `0x${string}` });
        ensCache.set(addr.toLowerCase(), name);
        return [addr.toLowerCase(), name] as const;
      }),
    );
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value[1] !== null && r.value[1] !== undefined) {
        results.set(r.value[0], r.value[1]);
      }
    }
  }

  for (const addr of addresses) {
    const cached = ensCache.get(addr.toLowerCase());
    if (cached !== null && cached !== undefined) results.set(addr.toLowerCase(), cached);
  }
  return results;
}

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
  traits: BuilderTrait[];
}

type SortOption = 'id-desc' | 'id-asc';

const sortOptions: { label: string; value: SortOption }[] = [
  { label: 'Latest', value: 'id-desc' },
  { label: 'Oldest', value: 'id-asc' },
];

// ─── Data fetching ──────────────────────────────────────────────────────────

let tokenCache: YCToken[] | null = null;

async function fetchAllTokens(): Promise<YCToken[]> {
  if (tokenCache !== null) return tokenCache;

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
      const ownerRaw = t.owner;
      const ownerAddr =
        typeof ownerRaw === 'string' ? ownerRaw : ((ownerRaw as { id?: string } | null)?.id ?? '');
      const image = (t.image as string) ?? '';
      all.push({
        tokenId: Number(t.tokenId),
        name: (t.name as string) ?? `Collective Nouns #${t.tokenId}`,
        image,
        owner: ownerAddr,
        traits: orderTraitsForDisplay(parseBuilderTraitsFromImage(image)),
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

// ─── Owner helpers ──────────────────────────────────────────────────────────

function shortenAddress(addr: string): string {
  if (addr === '' || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function displayName(addr: string, names: Map<string, string>): string {
  if (addr === '') return '';
  const ens = names.get(addr.toLowerCase());
  if (ens !== undefined && ens !== '') {
    const stripped = stripNoggles(ens);
    if (stripped !== '') return stripped;
  }
  return shortenAddress(addr);
}

// ─── Component ──────────────────────────────────────────────────────────────

const YellowCollectiveTab: FC = () => {
  const [tokens, setTokens] = useState<YCToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ensNames, setEnsNames] = useState<Map<string, string>>(new Map());

  const [sort, setSort] = useState<SortOption>('id-desc');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [searchId, setSearchId] = useState('');
  const [traitFilter, setTraitFilter] = useState<BuilderTrait | null>(null);
  const [ownerDropdownOpen, setOwnerDropdownOpen] = useState(false);
  const [ownerSearch, setOwnerSearch] = useState('');
  const ownerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchAllTokens()
      .then(setTokens)
      .catch((e: unknown) => setError((e instanceof Error ? e.message : String(e)).slice(0, 120)))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (tokens.length === 0) return;
    const uniqueOwners = [...new Set(tokens.map(t => t.owner).filter(Boolean))];
    resolveENS(uniqueOwners)
      .then(setEnsNames)
      .catch(() => {});
  }, [tokens]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ownerRef.current !== null && !ownerRef.current.contains(e.target as Node)) {
        setOwnerDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const ownerCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of tokens) {
      if (t.owner !== '') map.set(t.owner, (map.get(t.owner) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [tokens]);

  const filteredOwners = useMemo(() => {
    if (ownerSearch === '') return ownerCounts.slice(0, 50);
    const q = ownerSearch.toLowerCase();
    return ownerCounts.filter(([addr]) => addr.toLowerCase().includes(q)).slice(0, 50);
  }, [ownerCounts, ownerSearch]);

  const filtered = useMemo(() => {
    let result = [...tokens];

    if (searchId !== '') {
      const id = parseInt(searchId, 10);
      if (!isNaN(id)) result = result.filter(t => t.tokenId === id);
    }
    if (ownerFilter !== '') {
      result = result.filter(t => t.owner.toLowerCase() === ownerFilter.toLowerCase());
    }
    if (traitFilter !== null) {
      result = result.filter(t =>
        t.traits.some(x => x.layer === traitFilter.layer && x.slug === traitFilter.slug),
      );
    }

    result.sort((a, b) => (sort === 'id-desc' ? b.tokenId - a.tokenId : a.tokenId - b.tokenId));

    return result;
  }, [tokens, sort, ownerFilter, searchId, traitFilter]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-gray-400">
        Loading Yellow Collective tokens from Base...
      </div>
    );
  }

  if (error !== null) {
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
        <input
          type="number"
          placeholder="Search ID..."
          value={searchId}
          onChange={e => setSearchId(e.target.value)}
          className="h-8 w-24 rounded-lg border border-gray-200 bg-white px-2 text-xs outline-none focus:border-gray-400"
        />

        <div ref={ownerRef} className="relative">
          <button
            type="button"
            onClick={() => setOwnerDropdownOpen(!ownerDropdownOpen)}
            className={`flex h-8 items-center gap-1 rounded-lg border px-2 text-xs ${
              ownerFilter !== ''
                ? 'border-black bg-black text-white'
                : 'border-gray-200 bg-white text-gray-600'
            }`}
          >
            {ownerFilter !== '' ? displayName(ownerFilter, ensNames) : 'Owner'}
            {ownerFilter !== '' ? (
              <XIcon
                size={12}
                onClick={e => {
                  e.stopPropagation();
                  setOwnerFilter('');
                }}
                className="ml-1 cursor-pointer"
              />
            ) : (
              <ChevronDownIcon size={12} />
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
                  type="button"
                  onClick={() => {
                    setOwnerFilter(addr);
                    setOwnerDropdownOpen(false);
                  }}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-xs hover:bg-gray-50"
                >
                  <span className="font-mono">{displayName(addr, ensNames)}</span>
                  <span className="text-gray-400">{count}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Active trait chip */}
        {traitFilter !== null && (
          <button
            type="button"
            onClick={() => setTraitFilter(null)}
            className="flex h-8 items-center gap-1 rounded-lg border border-yellow-400 bg-yellow-300 px-2 text-xs font-semibold text-black"
          >
            <span className="font-mono text-[10px] uppercase opacity-60">{traitFilter.layer}:</span>
            <span>{traitFilter.label}</span>
            <XIcon size={12} className="ml-1" />
          </button>
        )}

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

        <span className="ml-auto text-xs text-gray-400">
          {filtered.length} / {tokens.length}
        </span>
      </div>

      {/* Grid with hover popovers */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))',
          gap: 6,
        }}
      >
        {filtered.map(token => (
          <BuilderTokenHoverCard
            key={token.tokenId}
            token={token}
            ownerDisplayName={displayName(token.owner, ensNames)}
            chainSlug="base"
            daoAddress={YC_TOKEN_ADDRESS}
            accentColor="#FFC700"
            onTraitClick={setTraitFilter}
            activeTrait={traitFilter}
          >
            <button
              type="button"
              className="aspect-square overflow-hidden rounded-lg border border-gray-100 transition-all hover:shadow-md"
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
          </BuilderTokenHoverCard>
        ))}
      </div>
    </div>
  );
};

export default YellowCollectiveTab;
