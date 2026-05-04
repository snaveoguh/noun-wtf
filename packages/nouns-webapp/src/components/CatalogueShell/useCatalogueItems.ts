import { useMemo } from 'react';

import { useDreams, type DreamCard } from '@/components/DreamsBanner';
import { getTraitCards, type TraitCard } from '@/components/NoundryBanner';
import { NOUNS_WORLD_STORIES, type NounsWorldStory } from '@/components/NounsWorldBanner';
import { useAppSelector } from '@/hooks';
import { usePropdates } from '@/hooks/usePropdates';
import type { PropdateEntry } from '@/hooks/usePropdates';
import type { Auction as IAuction } from '@/wrappers/nounsAuction';

export type CatalogueItem =
  | { type: 'auction'; id: string; image: string; title: string; subtitle: string; href: string; raw: IAuction }
  | { type: 'propdate'; id: string; image: string; title: string; subtitle: string; href: string; raw: PropdateEntry }
  | { type: 'dream'; id: string; image: string; title: string; subtitle: string; href: string; raw: DreamCard }
  | { type: 'trait'; id: string; image: string; title: string; subtitle: string; href: string; raw: TraitCard }
  | { type: 'story'; id: string; image: string; title: string; subtitle: string; href: string; raw: NounsWorldStory };

const PROPDATES_BASE = 'https://propdates.nouns.wtf/prop/';
const NOUNDRY_GALLERY = 'https://gallery.noundry.wtf/';
const PROBE_DREAMS = 'https://probe.wtf/en-US/nouns/dreams';

function shuffle<T>(arr: T[], seed = 1): T[] {
  const out = [...arr];
  let s = seed;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function useCatalogueItems(): { items: CatalogueItem[]; isLoading: boolean } {
  const propdates = usePropdates();
  const dreams = useDreams();
  const traits = useMemo(() => getTraitCards(), []);
  const stories = NOUNS_WORLD_STORIES;
  const activeAuction = useAppSelector(s => s.auction.activeAuction);
  const currentSeed = useAppSelector(s => s.application.currentNounSeed);

  const items = useMemo<CatalogueItem[]>(() => {
    const all: CatalogueItem[] = [];

    if (activeAuction && currentSeed) {
      const nid = String(activeAuction.nounId);
      all.push({
        type: 'auction',
        id: `auction-${nid}`,
        image: `https://noun.pics/${nid}`,
        title: `Noun ${nid}`,
        subtitle: 'Live auction',
        href: `/noun/${nid}`,
        raw: {
          nounId: BigInt(activeAuction.nounId),
          startTime: BigInt(activeAuction.startTime),
          endTime: BigInt(activeAuction.endTime),
          amount: activeAuction.amount ? BigInt(activeAuction.amount) : 0n,
          bidder: activeAuction.bidder,
          settled: activeAuction.settled,
          clientId: activeAuction.clientId ?? null,
          burned: activeAuction.burned ?? false,
        },
      });
    }

    if (propdates.data) {
      for (const p of propdates.data) {
        if (!p.imageUrl) continue;
        all.push({
          type: 'propdate',
          id: `propdate-${p.propId}-${p.blockNumber}`,
          image: p.imageUrl,
          title: p.title || `Prop ${p.propId}`,
          subtitle: `Propdate · Prop ${p.propId}`,
          href: `${PROPDATES_BASE}${p.propId}`,
          raw: p,
        });
      }
    }

    if (dreams.data) {
      for (const d of dreams.data) {
        // svgBase64 is RAW base64, must be wrapped in a data URL for <img src>.
        const img = d.svgBase64
          ? `data:image/svg+xml;base64,${d.svgBase64}`
          : d.customOverlayUrl;
        if (!img) continue;
        all.push({
          type: 'dream',
          id: `dream-${d.id}`,
          image: img,
          title: `Dream #${d.id}`,
          subtitle: `Dreamed by ${d.dreamer.slice(0, 6)}…${d.dreamer.slice(-4)}`,
          href: PROBE_DREAMS,
          raw: d,
        });
      }
    }

    for (const t of traits) {
      all.push({
        type: 'trait',
        id: t.id,
        image: t.svgDataUrl,
        title: t.name,
        subtitle: `Trait · ${t.category}`,
        href: NOUNDRY_GALLERY,
        raw: t,
      });
    }

    for (let i = 0; i < stories.length; i++) {
      const s = stories[i];
      all.push({
        type: 'story',
        id: `story-${i}`,
        image: s.image,
        title: s.title,
        subtitle: 'Nouns World',
        href: s.url,
        raw: s,
      });
    }

    return shuffle(all);
  }, [propdates.data, dreams.data, traits, stories]);

  return {
    items,
    isLoading: propdates.isLoading || dreams.isLoading,
  };
}
