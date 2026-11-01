import { useEffect, useRef, useSyncExternalStore } from 'react';

import { YT_MIN_PX } from '@/miniapps/world2/radio/YouTubeDeck';

import { nounFm } from './NounFmStation';

const TILE = YT_MIN_PX; // YouTube's minimum embed size; it can't get smaller while a video plays

const btn =
  'flex h-5 min-w-5 items-center justify-center rounded px-1 text-[11px] leading-none text-white/80 hover:bg-white/15 hover:text-white';

/**
 * Site-wide NOUN FM: a corner widget on every page. Off → a small pill.
 * On → the YouTube tile (200×200, YouTube's minimum) with a thin control
 * strip; minimized → just the tile and a tab to bring the strip back.
 */
export default function NounFmWidget() {
  const fm = nounFm();
  const v = useSyncExternalStore(fm.subscribe, fm.getView);
  const host = useRef<HTMLDivElement>(null);
  const on = v.phase !== 'off';

  useEffect(() => {
    const el = host.current;
    if (!on || el === null) return;
    fm.deck.mount(el);
    return () => fm.deck.unmount();
  }, [fm, on]);

  if (!on) {
    return (
      <button
        type="button"
        onClick={() => fm.tuneIn()}
        className="fixed bottom-[72px] right-3 z-[9000] flex items-center gap-1.5 rounded-full border border-white/20 bg-black/85 px-3 py-1.5 text-[11px] font-bold text-[#ffd400] shadow-lg backdrop-blur hover:bg-black"
        title="NOUN FM: our jingles between deep cuts, videos and podcasts"
        data-nounfm="off"
      >
        <span aria-hidden>📻</span>
        {v.wasOn ? '▶ resume NOUN FM' : 'NOUN FM'}
      </button>
    );
  }

  const held = v.phase === 'held';
  const strip = !v.minimized || held;

  return (
    <div
      // box-content: the border sits outside the 200px, or the video slot
      // ends up 198px and YouTubeDeck refuses to play (YouTube's minimum)
      className="group fixed bottom-[72px] right-3 z-[9000] box-content flex flex-col overflow-hidden rounded-md border border-white/20 bg-black/90 text-white shadow-xl"
      style={{ width: TILE }}
      data-nounfm={v.phase}
    >
      {strip ? (
        <div className="flex h-6 items-center gap-1 px-1.5">
          <span
            className={`h-2 w-2 flex-none rounded-full ${held ? 'bg-white/40' : 'animate-pulse bg-[#ff3020]'}`}
          />
          <span className="min-w-0 flex-1 truncate text-[10px] font-bold" title={v.label}>
            {v.label}
          </span>
          <button
            type="button"
            className={btn}
            title="skip"
            onClick={() => fm.skip()}
            disabled={held}
          >
            ⏭
          </button>
          <button
            type="button"
            className={btn}
            title="minimize"
            onClick={() => fm.setMinimized(true)}
          >
            ▾
          </button>
          <button
            type="button"
            className={btn}
            title="turn NOUN FM off"
            onClick={() => fm.tuneOut()}
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="flex h-3.5 w-full items-center justify-center bg-white/10 text-[9px] leading-none text-white/70 hover:bg-white/20"
          title={`${v.label}: show controls`}
          onClick={() => fm.setMinimized(false)}
        >
          ▴
        </button>
      )}
      {/* While held (Noun World radio has the floor) no video plays, so the
          tile can fold away; it stays mounted so the track resumes in place. */}
      <div className="relative" style={{ height: held ? 0 : TILE }}>
        <div className="absolute inset-0 flex items-center justify-center text-center text-[11px] font-black italic text-[#ffd400]">
          {v.phase === 'track' || v.phase === 'blocked' ? '' : 'NOUN FM'}
        </div>
        {/* YouTube needs a visible player: it stays on the page, at 10% until
            the widget is hovered or focused (full while it needs a click to start) */}
        <div
          ref={host}
          className={`absolute inset-0 transition-opacity duration-200 group-focus-within:opacity-100 group-hover:opacity-100 ${v.phase === 'blocked' ? 'opacity-100' : 'opacity-10'}`}
          style={{ visibility: v.screen && !held ? 'visible' : 'hidden' }}
          data-nounfm-video=""
        />
      </div>
      {strip && !held && (
        <label className="flex h-5 items-center gap-1 px-1.5 text-[10px] text-white/60">
          <span aria-hidden>🔊</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={v.volume}
            onChange={e => fm.setVolume(Number(e.target.value))}
            className="h-1 flex-1 accent-[#ffd400]"
            aria-label="NOUN FM volume"
          />
        </label>
      )}
    </div>
  );
}
