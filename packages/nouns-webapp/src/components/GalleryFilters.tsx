import { FC, useState } from 'react';

import { ImageData } from '@noundry/nouns-assets';
import { ChevronDown, Filter, X } from 'lucide-react';

import { Trait } from '@/components/Trait';
import { Button } from '@/components/ui/button';
import { SortOption, TraitFilter } from '@/hooks/useNounFilters';
import { traitName } from '@/lib/traitName';

interface GalleryFiltersProps {
  sortBy: SortOption;
  onSortChange: (sort: SortOption) => void;
  search: string;
  onSearchChange: (search: string) => void;
  traitFilters: TraitFilter;
  onTraitToggle: (type: keyof TraitFilter, index: number) => void;
  onClearFilters: () => void;
  hasActiveFilters: boolean;
  totalCount: number;
  filteredCount: number;
  /** Owner address filter */
  ownerAddress?: string;
  onOwnerChange?: (address: string) => void;
  ownerLoading?: boolean;
}

const sortOptions: { label: string; value: SortOption }[] = [
  { label: 'Latest', value: 'id-desc' },
  { label: 'Oldest', value: 'id-asc' },
  { label: 'Most Colorful', value: 'colorfulness-desc' },
  { label: 'Least Colorful', value: 'colorfulness-asc' },
  { label: 'Largest Area', value: 'area-desc' },
  { label: 'Smallest Area', value: 'area-asc' },
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

export const GalleryFilters: FC<GalleryFiltersProps> = ({
  sortBy,
  onSortChange,
  search,
  onSearchChange,
  traitFilters,
  onTraitToggle,
  onClearFilters,
  hasActiveFilters,
  totalCount,
  filteredCount,
  ownerAddress,
  onOwnerChange,
  ownerLoading,
}) => {
  const [showFilters, setShowFilters] = useState(false);
  const [expandedTrait, setExpandedTrait] = useState<string | null>(null);

  return (
    <div className="mb-4 space-y-3">
      {/* Top bar: search + sort + filter toggle */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <input
          type="text"
          placeholder="Search by Noun ID..."
          value={search}
          onChange={e => onSearchChange(e.target.value)}
          className="border-border rounded-lg border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
          style={{ width: 200 }}
        />

        {/* Owner filter */}
        {onOwnerChange && (
          <div className="relative">
            <input
              type="text"
              placeholder="Filter by owner..."
              value={ownerAddress ?? ''}
              onChange={e => onOwnerChange(e.target.value)}
              className="border-border rounded-lg border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
              style={{ width: 200 }}
            />
            {ownerLoading && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">
                ...
              </span>
            )}
          </div>
        )}

        {/* Sort */}
        <select
          value={sortBy}
          onChange={e => onSortChange(e.target.value as SortOption)}
          className="border-border rounded-lg border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
        >
          {sortOptions.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        {/* Filter toggle */}
        <Button
          variant={showFilters ? 'default' : 'outline'}
          size="sm"
          onClick={() => setShowFilters(!showFilters)}
          className="gap-1"
        >
          <Filter className="h-4 w-4" />
          Traits
          {hasActiveFilters && (
            <span className="ml-1 rounded-full bg-red-500 px-1.5 py-0.5 text-xs text-white">
              {Object.values(traitFilters).reduce((sum, arr) => sum + arr.length, 0)}
            </span>
          )}
        </Button>

        {/* Clear filters */}
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={onClearFilters} className="gap-1 text-red-500">
            <X className="h-4 w-4" />
            Clear
          </Button>
        )}

        {/* Count */}
        <span className="text-muted-foreground ml-auto text-sm">
          {hasActiveFilters ? `${filteredCount} / ${totalCount}` : `${totalCount}`} Nouns
        </span>
      </div>

      {/* Trait filter panel */}
      {showFilters && (
        <div className="rounded-xl border bg-white p-4 shadow-sm">
          <div className="space-y-2">
            {traitTypes.map(({ key, label }) => {
              const isExpanded = expandedTrait === key;
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
                <div key={key} className="border-border rounded-lg border">
                  <button
                    onClick={() => setExpandedTrait(isExpanded ? null : key)}
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
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                    />
                  </button>

                  {isExpanded && (
                    <div className="flex max-h-48 flex-wrap gap-1 overflow-y-auto border-t p-2">
                      {Array.from({ length: traitCount }, (_, i) => {
                        const isSelected = traitFilters[key].includes(i);
                        const name =
                          key === 'background' ? (i === 0 ? 'Cool' : 'Warm') : traitName(key, i);

                        return (
                          <button
                            key={i}
                            onClick={() => onTraitToggle(key, i)}
                            className={`flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-all ${
                              isSelected
                                ? 'border-black bg-black text-white'
                                : 'border-gray-200 hover:border-gray-400'
                            }`}
                          >
                            {key !== 'background' && (
                              <Trait type={key} seed={i} className="h-6 w-6 rounded" />
                            )}
                            {key === 'background' && (
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
            })}
          </div>
        </div>
      )}
    </div>
  );
};
