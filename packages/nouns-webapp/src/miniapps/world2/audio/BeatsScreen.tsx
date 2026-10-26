// NOUN BEATS' deck screen: the YouTube player for the rider's hip-hop
// station, shown (≥ 200 px, as YouTube requires) only while a track is
// loaded and the world is on screen, exactly like COMMUNITY RADIO's
// (radio/FmPanel.tsx FmScreen). Closing it turns NOUN BEATS off.

import type { Game } from '../Game';
import type { BeatsView, NounBeats } from './NounBeats';

import { useEffect, useRef, useSyncExternalStore } from 'react';

import { useFm } from '../radio/FmPanel';
import { YT_MIN_PX } from '../radio/YouTubeDeck';
import { HudDrag } from '../ui/HudDrag';

export function useBeats(b: NounBeats): BeatsView {
  return useSyncExternalStore(b.subscribe, b.getView, b.getView);
}

export function BeatsScreen({ game, touch }: { game: Game; touch: boolean }) {
  const view = useBeats(game.beats);
  // COMMUNITY RADIO's screen can be up at the same time (near the van): sit beside it
  const fmUp = useFm(game.fm).screen;
  if (!view.screen) return null;
  return <BeatsScreenInner game={game} touch={touch} label={view.label} beside={fmUp} />;
}

function BeatsScreenInner({
  game,
  touch,
  label,
  beside,
}: {
  game: Game;
  touch: boolean;
  label: string;
  beside: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const beats = game.beats;
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    beats.deck.mount(el);
    return () => beats.deck.unmount();
  }, [beats]);
  const pos = touch
    ? beside
      ? 'left-2 top-[400px]'
      : 'left-2 top-[150px]'
    : beside
      ? 'bottom-24 right-[260px]'
      : 'bottom-24 right-4';
  return (
    <HudDrag id="beats" className={`absolute z-30 ${pos}`} handle>
      <div
        className="w2-panel flex flex-col gap-1 !p-1.5"
        data-beats="screen"
        onPointerDown={e => e.stopPropagation()}
      >
        <div
          className="flex cursor-grab items-center gap-1.5 text-[10px]"
          data-w2drag
          title="drag to move · double-click to reset"
        >
          <span className="w2-fm-dot w2-fm-live" />
          <span className="max-w-[170px] truncate font-bold">NOUN BEATS: {label}</span>
          <button
            type="button"
            className="ml-auto px-1 text-sm"
            title="close: NOUN BEATS goes off"
            onClick={() => {
              game.radio.setMode('off');
              game.saveRadioMode();
            }}
          >
            ✕
          </button>
        </div>
        <div
          ref={ref}
          className="overflow-hidden rounded bg-black"
          style={{ width: Math.max(YT_MIN_PX, 220), height: Math.max(YT_MIN_PX, 220) }}
        />
      </div>
    </HudDrag>
  );
}
