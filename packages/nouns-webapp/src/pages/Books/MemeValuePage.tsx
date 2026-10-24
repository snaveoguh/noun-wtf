// /books/meme-value: "MEME VALUE" by LIL 67 as a flipbook. Page images and
// text live in public/books/meme-value (scripts/books/render-meme-value.py);
// the 88 MB PDF stays on memevalue.pinit.eth.limo.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';

import {
  firstPageOf,
  pageLabel,
  searchPages,
  viewAt,
  viewCount,
  viewOfPage,
  type Layout,
  type PageText,
} from './bookMath';
import Flipbook, { type FlipApi } from './Flipbook';

import './books.css';

const BOOK = {
  base: '/books/meme-value',
  pages: 252,
  original: 'https://memevalue.pinit.eth.limo/',
};

interface BookJson {
  pageCount: number;
  pages: PageText[];
}

const ZOOMS = [1, 1.5, 2, 3, 4];

function usePrefersReducedMotion(): boolean {
  const q = '(prefers-reduced-motion: reduce)';
  const [v, setV] = useState(() => typeof window !== 'undefined' && window.matchMedia?.(q).matches);
  useEffect(() => {
    const m = window.matchMedia?.(q);
    if (m === undefined) return;
    const on = () => setV(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return v;
}

/** Page size and layout that fit the stage. */
function fit(w: number, h: number): { layout: Layout; W: number } {
  const pad = w < 640 ? 16 : 40;
  const spreadW = Math.floor(Math.min((w - pad * 2 - 24) / 2, h - pad * 2));
  if (w >= 720 && spreadW >= 240) return { layout: 'spread', W: spreadW };
  return { layout: 'single', W: Math.max(120, Math.floor(Math.min(w - pad * 2 - 8, h - pad * 2))) };
}

type Panel = 'thumbs' | 'search' | 'about' | 'text' | null;

const Icon = {
  prev: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4">
      <path d="M10 3L5 8l5 5" />
    </svg>
  ),
  next: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4">
      <path d="M6 3l5 5-5 5" />
    </svg>
  ),
  grid: (
    <svg viewBox="0 0 16 16" fill="currentColor">
      <rect x="1" y="1" width="6" height="6" rx="1" />
      <rect x="9" y="1" width="6" height="6" rx="1" />
      <rect x="1" y="9" width="6" height="6" rx="1" />
      <rect x="9" y="9" width="6" height="6" rx="1" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2">
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5L15 15" />
    </svg>
  ),
  plus: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4">
      <path d="M8 3v10M3 8h10" />
    </svg>
  ),
  minus: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4">
      <path d="M3 8h10" />
    </svg>
  ),
  full: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2">
      <path d="M1.5 5.5v-4h4M10.5 1.5h4v4M14.5 10.5v4h-4M5.5 14.5h-4v-4" />
    </svg>
  ),
  close: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4">
      <path d="M3 3l10 10M13 3L3 13" />
    </svg>
  ),
};

export default function MemeValuePage() {
  const [params, setParams] = useSearchParams();
  const reducedMotion = usePrefersReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const flip = useRef<FlipApi>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [panel, setPanel] = useState<Panel>(null);
  const [query, setQuery] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [touched, setTouched] = useState(false);

  const { data: book } = useQuery({
    queryKey: ['book', 'meme-value'],
    queryFn: async (): Promise<BookJson> => {
      const r = await fetch(`${BOOK.base}/pages.json`);
      if (!r.ok) throw new Error(`pages.json ${r.status}`);
      return (await r.json()) as BookJson;
    },
    staleTime: Infinity,
  });
  const pages = book?.pageCount ?? BOOK.pages;

  // Fill the navigator window (or the page) without scrolling it: the reader
  // is exactly as tall as the window body below it.
  const [fillH, setFillH] = useState<number | null>(null);
  useEffect(() => {
    const root = rootRef.current;
    const host = root?.closest('.nos-content');
    if (!root || !(host instanceof HTMLElement)) return;
    const measure = () => {
      const top =
        root.getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop;
      setFillH(Math.max(420, Math.floor(host.clientHeight - top)));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    measure();
    return () => ro.disconnect();
  }, []);

  // measure the stage
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const { layout, W } = useMemo(() => fit(size?.w ?? 1000, size?.h ?? 700), [size]);

  // The page lives in ?p= so links land on a page. It's held locally too:
  // the navigator hands this page its location a render late, so the URL is
  // written, and only read back when something else changes it.
  const pageParam = Math.max(1, Number(params.get('p') ?? '1') || 1);
  const [page, setPage] = useState(pageParam);
  const written = useRef(new Set([pageParam]));
  useEffect(() => {
    if (written.current.has(pageParam)) return;
    written.current = new Set([pageParam]);
    setPage(pageParam);
  }, [pageParam]);
  const view = viewOfPage(page, pages, layout);
  const views = viewCount(pages, layout);
  const setView = useCallback(
    (v: number) => {
      const clamped = Math.min(Math.max(0, v), views - 1);
      const p = firstPageOf(clamped, pages, layout);
      setTouched(true);
      setPage(p);
      written.current.add(p);
      setParams(
        prev => {
          const n = new URLSearchParams(prev);
          if (p === 1) n.delete('p');
          else n.set('p', String(p));
          return n;
        },
        { replace: true },
      );
    },
    [views, pages, layout, setParams],
  );
  const goPage = useCallback(
    (p: number) => setView(viewOfPage(p, pages, layout)),
    [setView, pages, layout],
  );

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const large = W * dpr * zoom > 760;
  const src = useCallback(
    (n: number) => `${BOOK.base}/${large ? '' : 'sm/'}p${String(n).padStart(3, '0')}.webp`,
    [large],
  );
  const alt = useCallback(
    (n: number) => {
      const t = book?.pages[n - 1]?.text.replace(/\s+/g, ' ').trim();
      const head = n === 1 ? 'Front cover' : n === pages ? 'Back cover' : `Page ${n}`;
      return t ? `${head}: ${t.slice(0, 220)}${t.length > 220 ? '…' : ''}` : head;
    },
    [book, pages],
  );

  const turn = useCallback(
    (dir: 1 | -1) => {
      if (flip.current) flip.current.turn(dir);
      else setView(view + dir);
    },
    [setView, view],
  );

  const zoomBy = useCallback((dir: 1 | -1) => {
    setZoom(z => {
      const i = ZOOMS.findIndex(x => x >= z - 1e-6);
      const next = ZOOMS[Math.min(ZOOMS.length - 1, Math.max(0, (i < 0 ? 0 : i) + dir))]!;
      return next;
    });
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = rootRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void el.requestFullscreen?.().catch(() => {});
  }, []);
  useEffect(() => {
    const on = () => setFullscreen(document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
        if (e.key === 'Escape') setPanel(null);
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key;
      if (k === 'ArrowRight' || k === 'PageDown') turn(1);
      else if (k === 'ArrowLeft' || k === 'PageUp') turn(-1);
      else if (k === 'Home') setView(0);
      else if (k === 'End') setView(views - 1);
      else if (k === '+' || k === '=') zoomBy(1);
      else if (k === '-') zoomBy(-1);
      else if (k === 'Escape') {
        if (panel) setPanel(null);
        else if (zoom > 1) setZoom(1);
        return;
      } else if (k === '/') setPanel('search');
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [turn, setView, views, zoomBy, panel, zoom]);

  // pinch and ctrl+wheel zoom
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    let start: { d: number; z: number } | null = null;
    const dist = (t: TouchList) =>
      Math.hypot(t[0]!.clientX - t[1]!.clientX, t[0]!.clientY - t[1]!.clientY);
    const ts = (e: TouchEvent) => {
      if (e.touches.length === 2) start = { d: dist(e.touches), z: zoomRef.current };
    };
    const tm = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !start) return;
      e.preventDefault();
      const z = Math.min(4, Math.max(1, (start.z * dist(e.touches)) / start.d));
      setZoom(Math.abs(z - 1) < 0.08 ? 1 : +z.toFixed(2));
    };
    const te = (e: TouchEvent) => {
      if (e.touches.length < 2) start = null;
    };
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      setZoom(z => {
        const n = Math.min(4, Math.max(1, z * Math.exp(-e.deltaY * 0.01)));
        return Math.abs(n - 1) < 0.05 ? 1 : +n.toFixed(2);
      });
    };
    el.addEventListener('touchstart', ts, { passive: true });
    el.addEventListener('touchmove', tm, { passive: false });
    el.addEventListener('touchend', te, { passive: true });
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('touchstart', ts);
      el.removeEventListener('touchmove', tm);
      el.removeEventListener('touchend', te);
      el.removeEventListener('wheel', wheel);
    };
  }, []);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // keep the zoomed view centred on what was in the middle
  const prevZoom = useRef(zoom);
  useEffect(() => {
    const el = stageRef.current;
    const z0 = prevZoom.current;
    prevZoom.current = zoom;
    if (!el || z0 === zoom) return;
    const cx = (el.scrollLeft + el.clientWidth / 2) / z0;
    const cy = (el.scrollTop + el.clientHeight / 2) / z0;
    requestAnimationFrame(() => {
      el.scrollLeft = cx * zoom - el.clientWidth / 2;
      el.scrollTop = cy * zoom - el.clientHeight / 2;
    });
  }, [zoom]);

  // drag to pan when zoomed (mouse; touch pans natively)
  const pan = useRef<{ x: number; y: number; l: number; t: number } | null>(null);

  const hits = useMemo(() => (book ? searchPages(book.pages, query) : []), [book, query]);
  const v = viewAt(view, pages, layout);
  const here = [v.left, v.right].filter((n): n is number => n !== null);
  const hereText = book ? here.map(n => ({ n, text: book.pages[n - 1]?.text ?? '' })) : [];

  const spread = layout === 'spread';
  const bookW = spread ? 2 * W : W;
  const zoomed = zoom > 1;
  const contentW = (size?.w ?? 0) * (zoomed ? zoom : 1);
  const contentH = (size?.h ?? 0) * (zoomed ? zoom : 1);

  return (
    <div
      className="bk"
      ref={rootRef}
      data-fullscreen={fullscreen ? '1' : undefined}
      style={fillH !== null && !fullscreen ? { height: fillH } : undefined}
    >
      <header className="bk-head">
        <h1 className="bk-title" data-keep-font>
          MEME <b>VALUE</b>
        </h1>
        <div className="bk-by">
          <span>
            by <strong>LIL 67</strong> · written and illustrated by 67
          </span>
          <span>
            original:{' '}
            <a href={BOOK.original} target="_blank" rel="noopener noreferrer">
              memevalue.pinit.eth.limo
            </a>
          </span>
        </div>
      </header>

      <div
        className={`bk-stage ${zoomed ? 'is-zoomed' : ''}`}
        ref={stageRef}
        onPointerDown={e => {
          if (!zoomed || e.pointerType !== 'mouse') return;
          const el = stageRef.current!;
          pan.current = { x: e.clientX, y: e.clientY, l: el.scrollLeft, t: el.scrollTop };
        }}
        onPointerMove={e => {
          if (!pan.current) return;
          const el = stageRef.current!;
          el.scrollLeft = pan.current.l - (e.clientX - pan.current.x);
          el.scrollTop = pan.current.t - (e.clientY - pan.current.y);
        }}
        onPointerUp={() => (pan.current = null)}
        onPointerLeave={() => (pan.current = null)}
      >
        {size && (
          <div
            className="bk-center"
            style={zoomed ? { width: contentW, height: contentH } : undefined}
          >
            <div
              className="bk-zoom"
              style={{
                width: bookW * zoom,
                height: W * zoom,
              }}
            >
              <div
                style={{
                  transform: `scale(${zoom})`,
                  transformOrigin: '0 0',
                  width: bookW,
                  height: W,
                }}
              >
                <Flipbook
                  pages={pages}
                  layout={layout}
                  view={view}
                  onView={setView}
                  W={W}
                  H={W}
                  src={src}
                  alt={alt}
                  reducedMotion={reducedMotion}
                  interactive={!zoomed}
                  api={flip}
                />
              </div>
            </div>
          </div>
        )}
        {!touched && view === 0 && !zoomed && (
          <div className="bk-hint">
            {spread ? 'drag a corner · click · ← →' : 'swipe or tap to turn'}
          </div>
        )}
        {/* the text of the pages in view, for screen readers */}
        <div className="bk-sr" aria-live="polite">
          {hereText
            .map(p => `${p.n === 1 ? 'Front cover' : `Page ${p.n}`}. ${p.text}`)
            .join('\n\n')}
        </div>

        {panel && (
          <aside className={`bk-panel ${panel === 'thumbs' ? 'is-wide' : ''}`} aria-label={panel}>
            <div className="bk-panel-head">
              <h2 data-keep-font>
                {panel === 'thumbs'
                  ? 'PAGES'
                  : panel === 'search'
                    ? 'SEARCH'
                    : panel === 'about'
                      ? 'ABOUT'
                      : 'TEXT'}
              </h2>
              <button
                type="button"
                className="bk-btn"
                onClick={() => setPanel(null)}
                aria-label="Close"
              >
                {Icon.close}
              </button>
            </div>
            <div className="bk-panel-body">
              {panel === 'thumbs' && (
                <div className="bk-thumbs">
                  {Array.from({ length: pages }, (_, i) => i + 1).map(n => (
                    <button
                      type="button"
                      key={n}
                      className={`bk-thumb ${here.includes(n) ? 'is-here' : ''}`}
                      onClick={() => {
                        goPage(n);
                        if (layout === 'single') setPanel(null);
                      }}
                      aria-label={`Go to page ${n}`}
                    >
                      <img
                        src={`${BOOK.base}/sm/p${String(n).padStart(3, '0')}.webp`}
                        alt=""
                        loading="lazy"
                        decoding="async"
                      />
                      <span>{n}</span>
                    </button>
                  ))}
                </div>
              )}
              {panel === 'search' && (
                <>
                  <input
                    className="bk-search"
                    type="search"
                    autoFocus
                    placeholder="search the book…"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && hits[0] !== undefined) goPage(hits[0].page);
                    }}
                    aria-label="Search the book"
                  />
                  <p className="bk-meta">
                    {!book
                      ? 'loading the text…'
                      : query.trim().length < 2
                        ? 'type two letters or more'
                        : `${hits.length} page${hits.length === 1 ? '' : 's'}`}
                  </p>
                  <ul className="bk-hits">
                    {hits.map(h => (
                      <li key={h.page}>
                        <button
                          type="button"
                          className="bk-hit"
                          onClick={() => {
                            goPage(h.page);
                            if (layout === 'single') setPanel(null);
                          }}
                        >
                          <b>P.{h.page}</b>
                          {h.snippet.slice(0, h.start)}
                          <mark>{h.snippet.slice(h.start, h.end)}</mark>
                          {h.snippet.slice(h.end)}
                          {h.count > 1 && (
                            <em style={{ color: '#9b998f', fontStyle: 'normal' }}> ×{h.count}</em>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {panel === 'about' && (
                <div className="bk-about">
                  <div className="bk-credit">
                    <p data-keep-font>“MEME VALUE”</p>
                    <p>LIL 67</p>
                    <p>written and illustrated by 67 unless specified otherwise</p>
                    <p>for Jolene &amp; Seth</p>
                  </div>
                  <p>
                    “MEME VALUE” is a residue of participation: marks left inside a system while it
                    is still moving. It is repetitive, unfinished, and occasionally “wrong” by
                    design.
                  </p>
                  <p>
                    Turn pages by dragging a corner, clicking either side, swiping, or with the
                    arrow keys. Zoom with the buttons, a pinch or ctrl + scroll.
                  </p>
                  <div className="bk-links">
                    <a
                      className="bk-btn is-pink"
                      href={BOOK.original}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Original site ↗
                    </a>
                    <a
                      className="bk-btn"
                      href={BOOK.original}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Download PDF (88 MB) ↗
                    </a>
                  </div>
                </div>
              )}
              {panel === 'text' && (
                <div className="bk-text">
                  {hereText.map(p => (
                    <section key={p.n}>
                      <h3>
                        {p.n === 1 ? 'FRONT COVER' : p.n === pages ? 'BACK COVER' : `PAGE ${p.n}`}
                      </h3>
                      <pre>{p.text || '(no text on this page)'}</pre>
                    </section>
                  ))}
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      <nav className="bk-bar" aria-label="Book controls">
        <button
          type="button"
          className="bk-btn"
          onClick={() => turn(-1)}
          disabled={view <= 0}
          aria-label="Previous page"
        >
          {Icon.prev}
        </button>
        <span className="bk-count" aria-live="polite">
          {pageLabel(v, pages)}
        </span>
        <button
          type="button"
          className="bk-btn"
          onClick={() => turn(1)}
          disabled={view >= views - 1}
          aria-label="Next page"
        >
          {Icon.next}
        </button>
        <span className="bk-sep" />
        <button
          type="button"
          className={`bk-btn ${panel === 'thumbs' ? 'is-on' : ''}`}
          onClick={() => setPanel(p => (p === 'thumbs' ? null : 'thumbs'))}
          aria-label="Pages"
        >
          {Icon.grid}
          <span className="bk-lbl">Pages</span>
        </button>
        <button
          type="button"
          className={`bk-btn ${panel === 'search' ? 'is-on' : ''}`}
          onClick={() => setPanel(p => (p === 'search' ? null : 'search'))}
          aria-label="Search"
        >
          {Icon.search}
          <span className="bk-lbl">Search</span>
        </button>
        <button
          type="button"
          className={`bk-btn ${panel === 'text' ? 'is-on' : ''}`}
          onClick={() => setPanel(p => (p === 'text' ? null : 'text'))}
          aria-label="Text of these pages"
        >
          Aa<span className="bk-lbl">Text</span>
        </button>
        <span className="bk-sep" />
        <button
          type="button"
          className={`bk-btn bk-phone ${zoomed ? 'is-on' : ''}`}
          onClick={() => setZoom(z => (z >= 3 ? 1 : z >= 2 ? 3 : 2))}
          aria-label={`Zoom (${Math.round(zoom * 100)}%)`}
        >
          {zoomed ? `${Math.round(zoom * 10) / 10}×` : Icon.plus}
        </button>
        <button
          type="button"
          className="bk-btn bk-desk"
          onClick={() => zoomBy(-1)}
          disabled={zoom <= 1}
          aria-label="Zoom out"
        >
          {Icon.minus}
        </button>
        <span className="bk-zoomlabel bk-desk">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          className="bk-btn bk-desk"
          onClick={() => zoomBy(1)}
          disabled={zoom >= 4}
          aria-label="Zoom in"
        >
          {Icon.plus}
        </button>
        <button
          type="button"
          className={`bk-btn bk-desk ${fullscreen ? 'is-on' : ''}`}
          onClick={toggleFullscreen}
          aria-label="Fullscreen"
        >
          {Icon.full}
        </button>
        <span className="bk-sep" />
        <button
          type="button"
          className={`bk-btn ${panel === 'about' ? 'is-on' : ''}`}
          onClick={() => setPanel(p => (p === 'about' ? null : 'about'))}
          aria-label="About the book"
        >
          <span className="bk-phone" aria-hidden>
            i
          </span>
          <span className="bk-lbl">About</span>
        </button>
        <a
          className="bk-btn is-pink"
          href={BOOK.original}
          target="_blank"
          rel="noopener noreferrer"
        >
          PDF<span className="bk-lbl"> ↗</span>
        </a>
      </nav>
    </div>
  );
}
