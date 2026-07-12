import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, Filter, Flame, Sparkles, X } from 'lucide-react';
import { decodeEventLog, formatEther } from 'viem';
import { polygon } from 'viem/chains';
import { useAccount, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';

import BorgDetailPopover, { BORG_LAYER_LABELS } from '@/components/BorgDetailPopover';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Borg,
  BorgAttribute,
  BorgsData,
  BORGS_ADDRESS,
  BORGS_SUPPLY_LIMIT,
  borgsAbi,
  fetchNewBorgs,
  fetchOwnedBorgIds,
  isBlankAttribute,
  loadBorgsData,
  polygonClient,
  renderBorgImage,
  renderRawBorgImage,
} from '@/lib/borgs';

const MIN_CELL = 72;
const GAP = 6;
const CELL_BG = '#f4f4f5';

const ENS_API =
  import.meta.env.VITE_MAINNET_SUBGRAPH ||
  'https://spirited-flexibility-production-3c30.up.railway.app';

type SortOption = 'id-desc' | 'id-asc' | 'rarest' | 'common';
type StatusFilter = 'alive' | 'burned' | 'all';
type TypeFilter = 'all' | 'generated' | 'bred';

const sortOptions: { label: string; value: SortOption }[] = [
  { label: 'Latest', value: 'id-desc' },
  { label: 'Oldest', value: 'id-asc' },
  { label: 'Rarest', value: 'rarest' },
  { label: 'Most Common', value: 'common' },
];

const rarityCache = new Map<number, number>();

/** Mean on-chain usage count of a borg's non-blank attributes (lower = rarer). */
function rarityScore(borg: Borg, attributes: BorgAttribute[]): number {
  const cached = rarityCache.get(borg.id);
  if (cached !== undefined) return cached;
  const used = borg.attrs
    .map(i => attributes[i])
    .filter(a => a && !isBlankAttribute(a.n))
    .map(a => a.u);
  const score = used.length
    ? used.reduce((s, u) => s + u, 0) / used.length
    : Number.MAX_SAFE_INTEGER;
  rarityCache.set(borg.id, score);
  return score;
}

const BorgsTab: FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [data, setData] = useState<BorgsData | null>(null);
  const [version, setVersion] = useState(0); // bumped when `data` is mutated in place
  const [loadError, setLoadError] = useState(false);
  const [popover, setPopover] = useState<{ borgId: number; rect: DOMRect } | null>(null);

  // Filters
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortOption>('id-desc');
  const [status, setStatus] = useState<StatusFilter>('alive');
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('all');
  const [showTraits, setShowTraits] = useState(false);
  const [traitFilters, setTraitFilters] = useState<Record<number, number[]>>({});

  // Owner filter
  const [ownerAddress, setOwnerAddress] = useState('');
  const [ownerEntries, setOwnerEntries] = useState<
    { address: string; ens: string | null; count: number }[]
  >([]);

  // Mint / breed dialogs
  const [mintOpen, setMintOpen] = useState(false);
  const [breedOpen, setBreedOpen] = useState(false);

  const refreshData = useCallback(async () => {
    if (!data) return;
    await fetchNewBorgs(data).catch(() => undefined);
    rarityCache.clear();
    setVersion(v => v + 1);
  }, [data]);

  useEffect(() => {
    loadBorgsData()
      .then(d => setData(d))
      .catch(err => {
        console.error('Failed to load borgs:', err);
        setLoadError(true);
      });
  }, []);

  // Owner entries + background ENS resolution
  useEffect(() => {
    if (!data) return;
    const counts = new Map<string, number>();
    for (const borg of data.borgs.values()) {
      if (borg.owner) counts.set(borg.owner, (counts.get(borg.owner) ?? 0) + 1);
    }
    const entries = Array.from(counts.entries())
      .map(([address, count]) => ({ address, ens: null as string | null, count }))
      .sort((a, b) => b.count - a.count);
    setOwnerEntries(entries);

    (async () => {
      const batchSize = 50;
      for (let i = 0; i < entries.length; i += batchSize) {
        const batch = entries.slice(i, i + batchSize);
        try {
          const res = await fetch(
            `${ENS_API}/api/ens?addresses=${batch.map(e => e.address).join(',')}`,
          );
          if (!res.ok) continue;
          const { names } = (await res.json()) as { names: Record<string, string | null> };
          for (let j = 0; j < batch.length; j++) {
            const name = names[batch[j].address] ?? names[batch[j].address.toLowerCase()];
            if (name) entries[i + j] = { ...entries[i + j], ens: name };
          }
        } catch {
          /* silent */
        }
      }
      setOwnerEntries([...entries]);
    })();
  }, [data, version]);

  // Layer config for the trait filter panel: non-blank attrs sorted by usage,
  // blanks collapsed into a single "None" option per layer.
  const layerConfig = useMemo(() => {
    if (!data) return [];
    const byLayer = new Map<number, number[]>();
    data.attributes.forEach((a, idx) => {
      const arr = byLayer.get(a.l) ?? [];
      arr.push(idx);
      byLayer.set(a.l, arr);
    });
    return (
      Array.from(byLayer.entries())
        .sort((a, b) => a[0] - b[0])
        .map(([layer, attrIdxs]) => ({
          layer,
          label: BORG_LAYER_LABELS[layer] ?? `Layer ${layer}`,
          options: attrIdxs.sort((x, y) => {
            const ax = data.attributes[x];
            const ay = data.attributes[y];
            // blanks last, then by usage desc
            if (isBlankAttribute(ax.n) !== isBlankAttribute(ay.n))
              return isBlankAttribute(ax.n) ? 1 : -1;
            return ay.u - ax.u;
          }),
        }))
        // hide layers that only ever contain blanks (nothing to filter on)
        .filter(({ options }) => options.some(i => !isBlankAttribute(data.attributes[i].n)))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, version]);

  const allBorgs = useMemo(() => {
    if (!data) return [];
    return Array.from(data.borgs.values());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, version]);

  const filteredAndSorted = useMemo(() => {
    if (!data) return [];
    let borgs = allBorgs;

    if (status === 'alive') borgs = borgs.filter(b => b.owner !== null);
    else if (status === 'burned') borgs = borgs.filter(b => b.owner === null);

    if (typeFilter === 'generated') borgs = borgs.filter(b => b.parent1 === 0);
    else if (typeFilter === 'bred') borgs = borgs.filter(b => b.parent1 > 0);

    if (ownerAddress) borgs = borgs.filter(b => b.owner === ownerAddress.toLowerCase());

    if (search.trim()) {
      const q = search.trim().toLowerCase();
      borgs = borgs.filter(b => b.id.toString().includes(q) || b.name.toLowerCase().includes(q));
    }

    for (const [layerStr, selected] of Object.entries(traitFilters)) {
      if (selected.length === 0) continue;
      const layer = Number(layerStr);
      borgs = borgs.filter(b => selected.includes(b.attrs[layer]));
    }

    const sorted = [...borgs];
    switch (sortBy) {
      case 'id-asc':
        sorted.sort((a, b) => a.id - b.id);
        break;
      case 'rarest':
        sorted.sort((a, b) => rarityScore(a, data.attributes) - rarityScore(b, data.attributes));
        break;
      case 'common':
        sorted.sort((a, b) => rarityScore(b, data.attributes) - rarityScore(a, data.attributes));
        break;
      default:
        sorted.sort((a, b) => b.id - a.id);
    }
    return sorted;
  }, [data, allBorgs, status, typeFilter, ownerAddress, search, traitFilters, sortBy]);

  const aliveCount = useMemo(() => allBorgs.filter(b => b.owner !== null).length, [allBorgs]);

  const activeFilterCount = Object.values(traitFilters).reduce((sum, a) => sum + a.length, 0);
  const hasActiveFilters =
    search.trim() !== '' ||
    activeFilterCount > 0 ||
    ownerAddress !== '' ||
    status !== 'alive' ||
    typeFilter !== 'all';

  const toggleTraitFilter = useCallback((layer: number, attrIdx: number) => {
    setTraitFilters(prev => {
      const current = prev[layer] ?? [];
      const next = current.includes(attrIdx)
        ? current.filter(i => i !== attrIdx)
        : [...current, attrIdx];
      return { ...prev, [layer]: next };
    });
  }, []);

  const clearFilters = useCallback(() => {
    setSearch('');
    setTraitFilters({});
    setOwnerAddress('');
    setStatus('alive');
    setTypeFilter('all');
  }, []);

  // Layout + virtualizer
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
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', measure);
    };
  }, []);

  const rowHeight = layout.cellSize + GAP;
  const filteredRows = Math.ceil(filteredAndSorted.length / layout.cols);
  const rowVirtualizer = useWindowVirtualizer({
    count: filteredRows,
    estimateSize: () => rowHeight,
    overscan: 5,
    scrollMargin: containerRef.current?.offsetTop ?? 0,
  });

  if (loadError) {
    return (
      <div className="py-16 text-center">
        <p className="text-muted-foreground">Failed to load Borgs — try refreshing.</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="py-16 text-center">
        <p className="text-muted-foreground">Beaming Borgs down from Polygon...</p>
      </div>
    );
  }

  return (
    <>
      {/* Collection header: supply + mint/breed */}
      <div className="mt-1 flex flex-wrap items-center gap-2 rounded-xl border bg-white px-3 py-2">
        <div className="flex flex-col">
          <span className="text-sm font-bold">Borgs · fully onchain · Polygon</span>
          <span className="text-muted-foreground text-xs">
            {data.meta.generated.toLocaleString()} / {BORGS_SUPPLY_LIMIT.toLocaleString()} generated
            · {data.meta.bred.toLocaleString()} bred · {aliveCount.toLocaleString()} alive
          </span>
        </div>
        <div className="ml-auto flex gap-2">
          <Button size="sm" onClick={() => setMintOpen(true)} className="gap-1">
            <Sparkles className="h-4 w-4" /> Mint
          </Button>
          <Button size="sm" variant="outline" onClick={() => setBreedOpen(true)} className="gap-1">
            <Flame className="h-4 w-4" /> Breed
          </Button>
        </div>
      </div>

      {/* Filter bar — matches Nouns tab */}
      <div className="flex flex-wrap items-center gap-2 py-3">
        <input
          type="text"
          placeholder="Search ID / name..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border-border w-36 rounded-lg border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
        />
        <BorgOwnerDropdown entries={ownerEntries} value={ownerAddress} onChange={setOwnerAddress} />
        <select
          value={status}
          onChange={e => setStatus(e.target.value as StatusFilter)}
          className="border-border rounded-lg border bg-white px-3 py-2 text-sm"
        >
          <option value="alive">Alive</option>
          <option value="burned">☠️ Bred away</option>
          <option value="all">All</option>
        </select>
        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value as TypeFilter)}
          className="border-border rounded-lg border bg-white px-3 py-2 text-sm"
        >
          <option value="all">Any origin</option>
          <option value="generated">Generated</option>
          <option value="bred">Bred</option>
        </select>
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
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearFilters} className="gap-1 text-red-500">
            <X className="h-4 w-4" /> Clear
          </Button>
        )}
        <span className="text-muted-foreground ml-auto text-sm">
          {filteredAndSorted.length.toLocaleString()} Borgs
        </span>
      </div>

      {/* Trait filter panel */}
      {showTraits && (
        <div className="mb-3 rounded-xl border bg-white p-4 shadow-sm">
          <div className="space-y-2">
            {layerConfig.map(({ layer, label, options }) => (
              <BorgTraitRow
                key={layer}
                layer={layer}
                label={label}
                options={options}
                attributes={data.attributes}
                selected={traitFilters[layer] ?? []}
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
                  left: 0,
                  right: 0,
                  display: 'grid',
                  gridTemplateColumns: `repeat(${layout.cols}, ${layout.cellSize}px)`,
                  gap: `${GAP}px`,
                }}
              >
                {Array.from({ length: layout.cols }, (_, colIdx) => {
                  const itemIndex = startIdx + colIdx;
                  if (itemIndex >= filteredAndSorted.length) return <div key={colIdx} />;
                  const borg = filteredAndSorted[itemIndex];
                  const uri = renderBorgImage(borg.attrs, data.attributes);
                  const isBurned = borg.owner === null;

                  return (
                    <div
                      key={borg.id}
                      onClick={e => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setPopover(prev =>
                          prev?.borgId === borg.id ? null : { borgId: borg.id, rect },
                        );
                      }}
                      className="group relative cursor-pointer overflow-clip rounded-xl transition-transform hover:scale-105 hover:shadow-lg"
                      style={{
                        width: layout.cellSize,
                        height: layout.cellSize,
                        backgroundColor: CELL_BG,
                      }}
                    >
                      {uri && (
                        <img
                          src={uri}
                          alt={`Borg ${borg.id}`}
                          loading="lazy"
                          style={{
                            width: layout.cellSize,
                            height: layout.cellSize,
                            imageRendering: 'pixelated',
                            filter: isBurned ? 'grayscale(0.9)' : undefined,
                            opacity: isBurned ? 0.6 : 1,
                          }}
                        />
                      )}
                      {isBurned && (
                        <span className="absolute right-1 top-1 text-[10px]" title="Bred away">
                          ☠️
                        </span>
                      )}
                      <span className="absolute bottom-0.5 left-1/2 hidden -translate-x-1/2 rounded bg-white/90 px-1 text-[10px] font-bold shadow-sm group-hover:block">
                        {borg.id}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {popover && data.borgs.get(popover.borgId) && (
        <BorgDetailPopover
          borg={data.borgs.get(popover.borgId)!}
          borgs={data.borgs}
          attributes={data.attributes}
          totalBorgs={data.meta.maxId}
          anchorRect={popover.rect}
          onClose={() => setPopover(null)}
          onNavigate={id => setPopover(prev => (prev ? { borgId: id, rect: prev.rect } : null))}
        />
      )}

      <MintBorgDialog
        open={mintOpen}
        onOpenChange={setMintOpen}
        data={data}
        onMinted={refreshData}
      />
      <BreedBorgsDialog
        open={breedOpen}
        onOpenChange={setBreedOpen}
        data={data}
        onBred={refreshData}
      />
    </>
  );
};

/* ------------------------------ trait filter ------------------------------ */

function BorgTraitRow({
  layer,
  label,
  options,
  attributes,
  selected,
  onToggle,
}: {
  layer: number;
  label: string;
  options: number[];
  attributes: BorgAttribute[];
  selected: number[];
  onToggle: (layer: number, attrIdx: number) => void;
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
            <span className="ml-2 rounded-full bg-black px-2 py-0.5 text-xs text-white">
              {selected.length}
            </span>
          )}
        </span>
        <ChevronDown className={`h-4 w-4 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {expanded && (
        <div className="flex max-h-56 flex-wrap gap-1 overflow-y-auto border-t p-2">
          {options.map(attrIdx => {
            const attr = attributes[attrIdx];
            const isSelected = selected.includes(attrIdx);
            const blank = isBlankAttribute(attr.n);
            const icon = blank ? null : renderBorgImage([attrIdx], attributes);
            return (
              <button
                type="button"
                key={attrIdx}
                onClick={() => onToggle(layer, attrIdx)}
                title={`${attr.u} borgs`}
                className={`flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-all ${
                  isSelected
                    ? 'border-black bg-black text-white'
                    : 'border-gray-200 hover:border-gray-400'
                }`}
              >
                {icon && (
                  <img
                    src={icon}
                    alt=""
                    className="h-5 w-5 rounded-sm"
                    style={{ imageRendering: 'pixelated', backgroundColor: CELL_BG }}
                  />
                )}
                {blank ? 'None' : attr.n}
                <span className={isSelected ? 'text-gray-300' : 'text-gray-400'}>{attr.u}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------ owner filter ------------------------------ */

function BorgOwnerDropdown({
  entries,
  value,
  onChange,
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
    return entries
      .filter(
        e => e.address.toLowerCase().includes(q) || (e.ens && e.ens.toLowerCase().includes(q)),
      )
      .slice(0, 50);
  }, [entries, query]);

  const selectedLabel = value
    ? (entries.find(e => e.address === value)?.ens ?? `${value.slice(0, 6)}...${value.slice(-4)}`)
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
              <p className="px-3 py-2 text-xs text-gray-400">
                {entries.length === 0 ? 'Loading...' : 'No results'}
              </p>
            ) : (
              filtered.map(e => (
                <button
                  type="button"
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

/* --------------------------------- minting -------------------------------- */

function useBorgsTx(onSettled: () => void) {
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync, isPending } = useWriteContract();
  const [hash, setHash] = useState<`0x${string}` | undefined>();
  const [error, setError] = useState<string | null>(null);

  const receipt = useWaitForTransactionReceipt({
    hash,
    chainId: polygon.id,
    query: { enabled: !!hash },
  });

  useEffect(() => {
    if (receipt.isSuccess) onSettled();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [receipt.isSuccess]);

  const send = useCallback(
    async (params: {
      functionName: 'generateBorg' | 'breedBorgs';
      args?: readonly [bigint, bigint];
      value?: bigint;
    }) => {
      setError(null);
      try {
        if (chainId !== polygon.id) await switchChainAsync({ chainId: polygon.id });
        const txHash =
          params.functionName === 'generateBorg'
            ? await writeContractAsync({
                address: BORGS_ADDRESS,
                abi: borgsAbi,
                chainId: polygon.id,
                functionName: 'generateBorg',
                value: params.value ?? 0n,
              })
            : await writeContractAsync({
                address: BORGS_ADDRESS,
                abi: borgsAbi,
                chainId: polygon.id,
                functionName: 'breedBorgs',
                args: params.args!,
              });
        setHash(txHash);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setError(message.split('\n')[0].slice(0, 200));
      }
    },
    [chainId, switchChainAsync, writeContractAsync],
  );

  const reset = useCallback(() => {
    setHash(undefined);
    setError(null);
  }, []);

  return {
    address,
    send,
    reset,
    error,
    isPending,
    isConfirming: !!hash && receipt.isLoading,
    receipt,
  };
}

function MintBorgDialog({
  open,
  onOpenChange,
  data,
  onMinted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: BorgsData;
  onMinted: () => Promise<void> | void;
}) {
  const [mintedId, setMintedId] = useState<number | null>(null);
  const [price, setPrice] = useState<bigint | null>(null);
  const tx = useBorgsTx(async () => {
    // Pull the fresh borg into local data, then read the id from the receipt
    await onMinted();
  });
  const { address } = tx;

  // Whitelist-aware price (free founder mints return 0)
  useEffect(() => {
    if (!open) return;
    polygonClient
      .readContract({
        address: BORGS_ADDRESS,
        abi: borgsAbi,
        functionName: 'getGenerationPrice',
        account: address,
      })
      .then(setPrice)
      .catch(() => setPrice(null));
  }, [open, address]);

  // Extract minted borg id once the receipt lands
  useEffect(() => {
    if (!tx.receipt.isSuccess || !tx.receipt.data) return;
    for (const log of tx.receipt.data.logs) {
      if (log.address.toLowerCase() !== BORGS_ADDRESS.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({ abi: borgsAbi, data: log.data, topics: log.topics });
        if (decoded.eventName === 'GeneratedBorg') {
          setMintedId(Number((decoded.args as { borgId: bigint }).borgId));
          return;
        }
      } catch {
        /* not our event */
      }
    }
  }, [tx.receipt.isSuccess, tx.receipt.data]);

  const minted = mintedId !== null ? data.borgs.get(mintedId) : null;
  const mintedImage = minted ? renderBorgImage(minted.attrs, data.attributes) : null;

  const close = (o: boolean) => {
    if (!o) {
      tx.reset();
      setMintedId(null);
    }
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mint a Borg</DialogTitle>
          <DialogDescription>
            Rolls a fresh borg from the onchain trait pool — pure chain randomness, no metadata
            server.
          </DialogDescription>
        </DialogHeader>

        {mintedId !== null ? (
          <div className="flex flex-col items-center gap-3 py-2">
            {mintedImage ? (
              <img
                src={mintedImage}
                alt={`Borg ${mintedId}`}
                className="h-40 w-40 rounded-xl"
                style={{ imageRendering: 'pixelated', backgroundColor: CELL_BG }}
              />
            ) : (
              <div className="h-40 w-40 animate-pulse rounded-xl bg-gray-100" />
            )}
            <p className="text-sm font-bold">Borg {mintedId} is yours! 🤖</p>
            <Button size="sm" onClick={() => close(false)}>
              Done
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="rounded-lg bg-gray-50 p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-500">Price</span>
                <span className="font-bold">
                  {price === null
                    ? '…'
                    : price === 0n
                      ? 'Free (founder allocation)'
                      : `${formatEther(price)} POL`}
                </span>
              </div>
              <div className="mt-1 flex justify-between">
                <span className="text-gray-500">Supply</span>
                <span className="font-semibold">
                  {data.meta.generated.toLocaleString()} / {BORGS_SUPPLY_LIMIT.toLocaleString()}{' '}
                  generated
                </span>
              </div>
            </div>
            {!address && <p className="text-xs text-amber-600">Connect a wallet to mint.</p>}
            {tx.error && <p className="break-words text-xs text-red-500">{tx.error}</p>}
            <Button
              disabled={!address || price === null || tx.isPending || tx.isConfirming}
              onClick={() => tx.send({ functionName: 'generateBorg', value: price ?? 0n })}
            >
              {tx.isPending
                ? 'Confirm in wallet…'
                : tx.isConfirming
                  ? 'Minting on Polygon…'
                  : 'Mint'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/* --------------------------------- breeding -------------------------------- */

function BreedBorgsDialog({
  open,
  onOpenChange,
  data,
  onBred,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: BorgsData;
  onBred: () => Promise<void> | void;
}) {
  const [ownedIds, setOwnedIds] = useState<number[] | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [preview, setPreview] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [childId, setChildId] = useState<number | null>(null);
  const tx = useBorgsTx(async () => {
    await onBred();
  });
  const { address } = tx;

  // Live owned set (snapshot owners can be stale after transfers)
  useEffect(() => {
    if (!open || !address) return;
    setOwnedIds(null);
    fetchOwnedBorgIds(address)
      .then(setOwnedIds)
      .catch(() => setOwnedIds([]));
  }, [open, address]);

  // A borg can only breed once — descendants lock their parents out forever.
  const breedable = useMemo(() => {
    if (!ownedIds) return [];
    return ownedIds.filter(id => {
      const borg = data.borgs.get(id);
      return !borg || borg.child === 0;
    });
  }, [ownedIds, data]);

  // On-chain preview of the child (rarest trait per layer wins)
  useEffect(() => {
    setPreview(null);
    if (selected.length !== 2) return;
    setPreviewLoading(true);
    polygonClient
      .readContract({
        address: BORGS_ADDRESS,
        abi: borgsAbi,
        functionName: 'previewBreedBorgs',
        args: [BigInt(selected[0]), BigInt(selected[1])],
      })
      .then(([image]) => setPreview(renderRawBorgImage(image)))
      .catch(() => setPreview(null))
      .finally(() => setPreviewLoading(false));
  }, [selected]);

  // Extract child id from receipt
  useEffect(() => {
    if (!tx.receipt.isSuccess || !tx.receipt.data) return;
    for (const log of tx.receipt.data.logs) {
      if (log.address.toLowerCase() !== BORGS_ADDRESS.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({ abi: borgsAbi, data: log.data, topics: log.topics });
        if (decoded.eventName === 'BredBorg') {
          setChildId(Number((decoded.args as { childId: bigint }).childId));
          return;
        }
      } catch {
        /* not our event */
      }
    }
  }, [tx.receipt.isSuccess, tx.receipt.data]);

  const toggleSelect = (id: number) => {
    setSelected(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : prev.length >= 2 ? prev : [...prev, id],
    );
  };

  const close = (o: boolean) => {
    if (!o) {
      tx.reset();
      setSelected([]);
      setPreview(null);
      setChildId(null);
    }
    onOpenChange(o);
  };

  const child = childId !== null ? data.borgs.get(childId) : null;
  const childImage = child ? renderBorgImage(child.attrs, data.attributes) : null;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Breed Borgs</DialogTitle>
          <DialogDescription>
            The child inherits the <strong>rarest trait on every layer</strong>. Both parents are{' '}
            <strong className="text-red-500">burned forever</strong>, and each borg can only breed
            once.
          </DialogDescription>
        </DialogHeader>

        {childId !== null ? (
          <div className="flex flex-col items-center gap-3 py-2">
            {childImage ? (
              <img
                src={childImage}
                alt={`Borg ${childId}`}
                className="h-40 w-40 rounded-xl"
                style={{ imageRendering: 'pixelated', backgroundColor: CELL_BG }}
              />
            ) : (
              <div className="h-40 w-40 animate-pulse rounded-xl bg-gray-100" />
            )}
            <p className="text-sm font-bold">Borg {childId} was born! Parents rest in pixels. 🕯️</p>
            <Button size="sm" onClick={() => close(false)}>
              Done
            </Button>
          </div>
        ) : !address ? (
          <p className="text-sm text-amber-600">Connect a wallet to breed your borgs.</p>
        ) : ownedIds === null ? (
          <p className="text-muted-foreground text-sm">Checking your borgs on Polygon…</p>
        ) : breedable.length < 2 ? (
          <p className="text-muted-foreground text-sm">
            You need at least two borgs that haven&apos;t bred yet. You have {breedable.length}.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-gray-500">Pick two parents ({selected.length}/2):</p>
            <div className="grid max-h-48 grid-cols-5 gap-2 overflow-y-auto">
              {breedable.map(id => {
                const borg = data.borgs.get(id);
                const uri = borg ? renderBorgImage(borg.attrs, data.attributes) : null;
                const isSel = selected.includes(id);
                return (
                  <button
                    type="button"
                    key={id}
                    onClick={() => toggleSelect(id)}
                    className={`relative overflow-clip rounded-lg border-2 transition-all ${
                      isSel ? 'border-black shadow-md' : 'border-transparent hover:border-gray-300'
                    }`}
                    style={{ backgroundColor: CELL_BG, aspectRatio: '1' }}
                    title={`Borg ${id}`}
                  >
                    {uri ? (
                      <img
                        src={uri}
                        alt={`Borg ${id}`}
                        style={{ width: '100%', imageRendering: 'pixelated' }}
                      />
                    ) : (
                      <span className="text-[10px]">{id}</span>
                    )}
                    <span className="absolute bottom-0 left-0 right-0 bg-white/80 text-[9px] font-bold">
                      {id}
                    </span>
                  </button>
                );
              })}
            </div>

            {selected.length === 2 && (
              <div className="flex items-center gap-3 rounded-lg bg-gray-50 p-3">
                <div
                  className="h-20 w-20 shrink-0 overflow-clip rounded-lg"
                  style={{ backgroundColor: CELL_BG }}
                >
                  {previewLoading ? (
                    <div className="h-full w-full animate-pulse bg-gray-200" />
                  ) : preview ? (
                    <img
                      src={preview}
                      alt="Child preview"
                      style={{ width: '100%', imageRendering: 'pixelated' }}
                    />
                  ) : null}
                </div>
                <p className="text-xs text-gray-600">
                  Child preview — traits can shift slightly if rarity counts change before your tx
                  lands. Borgs {selected[0]} &amp; {selected[1]} will be{' '}
                  <strong className="text-red-500">burned</strong>.
                </p>
              </div>
            )}

            {tx.error && <p className="break-words text-xs text-red-500">{tx.error}</p>}
            <Button
              variant="destructive"
              disabled={selected.length !== 2 || tx.isPending || tx.isConfirming}
              onClick={() =>
                tx.send({
                  functionName: 'breedBorgs',
                  args: [BigInt(selected[0]), BigInt(selected[1])],
                })
              }
            >
              {tx.isPending
                ? 'Confirm in wallet…'
                : tx.isConfirming
                  ? 'Breeding on Polygon…'
                  : 'Breed (burns both parents)'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default BorgsTab;
