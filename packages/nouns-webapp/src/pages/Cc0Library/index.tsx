// /cc0 — the CC0 LIBRARY. Public-domain Nouns art in one place: the curated
// cc0-archive creators, cc0-lib.wtf (best-effort) and approved community
// uploads. Filterable masonry / grid, a detail panel, and an upload form.

import type { AssetSource, AssetType, Cc0Asset, Filters } from './assets';

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';

import {
  LayoutGridIcon as LayoutGrid,
  PlusIcon as Plus,
  Rows3Icon as Rows3,
  SearchIcon as Search,
} from 'lucide-react';

import { AssetCard } from './AssetCard';
import { AssetDetail } from './AssetDetail';
import { creatorFacets, filterAssets, NO_FILTERS, SOURCE_LABEL, typeFacets } from './assets';
import { CC0_CSS } from './styles';
import { SubmitDialog } from './SubmitDialog';
import { useCc0Assets, type SourceState } from './useCc0Assets';

const PAGE = 60;
const VIEW_KEY = 'cc0-library-view';

function Chip({
  on,
  children,
  onClick,
}: {
  on: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`cc0-mono shrink-0 rounded-full border-0 px-3 py-1.5 text-[11px] font-bold transition [@media(pointer:coarse)]:min-h-10 ${on ? 'bg-[#d4ff3a] text-[#0b0b0f]' : 'bg-white/[.07] text-[#f4f2ea] hover:bg-white/15'}`}
    >
      {children}
    </button>
  );
}

function SourceDot({ name, s, count }: { name: string; s: SourceState; count: number }) {
  const color =
    s === 'ok' ? 'bg-[#3dff8a]' : s === 'loading' ? 'bg-[#ffd400] animate-pulse' : 'bg-[#ff3b3b]';
  return (
    <span className="cc0-mono inline-flex items-center gap-1.5 text-[10.5px] text-[#9b998f]">
      <i className={`inline-block h-2 w-2 rounded-full ${color}`} aria-hidden />
      {name}
      {s === 'ok' ? ` ${count.toLocaleString()}` : s === 'loading' ? ' …' : ' offline'}
    </span>
  );
}

export default function Cc0LibraryPage() {
  const { assets, sources, loading } = useCc0Assets();
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const q = useDeferredValue(filters.q);
  const [view, setView] = useState<'masonry' | 'grid'>(() => {
    try {
      return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'masonry';
    } catch {
      return 'masonry';
    }
  });
  // How many cards are rendered; back to one page whenever the filters change
  const sig = `${filters.type}|${filters.source}|${filters.creator}|${q}`;
  const [page, setPage] = useState({ sig, n: PAGE });
  const shown = page.sig === sig ? page.n : PAGE;
  const setShown = useCallback(
    (f: (n: number) => number) => setPage(p => ({ sig, n: f(p.sig === sig ? p.n : PAGE) })),
    [sig],
  );
  const [openId, setOpenId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const more = useRef<HTMLDivElement>(null);

  const results = useMemo(() => filterAssets(assets, { ...filters, q }), [assets, filters, q]);
  const types = useMemo(() => typeFacets(assets), [assets]);
  const creators = useMemo(() => creatorFacets(assets), [assets]);
  const count = (s: AssetSource) => assets.filter(a => a.source === s).length;

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
    } catch {
      // storage blocked: the view just won't stick
    }
  }, [view]);

  // Load the next page as the end of the list scrolls into view (re-armed
  // after each page, so a tall screen keeps filling)
  const hasMore = results.length > shown;
  useEffect(() => {
    const el = more.current;
    if (el === null || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(
      es => {
        if (es.some(e => e.isIntersecting)) setShown(n => n + PAGE);
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, shown, setShown]);

  const open = openId !== null ? results.find(a => a.id === openId) : undefined;
  const step = useCallback(
    (d: -1 | 1) => {
      const i = results.findIndex(a => a.id === openId);
      if (i < 0 || results.length === 0) return;
      const next = results[(i + d + results.length) % results.length]!;
      setOpenId(next.id);
      setShown(n => Math.max(n, ((i + d + results.length) % results.length) + 1));
    },
    [results, openId, setShown],
  );
  const close = useCallback(() => setOpenId(null), []);
  const onOpen = useCallback((a: Cc0Asset) => setOpenId(a.id), []);

  const set = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters(f => ({ ...f, [k]: v }));
  const filtered =
    filters.q !== '' ||
    filters.type !== 'all' ||
    filters.source !== 'all' ||
    filters.creator !== 'all';

  return (
    <div
      className="cc0-root min-h-full w-full max-w-full bg-[#07070a] text-[#f4f2ea]"
      data-cc0-library
    >
      <style>{CC0_CSS}</style>

      <header className="@md:px-8 @md:pt-10 relative overflow-hidden px-4 pb-6 pt-8">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-[#ff2f8e]/20 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -left-24 top-10 h-60 w-60 rounded-full bg-[#d4ff3a]/10 blur-3xl"
        />
        <span className="cc0-strap cc0-mono">NOUN.WTF / CC0 · PUBLIC DOMAIN</span>
        <h1 className="m-0 mb-5 mt-9 pl-1" data-keep-font>
          <span className="cc0-title cc0-pip3">
            <span>CC0</span>
            <span className="is-acc">LIBRARY</span>
          </span>
        </h1>
        <p className="@md:text-[16px] relative m-0 max-w-[560px] text-[15px] leading-relaxed text-[#c9c7bd]">
          Free Nouns art, voxels, sounds and models. Everything here is CC0: take it, remix it, sell
          it, no credit needed. Made something nounish? Put it on the pile.
        </p>
        <div className="relative mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setSubmitting(true)}
            data-cc0-submit-open
            className="inline-flex h-11 items-center gap-2 rounded-full border-0 bg-[#d4ff3a] px-5 text-[14px] font-bold text-[#0b0b0f] shadow-[3px_3px_0_#ff2f8e] transition hover:bg-white"
          >
            <Plus className="h-4 w-4" aria-hidden /> Submit a CC0 asset
          </button>
          <span className="flex flex-wrap gap-x-4 gap-y-1">
            <SourceDot name="ARCHIVE" s={sources.archive} count={count('archive')} />
            <SourceDot name="CC0-LIB.WTF" s={sources.cc0Lib} count={count('cc0-lib')} />
            <SourceDot name="UPLOADS" s={sources.uploads} count={count('upload')} />
          </span>
        </div>
      </header>

      <div className="@md:px-8 sticky top-0 z-10 border-y border-white/[.06] bg-[#07070a]/90 px-4 py-3 backdrop-blur-md">
        <div className="flex items-center gap-2">
          <label className="relative min-w-0 flex-1">
            <span className="sr-only">Search the library</span>
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9b998f]"
              aria-hidden
            />
            <input
              type="search"
              value={filters.q}
              onChange={e => set('q', e.target.value)}
              placeholder="search heads, voxels, sounds…"
              className="h-10 w-full !rounded-full pl-9 pr-3 text-[14.5px]"
              data-cc0-search
            />
          </label>
          <button
            type="button"
            onClick={() => setView(v => (v === 'masonry' ? 'grid' : 'masonry'))}
            aria-label={view === 'masonry' ? 'Switch to grid' : 'Switch to masonry'}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border-0 bg-white/[.07] text-white hover:bg-white/15"
          >
            {view === 'masonry' ? (
              <LayoutGrid className="h-4 w-4" />
            ) : (
              <Rows3 className="h-4 w-4" />
            )}
          </button>
        </div>
        <div className="@max-lg:pr-6 @md:-mx-[24px] @md:px-[24px] -mx-4 mt-2.5 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]">
          <select
            aria-label="Creator"
            value={filters.creator}
            onChange={e => set('creator', e.target.value)}
            className="h-[30px] w-auto max-w-[180px] shrink-0 !rounded-full px-2.5 text-[12.5px] [@media(pointer:coarse)]:h-10"
          >
            <option value="all">All creators</option>
            {creators.map(c => (
              <option key={c.value} value={c.value}>
                {c.label} ({c.count})
              </option>
            ))}
          </select>
          <Chip on={filters.type === 'all'} onClick={() => set('type', 'all')}>
            ALL
          </Chip>
          {types.map(t => (
            <Chip
              key={t.value}
              on={filters.type === t.value}
              onClick={() => set('type', t.value as AssetType)}
            >
              {t.label} <span className="opacity-60">{t.count.toLocaleString()}</span>
            </Chip>
          ))}
          <span className="mx-1 w-px shrink-0 bg-white/10" aria-hidden />
          {(['all', 'upload', 'archive', 'cc0-lib'] as const).map(s => (
            <Chip key={s} on={filters.source === s} onClick={() => set('source', s)}>
              {s === 'all' ? 'EVERY SOURCE' : SOURCE_LABEL[s]}
            </Chip>
          ))}
        </div>
      </div>

      <main className="@md:px-8 px-4 pb-16 pt-4">
        <div className="cc0-mono mb-3 flex flex-wrap items-center justify-between gap-2 text-[10.5px] text-[#9b998f]">
          <span data-cc0-count>
            {loading
              ? 'LOADING THE ARCHIVE…'
              : `${Math.min(shown, results.length).toLocaleString()} OF ${results.length.toLocaleString()} ASSETS`}
          </span>
          {filtered && (
            <button
              type="button"
              onClick={() => setFilters(NO_FILTERS)}
              className="border-0 bg-transparent p-0 text-[10.5px] text-[#d4ff3a] hover:underline [@media(pointer:coarse)]:min-h-10"
            >
              CLEAR FILTERS
            </button>
          )}
        </div>

        {loading ? (
          <div className="cc0-grid" aria-hidden>
            {Array.from({ length: 12 }, (_, i) => (
              <div key={i} className="aspect-square animate-pulse rounded-xl bg-white/[.05]" />
            ))}
          </div>
        ) : results.length === 0 ? (
          <div className="rounded-2xl bg-white/[.04] p-8 text-center">
            <p className="m-0 text-[15px]">Nothing matches that.</p>
            <p className="m-0 mt-1 text-[13px] text-[#9b998f]">
              Try fewer words, or make it yourself and submit it.
            </p>
          </div>
        ) : (
          <div className={view === 'masonry' ? 'cc0-masonry' : 'cc0-grid'} data-cc0-grid>
            {results.slice(0, shown).map(a => (
              <AssetCard key={a.id} asset={a} square={view === 'grid'} onOpen={onOpen} />
            ))}
          </div>
        )}

        {hasMore && (
          <div ref={more} className="mt-6 flex justify-center">
            <button
              type="button"
              onClick={() => setShown(n => n + PAGE)}
              className="rounded-full border-0 bg-white/[.08] px-5 py-2.5 text-[13.5px] font-semibold text-white hover:bg-white/15 [@media(pointer:coarse)]:min-h-10"
            >
              Load more
            </button>
          </div>
        )}
        <p className="cc0-mono mt-10 text-center text-[10.5px] text-[#9b998f]">
          CC0 1.0 · NO RIGHTS RESERVED · COPY THIS
        </p>
      </main>

      {open !== undefined && <AssetDetail asset={open} onClose={close} onStep={step} />}
      {submitting && <SubmitDialog onClose={() => setSubmitting(false)} />}
    </div>
  );
}
