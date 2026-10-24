// A dependency-free flipbook. The turning leaf is folded along the line
// halfway between its corner and the pointer (bookMath.foldAt); the fold is
// drawn with nested transformed boxes (a huge rotated clip box + the page's
// front and its mirrored back inside it), so a drag only ever changes CSS
// transforms: no layout, no repaint of the page images.
//
// One geometry covers every turn: the leaf is always the right-hand page of
// view `base`, turning towards `base + 1`. Turning back is that turn played
// in reverse (base = view - 1, starting with the corner flat on the left).

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import type { CSSProperties, PointerEvent as RPointerEvent, Ref } from 'react';

import {
  constrain,
  cornerAt,
  css,
  dragProgress,
  foldAt,
  inv,
  mul,
  neighbourPages,
  settles,
  turnPages,
  viewAt,
  viewCount,
  type Layout,
  type Mat,
  type Pt,
} from './bookMath';

export interface FlipApi {
  /** Turn one view forwards (+1) or back (-1), animated. */
  turn: (dir: 1 | -1) => void;
}

interface Props {
  pages: number;
  layout: Layout;
  view: number;
  onView: (v: number) => void;
  /** Page size in CSS px (pages are square here, but W and H are kept apart) */
  W: number;
  H: number;
  src: (page: number) => string;
  reducedMotion: boolean;
  /** Turns off dragging and corner hovers (zoomed in: the drag pans instead) */
  interactive: boolean;
  api?: Ref<FlipApi>;
  /** Alt text for a page */
  alt: (page: number) => string;
}

interface TurnState {
  base: number;
  top: boolean;
}

type Mode =
  | { k: 'idle' }
  | { k: 'peek' }
  | { k: 'drag'; id: number }
  | { k: 'swipe'; id: number; x0: number; y0: number; dir: 0 | 1 | -1 }
  | { k: 'anim' };

const PEEK = 0.11;
const CORNER = 0.2;
const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

function Page({
  n,
  src,
  alt,
  className,
  style,
}: {
  n: number | null;
  src: (p: number) => string;
  alt?: (p: number) => string;
  className?: string;
  style?: CSSProperties;
}) {
  if (n === null) return null;
  return (
    <img
      className={`fb-img ${className ?? ''}`}
      src={src(n)}
      alt={alt ? alt(n) : ''}
      draggable={false}
      decoding="async"
      style={style}
    />
  );
}

export default function Flipbook(props: Props) {
  const { pages, layout, view, onView, W, H, src, reducedMotion, interactive, api, alt } = props;
  const views = viewCount(pages, layout);
  const spread = layout === 'spread';
  const BIG = 4 * (W + H);

  const [turn, setTurn] = useState<TurnState | null>(null);
  const [fade, setFade] = useState(0);
  const P = useRef<Pt>({ x: W, y: H });
  const mode = useRef<Mode>({ k: 'idle' });
  const raf = useRef(0);
  /** Where the running turn animation will land */
  const pending = useRef<number | null>(null);
  const vel = useRef({ x: 0, t: 0, px: 0 });
  const turnRef = useRef<TurnState | null>(null);
  turnRef.current = turn;
  const viewRef = useRef(view);
  viewRef.current = view;

  const bookEl = useRef<HTMLDivElement>(null);
  const clipEl = useRef<HTMLDivElement>(null);
  const frontEl = useRef<HTMLDivElement>(null);
  const backEl = useRef<HTMLDivElement>(null);
  const frontShade = useRef<HTMLDivElement>(null);
  const backShade = useRef<HTMLDivElement>(null);
  const underShade = useRef<HTMLDivElement>(null);
  const spineEl = useRef<HTMLDivElement>(null);

  // Closed covers sit centred: the front cover alone is shifted left by half
  // a page, the back cover right, and a turn slides between the two.
  const offsetOf = useCallback(
    (v: number) => {
      if (!spread) return 0;
      const s = viewAt(v, pages, layout);
      if (s.left === null) return -W / 2;
      if (s.right === null) return W / 2;
      return 0;
    },
    [spread, pages, layout, W],
  );

  const paint = useCallback(() => {
    const t = turnRef.current;
    const book = bookEl.current;
    if (!t) {
      if (book) book.style.transform = `translate3d(${offsetOf(viewRef.current)}px,0,0)`;
      return;
    }
    const f = foldAt(P.current, W, H, t.top, BIG);
    const prog = dragProgress(P.current, W);
    if (book) {
      const o = offsetOf(t.base) + (offsetOf(t.base + 1) - offsetOf(t.base)) * prog;
      book.style.transform = `translate3d(${o}px,0,0)`;
    }
    const clip = clipEl.current;
    if (!clip) return;
    if (!f) {
      clip.style.visibility = 'hidden';
      if (underShade.current) underShade.current.style.opacity = '0';
      return;
    }
    clip.style.visibility = 'visible';
    const d = Math.hypot(W - P.current.x, (t.top ? 0 : H) - P.current.y);
    clip.style.transform = css(f.clip);
    if (frontEl.current) frontEl.current.style.transform = css(f.front);
    if (backEl.current) backEl.current.style.transform = css(f.back);
    // Shading strips are drawn in the clip box's frame (fold at x = BIG), then
    // re-expressed inside whichever page box clips them.
    const strength = Math.min(1, d / (W * 0.25)) * (1 - Math.max(0, prog - 0.85) / 0.15);
    const sFront = Math.max(8, Math.min(d * 0.3, W * 0.22));
    if (frontShade.current) {
      // inside the front page box: front ∘ clip = identity, so clip-frame → page is `clip`
      const m: Mat = mul(f.clip, [sFront / 100, 0, 0, 1, BIG - sFront, 0]);
      frontShade.current.style.transform = css(m);
      frontShade.current.style.opacity = String(strength);
    }
    const sBack = Math.max(4, d / 2);
    if (backShade.current) {
      const toBack = mul(inv(f.back), [sBack / 100, 0, 0, 1, BIG - sBack, 0]);
      backShade.current.style.transform = css(toBack);
    }
    const sUnder = Math.max(6, Math.min(d * 0.28, W * 0.3));
    if (underShade.current) {
      underShade.current.style.transform = css(mul(f.clip, [sUnder / 100, 0, 0, 1, BIG, 0]));
      underShade.current.style.opacity = String(strength);
    }
  }, [W, H, BIG, offsetOf]);

  useLayoutEffect(() => {
    paint();
  });

  const stop = () => {
    cancelAnimationFrame(raf.current);
    raf.current = 0;
  };

  const finish = useCallback(
    (t: TurnState) => {
      const next = P.current.x < 0 ? t.base + 1 : t.base;
      pending.current = null;
      mode.current = { k: 'idle' };
      setTurn(null);
      if (next !== viewRef.current) onView(next);
    },
    [onView],
  );

  /** Move the corner to `to` over `ms`, then call `done`. */
  const animateTo = useCallback(
    (to: Pt, ms: number, done?: () => void, path?: (e: number) => Pt) => {
      stop();
      const from = { ...P.current };
      const t0 = performance.now();
      const step = (now: number) => {
        const k = Math.min(1, (now - t0) / ms);
        if (path) P.current = path(k);
        else {
          const e = easeOut(k);
          P.current = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e };
        }
        paint();
        if (k < 1) raf.current = requestAnimationFrame(step);
        else {
          raf.current = 0;
          done?.();
        }
      };
      raf.current = requestAnimationFrame(step);
    },
    [paint],
  );

  const startTurn = useCallback((t: TurnState, at: Pt) => {
    P.current = at;
    turnRef.current = t;
    setTurn(t);
  }, []);

  const turnBy = useCallback(
    (dir: 1 | -1) => {
      let v = viewRef.current;
      // a click mid-turn lands the running turn at once, then turns on from there
      if (mode.current.k === 'anim' && pending.current !== null) {
        stop();
        const landed = pending.current;
        pending.current = null;
        mode.current = { k: 'idle' };
        turnRef.current = null;
        setTurn(null);
        if (landed !== viewRef.current) onView(landed);
        v = landed;
        viewRef.current = landed;
      }
      const target = v + dir;
      if (target < 0 || target >= views) return;
      if (reducedMotion) {
        setFade(f => f + 1);
        onView(target);
        return;
      }
      const base = dir === 1 ? v : v - 1;
      const t = { base, top: false };
      const from = dir === 1 ? 0 : 1;
      const prog0 =
        turnRef.current && turnRef.current.base === base ? dragProgress(P.current, W) : from;
      startTurn(t, cornerAt(prog0, W, H, false));
      mode.current = { k: 'anim' };
      pending.current = target;
      const to = dir === 1 ? 1 : 0;
      const ms = 720 * Math.max(0.35, Math.abs(to - prog0));
      animateTo(
        cornerAt(to, W, H, false),
        ms,
        () => finish(t),
        e => cornerAt(prog0 + (to - prog0) * easeInOut(e), W, H, false),
      );
    },
    [views, reducedMotion, onView, W, H, startTurn, animateTo, finish],
  );

  useImperativeHandle(api, () => ({ turn: turnBy }), [turnBy]);

  // A resize or layout change mid-turn: drop the turn.
  useEffect(() => {
    stop();
    mode.current = { k: 'idle' };
    setTurn(null);
  }, [W, H, layout]);

  useEffect(() => () => stop(), []);

  // Preload the neighbours; everything further away loads when it's reached.
  useEffect(() => {
    const keep: HTMLImageElement[] = [];
    const id = window.setTimeout(() => {
      for (const n of neighbourPages(view, pages, layout, 2)) {
        const im = new Image();
        im.decoding = 'async';
        im.src = src(n);
        keep.push(im);
      }
    }, 120);
    return () => window.clearTimeout(id);
  }, [view, pages, layout, src]);

  // ── pointer handling ───────────────────────────────────────────────
  const toBook = (e: { clientX: number; clientY: number }): Pt => {
    const r = spineEl.current!.getBoundingClientRect();
    // the spine box is 0×0 at book (0,0), and any CSS zoom scales it
    const scale = (bookEl.current?.parentElement?.getBoundingClientRect().height ?? H) / H || 1;
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale };
  };

  /** Which corner (if any) the point is on: forward = right page's outer corners. */
  const cornerHit = (p: Pt): { dir: 1 | -1; top: boolean } | null => {
    const z = W * CORNER;
    const top = p.y < z ? true : p.y > H - z ? false : null;
    if (top === null || p.y < -4 || p.y > H + 4) return null;
    const v = viewAt(viewRef.current, pages, layout);
    if (p.x > W - z && p.x < W + 6 && v.right !== null && viewRef.current < views - 1)
      return { dir: 1, top };
    if (spread && p.x < -W + z && p.x > -W - 6 && v.left !== null && viewRef.current > 0)
      return { dir: -1, top };
    return null;
  };

  const restCorner = (dir: 1 | -1, top: boolean): Pt => ({ x: dir === 1 ? W : -W, y: top ? 0 : H });

  const onMove = (e: RPointerEvent) => {
    if (reducedMotion || !interactive) return;
    const p = toBook(e);
    const m = mode.current;
    if (m.k === 'drag' && m.id === e.pointerId) {
      const t = turnRef.current;
      if (!t) return;
      const now = performance.now();
      const dt = Math.max(1, now - vel.current.t);
      vel.current = { x: (p.x - vel.current.px) / dt, t: now, px: p.x };
      P.current = constrain(p, W, H, t.top);
      paint();
      return;
    }
    if (m.k === 'swipe' && m.id === e.pointerId) {
      const dx = e.clientX - m.x0;
      const dy = e.clientY - m.y0;
      if (m.dir === 0) {
        if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy)) return;
        const dir: 1 | -1 = dx < 0 ? 1 : -1;
        const v = viewRef.current;
        if (v + dir < 0 || v + dir >= views) return;
        mode.current = { ...m, dir };
        startTurn(
          { base: dir === 1 ? v : v - 1, top: false },
          cornerAt(dir === 1 ? 0 : 1, W, H, false),
        );
        return;
      }
      const scale = (bookEl.current?.parentElement?.getBoundingClientRect().height ?? H) / H || 1;
      const span = (spread ? 1.4 : 1) * W * scale;
      const k = Math.min(1, Math.max(0, (m.dir === 1 ? -dx : dx) / span));
      const now = performance.now();
      const dt = Math.max(1, now - vel.current.t);
      vel.current = { x: (e.clientX - vel.current.px) / dt / scale, t: now, px: e.clientX };
      P.current = cornerAt(m.dir === 1 ? k : 1 - k, W, H, false);
      paint();
      return;
    }
    if (e.pointerType !== 'mouse' || m.k === 'anim') return;
    // hover: lift the corner under the mouse a little
    const hit = cornerHit(p);
    if (hit && m.k === 'idle') {
      const v = viewRef.current;
      const t = { base: hit.dir === 1 ? v : v - 1, top: hit.top };
      startTurn(t, restCorner(hit.dir, hit.top));
      mode.current = { k: 'peek' };
      const dy = (hit.top ? 1 : -1) * W * PEEK * 0.8;
      animateTo({ x: hit.dir * (W - W * PEEK), y: (hit.top ? 0 : H) + dy }, 220);
    } else if (!hit && m.k === 'peek') endPeek();
  };

  /** Let a lifted corner fall back flat. */
  function endPeek() {
    const t = turnRef.current;
    if (!t) return;
    animateTo(restCorner(P.current.x < 0 ? -1 : 1, t.top), 180, () => {
      if (mode.current.k === 'peek') {
        mode.current = { k: 'idle' };
        setTurn(null);
      }
    });
  }

  const onDown = (e: RPointerEvent) => {
    if (!interactive || e.button > 0) return;
    if (reducedMotion) {
      mode.current = { k: 'swipe', id: e.pointerId, x0: e.clientX, y0: e.clientY, dir: 0 };
      return;
    }
    if (mode.current.k === 'anim') return;
    const p = toBook(e);
    const hit = cornerHit(p);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    vel.current = { x: 0, t: performance.now(), px: p.x };
    if (hit) {
      stop();
      const v = viewRef.current;
      const t = { base: hit.dir === 1 ? v : v - 1, top: hit.top };
      const cur = turnRef.current;
      const keep = cur && cur.base === t.base && cur.top === t.top;
      startTurn(t, keep === true ? P.current : restCorner(hit.dir, hit.top));
      mode.current = { k: 'drag', id: e.pointerId };
      P.current = constrain(p, W, H, t.top);
      paint();
      return;
    }
    vel.current = { x: 0, t: performance.now(), px: e.clientX };
    mode.current = { k: 'swipe', id: e.pointerId, x0: e.clientX, y0: e.clientY, dir: 0 };
  };

  const release = (e: RPointerEvent, cancelled: boolean) => {
    const m = mode.current;
    if ((m.k !== 'drag' && m.k !== 'swipe') || m.id !== e.pointerId) return;
    const t = turnRef.current;
    if (m.k === 'swipe' && m.dir === 0) {
      mode.current = { k: 'idle' };
      if (cancelled) return;
      const dx = e.clientX - m.x0;
      const moved = Math.hypot(dx, e.clientY - m.y0);
      if (reducedMotion) {
        // no curl: a swipe or a tap swaps the pages with a fade
        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
        const dir =
          Math.abs(dx) > 40
            ? dx < 0
              ? 1
              : -1
            : moved <= 10
              ? e.clientX > r.left + r.width / 2
                ? 1
                : -1
              : 0;
        const target = viewRef.current + dir;
        if (dir !== 0 && target >= 0 && target < views) {
          setFade(f => f + 1);
          onView(target);
        }
        return;
      }
      // a tap: right of the spine forwards, left of it back
      if (moved > 10) return;
      const p = toBook(e);
      const mid = spread ? 0 : W / 2;
      turnBy(p.x >= mid ? 1 : -1);
      return;
    }
    if (!t) {
      mode.current = { k: 'idle' };
      return;
    }
    const prog = dragProgress(P.current, W);
    const done = !cancelled && settles(prog, vel.current.x, W);
    mode.current = { k: 'anim' };
    pending.current = done ? t.base + 1 : t.base;
    const from = prog;
    const to = done ? 1 : 0;
    if (m.k === 'swipe') {
      animateTo(
        cornerAt(to, W, H, t.top),
        160 + 380 * Math.abs(to - from),
        () => finish(t),
        e2 => cornerAt(from + (to - from) * easeOut(e2), W, H, t.top),
      );
    } else {
      animateTo(restCorner(done ? -1 : 1, t.top), 160 + 380 * Math.abs(to - from), () => finish(t));
    }
  };

  // ── render ─────────────────────────────────────────────────────────
  const v = viewAt(view, pages, layout);
  const tp = turn ? turnPages(turn.base, pages, layout) : null;
  const leftN = tp ? tp.left : v.left;
  const rightN = tp ? tp.under : v.right;
  const isCover = (n: number | null) => n === 1 || n === pages;
  // stack edges: thicker on the side with more pages
  const read = view / Math.max(1, views - 1);
  const maxEdge = Math.max(3, Math.round(W * 0.022));
  const leftEdge = v.left !== null ? Math.max(2, Math.round(maxEdge * read)) : 0;
  const rightEdge = v.right !== null ? Math.max(2, Math.round(maxEdge * (1 - read))) : 0;
  const bookW = spread ? 2 * W : W;
  const spineX = spread ? W : 0;
  const pageStyle = (x: number): CSSProperties => ({
    width: W,
    height: H,
    transform: `translate3d(${x}px,0,0)`,
  });
  const showDogEars = !reducedMotion && interactive;

  return (
    <div
      className={`fb ${spread ? 'fb-spread' : 'fb-single'}`}
      style={{ width: bookW, height: H }}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={e => release(e, false)}
      onPointerCancel={e => release(e, true)}
      onPointerLeave={() => {
        if (mode.current.k === 'peek') endPeek();
      }}
    >
      <div className={`fb-book ${turn ? 'is-turning' : ''}`} ref={bookEl}>
        <div className="fb-spine" ref={spineEl} style={{ left: spineX }}>
          {/* stack edges and the shadow on the table */}
          {leftN !== null && leftEdge > 0 && (
            <div
              className="fb-edge fb-edge-l"
              style={{
                width: leftEdge,
                height: H,
                transform: `translate3d(${-W - leftEdge}px,0,0)`,
              }}
            />
          )}
          {rightN !== null && rightEdge > 0 && (
            <div
              className="fb-edge fb-edge-r"
              style={{ width: rightEdge, height: H, transform: `translate3d(${W}px,0,0)` }}
            />
          )}
          {leftN !== null && (
            <div
              className={`fb-page fb-left ${isCover(leftN) ? 'is-cover' : ''}`}
              style={pageStyle(-W)}
              key={`l${fade}`}
            >
              <Page n={leftN} src={src} alt={alt} />
              <div className="fb-gutter fb-gutter-l" />
              {showDogEars && !turn && <div className="fb-ear fb-ear-l" aria-hidden />}
            </div>
          )}
          {rightN !== null && (
            <div
              className={`fb-page fb-right ${isCover(rightN) ? 'is-cover' : ''}`}
              style={pageStyle(0)}
              key={`r${fade}`}
            >
              <Page n={rightN} src={src} alt={alt} />
              <div className="fb-gutter fb-gutter-r" />
              {showDogEars && !turn && <div className="fb-ear fb-ear-r" aria-hidden />}
              {turn && (
                <div className="fb-shade fb-shade-under" ref={underShade} style={{ height: BIG }} />
              )}
            </div>
          )}
          {turn && tp && (
            <div
              className="fb-clip"
              ref={clipEl}
              style={{ width: BIG, height: BIG, visibility: 'hidden' }}
            >
              {tp.front !== null && (
                <div
                  className={`fb-page fb-leaf ${isCover(tp.front) ? 'is-cover' : ''}`}
                  ref={frontEl}
                  style={{ width: W, height: H }}
                >
                  <Page n={tp.front} src={src} />
                  <div className="fb-gutter fb-gutter-r" />
                  <div
                    className="fb-shade fb-shade-front"
                    ref={frontShade}
                    style={{ height: BIG }}
                  />
                </div>
              )}
              <div
                className={`fb-page fb-leaf fb-back ${isCover(tp.back) ? 'is-cover' : ''}`}
                ref={backEl}
                style={{ width: W, height: H }}
              >
                {tp.back !== null ? (
                  <Page n={tp.back} src={src} />
                ) : (
                  tp.front !== null && <Page n={tp.front} src={src} className="fb-ghost" />
                )}
                {tp.back !== null && <div className="fb-gutter fb-gutter-l" />}
                <div className="fb-shade fb-shade-back" ref={backShade} style={{ height: BIG }} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
