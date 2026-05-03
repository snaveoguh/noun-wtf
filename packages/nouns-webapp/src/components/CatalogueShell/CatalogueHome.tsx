/**
 * CatalogueHome — multi-mode CC0 asset browser.
 *
 * Modes: cover (the original Cover Flow), grid, list, masonry.
 * Filters: collection, media type, free-text search.
 * Sort: alphabetical, by collection, newest-first (when timestamp exists), random.
 *
 * Per the shell lockdown, internal noun.wtf links are inert; external links open
 * in a new tab.
 */
import { useEffect, useMemo, useState } from 'react';

import CoverFlowView from './CoverFlowView';
import GridView from './GridView';
import ListView from './ListView';
import MasonryView from './MasonryView';
import CatalogueShell from './index';
import { useCatalogueAssets, type CatalogueAsset } from './useCatalogueAssets';

import classes from './Catalogue.module.css';

type ViewMode = 'cover' | 'grid' | 'list' | 'masonry';
type SortMode = 'random' | 'alpha' | 'collection' | 'newest';

const VIEW_LABELS: Record<ViewMode, string> = {
  cover: 'Cover',
  grid: 'Grid',
  list: 'List',
  masonry: 'Masonry',
};

const COLLECTION_OPTIONS = [
  { value: 'all', label: 'All collections' },
  { value: 'nouns-trait', label: 'Nouns Traits' },
  { value: 'cc0-lib', label: 'cc0-lib.wtf' },
  { value: 'auction', label: 'Auction' },
  { value: 'propdate', label: 'Propdates' },
  { value: 'dream', label: 'Dreams' },
  { value: 'nouns-world', label: 'Nouns World' },
];

const MEDIA_OPTIONS = [
  { value: 'all', label: 'Any media' },
  { value: 'image', label: 'Image' },
  { value: 'pixel', label: 'Pixel' },
  { value: 'svg', label: 'SVG' },
  { value: 'video', label: 'Video' },
  { value: 'audio', label: 'Audio' },
  { value: '3d', label: '3D' },
];

function shuffle<T>(arr: T[], seed: number): T[] {
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

export default function CatalogueHome() {
  const { items, isLoading } = useCatalogueAssets();
  const [view, setView] = useState<ViewMode>('cover');
  const [query, setQuery] = useState('');
  const [collection, setCollection] = useState<string>('all');
  const [media, setMedia] = useState<string>('all');
  const [sort, setSort] = useState<SortMode>('random');
  const [shuffleSeed, setShuffleSeed] = useState(() => Math.floor(Math.random() * 1e6));

  // Re-roll the shuffle seed any time we re-enter random mode
  useEffect(() => {
    if (sort === 'random') setShuffleSeed(Math.floor(Math.random() * 1e6));
  }, [sort]);

  const filtered = useMemo(() => {
    let out = items;
    if (collection !== 'all') out = out.filter(a => a.collection === collection);
    if (media !== 'all') out = out.filter(a => a.media === media);
    const q = query.trim().toLowerCase();
    if (q) {
      out = out.filter(a => {
        if (a.title.toLowerCase().includes(q)) return true;
        if (a.subtitle.toLowerCase().includes(q)) return true;
        if (a.category.toLowerCase().includes(q)) return true;
        return a.tags.some(t => t.toLowerCase().includes(q));
      });
    }
    if (sort === 'alpha') {
      out = [...out].sort((a, b) => a.title.localeCompare(b.title));
    } else if (sort === 'collection') {
      out = [...out].sort(
        (a, b) => a.collection.localeCompare(b.collection) || a.title.localeCompare(b.title),
      );
    } else if (sort === 'newest') {
      out = [...out].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
    } else {
      out = shuffle(out, shuffleSeed);
    }
    return out;
  }, [items, collection, media, query, sort, shuffleSeed]);

  const handleActivate = (a: CatalogueAsset) => {
    // Shell lockdown: only http(s) URLs open externally, never internal navigation.
    if (a.href && /^https?:/i.test(a.href)) {
      window.open(a.href, '_blank', 'noopener,noreferrer');
    }
  };

  return (
    <CatalogueShell>
      <div className={classes.root}>
        <div className={classes.toolbar}>
          <input
            className={classes.search}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search title, tag, collection…"
            spellCheck={false}
            autoComplete="off"
          />

          <div className={classes.viewSwitch} role="tablist" aria-label="View mode">
            {(Object.keys(VIEW_LABELS) as ViewMode[]).map(v => (
              <button
                key={v}
                type="button"
                role="tab"
                aria-selected={view === v}
                className={`${classes.viewBtn} ${view === v ? classes.viewBtnActive : ''}`}
                onClick={() => setView(v)}
              >
                {VIEW_LABELS[v]}
              </button>
            ))}
          </div>

          <select
            className={classes.select}
            value={collection}
            onChange={e => setCollection(e.target.value)}
            aria-label="Filter by collection"
          >
            {COLLECTION_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          <select
            className={classes.select}
            value={media}
            onChange={e => setMedia(e.target.value)}
            aria-label="Filter by media"
          >
            {MEDIA_OPTIONS.map(o => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          <select
            className={classes.select}
            value={sort}
            onChange={e => setSort(e.target.value as SortMode)}
            aria-label="Sort by"
          >
            <option value="random">Random</option>
            <option value="alpha">A → Z</option>
            <option value="collection">Collection</option>
            <option value="newest">Newest</option>
          </select>

          <span className={classes.count}>
            {filtered.length} / {items.length}
          </span>
        </div>

        <div className={classes.viewport}>
          {isLoading && filtered.length === 0 ? (
            <div className={classes.loading}>Loading catalogue…</div>
          ) : filtered.length === 0 ? (
            <div className={classes.empty}>No matches</div>
          ) : view === 'cover' ? (
            <div className={classes.coverWrap}>
              <CoverFlowView items={filtered} onActivate={handleActivate} />
            </div>
          ) : view === 'grid' ? (
            <GridView items={filtered} onActivate={handleActivate} />
          ) : view === 'list' ? (
            <ListView items={filtered} onActivate={handleActivate} />
          ) : (
            <MasonryView items={filtered} onActivate={handleActivate} />
          )}
        </div>
      </div>
    </CatalogueShell>
  );
}
