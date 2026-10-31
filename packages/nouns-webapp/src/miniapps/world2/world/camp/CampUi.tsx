// ── CAMP's prompt: READ MEME VALUE at the coffee table, PLAY POOL at the table ──
//
// Same look as the interiors' door prompt. E (CampSystem's key) or a tap.

import type { Game } from '../../Game';

import { useEffect, useSyncExternalStore } from 'react';

import { HudSlot } from '../../hud/slots';

export function CampUi({ game, touch }: { game: Game; touch: boolean }) {
  const camp = game.camp;
  const view = useSyncExternalStore(camp.subscribe, () => camp.view);
  const pr = view.prompt;
  // The game's HUD stays out of the opening shot
  useEffect(() => {
    document.body.toggleAttribute('data-camp-intro', view.intro);
    return () => document.body.removeAttribute('data-camp-intro');
  }, [view.intro]);
  if (view.intro)
    return (
      <div className="pointer-events-none absolute inset-0 z-50 select-none" data-camp="intro">
        <style>{INTRO_CSS}</style>
        <div className="camp-fade absolute inset-0 bg-black" />
        <div className="camp-bar absolute inset-x-0 top-0 h-[11vh] bg-black" />
        <div className="camp-bar absolute inset-x-0 bottom-0 flex h-[11vh] items-center justify-between bg-black px-6">
          <span className="camp-title text-xl font-black italic tracking-wide text-[#ffd400] sm:text-3xl">
            NOUNS CAMP
            <span className="ml-3 text-xs font-bold not-italic tracking-widest text-white/70 sm:text-sm">
              CONDEMNED · PENTHOUSE · 150 M
            </span>
          </span>
          <span className="text-[10px] font-bold tracking-widest text-white/50 sm:text-xs">
            {touch ? 'TAP' : 'ANY KEY'} TO SKIP
          </span>
        </div>
      </div>
    );
  if (pr === null) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-30 select-none" data-camp="hud">
      <HudSlot name="toasts">
        <button
          type="button"
          data-camp="prompt"
          className="pointer-events-auto absolute left-1/2 top-[30%] -translate-x-1/2 bg-[#ffd400] px-5 py-3 text-center text-lg font-black italic text-black shadow-[6px_6px_0_#d22209]"
          onClick={() => camp.act(pr.kind)}
        >
          {pr.text} — {touch ? 'TAP' : 'E'}
          {pr.sub !== undefined && (
            <span className="block text-xs font-bold not-italic">{pr.sub}</span>
          )}
        </button>
      </HudSlot>
    </div>
  );
}

/** Fade up from black; the bars slide in; the title arrives late. */
const INTRO_CSS = `
[data-camp=intro] .camp-fade { animation: camp-fade 1.1s ease-out forwards; }
[data-camp=intro] .camp-bar { animation: camp-bar 0.9s ease-out both; }
[data-camp=intro] .camp-title { animation: camp-title 1.2s 3.2s ease-out both; }
@keyframes camp-fade { from { opacity: 1 } to { opacity: 0 } }
@keyframes camp-bar { from { transform: scaleY(0) } to { transform: scaleY(1) } }
@keyframes camp-title { from { opacity: 0; transform: translateX(-12px) } to { opacity: 1; transform: none } }
body[data-camp-intro] [data-hud], body[data-camp-intro] [data-w2hud] { visibility: hidden !important; }
@media (prefers-reduced-motion: reduce) { [data-camp=intro] * { animation: none !important } }
`;
