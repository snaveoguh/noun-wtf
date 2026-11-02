// A row of box-art cards (Netflix shelf): subheader, a horizontal strip
// that snaps, arrow buttons on desktop, swipe on touch.

import type { CSSProperties, MouseEvent } from 'react';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { cx } from '../osStore';

import { artSpec, NOUN_COUNTS, nounSvgUrl } from './boxArt';
import { ClipVideo, motionOk } from './Hero';
import { BIG_DROP_URL, type Item, type Row } from './rows';

export const ACCENT: Record<string, string> = {
  play: '#ff2f8e',
  art: '#d4ff3a',
  free: '#3dff8a',
  gov: '#ff3b5c',
  mkt: '#5ef1ff',
  net: '#ecebe4',
  clients: '#ffffff',
  community: '#ffd400',
};

function titleSize(title: string): string {
  const longest = Math.max(...title.split(' ').map(w => w.length));
  if (title.length <= 5) return 'is-xl';
  // 6+ letter words overflow the card at is-l and break mid-word ("SUBMI/T")
  if (longest <= 5 && title.length <= 12) return 'is-l';
  if (longest <= 9) return 'is-m';
  return 'is-s';
}

/** Generated box art: a deterministic Noun on a bold ground, house-poster style. */
export const BoxArt = memo(function BoxArt({ item }: { item: Item }) {
  const spec = useMemo(() => artSpec(item.key, item.group, NOUN_COUNTS), [item.key, item.group]);
  const src = useMemo(() => nounSvgUrl(spec.seed), [spec.seed]);
  const isSubmit = item.action.t === 'submit';
  const sub =
    item.action.t === 'entry'
      ? `noun.wtf${item.action.entry.path}`
      : item.action.t === 'external'
        ? item.label
        : '';
  return (
    <div
      className={`nh-art crop-${isSubmit ? 'submit' : spec.crop}`}
      style={
        {
          '--g1': spec.ground[0],
          '--g2': spec.ground[1],
          '--lx': `${spec.light}%`,
          '--tilt': `${spec.tilt}deg`,
        } as CSSProperties
      }
    >
      <i className="nh-rays" />
      <i className="nh-dots" />
      {isSubmit ? (
        <span className="nh-plus" aria-hidden>
          +
        </span>
      ) : (
        src !== '' && <img className="nh-noun" src={src} alt="" draggable={false} />
      )}
      <i className="nh-floor" />
      <span className={`nh-title ${titleSize(item.title)}`}>{item.title}</span>
      {sub !== '' && <span className="nh-url">{sub}</span>}
    </div>
  );
});

/** A padlock (pixel-ish, ink outlined), for locked cards. */
export function LockIcon() {
  return (
    <svg viewBox="0 0 16 18" width="16" height="18" aria-hidden>
      <path
        d="M4 8V5.5a4 4 0 0 1 8 0V8"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="square"
      />
      <rect x="1.5" y="8" width="13" height="9" rx="1.5" fill="currentColor" />
      <rect x="7" y="11" width="2" height="3.5" fill="#0b0b0f" />
    </svg>
  );
}

function verb(it: Item): string {
  if (it.locked !== undefined) return 'HOW TO UNLOCK ▸';
  if (it.action.t === 'submit') return 'SUBMIT +';
  if (it.external === true) return 'VISIT ↗';
  if (it.action.t === 'game' || it.group === 'play') return 'PLAY ▸';
  return 'OPEN ▸';
}

function hrefOf(it: Item): string | undefined {
  switch (it.action.t) {
    case 'entry':
      return it.action.entry.path;
    case 'game':
      if (it.action.id === 'hoops') return '/world?play=hoops&mode=3';
      if (it.action.id === 'breaks') return '/world?play=breaks';
      if (it.action.id === 'parkour') return '/world?play=parkour';
      if (it.action.id === 'pool') return '/world?play=pool';
      if (it.action.id === 'golf') return '/world?play=golf';
      if (it.action.id === 'hideseek') return '/world?play=hideseek';
      if (it.action.id === 'drive') return '/world?play=drive';
      if (it.action.id === 'drop') return it.locked !== undefined ? '/world' : BIG_DROP_URL;
      return `/${it.action.id}`;
    case 'external':
      return it.action.url;
    default:
      return undefined;
  }
}

const PREVIEW_DELAY = 400;

/** Netflix-style hover preview: after a beat, the box art crossfades to footage. */
function usePreview(enabled: boolean) {
  const [on, setOn] = useState(false);
  const [playing, setPlaying] = useState(false);
  const timer = useRef(0);
  const start = useCallback(() => {
    if (!enabled || !motionOk()) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOn(true), PREVIEW_DELAY);
  }, [enabled]);
  const stop = useCallback(() => {
    window.clearTimeout(timer.current);
    setOn(false);
    setPlaying(false);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { on, playing, setPlaying, start, stop };
}

export const Card = memo(function Card({
  item,
  onActivate,
  index,
  sound = false,
}: {
  item: Item;
  onActivate: (it: Item) => void;
  index: number;
  sound?: boolean;
}) {
  const accent = ACCENT[item.group] ?? '#fff';
  const pv = usePreview(item.preview !== undefined);
  const hover = {
    onPointerEnter: pv.start,
    onPointerLeave: pv.stop,
    onFocus: pv.start,
    onBlur: pv.stop,
  };
  const body = (
    <>
      <span className="nh-box">
        {item.cover ? (
          <span className={cx('nh-cover', item.coverWide === true && 'is-wide')}>
            {item.coverWide === true && (
              <img
                className="nh-cover-bg"
                src={item.cover}
                alt=""
                draggable={false}
                loading="lazy"
              />
            )}
            <img
              className="nh-cover-main"
              src={item.cover}
              alt=""
              loading={index < 6 ? 'eager' : 'lazy'}
              draggable={false}
              style={{ objectPosition: item.coverFocus }}
            />
            <span className="nh-band" aria-hidden>
              <b>⌐◨-◨</b> NOUN.WTF<em>FREE · WEB</em>
            </span>
            {item.coverWide === true && item.coverTag !== undefined && (
              <span className="nh-cover-tag" aria-hidden>
                {item.coverTag.split(' · ').map(w => (
                  <span key={w}>{w}</span>
                ))}
              </span>
            )}
          </span>
        ) : (
          <BoxArt item={item} />
        )}
        {item.preview && pv.on && (
          <>
            <ClipVideo
              clip={item.preview}
              playing
              withSound={sound}
              focus="50% 50%"
              className={cx('nh-preview', pv.playing && 'is-playing')}
              onPlaying={() => pv.setPlaying(true)}
            />
            <span className="nh-tape">PREVIEW</span>
          </>
        )}
        <span className="nh-label">{item.label}</span>
        {item.hot === true && <span className="nh-hot">HOT</span>}
        {item.locked !== undefined && (
          <span className="nh-lock" aria-hidden>
            <LockIcon />
            <span>{item.locked.hint}</span>
          </span>
        )}
        <span className="nh-sheen" />
        <span className="nh-info">
          <b>{item.title}</b>
          <span>{item.locked !== undefined ? `Locked. ${item.locked.hint}.` : item.blurb}</span>
          <em>{verb(item)}</em>
        </span>
      </span>
    </>
  );
  const style = { '--acc': accent } as CSSProperties;
  const label =
    item.locked !== undefined
      ? `${item.title.toLowerCase()} (locked: ${item.locked.hint.toLowerCase()})`
      : `${item.title.toLowerCase()}: ${item.blurb}`;
  if (item.action.t === 'submit')
    return (
      <button
        type="button"
        className="nh-card is-submit"
        style={style}
        onClick={() => onActivate(item)}
        aria-label="Submit your own game or page"
      >
        {body}
      </button>
    );
  const href = hrefOf(item);
  if (item.external === true)
    return (
      <a
        className="nh-card"
        style={style}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`${label} (opens in a new tab)`}
      >
        {body}
      </a>
    );
  return (
    <a
      className={cx(
        'nh-card',
        pv.playing && 'is-previewing',
        item.locked !== undefined && 'is-locked',
      )}
      style={style}
      href={href}
      aria-label={label}
      {...hover}
      onClick={(e: MouseEvent) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        onActivate(item);
      }}
    >
      {body}
    </a>
  );
});

export function Shelf({
  row,
  onActivate,
  count,
  sound,
}: {
  row: Row;
  onActivate: (it: Item) => void;
  count?: string;
  sound?: boolean;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });

  const measure = useCallback(() => {
    const el = strip.current;
    if (!el) return;
    setEdge({
      start: el.scrollLeft < 8,
      end: el.scrollLeft + el.clientWidth > el.scrollWidth - 8,
    });
  }, []);

  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    // Fires once on observe, then on every resize
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, row.items.length]);

  const page = (dir: 1 | -1) => {
    const el = strip.current;
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollBy({ left: dir * el.clientWidth * 0.82, behavior: reduce ? 'auto' : 'smooth' });
  };

  return (
    <section
      className="nh-shelf"
      id={`row-${row.id}`}
      aria-labelledby={`row-${row.id}-h`}
      style={{ '--acc': ACCENT[row.group] ?? '#fff' } as CSSProperties}
    >
      <header className="nh-shelf-head">
        <h2 id={`row-${row.id}-h`}>
          <i aria-hidden />
          {row.title}
        </h2>
        <p>{row.tagline}</p>
        <span className="nh-count">{count ?? `${row.items.length}`}</span>
      </header>
      <div className="nh-strip-wrap">
        <button
          type="button"
          className="nh-arrow is-prev"
          aria-label={`Scroll ${row.title} back`}
          hidden={edge.start}
          tabIndex={-1}
          onClick={() => page(-1)}
        >
          ‹
        </button>
        <div ref={strip} className="nh-strip" onScroll={measure} role="list">
          {row.items.map((it, i) => (
            <div role="listitem" key={it.key} className="nh-slot">
              <Card item={it} index={i} onActivate={onActivate} sound={sound} />
            </div>
          ))}
          {row.id === 'community' &&
            Array.from({ length: Math.max(0, 4 - row.items.length) }, (_, i) => (
              <div key={`ghost-${i}`} className="nh-ghost" aria-hidden>
                {['your game here', 'your page here', 'your tool here', 'your art here'][i % 4]}
              </div>
            ))}
        </div>
        <button
          type="button"
          className="nh-arrow is-next"
          aria-label={`Scroll ${row.title} on`}
          hidden={edge.end}
          tabIndex={-1}
          onClick={() => page(1)}
        >
          ›
        </button>
      </div>
    </section>
  );
}
