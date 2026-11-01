// ── The mural bench's UI: SIT, and the letterbox while you're sat ────────
//
// The prompt has the interiors' / CAMP's look (E or a tap). Sat: letterbox
// bars, a caption, how to get up (a STAND UP button on touch screens), and
// the game's HUD and the site tray fade out (body[data-bench-shot], like CAMP's intro).

import type { Game } from '../../Game';

import { useEffect, useSyncExternalStore } from 'react';

import { HudSlot } from '../../hud/slots';

export function BenchUi({ game, touch }: { game: Game; touch: boolean }) {
  const b = game.bench;
  const view = useSyncExternalStore(b.subscribe, () => b.view);
  // SIT wins the top-centre spot (the bench's back would otherwise offer MURAL there too)
  const offered = view.prompt && !view.seated;
  useEffect(() => {
    document.body.toggleAttribute('data-bench-prompt', offered);
    return () => document.body.removeAttribute('data-bench-prompt');
  }, [offered]);
  if (view.seated)
    return (
      <div className="pointer-events-none absolute inset-0 z-50 select-none" data-bench="shot">
        <style>{SHOT_CSS}</style>
        <div className="bench-bar absolute inset-x-0 top-0 h-[9vh] bg-black" />
        <div className="bench-bar absolute inset-x-0 bottom-0 flex h-[9vh] min-h-[52px] items-center justify-between gap-3 bg-black px-4 sm:px-6">
          <span className="bench-title text-base font-black italic tracking-wide text-[#ffd400] sm:text-2xl">
            THE MURAL
            <span className="ml-2 text-[10px] font-bold not-italic tracking-widest text-white/70 sm:ml-3 sm:text-xs">
              PIPE&apos;S BENCH · 60R90
            </span>
          </span>
          {touch ? (
            <button
              type="button"
              data-bench="stand"
              className="pointer-events-auto shrink-0 bg-[#ffd400] px-4 py-2 text-sm font-black italic text-black shadow-[4px_4px_0_#d22209]"
              onClick={() => b.act()}
            >
              STAND UP
            </button>
          ) : (
            <span className="text-[10px] font-bold tracking-widest text-white/50 sm:text-xs">
              MOVE · E · ESC TO STAND
            </span>
          )}
        </div>
      </div>
    );
  if (!view.prompt) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-30 select-none" data-bench="hud">
      <style>{PROMPT_CSS}</style>
      <HudSlot name="toasts">
        <button
          type="button"
          data-bench="prompt"
          className="pointer-events-auto absolute left-1/2 top-[30%] -translate-x-1/2 bg-[#ffd400] px-5 py-3 text-center text-lg font-black italic text-black shadow-[6px_6px_0_#d22209]"
          onClick={() => b.act()}
        >
          SIT — {touch ? 'TAP' : 'E'}
          <span className="block text-xs font-bold not-italic">WATCH THE MURAL WITH PIPE</span>
        </button>
      </HudSlot>
    </div>
  );
}

const PROMPT_CSS = `body[data-bench-prompt] .mu-enter { display: none !important; }`;

/** Bars slide in, the caption arrives late, the game's HUD fades out. */
const SHOT_CSS = `
[data-bench=shot] .bench-bar { animation: bench-bar 1.1s ease-out both; }
[data-bench=shot] .bench-title { animation: bench-title 1.2s 1.6s ease-out both; }
@keyframes bench-bar { from { transform: scaleY(0) } to { transform: scaleY(1) } }
@keyframes bench-title { from { opacity: 0; transform: translateX(-12px) } to { opacity: 1; transform: none } }
body[data-bench-shot] [data-hud], body[data-bench-shot] [data-w2hud], body[data-bench-shot] .mu-enter,
body[data-bench-shot] .nos-tray {
  opacity: 0 !important; pointer-events: none !important; transition: opacity 0.6s ease-out;
}
@media (prefers-reduced-motion: reduce) { [data-bench=shot] * { animation: none !important } }
`;
