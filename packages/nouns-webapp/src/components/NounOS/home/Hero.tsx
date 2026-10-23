// The featured banner. Rotates through HERO_SLIDES (rows.ts): pre-rendered
// clips play muted on loop (with sound only if the visitor turned it on and
// the clip has a track), stills get a slow Ken Burns. Title, teaser and
// PLAY / MORE INFO sit over a gradient. Hovering lifts it a little and, with
// sound on, plays that game's stinger. Clips pause when the hero is off
// screen or the tab is hidden; reduced motion and save-data get posters.

import type { Clip, GameId, Slide } from './rows';

import type { CSSProperties } from 'react';
import { useEffect, useRef, useState } from 'react';

import { cx } from '../osStore';

import { motif } from './sound';

export const GAME_ACCENT: Record<GameId, string> = {
  world: '#ffd400',
  hoops: '#ff9a1f',
  warfare: '#3dff8a',
};

export function GameTitle({ name, accent }: { name: string; accent: string }) {
  const [first, ...rest] = name.toUpperCase().split(' ');
  return (
    <span className="nh-gtitle" style={{ '--acc': accent } as CSSProperties}>
      <span>{first}</span>
      <span className="is-acc">{rest.join(' ')}</span>
    </span>
  );
}

/** Whether moving footage is welcome here (not for reduced motion or save-data). */
export function motionOk(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return false;
  const conn = (
    navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }
  ).connection;
  if (conn?.saveData === true) return false;
  if (conn?.effectiveType === '2g' || conn?.effectiveType === 'slow-2g') return false;
  return true;
}

/** A looping muted clip that only plays while `playing`. */
export function ClipVideo({
  clip,
  playing,
  withSound,
  focus,
  className,
  onPlaying,
}: {
  clip: Clip;
  onPlaying?: () => void;
  playing: boolean;
  withSound: boolean;
  focus?: string;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = !(withSound && clip.audio === true);
    if (playing) {
      v.play().catch(() => {
        // Autoplay with sound refused: fall back to muted
        v.muted = true;
        v.play().catch(() => undefined);
      });
    } else v.pause();
  }, [playing, withSound, clip.audio]);
  return (
    <video
      ref={ref}
      className={className}
      poster={clip.poster}
      muted
      loop
      playsInline
      autoPlay
      preload="metadata"
      disablePictureInPicture
      onPlaying={onPlaying}
      style={{ objectPosition: focus }}
      aria-hidden
    >
      <source src={clip.webm} type="video/webm" />
      <source src={clip.mp4} type="video/mp4" />
    </video>
  );
}

export default function Hero({
  slides,
  active,
  sound,
  resumable,
  ctaFor,
  onToggleSound,
  onPlay,
  onMore,
  onBrowse,
}: {
  slides: Slide[];
  active: boolean;
  sound: boolean;
  resumable: (id: GameId) => boolean;
  ctaFor: (id: GameId) => string;
  onToggleSound: () => void;
  onPlay: (id: GameId) => void;
  onMore: (id: GameId) => void;
  onBrowse: () => void;
}) {
  const [idx, setIdx] = useState(0);
  const [held, setHeld] = useState(false);
  const [onScreen, setOnScreen] = useState(true);
  const [tabVisible, setTabVisible] = useState(
    () => typeof document === 'undefined' || !document.hidden,
  );
  const [motion] = useState(motionOk);
  const frame = useRef<HTMLDivElement>(null);
  const lastMotif = useRef(0);
  const s = slides[idx]!;
  const live = active && onScreen && tabVisible;
  const paused = held || !live;

  useEffect(() => {
    const el = frame.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setOnScreen((e?.intersectionRatio ?? 0) > 0.2), {
      threshold: [0, 0.2, 0.5],
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    const on = () => setTabVisible(!document.hidden);
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);

  useEffect(() => {
    if (paused) return;
    const t = window.setTimeout(() => setIdx(i => (i + 1) % slides.length), s.ms);
    return () => window.clearTimeout(t);
  }, [idx, paused, slides.length, s.ms]);

  const onEnter = () => {
    setHeld(true);
    const now = performance.now();
    // Clips with their own soundtrack speak for themselves
    if (sound && !(s.clip?.audio === true && motion) && now - lastMotif.current > 1500) {
      lastMotif.current = now;
      motif(s.game);
    }
  };

  return (
    <section
      className={cx('nh-hero', paused && 'is-paused')}
      aria-roledescription="carousel"
      aria-label="Featured"
      onPointerEnter={onEnter}
      onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={e => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setHeld(false);
      }}
      style={{ '--acc': s.accent } as CSSProperties}
    >
      <div ref={frame} className="nh-hero-frame">
        {slides.map((x, i) => {
          const on = i === idx;
          return (
            <div
              key={x.key}
              className={cx('nh-hero-slide', on && 'is-on', x.clip !== undefined && 'is-clip')}
              aria-hidden={!on}
            >
              {x.clip && motion && on ? (
                <ClipVideo clip={x.clip} playing={live} withSound={sound} focus={x.focus} />
              ) : (
                <img
                  key={on ? `on-${idx}` : 'off'}
                  src={x.clip ? x.clip.poster : x.still}
                  alt=""
                  draggable={false}
                  style={{ objectPosition: x.focus }}
                  loading={i === 0 ? 'eager' : 'lazy'}
                />
              )}
            </div>
          );
        })}
        <i className="nh-hero-shade" />
        <div className="nh-hero-copy" key={s.key}>
          <span className="nh-eyebrow">
            <b>⌐◨-◨</b> {s.eyebrow}
          </span>
          <h1>
            <GameTitle name={s.title} accent={s.accent} />
          </h1>
          <span className="nh-strapline">{s.tagline}</span>
          <p>{s.teaser}</p>
          <div className="nh-hero-cta">
            <button type="button" className="nh-play" onClick={() => onPlay(s.game)}>
              <span aria-hidden>▶</span> {resumable(s.game) ? 'RESUME' : (s.cta ?? ctaFor(s.game))}
            </button>
            {s.browse === true ? (
              <button type="button" className="nh-more" onClick={onBrowse}>
                <span aria-hidden>▾</span> BROWSE EVERYTHING
              </button>
            ) : (
              <button type="button" className="nh-more" onClick={() => onMore(s.game)}>
                <span aria-hidden>ⓘ</span> MORE INFO
              </button>
            )}
          </div>
        </div>
        <div className="nh-hero-side">
          <button
            type="button"
            className={cx('nh-sound', sound && 'is-on')}
            onClick={onToggleSound}
            aria-pressed={sound}
            aria-label={sound ? 'Turn sound off' : 'Turn sound on'}
            title={sound ? 'sound on' : 'sound off'}
          >
            {sound ? (
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
                <path
                  d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"
                  stroke="currentColor"
                  strokeWidth="2"
                  fill="none"
                  strokeLinecap="round"
                />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor" />
                <path
                  d="M16.5 9.5l5 5m0-5l-5 5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            )}
          </button>
        </div>
        <div className="nh-pips" role="tablist" aria-label="Choose what's featured">
          {slides.map((x, i) => (
            <button
              key={x.key}
              type="button"
              role="tab"
              aria-selected={i === idx}
              className={i === idx ? 'is-on' : undefined}
              onClick={() => setIdx(i)}
              aria-label={x.title}
            >
              <i key={paused ? 'held' : `run-${idx}`} style={{ animationDuration: `${x.ms}ms` }} />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
