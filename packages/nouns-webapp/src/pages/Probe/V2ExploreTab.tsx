/**
 * V2ExploreTab — Grid browser for NounV2 tokens.
 *
 * V2 has no Ponder indexer, so unlike the V1 `ExploreTab` (which pulls seeds
 * / owners / settlers from the mainnet indexer) this reads everything live
 * from the NounV2 token contract via a single multicall:
 *   - `seeds(id)`   → render the art client-side with `getNoun(id, seed, true)`
 *   - `ownerOf(id)` → owner filter + burned detection (ownerOf reverts on burn)
 *
 * The V2 collection is small (tens of nouns), so a full multicall + plain
 * grid is cheap — no virtualization needed. Clicking a cell opens the
 * `/v2/noun/:id` page.
 */
import { FC, useMemo, useState, useRef, useEffect } from 'react';

import { ChevronDownIcon, XIcon } from 'lucide-react';
import { useNavigate } from 'react-router';
import { range } from 'remeda';
import { useReadContracts } from 'wagmi';

import { getNoun } from '@/components/StandaloneNoun';
import { NOUNV2_TOKEN_ADDRESS, nounV2TokenAbi } from '@/contracts/nounv2-token';
import { nounV2Path } from '@/utils/history';
import type { INounSeed } from '@/wrappers/nounToken';
import useV2OnDisplayAuction from '@/wrappers/onDisplayAuctionV2';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

type SortOption = 'id-desc' | 'id-asc';

const sortOptions: { label: string; value: SortOption }[] = [
  { label: 'Latest', value: 'id-desc' },
  { label: 'Oldest', value: 'id-asc' },
];

interface V2Noun {
  nounId: number;
  seed: INounSeed;
  image: string;
  owner: string; // '' when burned / unresolved
  burned: boolean;
}

function shortenAddress(addr: string): string {
  if (addr === '' || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/** Searchable address filter dropdown (Settler / Curated), mirrors the inline Owner one. */
function AddressFilterDropdown({
  label,
  counts,
  value,
  onChange,
}: {
  label: string;
  counts: Array<[string, number]>;
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const shown = useMemo(() => {
    if (search === '') return counts.slice(0, 50);
    const q = search.toLowerCase();
    return counts.filter(([a]) => a.toLowerCase().includes(q)).slice(0, 50);
  }, [counts, search]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`flex h-8 items-center gap-1 rounded-lg border px-2 text-xs ${
          value !== '' ? 'border-black bg-black text-white' : 'border-gray-200 bg-white text-gray-600'
        }`}
      >
        {value !== '' ? shortenAddress(value) : label}
        {value !== '' ? (
          <XIcon
            size={12}
            onClick={e => {
              e.stopPropagation();
              onChange('');
            }}
            className="ml-1 cursor-pointer"
          />
        ) : (
          <ChevronDownIcon size={12} />
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-9 z-50 max-h-64 w-64 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg">
          <input
            type="text"
            placeholder="Search address..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full border-b px-3 py-2 text-xs outline-none"
            autoFocus
          />
          {shown.length === 0 ? (
            <p className="px-3 py-2 text-xs text-gray-400">None yet</p>
          ) : (
            shown.map(([addr, c]) => (
              <button
                key={addr}
                type="button"
                onClick={() => {
                  onChange(addr);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between px-3 py-1.5 text-xs hover:bg-gray-50"
              >
                <span className="font-mono">{shortenAddress(addr)}</span>
                <span className="text-gray-400">{c}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

const V2ExploreTab: FC = () => {
  const navigate = useNavigate();
  const liveAuction = useV2OnDisplayAuction();
  const liveId = liveAuction ? Number(liveAuction.nounId) : undefined;
  const count = liveId !== undefined ? liveId + 1 : 0;

  const ids = useMemo(() => range(0, count), [count]);

  const configured = NOUNV2_TOKEN_ADDRESS !== ZERO_ADDRESS;

  // One multicall each for seeds + owners across every minted V2 noun.
  // allowFailure (default) keeps a burned noun's reverting `ownerOf` from
  // nuking the whole batch — we read the revert as "burned".
  const seedContracts = useMemo(
    () =>
      ids.map(id => ({
        address: NOUNV2_TOKEN_ADDRESS,
        abi: nounV2TokenAbi,
        functionName: 'seeds' as const,
        args: [BigInt(id)] as const,
      })),
    [ids],
  );
  const ownerContracts = useMemo(
    () =>
      ids.map(id => ({
        address: NOUNV2_TOKEN_ADDRESS,
        abi: nounV2TokenAbi,
        functionName: 'ownerOf' as const,
        args: [BigInt(id)] as const,
      })),
    [ids],
  );

  const { data: seedResults, isLoading: seedsLoading } = useReadContracts({
    contracts: seedContracts,
    query: {
      enabled: configured && count > 0,
      staleTime: 5 * 60_000,
      gcTime: 30 * 60_000,
    },
  });
  const { data: ownerResults } = useReadContracts({
    contracts: ownerContracts,
    query: {
      enabled: configured && count > 0,
      staleTime: 60_000,
      gcTime: 30 * 60_000,
    },
  });

  const nouns = useMemo<V2Noun[]>(() => {
    if (!seedResults) return [];
    const out: V2Noun[] = [];
    for (let i = 0; i < ids.length; i++) {
      const seedRes = seedResults[i];
      if (seedRes?.status !== 'success' || seedRes.result == null) continue;
      const tuple = seedRes.result as readonly [
        number | bigint,
        number | bigint,
        number | bigint,
        number | bigint,
        number | bigint,
      ];
      const seed: INounSeed = {
        background: Number(tuple[0]),
        body: Number(tuple[1]),
        accessory: Number(tuple[2]),
        head: Number(tuple[3]),
        glasses: Number(tuple[4]),
      };

      const ownerRes = ownerResults?.[i];
      const burned = ownerRes?.status === 'failure';
      const owner =
        ownerRes?.status === 'success' ? String(ownerRes.result).toLowerCase() : '';

      let image = '';
      try {
        image = getNoun(BigInt(ids[i]), seed, true).image;
      } catch {
        image = '';
      }

      out.push({ nounId: ids[i], seed, image, owner, burned });
    }
    return out;
  }, [seedResults, ownerResults, ids]);

  // ─── Filters ────────────────────────────────────────────────────────────
  const [sort, setSort] = useState<SortOption>('id-desc');
  const [searchId, setSearchId] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('');
  const [ownerDropdownOpen, setOwnerDropdownOpen] = useState(false);
  const [ownerSearch, setOwnerSearch] = useState('');
  const ownerRef = useRef<HTMLDivElement>(null);

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
    for (const n of nouns) {
      if (n.owner !== '' && n.owner !== ZERO_ADDRESS) {
        map.set(n.owner, (map.get(n.owner) ?? 0) + 1);
      }
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [nouns]);

  const filteredOwners = useMemo(() => {
    if (ownerSearch === '') return ownerCounts.slice(0, 50);
    const q = ownerSearch.toLowerCase();
    return ownerCounts.filter(([addr]) => addr.toLowerCase().includes(q)).slice(0, 50);
  }, [ownerCounts, ownerSearch]);

  // Settler / curated filters — from static V2 snapshots (settler of N = tx.from
  // of N+1's creation; curated is the +1 shift). Generated by snapshot-settlers-v2.mjs.
  const [settlerByNoun, setSettlerByNoun] = useState<Record<string, string>>({});
  const [curatedByNoun, setCuratedByNoun] = useState<Record<string, string>>({});
  const [settlerFilter, setSettlerFilter] = useState('');
  const [curatedFilter, setCuratedFilter] = useState('');

  useEffect(() => {
    fetch('/probe-dreams/settlers-v2.json')
      .then(r => r.json())
      .then(setSettlerByNoun)
      .catch(() => undefined);
    fetch('/probe-dreams/curated-v2.json')
      .then(r => r.json())
      .then(setCuratedByNoun)
      .catch(() => undefined);
  }, []);

  const settlerCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of Object.values(settlerByNoun)) {
      const k = a.toLowerCase();
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [settlerByNoun]);

  const curatedCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of Object.values(curatedByNoun)) {
      const k = a.toLowerCase();
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [curatedByNoun]);

  const filtered = useMemo(() => {
    let result = [...nouns];
    if (searchId !== '') {
      const id = parseInt(searchId, 10);
      if (!isNaN(id)) result = result.filter(n => n.nounId === id);
    }
    if (ownerFilter !== '') {
      result = result.filter(n => n.owner === ownerFilter.toLowerCase());
    }
    if (settlerFilter !== '') {
      result = result.filter(n => (settlerByNoun[String(n.nounId)] ?? '').toLowerCase() === settlerFilter);
    }
    if (curatedFilter !== '') {
      result = result.filter(n => (curatedByNoun[String(n.nounId)] ?? '').toLowerCase() === curatedFilter);
    }
    result.sort((a, b) => (sort === 'id-desc' ? b.nounId - a.nounId : a.nounId - b.nounId));
    return result;
  }, [nouns, searchId, ownerFilter, settlerFilter, curatedFilter, settlerByNoun, curatedByNoun, sort]);

  if (!configured) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-gray-400">
        NounV2 token address not configured.
      </div>
    );
  }

  if (seedsLoading && nouns.length === 0) {
    return (
      <div className="flex items-center justify-center py-20 text-sm text-gray-400">
        Loading NounV2 tokens from chain…
      </div>
    );
  }

  return (
    <div>
      {/* Toolbar — mirrors the other probe tabs */}
      <div className="mb-2 flex flex-wrap items-center gap-2 py-1">
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
            {ownerFilter !== '' ? shortenAddress(ownerFilter) : 'Owner'}
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
              {filteredOwners.length === 0 ? (
                <p className="px-3 py-2 text-xs text-gray-400">No holders yet</p>
              ) : (
                filteredOwners.map(([addr, ownerCount]) => (
                  <button
                    key={addr}
                    type="button"
                    onClick={() => {
                      setOwnerFilter(addr);
                      setOwnerDropdownOpen(false);
                    }}
                    className="flex w-full items-center justify-between px-3 py-1.5 text-xs hover:bg-gray-50"
                  >
                    <span className="font-mono">{shortenAddress(addr)}</span>
                    <span className="text-gray-400">{ownerCount}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>

        <AddressFilterDropdown
          label="Settler"
          counts={settlerCounts}
          value={settlerFilter}
          onChange={setSettlerFilter}
        />
        <AddressFilterDropdown
          label="Curated"
          counts={curatedCounts}
          value={curatedFilter}
          onChange={setCuratedFilter}
        />

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
          {searchId !== '' || ownerFilter !== '' || settlerFilter !== '' || curatedFilter !== ''
            ? `${filtered.length} / ${nouns.length}`
            : nouns.length}{' '}
          Nouns
        </span>
      </div>

      {/* Grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))',
          gap: 6,
        }}
      >
        {filtered.map(n => (
          <button
            key={n.nounId}
            type="button"
            onClick={() => navigate(nounV2Path(n.nounId))}
            title={`Noun ${n.nounId}${n.burned ? ' (burned)' : ''}`}
            className={`group relative aspect-square overflow-hidden rounded-lg border border-gray-100 transition-all hover:scale-105 hover:shadow-md ${
              n.burned ? 'grayscale' : ''
            }`}
          >
            {n.image !== '' && (
              <img
                src={n.image}
                alt={`Noun ${n.nounId}`}
                loading="lazy"
                className="h-full w-full object-cover"
                style={{ background: '#e1d7d5' }}
              />
            )}
            <span className="absolute bottom-0.5 left-1/2 hidden -translate-x-1/2 rounded bg-white/90 px-1 text-[10px] font-bold shadow-sm group-hover:block">
              {n.nounId}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default V2ExploreTab;
