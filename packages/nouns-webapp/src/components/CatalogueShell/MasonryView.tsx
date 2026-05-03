import type { CSSProperties } from 'react';

import type { CatalogueAsset } from './useCatalogueAssets';

import classes from './Catalogue.module.css';

interface Props {
  items: CatalogueAsset[];
  onActivate: (a: CatalogueAsset) => void;
}

/**
 * CSS-columns based masonry — no JS layout. Items vary in height naturally
 * because images keep their aspect ratio.
 */
export default function MasonryView({ items, onActivate }: Props) {
  return (
    <div className={classes.masonryScroll}>
      <div className={classes.masonry}>
        {items.map(a => (
          <div
            key={a.id}
            className={classes.masonryCell}
            style={{ '--cell-bg': a.bgColor ?? '#27272a' } as CSSProperties}
            onClick={() => onActivate(a)}
          >
            <img
              src={a.image}
              alt={a.title}
              loading="lazy"
              className={`${classes.masonryImg} ${a.isPixel ? classes.masonryImgPixel : ''}`}
              onError={e => {
                (e.currentTarget as HTMLImageElement).style.opacity = '0.2';
              }}
            />
            <div className={classes.masonryCaption}>
              <span className={classes.masonryCaptionTitle}>{a.title}</span>
              <span className={classes.masonryCaptionTag}>{a.collection}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
