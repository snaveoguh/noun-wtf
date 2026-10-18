// ── Van HUD: GET IN prompt, speedometer / gear / boost, phone controls ──
//
// Desktop: a speedo at the bottom centre with the controls hint. Phones
// (390 px wide and up): steering ◀ ▶ above the minimap, GAS / BRAKE / DRIFT
// / BOOST bottom-right, EXIT + HORN on the left edge, a compact speedo in
// between. The skate touch controls are hidden while driving (World2Page).

import type { Game } from '../Game';

import { useEffect } from 'react';

import { useVanUi } from './useVan';

export function VanHud({ game, touch }: { game: Game; touch: boolean }) {
  const ui = useVanUi(game);
  const van = game.van2;

  // H honks while driving (and doesn't toggle the controls sheet)
  useEffect(() => {
    if (!ui.driving) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyH' || e.repeat) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      van.horn();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [ui.driving, van]);

  // Let go of every touch control when the van stops being driven
  useEffect(() => {
    if (ui.driving) return;
    const t = van.touch;
    t.steer = 0;
    t.gas = t.brake = t.handbrake = t.boost = false;
  }, [ui.driving, van]);

  if (!ui.driving) {
    if (!ui.near) return null;
    return (
      <>
        <style>{VAN_CSS}</style>
        <button
          type="button"
          data-van="enter"
          className="w2-van-enter pointer-events-auto absolute left-1/2 top-[34%] -translate-x-1/2"
          onClick={() => {
            game.unlockAudio();
            van.requestToggle();
          }}
        >
          🍦 GET IN THE VAN <span>{touch ? 'TAP' : 'E'}</span>
        </button>
      </>
    );
  }

  const status = ui.stopping
    ? 'STOPPING…'
    : ui.stuck
      ? touch
        ? 'STUCK? TAP FLIP'
        : 'STUCK? R TO FLIP'
      : ui.air
        ? 'AIR!'
        : ui.drifting
          ? 'DRIFT!'
          : ui.boosting
            ? 'BOOST'
            : null;

  return (
    <div className="pointer-events-none absolute inset-0" data-van="hud">
      <style>{VAN_CSS}</style>
      {status !== null && (
        <div key={status} className="w2-van-status absolute left-1/2 -translate-x-1/2">
          {status}
        </div>
      )}
      <div
        className={`w2-van-speedo absolute left-1/2 -translate-x-1/2 ${touch ? 'w2-van-touch' : ''}`}
      >
        <div className="w2-van-row">
          <b>{ui.kmh}</b>
          <span>km/h</span>
          <i className={ui.gear === 'R' ? 'w2-van-rev' : ''}>{ui.gear}</i>
        </div>
        <div className="w2-van-bar w2-van-rpm">
          <div style={{ width: `${Math.round(ui.rpm * 100)}%` }} />
        </div>
        <div className={`w2-van-bar w2-van-boost ${ui.boosting ? 'w2-on' : ''}`}>
          <div style={{ width: `${Math.round(ui.boost * 100)}%` }} />
        </div>
      </div>
      {!touch && (
        <div className="w2-van-hint absolute left-1/2 -translate-x-1/2">
          <b>W/S</b> gas, brake/reverse · <b>A/D</b> steer · <b>SPACE</b> handbrake drift ·{' '}
          <b>SHIFT</b> boost · <b>H</b> horn · <b>R</b> flip · <b>C</b> camera · <b>E</b> get out
        </div>
      )}
      {touch && <TouchDrive game={game} />}
    </div>
  );
}

function TouchDrive({ game }: { game: Game }) {
  const van = game.van2;
  const t = van.touch;
  const hold = (on: () => void, off: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      game.unlockAudio();
      on();
    },
    onPointerUp: off,
    onPointerCancel: off,
    onLostPointerCapture: off,
  });
  const steer = (dir: number) =>
    hold(
      () => (t.steer = dir),
      () => {
        if (t.steer === dir) t.steer = 0;
      },
    );
  const flag = (k: 'gas' | 'brake' | 'handbrake' | 'boost') =>
    hold(
      () => (t[k] = true),
      () => (t[k] = false),
    );
  return (
    <div
      className="w2-van-touchpad pointer-events-none absolute inset-0"
      style={{ touchAction: 'none' }}
    >
      <div className="w2-van-steer pointer-events-auto absolute flex gap-2">
        <button type="button" className="w2-vbtn" aria-label="steer left" {...steer(-1)}>
          ◀
        </button>
        <button type="button" className="w2-vbtn" aria-label="steer right" {...steer(1)}>
          ▶
        </button>
      </div>
      <div className="w2-van-side pointer-events-auto absolute flex flex-col gap-2">
        <button type="button" className="w2-vbtn w2-vbtn-sm" onClick={() => van.requestToggle()}>
          EXIT
        </button>
        <button type="button" className="w2-vbtn w2-vbtn-sm" onClick={() => van.horn()}>
          🍦 HORN
        </button>
        <button type="button" className="w2-vbtn w2-vbtn-sm" onClick={() => van.flip()}>
          FLIP
        </button>
      </div>
      <div className="w2-van-pedals pointer-events-auto absolute">
        <button type="button" className="w2-vbtn w2-v-boost" {...flag('boost')}>
          BOOST
        </button>
        <button type="button" className="w2-vbtn w2-v-drift" {...flag('handbrake')}>
          DRIFT
        </button>
        <button type="button" className="w2-vbtn w2-v-brake" {...flag('brake')}>
          BRAKE
        </button>
        <button type="button" className="w2-vbtn w2-v-gas" {...flag('gas')}>
          GAS
        </button>
      </div>
    </div>
  );
}

const VAN_CSS = `
.w2-van-enter{background:#ffd400;color:#111;padding:12px 20px;font-size:18px;font-weight:900;font-style:italic;box-shadow:6px 6px 0 #f2a2b6;white-space:nowrap}
.w2-van-enter span{margin-left:8px;padding:2px 7px;background:#111;color:#ffd400;font-style:normal;font-size:13px}
.w2-van-speedo{bottom:calc(82px + env(safe-area-inset-bottom));min-width:170px;padding:6px 14px 8px;border-radius:14px;background:rgba(10,12,20,.55);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.16);font-family:system-ui,sans-serif}
.w2-van-row{display:flex;align-items:baseline;gap:6px}
.w2-van-row b{font-size:36px;font-weight:900;font-style:italic;line-height:1;font-variant-numeric:tabular-nums;text-shadow:0 2px 0 rgba(0,0,0,.5)}
.w2-van-row span{font-size:11px;font-weight:700;letter-spacing:.12em;opacity:.7}
.w2-van-row i{margin-left:auto;font-style:normal;font-weight:900;font-size:20px;min-width:30px;text-align:center;border:2px solid #ffd400;color:#ffd400;border-radius:8px;line-height:26px}
.w2-van-row i.w2-van-rev{border-color:#ff5d5d;color:#ff5d5d}
.w2-van-bar{height:5px;border-radius:3px;background:rgba(255,255,255,.14);margin-top:5px;overflow:hidden}
.w2-van-bar div{height:100%;border-radius:3px}
.w2-van-rpm div{background:linear-gradient(90deg,#3ddc84,#ffd400 70%,#ff5d5d)}
.w2-van-boost div{background:#48d6ff}
.w2-van-boost.w2-on div{background:#f2a2b6;box-shadow:0 0 10px #f2a2b6}
.w2-van-hint{bottom:calc(60px + env(safe-area-inset-bottom));font-size:11px;opacity:.75;white-space:nowrap;text-shadow:0 1px 2px #000}
.w2-van-hint b{color:#ffd400}
.w2-van-status{top:34%;font-size:30px;font-weight:900;font-style:italic;color:#ffd400;text-shadow:3px 3px 0 #d22209;animation:w2vanpop .35s ease-out;white-space:nowrap}
@keyframes w2vanpop{from{transform:translate(-50%,0) scale(1.5);opacity:0}to{transform:translate(-50%,0) scale(1);opacity:1}}
.w2-vbtn{background:rgba(10,12,20,.55);border:1px solid rgba(255,255,255,.28);color:#fff;border-radius:16px;width:64px;height:64px;font-weight:900;font-size:13px;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);touch-action:none;-webkit-user-select:none;user-select:none}
.w2-vbtn:active{background:rgba(255,212,0,.55);color:#111}
.w2-vbtn-sm{width:auto;height:40px;padding:0 12px;font-size:12px}
.w2-van-steer{left:calc(10px + env(safe-area-inset-left));bottom:calc(112px + env(safe-area-inset-bottom))}
.w2-van-steer .w2-vbtn{width:68px;height:68px;font-size:22px}
.w2-van-side{left:calc(10px + env(safe-area-inset-left));top:40%}
.w2-van-pedals{right:calc(10px + env(safe-area-inset-right));bottom:calc(12px + env(safe-area-inset-bottom));width:150px;height:176px}
.w2-van-pedals .w2-vbtn{position:absolute}
.w2-v-gas{right:0;bottom:0;width:78px;height:104px;background:rgba(61,220,132,.35)}
.w2-v-brake{left:0;bottom:0;background:rgba(255,93,93,.3)}
.w2-v-drift{left:0;bottom:72px}
.w2-v-boost{right:0;bottom:112px;width:78px;height:52px;background:rgba(72,214,255,.3)}
.w2-van-speedo.w2-van-touch{bottom:calc(198px + env(safe-area-inset-bottom));min-width:0;width:118px;padding:4px 8px 6px}
.w2-van-touch .w2-van-row b{font-size:24px}
.w2-van-touch .w2-van-row i{font-size:15px;min-width:22px;line-height:20px}
.w2-van-touch .w2-van-row span{font-size:9px}
`;
