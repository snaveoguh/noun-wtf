// The featured banner. Rotates through HERO_SLIDES (rows.ts): pre-rendered
// clips play muted on loop (with sound only if sound is on, the default, and
// the clip has a track), stills get a slow Ken Burns. Title, teaser and
// PLAY / MORE INFO sit over a gradient. Hovering lifts it a little and, with
// sound on, plays that game's stinger. Clips pause when the hero is off
// screen or the tab is hidden; reduced motion and save-data get posters.
// A slide with a `bed` (Noun Hoops) gets a court + groove under it with sound
// on (bed.ts), faded out on any change and never over the voice-over.

import type { Clip, GameId, Slide } from './rows';

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { cx } from '../osStore';

import { shouldPlayBed } from './bed';
import { audioRunning, courtBed, motif, playFile, unlockAudio, type Playback } from './sound';
import { DUCKED, shouldStartVo, shouldStopVo, stretches, syncRate } from './voiceOver';

export const GAME_ACCENT: Record<GameId, string> = {
  world: '#ffd400',
  hoops: '#ff9a1f',
  breaks: '#ff2f8e',
  warfare: '#3dff8a',
  drop: '#9fe8ff',
};

export function GameTitle({ name, accent }: { name: string; accent: string }) {
  const [first, ...rest] = name.toUpperCase().split(' ');
  return (
    <span className="nh-gtitle" data-keep-font style={{ '--acc': accent } as CSSProperties}>
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
  duck = false,
  synced = false,
  once = false,
  onEnded,
}: {
  clip: Clip;
  onPlaying?: () => void;
  playing: boolean;
  withSound: boolean;
  /** Something is talking over it: its own soundtrack drops right down. */
  duck?: boolean;
  /** The voice-over just started: restart and stretch to end with it. */
  synced?: boolean;
  /** Play through once (the carousel moves on when it ends) instead of looping. */
  once?: boolean;
  onEnded?: () => void;
  focus?: string;
  className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (v) v.volume = duck ? DUCKED : 1;
  }, [duck]);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    // While synced it plays once and holds its last frame (no loop back to
    // scenes already seen) until the carousel moves on; `once` plays it
    // through a single time, holds the last frame and lets `onEnded` move
    // the carousel on
    v.loop = !synced && !once;
    if (!synced) {
      v.playbackRate = 1;
      return;
    }
    // The voice-over can start before the clip knows its length. A clip too
    // short to stretch over it keeps looping instead of freezing.
    const sync = () => {
      v.currentTime = 0;
      v.loop = !stretches(v.duration);
      v.playbackRate = v.loop ? 1 : syncRate(v.duration);
    };
    if (Number.isFinite(v.duration)) {
      sync();
      return;
    }
    v.addEventListener('loadedmetadata', sync, { once: true });
    return () => v.removeEventListener('loadedmetadata', sync);
  }, [synced, once]);
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
      playsInline
      autoPlay
      preload="metadata"
      disablePictureInPicture
      onPlaying={onPlaying}
      onEnded={onEnded}
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
  lockedFor,
  onToggleSound,
  onPlay,
  onGo,
  onMore,
  onBrowse,
}: {
  slides: Slide[];
  active: boolean;
  sound: boolean;
  resumable: (id: GameId) => boolean;
  ctaFor: (id: GameId) => string;
  /** A game the visitor hasn't unlocked yet (PLAY then explains how). */
  lockedFor?: (id: GameId) => boolean;
  onToggleSound: () => void;
  onPlay: (id: GameId) => void;
  /** A slide that opens a page instead of a game (its `href`). */
  onGo: (href: string) => void;
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

  // The brand slide's voice-over (voiceOver.ts): once per page view, only
  // once the visitor has sound on and audio is unlocked by a gesture; it stops
  // if they mute, the slide changes or the hero goes off screen / the tab
  // hides. While it talks the carousel holds and the clip's own track ducks.
  const [voOn, setVoOn] = useState(false);
  // Sound is on by default, but browsers keep audio locked until a gesture:
  // say so next to the speaker until the first click / key unlocks it.
  const [unlocked, setUnlocked] = useState(audioRunning);
  useEffect(() => {
    if (unlocked) return;
    const on = () => void unlockAudio().then(ok => ok && setUnlocked(true));
    window.addEventListener('pointerdown', on);
    window.addEventListener('keydown', on);
    return () => {
      window.removeEventListener('pointerdown', on);
      window.removeEventListener('keydown', on);
    };
  }, [unlocked]);
  const [voTail, setVoTail] = useState(-1); // the slide whose voice-over just ended
  const voPlayed = useRef(false);
  const vo = useRef<Playback | null>(null);
  const idxRef = useRef(idx);
  idxRef.current = idx;
  const voSrc = s.vo;
  useEffect(() => {
    const state = { sound, slideHasVo: voSrc !== undefined, live };
    if (shouldStopVo(state)) {
      vo.current?.stop();
      return;
    }
    if (voSrc === undefined || !shouldStartVo({ ...state, played: voPlayed.current })) return;
    let cancelled = false;
    const go = () => {
      void unlockAudio().then(ok => {
        if (!ok || cancelled || voPlayed.current) return;
        const p = playFile(voSrc, 0.95);
        if (p === null) return;
        const at = idxRef.current;
        voPlayed.current = true;
        vo.current = p;
        setVoOn(true);
        void p.done.then(() => {
          if (vo.current !== p) return;
          vo.current = null;
          setVoOn(false);
          setVoTail(at);
        });
      });
    };
    go();
    // Sound remembered from a past visit: nothing plays until a gesture
    window.addEventListener('pointerdown', go);
    window.addEventListener('keydown', go);
    return () => {
      cancelled = true;
      window.removeEventListener('pointerdown', go);
      window.removeEventListener('keydown', go);
    };
  }, [sound, voSrc, live]);
  useEffect(() => () => vo.current?.stop(), []);

  // The slide's sound bed (bed.ts): plays while it should, any change in
  // that fades it out (the cleanup); a gesture starts it if audio is locked.
  const bedTrack = s.bed?.track;
  useEffect(() => {
    if (bedTrack === undefined || !shouldPlayBed({ sound, slideHasBed: true, live, voOn })) return;
    let cancelled = false;
    let bed: Playback | null = null;
    const go = () => {
      void unlockAudio().then(ok => {
        if (!ok || cancelled || bed !== null) return;
        bed = courtBed(bedTrack);
      });
    };
    go();
    window.addEventListener('pointerdown', go);
    window.addEventListener('keydown', go);
    return () => {
      cancelled = true;
      window.removeEventListener('pointerdown', go);
      window.removeEventListener('keydown', go);
      bed?.stop();
    };
  }, [sound, bedTrack, live, voOn]);

  // A clip slide moves on when its clip ends (one clean play-through, from
  // whenever it actually started); the timer only backs that up
  const clipDrives = s.clip !== undefined && motion;
  // The slide whose clip ended while the carousel was held (hover)
  const [endedIdx, setEndedIdx] = useState(-1);
  const next = useCallback(() => {
    setVoTail(-1);
    setEndedIdx(-1);
    setIdx(i => (i + 1) % slides.length);
  }, [slides.length]);
  useEffect(() => {
    if (!paused && !voOn && endedIdx === idx) next();
  }, [paused, voOn, endedIdx, idx, next]);
  useEffect(() => {
    if (paused || voOn) return;
    // Just finished the voice-over: a beat, then move on
    const ms = voTail === idx ? 300 : clipDrives ? s.ms + 8000 : s.ms;
    const t = window.setTimeout(next, ms);
    return () => window.clearTimeout(t);
  }, [idx, paused, voOn, voTail, next, s.ms, clipDrives]);

  const onEnter = () => {
    setHeld(true);
    const now = performance.now();
    // Clips with their own soundtrack (or a bed) speak for themselves
    if (
      sound &&
      !(s.clip?.audio === true && motion) &&
      s.bed === undefined &&
      s.game !== undefined &&
      now - lastMotif.current > 1500
    ) {
      lastMotif.current = now;
      motif(s.game);
    }
  };

  const locked = s.game !== undefined && lockedFor?.(s.game) === true;
  const ctaLabel =
    s.game === undefined
      ? (s.cta ?? 'OPEN')
      : locked
        ? 'HOW TO UNLOCK'
        : resumable(s.game)
          ? 'RESUME'
          : (s.cta ?? ctaFor(s.game));

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
                <ClipVideo
                  clip={x.clip}
                  playing={live}
                  withSound={sound}
                  duck={voOn}
                  synced={voOn}
                  once
                  onEnded={() => {
                    if (voOn) return;
                    // Hovered: hold the last frame, move on when let go
                    if (paused) setEndedIdx(idx);
                    else next();
                  }}
                  focus={x.focus}
                />
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
            <button
              type="button"
              className="nh-play"
              onClick={() => (s.game !== undefined ? onPlay(s.game) : onGo(s.href))}
            >
              <span aria-hidden>{locked ? '🔒' : '▶'}</span> {ctaLabel}
            </button>
            {s.browse === true ? (
              <button type="button" className="nh-more" onClick={onBrowse}>
                <span aria-hidden>▾</span> BROWSE EVERYTHING
              </button>
            ) : (
              s.game !== undefined && (
                <button type="button" className="nh-more" onClick={() => onMore(s.game)}>
                  <span aria-hidden>ⓘ</span> MORE INFO
                </button>
              )
            )}
          </div>
        </div>
        <div className="nh-hero-side">
          {sound && !unlocked && (
            <span className="nh-tap-hint" aria-hidden>
              click anywhere for sound
            </span>
          )}
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
