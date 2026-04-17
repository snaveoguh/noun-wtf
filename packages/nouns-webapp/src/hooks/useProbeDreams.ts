import type { CustomTraitLayer } from '@/lib/dreamStorage';

import { useEffect, useState } from 'react';

import { ImageData, getNounData } from '@noundry/nouns-assets';
import { buildSVG } from '@nouns/sdk';

export interface ProbeDream {
  id: number;
  dreamer: string;
  seeds: {
    accessory: number | null;
    background: number;
    body: number;
    glasses: number;
    head: number | null;
  };
  createdAt: string;
  customLayer?: CustomTraitLayer;
  customImage?: string;
}

export interface ProbeDreamWithPreview extends ProbeDream {
  /** Full composed noun SVG (data URL, rendered client-side from seeds) */
  nounSvgUrl: string;
  /** Just the custom trait image (for hover), null if standard dream */
  customTraitUrl: string | null;
}

// Live source: probe.wtf Laravel API
const PROBE_API = 'https://api.probe.wtf/api/dream-nouns';

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

/**
 * Compose a noun SVG data URL client-side from seeds.
 * If a custom trait image URL is provided, overlays it via <image> tag.
 * Null seeds (head/accessory can be null when replaced by custom trait) fall back to 0.
 */
function buildDreamSvgDataUri(
  background: number,
  body: number,
  accessory: number | null,
  head: number | null,
  glasses: number,
  customImageUrl: string | null,
): string {
  try {
    const seed = {
      background,
      body,
      accessory: accessory ?? 0,
      head: head ?? 0,
      glasses,
    };
    const { parts, background: bg } = getNounData(seed);
    let svg = buildSVG(parts, ImageData.palette, bg);
    if (customImageUrl !== null && customImageUrl.length > 0) {
      // Overlay the custom trait at full canvas. Sits on top of all standard layers,
      // which is correct for head/glasses; slightly imperfect for body/accessory but
      // acceptable during the migration window.
      svg = svg.replace(
        '</svg>',
        `<image href="${customImageUrl}" x="0" y="0" width="320" height="320" style="image-rendering:pixelated" /></svg>`,
      );
    }
    return `data:image/svg+xml;base64,${btoa(svg)}`;
  } catch {
    return '';
  }
}

function laravelToPreview(d: LaravelDream): ProbeDreamWithPreview {
  const hasCustomTrait = d.custom_trait_image_url !== null && d.custom_trait_image_url.length > 0;
  // For custom-trait dreams at or below the bundled id, use the pre-rendered SVG
  // that has the custom trait baked in. Inline <image href="https://cdn..."> fails
  // to load due to cross-origin restrictions on the DO CDN when embedded in an SVG
  // data URL, which produces the "all look identical" broken-placeholder artifact.
  const nounSvgUrl =
    hasCustomTrait && d.id <= MAX_BUNDLED_RENDERED_ID
      ? `${STATIC_RENDERED_BASE}/${d.id}.svg`
      : buildDreamSvgDataUri(
          d.background_seed_id,
          d.body_seed_id,
          d.accessory_seed_id,
          d.head_seed_id,
          d.glasses_seed_id,
          d.custom_trait_image_url,
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
    nounSvgUrl,
    customTraitUrl: d.custom_trait_image_url,
  };
}

function staticToPreview(d: ProbeDream): ProbeDreamWithPreview {
  return {
    ...d,
    // Use the bundled pre-rendered SVG for snapshot dreams (baked custom trait)
    nounSvgUrl: `${STATIC_RENDERED_BASE}/${d.id}.svg`,
    customTraitUrl: d.customImage != null ? `${STATIC_TRAITS_BASE}/${d.id}_${d.customImage}` : null,
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

let cachedDreams: ProbeDreamWithPreview[] | null = null;

export function useProbeDreams() {
  const [dreams, setDreams] = useState<ProbeDreamWithPreview[]>(cachedDreams ?? []);
  const [loading, setLoading] = useState(cachedDreams === null);

  useEffect(() => {
    if (cachedDreams !== null) return;

    let cancelled = false;
    (async () => {
      // Try live probe.wtf first. Fall back to the bundled static snapshot on error
      // so noun.wtf keeps rendering something if probe.wtf is down.
      try {
        const live = await fetchAllLiveDreams();
        if (cancelled) return;
        const mapped = live.map(laravelToPreview).sort((a, b) => b.id - a.id);
        cachedDreams = mapped;
        setDreams(mapped);
      } catch (err) {
        console.warn('[useProbeDreams] Live fetch failed, using static snapshot:', err);
        try {
          const r = await fetch(STATIC_URL);
          if (!r.ok) throw new Error(`static ${r.status}`);
          const data = (await r.json()) as ProbeDream[];
          if (cancelled) return;
          const mapped = data.map(staticToPreview);
          cachedDreams = mapped;
          setDreams(mapped);
        } catch (fallbackErr) {
          console.error('[useProbeDreams] Static fallback also failed:', fallbackErr);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { dreams, loading };
}

/** Invalidate the module cache so the next render refetches (e.g. after a successful publish). */
export function invalidateProbeDreamsCache() {
  cachedDreams = null;
}
