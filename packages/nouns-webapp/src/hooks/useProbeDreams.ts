import type { CustomTraitLayer } from '@/lib/dreamStorage';

import { ImageData, getNounData } from '@noundry/nouns-assets';
import { buildSVG } from '@nouns/sdk';
import { useQuery } from '@tanstack/react-query';

import { queryClient } from '@/lib/queryClient';

export interface ProbeDream {
  id: number;
  dreamer: string;
  seeds: {
    // Any layer can be null when the dream's custom trait replaces it on
    // probe.wtf — not just head/accessory. Consumers must coalesce to 0
    // before passing into nouns-assets image lookups.
    accessory: number | null;
    background: number;
    body: number | null;
    glasses: number | null;
    head: number | null;
  };
  createdAt: string;
  customLayer?: CustomTraitLayer;
  customImage?: string;
}

export interface ProbeDreamWithPreview extends ProbeDream {
  /** Base SVG (data URL). For custom-trait dreams built client-side, this is
   *  only the layers BELOW the custom slot — the custom PNG overlays into the
   *  gap and `overlayTopSvgUrl` (if set) sits on top. For bundled dreams ≤721
   *  with a custom trait, the custom art is already baked in. For no-custom
   *  dreams, this is the full noun. */
  nounSvgUrl: string;
  /** Custom trait PNG URL, or null. Overlay on top of `nounSvgUrl` unless
   *  `customTraitIsBaked` is true. */
  customTraitUrl: string | null;
  /** True when the custom trait is already composited into `nounSvgUrl` — don't overlay. */
  customTraitIsBaked: boolean;
  /** Standard layers that sit ABOVE the custom trait (e.g. glasses above a custom
   *  head). Transparent-bg SVG to overlay after the custom PNG. Null when nothing
   *  sits above the custom layer, or for no-custom / baked dreams. */
  overlayTopSvgUrl: string | null;
}

// Live source: dream-nouns API on Railway (nouns-api) — migrated off the
// probe.wtf DigitalOcean droplet 2026-07-19. Same Laravel paginator shape.
const PROBE_API = 'https://spirited-flexibility-production-3c30.up.railway.app/api/dream-nouns';

// Fallback: static JSON bundled with the webapp (frozen snapshot).
const STATIC_URL = '/probe-dreams/dreams.json';
const STATIC_RENDERED_BASE = '/probe-dreams/rendered';
const STATIC_TRAITS_BASE = '/probe-dreams/traits';

// Highest dream id with a bundled pre-rendered SVG in public/probe-dreams/rendered/.
// Dreams at or below this id with a custom trait use the baked-in bundled render
// (avoids cross-origin <image> issues loading from the DO CDN inside inline SVG).
const MAX_BUNDLED_RENDERED_ID = 721;

interface LaravelDream {
  id: number;
  dreamer: string;
  accessory_seed_id: number | null;
  background_seed_id: number;
  body_seed_id: number;
  glasses_seed_id: number;
  head_seed_id: number | null;
  custom_trait_image: string | null;
  custom_trait_layer: CustomTraitLayer | null;
  custom_trait_image_url: string | null;
  created_at: string;
}

interface LaravelPage {
  data: LaravelDream[];
  meta: {
    total: number;
    per_page: number;
    last_page: number;
    current_page: number;
  };
}

// getNounData `parts` order: 0=body, 1=accessory, 2=head, 3=glasses.
const LAYER_INDEX: Record<CustomTraitLayer, number> = {
  body: 0,
  accessory: 1,
  head: 2,
  glasses: 3,
};

function svgToDataUrl(svg: string): string {
  return `data:image/svg+xml;base64,${btoa(svg)}`;
}

/**
 * Compose the render layers for a dream client-side.
 *
 * When `customLayer` is set, the base SVG excludes that slot (instead of
 * falling back to index 0 = aardvark head) so the custom PNG overlays into
 * a transparent gap. Anything in the standard layer order above the custom
 * slot comes back as `overlayTopSvgUrl` so consumers can render it on top
 * of the custom PNG (e.g. glasses above a custom head).
 *
 * Inline SVG `<image href>` can't cross-origin fetch from the probe CDN,
 * which is why we split into separate <img>s instead of embedding.
 */
function buildDreamLayers(
  background: number,
  body: number | null,
  accessory: number | null,
  head: number | null,
  glasses: number | null,
  customLayer: CustomTraitLayer | null,
): { baseSvgUrl: string; overlayTopSvgUrl: string | null } {
  try {
    const seed = {
      background,
      body: body ?? 0,
      accessory: accessory ?? 0,
      head: head ?? 0,
      glasses: glasses ?? 0,
    };
    const { parts, background: bg } = getNounData(seed);

    if (!customLayer) {
      return {
        baseSvgUrl: svgToDataUrl(buildSVG(parts, ImageData.palette, bg)),
        overlayTopSvgUrl: null,
      };
    }

    const idx = LAYER_INDEX[customLayer];
    const below = parts.slice(0, idx);
    const above = parts.slice(idx + 1);

    const baseSvgUrl = svgToDataUrl(buildSVG(below, ImageData.palette, bg));
    const overlayTopSvgUrl =
      above.length > 0 ? svgToDataUrl(buildSVG(above, ImageData.palette)) : null;
    return { baseSvgUrl, overlayTopSvgUrl };
  } catch {
    return { baseSvgUrl: '', overlayTopSvgUrl: null };
  }
}

function laravelToPreview(d: LaravelDream): ProbeDreamWithPreview {
  const hasCustomTrait = d.custom_trait_image_url !== null && d.custom_trait_image_url.length > 0;
  // Three rendering paths:
  //   1. Dream ≤721 with custom trait → use the bundled pre-rendered SVG with
  //      the custom art already baked in (set `customTraitIsBaked` so consumers
  //      don't double-render the PNG on top).
  //   2. Dream >721 with custom trait → split into base (layers below custom),
  //      the custom PNG (rendered by consumer), and an optional overlay SVG for
  //      standard layers above the custom slot (e.g. glasses above custom head).
  //   3. No custom trait → full composed noun SVG in nounSvgUrl.
  const isBundled = hasCustomTrait && d.id <= MAX_BUNDLED_RENDERED_ID;
  const { baseSvgUrl, overlayTopSvgUrl } = isBundled
    ? { baseSvgUrl: `${STATIC_RENDERED_BASE}/${d.id}.svg`, overlayTopSvgUrl: null }
    : buildDreamLayers(
        d.background_seed_id,
        d.body_seed_id,
        d.accessory_seed_id,
        d.head_seed_id,
        d.glasses_seed_id,
        d.custom_trait_layer,
      );
  return {
    id: d.id,
    dreamer: d.dreamer,
    seeds: {
      accessory: d.accessory_seed_id,
      background: d.background_seed_id,
      body: d.body_seed_id,
      glasses: d.glasses_seed_id,
      head: d.head_seed_id,
    },
    createdAt: d.created_at,
    customLayer: d.custom_trait_layer ?? undefined,
    customImage: d.custom_trait_image ?? undefined,
    nounSvgUrl: baseSvgUrl,
    customTraitUrl: d.custom_trait_image_url,
    customTraitIsBaked: isBundled,
    overlayTopSvgUrl,
  };
}

function staticToPreview(d: ProbeDream): ProbeDreamWithPreview {
  const hasCustom = d.customImage != null;
  return {
    ...d,
    // Use the bundled pre-rendered SVG for snapshot dreams (baked custom trait)
    nounSvgUrl: `${STATIC_RENDERED_BASE}/${d.id}.svg`,
    customTraitUrl: hasCustom ? `${STATIC_TRAITS_BASE}/${d.id}_${d.customImage}` : null,
    customTraitIsBaked: hasCustom,
    overlayTopSvgUrl: null,
  };
}

async function fetchAllLiveDreams(): Promise<LaravelDream[]> {
  const first = await fetch(`${PROBE_API}?per_page=100&page=1`);
  if (!first.ok) throw new Error(`probe API ${first.status}`);
  const firstPage = (await first.json()) as LaravelPage;
  const { last_page } = firstPage.meta;
  const all: LaravelDream[] = [...firstPage.data];

  if (last_page > 1) {
    const rest = await Promise.all(
      Array.from({ length: last_page - 1 }, (_, i) =>
        fetch(`${PROBE_API}?per_page=100&page=${i + 2}`).then(r => {
          if (!r.ok) throw new Error(`probe API page ${i + 2} ${r.status}`);
          return r.json() as Promise<LaravelPage>;
        }),
      ),
    );
    for (const page of rest) all.push(...page.data);
  }
  return all;
}

export const PROBE_DREAMS_QUERY_KEY = ['probe-dreams'] as const;

// Try the live dream-nouns API first. Fall back to the bundled static snapshot
// on error so noun.wtf keeps rendering something if the API is down.
async function fetchDreams(): Promise<ProbeDreamWithPreview[]> {
  try {
    const live = await fetchAllLiveDreams();
    return live.map(laravelToPreview).sort((a, b) => b.id - a.id);
  } catch (err) {
    console.warn('[useProbeDreams] Live fetch failed, using static snapshot:', err);
    const r = await fetch(STATIC_URL);
    if (!r.ok) throw new Error(`static ${r.status}`);
    const data = (await r.json()) as ProbeDream[];
    return data.map(staticToPreview);
  }
}

export function useProbeDreams() {
  // staleTime/gcTime Infinity matches the old module-level session cache:
  // fetch once, then only refetch when invalidateProbeDreamsCache() runs
  // (the full fetch pulls every page, so background refetches aren't free).
  const { data, isLoading } = useQuery({
    queryKey: PROBE_DREAMS_QUERY_KEY,
    queryFn: fetchDreams,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  return { dreams: data ?? EMPTY_DREAMS, loading: isLoading };
}

const EMPTY_DREAMS: ProbeDreamWithPreview[] = [];

/**
 * Refetch the dreams list (e.g. after a successful publish). Unlike the old
 * module-cache version, this also refreshes galleries that are currently
 * mounted — invalidateQueries refetches active observers immediately, so a
 * freshly dreamed noun shows up without a hard refresh.
 */
export function invalidateProbeDreamsCache() {
  void queryClient.invalidateQueries({ queryKey: PROBE_DREAMS_QUERY_KEY });
}
