// ── Noun World's loader: the noun.wtf wordmark, one shimmer, then the game ──
//
// The site header's wordmark (components/NounOS/home/wordmark.ts, same ink,
// same band) centred on dark. Its one shimmer pass IS the progress: the band
// crosses as the level loads and the graffiti's arrival load fetches walls
// (worldLoad.ts), and only finishes once every piece is on the walls (or the
// graffiti store stops answering). Then it hands over to CREATE YOUR RIDER.
// Reduced motion: no shimmer, just the wordmark.

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

import { loadTarget, stepShimmer, worldLoaded, type WorldLoadState } from './worldLoad';

/** The fade into the character select. */
const FADE_MS = 280;

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function WorldLoader({ game, onDone }: { game: Game | null; onDone: () => void }) {
  const markRef = useRef<HTMLSpanElement>(null);
  const gameRef = useRef(game);
  gameRef.current = game;
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const [leaving, setLeaving] = useState(false);
  const [still] = useState(reducedMotion);

  useEffect(() => {
    const t0 = performance.now();
    let levelAt: number | null = null;
    let lastWallAt = 0;
    let lastDone = -1;
    let arrived = false;
    let watched: Game['graffiti'] = null;
    let shown = 0;
    let last = t0;
    let raf = 0;
    let handOver: ReturnType<typeof setTimeout> | undefined;
    let finished = false;
    const frame = (now: number) => {
      const g = gameRef.current;
      const levelReady = g !== null && g.hud.loading === null && g.graffiti !== null;
      if (levelReady && levelAt === null) levelAt = now;
      const gr = g?.graffiti ?? null;
      if (gr !== null && gr !== watched) {
        watched = gr;
        void gr.arrived.then(() => {
          if (watched === gr) arrived = true;
        });
      }
      const progress = gr?.loadProgress ?? null;
      const done = progress === null ? -1 : progress.done + (progress.total === null ? 0 : 1e6);
      if (done !== lastDone) {
        lastDone = done;
        lastWallAt = now;
      }
      const s: WorldLoadState = {
        levelReady,
        graffiti: progress,
        graffitiArrived: arrived,
        elapsedMs: now - t0,
        sinceLevelMs: levelAt === null ? 0 : now - levelAt,
        stalledMs: levelAt === null ? 0 : now - Math.max(levelAt, lastWallAt),
      };
      const loaded = worldLoaded(s);
      shown = still ? (loaded ? 1 : 0) : stepShimmer(shown, loadTarget(s), now - last, loaded);
      last = now;
      const el = markRef.current;
      if (el !== null && !still) el.style.backgroundPosition = `${(1 - shown) * 100}% 0`;
      if (loaded && shown >= 1 && !finished) {
        finished = true;
        if (import.meta.env.DEV)
          console.info(
            '[world] loaded in',
            Math.round(now - t0),
            'ms; graffiti',
            arrived ? 'all in' : 'stalled / capped, going anyway',
            s.graffiti,
          );
        setLeaving(true);
        handOver = setTimeout(() => doneRef.current(), still ? 0 : FADE_MS);
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(handOver);
    };
  }, [still]);

  return (
    <div
      className="w2-loader absolute inset-0 z-[60] flex items-center justify-center"
      data-w2loader={leaving ? 'leaving' : 'loading'}
      role="status"
      aria-label="loading Noun World"
      style={{ opacity: leaving && !still ? 0 : 1 }}
    >
      <span ref={markRef} className="w2-loader-mark" data-keep-font>
        {WORDMARK_TEXT}
      </span>
    </div>
  );
}

export const LOADER_CSS = `
.w2-loader{background:#07070a;transition:opacity ${FADE_MS}ms ease}
.w2-loader .w2-loader-mark,.w2-loader .w2-loader-mark *{font-family:${WORDMARK_FONT} !important;text-transform:uppercase !important}
.w2-loader-mark{font-size:clamp(30px,7vw,72px);line-height:1;letter-spacing:${WORDMARK_TRACKING};color:${WORDMARK_INK};font-weight:400;font-style:normal;
  background:${WORDMARK_SHIMMER} 100% 0/${WORDMARK_SHIMMER_SIZE} no-repeat;-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
@media (prefers-reduced-motion:reduce){.w2-loader-mark{background:none;-webkit-text-fill-color:#9b998f;color:#9b998f}}
`;
