import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { buildSVG } from '@nouns/sdk';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, Filter, X } from 'lucide-react';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

import LilNounDetailPopover from '@/components/LilNounDetailPopover';
import { Button } from '@/components/ui/button';

const IMAGE_DATA_URL = 'https://assets.noundry.wtf/lil-nouns/image-data.json';
const LIL_SEEDS_URL = '/probe-dreams/lil-seeds.json';
const LIL_OWNERS_URL = '/probe-dreams/lil-owners.json';
const LIL_NOUNS_TOKEN = '0x4b10701Bfd7BFEdc47d50562b76b436fbB5BdB3B' as const;
const MIN_CELL = 72;
const GAP = 4;

const ENS_API = import.meta.env.VITE_MAINNET_SUBGRAPH || 'https://spirited-flexibility-production-3c30.up.railway.app';

interface LilImageData {
  bgcolors: string[];
  palette: string[];
  images: {
    bodies: { filename: string; data: string }[];
    accessories: { filename: string; data: string }[];
    heads: { filename: string; data: string }[];
    glasses?: { filename: string; data: string }[];
  };
}

interface LilSeed {
  background: number;
  body: number;
  accessory: number;
  head: number;
  glasses: number;
}

type SortOption = 'id-desc' | 'id-asc' | 'brightness-desc' | 'brightness-asc' | 'colorfulness-desc' | 'colorfulness-asc' | 'area-desc' | 'area-asc';

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

const SEEDS_ABI = [{
  inputs: [{ name: 'nounId', type: 'uint256' }],
  name: 'seeds',
  outputs: [
    { name: 'background', type: 'uint48' },
    { name: 'body', type: 'uint48' },
    { name: 'accessory', type: 'uint48' },
    { name: 'head', type: 'uint48' },
    { name: 'glasses', type: 'uint48' },
  ],
  stateMutability: 'view',
  type: 'function',
}] as const;

let cachedImageData: LilImageData | null = null;
let cachedSeeds: Map<number, LilSeed> | null = null;
const svgCache = new Map<number, string>();
const metricsCache = new Map<number, { brightness: number; colorfulness: number; area: number }>();

function buildLilSvg(seed: LilSeed, imageData: LilImageData): string {
  const parts = [
    imageData.images.bodies[seed.body],
    imageData.images.accessories[seed.accessory],
    imageData.images.heads[seed.head],
  ];
  if (imageData.images.glasses?.length && seed.glasses >= 0) {
    parts.push(imageData.images.glasses[seed.glasses]);
  }
  return btoa(buildSVG(parts, imageData.palette, imageData.bgcolors[seed.background]));
}

function cleanTraitName(filename: string): string {
  return filename.replace(/^(body|accessory|head|glasses)-/, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Compute brightness/colorfulness/area from RLE data */
function getLilMetrics(seed: LilSeed, imageData: LilImageData) {
  const cached = metricsCache.get(seed.head * 10000 + seed.body * 100 + seed.accessory);
  if (cached) return cached;

  const palette = imageData.palette;
  const parts = [
    imageData.images.bodies[seed.body],
    imageData.images.accessories[seed.accessory],
    imageData.images.heads[seed.head],
  ];
  if (imageData.images.glasses?.length) parts.push(imageData.images.glasses[seed.glasses]);

  let artPixels = 0, totalBrightness = 0, totalSaturation = 0;
  const uniqueColors = new Set<number>();

  for (const part of parts) {
    if (!part?.data) continue;
    const hex = part.data.replace(/^0x/, '').substring(10);
    const chunks = hex.match(/.{1,4}/g) ?? [];
    for (const chunk of chunks) {
      const len = parseInt(chunk.substring(0, 2), 16);
      const ci = parseInt(chunk.substring(2, 4), 16);
      if (ci === 0) continue;
      const color = palette[ci];
      if (!color) continue;
      const r = parseInt(color.slice(0, 2), 16), g = parseInt(color.slice(2, 4), 16), b = parseInt(color.slice(4, 6), 16);
      const lum = (r * 299 + g * 587 + b * 114) / 1000;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const sat = max === 0 ? 0 : (max - min) / max;
      totalBrightness += lum * len;
      totalSaturation += sat * len;
      artPixels += len;
      uniqueColors.add(ci);
    }
  }

  const metrics = {
    brightness: artPixels > 0 ? totalBrightness / artPixels : 128,
    colorfulness: Math.min(100, uniqueColors.size * 2.5 + (artPixels > 0 ? (totalSaturation / artPixels) * 60 : 0)),
    area: artPixels / 1024,
  };
  metricsCache.set(seed.head * 10000 + seed.body * 100 + seed.accessory, metrics);
  return metrics;
}

/** Auto-fetch new mints above our static snapshot */
async function fetchNewMints(
  currentSeeds: Map<number, LilSeed>,
  setSeeds: (fn: (prev: Map<number, LilSeed>) => Map<number, LilSeed>) => void,
) {
  const maxId = Math.max(...currentSeeds.keys());
  try {
    const client = createPublicClient({ chain: mainnet, transport: http('https://ethereum-rpc.publicnode.com', { timeout: 15_000 }) });
    let id = maxId + 1;
    let added = 0;
    while (added < 200) {
      try {
        const r = await client.readContract({ address: LIL_NOUNS_TOKEN, abi: SEEDS_ABI, functionName: 'seeds', args: [BigInt(id)] });
        const seed: LilSeed = { background: Number(r[0]), body: Number(r[1]), accessory: Number(r[2]), head: Number(r[3]), glasses: Number(r[4]) };
        if (seed.background === 0 && seed.body === 0 && seed.accessory === 0 && seed.head === 0 && seed.glasses === 0 && id > 0) break;
        currentSeeds.set(id, seed);
        added++;
        id++;
      } catch { break; }
    }
    if (added > 0) {
      cachedSeeds = currentSeeds;
      setSeeds(() => new Map(currentSeeds));
    }
  } catch { /* silent */ }
}

const LilNounsTab: FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [imageData, setImageData] = useState<LilImageData | null>(cachedImageData);
  const [seeds, setSeeds] = useState<Map<number, LilSeed>>(cachedSeeds ?? new Map());
  const [loading, setLoading] = useState(!cachedSeeds);
  const [popover, setPopover] = useState<{ lilId: number; rect: DOMRect } | null>(null);

  // Owner data
  const [ownerEntries, setOwnerEntries] = useState<{ address: string; ens: string | null; count: number }[]>([]);
  const [ownerAddress, setOwnerAddress] = useState('');
  const [ownerNounIds, setOwnerNounIds] = useState<Set<number> | undefined>(undefined);
  const [ownerMap, setOwnerMap] = useState<Record<string, string> | null>(null);

  // Load owner data
  useEffect(() => {
    fetch(LIL_OWNERS_URL).then(r => r.json()).then((data: Record<string, string>) => {
      setOwnerMap(data);
      // Aggregate
      const counts = new Map<string, number>();
      for (const addr of Object.values(data)) {
        counts.set(addr, (counts.get(addr) ?? 0) + 1);
      }
      const entries = Array.from(counts.entries())
        .map(([address, count]) => ({ address, ens: null as string | null, count }))
        .sort((a, b) => b.count - a.count);
      setOwnerEntries(entries);

      // Resolve ENS in background
      const batchSize = 50;
      (async () => {
        for (let i = 0; i < entries.length; i += batchSize) {
          const batch = entries.slice(i, i + batchSize);
          try {
            const res = await fetch(`${ENS_API}/api/ens?addresses=${batch.map(e => e.address).join(',')}`);
            if (!res.ok) continue;
            const { names } = await res.json() as { names: Record<string, string | null> };
            for (let j = 0; j < batch.length; j++) {
              const name = names[batch[j].address] ?? names[batch[j].address.toLowerCase()];
              if (name) entries[i + j] = { ...entries[i + j], ens: name };
            }
          } catch { /* silent */ }
        }
        setOwnerEntries([...entries]);
      })();
    }).catch(() => { /* lil-owners.json might not exist yet */ });
  }, []);

  // Filter by owner
  useEffect(() => {
    if (!ownerAddress || !ownerMap) { setOwnerNounIds(undefined); return; }
    const ids = new Set<number>();
    for (const [nounId, addr] of Object.entries(ownerMap)) {
      if (addr.toLowerCase() === ownerAddress.toLowerCase()) ids.add(Number(nounId));
    }
    setOwnerNounIds(ids);
  }, [ownerAddress, ownerMap]);

  // Filters
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('id-desc');
  const [showTraits, setShowTraits] = useState(false);
  const [traitFilters, setTraitFilters] = useState<Record<string, number[]>>({
    head: [], body: [], accessory: [], glasses: [], background: [],
  });

  // Load data
  useEffect(() => {
    if (cachedImageData && cachedSeeds) {
      setImageData(cachedImageData);
      setSeeds(cachedSeeds);
      setLoading(false);
      return;
    }
    Promise.all([
      cachedImageData ? Promise.resolve(cachedImageData) : fetch(IMAGE_DATA_URL).then(r => r.json()),
      cachedSeeds ? Promise.resolve(null) : fetch(LIL_SEEDS_URL).then(r => r.json()),
    ]).then(([imgData, seedsData]) => {
      cachedImageData = imgData as LilImageData;
      setImageData(cachedImageData);
      if (seedsData) {
        const seedMap = new Map<number, LilSeed>();
        for (const [idStr, arr] of Object.entries(seedsData)) {
          const a = arr as number[];
          seedMap.set(Number(idStr), { background: a[0], body: a[1], accessory: a[2], head: a[3], glasses: a[4] });
        }
        cachedSeeds = seedMap;
        setSeeds(seedMap);
      }
    }).then(() => {
      if (cachedSeeds) fetchNewMints(cachedSeeds, setSeeds);
    }).catch(err => console.error('Failed to load lil nouns:', err)).finally(() => setLoading(false));
  }, []);

  // All IDs
  const lilIds = useMemo(() => Array.from(seeds.keys()).sort((a, b) => b - a), [seeds]);

  // Filter + sort
  const filteredAndSorted = useMemo(() => {
    let ids = [...lilIds];

    // Owner filter
    if (ownerNounIds) {
      ids = ids.filter(id => ownerNounIds.has(id));
    }

    // Search
    if (search.trim()) {
      const q = search.trim();
      ids = ids.filter(id => id.toString().includes(q));
    }

    // Trait filters
    ids = ids.filter(id => {
      const seed = seeds.get(id);
      if (!seed) return true;
      for (const [key, indices] of Object.entries(traitFilters)) {
        if (indices.length > 0 && !indices.includes(seed[key as keyof LilSeed])) return false;
      }
      return true;
    });

    // Sort
    if (sortBy !== 'id-desc' && sortBy !== 'id-asc' && imageData) {
      ids.sort((a, b) => {
        const seedA = seeds.get(a), seedB = seeds.get(b);
        if (!seedA || !seedB) return b - a;
        const mA = getLilMetrics(seedA, imageData), mB = getLilMetrics(seedB, imageData);
        switch (sortBy) {
          case 'brightness-desc': return mB.brightness - mA.brightness;
          case 'brightness-asc': return mA.brightness - mB.brightness;
          case 'colorfulness-desc': return mB.colorfulness - mA.colorfulness;
          case 'colorfulness-asc': return mA.colorfulness - mB.colorfulness;
          case 'area-desc': return mB.area - mA.area;
          case 'area-asc': return mA.area - mB.area;
          default: return b - a;
        }
      });
    } else if (sortBy === 'id-asc') {
      ids.sort((a, b) => a - b);
    }

    return ids;
  }, [lilIds, seeds, search, sortBy, traitFilters, imageData, ownerNounIds]);

  const hasActiveFilters = search.trim() !== '' || Object.values(traitFilters).some(a => a.length > 0);
  const activeFilterCount = Object.values(traitFilters).reduce((sum, a) => sum + a.length, 0);

  const toggleTraitFilter = useCallback((type: string, index: number) => {
    setTraitFilters(prev => {
      const current = prev[type] ?? [];
      const next = current.includes(index) ? current.filter(i => i !== index) : [...current, index];
      return { ...prev, [type]: next };
    });
  }, []);

  const clearFilters = useCallback(() => {
    setSearch('');
    setTraitFilters({ head: [], body: [], accessory: [], glasses: [], background: [] });
  }, []);

  // Layout
  const [layout, setLayout] = useState({ cols: 8, cellSize: MIN_CELL });
  useEffect(() => {
    const measure = () => {
      const el = containerRef.current;
      let w = el ? el.getBoundingClientRect().width : 0;
      if (w <= 0) w = window.innerWidth - 16;
      const cols = Math.max(3, Math.floor(w / (MIN_CELL + GAP)));
      const cellSize = Math.floor((w - GAP * (cols - 1)) / cols);
      setLayout({ cols, cellSize });
    };
    const timer = setTimeout(measure, 50);
    window.addEventListener('resize', measure);
    return () => { clearTimeout(timer); window.removeEventListener('resize', measure); };
  }, []);

  const rowHeight = layout.cellSize + GAP;
  const filteredRows = Math.ceil(filteredAndSorted.length / layout.cols);

  const rowVirtualizer = useWindowVirtualizer({
    count: filteredRows,
    estimateSize: () => rowHeight,
    overscan: 5,
    scrollMargin: containerRef.current?.offsetTop ?? 0,
  });

  const getSvg = useCallback((id: number): string | null => {
    if (svgCache.has(id)) return svgCache.get(id)!;
    const seed = seeds.get(id);
    if (!seed || !imageData) return null;
    try { const svg = buildLilSvg(seed, imageData); svgCache.set(id, svg); return svg; } catch { return null; }
  }, [seeds, imageData]);

  if (loading) {
    return <div className="py-16 text-center"><p className="text-muted-foreground">Loading Lils...</p></div>;
  }

  // Trait type config for filter panel
  const traitTypes = imageData ? [
    { key: 'head', label: 'Head', count: imageData.images.heads.length },
    { key: 'glasses', label: 'Glasses', count: imageData.images.glasses?.length ?? 0 },
    { key: 'body', label: 'Body', count: imageData.images.bodies.length },
    { key: 'accessory', label: 'Accessory', count: imageData.images.accessories.length },
    { key: 'background', label: 'BG', count: imageData.bgcolors.length },
  ] : [];

  return (
    <>
      {/* Filter bar — matches Nouns tab */}
      <div className="flex flex-wrap items-center gap-2 py-3">
        <input
          type="text"
          placeholder="Search ID..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border-border w-28 rounded-lg border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
        />
        <LilOwnerDropdown
          entries={ownerEntries}
          value={ownerAddress}
          onChange={setOwnerAddress}
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
            <span className="ml-1 rounded-full bg-red-500 px-1.5 py-0.5 text-xs text-white">{activeFilterCount}</span>
          )}
        </Button>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1 text-red-500">
            <X className="h-4 w-4" /> Clear
          </Button>
        )}
        <span className="text-muted-foreground ml-auto text-sm">
          {hasActiveFilters ? `${filteredAndSorted.length} / ` : ''}{lilIds.length} Lils
        </span>
      </div>

      {/* Trait filter panel */}
      {showTraits && imageData && (
        <div className="mb-3 rounded-xl border bg-white p-4 shadow-sm">
          <div className="space-y-2">
            {traitTypes.map(({ key, label, count }) => (
              <TraitRow
                key={key}
                traitKey={key}
                label={label}
                count={count}
                selected={traitFilters[key] ?? []}
                imageData={imageData}
                onToggle={toggleTraitFilter}
              />
            ))}
          </div>
        </div>
      )}

      {/* Grid */}
      <div ref={containerRef} style={{ width: '100%', overflow: 'hidden' }}>
        <div style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map(virtualRow => {
            const startIdx = virtualRow.index * layout.cols;
            return (
              <div
                key={virtualRow.key}
                style={{
                  position: 'absolute',
                  top: `${virtualRow.start - (rowVirtualizer.options.scrollMargin ?? 0)}px`,
                  left: 0, right: 0,
                  display: 'grid',
                  gridTemplateColumns: `repeat(${layout.cols}, ${layout.cellSize}px)`,
                  gap: `${GAP}px`,
                }}
              >
                {Array.from({ length: layout.cols }, (_, colIdx) => {
                  const itemIndex = startIdx + colIdx;
                  if (itemIndex >= filteredAndSorted.length) return <div key={colIdx} />;
                  const lilId = filteredAndSorted[itemIndex];
                  const svg = getSvg(lilId);
                  const seed = seeds.get(lilId);
                  const bg = seed && imageData ? `#${imageData.bgcolors[seed.background]}` : '#d5d7e1';

                  return (
                    <div
                      key={lilId}
                      onClick={e => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setPopover(prev => prev?.lilId === lilId ? null : { lilId, rect });
                      }}
                      className="group relative cursor-pointer overflow-clip rounded-xl transition-transform hover:scale-105 hover:shadow-lg"
                      style={{ width: layout.cellSize, height: layout.cellSize, backgroundColor: bg }}
                    >
                      {svg && (
                        <img
                          src={`data:image/svg+xml;base64,${svg}`}
                          alt={`Lil ${lilId}`}
                          style={{ width: layout.cellSize, height: layout.cellSize, imageRendering: 'pixelated' }}
                        />
                      )}
                      <span className="absolute bottom-0.5 left-1/2 hidden -translate-x-1/2 rounded bg-white/90 px-1 text-[10px] font-bold shadow-sm group-hover:block">
                        {lilId}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {popover && seeds.get(popover.lilId) && imageData && getSvg(popover.lilId) && (
        <LilNounDetailPopover
          lilId={popover.lilId}
          seed={seeds.get(popover.lilId)!}
          svgBase64={getSvg(popover.lilId)!}
          imageData={imageData}
          anchorRect={popover.rect}
          onClose={() => setPopover(null)}
        />
      )}
    </>
  );
};

/** Expandable trait filter row for lil nouns */
function TraitRow({
  traitKey, label, count, selected, imageData, onToggle,
}: {
  traitKey: string;
  label: string;
  count: number;
  selected: number[];
  imageData: LilImageData;
  onToggle: (type: string, index: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-border rounded-lg border">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between px-3 py-2 text-sm font-semibold hover:bg-gray-50"
      >
        <span>
          {label}
          {selected.length > 0 && (
            <span className="ml-2 rounded-full bg-black px-2 py-0.5 text-xs text-white">{selected.length}</span>
          )}
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="flex max-h-48 flex-wrap gap-1 overflow-y-auto border-t p-2">
          {Array.from({ length: count }, (_, i) => {
            const isSelected = selected.includes(i);
            let name: string;
            if (traitKey === 'background') {
              name = i === 0 ? 'Cool' : 'Warm';
            } else {
              const category = traitKey === 'head' ? 'heads' : traitKey === 'body' ? 'bodies' : traitKey === 'accessory' ? 'accessories' : 'glasses';
              const imgs = imageData.images[category as keyof typeof imageData.images];
              const arr = imgs as { filename: string }[] | undefined;
              name = arr?.[i]?.filename ? cleanTraitName(arr[i].filename) : `#${i}`;
            }
            return (
              <button
                type="button"
                key={i}
                onClick={() => onToggle(traitKey, i)}
                className={`rounded-md border px-2 py-1 text-xs transition-all ${
                  isSelected ? 'border-black bg-black text-white' : 'border-gray-200 hover:border-gray-400'
                }`}
              >
                {name}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Searchable owner dropdown for lil nouns */
function LilOwnerDropdown({
  entries, value, onChange,
}: {
  entries: { address: string; ens: string | null; count: number }[];
  value: string;
  onChange: (address: string) => void;
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
    : 'Owner';

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={`border-border flex items-center gap-1 rounded-lg border bg-white px-3 py-2 text-sm ${value ? 'font-semibold text-black' : 'text-gray-400'}`}
      >
        <span className="max-w-32 truncate">{selectedLabel}</span>
        {value ? (
          <X className="h-3 w-3 shrink-0 text-gray-400 hover:text-red-500" onClick={e => { e.stopPropagation(); onChange(''); setOpen(false); }} />
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
              <p className="px-3 py-2 text-xs text-gray-400">{entries.length === 0 ? 'Loading...' : 'No results'}</p>
            ) : (
              filtered.map(e => (
                <button
                  type="button"
                  key={e.address}
                  onClick={() => { onChange(e.address); setOpen(false); setQuery(''); }}
                  className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-gray-50"
                >
                  <span className="truncate font-medium">{e.ens ?? `${e.address.slice(0, 8)}...${e.address.slice(-4)}`}</span>
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

export default LilNounsTab;
