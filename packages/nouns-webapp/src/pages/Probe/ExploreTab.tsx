import React, { useMemo, useRef } from 'react';

import { Trans } from '@lingui/react/macro';
import { useVirtualizer } from '@tanstack/react-virtual';
import { motion } from 'motion/react';
import { range } from 'remeda';

import { GalleryFilters } from '@/components/GalleryFilters';
import { Noun } from '@/components/Noun';
import { useAppSelector } from '@/hooks';
import { useNounFilters } from '@/hooks/useNounFilters';
import { useOwnerFilter } from '@/hooks/useOwnerFilter';
import { useNounSeeds } from '@/wrappers/nounToken';
import { Auction as IAuction } from '@/wrappers/nounsAuction';

const MIN_CELL = 80;
const GAP = 4;

const ExploreTab: React.FC = () => {
  const currentAuction: IAuction | undefined = useAppSelector(state => state.auction.activeAuction);
  const currentAuctionNounId = currentAuction ? BigInt(currentAuction.nounId) : undefined;
  const nounCount = currentAuctionNounId !== undefined ? Number(currentAuctionNounId) + 1 : -1;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nounsList = useMemo(() => range(0, nounCount).map(BigInt), [nounCount]);

  const seeds = useNounSeeds();
  const { ownerAddress, setOwnerAddress, ownedNounIds, ownerLoading } = useOwnerFilter();

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

  // Measure container to compute columns + cell size dynamically
  const [layout, setLayout] = React.useState({ cols: 8, cellSize: MIN_CELL });
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const w = el.clientWidth - 16; // account for p-2 padding
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

  return (
    <>
      {/* Filters */}
      <div className="py-4">
        <GalleryFilters
          sortBy={sortBy}
          onSortChange={setSortBy}
          search={search}
          onSearchChange={setSearch}
          traitFilters={traitFilters}
          onTraitToggle={toggleTraitFilter}
          onClearFilters={clearFilters}
          hasActiveFilters={hasActiveFilters}
          totalCount={nounCount >= 0 ? nounCount : 0}
          filteredCount={displayCount}
          ownerAddress={ownerAddress}
          onOwnerChange={setOwnerAddress}
          ownerLoading={ownerLoading}
        />
      </div>

      {/* Full-width grid */}
      <div className="border-border overflow-clip rounded-2xl border">
        <div className="border-border flex items-center justify-between border-b px-6 py-3">
          <h3>
            <Trans>Explore</Trans>{' '}
            {displayCount >= 0 && (
              <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <strong>{displayCount}</strong> Nouns
              </motion.span>
            )}
          </h3>
        </div>

        <div
          ref={containerRef}
          className="h-[600px] overflow-y-auto overscroll-contain p-2"
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
                        style={{
                          width: layout.cellSize,
                          height: layout.cellSize,
                        }}
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
      </div>
    </>
  );
};

export default ExploreTab;
