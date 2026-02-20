import { useCallback, useMemo, useState } from 'react';

import { ImageData } from '@noundry/nouns-assets';

import { getNounMetrics } from '@/lib/nounMetrics';
import { INounSeed } from '@/wrappers/nounToken';

export type SortOption =
  | 'id-desc'
  | 'id-asc'
  | 'area-desc'
  | 'area-asc'
  | 'colorfulness-desc'
  | 'colorfulness-asc'
  | 'brightness-desc'
  | 'brightness-asc';

export interface TraitFilter {
  head: number[];
  body: number[];
  accessory: number[];
  glasses: number[];
  background: number[];
}

export interface NounFilterState {
  sortBy: SortOption;
  search: string;
  traitFilters: TraitFilter;
}

const emptyFilters: TraitFilter = {
  head: [],
  body: [],
  accessory: [],
  glasses: [],
  background: [],
};

export function useNounFilters(
  nounIds: bigint[],
  seeds: Record<string, INounSeed> | undefined,
) {
  const [sortBy, setSortBy] = useState<SortOption>('id-desc');
  const [search, setSearch] = useState('');
  const [traitFilters, setTraitFilters] = useState<TraitFilter>({ ...emptyFilters });

  const hasActiveFilters = useMemo(() => {
    return (
      search.trim() !== '' ||
      Object.values(traitFilters).some(arr => arr.length > 0)
    );
  }, [search, traitFilters]);

  const toggleTraitFilter = useCallback(
    (type: keyof TraitFilter, index: number) => {
      setTraitFilters(prev => {
        const current = prev[type];
        const next = current.includes(index)
          ? current.filter(i => i !== index)
          : [...current, index];
        return { ...prev, [type]: next };
      });
    },
    [],
  );

  const clearFilters = useCallback(() => {
    setSearch('');
    setTraitFilters({ ...emptyFilters });
  }, []);

  const filteredAndSorted = useMemo(() => {
    let filtered = [...nounIds];

    // Search filter (by noun ID)
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      filtered = filtered.filter(id => id.toString().includes(q));
    }

    // Trait filters
    if (seeds) {
      filtered = filtered.filter(id => {
        const seed = seeds[Number(id)];
        if (!seed) return true; // include if no seed data

        for (const [type, indices] of Object.entries(traitFilters)) {
          if (indices.length > 0) {
            const seedValue = seed[type as keyof INounSeed];
            if (!indices.includes(seedValue)) return false;
          }
        }
        return true;
      });
    }

    // Sort
    filtered.sort((a, b) => {
      const aNum = Number(a);
      const bNum = Number(b);

      if (sortBy === 'id-desc') return bNum - aNum;
      if (sortBy === 'id-asc') return aNum - bNum;

      if (!seeds) return bNum - aNum;

      const seedA = seeds[aNum];
      const seedB = seeds[bNum];
      if (!seedA || !seedB) return bNum - aNum;

      const metricsA = getNounMetrics(seedA, aNum);
      const metricsB = getNounMetrics(seedB, bNum);

      switch (sortBy) {
        case 'area-desc':
          return metricsB.area - metricsA.area;
        case 'area-asc':
          return metricsA.area - metricsB.area;
        case 'colorfulness-desc':
          return metricsB.colorfulness - metricsA.colorfulness;
        case 'colorfulness-asc':
          return metricsA.colorfulness - metricsB.colorfulness;
        case 'brightness-desc':
          return metricsB.brightness - metricsA.brightness;
        case 'brightness-asc':
          return metricsA.brightness - metricsB.brightness;
        default:
          return bNum - aNum;
      }
    });

    return filtered;
  }, [nounIds, seeds, search, traitFilters, sortBy]);

  // Trait counts for filter UI
  const traitCounts = useMemo(() => {
    return {
      heads: ImageData.images.heads.length,
      bodies: ImageData.images.bodies.length,
      accessories: ImageData.images.accessories.length,
      glasses: ImageData.images.glasses.length,
      backgrounds: ImageData.bgcolors.length,
    };
  }, []);

  return {
    sortBy,
    setSortBy,
    search,
    setSearch,
    traitFilters,
    toggleTraitFilter,
    clearFilters,
    hasActiveFilters,
    filteredAndSorted,
    traitCounts,
  };
}
