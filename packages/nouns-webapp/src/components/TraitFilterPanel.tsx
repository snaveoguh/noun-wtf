/**
 * TraitFilterPanel — the expandable head / noggles / body / accessory /
 * background picker shared by the probe explore tabs.
 *
 * `isV2` switches the art set: V1 reads `@noundry/nouns-assets` ImageData,
 * V2 reads the workspace `@nouns/assets` ImageDataV2 (different counts and
 * names — e.g. founder bodies, missingnoun / joker heads).
 */
import type { TraitFilter } from '@/hooks/useNounFilters';

import { FC, useState } from 'react';

import { ImageData } from '@noundry/nouns-assets';
import { ImageDataV2 } from '@nouns/assets';
import { ChevronDownIcon } from 'lucide-react';

import { Trait } from '@/components/Trait';
import { traitCategory } from '@/lib/traitCategory';
import { traitName } from '@/lib/traitName';

export const traitTypes: { key: keyof TraitFilter; label: string }[] = [
  { key: 'head', label: 'Head' },
  { key: 'glasses', label: 'Noggles' },
  { key: 'body', label: 'Body' },
  { key: 'accessory', label: 'Accessory' },
  { key: 'background', label: 'Background' },
];

type ArtSet = {
  bgcolors: string[];
  images: Record<string, unknown[]>;
};

/** Number of options for a trait type in the chosen art set. */
export function traitOptionCount(key: keyof TraitFilter, isV2: boolean): number {
  const art = (isV2 ? ImageDataV2 : ImageData) as ArtSet;
  if (key === 'background') return art.bgcolors.length;
  return art.images[traitCategory[key]]?.length ?? 0;
}

interface TraitFilterPanelProps {
  traitFilters: TraitFilter;
  onToggle: (type: keyof TraitFilter, index: number) => void;
  isV2?: boolean;
}

export const TraitFilterPanel: FC<TraitFilterPanelProps> = ({
  traitFilters,
  onToggle,
  isV2 = false,
}) => (
  <div className="mb-3 rounded-xl border bg-white p-4 shadow-sm">
    <div className="space-y-2">
      {traitTypes.map(({ key, label }) => (
        <TraitFilterRow
          key={key}
          traitKey={key}
          label={label}
          traitCount={traitOptionCount(key, isV2)}
          selectedCount={traitFilters[key].length}
          traitFilters={traitFilters}
          onToggle={onToggle}
          isV2={isV2}
        />
      ))}
    </div>
  </div>
);

/** Expandable trait filter row */
function TraitFilterRow({
  traitKey,
  label,
  traitCount,
  selectedCount,
  traitFilters,
  onToggle,
  isV2,
}: {
  traitKey: keyof TraitFilter;
  label: string;
  traitCount: number;
  selectedCount: number;
  traitFilters: TraitFilter;
  onToggle: (type: keyof TraitFilter, index: number) => void;
  isV2: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const bgcolors = (isV2 ? ImageDataV2 : ImageData).bgcolors;

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
        <ChevronDownIcon
          className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
        />
      </button>

      {expanded && (
        <div className="flex max-h-48 flex-wrap gap-1 overflow-y-auto border-t p-2">
          {Array.from({ length: traitCount }, (_, i) => {
            const isSelected = traitFilters[traitKey].includes(i);
            const name = traitName(traitKey, i, isV2);

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
                  <Trait type={traitKey} seed={i} isV2={isV2} className="h-6 w-6 rounded" />
                )}
                {traitKey === 'background' && (
                  <div className="h-6 w-6 rounded" style={{ backgroundColor: `#${bgcolors[i]}` }} />
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

export default TraitFilterPanel;
