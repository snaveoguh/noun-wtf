/**
 * useCatalogueAssets — Unified asset feed for the Catalogue shell.
 *
 * Aggregates assets from many CC0 / nounish sources:
 *  - Nouns trait library (heads, bodies, accessories, glasses) via @noundry/nouns-assets
 *  - Lil Nouns trait library (https://assets.noundry.wtf/lil-nouns/image-data.json)
 *  - Lil Nouns pre-rendered art (public/probe-dreams/rendered/*.svg, ~721 nouns)
 *  - Probe custom dream-trait PNGs (public/probe-dreams/traits/*.png, ~338 items)
 *  - Probe Dreams (live API)
 *  - cc0-lib.wtf public API (https://cc0-lib.wtf/api/data) — best-effort
 *  - Past auction winners (sampled noun.pics historical mainnet nouns)
 *  - Sketches (public/sketches/*.gif)
 *  - Propdates, Nouns World stories
 *  - Live auction
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
  | 'cc0-lib'
  | 'probe-dream'
  | 'lil-trait'
  | 'probe-trait'
  | 'past-noun'
  | 'sketch';

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
  /** Canonical, clickable source page for this asset (where it lives on the web). */
  sourceUrl?: string;
  /** Human-readable label for the source location ("noun.pics", "lilnouns.wtf", etc.). */
  sourceLabel?: string;
  /** Source collection bucket (used for filters). */
  collection: AssetCollection;
  /** Media type bucket (used for filters). */
  media: AssetMediaType;
  /**
   * Render hint: true if the source asset is pixel-art (Noun trait, Lil Noun,
   * Probe custom, dream, sketch, rendered noun) and should be displayed with
   * `image-rendering: pixelated`. False for photographic / continuous-tone
   * assets (Propdates, NounsWorld stories, most cc0-lib items) so the browser
   * uses bilinear scaling.
   */
  isPixel: boolean;
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
        sourceUrl: NOUNDRY_GALLERY,
        sourceLabel: 'gallery.noundry.wtf',
        collection: 'nouns-trait',
        media: 'pixel',
        isPixel: true,
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

// ─── Lil Nouns trait library (fetched from noundry assets CDN) ──────────────

interface EncodedImage {
  filename: string;
  data: string;
}

interface LilImageData {
  bgcolors: string[];
  palette: string[];
  images: {
    bodies: EncodedImage[];
    accessories: EncodedImage[];
    heads: EncodedImage[];
    glasses?: EncodedImage[];
  };
}

const LIL_IMAGE_DATA_URL = 'https://assets.noundry.wtf/lil-nouns/image-data.json';

// Module-level cache so we only ever fetch the Lil image data once per session.
let _lilDataCache: LilImageData | null = null;
let _lilDataPromise: Promise<LilImageData> | null = null;

function fetchLilImageData(): Promise<LilImageData> {
  if (_lilDataCache) return Promise.resolve(_lilDataCache);
  if (!_lilDataPromise) {
    _lilDataPromise = fetch(LIL_IMAGE_DATA_URL)
      .then(r => {
        if (!r.ok) throw new Error('lil image-data fetch failed');
        return r.json();
      })
      .then((d: LilImageData) => {
        _lilDataCache = d;
        return d;
      })
      .catch(err => {
        // Reset so a future caller can retry; rethrow so the current caller
        // can surface the error (we just swallow in the hook).
        _lilDataPromise = null;
        throw err;
      });
  }
  return _lilDataPromise;
}

function useLilTraitAssets(): { items: CatalogueAsset[]; isLoading: boolean } {
  const [data, setData] = useState<LilImageData | null>(_lilDataCache);
  const [isLoading, setIsLoading] = useState(!_lilDataCache);

  useEffect(() => {
    if (_lilDataCache) {
      setData(_lilDataCache);
      setIsLoading(false);
      return;
    }
    let cancelled = false;
    fetchLilImageData()
      .then(d => {
        if (cancelled) return;
        setData(d);
        setIsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const items = useMemo<CatalogueAsset[]>(() => {
    if (!data) return [];
    const palette = data.palette;
    const bgColors = data.bgcolors;
    const cats: {
      key: keyof LilImageData['images'];
      label: string;
    }[] = [
      { key: 'heads', label: 'Head' },
      { key: 'bodies', label: 'Body' },
      { key: 'accessories', label: 'Accessory' },
      { key: 'glasses', label: 'Glasses' },
    ];
    const out: CatalogueAsset[] = [];
    for (const { key, label } of cats) {
      const arr = data.images[key];
      if (!arr || arr.length === 0) continue;
      // Cap each category at 50 to keep the catalogue diverse.
      const cap = 50;
      const step = Math.max(1, Math.floor(arr.length / cap));
      for (let i = 0; i < arr.length; i += step) {
        const img = arr[i];
        if (!img) continue;
        const bg = bgColors[i % bgColors.length] || bgColors[0];
        const grid = decodeRLE(img.data, palette);
        const cleanName =
          img.filename?.replace(/^(head|body|accessory|glasses)-/, '').replace(/-/g, ' ') ||
          `Lil ${label} ${i}`;
        out.push({
          id: `lil-trait-${key}-${i}`,
          title: cleanName,
          subtitle: `Lil Nouns Trait · ${label}`,
          image: pixelsToSvg(grid, bg),
          href: 'https://lilnouns.wtf',
          sourceUrl: 'https://lilnouns.wtf',
          sourceLabel: 'lilnouns.wtf',
          collection: 'lil-trait',
          media: 'pixel',
          isPixel: true,
          category: label,
          tags: ['lil-nouns', 'trait', label.toLowerCase(), 'cc0', 'pixel'],
          bgColor: `#${bg}`,
          meta: { filename: img.filename, index: i },
        });
      }
    }
    return out;
  }, [data]);

  return { items, isLoading };
}

// ─── Probe Dream pre-rendered art (public/probe-dreams/rendered) ────────────
// The renderer folder ships ~721 pre-built dream SVGs from probe.wtf.
// We sample a spread for variety.

const PROBE_DREAM_RENDERED_COUNT = 721;
const PROBE_DREAM_SAMPLE_SIZE = 80;

function buildProbeDreamAssets(): CatalogueAsset[] {
  const out: CatalogueAsset[] = [];
  const step = Math.max(
    1,
    Math.floor(PROBE_DREAM_RENDERED_COUNT / PROBE_DREAM_SAMPLE_SIZE),
  );
  for (let id = 1; id < PROBE_DREAM_RENDERED_COUNT; id += step) {
    out.push({
      id: `probe-dream-${id}`,
      title: `Probe Dream ${id}`,
      subtitle: 'Probe Dreams',
      image: `/probe-dreams/rendered/${id}.svg`,
      href: `https://probe.wtf/en-US/nouns/dreams/${id}`,
      sourceUrl: `https://probe.wtf/en-US/nouns/dreams/${id}`,
      sourceLabel: 'probe.wtf',
      collection: 'probe-dream',
      media: 'svg',
      isPixel: true,
      category: 'Probe Dream',
      tags: ['probe-dreams', 'dream', 'noun', 'pixel', `dream-${id}`],
      bgColor: '#d5d7e1',
      meta: { dreamId: id },
    });
  }
  return out;
}

// ─── Probe custom traits (public/probe-dreams/traits) ───────────────────────
// Manifest of filenames is shipped with the build (~338 PNGs of community-made
// custom dream traits). We embed the list at build time via Vite's eager glob
// so the catalogue can show them without an extra fetch.

const PROBE_TRAIT_FILES = (() => {
  // Vite-eager glob: returns a map of file paths in public/probe-dreams/traits.
  // We keep this as a static array of names so the bundle is small.
  // Format: "{id}_{name}.png"
  // NOTE: hard-coded list (sampled subset) is kept in sync via build script.
  // Falls back to a minimal stub list if globbing isn't available.
  return [
    '215_Symbit-head-v11.png', '217_white-glyph.png', '222_tumbleweed.png', '223_glogs.png',
    '224_skull-head-test.png', '225_raybans.png', '226_rainbow-road.png', '228_glitch.png',
    '229_turnip.png', '230_marmite.png', '231_thicc.png', '232_wiiiiidez.png',
    '234_noundry-studio-head_31.png', '235_thiccorange.png', '236_pipe.png', '242_gogs-white.png',
    '243_deepfried-punk.png', '244_orca-deepfried.png', '245_spidey-suit.png', '246_mog.png',
    '248_cool-car.png', '249_thiccored.png', '250_thiccoblack.png', '258_Hanounken.png',
    '267_chad.png', '268_nounsgame.png', '276_lil_oversized.png', '277_Symbit-head-v16.png',
    '281_lil_pipe_v289.png', '282_white_noogles-v2.png', '286_stretch-eye-strong.png',
    '287_retro.png', '288_choose_rich.png', '289_pipe_v_497.png', '290_gogs-black-v8.png',
    '291_spider.png', '292_L.png', '293_soyboy.png', '294_re-evaluating.png',
    '295_still_re-evaluating.png', '296_pipe_v78.png', '298_pipe_v79.png', '300_Truck.png',
    '309_pineal_moth.png', '310_lavender_moth.png', '311_white_noogles-v5.png',
    '312_white_noogles-v6.png', '314_dog-dalmation.png', '316_dehydrated-dalmation.png',
    '317_tetirs_vibe.png', '322_Hanounken-v6.png', '323_Coco.png', '325_Beans.png',
    '326_Banana_split.png', '329_WOLF.png', '335_wolf.png', '337_punk-deepfried-v12.png',
    '338_crystal_bowl.png', '341_sushi.png', '342_mayo.png', '343_Water.png',
    '344_reevaluate.png', '348_lintprobe.png', '349_durag-lint.png', '356_durag.png',
    '357_pipe_1446.png', '358_abacus.png', '362_noundry-studio-noun_-_2025-05-18T200453430.png',
    '366_golfhead.png', '367_e-pipe.png', '368_hugebeardpipe.png', '375_colorful-mamba.png',
    '376_benny-blanco.png', '377_fbh_ancient_cave_art.png', '378_mr_mole_black_and_white.png',
    '379_mr_mole.png', '381_Q-anon.png', '385_pizza_day.png', '394_FREE.png',
    '395_free-checker.png', '396_jumpsuit-p.png', '404_wolf2.png', '406_Hamster_v9.png',
    '407_tarantula.png', '414_Elephant_v10.png', '416_bag_of_karots.png', '419_moneybag.png',
    '420_bag_wif_pipe.png', '422_Turkey.png', '423_Hakuryu.png', '424_pigeon_wif_headfones.png',
    '425_sunrise.png', '427_juice_box.png', '429_chocolate-melting.png', '431_ant-eater.png',
    '432_dream_chocolate.png', '433_wolf3000.png', '435_windows.png', '436_doors-french.png',
    '439_Quokka_v2.png', '440_dots.png', '444_golfer.png', '446_spaceship.png',
    '447_founder_house.png', '448_Tube_paint_v6.png', '450_ladybug3.png', '451_splash.png',
    '453_pirateflag.png', '455_mole.png', '456_tablelamp.png', '458_rook.png',
    '459_blender.png', '460_dead_coral.png', '466_paper_cup.png', '467_door.png',
    '468_polar_bear.png', '481_throne.png', '484_bludisc.png', '489_slug.png',
    '490_Astronaut_helmet.png', '491_mantis.png', '492_doberman.png', '493_pinocho.png',
    '498_hyrax.png', '503_guillotine.png', '504_Projector-head_1.png', '505_Foot-head.png',
    '506_Giant-ape.png', '508_chicken_nuggets.png', '509_Abacus-head_1.png', '510_goostavo.png',
    '513_oil-pastel-set.png', '514_eeyore-cc0.png', '515_vimana.png', '521_mold.png',
    '525_bread.png', '530_bulbasaur.png', '546_rocktoshi.png', '548_canvas.png',
    '549_Pablos_Palette.png', '556_Rhino-head.png', '557_Comb-head.png',
    '562_ticket_for_the_train.png', '604_Doctor_Plague.png', '610_palette_head.png',
    '611_Clock-rabbit-head_1.png', '623_mammmy.png', '628_Park-Bench-head.png',
    '634_Fossil.png', '635_scarf.png', '638_chonky.png', '640_square_eyes.png',
    '645_swaggy_frames.png', '646_pipes_bench.png', '649_slot_machine.png', '652_Pirate-Hook-head_1.png',
    '653_Park_Bench.png', '656_golf_club.png', '657_wack.png', '658_noogles.png',
    '665_DIRE_WOLF.png', '667_RHINO.png', '674_TOxic_Waste.png', '697_smelly_cat.png',
    '698_yellow_cat.png', '699_collective_cat.png', '700_Emerald.png', '701_Banana_Split.png',
    '702_Plaster_Cast.png', '704_fried_hot_dog_with_pool_cue.png', '705_CAP.png',
    '707_1000023223.png', '708_Cap-head.png', '709_Matches-Box-head.png', '710_French-Fries-head.png',
    '711_Trophy-head.png', '713_Urine_Test.png', '714_Stethoscope-head.png', '715_Urine-Test-head.png',
    '717_mega-fried.png', '718_Humidifier-head.png', '719_Drums.png', '720_kewala_wip7.png',
    '721_ICE_CREAM_VAN_BY_SETH_6.png',
  ];
})();

const PROBE_TRAIT_BASE = 'https://probewtf.fra1.cdn.digitaloceanspaces.com/custom-traits';

function inferProbeLayer(filename: string): string {
  const lower = filename.toLowerCase();
  if (
    lower.includes('glass') ||
    lower.includes('noggles') ||
    lower.includes('noogles') ||
    lower.includes('gogs') ||
    lower.includes('frame')
  ) {
    return 'glasses';
  }
  if (lower.includes('body') || lower.includes('jumpsuit') || lower.includes('suit')) {
    return 'body';
  }
  if (lower.includes('accessory') || lower.includes('checker')) {
    return 'accessory';
  }
  return 'head';
}

function buildProbeTraitAssets(): CatalogueAsset[] {
  const out: CatalogueAsset[] = [];
  // Cap at 100 to keep variety
  const cap = 100;
  const step = Math.max(1, Math.floor(PROBE_TRAIT_FILES.length / cap));
  for (let i = 0; i < PROBE_TRAIT_FILES.length; i += step) {
    const file = PROBE_TRAIT_FILES[i];
    const m = file.match(/^(\d+)_(.+)\.png$/);
    const id = m ? m[1] : String(i);
    const rawName = m ? m[2] : file;
    const layer = inferProbeLayer(file);
    const name = rawName.replace(/_/g, ' ').replace(/-/g, ' ');
    out.push({
      id: `probe-trait-${id}`,
      title: name,
      subtitle: `Custom ${layer} · Dream #${id}`,
      // Use local public copy for snappy render — falls back to remote for any
      // missing files.
      image: `/probe-dreams/traits/${file}`,
      fileUrl: `${PROBE_TRAIT_BASE}/${layer}/${file.split('_').slice(1).join('_')}`,
      href: `https://probe.wtf/en-US/nouns/dreams`,
      sourceUrl: `https://probe.wtf/en-US/nouns/dreams`,
      sourceLabel: 'probe.wtf',
      collection: 'probe-trait',
      media: 'image',
      isPixel: true,
      category: layer.charAt(0).toUpperCase() + layer.slice(1),
      tags: ['probe', 'custom-trait', 'dream', layer, 'cc0', 'pixel'],
      meta: { dreamId: id, layer, filename: file },
    });
  }
  return out;
}

// ─── Past auction winners (sampled mainnet nouns via noun.pics) ─────────────
// noun.pics serves SVG art for any minted Noun id. We sample across the
// historical range to surface variety from years past.

function buildPastNounAssets(): CatalogueAsset[] {
  const out: CatalogueAsset[] = [];
  // Sample ~80 nouns spread between 1 and 1900.
  // Skip every 24th id (≈ 80 items), which gives roughly 1 per month of history.
  const max = 1900;
  const step = 24;
  for (let id = 1; id < max; id += step) {
    out.push({
      id: `past-noun-${id}`,
      title: `Noun ${id}`,
      subtitle: 'Auctioned Noun',
      image: `https://noun.pics/${id}`,
      href: `https://noun.wtf/noun/${id}`,
      sourceUrl: `https://noun.pics/${id}`,
      sourceLabel: 'noun.pics',
      collection: 'past-noun',
      media: 'svg',
      isPixel: true,
      category: 'Past Noun',
      tags: ['nouns', 'auction', 'past', `noun-${id}`, 'pixel'],
      meta: { nounId: id },
    });
  }
  return out;
}

// ─── Sketches (public/sketches/*.gif) ───────────────────────────────────────

const SKETCH_FILES = ['1822.gif', '1823.gif', '1824.gif'];

function buildSketchAssets(): CatalogueAsset[] {
  return SKETCH_FILES.map(file => {
    const id = file.replace(/\.gif$/, '');
    return {
      id: `sketch-${id}`,
      title: `Sketch ${id}`,
      subtitle: 'Noun Sketch',
      image: `/sketches/${file}`,
      href: `https://noun.wtf/noun/${id}`,
      sourceUrl: `https://noun.wtf/noun/${id}`,
      sourceLabel: 'noun.wtf',
      collection: 'sketch',
      media: 'image',
      isPixel: true,
      category: 'Sketch',
      tags: ['sketch', 'animation', 'gif', `noun-${id}`],
      meta: { sketchId: id },
    } satisfies CatalogueAsset;
  });
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
  const tagList = (it.Tags ?? []).map(t => t.toLowerCase());
  // cc0-lib is mixed media — default to non-pixel (photographic) and only opt
  // into pixelated rendering if the item explicitly self-tags as pixel-art.
  const isPixel =
    tagList.includes('pixel') ||
    tagList.includes('pixel-art') ||
    tagList.includes('pixelart') ||
    (it.Type ?? '').toLowerCase() === 'pixel';
  const src = it.Source || file || 'https://cc0-lib.wtf';
  return {
    id: `cc0-${it.ID ?? it.Title ?? Math.random().toString(36).slice(2)}`,
    title: it.Title || 'Untitled',
    subtitle: it.ENS ? `cc0-lib · ${it.ENS}` : 'cc0-lib',
    image: thumb,
    fileUrl: file,
    href: src,
    sourceUrl: src,
    sourceLabel: 'cc0-lib.wtf',
    collection: 'cc0-lib',
    media: inferMedia(ft),
    isPixel,
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
  const lilTraits = useLilTraitAssets();
  const traits = useMemo(buildTraitAssets, []);
  const probeDreams = useMemo(buildProbeDreamAssets, []);
  const probeTraits = useMemo(buildProbeTraitAssets, []);
  const pastNouns = useMemo(buildPastNounAssets, []);
  const sketches = useMemo(buildSketchAssets, []);
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
        sourceUrl: `https://noun.pics/${nid}`,
        sourceLabel: 'noun.pics',
        collection: 'auction',
        media: 'image',
        isPixel: true,
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
          sourceUrl: `${PROPDATES_BASE}${p.propId}`,
          sourceLabel: 'propdates.nouns.wtf',
          collection: 'propdate',
          media: 'image',
          // Propdate images are screenshots / photos — keep browser default
          // bilinear scaling so they don't get blocky.
          isPixel: false,
          category: 'Propdate',
          tags: ['propdate', 'governance', `prop-${p.propId}`],
          timestamp: Number(p.blockNumber) * 12_000, // rough block-number ordering
          meta: { propId: p.propId, blockNumber: p.blockNumber },
        });
      }
    }

    if (dreams.data) {
      for (const d of dreams.data) {
        // For dreams with a custom trait layer, the DreamsBanner renderer
        // returns a base SVG + (optional) custom overlay URL + (optional)
        // top-layers SVG. The grid view only shows a single image, so we
        // bake all three into one composite SVG with foreignObject so the
        // catalogue card shows the full noun, not just the base layers.
        let img: string | null = null;
        const baseSvgDataUrl = d.svgBase64
          ? `data:image/svg+xml;base64,${d.svgBase64}`
          : null;
        const topSvgDataUrl = d.glassesSvgBase64
          ? `data:image/svg+xml;base64,${d.glassesSvgBase64}`
          : null;

        if (baseSvgDataUrl && (d.customOverlayUrl || topSvgDataUrl)) {
          // Compose using nested SVG <image> tags. SVG can reference data URLs
          // and external https URLs alike.
          const layers: string[] = [
            `<image href="${baseSvgDataUrl}" x="0" y="0" width="320" height="320" />`,
          ];
          if (d.customOverlayUrl) {
            layers.push(
              `<image href="${d.customOverlayUrl}" x="0" y="0" width="320" height="320" preserveAspectRatio="xMidYMid meet" />`,
            );
          }
          if (topSvgDataUrl) {
            layers.push(
              `<image href="${topSvgDataUrl}" x="0" y="0" width="320" height="320" />`,
            );
          }
          const composite = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320" shape-rendering="crispEdges">${layers.join('')}</svg>`;
          img = `data:image/svg+xml;utf8,${encodeURIComponent(composite)}`;
        } else {
          img = baseSvgDataUrl ?? d.customOverlayUrl;
        }
        if (!img) continue;
        all.push({
          id: `dream-${d.id}`,
          title: `Dream #${d.id}`,
          subtitle: `Dreamed by ${d.dreamer.slice(0, 6)}…${d.dreamer.slice(-4)}`,
          image: img,
          href: PROBE_DREAMS,
          sourceUrl: `${PROBE_DREAMS}/${d.id}`,
          sourceLabel: 'probe.wtf',
          collection: 'dream',
          media: 'svg',
          isPixel: true,
          category: 'Dream',
          tags: ['dream', 'probe', `dream-${d.id}`],
          bgColor: `#${d.bgColor}`,
          meta: { dreamer: d.dreamer, customOverlayUrl: d.customOverlayUrl },
        });
      }
    }

    for (const t of traits) all.push(t);
    for (const t of lilTraits.items) all.push(t);
    for (const n of probeDreams) all.push(n);
    for (const t of probeTraits) all.push(t);
    for (const n of pastNouns) all.push(n);
    for (const s of sketches) all.push(s);

    for (let i = 0; i < stories.length; i++) {
      const s = stories[i];
      all.push({
        id: `story-${i}`,
        title: s.title,
        subtitle: 'Nouns World',
        image: s.image,
        href: s.url,
        sourceUrl: s.url,
        sourceLabel: 'nouns.world',
        collection: 'nouns-world',
        media: 'image',
        // NounsWorld stories are photographic — keep bilinear scaling.
        isPixel: false,
        category: 'Story',
        tags: ['nouns-world', 'story'],
      });
    }

    for (const a of cc0.items) all.push(a);

    return all;
  }, [
    propdates.data,
    dreams.data,
    traits,
    lilTraits.items,
    probeDreams,
    probeTraits,
    pastNouns,
    sketches,
    stories,
    activeAuction,
    cc0.items,
  ]);

  return {
    items,
    isLoading:
      propdates.isLoading ||
      dreams.isLoading ||
      cc0.isLoading ||
      lilTraits.isLoading,
  };
}
