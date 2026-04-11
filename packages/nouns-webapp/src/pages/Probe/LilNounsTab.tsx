import { FC, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { buildSVG } from '@nouns/sdk';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

import LilNounDetailPopover from '@/components/LilNounDetailPopover';

const IMAGE_DATA_URL = 'https://assets.noundry.wtf/lil-nouns/image-data.json';
const LIL_SEEDS_URL = '/probe-dreams/lil-seeds.json';
const LIL_NOUNS_TOKEN = '0x4b10701Bfd7BFEdc47d50562b76b436fbB5BdB3B' as const;
const MIN_CELL = 72;
const GAP = 4;

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

let cachedImageData: LilImageData | null = null;
let cachedSeeds: Map<number, LilSeed> | null = null;
const svgCache = new Map<number, string>();

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

/** Fetch seeds for any lil nouns minted after our static snapshot */
async function fetchNewMints(
  currentSeeds: Map<number, LilSeed>,
  setSeeds: (fn: (prev: Map<number, LilSeed>) => Map<number, LilSeed>) => void,
) {
  const maxId = Math.max(...currentSeeds.keys());
  try {
    const client = createPublicClient({
      chain: mainnet,
      transport: http('https://ethereum-rpc.publicnode.com', { timeout: 15_000 }),
    });

    // Try IDs above our max, stop when we hit a non-existent one
    let id = maxId + 1;
    let added = 0;
    while (added < 200) {
      try {
        const r = await client.readContract({
          address: LIL_NOUNS_TOKEN,
          abi: SEEDS_ABI,
          functionName: 'seeds',
          args: [BigInt(id)],
        });
        const seed: LilSeed = {
          background: Number(r[0]),
          body: Number(r[1]),
          accessory: Number(r[2]),
          head: Number(r[3]),
          glasses: Number(r[4]),
        };
        // Skip all-zero seeds (non-existent)
        if (seed.background === 0 && seed.body === 0 && seed.accessory === 0 && seed.head === 0 && seed.glasses === 0 && id > 0) {
          break;
        }
        currentSeeds.set(id, seed);
        added++;
        id++;
      } catch {
        break; // ID doesn't exist
      }
    }

    if (added > 0) {
      cachedSeeds = currentSeeds;
      setSeeds(() => new Map(currentSeeds));
      console.log(`[LilNouns] Fetched ${added} new mints (up to ID ${id - 1})`);
    }
  } catch {
    // Silent — new mints just won't show
  }
}

const LilNounsTab: FC = () => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [imageData, setImageData] = useState<LilImageData | null>(cachedImageData);
  const [seeds, setSeeds] = useState<Map<number, LilSeed>>(cachedSeeds ?? new Map());
  const [loading, setLoading] = useState(!cachedSeeds);
  const [popover, setPopover] = useState<{ lilId: number; rect: DOMRect } | null>(null);

  // Load image data + seeds in parallel
  useEffect(() => {
    if (cachedImageData && cachedSeeds) {
      setImageData(cachedImageData);
      setSeeds(cachedSeeds);
      setLoading(false);
      return;
    }

    Promise.all([
      cachedImageData
        ? Promise.resolve(cachedImageData)
        : fetch(IMAGE_DATA_URL).then(r => r.json()),
      cachedSeeds
        ? Promise.resolve(null)
        : fetch(LIL_SEEDS_URL).then(r => r.json()),
    ])
      .then(([imgData, seedsData]) => {
        cachedImageData = imgData as LilImageData;
        setImageData(cachedImageData);

        if (seedsData) {
          // seedsData is { "0": [bg,body,acc,head,glasses], ... }
          const seedMap = new Map<number, LilSeed>();
          for (const [idStr, arr] of Object.entries(seedsData)) {
            const a = arr as number[];
            seedMap.set(Number(idStr), {
              background: a[0],
              body: a[1],
              accessory: a[2],
              head: a[3],
              glasses: a[4],
            });
          }
          cachedSeeds = seedMap;
          setSeeds(seedMap);
        }
      })
      .then(() => {
        // Auto-fetch any new mints above our static snapshot
        if (cachedSeeds) fetchNewMints(cachedSeeds, setSeeds);
      })
      .catch(err => console.error('Failed to load lil nouns data:', err))
      .finally(() => setLoading(false));
  }, []);

  // IDs sorted descending
  const lilIds = useMemo(
    () => Array.from(seeds.keys()).sort((a, b) => b - a),
    [seeds],
  );

  // Search filter
  const [search, setSearch] = useState('');
  const filteredIds = useMemo(() => {
    if (!search.trim()) return lilIds;
    const q = search.trim();
    return lilIds.filter(id => id.toString().includes(q));
  }, [lilIds, search]);

  // Layout — measure parent width
  const [layout, setLayout] = useState({ cols: 8, cellSize: MIN_CELL });
  useEffect(() => {
    const measure = () => {
      const el = containerRef.current;
      let w = el ? el.getBoundingClientRect().width : 0;
      // Fallback: viewport minus page padding (px-2 = 8px each side on mobile)
      if (w <= 0) w = window.innerWidth - 16;
      const cols = Math.max(3, Math.floor(w / (MIN_CELL + GAP)));
      const cellSize = Math.floor((w - GAP * (cols - 1)) / cols);
      setLayout({ cols, cellSize });
    };
    // Measure after mount + on resize
    // Delay to ensure layout is settled
    const timer = setTimeout(measure, 50);
    window.addEventListener('resize', measure);
    return () => { clearTimeout(timer); window.removeEventListener('resize', measure); };
  }, []);

  const rowHeight = layout.cellSize + GAP;
  const filteredRows = Math.ceil(filteredIds.length / layout.cols);

  const rowVirtualizer = useWindowVirtualizer({
    count: filteredRows,
    estimateSize: () => rowHeight,
    overscan: 5,
    scrollMargin: containerRef.current?.offsetTop ?? 0,
  });

  const getSvg = useCallback(
    (id: number): string | null => {
      if (svgCache.has(id)) return svgCache.get(id)!;
      const seed = seeds.get(id);
      if (!seed || !imageData) return null;
      try {
        const svg = buildLilSvg(seed, imageData);
        svgCache.set(id, svg);
        return svg;
      } catch {
        return null;
      }
    },
    [seeds, imageData],
  );

  if (loading) {
    return (
      <div className="py-16 text-center">
        <p className="text-muted-foreground">Loading Lil Nouns...</p>
      </div>
    );
  }

  return (
    <>
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 py-3">
        <input
          type="text"
          placeholder="Search ID..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="border-border w-28 rounded-lg border bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-black"
        />
        <span className="text-muted-foreground ml-auto text-sm">
          {filteredIds.length !== lilIds.length ? `${filteredIds.length} / ` : ''}
          {lilIds.length} Lils
        </span>
      </div>

      <div ref={containerRef} style={{ width: '100%', overflow: 'hidden' }}>
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
                  if (itemIndex >= filteredIds.length) return <div key={colIdx} />;

                  const lilId = filteredIds[itemIndex];
                  const svg = getSvg(lilId);
                  const seed = seeds.get(lilId);
                  const bg = seed && imageData
                    ? `#${imageData.bgcolors[seed.background]}`
                    : '#d5d7e1';

                  return (
                    <div
                      key={lilId}
                      onClick={e => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        setPopover(prev => prev?.lilId === lilId ? null : { lilId, rect });
                      }}
                      className="group relative cursor-pointer overflow-clip rounded-xl transition-transform hover:scale-105 hover:shadow-lg"
                      style={{
                        width: layout.cellSize,
                        height: layout.cellSize,
                        backgroundColor: bg,
                      }}
                    >
                      {svg && (
                        <img
                          src={`data:image/svg+xml;base64,${svg}`}
                          alt={`Lil Noun ${lilId}`}
                          style={{
                            width: layout.cellSize,
                            height: layout.cellSize,
                            imageRendering: 'pixelated',
                          }}
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

export default LilNounsTab;
