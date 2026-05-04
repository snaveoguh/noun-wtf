import type { CSSProperties } from 'react';

import type { CatalogueAsset } from './useCatalogueAssets';

import classes from './Catalogue.module.css';

interface Props {
  items: CatalogueAsset[];
  onActivate: (a: CatalogueAsset) => void;
}

export default function GridView({ items, onActivate }: Props) {
  return (
    <div className={classes.gridScroll}>
      <div className={classes.grid}>
        {items.map(a => (
          <div
            key={a.id}
            className={classes.gridCell}
            style={{ '--cell-bg': a.bgColor ?? '#27272a' } as CSSProperties}
            onClick={() => onActivate(a)}
          >
            <img
              src={a.image}
              alt={a.title}
              loading="lazy"
              className={`${classes.gridImg} ${a.isPixel ? classes.gridImgPixel : ''}`}
              onError={e => {
                (e.currentTarget as HTMLImageElement).style.opacity = '0.2';
              }}
            />
            <div className={classes.gridCellOverlay}>
              <p className={classes.gridCellTitle}>{a.title}</p>
              <p className={classes.gridCellSubtitle}>{a.collection}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
