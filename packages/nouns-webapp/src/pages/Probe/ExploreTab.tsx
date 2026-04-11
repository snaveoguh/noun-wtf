import React, { useEffect, useMemo, useRef, useState } from 'react';

import { ImageData } from '@noundry/nouns-assets';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, Filter, X } from 'lucide-react';
import { range } from 'remeda';

import { Noun } from '@/components/Noun';
import { Trait } from '@/components/Trait';
import { Button } from '@/components/ui/button';
import { useAppSelector } from '@/hooks';
import { type SortOption, type TraitFilter, useNounFilters } from '@/hooks/useNounFilters';
import { useOwnerFilter } from '@/hooks/useOwnerFilter';
import { useNounOwners, useNounSettlers } from '@/hooks/useNounDirectory';
import { traitName } from '@/lib/traitName';
import { useNounSeeds } from '@/wrappers/nounToken';
import { Auction as IAuction } from '@/wrappers/nounsAuction';

const MIN_CELL = 80;
const GAP = 4;

const sortOptions: { label: string; value: SortOption }[] = [
  { label: 'Latest', value: 'id-desc' },
  { label: 'Oldest', value: 'id-asc' },
  { label: 'Most Colorful', value: 'colorfulness-desc' },
  { label: 'Least Colorful', value: 'colorfulness-asc' },
  { label: 'Largest', value: 'area-desc' },
  { label: 'Smallest', value: 'area-asc' },
  { label: 'Brightest', value: 'brightness-desc' },
  { label: 'Darkest', value: 'brightness-asc' },
];

const traitTypes = [
  { key: 'head' as const, label: 'Head', category: 'heads' as const },
  { key: 'glasses' as const, label: 'Noggles', category: 'glasses' as const },
  { key: 'body' as const, label: 'Body', category: 'bodies' as const },
  { key: 'accessory' as const, label: 'Accessory', category: 'accessories' as const },
  { key: 'background' as const, label: 'Background', category: null },
];

/** Searchable dropdown for owner/settler address lists */
function AddressDropdown({
  label,
  entries,
  value,
  onChange,
  loading,
}: {
  label: string;
  entries: { address: string; ens: string | null; count: number }[];
  value: string;
  onChange: (address: string) => void;
  loading: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filtered = useMemo(() => {
    if (!query) return entries.slice(0, 50);
    const q = query.toLowerCase();
    return entries.filter(
      e => e.address.toLowerCase().includes(q) || (e.ens && e.ens.toLowerCase().includes(q)),
    ).slice(0, 50);
  }, [entries, query]);

  const selectedLabel = value
    ? entries.find(e => e.address === value)?.ens ?? `${value.slice(0, 6)}...${value.slice(-4)}`
    : label;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={`border-border flex items-center gap-1 rounded-lg border bg-white px-3 py-2 text-sm ${value ? 'font-semibold text-black' : 'text-gray-400'}`}
      >
        <span className="max-w-32 truncate">{loading ? '...' : selectedLabel}</span>
        {value ? (
          <X
            className="h-3 w-3 shrink-0 text-gray-400 hover:text-red-500"
            onClick={e => { e.stopPropagation(); onChange(''); setOpen(false); }}
          />
        ) : (
          <ChevronDown className="h-3 w-3 shrink-0 text-gray-400" />
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-64 w-64 overflow-hidden rounded-xl border bg-white shadow-xl">
          <input
            type="text"
            placeholder="Search..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full border-b px-3 py-2 text-sm focus:outline-none"
            autoFocus
          />
          <div className="max-h-52 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-2 text-xs text-gray-400">No results</p>
            ) : (
              filtered.map(e => (
                <button
                  key={e.address}
                  onClick={() => { onChange(e.address); setOpen(false); setQuery(''); }}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-gray-50"
                >
                  <span className="truncate font-medium">
                    {e.ens ?? `${e.address.slice(0, 8)}...${e.address.slice(-4)}`}
                  </span>
                  <span className="ml-2 shrink-0 text-gray-400">{e.count}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const ExploreTab: React.FC = () => {
  const currentAuction: IAuction | undefined = useAppSelector(state => state.auction.activeAuction);
  const currentAuctionNounId = currentAuction ? BigInt(currentAuction.nounId) : undefined;
  const nounCount = currentAuctionNounId !== undefined ? Number(currentAuctionNounId) + 1 : -1;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nounsList = useMemo(() => range(0, nounCount).map(BigInt), [nounCount]);

  const seeds = useNounSeeds();
  const { ownerAddress, setOwnerAddress, ownedNounIds } = useOwnerFilter();
  const { owners, loading: ownersLoading } = useNounOwners();
  const { settlers, loading: settlersLoading } = useNounSettlers();

  // Settler filter state
  const [settlerAddress, setSettlerAddress] = useState('');

  const {
    sortBy,
    setSortBy,
    search,
    setSearch,
    traitFilters,
    toggleTraitFilter,
    clearFilters,
    hasActiveFilters,
    filteredAndSorted,
  } = useNounFilters(nounsList, seeds, ownedNounIds);

  const [showTraits, setShowTraits] = useState(false);

  // Measure container
  const [layout, setLayout] = React.useState({ cols: 8, cellSize: MIN_CELL });
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const cols = Math.max(3, Math.floor((w + GAP) / (MIN_CELL + GAP)));
      const cellSize = Math.floor((w - GAP * (cols - 1)) / cols);
      setLayout({ cols, cellSize });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const displayCount = filteredAndSorted.length;
  const totalRows = Math.ceil(displayCount / layout.cols);
  const rowHeight = layout.cellSize + GAP;

  const rowVirtualizer = useVirtualizer({
    count: totalRows,
    getScrollElement: () => containerRef.current,
    estimateSize: () => rowHeight,
    overscan: 4,
  });

  const activeFilterCount = Object.values(traitFilters).reduce((sum, arr) => sum + arr.length, 0)
    + (ownerAddress ? 1 : 0) + (settlerAddress ? 1 : 0);

  return (
    <>
      {/* Compact filter bar — single row */}
      <div className="flex flex-wrap items-center gap-2 py-3">
        <input
          type="text"
          placeholder="Search ID..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border-border w-28 rounded-lg border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
        />

        <AddressDropdown
          label="Owner"
          entries={owners}
          value={ownerAddress}
          onChange={setOwnerAddress}
          loading={ownersLoading}
        />

        <AddressDropdown
          label="Settler"
          entries={settlers}
          value={settlerAddress}
          onChange={setSettlerAddress}
          loading={settlersLoading}
        />

        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as SortOption)}
          className="border-border rounded-lg border bg-white px-3 py-2 text-sm"
        >
          {sortOptions.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        <Button
          variant={showTraits ? 'default' : 'outline'}
          size="sm"
          onClick={() => setShowTraits(!showTraits)}
          className="gap-1"
        >
          <Filter className="h-4 w-4" />
          Traits
          {activeFilterCount > 0 && (
            <span className="ml-1 rounded-full bg-red-500 px-1.5 py-0.5 text-xs text-white">
              {activeFilterCount}
            </span>
          )}
        </Button>

        {activeFilterCount > 0 && (
          <Button variant="ghost" size="sm" onClick={() => { clearFilters(); setOwnerAddress(''); setSettlerAddress(''); }} className="gap-1 text-red-500">
            <X className="h-4 w-4" /> Clear
          </Button>
        )}

        <span className="text-muted-foreground ml-auto text-sm">
          {hasActiveFilters || ownerAddress || settlerAddress
            ? `${displayCount} / ${nounCount >= 0 ? nounCount : 0}`
            : nounCount >= 0 ? nounCount : 0} Nouns
        </span>
      </div>

      {/* Trait filter panel */}
      {showTraits && (
        <div className="mb-3 rounded-xl border bg-white p-4 shadow-sm">
          <div className="space-y-2">
            {traitTypes.map(({ key, label }) => {
              const selectedCount = traitFilters[key].length;
              const traitCount = key === 'background'
                ? ImageData.bgcolors.length
                : ImageData.images[key === 'head' ? 'heads' : key === 'body' ? 'bodies' : key === 'accessory' ? 'accessories' : 'glasses'].length;

              return (
                <TraitFilterRow
                  key={key}
                  traitKey={key}
                  label={label}
                  traitCount={traitCount}
                  selectedCount={selectedCount}
                  traitFilters={traitFilters}
                  onToggle={toggleTraitFilter}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Grid — no container border, flush */}
      <div
        ref={containerRef}
        className="h-[calc(100vh-220px)] min-h-[400px] overflow-y-auto overscroll-contain"
      >
        <div
          style={{
            height: `${rowVirtualizer.getTotalSize()}px`,
            position: 'relative',
          }}
        >
          {rowVirtualizer.getVirtualItems().map(virtualRow => {
            const startIdx = virtualRow.index * layout.cols;
            return (
              <div
                key={virtualRow.key}
                style={{
                  position: 'absolute',
                  top: `${virtualRow.start}px`,
                  left: 0,
                  right: 0,
                  display: 'grid',
                  gridTemplateColumns: `repeat(${layout.cols}, ${layout.cellSize}px)`,
                  gap: `${GAP}px`,
                }}
              >
                {Array.from({ length: layout.cols }, (_, colIdx) => {
                  const itemIndex = startIdx + colIdx;
                  if (itemIndex >= displayCount) return <div key={colIdx} />;

                  const nounId = filteredAndSorted[itemIndex];
                  return (
                    <div
                      key={`${nounId}`}
                      className="group relative cursor-pointer overflow-clip rounded-xl transition-transform hover:scale-105 hover:shadow-lg"
                      style={{ width: layout.cellSize, height: layout.cellSize }}
                    >
                      <Noun
                        nounId={nounId != null ? BigInt(nounId) : undefined}
                        loadingNounFallback
                        minFallbackDuration={1000}
                        hoverCard
                        style={{ width: layout.cellSize, height: layout.cellSize }}
                        className="bg-cool-background"
                      />
                      <span className="absolute bottom-0.5 left-1/2 hidden -translate-x-1/2 rounded bg-white/90 px-1 text-[10px] font-bold shadow-sm group-hover:block">
                        {nounId.toString()}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
};

/** Expandable trait filter row */
function TraitFilterRow({
  traitKey,
  label,
  traitCount,
  selectedCount,
  traitFilters,
  onToggle,
}: {
  traitKey: keyof TraitFilter;
  label: string;
  traitCount: number;
  selectedCount: number;
  traitFilters: TraitFilter;
  onToggle: (type: keyof TraitFilter, index: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-border rounded-lg border">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-semibold hover:bg-gray-50"
      >
        <span>
          {label}
          {selectedCount > 0 && (
            <span className="ml-2 rounded-full bg-black px-2 py-0.5 text-xs text-white">
              {selectedCount}
            </span>
          )}
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded && (
        <div className="flex max-h-48 flex-wrap gap-1 overflow-y-auto border-t p-2">
          {Array.from({ length: traitCount }, (_, i) => {
            const isSelected = traitFilters[traitKey].includes(i);
            const name = traitKey === 'background' ? (i === 0 ? 'Cool' : 'Warm') : traitName(traitKey, i);

            return (
              <button
                key={i}
                onClick={() => onToggle(traitKey, i)}
                className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-all ${
                  isSelected ? 'border-black bg-black text-white' : 'border-gray-200 hover:border-gray-400'
                }`}
              >
                {traitKey !== 'background' && (
                  <Trait type={traitKey} seed={i} className="h-6 w-6 rounded" />
                )}
                {traitKey === 'background' && (
                  <div className="h-6 w-6 rounded" style={{ backgroundColor: `#${ImageData.bgcolors[i]}` }} />
                )}
                <span className="max-w-20 truncate">{name}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default ExploreTab;
