import { useCallback, useMemo, useState } from 'react';

import { ImageData } from '@noundry/nouns-assets';

import { getMatchingPaletteHexes, nounContainsColor, parseHexColor } from '@/lib/hexColorSearch';
import { getNounMetrics } from '@/lib/nounMetrics';
import { traitName } from '@/lib/traitName';
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
  ownerNounIds?: Set<bigint>,
) {
  const [sortBy, setSortBy] = useState<SortOption>('id-desc');
  const [search, setSearch] = useState('');
  const [traitFilters, setTraitFilters] = useState<TraitFilter>({ ...emptyFilters });

  const hasActiveFilters = useMemo(() => {
    return search.trim() !== '' || Object.values(traitFilters).some(arr => arr.length > 0);
  }, [search, traitFilters]);

  const toggleTraitFilter = useCallback((type: keyof TraitFilter, index: number) => {
    setTraitFilters(prev => {
      const current = prev[type];
      const next = current.includes(index) ? current.filter(i => i !== index) : [...current, index];
      return { ...prev, [type]: next };
    });
  }, []);

  const clearFilters = useCallback(() => {
    setSearch('');
    setTraitFilters({ ...emptyFilters });
  }, []);

  // Per-noun searchable text: all four trait names + background, lowercased.
  // Built once per seeds load so keystroke filtering is a substring scan.
  const searchText = useMemo(() => {
    if (seeds == null) return undefined;
    const idx = new Map<string, string>();
    for (const [id, seed] of Object.entries(seeds)) {
      idx.set(
        id,
        [
          traitName('head', seed.head),
          traitName('glasses', seed.glasses),
          traitName('body', seed.body),
          traitName('accessory', seed.accessory),
          seed.background === 0 ? 'cool' : 'warm',
        ]
          .join(' ')
          .toLowerCase(),
      );
    }
    return idx;
  }, [seeds]);

  const filteredAndSorted = useMemo(() => {
    let filtered = [...nounIds];

    // Owner filter
    if (ownerNounIds) {
      filtered = filtered.filter(id => ownerNounIds.has(id));
    }

    // Smart search: every whitespace-separated token must match the noun's
    // ID or one of its trait names, so "fox cool" = fox head AND cool bg.
    // A token that parses as a hex colour (#c54e38, #c53, c54e38) instead
    // matches nouns whose art contains that colour (small RGB tolerance).
    if (search.trim()) {
      const tokens = search.trim().toLowerCase().split(/\s+/);
      const colorSets: Set<string>[] = [];
      const textTokens: string[] = [];
      for (const t of tokens) {
        const hex = parseHexColor(t);
        if (hex != null) colorSets.push(getMatchingPaletteHexes(hex));
        else textTokens.push(t);
      }
      filtered = filtered.filter(id => {
        const idStr = id.toString();
        const text = searchText?.get(idStr);
        if (!textTokens.every(t => idStr.includes(t) || (text != null && text.includes(t)))) {
          return false;
        }
        if (colorSets.length > 0) {
          const seed = seeds?.[idStr];
          if (seed == null) return false;
          return colorSets.every(set => nounContainsColor(seed, set));
        }
        return true;
      });
    }

    // Trait filters
    if (seeds != null) {
      const hasTraitFilter =
        traitFilters.head.length > 0 ||
        traitFilters.body.length > 0 ||
        traitFilters.accessory.length > 0 ||
        traitFilters.glasses.length > 0 ||
        traitFilters.background.length > 0;
      filtered = filtered.filter(id => {
        const seed = seeds[Number(id)];
        if (seed == null) return !hasTraitFilter;

        for (const [type, indices] of Object.entries(traitFilters) as [string, number[]][]) {
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

      if (seeds == null) return bNum - aNum;

      const seedA = seeds[aNum];
      const seedB = seeds[bNum];
      if (seedA == null || seedB == null) return bNum - aNum;

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
  }, [nounIds, seeds, search, searchText, traitFilters, sortBy, ownerNounIds]);

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
