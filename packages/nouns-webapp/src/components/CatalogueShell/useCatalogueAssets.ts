/**
 * useCatalogueAssets — Unified asset feed for the Catalogue shell.
 *
 * Aggregates assets from:
 *  - Nouns trait library (heads, bodies, accessories, glasses) via @noundry/nouns-assets
 *  - cc0-lib.wtf public API (https://cc0-lib.wtf/api/data) — best-effort, graceful empty state
 *  - Propdates, Dreams (existing hooks)
 *  - Nouns World stories (curated)
 *  - The live auction (single card)
 *
 * Each asset is normalized into a CatalogueAsset shape so view modes (cover-flow,
 * grid, list, masonry) can render them uniformly.
 */
import { useEffect, useMemo, useState } from 'react';

import { ImageData } from '@noundry/nouns-assets';

import { useDreams } from '@/components/DreamsBanner';
import { NOUNS_WORLD_STORIES } from '@/components/NounsWorldBanner';
import { useAppSelector } from '@/hooks';
import { usePropdates } from '@/hooks/usePropdates';

// ─── Types ──────────────────────────────────────────────────────────────────

export type AssetMediaType = 'image' | 'pixel' | 'svg' | 'video' | 'audio' | '3d' | 'other';
export type AssetCollection =
  | 'nouns-trait'
  | 'auction'
  | 'propdate'
  | 'dream'
  | 'nouns-world'
  | 'cc0-lib';

export interface CatalogueAsset {
  id: string;
  title: string;
  subtitle: string;
  /** Display image / thumbnail URL (always populated). */
  image: string;
  /** Optional full-resolution / source asset (for cc0-lib). */
  fileUrl?: string;
  /** External link — opens in new tab. Internal noun.wtf links are inert per shell lockdown. */
  href: string;
  /** Source collection bucket (used for filters). */
  collection: AssetCollection;
  /** Media type bucket (used for filters). */
  media: AssetMediaType;
  /** Sub-category like trait category, file extension, or cc0-lib tag. */
  category: string;
  /** Tags for fuzzy search. */
  tags: string[];
  /** Optional unix-ms timestamp for date-sort. */
  timestamp?: number;
  /** Background color for cover-flow card backing. */
  bgColor?: string;
  /** Free-form metadata for detail popovers. */
  meta?: Record<string, unknown>;
}

// ─── Pixel decoder (RLE → SVG data URL) ─────────────────────────────────────

function decodeRLE(data: string, palette: string[]): string[][] {
  const hex = data.replace(/^0x/, '');
  const top = parseInt(hex.substring(2, 4), 16);
  const right = parseInt(hex.substring(4, 6), 16);
  const left = parseInt(hex.substring(8, 10), 16);
  const grid: string[][] = Array.from({ length: 32 }, () => Array(32).fill(''));

  const pairs = hex.substring(10).match(/.{1,4}/g) || [];
  let x = left;
  let y = top;
  for (const r of pairs) {
    const runLen = parseInt(r.substring(0, 2), 16);
    const colorIdx = parseInt(r.substring(2, 4), 16);
    for (let i = 0; i < runLen; i++) {
      if (colorIdx !== 0 && y < 32 && x < 32) {
        grid[y][x] = `#${palette[colorIdx]}`;
      }
      x++;
      if (x >= right) {
        x = left;
        y++;
      }
    }
  }
  return grid;
}

function pixelsToSvg(grid: string[][], bgColor: string): string {
  let rects = `<rect width="320" height="320" fill="#${bgColor}" />`;
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      if (grid[y][x]) {
        rects += `<rect x="${x * 10}" y="${y * 10}" width="10" height="10" fill="${grid[y][x]}" />`;
      }
    }
  }
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320" shape-rendering="crispEdges">${rects}</svg>`,
  )}`;
}

// ─── Trait library (full set, not just sample) ──────────────────────────────

const NOUNDRY_GALLERY = 'https://gallery.noundry.wtf/';

let _traitCache: CatalogueAsset[] | null = null;
function buildTraitAssets(): CatalogueAsset[] {
  if (_traitCache) return _traitCache;
  const palette = ImageData.palette;
  const bgColors = ImageData.bgcolors;
  const cats: { key: 'heads' | 'bodies' | 'accessories' | 'glasses'; label: string }[] = [
    { key: 'heads', label: 'Head' },
    { key: 'bodies', label: 'Body' },
    { key: 'accessories', label: 'Accessory' },
    { key: 'glasses', label: 'Glasses' },
  ];
  const out: CatalogueAsset[] = [];
  for (const { key, label } of cats) {
    const images = ImageData.images[key];
    // Cap per-category so the catalogue doesn't render 200+ heads at once
    const cap = 60;
    const step = Math.max(1, Math.floor(images.length / cap));
    for (let i = 0; i < images.length; i += step) {
      const img = images[i];
      const bg = bgColors[i % bgColors.length];
      const grid = decodeRLE(img.data, palette);
      const cleanName =
        img.filename?.replace(/^(head|body|accessory|glasses)-/, '').replace(/-/g, ' ') ||
        `${label} ${i}`;
      out.push({
        id: `trait-${key}-${i}`,
        title: cleanName,
        subtitle: `Nouns Trait · ${label}`,
        image: pixelsToSvg(grid, bg),
        href: NOUNDRY_GALLERY,
        collection: 'nouns-trait',
        media: 'pixel',
        category: label,
        tags: ['nouns', 'trait', label.toLowerCase(), 'cc0', 'pixel'],
        bgColor: `#${bg}`,
        meta: { filename: img.filename, index: i },
      });
    }
  }
  _traitCache = out;
  return out;
}

// ─── cc0-lib.wtf public API ─────────────────────────────────────────────────

interface CC0Item {
  ID?: string;
  Title?: string;
  Description?: string;
  File?: string;
  Filetype?: string;
  Type?: string;
  Tags?: string[];
  Source?: string;
  ENS?: string;
  'Social Link'?: string;
  Thumbnails?: { name: string; url: string; rawUrl?: string }[];
}

const CC0_API = 'https://cc0-lib.wtf/api/data';
// Probe a curated set of tags — cc0-lib's API requires a parameter, no list-all.
const CC0_PROBE_TAGS = ['design', 'art', 'logo', 'icon', 'brand', 'meme', '3d', 'ui'];

function inferMedia(filetype?: string): AssetMediaType {
  if (!filetype) return 'other';
  const ft = filetype.toLowerCase();
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif'].includes(ft)) return 'image';
  if (['svg'].includes(ft)) return 'svg';
  if (['mp4', 'webm', 'mov'].includes(ft)) return 'video';
  if (['mp3', 'wav', 'ogg', 'flac'].includes(ft)) return 'audio';
  if (['glb', 'gltf', 'fbx', 'obj', 'stl'].includes(ft)) return '3d';
  return 'other';
}

function cc0ToAsset(it: CC0Item): CatalogueAsset | null {
  const file = it.File;
  const thumb = it.Thumbnails?.[0]?.url || file;
  if (!thumb) return null;
  const ft = (it.Filetype || '').toLowerCase();
  return {
    id: `cc0-${it.ID ?? it.Title ?? Math.random().toString(36).slice(2)}`,
    title: it.Title || 'Untitled',
    subtitle: it.ENS ? `cc0-lib · ${it.ENS}` : 'cc0-lib',
    image: thumb,
    fileUrl: file,
    href: it.Source || file || 'https://cc0-lib.wtf',
    collection: 'cc0-lib',
    media: inferMedia(ft),
    category: it.Type || 'asset',
    tags: ['cc0', ...(it.Tags ?? []), it.Type, ft].filter(Boolean) as string[],
    meta: { filetype: ft, ens: it.ENS, description: it.Description },
  };
}

function useCC0LibAssets(): { items: CatalogueAsset[]; isLoading: boolean } {
  const [items, setItems] = useState<CatalogueAsset[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const collected: CatalogueAsset[] = [];
      const seen = new Set<string>();
      // Probe sequentially to respect rate limit (10 req / 10s).
      for (const tag of CC0_PROBE_TAGS) {
        if (cancelled) return;
        try {
          const res = await fetch(`${CC0_API}?tag=${encodeURIComponent(tag)}`);
          if (!res.ok) continue;
          const j = await res.json();
          if (!Array.isArray(j?.data)) continue;
          for (const raw of j.data as CC0Item[]) {
            const a = cc0ToAsset(raw);
            if (!a || seen.has(a.id)) continue;
            seen.add(a.id);
            collected.push(a);
          }
        } catch {
          // CORS, network, or rate-limit — best-effort
        }
        // Tiny delay between probes
        await new Promise(r => setTimeout(r, 250));
      }
      if (!cancelled) {
        setItems(collected);
        setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { items, isLoading };
}

// ─── Other source adapters ──────────────────────────────────────────────────

const PROPDATES_BASE = 'https://propdates.nouns.wtf/prop/';
const PROBE_DREAMS = 'https://probe.wtf/en-US/nouns/dreams';

// ─── Main hook ──────────────────────────────────────────────────────────────

export function useCatalogueAssets(): { items: CatalogueAsset[]; isLoading: boolean } {
  const propdates = usePropdates();
  const dreams = useDreams();
  const cc0 = useCC0LibAssets();
  const traits = useMemo(buildTraitAssets, []);
  const stories = NOUNS_WORLD_STORIES;
  const activeAuction = useAppSelector(s => s.auction.activeAuction);

  const items = useMemo<CatalogueAsset[]>(() => {
    const all: CatalogueAsset[] = [];

    if (activeAuction) {
      const nid = String(activeAuction.nounId);
      all.push({
        id: `auction-${nid}`,
        title: `Noun ${nid}`,
        subtitle: 'Live auction',
        image: `https://noun.pics/${nid}`,
        href: 'https://noun.wtf',
        collection: 'auction',
        media: 'image',
        category: 'Auction',
        tags: ['nouns', 'auction', 'live', `noun-${nid}`],
        timestamp: Number(activeAuction.startTime) * 1000,
        meta: { nounId: nid },
      });
    }

    if (propdates.data) {
      for (const p of propdates.data) {
        if (!p.imageUrl) continue;
        all.push({
          id: `propdate-${p.propId}-${p.blockNumber}`,
          title: p.title || `Prop ${p.propId}`,
          subtitle: `Propdate · Prop ${p.propId}`,
          image: p.imageUrl,
          href: `${PROPDATES_BASE}${p.propId}`,
          collection: 'propdate',
          media: 'image',
          category: 'Propdate',
          tags: ['propdate', 'governance', `prop-${p.propId}`],
          timestamp: Number(p.blockNumber) * 12_000, // rough block-number ordering
          meta: { propId: p.propId, blockNumber: p.blockNumber },
        });
      }
    }

    if (dreams.data) {
      for (const d of dreams.data) {
        const img = d.svgBase64 || d.customOverlayUrl;
        if (!img) continue;
        all.push({
          id: `dream-${d.id}`,
          title: `Dream #${d.id}`,
          subtitle: `Dreamed by ${d.dreamer.slice(0, 6)}…${d.dreamer.slice(-4)}`,
          image: img,
          href: PROBE_DREAMS,
          collection: 'dream',
          media: 'svg',
          category: 'Dream',
          tags: ['dream', 'probe', `dream-${d.id}`],
          meta: { dreamer: d.dreamer },
        });
      }
    }

    for (const t of traits) all.push(t);

    for (let i = 0; i < stories.length; i++) {
      const s = stories[i];
      all.push({
        id: `story-${i}`,
        title: s.title,
        subtitle: 'Nouns World',
        image: s.image,
        href: s.url,
        collection: 'nouns-world',
        media: 'image',
        category: 'Story',
        tags: ['nouns-world', 'story'],
      });
    }

    for (const a of cc0.items) all.push(a);

    return all;
  }, [propdates.data, dreams.data, traits, stories, activeAuction, cc0.items]);

  return {
    items,
    isLoading: propdates.isLoading || dreams.isLoading || cc0.isLoading,
  };
}
