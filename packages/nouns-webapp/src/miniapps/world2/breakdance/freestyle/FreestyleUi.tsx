// ── Freestyle HUD: the 🕺 button, the move readout, a key card, the pad ──
//
// Desktop: a ", FREESTYLE" chip (click or press comma); while dancing a
// strip low in the middle with the move, the beat, the keys you've typed,
// "nice!" on clean hits, a few move patterns and the loop toggle. Phones: a
// round 🕺 button on the right (STOP while dancing) and the battle's pad
// (four directions + A / B) over the skate buttons; the stick walks off.

import type { Game } from '../../Game';
import type { BreakKey, MoveId } from '../contract';
import type { FreestyleMode, FreestyleUiState } from './FreestyleMode';

import { useEffect, useState, useSyncExternalStore } from 'react';

import { MOVES } from '../sim/moves';

import { FREESTYLE_LABEL } from './FreestyleMode';

const ARROW: Record<BreakKey, string> = {
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
  a: 'A',
  b: 'B',
};

/** The key card: a few moves worth knowing. */
const CARD: readonly MoveId[] = [
  'windmill',
  'headspin',
  'flare',
  'six_step',
  'baby_freeze',
  'airchair',
  'drop',
  'get_up',
];

const patternText = (m: MoveId) => MOVES[m].pattern.map(k => ARROW[k]).join('');

function useFreestyle(f: FreestyleMode): FreestyleUiState {
  return useSyncExternalStore(
    fn => f.subscribe(fn),
    () => f.ui,
    () => f.ui,
  );
}

/** Re-render while a timed bit (flash, toast) is showing. */
function useNow(on: boolean, ms = 200) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => set(n => n + 1), ms);
    return () => clearInterval(t);
  }, [on, ms]);
  return performance.now();
}

export function FreestyleUi({ game, touch }: { game: Game; touch: boolean }) {
  const f = game.freestyle;
  const ui = useFreestyle(f);
  // Can it start here? (polled: it depends on half the game)
  const [can, setCan] = useState(false);
  useEffect(() => {
    if (ui.on) return;
    const tick = () => setCan(f.blocked() === null);
    const first = setTimeout(tick, 0);
    const t = setInterval(tick, 400);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, [f, ui.on]);
  const timed =
    (ui.flash !== null && performance.now() - ui.flash.at < 1400) ||
    (ui.toast !== null && performance.now() - ui.toast.at < 2200);
  const now = useNow(timed);
  const flash = ui.flash !== null && now - ui.flash.at < 1300 ? ui.flash.text : null;
  const toast = ui.toast !== null && now - ui.toast.at < 2000 ? ui.toast.text : null;

  return (
    <>
      <style>{FS_CSS}</style>
      {toast !== null && !ui.on && (
        <div className="fs-toast pointer-events-none absolute left-1/2 -translate-x-1/2">
          {toast}
        </div>
      )}
      {!touch && !ui.on && can && (
        <button
          type="button"
          data-freestyle="start"
          className="fs-chip pointer-events-auto absolute"
          onClick={() => f.start()}
        >
          <b>{FREESTYLE_LABEL}</b> 🕺 FREESTYLE
        </button>
      )}
      {touch && (ui.on || can) && (
        <button
          type="button"
          data-freestyle="toggle"
          className={`fs-round pointer-events-auto absolute ${ui.on ? 'fs-stop' : ''}`}
          onClick={() => f.toggle()}
        >
          {ui.on ? 'STOP' : '🕺'}
        </button>
      )}
      {ui.on && (
        <div
          data-freestyle="hud"
          className="fs-hud pointer-events-none absolute left-1/2 -translate-x-1/2"
        >
          <div className="fs-top">
            <span className="fs-tag">FREESTYLE</span>
            <span className="fs-bpm">
              {ui.bpm} BPM{ui.from === 'radio' ? ' · ON THE RADIO' : ''}
            </span>
            <button
              type="button"
              className="fs-loop pointer-events-auto"
              title={ui.music ? 'the radio is on, so the loop sits out' : 'a quiet break loop'}
              onClick={() => f.setLoop(!ui.loop)}
            >
              {ui.loop ? '🥁 LOOP ON' : '🥁 LOOP OFF'}
            </button>
          </div>
          <div className="fs-move">
            {ui.move ?? '…'}
            {ui.keyed && <em>yours</em>}
          </div>
          <div className="fs-keys">
            {ui.pending.length > 0 && <i>{ui.pending.map(k => ARROW[k]).join(' ')}</i>}
            {flash !== null && <b>{flash}</b>}
          </div>
          {!touch && (
            <>
              <div className="fs-card">
                {CARD.map(m => (
                  <span key={m}>
                    <b>{patternText(m)}</b> {MOVES[m].name}
                  </span>
                ))}
              </div>
              <div className="fs-help">
                ARROWS / WASD · A = J or SPACE · B = K · HOLD A DIRECTION, {FREESTYLE_LABEL} OR ESC
                TO STOP
              </div>
            </>
          )}
        </div>
      )}
      {ui.on && touch && <FreestylePad f={f} />}
    </>
  );
}

const PAD: [BreakKey, string][] = [
  ['left', 'fs-l'],
  ['up', 'fs-u'],
  ['down', 'fs-d'],
  ['right', 'fs-r'],
  ['a', 'fs-a'],
  ['b', 'fs-b'],
];

function FreestylePad({ f }: { f: FreestyleMode }) {
  const [hot, setHot] = useState<BreakKey | null>(null);
  return (
    <div data-freestyle="pad" className="fs-pad pointer-events-auto absolute">
      {PAD.map(([k, cls]) => (
        <button
          key={k}
          type="button"
          className={`fs-padkey ${cls} ${hot === k ? 'fs-hot' : ''}`}
          onPointerDown={e => {
            e.preventDefault();
            e.stopPropagation();
            f.keys.press(k, e.timeStamp);
            setHot(k);
          }}
          onPointerUp={() => setHot(null)}
          onPointerCancel={() => setHot(null)}
          onContextMenu={e => e.preventDefault()}
        >
          {ARROW[k]}
        </button>
      ))}
    </div>
  );
}

const FS_CSS = `
.fs-chip{right:calc(16px + env(safe-area-inset-right));bottom:calc(46px + env(safe-area-inset-bottom));background:rgba(17,16,24,.72);color:#ffd400;padding:5px 10px;border-radius:7px;font:800 11px system-ui,sans-serif;letter-spacing:.08em;display:flex;gap:6px;align-items:center}
.fs-chip b{background:#ffd400;color:#111;border-radius:4px;padding:0 5px;font-size:12px}
.fs-round{right:calc(14px + env(safe-area-inset-right));top:calc(38% - 66px + env(safe-area-inset-top));width:54px;height:54px;border-radius:50%;background:#ffd400;color:#111;font:900 22px system-ui,sans-serif;border:3px solid #111;box-shadow:3px 3px 0 #d22209;touch-action:manipulation}
.fs-stop{font-size:12px;letter-spacing:.06em;background:#d22209;color:#fff;box-shadow:3px 3px 0 #ffd400}
.fs-toast{top:30%;background:rgba(17,16,24,.85);color:#ffd400;padding:8px 14px;border-radius:10px;font:900 15px system-ui,sans-serif;white-space:nowrap}
.fs-hud{bottom:calc(78px + env(safe-area-inset-bottom));display:flex;flex-direction:column;align-items:center;gap:4px;max-width:calc(100vw - 32px);font-family:system-ui,sans-serif;text-align:center}
.fs-top{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center}
.fs-tag{background:#ffd400;color:#000;font-weight:900;font-style:italic;font-size:13px;padding:2px 8px;box-shadow:3px 3px 0 #d22209}
.fs-bpm{color:#fff;font-weight:800;font-size:11px;letter-spacing:.1em;text-shadow:0 1px 2px #000}
.fs-loop{background:rgba(17,16,24,.7);color:#fff;border-radius:6px;padding:3px 8px;font-weight:800;font-size:10px;letter-spacing:.08em}
.fs-move{color:#fff;font-weight:900;font-style:italic;font-size:28px;line-height:1.05;text-shadow:0 3px 0 #000,0 0 12px rgba(0,0,0,.6)}
.fs-move em{font-size:11px;font-style:normal;margin-left:8px;color:#ffd400;letter-spacing:.1em;vertical-align:middle}
.fs-keys{min-height:24px;display:flex;gap:4px;align-items:center;justify-content:center}
.fs-keys i{font-style:normal;background:rgba(17,16,24,.75);color:#ffd400;border-radius:5px;padding:1px 7px;font-weight:900;font-size:15px}
.fs-keys b{color:#3ddc84;font-weight:900;font-style:italic;font-size:18px;text-shadow:0 2px 0 #000;margin-left:6px}
.fs-card{display:flex;flex-wrap:wrap;gap:4px 10px;justify-content:center;max-width:560px;background:rgba(10,12,20,.55);border-radius:10px;padding:5px 10px;color:#fff;font-size:11px;font-weight:700}
.fs-card b{color:#ffd400;letter-spacing:.05em}
.fs-help{color:#fff;opacity:.7;font-size:10px;font-weight:700;letter-spacing:.06em;text-shadow:0 1px 2px #000}
.fs-pad{right:calc(8px + env(safe-area-inset-right));bottom:calc(8px + env(safe-area-inset-bottom));width:240px;height:190px;border-radius:18px;background:rgba(10,12,20,.82);z-index:5;touch-action:none}
.fs-padkey{position:absolute;width:54px;height:54px;border-radius:14px;background:rgba(255,255,255,.1);border:2px solid rgba(255,255,255,.35);color:#fff;font-size:22px;font-weight:900;touch-action:none;user-select:none;-webkit-user-select:none}
.fs-hot{background:#ffd400;color:#000}
.fs-l{left:6px;top:68px}.fs-u{left:62px;top:10px}.fs-d{left:62px;top:126px}.fs-r{left:118px;top:68px}
.fs-a{right:8px;bottom:12px;width:62px;height:62px;border-radius:999px;background:rgba(210,34,9,.75)}
.fs-b{right:8px;top:14px;width:58px;height:58px;border-radius:999px;background:rgba(42,107,255,.75)}
`;
