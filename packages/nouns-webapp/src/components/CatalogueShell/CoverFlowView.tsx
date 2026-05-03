/**
 * CoverFlowView — adapter that maps CatalogueAsset → the existing CoverFlow component's
 * CatalogueItem shape. Lets us preserve all the rotation/drag/wheel/keyboard logic
 * without forking the underlying renderer.
 */
import { useMemo } from 'react';

import CoverFlow from './CoverFlow';
import type { CatalogueItem } from './useCatalogueItems';
import type { CatalogueAsset } from './useCatalogueAssets';

interface Props {
  items: CatalogueAsset[];
  onActivate: (a: CatalogueAsset) => void;
}

export default function CoverFlowView({ items, onActivate }: Props) {
  const mapped = useMemo<CatalogueItem[]>(() => {
    return items.map(a => ({
      // Drive CoverFlow's pixel-art treatment when the source is a Nouns trait.
      type: a.media === 'pixel' ? 'trait' : 'story',
      id: a.id,
      image: a.image,
      title: a.title,
      subtitle: a.subtitle,
      href: a.href,
      // CoverFlow reads .raw.bgColor only for type=trait; safe to forward
      raw: { bgColor: a.bgColor ?? '#1a1a1a' },
    })) as unknown as CatalogueItem[];
  }, [items]);

  // Look-up by id so onActivate gets the original asset
  const byId = useMemo(() => new Map(items.map(a => [a.id, a])), [items]);

  return (
    <CoverFlow
      items={mapped}
      cardSize={380}
      onActivate={item => {
        const a = byId.get(item.id);
        if (a) onActivate(a);
      }}
    />
  );
}
