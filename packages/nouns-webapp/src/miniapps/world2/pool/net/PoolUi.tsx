// ── Noun Pool UI: the menu, invites, the frame's HUD, results ───────────
//
// Reads PoolMode.ui (a small store) and calls PoolMode's actions. The HUD:
// both players with their group and the balls they've left, whose shot it
// is, the last foul, a pull-back power bar (drag down, let go to shoot),
// the cue ball spin picker, the camera toggle and fast-forward.

import type { Game } from '../../Game';
import type { PoolMode, PoolUiState } from './PoolMode';
import type { BallId } from '../contract';
import type { Difficulty } from '../sim/cpu';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { ballCss } from '../view/atlas';

import { INVITE_MS } from './lobby';

const NOOP = () => () => {};
const DIFFS: Difficulty[] = ['easy', 'normal', 'hard', 'pro'];
type Tab = 'cpu' | '1v1' | 'watch';

function usePool(p: PoolMode | null): PoolUiState | null {
  return useSyncExternalStore(p !== null ? cb => p.subscribe(cb) : NOOP, () => p?.ui ?? null);
}

/** World2Page: hide the skate HUD + touch pad while at the table. */
export function usePoolActive(game: Game | null): boolean {
  const ui = usePool(game?.pool ?? null);
  return ui !== null && ui.phase !== 'idle';
}

function useTick(on: boolean, ms = 250) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => set(n => n + 1), ms);
    return () => clearInterval(t);
  }, [on, ms]);
}

const coarse = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;

export function PoolUi({ game }: { game: Game }) {
  const p = game.pool;
  const ui = usePool(p)!;
  const now = performance.now();
  useTick(ui.incoming !== null || ui.toast !== null);
  const at = ui.phase !== 'idle';
  // The site's NOUN FM chip would sit on the power bar: hide it at the table
  useEffect(() => {
    if (!at) return;
    document.body.dataset.pool = '1';
    return () => {
      delete document.body.dataset.pool;
    };
  }, [at]);
  return (
    <div className="pl-root pointer-events-none absolute inset-0">
      <style>{CSS}</style>
      {ui.incoming !== null && (
        <div className="pl-card pointer-events-auto absolute left-1/2 top-20 -translate-x-1/2">
          <span>🎱 NOUN POOL</span>
          <b>{ui.incoming.name} wants a game of 8-ball</b>
          <div className="pl-bar">
            <i
              style={{
                width: `${Math.max(0, 100 - ((now - (p.lobby.incoming?.t ?? now)) / INVITE_MS) * 100)}%`,
              }}
            />
          </div>
          <div className="flex gap-2">
            <button type="button" className="pl-go" onClick={() => p.acceptInvite()}>
              ACCEPT
            </button>
            <button type="button" className="pl-no" onClick={() => p.declineInvite()}>
              DECLINE
            </button>
          </div>
        </div>
      )}
      {ui.phase === 'menu' && <Menu p={p} ui={ui} />}
      {ui.waiting !== null && ui.phase === 'menu' && (
        <div className="pl-card absolute left-1/2 top-6 -translate-x-1/2">
          <b>{ui.waiting}</b>
        </div>
      )}
      {(ui.phase === 'playing' || ui.phase === 'results') && <Hud p={p} ui={ui} />}
      {ui.phase === 'results' && ui.results !== null && <Results p={p} ui={ui} />}
      {ui.toast !== null && now - ui.toast.at < 3500 && (
        <div key={ui.toast.at} className="pl-toast absolute left-1/2 top-[22%] -translate-x-1/2">
          {ui.toast.text}
        </div>
      )}
    </div>
  );
}

// ── The menu ──

function Menu({ p, ui }: { p: PoolMode; ui: PoolUiState }) {
  const [tab, setTab] = useState<Tab>('cpu');
  return (
    <div className="pl-menu pointer-events-auto absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-black/85 p-4 text-white">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <div className="pl-title">NOUN POOL</div>
          <div className="text-xs opacity-70">
            8-ball {ui.hall ? '· the pool hall' : '· on this table'}
          </div>
        </div>
        <button
          type="button"
          className="pl-x"
          onClick={() => p.exit()}
          aria-label="leave the table"
        >
          ✕
        </button>
      </div>
      <div className="pl-tabs mb-3">
        {(
          [
            ['cpu', 'VS CPU'],
            ['1v1', '1V1 ONLINE'],
            ['watch', 'WATCH'],
          ] as [Tab, string][]
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            className={`pl-tab ${tab === k ? 'pl-on' : ''}`}
            onClick={() => setTab(k)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'cpu' && (
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-4 gap-1">
            {DIFFS.map(d => (
              <button
                key={d}
                type="button"
                className={`pl-pill ${ui.difficulty === d ? 'pl-on' : ''}`}
                onClick={() => p.setDifficulty(d)}
              >
                {d.toUpperCase()}
              </button>
            ))}
          </div>
          <div className="text-xs opacity-70">
            {ui.difficulty === 'easy'
              ? 'misses plenty, never plans ahead'
              : ui.difficulty === 'normal'
                ? 'pots what it should, some position play'
                : ui.difficulty === 'hard'
                  ? 'plans its next shot · short aiming guide'
                  : 'barely misses · short aiming guide'}
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={ui.pro} onChange={e => p.setPro(e.target.checked)} />{' '}
            short aiming guide (pro mode)
          </label>
          <button type="button" className="pl-go" onClick={() => p.vsCpu()}>
            RACK &apos;EM
          </button>
        </div>
      )}
      {tab === '1v1' && (
        <div className="flex flex-col gap-2">
          {!ui.online && <div className="text-sm opacity-75">offline: 1v1 needs the live room</div>}
          {ui.outgoing !== null ? (
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm">waiting for {ui.outgoing.name}…</span>
              <button type="button" className="pl-no" onClick={() => p.cancelChallenge()}>
                CANCEL
              </button>
            </div>
          ) : ui.near.length === 0 ? (
            <div className="text-sm opacity-75">
              nobody else in here yet. A friend in this {ui.hall ? 'hall' : 'room'} shows up here.
            </div>
          ) : (
            <div className="pl-list flex flex-col gap-1">
              {ui.near.map(n => (
                <div key={n.id} className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm">{n.name}</span>
                  <button type="button" className="pl-pill" onClick={() => p.challenge(n.id)}>
                    CHALLENGE
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {tab === 'watch' && (
        <div className="flex flex-col gap-2">
          {ui.live.length === 0 ? (
            <div className="text-sm opacity-75">no frames on right now</div>
          ) : (
            ui.live.map(l => (
              <div key={l.gid} className="flex items-center justify-between gap-2">
                <span className="truncate text-sm">
                  {l.names[0]} v {l.names[1]}
                </span>
                <button type="button" className="pl-pill" onClick={() => p.watch(l.gid)}>
                  WATCH
                </button>
              </div>
            ))
          )}
        </div>
      )}
      <div className="mt-3 text-[11px] opacity-60">
        {coarse()
          ? 'drag to aim · pull the power bar down and let go to shoot'
          : 'drag to aim · ←/→ fine aim · ↑/↓ power · SPACE shoot · T top view · ESC leave'}
      </div>
    </div>
  );
}

// ── In a frame ──

function Balls({ ids }: { ids: BallId[] }) {
  return (
    <span className="pl-balls">
      {ids.map(id => {
        const c = ballCss(id);
        return (
          <i
            key={id}
            style={{
              background: c.stripe
                ? `linear-gradient(#f4f1e8 26%, ${c.bg} 26%, ${c.bg} 74%, #f4f1e8 74%)`
                : c.bg,
            }}
          />
        );
      })}
    </span>
  );
}

function Plate({ ui, seat }: { ui: PoolUiState; seat: 0 | 1 }) {
  const g = ui.groups[seat];
  const on = ui.turn === seat && ui.phase === 'playing';
  const me = ui.mySeat === seat;
  return (
    <div
      className={`pl-plate ${on ? 'pl-plate-on' : ''} ${seat === 1 ? 'items-end text-right' : ''}`}
    >
      <b className="truncate">
        {me ? 'YOU' : ui.names[seat]}
        {ui.onEight[seat] ? ' · ON THE 8' : ''}
      </b>
      <span>{g === null ? 'open table' : g === 'solids' ? 'SOLIDS 1–7' : 'STRIPES 9–15'}</span>
      <Balls ids={ui.left[seat]} />
    </div>
  );
}

function PowerBar({ p, ui }: { p: PoolMode; ui: PoolUiState }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number } | null>(null);
  const [pull, setPull] = useState<number | null>(null);
  const shown = pull ?? ui.power;
  const h = () => ref.current?.getBoundingClientRect().height ?? 240;
  return (
    <div
      ref={ref}
      className={`pl-power pointer-events-auto ${ui.myTurn ? '' : 'opacity-40'}`}
      onPointerDown={e => {
        if (!ui.myTurn) return;
        e.preventDefault();
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        drag.current = { y: e.clientY };
        setPull(0);
      }}
      onPointerMove={e => {
        const d = drag.current;
        if (d === null) return;
        const k = Math.max(0, Math.min(1, (e.clientY - d.y) / (h() * 0.85)));
        setPull(k);
        p.setPower(k);
      }}
      onPointerUp={() => {
        const k = pull;
        drag.current = null;
        setPull(null);
        if (k !== null && k > 0.02) p.shoot(k);
      }}
      onPointerCancel={() => {
        drag.current = null;
        setPull(null);
      }}
    >
      <div className="pl-power-fill" style={{ height: `${shown * 100}%` }} />
      <div className="pl-power-cue" style={{ top: `${shown * 70}%` }} />
      <span>{Math.round(shown * 100)}</span>
      <em>{pull !== null ? 'LET GO' : 'PULL'}</em>
    </div>
  );
}

function Spin({ p, ui }: { p: PoolMode; ui: PoolUiState }) {
  const ref = useRef<HTMLDivElement>(null);
  const set = (x: number, y: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (r === undefined) return;
    const sx = ((x - r.left) / r.width) * 2 - 1;
    const sy = -(((y - r.top) / r.height) * 2 - 1);
    p.setSpin(sx * 1.15, sy * 1.15);
  };
  return (
    <div className="pl-spin-wrap pointer-events-auto">
      <div
        ref={ref}
        className="pl-spin"
        onPointerDown={e => {
          e.preventDefault();
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          set(e.clientX, e.clientY);
        }}
        onPointerMove={e => {
          if (e.buttons > 0) set(e.clientX, e.clientY);
        }}
      >
        <i style={{ left: `${50 + ui.side * 38}%`, top: `${50 - ui.top * 38}%` }} />
      </div>
      <button type="button" className="pl-mini" onClick={() => p.setSpin(0, 0)}>
        {ui.side === 0 && ui.top === 0 ? 'SPIN' : 'CENTRE'}
      </button>
    </div>
  );
}

function Hud({ p, ui }: { p: PoolMode; ui: PoolUiState }) {
  const playing = ui.phase === 'playing';
  return (
    <>
      <div className="pl-top absolute left-1/2 top-3 flex -translate-x-1/2 items-start gap-2">
        <Plate ui={ui} seat={0} />
        <div className="pl-vs">8</div>
        <Plate ui={ui} seat={1} />
      </div>
      {playing && (ui.line !== '' || ui.foul !== null) && (
        <div className="pl-line absolute left-1/2 -translate-x-1/2">
          {ui.foul !== null && <div className="pl-foul">{ui.foul}</div>}
          {ui.line !== '' && <div>{ui.line}</div>}
        </div>
      )}
      <div className="pl-tools pointer-events-auto absolute left-3 top-3 flex flex-col gap-2">
        <button type="button" className="w2-chip text-xs" onClick={() => p.leave()}>
          {ui.role === 'spectator' || ui.phase === 'results' ? '✕ leave' : '🏳 leave'}
        </button>
        <button type="button" className="w2-chip text-xs" onClick={() => p.toggleCam()}>
          {ui.cam === 'aim' ? '⬒ top view' : '🎯 cue view'}
        </button>
        {ui.rolling && (
          <button
            type="button"
            className={`w2-chip text-xs ${ui.fast ? 'pl-on' : ''}`}
            onClick={() => p.toggleFast()}
          >
            ⏩ fast
          </button>
        )}
      </div>
      {playing && ui.role !== 'spectator' && (
        <>
          <PowerBar p={p} ui={ui} />
          {ui.myTurn && <Spin p={p} ui={ui} />}
          {ui.myTurn && !coarse() && (
            <button
              type="button"
              className="pl-shoot pointer-events-auto"
              onClick={() => p.shoot()}
            >
              SHOOT · SPACE
            </button>
          )}
        </>
      )}
    </>
  );
}

function Results({ p, ui }: { p: PoolMode; ui: PoolUiState }) {
  const r = ui.results!;
  const title = r.won === null ? `${r.winner.toUpperCase()} WINS` : r.won ? 'YOU WIN' : 'YOU LOSE';
  return (
    <div className="pl-results pointer-events-auto absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
      <div className={`pl-big ${r.won === false ? 'pl-lose' : ''}`}>{title}</div>
      <div className="pl-reason">{r.reason}</div>
      {r.respect !== null && r.respect !== 0 && (
        <div className="pl-respect">
          {r.respect > 0 ? '+' : ''}
          {r.respect} RESPECT
        </div>
      )}
      <div className="mt-3 flex justify-center gap-2">
        {r.host && (
          <button type="button" className="pl-go" onClick={() => p.rematch()}>
            {r.vsCpu ? 'RACK AGAIN' : 'REMATCH'}
          </button>
        )}
        <button type="button" className="pl-no" onClick={() => p.backToMenu()}>
          MENU
        </button>
        <button type="button" className="pl-no" onClick={() => p.exit()}>
          LEAVE
        </button>
      </div>
    </div>
  );
}

const CSS = `
body[data-pool] [data-nounfm="off"]{display:none!important}
.pl-root{font-family:system-ui,sans-serif}
.pl-menu{width:420px;max-width:calc(100vw - 32px);max-height:calc(100dvh - 32px);overflow-y:auto;box-shadow:8px 8px 0 #1d7a4c}
.pl-title{font-size:30px;font-weight:900;font-style:italic;letter-spacing:.02em;text-shadow:0 3px 0 #1d7a4c}
.pl-x{width:36px;height:36px;border-radius:999px;background:rgba(255,255,255,.12);font-weight:900}
.pl-tabs{display:grid;grid-template-columns:repeat(3,1fr);gap:4px}
.pl-tab{padding:9px 0;border-radius:10px;background:rgba(255,255,255,.08);font-weight:900;font-size:13px;font-style:italic}
.pl-pill{background:rgba(255,255,255,.1);border-radius:999px;padding:6px 12px;font-weight:800;font-size:12px;min-height:34px}
.pl-on{background:#ffd400!important;color:#000!important}
.pl-list{max-height:30vh;overflow-y:auto}
.pl-go{background:#1d7a4c;color:#fff;font-weight:900;font-size:18px;padding:11px 18px;border-radius:10px;box-shadow:0 4px 0 #0d3f26;font-style:italic}
.pl-no{background:rgba(255,255,255,.14);color:#fff;font-weight:800;font-size:14px;padding:10px 14px;border-radius:10px}
.pl-card{display:flex;flex-direction:column;align-items:center;gap:6px;background:#ffd400;color:#000;padding:10px 18px;box-shadow:6px 6px 0 #1d7a4c;min-width:260px;max-width:calc(100vw - 32px);text-align:center;z-index:5}
.pl-card span{font-size:10px;letter-spacing:.2em}.pl-card b{font-size:17px;font-style:italic}
.pl-card .pl-no{background:rgba(0,0,0,.15);color:#000}
.pl-bar{width:100%;height:4px;background:rgba(0,0,0,.15)}.pl-bar i{display:block;height:100%;background:#1d7a4c;transition:width .25s linear}
.pl-toast{background:#000;color:#ffd400;font-weight:900;font-style:italic;padding:8px 14px;box-shadow:4px 4px 0 #1d7a4c;max-width:calc(100vw - 32px);text-align:center;font-size:14px}
.pl-top{max-width:calc(100vw - 150px)}
.pl-plate{display:flex;flex-direction:column;gap:2px;min-width:0;width:min(210px,32vw);background:rgba(0,0,0,.72);color:#fff;padding:6px 10px;border-radius:10px;border:2px solid transparent}
.pl-plate b{font-size:14px;font-style:italic;font-weight:900;max-width:100%}
.pl-plate span{font-size:10px;letter-spacing:.12em;opacity:.75}
.pl-plate-on{border-color:#ffd400;box-shadow:0 0 18px rgba(255,212,0,.45)}
.pl-vs{width:30px;height:30px;margin-top:10px;border-radius:999px;background:#111;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;box-shadow:inset 0 0 0 7px #111,inset 0 0 0 16px #f4f1e8;font-size:11px;color:#111;flex:none}
.pl-balls{display:flex;flex-wrap:wrap;gap:2px;min-height:12px}
.pl-balls i{display:block;width:12px;height:12px;border-radius:999px;box-shadow:inset -2px -2px 0 rgba(0,0,0,.25)}
.pl-line{top:96px;display:flex;flex-direction:column;align-items:center;gap:4px;font-weight:900;font-style:italic;color:#fff;text-shadow:0 2px 0 #000,0 0 12px #000;font-size:18px;text-align:center;max-width:calc(100vw - 32px)}
.pl-foul{background:#d22209;color:#fff;padding:3px 10px;font-size:13px;text-shadow:none;letter-spacing:.06em}
.pl-power{position:absolute;right:16px;top:50%;transform:translateY(-50%);width:54px;height:min(300px,46vh);border-radius:14px;background:rgba(0,0,0,.6);border:2px solid rgba(255,255,255,.35);overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none;cursor:ns-resize}
.pl-power-fill{position:absolute;left:0;right:0;top:0;background:linear-gradient(#ffd400,#ff6a1f 70%,#d22209)}
.pl-power-cue{position:absolute;left:50%;width:10px;height:30%;margin-left:-5px;border-radius:5px;background:linear-gradient(#2f6fd0 0 6%,#f4f0e6 6% 12%,#e8cf9a 12% 70%,#5a2410 70%);box-shadow:0 0 0 2px rgba(0,0,0,.4)}
.pl-power span{position:absolute;bottom:22px;left:0;right:0;text-align:center;color:#fff;font-weight:900;font-size:16px;text-shadow:0 1px 0 #000}
.pl-power em{position:absolute;bottom:6px;left:0;right:0;text-align:center;color:#ffd400;font-style:normal;font-weight:800;font-size:9px;letter-spacing:.12em}
.pl-spin-wrap{position:absolute;right:82px;bottom:calc(20px + env(safe-area-inset-bottom));display:flex;flex-direction:column;align-items:center;gap:4px}
.pl-spin{position:relative;width:76px;height:76px;border-radius:999px;background:radial-gradient(circle at 35% 30%,#fff,#e9e4d6 55%,#b8b2a2);box-shadow:0 3px 0 rgba(0,0,0,.4);touch-action:none;cursor:crosshair}
.pl-spin:before,.pl-spin:after{content:'';position:absolute;background:rgba(0,0,0,.15)}
.pl-spin:before{left:50%;top:10%;bottom:10%;width:1px}.pl-spin:after{top:50%;left:10%;right:10%;height:1px}
.pl-spin i{position:absolute;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:999px;background:#d22209;box-shadow:0 0 0 2px #fff}
.pl-mini{background:rgba(0,0,0,.6);color:#fff;font-size:10px;font-weight:800;letter-spacing:.1em;padding:3px 8px;border-radius:999px}
.pl-shoot{position:absolute;right:16px;bottom:calc(20px + env(safe-area-inset-bottom));background:#1d7a4c;color:#fff;font-weight:900;font-style:italic;padding:10px 12px;border-radius:10px;box-shadow:0 4px 0 #0d3f26;font-size:12px}
.pl-results{background:rgba(0,0,0,.85);color:#fff;padding:18px 24px;border-radius:16px;box-shadow:8px 8px 0 #1d7a4c;max-width:calc(100vw - 32px)}
.pl-big{font-size:min(14vw,64px);font-weight:900;font-style:italic;color:#ffd400;text-shadow:0 5px 0 #1d7a4c;line-height:1}
.pl-lose{color:#ff6a5a;text-shadow:0 5px 0 #5a0f08}
.pl-reason{margin-top:6px;font-size:15px;opacity:.85}
.pl-respect{margin-top:8px;font-weight:900;color:#6cf0ff;letter-spacing:.1em}
@media (max-width:640px){
  .pl-plate{width:38vw;padding:5px 8px}
  .pl-top{max-width:calc(100vw - 16px);top:58px}
  .pl-line{top:150px;font-size:15px}
  .pl-power{width:48px;right:10px}
  .pl-spin-wrap{right:auto;left:12px}
  .pl-spin{width:68px;height:68px}
}
`;
