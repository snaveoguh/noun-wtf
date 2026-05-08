/* eslint-disable @typescript-eslint/strict-boolean-expressions */
import React, { useEffect, useMemo, useRef, useState } from 'react';

import { ImageData } from '@noundry/nouns-assets';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { Box, ChevronDown, Filter, X } from 'lucide-react';
import { range } from 'remeda';

import { Noun } from '@/components/Noun';
const Noun3DGrid = React.lazy(() => import('@/components/Noun3DCell'));

interface NounCell {
  nounId: bigint;
  seed: import('@/wrappers/nounToken').INounSeed;
  cx: number;
  cy: number;
  size: number;
}
import NounDetailPopover from '@/components/NounDetailPopover';
import { Trait } from '@/components/Trait';
import { Button } from '@/components/ui/button';
import { useAppSelector } from '@/hooks';
import { useNounOwners, useNounSettlers, useNounCurators } from '@/hooks/useNounDirectory';
import { type SortOption, type TraitFilter, useNounFilters } from '@/hooks/useNounFilters';
import { useOwnerFilter } from '@/hooks/useOwnerFilter';
import { traitName } from '@/lib/traitName';
import { Auction as IAuction } from '@/wrappers/nounsAuction';
import { useBurnedNounIds, useNounSeeds } from '@/wrappers/nounToken';

const MIN_CELL = 72;
const GAP = 6;

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
    return entries
      .filter(
        e => e.address.toLowerCase().includes(q) || (e.ens && e.ens.toLowerCase().includes(q)),
      )
      .slice(0, 50);
  }, [entries, query]);

  const selectedLabel = value
    ? (entries.find(e => e.address === value)?.ens ?? `${value.slice(0, 6)}...${value.slice(-4)}`)
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
            onClick={e => {
              e.stopPropagation();
              onChange('');
              setOpen(false);
            }}
          />
        ) : (
          <ChevronDown className="h-3 w-3 shrink-0 text-gray-400" />
        )}
      </button>

      {open && (
        <div className="fixed left-2 right-2 top-auto z-50 mt-1 max-h-64 overflow-hidden rounded-xl border bg-white shadow-xl sm:absolute sm:left-0 sm:right-auto sm:w-64">
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
                  onClick={() => {
                    onChange(e.address);
                    setOpen(false);
                    setQuery('');
                  }}
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
  const burnedIds = useBurnedNounIds();
  const { ownerAddress, setOwnerAddress, ownedNounIds } = useOwnerFilter();

  // 3D view mode — defaults off because the voxel grid doesn't always finish
  // loading reliably on first paint; user opts in via the toggle.
  const [view3D, setView3D] = useState(false);
  const [hoveredNounId, setHoveredNounId] = useState<bigint | null>(null);
  const [mousePos, setMousePos] = useState<{ x: number; y: number } | null>(null);

  // Click-to-open detail popover
  const [popover, setPopover] = useState<{ nounId: bigint; rect: DOMRect } | null>(null);
  const { owners, loading: ownersLoading } = useNounOwners();
  const { settlers, loading: settlersLoading } = useNounSettlers();
  const { curators, loading: curatorsLoading } = useNounCurators();

  // Settler filter state — loads from static settlers.json
  const [settlerAddress, setSettlerAddress] = useState('');
  const [settlerNounIds, setSettlerNounIds] = useState<Set<bigint> | undefined>(undefined);

  useEffect(() => {
    if (!settlerAddress) {
      setSettlerNounIds(undefined);
      return;
    }
    fetch('/probe-dreams/settlers.json')
      .then(r => r.json())
      .then((data: Record<string, string>) => {
        const ids = new Set<bigint>();
        for (const [nounId, addr] of Object.entries(data)) {
          if (addr.toLowerCase() === settlerAddress.toLowerCase()) ids.add(BigInt(nounId));
        }
        setSettlerNounIds(ids);
      })
      .catch(() => setSettlerNounIds(new Set()));
  }, [settlerAddress]);

  // Curated filter state — loads from static curated.json
  const [curatorAddress, setCuratorAddress] = useState('');
  const [curatedNounIds, setCuratedNounIds] = useState<Set<bigint> | undefined>(undefined);

  useEffect(() => {
    if (!curatorAddress) {
      setCuratedNounIds(undefined);
      return;
    }
    fetch('/probe-dreams/curated.json')
      .then(r => r.json())
      .then((data: Record<string, string>) => {
        const ids = new Set<bigint>();
        for (const [nounId, addr] of Object.entries(data)) {
          if (addr.toLowerCase() === curatorAddress.toLowerCase()) ids.add(BigInt(nounId));
        }
        setCuratedNounIds(ids);
      })
      .catch(() => setCuratedNounIds(new Set()));
  }, [curatorAddress]);

  // Combine owner + settler + curated filters (intersection)
  const combinedFilterIds = useMemo(() => {
    const sets = [ownedNounIds, settlerNounIds, curatedNounIds].filter(Boolean) as Set<bigint>[];
    if (sets.length === 0) return undefined;
    if (sets.length === 1) return sets[0];
    // Intersection of all active filters
    let result = sets[0];
    for (let i = 1; i < sets.length; i++) {
      const next = new Set<bigint>();
      for (const id of result) {
        if (sets[i].has(id)) next.add(id);
      }
      result = next;
    }
    return result;
  }, [ownedNounIds, settlerNounIds, curatedNounIds]);

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
  } = useNounFilters(nounsList, seeds, combinedFilterIds);

  const [showTraits, setShowTraits] = useState(false);

  // Measure container
  const [layout, setLayout] = React.useState({ cols: 8, cellSize: MIN_CELL });
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth;
      const cols = Math.max(3, Math.floor(w / (MIN_CELL + GAP)));
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

  const rowVirtualizer = useWindowVirtualizer({
    count: totalRows,
    estimateSize: () => rowHeight,
    overscan: 5,
    scrollMargin: containerRef.current?.offsetTop ?? 0,
  });

  const activeFilterCount =
    Object.values(traitFilters).reduce((sum, arr) => sum + arr.length, 0) +
    (ownerAddress ? 1 : 0) +
    (settlerAddress ? 1 : 0) +
    (curatorAddress ? 1 : 0);

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

        <AddressDropdown
          label="Curated"
          entries={curators}
          value={curatorAddress}
          onChange={setCuratorAddress}
          loading={curatorsLoading}
        />

        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as SortOption)}
          className="border-border rounded-lg border bg-white px-3 py-2 text-sm"
        >
          {sortOptions.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <Button
          variant={view3D ? 'default' : 'outline'}
          size="sm"
          onClick={() => setView3D(!view3D)}
          className="gap-1"
        >
          <Box className="h-4 w-4" />
          3D
          {view3D && (seeds == null || Object.keys(seeds).length < 1500) && (
            <span className="ml-1 inline-flex items-center gap-1 font-mono text-[10px] opacity-70">
              <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-current" />
              {seeds == null ? 'loading…' : `${Object.keys(seeds).length.toLocaleString()}`}
            </span>
          )}
        </Button>

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
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              clearFilters();
              setOwnerAddress('');
              setSettlerAddress('');
              setCuratorAddress('');
            }}
            className="gap-1 text-red-500"
          >
            <X className="h-4 w-4" /> Clear
          </Button>
        )}

        <span className="text-muted-foreground ml-auto text-sm">
          {hasActiveFilters || ownerAddress || settlerAddress || curatorAddress
            ? `${displayCount} / ${nounCount >= 0 ? nounCount : 0}`
            : nounCount >= 0
              ? nounCount
              : 0}{' '}
          Nouns
        </span>
      </div>

      {/* Trait filter panel */}
      {showTraits && (
        <div className="mb-3 rounded-xl border bg-white p-4 shadow-sm">
          <div className="space-y-2">
            {traitTypes.map(({ key, label }) => {
              const selectedCount = traitFilters[key].length;
              const traitCount =
                key === 'background'
                  ? ImageData.bgcolors.length
                  : ImageData.images[
                      key === 'head'
                        ? 'heads'
                        : key === 'body'
                          ? 'bodies'
                          : key === 'accessory'
                            ? 'accessories'
                            : 'glasses'
                    ].length;

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

      {/* Grid — extends page, no separate scroll */}
      <div
        ref={containerRef}
        style={{ overflow: 'hidden', position: 'relative' }}
        onMouseMove={view3D ? e => setMousePos({ x: e.clientX, y: e.clientY }) : undefined}
        onMouseLeave={view3D ? () => setMousePos(null) : undefined}
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
                  top: `${virtualRow.start - (rowVirtualizer.options.scrollMargin ?? 0)}px`,
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
                  const hasSeed = seeds?.[nounId.toString()] != null;
                  const isBurned = burnedIds?.has(nounId) ?? false;
                  // Burned nouns are rendered via the 2D SVG path so the
                  // grayscale CSS filter on the cell wrapper applies — the
                  // 3D voxel overlay lives outside the wrapper and wouldn't
                  // pick it up.
                  const show2D = !view3D || !hasSeed || isBurned;

                  return (
                    <div
                      key={`${nounId}`}
                      onClick={e => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setPopover(prev => (prev?.nounId === nounId ? null : { nounId, rect }));
                      }}
                      onMouseEnter={() => view3D && setHoveredNounId(nounId)}
                      onMouseLeave={() =>
                        view3D && setHoveredNounId(prev => (prev === nounId ? null : prev))
                      }
                      className={`group relative cursor-pointer overflow-clip rounded-xl transition-transform hover:scale-105 hover:shadow-lg ${view3D ? 'bg-transparent' : ''} ${isBurned ? 'grayscale' : ''}`}
                      style={{ width: layout.cellSize, height: layout.cellSize }}
                    >
                      {/* 2D SVG only renders as a fallback when 3D can't yet render
                          (no seed loaded). Once the seed is available, the voxel 3D
                          renders immediately on the overlay canvas, so we hide the 2D
                          to avoid it peeking through the transparent/rotating 3D. */}
                      {show2D && (
                        <Noun
                          nounId={nounId != null ? BigInt(nounId) : undefined}
                          loadingNounFallback
                          minFallbackDuration={1000}
                          style={{ width: layout.cellSize, height: layout.cellSize }}
                          className="bg-cool-background"
                        />
                      )}
                      <span
                        className="absolute bottom-0.5 left-1/2 hidden -translate-x-1/2 rounded bg-white/90 px-1 text-[10px] font-bold shadow-sm group-hover:block"
                        style={{ zIndex: 2 }}
                      >
                        {nounId.toString()}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>

        {/* Fixed viewport-overlay Canvas for all visible 3D nouns */}
        {view3D && (
          <div
            style={{
              position: 'fixed',
              top: 0,
              left: 0,
              width: '100vw',
              height: '100vh',
              pointerEvents: 'none',
              zIndex: 10,
            }}
          >
            <React.Suspense fallback={null}>
              <Noun3DGrid
                cells={(() => {
                  const cells: NounCell[] = [];
                  const scrollMargin = rowVirtualizer.options.scrollMargin ?? 0;
                  const containerRect = containerRef.current?.getBoundingClientRect();
                  const containerLeft = containerRect?.left ?? 0;
                  const containerTop = containerRect?.top ?? 0;
                  for (const virtualRow of rowVirtualizer.getVirtualItems()) {
                    const startIdx = virtualRow.index * layout.cols;
                    // Row Y relative to viewport
                    const rowViewportY = containerTop + (virtualRow.start - scrollMargin);
                    for (let colIdx = 0; colIdx < layout.cols; colIdx++) {
                      const itemIndex = startIdx + colIdx;
                      if (itemIndex >= displayCount) continue;
                      const nounId = filteredAndSorted[itemIndex];
                      const seed = seeds?.[nounId.toString()];
                      if (!seed) continue;
                      // Burned nouns render via 2D so the grayscale CSS
                      // applies — skip them in the 3D overlay layer.
                      if (burnedIds?.has(nounId)) continue;
                      const cx =
                        containerLeft + colIdx * (layout.cellSize + GAP) + layout.cellSize / 2;
                      const cy = rowViewportY + layout.cellSize / 2;
                      cells.push({ nounId, seed, cx, cy, size: layout.cellSize });
                    }
                  }
                  return cells;
                })()}
                totalHeight={window.innerHeight}
                containerWidth={window.innerWidth}
                scrollOffset={0}
                hoveredId={hoveredNounId}
                mousePos={mousePos}
              />
            </React.Suspense>
          </div>
        )}
      </div>

      {/* Click popover */}
      {popover && (
        <NounDetailPopover
          nounId={popover.nounId}
          anchorRect={popover.rect}
          onClose={() => setPopover(null)}
        />
      )}
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
            const name =
              traitKey === 'background' ? (i === 0 ? 'Cool' : 'Warm') : traitName(traitKey, i);

            return (
              <button
                key={i}
                onClick={() => onToggle(traitKey, i)}
                className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-all ${
                  isSelected
                    ? 'border-black bg-black text-white'
                    : 'border-gray-200 hover:border-gray-400'
                }`}
              >
                {traitKey !== 'background' && (
                  <Trait type={traitKey} seed={i} className="h-6 w-6 rounded" />
                )}
                {traitKey === 'background' && (
                  <div
                    className="h-6 w-6 rounded"
                    style={{ backgroundColor: `#${ImageData.bgcolors[i]}` }}
                  />
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
// force-reload 1775923457
