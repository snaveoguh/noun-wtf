// ── Noun World's loader: the noun.wtf wordmark, shimmering, then the game ──
//
// The site header's wordmark (components/NounOS/home/wordmark.ts, same ink,
// same band), small and centred on dark. The shimmer loops at a steady speed
// (a band crawling with the load read as stuck), and the letters flick
// between Pip3's five versions of each, one letter at a time. It hands over
// to CREATE YOUR RIDER once the level is in and the graffiti round the rider
// is painted (worldLoad.ts); the far walls finish behind the select.
// Reduced motion: no shimmer, no flicking, just the wordmark. `?loader=hold`
// keeps it on screen.

import type { Game } from '../Game';

import { useEffect, useRef, useState } from 'react';

import {
  WORDMARK_FONT,
  WORDMARK_INK,
  WORDMARK_SHIMMER,
  WORDMARK_SHIMMER_SIZE,
  WORDMARK_TEXT,
  WORDMARK_TRACKING,
} from '@/components/NounOS/home/wordmark';

import { flickVariants, NEAR_WALLS_M, worldLoaded } from './worldLoad';

/**
 * The hand-over, in three steps so nothing pops (it used to fade the whole
 * screen in 280 ms and mount the select after, which read as a glitch and
 * a blink): the wordmark fades out to black, the select mounts and draws
 * behind the black, then the black fades away.
 */
export const DIM_MS = 380;
/** The black holds at least this long once the select is mounted (it builds a rider). */
export const BLACK_MS = 220;
export const REVEAL_MS = 650;
/** One letter pops to another of its Pip3 versions this often (ms). */
const FLICK_MS = 140;
/** One shimmer pass (ms). */
const SWEEP_MS = 1400;
/** Each letter's sweep starts this much after the one before (the band crosses the word). */
const STAGGER_MS = 70;

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * CSS for one of Pip3's five versions of a letter: its `rand` feature lists
 * [base, alt1..alt4], and a value picks by position. The base is the feature
 * off (a bare "rand" / "rand" 1 can mean "pick at random").
 */
function pip3Version(v: number): string {
  return v <= 1 ? 'normal' : `"rand" ${v}`;
}

type Stage = 'loading' | 'dimming' | 'black' | 'revealing';

export function WorldLoader({
  game,
  onDone,
  onGone,
}: {
  game: Game | null;
  /** The world's ready: mount what comes next (behind the black). */
  onDone: () => void;
  /** The black has faded away: unmount the loader. */
  onGone?: () => void;
}) {
  const gameRef = useRef(game);
  gameRef.current = game;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const goneRef = useRef(onGone);
  goneRef.current = onGone;
  const [stage, setStage] = useState<Stage>('loading');
  const leaving = stage !== 'loading';
  const [still] = useState(reducedMotion);
  // Pip3 drawing per letter (its `rand` feature, 1–5)
  const [variants, setVariants] = useState(() => [...WORDMARK_TEXT].map(() => 1));
  useEffect(() => {
    if (still || leaving) return;
    const id = setInterval(() => setVariants(v => flickVariants(v, Math.random, 1)), FLICK_MS);
    return () => clearInterval(id);
  }, [still, leaving]);

  useEffect(() => {
    // ?loader=hold keeps it up (for looking at it)
    const hold = new URLSearchParams(window.location.search).get('loader') === 'hold';
    const t0 = performance.now();
    let levelAt: number | null = null;
    let lastWallAt = 0;
    let lastDone = -1;
    let raf = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const after = (ms: number, fn: () => void) => timers.push(setTimeout(fn, ms));
    const frame = (now: number) => {
      const g = gameRef.current;
      const gr = g?.graffiti ?? null;
      const levelReady = g !== null && g.hud.loading === null && gr !== null;
      if (levelReady && levelAt === null) levelAt = now;
      const done = gr?.loadProgress.done ?? -1;
      if (done !== lastDone) {
        lastDone = done;
        lastWallAt = now;
      }
      const ready = worldLoaded({
        levelReady,
        nearWallsUp: g !== null && gr !== null && gr.loadedAround(g.player.pos, NEAR_WALLS_M),
        sinceLevelMs: levelAt === null ? 0 : now - levelAt,
        stalledMs: levelAt === null ? 0 : now - Math.max(levelAt, lastWallAt),
      });
      if (ready && !hold) {
        if (import.meta.env.DEV)
          console.info('[world] loaded in', Math.round(now - t0), 'ms; walls', gr?.loadProgress);
        // Wordmark out → (black) mount the select, let it draw → black out
        setStage('dimming');
        after(still ? 0 : DIM_MS, () => {
          setStage('black');
          doneRef.current();
          // two frames for the select to mount and the canvas to draw it
          raf = requestAnimationFrame(() =>
            requestAnimationFrame(() =>
              after(still ? 0 : BLACK_MS, () => {
                setStage('revealing');
                after(still ? 0 : REVEAL_MS, () => goneRef.current?.());
              }),
            ),
          );
        });
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      timers.forEach(clearTimeout);
    };
  }, [still]);

  return (
    <div
      className="w2-loader absolute inset-0 z-[60] flex items-center justify-center"
      data-w2loader={leaving ? 'leaving' : 'loading'}
      role="status"
      aria-label="loading Noun World"
      style={{
        opacity: stage === 'revealing' ? 0 : 1,
        transitionDuration: `${still ? 0 : REVEAL_MS}ms`,
        // the select underneath takes clicks as soon as it shows
        pointerEvents: stage === 'revealing' ? 'none' : undefined,
      }}
    >
      <span
        className="w2-loader-mark"
        data-keep-font
        style={{ opacity: leaving ? 0 : 1, transitionDuration: `${still ? 0 : DIM_MS}ms` }}
      >
        {[...WORDMARK_TEXT].map((ch, i) => {
          const v = variants[i] ?? 1;
          // Keyed by version: a changed letter remounts, which replays its pop
          // Each letter carries its own sweep (a pop's transform would drop it
          // from a word-wide clip), staggered and in phase with the clock so
          // a remounted letter picks the sweep up where it was
          const delay = i * STAGGER_MS - (performance.now() % SWEEP_MS);
          return (
            <span
              key={`${i}:${v}`}
              style={{
                fontFeatureSettings: pip3Version(v),
                animationDelay: `${Math.round(delay)}ms, 0ms`,
              }}
            >
              {ch}
            </span>
          );
        })}
      </span>
    </div>
  );
}

export const LOADER_CSS = `
.w2-loader{background:#07070a;transition:opacity ${REVEAL_MS}ms ease}
.w2-loader-mark{transition:opacity ${DIM_MS}ms ease}
.w2-loader .w2-loader-mark,.w2-loader .w2-loader-mark *{font-family:${WORDMARK_FONT} !important;text-transform:uppercase !important}
.w2-loader-mark{font-size:clamp(13px,1.3vw,18px);line-height:1;letter-spacing:${WORDMARK_TRACKING};color:${WORDMARK_INK};font-weight:400;font-style:normal}
.w2-loader-mark span{display:inline-block;
  background:${WORDMARK_SHIMMER} 100% 0/${WORDMARK_SHIMMER_SIZE} no-repeat;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;
  animation:w2-loader-sweep ${SWEEP_MS}ms linear infinite,w2-loader-pop 180ms ease-out}
@keyframes w2-loader-pop{from{transform:scale(1.35)}to{transform:scale(1)}}
@keyframes w2-loader-sweep{from{background-position:100% 0}to{background-position:0 0}}
@media (prefers-reduced-motion:reduce){.w2-loader-mark span{animation:none;background:none;-webkit-text-fill-color:#9b998f;color:#9b998f}}
`;
