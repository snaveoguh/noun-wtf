// ── Noun Golf UI: the menu, the swing HUD, the card, results ────────────
//
// Reads GolfMode.ui (a small store) and calls GolfMode's actions. Touch:
// drag anywhere on the open ground to aim, the bag's ◀ ▶ for clubs, the
// big SWING button is the meter's three presses (start, power, accuracy).

import type { GolfMode, GolfUiState, HoleSet, Opponents, Skill } from './GolfMode';
import type { Game } from '../../Game';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { CLUBS } from '../sim';

const NOOP = () => () => {};

function useGolf(g: GolfMode | null): GolfUiState | null {
  return useSyncExternalStore(g !== null ? cb => g.subscribe(cb) : NOOP, () => g?.ui ?? null);
}

/** World2Page: hide the skate HUD + touch pad while golf owns the screen. */
export function useGolfActive(game: Game | null): boolean {
  const ui = useGolf(game?.golf ?? null);
  return ui !== null && ui.phase !== 'idle';
}

function useTick(on: boolean, ms = 200) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => set(n => n + 1), ms);
    return () => clearInterval(t);
  }, [on, ms]);
}

const toParText = (d: number) => (d === 0 ? 'E' : d > 0 ? `+${d}` : `${d}`);
const LIE: Record<string, string> = {
  tee: 'TEE',
  fairway: 'FAIRWAY',
  fringe: 'FRINGE',
  green: 'GREEN',
  rough: 'ROUGH',
  deep: 'DEEP ROUGH',
  sand: 'BUNKER',
  path: 'CART PATH',
  water: 'WATER',
  ob: 'OUT OF BOUNDS',
};
const SETS: [HoleSet, string][] = [
  ['all', 'ALL 19'],
  ['front', 'FRONT 9'],
  ['back', 'BACK 9'],
  ['nineteen', 'THE 19TH'],
];
const SKILLS: Skill[] = ['easy', 'club', 'pro', 'tour'];
const WINDS: [number, string][] = [
  [0, 'CALM'],
  [0.5, 'BREEZY'],
  [1, 'WINDY'],
];

export function GolfUi({ game }: { game: Game }) {
  const g = game.golf;
  const ui = useGolf(g)!;
  const now = performance.now();
  useTick(ui.call !== null || ui.phase === 'address');
  const at = ui.phase !== 'idle';
  useEffect(() => {
    if (!at) return;
    document.body.dataset.golf = '1';
    return () => {
      delete document.body.dataset.golf;
    };
  }, [at]);
  const call = ui.call !== null && now - ui.call.at < (ui.call.big ? 3200 : 2200) ? ui.call : null;
  return (
    <div className="gf-root pointer-events-none absolute inset-0">
      <style>{CSS}</style>
      {ui.incoming !== null && (
        <div className="gf-card pointer-events-auto absolute left-1/2 top-20 -translate-x-1/2">
          <span className="gf-eye">⛳ NOUN LINKS</span>
          <b>{ui.incoming.name} wants a round of golf</b>
          <div className="gf-row">
            <button type="button" className="gf-go" onClick={() => g.acceptInvite()}>
              ACCEPT
            </button>
            <button type="button" className="gf-no" onClick={() => g.declineInvite()}>
              DECLINE
            </button>
          </div>
        </div>
      )}
      {ui.phase === 'idle' && ui.offer && (
        <button type="button" className="gf-chip pointer-events-auto" onClick={() => g.openMenu()}>
          ⛳ PLAY GOLF <kbd>E</kbd>
        </button>
      )}
      {ui.phase === 'idle' && g.session !== null && (
        <div className="gf-chip gf-chip-round pointer-events-auto">
          <span>
            ⛳ HOLE {ui.hole?.n} · STROKE {(ui.scores[ui.turn]?.now ?? 0) + 1} · {ui.toPin} m TO THE
            PIN
          </span>
          <button type="button" className="gf-go" onClick={() => g.playShot()}>
            {ui.atBall ? (
              <>
                PLAY SHOT <kbd>E</kbd>
              </>
            ) : (
              'TO MY BALL'
            )}
          </button>
        </div>
      )}
      {ui.phase === 'menu' && <Menu g={g} ui={ui} />}
      {(ui.phase === 'address' || ui.phase === 'flight' || ui.phase === 'watch') && (
        <RoundHud g={g} ui={ui} />
      )}
      {ui.phase === 'card' && <Card g={g} ui={ui} />}
      {ui.phase === 'results' && <Results g={g} ui={ui} />}
      {call !== null && (
        <div className={`gf-call ${call.big ? 'gf-call-big' : ''}`}>{call.text}</div>
      )}
      {ui.quitAsk && ui.phase !== 'idle' && ui.phase !== 'menu' && (
        <div className="gf-card pointer-events-auto absolute left-1/2 top-1/3 -translate-x-1/2">
          <b>QUIT THE ROUND?</b>
          <div className="gf-row">
            <button
              type="button"
              className="gf-no"
              onClick={() => {
                g.ui.quitAsk = false;
                g.leave();
              }}
            >
              QUIT
            </button>
            <button
              type="button"
              className="gf-go"
              onClick={() => {
                g.ui.quitAsk = false;
                g.setOption({});
              }}
            >
              KEEP PLAYING
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Menu({ g, ui }: { g: GolfMode; ui: GolfUiState }) {
  const pick = <T,>(cur: T, v: T) => (cur === v ? 'gf-opt gf-on' : 'gf-opt');
  return (
    <div className="gf-menu pointer-events-auto">
      <span className="gf-eye">⛳ NOUN LINKS · 19 HOLES · PAR 76</span>
      <h2>TEE TIME</h2>
      <label>PLAYERS</label>
      <div className="gf-row">
        {([0, 1, 2, 3] as Opponents[]).map(n => (
          <button
            key={n}
            type="button"
            className={pick(ui.opponents, n)}
            onClick={() => g.setOption({ opponents: n })}
          >
            {n === 0 ? 'SOLO' : `VS ${n} CPU`}
          </button>
        ))}
      </div>
      {ui.opponents > 0 && (
        <>
          <label>CPU</label>
          <div className="gf-row">
            {SKILLS.map(s => (
              <button
                key={s}
                type="button"
                className={pick(ui.skill, s)}
                onClick={() => g.setOption({ skill: s })}
              >
                {s.toUpperCase()}
              </button>
            ))}
          </div>
        </>
      )}
      <label>HOLES</label>
      <div className="gf-row">
        {SETS.map(([k, t]) => (
          <button
            key={k}
            type="button"
            className={pick(ui.set, k)}
            onClick={() => g.setOption({ set: k })}
          >
            {t}
          </button>
        ))}
      </div>
      <label>WIND</label>
      <div className="gf-row">
        {WINDS.map(([w, t]) => (
          <button
            key={t}
            type="button"
            className={pick(ui.wind, w)}
            onClick={() => g.setOption({ wind: w })}
          >
            {t}
          </button>
        ))}
      </div>
      {ui.online && ui.near.length > 0 && (
        <>
          <label>PLAY WITH</label>
          <div className="gf-row">
            {ui.near.slice(0, 6).map(p => (
              <button key={p.id} type="button" className="gf-opt" onClick={() => g.invite(p.id)}>
                + {p.name}
              </button>
            ))}
          </div>
        </>
      )}
      {ui.best !== null && (
        <p className="gf-best">
          YOUR BEST: {ui.best.strokes} ({toParText(ui.best.strokes - ui.best.par)})
        </p>
      )}
      <div className="gf-row">
        <button type="button" className="gf-go gf-big" onClick={() => g.start()}>
          TEE OFF
        </button>
        <button type="button" className="gf-no" onClick={() => g.closeMenu()}>
          NOT NOW
        </button>
      </div>
      <p className="gf-help">
        AIM A/D or drag · CLUB W/S · SWING: SPACE to start, SPACE to set power, SPACE on the line ·
        C camera
      </p>
    </div>
  );
}

function RoundHud({ g, ui }: { g: GolfMode; ui: GolfUiState }) {
  const drag = useRef<number | null>(null);
  const m = ui.meter;
  const club = CLUBS[ui.club];
  const windDeg = (ui.windRel * 180) / Math.PI;
  return (
    <>
      {ui.phase === 'address' && ui.myTurn && (
        <div
          className="gf-drag pointer-events-auto"
          onPointerDown={e => {
            drag.current = e.clientX;
            (e.target as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={e => {
            if (drag.current === null) return;
            g.dragAim(e.clientX - drag.current);
            drag.current = e.clientX;
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        />
      )}
      <div className="gf-hole">
        <b>HOLE {ui.hole?.n}</b>
        <span>
          PAR {ui.hole?.par} · {ui.hole?.length} m
        </span>
        <i>{ui.hole?.name}</i>
      </div>
      <div className="gf-scores">
        {ui.players.map((p, i) => (
          <div key={i} className={i === ui.turn ? 'gf-up' : ''}>
            <span>{p.name}</span>
            <b>{toParText(ui.scores[i]?.toPar ?? 0)}</b>
            <em>{ui.scores[i]?.holed ? '✓' : (ui.scores[i]?.now ?? 0)}</em>
          </div>
        ))}
      </div>
      <div className="gf-info">
        <span>{LIE[ui.lie] ?? ui.lie}</span>
        <span>{ui.toPin} m TO PIN</span>
        <span className="gf-wind">
          <i style={{ transform: `rotate(${windDeg}deg)` }}>↑</i> {ui.windSpeed} m/s
        </span>
      </div>
      <div className="gf-line">
        {ui.thinking ? `${ui.players[ui.turn]?.name} IS LINING IT UP…` : ui.line}
      </div>
      {ui.phase === 'address' && ui.myTurn && (
        <div className="gf-bottom pointer-events-auto">
          <div className="gf-bag">
            <button type="button" onClick={() => g.stepClub(-1)}>
              ◀
            </button>
            <div>
              <b>{club.name}</b>
              <span>{ui.putting ? 'PUTTER' : `${ui.carry} m`}</span>
            </div>
            <button type="button" onClick={() => g.stepClub(1)}>
              ▶
            </button>
          </div>
          <div className="gf-meter">
            <div className="gf-fill" style={{ width: `${(Math.min(1.1, m.fill) / 1.1) * 100}%` }} />
            <div className="gf-full" style={{ left: `${(1 / 1.1) * 100}%` }} />
            <div className="gf-zone" />
            {m.phase !== 'idle' && (
              <div
                className="gf-needle"
                style={{ left: `${(Math.max(-0.1, Math.min(1.1, m.needle)) / 1.1) * 100}%` }}
              />
            )}
          </div>
          <button type="button" className="gf-swing" onPointerDown={() => g.press()}>
            {m.phase === 'idle' ? 'SWING' : m.phase === 'back' ? 'POWER' : 'STRIKE'}
          </button>
          <button type="button" className="gf-cam" onClick={() => g.cycleView()}>
            📷
          </button>
        </div>
      )}
      {ui.phase === 'flight' && (
        <button
          type="button"
          className="gf-ff pointer-events-auto"
          onPointerDown={() => g.setFast(true)}
          onPointerUp={() => g.setFast(false)}
          onPointerLeave={() => g.setFast(false)}
        >
          ⏩ HOLD
        </button>
      )}
      {g.awaitChoice && (
        <div className="gf-choice pointer-events-auto">
          <button type="button" className="gf-go gf-big" onClick={() => g.nextShot()}>
            NEXT SHOT <kbd>SPACE</kbd>
          </button>
          <button type="button" className="gf-opt" onClick={() => g.walk()}>
            WALK · DRIVE <kbd>B</kbd>
          </button>
        </div>
      )}
    </>
  );
}

function Scorecard({ ui }: { ui: GolfUiState }) {
  const holes = ui.holes;
  return (
    <div className="gf-table">
      <table>
        <thead>
          <tr>
            <th>HOLE</th>
            {holes.map(n => (
              <th key={n}>{n}</th>
            ))}
            <th>TOT</th>
          </tr>
          <tr>
            <th>PAR</th>
            {ui.pars.map((p, i) => (
              <th key={i}>{p}</th>
            ))}
            <th>{ui.pars.reduce((a, b) => a + b, 0)}</th>
          </tr>
        </thead>
        <tbody>
          {ui.players.map((p, i) => (
            <tr key={i}>
              <td>{p.name}</td>
              {holes.map((_, k) => {
                const v = ui.card[i]?.[k] ?? null;
                const d = v === null ? 0 : v - ui.pars[k];
                return (
                  <td
                    key={k}
                    className={v === null ? '' : d < 0 ? 'gf-under' : d > 0 ? 'gf-over' : ''}
                  >
                    {v ?? '·'}
                  </td>
                );
              })}
              <td>
                <b>{ui.scores[i]?.total ?? 0}</b>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Card({ g, ui }: { g: GolfMode; ui: GolfUiState }) {
  return (
    <div className="gf-menu gf-wide pointer-events-auto">
      <span className="gf-eye">
        ⛳ HOLE {ui.hole?.n} · {ui.hole?.name}
      </span>
      <Scorecard ui={ui} />
      <button type="button" className="gf-go gf-big" onClick={() => g.continueCard()}>
        NEXT HOLE <kbd>SPACE</kbd>
      </button>
    </div>
  );
}

function Results({ g, ui }: { g: GolfMode; ui: GolfUiState }) {
  const r = ui.results;
  if (r === null) return null;
  return (
    <div className="gf-menu gf-wide pointer-events-auto">
      <span className="gf-eye">⛳ NOUN LINKS · SIGN THE CARD</span>
      <h2>{r.won === null ? 'ROUND DONE' : r.won ? 'YOU WIN' : `${r.winner} WINS`}</h2>
      <Scorecard ui={ui} />
      <p className="gf-best">
        {r.newBest ? 'NEW PERSONAL BEST! ' : ''}
        {ui.best !== null
          ? `BEST ${ui.best.strokes} (${toParText(ui.best.strokes - ui.best.par)})`
          : ''}
        {r.respect !== null && r.respect > 0 ? ` · +${r.respect} RESPECT` : ''}
      </p>
      <div className="gf-row">
        <button
          type="button"
          className="gf-go gf-big"
          onClick={() => {
            g.endRound();
            g.openMenu();
          }}
        >
          PLAY AGAIN
        </button>
        <button type="button" className="gf-no" onClick={() => g.endRound()}>
          DONE
        </button>
      </div>
    </div>
  );
}

const CSS = `
.gf-root{font-family:inherit;color:#fff;z-index:30}
.gf-root kbd{font:inherit;font-size:.75em;border:1px solid #fff6;border-radius:4px;padding:0 .3em;margin-left:.4em}
.gf-eye{display:block;font-size:11px;letter-spacing:.14em;color:#ffe14a}
.gf-card,.gf-menu{background:rgba(14,40,22,.92);border:2px solid #ffe14a;border-radius:14px;padding:14px 16px;box-shadow:0 8px 30px #0008}
.gf-card b{display:block;margin:6px 0 10px}
.gf-menu{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:min(440px,calc(100vw - 32px));max-height:calc(100vh - 40px);overflow:auto}
.gf-wide{width:min(760px,calc(100vw - 24px))}
.gf-menu h2{font-size:28px;margin:4px 0 8px;letter-spacing:.04em}
.gf-menu label{display:block;font-size:11px;letter-spacing:.12em;opacity:.75;margin:10px 0 4px}
.gf-row{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.gf-opt,.gf-go,.gf-no{border-radius:9px;padding:7px 11px;font-weight:700;font-size:13px;border:2px solid #fff3;background:#ffffff14;color:#fff}
.gf-on{background:#ffe14a;color:#14321c;border-color:#ffe14a}
.gf-go{background:#3ddc84;color:#06240f;border-color:#3ddc84}
.gf-no{background:transparent}
.gf-big{font-size:17px;padding:10px 18px}
.gf-best{margin:10px 0 0;font-weight:700;color:#ffe14a}
.gf-help{margin:10px 0 0;font-size:11px;opacity:.65}
.gf-chip{position:absolute;left:50%;bottom:120px;transform:translateX(-50%);background:rgba(14,40,22,.9);border:2px solid #ffe14a;border-radius:999px;padding:8px 16px;font-weight:800;color:#fff;display:flex;gap:10px;align-items:center;white-space:nowrap}
.gf-chip-round{bottom:auto;top:64px;font-size:13px}
.gf-hole{position:absolute;left:16px;top:16px;background:rgba(14,40,22,.85);border-radius:12px;padding:8px 12px;display:flex;flex-direction:column;line-height:1.2}
.gf-hole b{font-size:22px}.gf-hole span{font-size:13px}.gf-hole i{font-style:normal;font-size:11px;color:#ffe14a;letter-spacing:.1em}
.gf-scores{position:absolute;right:16px;top:16px;background:rgba(14,40,22,.85);border-radius:12px;padding:6px 10px;font-size:13px;min-width:150px}
.gf-scores div{display:flex;gap:8px;align-items:center;padding:2px 0}.gf-scores span{flex:1}.gf-scores em{font-style:normal;opacity:.7;width:16px;text-align:right}
.gf-up{color:#ffe14a}
.gf-info{position:absolute;left:16px;top:108px;display:flex;flex-direction:column;gap:4px;font-weight:700;font-size:13px;text-shadow:0 1px 3px #000}
.gf-wind i{display:inline-block;font-style:normal;color:#9fe3ff}
.gf-line{position:absolute;left:50%;top:18px;transform:translateX(-50%);font-weight:800;font-size:14px;letter-spacing:.06em;text-shadow:0 2px 4px #000;white-space:nowrap}
.gf-drag{position:absolute;inset:80px 0 150px 0;touch-action:none}
.gf-bottom{position:absolute;left:50%;bottom:22px;transform:translateX(-50%);display:flex;gap:10px;align-items:center;background:rgba(14,40,22,.88);border-radius:16px;padding:10px 12px;width:min(720px,calc(100vw - 24px))}
.gf-bag{display:flex;align-items:center;gap:6px}
.gf-bag button{width:34px;height:42px;border-radius:9px;background:#ffffff1a;color:#fff;font-weight:800}
.gf-bag div{display:flex;flex-direction:column;align-items:center;min-width:70px;line-height:1.1}.gf-bag b{font-size:16px}.gf-bag span{font-size:11px;opacity:.75}
.gf-meter{position:relative;flex:1;height:26px;border-radius:13px;background:#00000066;overflow:hidden;border:2px solid #ffffff33}
.gf-fill{position:absolute;left:0;top:0;bottom:0;background:linear-gradient(90deg,#3ddc84,#ffe14a 80%,#ff5b3a)}
.gf-full{position:absolute;top:0;bottom:0;width:2px;background:#fff}
.gf-zone{position:absolute;left:0;top:0;bottom:0;width:6px;background:#fff8}
.gf-needle{position:absolute;top:-2px;bottom:-2px;width:4px;margin-left:-2px;background:#fff;box-shadow:0 0 6px #fff}
.gf-swing{min-width:96px;height:52px;border-radius:14px;background:#ffe14a;color:#14321c;font-weight:900;font-size:16px;touch-action:none}
.gf-cam{width:44px;height:44px;border-radius:12px;background:#ffffff1a}
.gf-ff{position:absolute;right:20px;bottom:24px;border-radius:12px;padding:10px 14px;background:rgba(14,40,22,.85);font-weight:800;touch-action:none}
.gf-choice{position:absolute;left:50%;bottom:30px;transform:translateX(-50%);display:flex;gap:10px}
.gf-call{position:absolute;left:50%;top:30%;transform:translateX(-50%);font-weight:900;font-size:30px;letter-spacing:.06em;text-shadow:0 3px 0 #14321c,0 0 18px #000a;white-space:nowrap;animation:gf-pop .35s ease-out}
.gf-call-big{font-size:56px;color:#ffe14a}
@keyframes gf-pop{from{transform:translateX(-50%) scale(.6);opacity:0}to{transform:translateX(-50%) scale(1);opacity:1}}
.gf-table{overflow-x:auto;margin:8px 0}
.gf-table table{border-collapse:collapse;font-size:12px;width:100%}
.gf-table th,.gf-table td{padding:3px 5px;text-align:center;border-bottom:1px solid #ffffff22}
.gf-table td:first-child,.gf-table th:first-child{text-align:left;white-space:nowrap}
.gf-under{color:#ff6b6b;font-weight:800}.gf-over{opacity:.8}
@media (max-width:600px){
  .gf-hole{transform:scale(.85);transform-origin:top left}
  .gf-scores{transform:scale(.85);transform-origin:top right}
  .gf-info{top:96px}
  .gf-bottom{flex-wrap:wrap;bottom:max(12px,env(safe-area-inset-bottom))}
  .gf-meter{order:3;flex-basis:100%}
  .gf-call{font-size:22px}.gf-call-big{font-size:38px}
  .gf-line{top:auto;bottom:170px;font-size:12px}
}
`;
