// ── Car HUD: TAKE IT prompt, speedo / gear / boost, flight readout, phone pads ──
//
// Same layout as the van's (van/VanHud.tsx): desktop gets a speedo at the
// bottom centre and a controls hint; phones get ◀ ▶ steering, GAS / BRAKE /
// DRIFT / BOOST, and EXIT · HORN · FLIP · the car's SPECIAL on the left
// edge. H honks and X fires the special while driving (caught on window,
// in the capture phase, ahead of the missions journal's X and the help's H).
// Kenney-bodied cars show their credit line (CC0, credited anyway).
// Riding together: beside someone's car, RIDE WITH <name> (E / tap); in
// their passenger seat, a small panel with GET OUT (E / tap); the driver
// sees who's riding along under the speedo.

import type { Game } from '../Game';

import { useEffect } from 'react';

import { HudSlot } from '../hud/slots';

import { useCarUi } from './useCars';

const SPECIAL_LABEL: Record<string, { key: string; pad: string }> = {
  fly: { key: 'lift off (at 50 km/h)', pad: 'FLY' },
  hop: { key: 'hit the hydraulics', pad: 'HOP' },
  stomp: { key: 'stomp-jump', pad: 'STOMP' },
};

export function CarHud({ game, touch }: { game: Game; touch: boolean }) {
  const ui = useCarUi(game);
  const cars = game.cars;

  // H honks, X special (while driving)
  useEffect(() => {
    if (!ui.driving) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.code !== 'KeyH' && e.code !== 'KeyX') || e.repeat) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (e.code === 'KeyH') cars.horn();
      else cars.special();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [ui.driving, cars]);

  // Let go of every touch control when the car stops being driven
  useEffect(() => {
    if (ui.driving) return;
    const t = cars.touch;
    t.steer = 0;
    t.gas = t.brake = t.handbrake = t.boost = false;
  }, [ui.driving, cars]);

  const notice = ui.notice !== '' && (
    <div key={ui.notice} className="w2-car-status w2-car-notice absolute left-1/2 -translate-x-1/2">
      {ui.notice}
    </div>
  );

  if (ui.ride !== null) {
    const r = ui.ride;
    return (
      <div className="pointer-events-none absolute inset-0" data-car="ride">
        <style>{CAR_CSS}</style>
        {notice}
        <div
          className={`w2-car-speedo absolute left-1/2 -translate-x-1/2 ${touch ? 'w2-car-touch' : ''}`}
        >
          <div className="w2-car-name">
            {r.car} · {r.pending ? 'GETTING IN…' : `SEAT ${r.seat + 1}`}
            {r.flying && <em> · FLYING</em>}
          </div>
          <div className="w2-car-row">
            <b>{ui.kmh}</b>
            <span>km/h</span>
          </div>
          <div className="w2-car-ride">RIDING WITH {r.who}</div>
        </div>
        {!touch && (
          <div className="w2-car-hint absolute left-1/2 -translate-x-1/2">
            {r.leaving ? (
              'OUT AT THE NEXT STOP'
            ) : (
              <>
                <b>E</b> get out · <b>C</b> camera
              </>
            )}
          </div>
        )}
        {touch && (
          <div className="w2-car-side pointer-events-auto absolute flex flex-col gap-2">
            <button
              type="button"
              className="w2-cbtn w2-cbtn-sm"
              data-car="get-out"
              onClick={() => cars.requestToggle()}
            >
              {r.leaving ? 'OUT NOW' : 'GET OUT'}
            </button>
          </div>
        )}
      </div>
    );
  }

  if (!ui.driving) {
    if (ui.nearRide !== null)
      return (
        <>
          <style>{CAR_CSS}</style>
          {notice}
          <div className="w2-car-enter-wrap pointer-events-none absolute left-1/2 top-[34%] -translate-x-1/2">
            <button
              type="button"
              data-car="ride"
              className="w2-car-enter pointer-events-auto"
              onClick={() => {
                game.unlockAudio();
                cars.requestToggle();
              }}
            >
              🧍 RIDE WITH {ui.nearRide.who} <span>{touch ? 'TAP' : 'E'}</span>
            </button>
            <div className="w2-car-tag">Hop in the passenger seat of their {ui.nearRide.car}</div>
          </div>
        </>
      );
    if (ui.near === null) return ui.notice !== '' ? notice : null;
    return (
      <>
        <style>{CAR_CSS}</style>
        <HudSlot name="toasts">
          <div className="w2-car-enter-wrap pointer-events-none absolute left-1/2 top-[34%] -translate-x-1/2">
            <button
              type="button"
              data-car="enter"
              className="w2-car-enter pointer-events-auto"
              onClick={() => {
                game.unlockAudio();
                cars.requestToggle();
              }}
            >
              🚗 TAKE THE {ui.near.name} <span>{touch ? 'TAP' : 'E'}</span>
            </button>
            <div className="w2-car-tag">{ui.near.tagline}</div>
            {ui.near.credit !== '' && <div className="w2-car-credit">{ui.near.credit}</div>}
          </div>
        </HudSlot>
      </>
    );
  }

  const car = ui.car;
  const sp = car?.special ?? null;
  const status = ui.stopping
    ? ui.flying
      ? 'LANDING…'
      : 'STOPPING…'
    : ui.smash
      ? 'SMASH!'
      : ui.stuck
        ? touch
          ? 'STUCK? TAP FLIP'
          : 'STUCK? R TO FLIP'
        : ui.canFly
          ? touch
            ? 'TAP FLY!'
            : 'X TO FLY!'
          : ui.air
            ? 'AIR!'
            : ui.drifting
              ? 'DRIFT!'
              : ui.boosting
                ? 'BOOST'
                : null;

  return (
    <div className="pointer-events-none absolute inset-0" data-car="hud">
      <style>{CAR_CSS}</style>
      {notice}
      {status !== null && (
        <HudSlot name="toasts">
          <div key={status} className="w2-car-status absolute left-1/2 -translate-x-1/2">
            {status}
          </div>
        </HudSlot>
      )}
      <div
        className={`w2-car-speedo absolute left-1/2 -translate-x-1/2 ${touch ? 'w2-car-touch' : ''}`}
      >
        <div className="w2-car-name">
          {car?.name}
          {ui.flying && <em> · ALT {ui.alt} m</em>}
        </div>
        <div className="w2-car-row">
          <b>{ui.kmh}</b>
          <span>km/h</span>
          <i className={ui.gear === 'R' ? 'w2-car-rev' : ui.gear === 'F' ? 'w2-car-fly' : ''}>
            {ui.gear}
          </i>
        </div>
        <div className="w2-car-bar w2-car-rpm">
          <div style={{ width: `${Math.round(ui.rpm * 100)}%` }} />
        </div>
        <div className={`w2-car-bar w2-car-boost ${ui.boosting ? 'w2-on' : ''}`}>
          <div style={{ width: `${Math.round(ui.boost * 100)}%` }} />
        </div>
        {car !== null && car.credit !== '' && <div className="w2-car-credit">{car.credit}</div>}
        {ui.crew.length > 0 && <div className="w2-car-ride">WITH {ui.crew.join(' · ')}</div>}
      </div>
      {!touch && (
        <div className="w2-car-hint absolute left-1/2 -translate-x-1/2">
          {ui.flying ? (
            <>
              <b>W</b> thrust · <b>A/D</b> yaw · <b>SPACE</b> up · <b>S</b>/<b>Q</b> down (sink to
              land) · <b>SHIFT</b> boost · <b>X</b> drop · <b>E</b> land + get out
            </>
          ) : (
            <>
              <b>W/S</b> gas, brake/reverse · <b>A/D</b> steer · <b>SPACE</b> handbrake drift ·{' '}
              <b>SHIFT</b> boost · <b>H</b> horn
              {sp !== null && (
                <>
                  {' '}
                  · <b>X</b> {SPECIAL_LABEL[sp].key}
                </>
              )}{' '}
              · <b>R</b> flip · <b>C</b> camera · <b>E</b> get out
            </>
          )}
        </div>
      )}
      {touch && <TouchDrive game={game} special={sp} flying={ui.flying} />}
    </div>
  );
}

function TouchDrive({
  game,
  special,
  flying,
}: {
  game: Game;
  special: string | null;
  flying: boolean;
}) {
  const cars = game.cars;
  const t = cars.touch;
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
      className="w2-car-touchpad pointer-events-none absolute inset-0"
      style={{ touchAction: 'none' }}
    >
      <div className="w2-car-steer pointer-events-auto absolute flex gap-2">
        <button type="button" className="w2-cbtn" aria-label="steer left" {...steer(-1)}>
          ◀
        </button>
        <button type="button" className="w2-cbtn" aria-label="steer right" {...steer(1)}>
          ▶
        </button>
      </div>
      <div className="w2-car-side pointer-events-auto absolute flex flex-col gap-2">
        <button type="button" className="w2-cbtn w2-cbtn-sm" onClick={() => cars.requestToggle()}>
          EXIT
        </button>
        <button type="button" className="w2-cbtn w2-cbtn-sm" onClick={() => cars.horn()}>
          📯 HORN
        </button>
        <button type="button" className="w2-cbtn w2-cbtn-sm" onClick={() => cars.flip()}>
          FLIP
        </button>
        {special !== null && (
          <button
            type="button"
            className="w2-cbtn w2-cbtn-sm w2-cbtn-special"
            onClick={() => cars.special()}
          >
            {flying ? 'DROP' : SPECIAL_LABEL[special].pad}
          </button>
        )}
      </div>
      <div className="w2-car-pedals pointer-events-auto absolute">
        <button type="button" className="w2-cbtn w2-c-boost" {...flag('boost')}>
          BOOST
        </button>
        <button type="button" className="w2-cbtn w2-c-drift" {...flag('handbrake')}>
          {flying ? 'UP' : 'DRIFT'}
        </button>
        <button type="button" className="w2-cbtn w2-c-brake" {...flag('brake')}>
          {flying ? 'DOWN' : 'BRAKE'}
        </button>
        <button type="button" className="w2-cbtn w2-c-gas" {...flag('gas')}>
          GAS
        </button>
      </div>
    </div>
  );
}

const CAR_CSS = `
.w2-car-enter-wrap{display:flex;flex-direction:column;align-items:center;gap:6px;max-width:92vw}
.w2-car-enter{background:#ffd400;color:#111;padding:12px 20px;font-size:18px;font-weight:900;font-style:italic;box-shadow:6px 6px 0 #e8352c;white-space:nowrap}
.w2-car-enter span{margin-left:8px;padding:2px 7px;background:#111;color:#ffd400;font-style:normal;font-size:13px}
.w2-car-tag{font:600 12px/1.3 system-ui,sans-serif;color:#fff;text-shadow:0 1px 2px #000;text-align:center}
.w2-car-notice{top:22%;font-size:24px}
.w2-car-ride{font:800 10px/1.3 system-ui,sans-serif;letter-spacing:.06em;color:#7fe9ff;margin-top:4px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.w2-car-credit{font:500 10px/1.2 system-ui,sans-serif;opacity:.6;color:#fff;text-shadow:0 1px 2px #000;margin-top:3px}
.w2-car-speedo{bottom:calc(82px + env(safe-area-inset-bottom));min-width:180px;padding:6px 14px 8px;border-radius:14px;background:rgba(10,12,20,.55);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.16);font-family:system-ui,sans-serif}
.w2-car-name{font-size:11px;font-weight:900;font-style:italic;letter-spacing:.1em;color:#ffd400;white-space:nowrap}
.w2-car-name em{font-style:normal;color:#7fe9ff}
.w2-car-row{display:flex;align-items:baseline;gap:6px}
.w2-car-row b{font-size:36px;font-weight:900;font-style:italic;line-height:1;font-variant-numeric:tabular-nums;text-shadow:0 2px 0 rgba(0,0,0,.5)}
.w2-car-row span{font-size:11px;font-weight:700;letter-spacing:.12em;opacity:.7}
.w2-car-row i{margin-left:auto;font-style:normal;font-weight:900;font-size:20px;min-width:30px;text-align:center;border:2px solid #ffd400;color:#ffd400;border-radius:8px;line-height:26px}
.w2-car-row i.w2-car-rev{border-color:#ff5d5d;color:#ff5d5d}
.w2-car-row i.w2-car-fly{border-color:#7fe9ff;color:#7fe9ff}
.w2-car-bar{height:5px;border-radius:3px;background:rgba(255,255,255,.14);margin-top:5px;overflow:hidden}
.w2-car-bar div{height:100%;border-radius:3px}
.w2-car-rpm div{background:linear-gradient(90deg,#3ddc84,#ffd400 70%,#ff5d5d)}
.w2-car-boost div{background:#48d6ff}
.w2-car-boost.w2-on div{background:#e8352c;box-shadow:0 0 10px #e8352c}
.w2-car-hint{bottom:calc(60px + env(safe-area-inset-bottom));font-size:11px;opacity:.75;white-space:nowrap;text-shadow:0 1px 2px #000}
.w2-car-hint b{color:#ffd400}
.w2-car-status{top:34%;font-size:30px;font-weight:900;font-style:italic;color:#ffd400;text-shadow:3px 3px 0 #d22209;animation:w2carpop .35s ease-out;white-space:nowrap}
@keyframes w2carpop{from{transform:translate(-50%,0) scale(1.5);opacity:0}to{transform:translate(-50%,0) scale(1);opacity:1}}
.w2-cbtn{background:rgba(10,12,20,.55);border:1px solid rgba(255,255,255,.28);color:#fff;border-radius:16px;width:64px;height:64px;font-weight:900;font-size:13px;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);touch-action:none;-webkit-user-select:none;user-select:none}
.w2-cbtn:active{background:rgba(255,212,0,.55);color:#111}
.w2-cbtn-sm{width:auto;height:40px;padding:0 12px;font-size:12px}
.w2-cbtn-special{background:rgba(127,233,255,.35)}
.w2-car-steer{left:calc(10px + env(safe-area-inset-left));bottom:calc(112px + env(safe-area-inset-bottom))}
.w2-car-steer .w2-cbtn{width:68px;height:68px;font-size:22px}
.w2-car-side{left:calc(10px + env(safe-area-inset-left));top:36%}
.w2-car-pedals{right:calc(10px + env(safe-area-inset-right));bottom:calc(12px + env(safe-area-inset-bottom));width:150px;height:176px}
.w2-car-pedals .w2-cbtn{position:absolute}
.w2-c-gas{right:0;bottom:0;width:78px;height:104px;background:rgba(61,220,132,.35)}
.w2-c-brake{left:0;bottom:0;background:rgba(255,93,93,.3)}
.w2-c-drift{left:0;bottom:72px}
.w2-c-boost{right:0;bottom:112px;width:78px;height:52px;background:rgba(72,214,255,.3)}
.w2-car-speedo.w2-car-touch{bottom:calc(198px + env(safe-area-inset-bottom));min-width:0;width:124px;padding:4px 8px 6px}
.w2-car-touch .w2-car-row b{font-size:24px}
.w2-car-touch .w2-car-row i{font-size:15px;min-width:22px;line-height:20px}
.w2-car-touch .w2-car-row span{font-size:9px}
.w2-car-touch .w2-car-name{font-size:9px}
`;
