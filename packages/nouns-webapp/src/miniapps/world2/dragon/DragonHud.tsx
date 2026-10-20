// ── Dragon HUD: BUY at the Roost, call button, flight readout + touch controls ─
//
// Desktop: a BUY button at the Roost door (or E), a "Z · CALL DRAGON" chip
// once you own one, and while flying a small speed / altitude readout with
// the keys. Phones: the same BUY button, a round 🐉 button to call / get
// off, and while flying ▲ CLIMB / ▼ DIVE / ⚡ BOOST on the right (the skate
// stick still turns and sets speed; the skate buttons do nothing in the air).

import type { Game } from '../Game';

import { useEffect } from 'react';

import { DRAGON_COST } from './pay';
import { useDragonUi } from './useDragon';

export function DragonHud({ game, touch }: { game: Game; touch: boolean }) {
  const ui = useDragonUi(game);
  const d = game.dragon;

  // Let go of the touch controls when the ride ends
  useEffect(() => {
    if (ui?.riding === true) return;
    d.touch.up = d.touch.down = d.touch.boost = false;
  }, [ui?.riding, d]);

  if (ui === null) return null;
  const hold = (k: 'up' | 'down' | 'boost') => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      d.touch[k] = true;
    },
    onPointerUp: () => {
      d.touch[k] = false;
    },
    onPointerCancel: () => {
      d.touch[k] = false;
    },
    onPointerLeave: () => {
      d.touch[k] = false;
    },
  });

  return (
    <>
      <style>{DRAGON_CSS}</style>
      {ui.notice !== null && (
        <div className="w2-dragon-notice pointer-events-none absolute left-1/2 top-[22%] -translate-x-1/2">
          {ui.notice}
        </div>
      )}
      {ui.atShop && (
        <button
          type="button"
          data-dragon="buy"
          className="w2-dragon-buy pointer-events-auto absolute left-1/2 top-[34%] -translate-x-1/2"
          onClick={() => d.requestBuy()}
        >
          🐉 BUY A DRAGON · {DRAGON_COST} 🪙 <span>{touch ? 'TAP' : 'E'}</span>
          {ui.coin !== null && <em>you have {ui.coin}</em>}
        </button>
      )}
      {ui.owned && !ui.riding && !touch && (
        <div className="w2-dragon-chip pointer-events-none absolute">Z · CALL DRAGON</div>
      )}
      {ui.owned && touch && (
        <button
          type="button"
          data-dragon="call"
          className="w2-dragon-call pointer-events-auto absolute"
          onClick={() => d.requestCall()}
        >
          {ui.riding ? 'OFF' : '🐉'}
        </button>
      )}
      {ui.riding && (
        <div className="w2-dragon-readout pointer-events-none absolute left-1/2 -translate-x-1/2">
          <b>{ui.kmh}</b>
          <span>KM/H</span>
          <b>{ui.alt}</b>
          <span>M UP</span>
          {!touch && <i>A/D TURN · W/S SPEED · SPACE CLIMB · Q DIVE · SHIFT BOOST · E GET OFF</i>}
        </div>
      )}
      {ui.riding && touch && (
        <div className="w2-dragon-pad pointer-events-auto absolute">
          <button type="button" {...hold('up')}>
            ▲<small>CLIMB</small>
          </button>
          <button type="button" {...hold('down')}>
            ▼<small>DIVE</small>
          </button>
          <button type="button" {...hold('boost')}>
            ⚡<small>BOOST</small>
          </button>
        </div>
      )}
    </>
  );
}

const DRAGON_CSS = `
.w2-dragon-buy{background:#4bea69;color:#111;padding:12px 20px;font-size:18px;font-weight:900;font-style:italic;box-shadow:6px 6px 0 #9f59ff;white-space:nowrap;display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:center;max-width:calc(100vw - 32px)}
.w2-dragon-buy span{padding:2px 7px;background:#111;color:#4bea69;font-style:normal;font-size:13px}
.w2-dragon-buy em{font-size:12px;font-style:normal;font-weight:700;opacity:.75;width:100%;text-align:center}
.w2-dragon-notice{background:rgba(17,16,24,.85);color:#4bea69;padding:8px 14px;border-radius:10px;font:900 15px system-ui,sans-serif;letter-spacing:.04em;white-space:nowrap}
.w2-dragon-chip{right:calc(16px + env(safe-area-inset-right));bottom:calc(16px + env(safe-area-inset-bottom));background:rgba(17,16,24,.7);color:#4bea69;padding:5px 9px;border-radius:7px;font:800 11px system-ui,sans-serif;letter-spacing:.08em}
.w2-dragon-call{right:calc(14px + env(safe-area-inset-right));top:calc(38% + env(safe-area-inset-top));width:54px;height:54px;border-radius:50%;background:#4bea69;color:#111;font:900 20px system-ui,sans-serif;border:3px solid #111;box-shadow:3px 3px 0 #9f59ff}
.w2-dragon-readout{bottom:calc(82px + env(safe-area-inset-bottom));display:flex;align-items:baseline;gap:6px;padding:6px 14px;border-radius:14px;background:rgba(10,12,20,.55);color:#fff;font-family:system-ui,sans-serif;flex-wrap:wrap;justify-content:center;max-width:calc(100vw - 32px)}
.w2-dragon-readout b{font-size:30px;font-weight:900;font-style:italic;font-variant-numeric:tabular-nums}
.w2-dragon-readout span{font-size:11px;font-weight:700;letter-spacing:.12em;opacity:.7;margin-right:8px}
.w2-dragon-readout i{width:100%;text-align:center;font-style:normal;font-size:10px;letter-spacing:.06em;opacity:.65}
.w2-dragon-pad{right:calc(14px + env(safe-area-inset-right));top:calc(46% + env(safe-area-inset-top));display:flex;flex-direction:column;gap:10px}
.w2-dragon-pad button{width:64px;height:58px;border-radius:14px;background:rgba(17,16,24,.6);color:#fff;border:2px solid rgba(255,255,255,.35);font:900 20px system-ui,sans-serif;display:flex;flex-direction:column;align-items:center;justify-content:center;touch-action:none;user-select:none;-webkit-user-select:none}
.w2-dragon-pad small{font-size:9px;letter-spacing:.08em;opacity:.8}
`;
