import type { CatalogueAsset } from './useCatalogueAssets';

import classes from './Catalogue.module.css';

interface Props {
  items: CatalogueAsset[];
  onActivate: (a: CatalogueAsset) => void;
}

export default function ListView({ items, onActivate }: Props) {
  return (
    <div className={classes.listScroll}>
      <div className={classes.listHeader}>
        <span />
        <span>Title</span>
        <span>Collection</span>
        <span>Category</span>
        <span>Type</span>
      </div>
      {items.map(a => (
        <div key={a.id} className={classes.listRow} onClick={() => onActivate(a)}>
          <div className={classes.listThumb}>
            <img
              src={a.image}
              alt=""
              loading="lazy"
              className={a.media === 'pixel' ? 'pixel' : ''}
              onError={e => {
                (e.currentTarget as HTMLImageElement).style.opacity = '0.2';
              }}
            />
          </div>
          <div className={classes.listTitle}>{a.title}</div>
          <div className={classes.listMeta}>{a.collection}</div>
          <div className={classes.listMeta}>{a.category}</div>
          <div>
            <span className={classes.listChip}>{a.media}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
