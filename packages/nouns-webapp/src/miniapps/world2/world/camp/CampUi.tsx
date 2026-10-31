// ── CAMP's prompt: READ MEME VALUE at the coffee table, PLAY POOL at the table ──
//
// Same look as the interiors' door prompt. E (CampSystem's key) or a tap.

import type { Game } from '../../Game';

import { useSyncExternalStore } from 'react';

import { HudSlot } from '../../hud/slots';

export function CampUi({ game, touch }: { game: Game; touch: boolean }) {
  const camp = game.camp;
  const view = useSyncExternalStore(camp.subscribe, () => camp.view);
  const pr = view.prompt;
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
