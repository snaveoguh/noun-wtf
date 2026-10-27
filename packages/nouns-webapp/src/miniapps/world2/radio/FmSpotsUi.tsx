// ── NOUN FM spots on screen: the skip chip, the DJ's subtitles, ♪ toasts ──

import { useEffect, useSyncExternalStore } from 'react';

import { HudSlot } from '../hud/slots';

import { type FmSpots } from './FmSpots';

export function useSpots(spots: FmSpots) {
  return useSyncExternalStore(spots.subscribe, spots.getView);
}

export function FmSpotsUi({ spots }: { spots: FmSpots }) {
  const v = useSpots(spots);
  // Any key moves past a jingle / the DJ; the song keeps
  // playing unless you hit the chip.
  useEffect(() => {
    if (v.stage !== 'jingle' && v.stage !== 'dj') return;
    const skip = (e: Event) => {
      if ((e.target as HTMLElement | null)?.closest?.('[data-fm-spot]')) return;
      spots.skip();
    };
    window.addEventListener('keydown', skip);
    return () => window.removeEventListener('keydown', skip);
  }, [spots, v.stage]);
  if (v.stage === null) return null;
  const song = v.stage === 'song' || v.stage === 'town';
  return (
    <>
      {song && (
        <HudSlot name="toasts">
          <div
            key={v.at}
            data-w2hud="toasts"
            className="w2-nowplaying pointer-events-none absolute left-1/2 top-16 -translate-x-1/2"
          >
            <span>{v.stage === 'town' ? '🌵 DRY GULCH' : '📻 COMMUNITY RADIO'}</span>
            <b>{v.title}</b>
          </div>
        </HudSlot>
      )}
      {v.subtitle !== null && (
        <div
          className="pointer-events-none absolute bottom-28 left-1/2 z-30 w-[min(560px,calc(100vw-32px))] -translate-x-1/2 rounded-lg bg-black/70 px-4 py-2 text-center text-[13px] leading-snug text-white shadow-lg"
          data-fm-spot="subtitle"
        >
          <div className="mb-0.5 text-[10px] font-bold tracking-[0.2em] text-[#ffd400]">
            🎙 COMMUNITY RADIO · DJ UPDATE
          </div>
          {v.subtitle}
        </div>
      )}
      {(v.intro || v.stage === 'dj') && (
        <div className="pointer-events-auto absolute bottom-16 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2">
          <span className="rounded-full bg-black/60 px-3 py-1 text-[11px] text-white/80">
            📻 {v.stage === 'jingle' ? v.title : v.stage === 'dj' ? 'DJ update' : v.title}
          </span>
          <button
            type="button"
            data-fm-spot="skip"
            className="rounded-full bg-[#ffd400] px-3 py-1 text-[11px] font-black text-black"
            onPointerDown={e => e.stopPropagation()}
            onClick={() => spots.skipAll()}
          >
            {v.intro ? 'skip intro ⏭' : 'skip ⏭'}
          </button>
        </div>
      )}
    </>
  );
}
