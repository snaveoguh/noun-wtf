// ── Noun Hide & Seek UI: prompt, chip, menu, lobby, HUD, blindfold, reveal ─

import type { HsRow, HideSeekMode, HsUiState } from './HideSeekMode';
import type { Game } from '../../Game';

import { useEffect, useState, useSyncExternalStore } from 'react';

import { HudSlot } from '../../hud/slots';
import { PING_CD, WHISTLE_CD } from '../contract';

const NOOP = () => () => {};
const SKILLS: [string, number][] = [
  ['EASY', 0.25],
  ['NORMAL', 0.55],
  ['HARD', 0.85],
];

function useHs(m: HideSeekMode | null): HsUiState | null {
  return useSyncExternalStore(m ? cb => m.subscribe(cb) : NOOP, () => m?.ui ?? null);
}

/** Re-render every `ms` while `on`. */
function useTick(on: boolean, ms = 250) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => set(n => n + 1), ms);
    return () => clearInterval(t);
  }, [on, ms]);
}

const clock = (t: number) => {
  const s = Math.max(0, Math.ceil(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const coarse = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;

export function HideSeekUi({ game, touch }: { game: Game; touch: boolean }) {
  const m = game.hideseek;
  const ui = useHs(m)!;
  const now = performance.now();
  useTick(ui.toast !== null);
  const g = ui.game;
  const seeking = g !== null && (g.me === 's' || g.me === 'f');

  // Keys (capture phase, so the skate controls never see them): E at the
  // spot opens the menu; in a game E tags, Q whistles (hider) / pings (seeker)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el !== null && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return;
      if (game.paused || e.repeat) return;
      const u = m.ui;
      if (e.code === 'KeyE' && u.near && u.phase === 'idle') {
        e.preventDefault();
        e.stopPropagation();
        m.openMenu();
      } else if (u.phase === 'playing' && u.game !== null) {
        if (e.code === 'KeyE' && u.game.canTag) {
          e.preventDefault();
          e.stopPropagation();
          m.tagNow();
        } else if (e.code === 'KeyQ' && u.game.gamePhase === 'seek') {
          e.preventDefault();
          e.stopPropagation();
          if (u.game.me === 'h') m.whistleNow();
          else m.pingNow();
        }
      } else if (e.code === 'Escape' && u.phase === 'menu') {
        e.preventDefault();
        e.stopPropagation();
        m.closeMenu();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [game, m]);

  return (
    <div className="hs-root pointer-events-none absolute inset-0">
      <style>{CSS}</style>

      {g?.blind === true && <Blindfold t={g.t} round={g.round} rounds={g.rounds} />}

      {ui.near && ui.phase === 'idle' && (
        <HudSlot name="toasts">
          <button
            type="button"
            className="hs-prompt pointer-events-auto absolute left-1/2 top-[30%] -translate-x-1/2"
            onClick={() => m.openMenu()}
          >
            🙈 HIDE &amp; SEEK — press E / tap
          </button>
        </HudSlot>
      )}

      {(ui.phase === 'idle' || ui.phase === 'done') && ui.hasSpot && !ui.near && (
        <HudSlot name="modes">
          <button
            type="button"
            className={`hs-chip pointer-events-auto absolute ${touch ? 'hs-chip-touch' : ''}`}
            onClick={() => m.openMenu()}
            title="Hide & Seek"
          >
            🙈<span> HIDE &amp; SEEK</span>
            {ui.open.some(o => o.state === 'lobby') && <i className="hs-dot" />}
          </button>
        </HudSlot>
      )}

      {ui.phase === 'menu' && <Menu m={m} ui={ui} />}
      {ui.phase === 'lobby' && <Lobby m={m} ui={ui} />}
      {ui.phase === 'playing' && g !== null && (
        <Hud m={m} ui={ui} touch={touch} seeking={seeking} />
      )}
      {ui.phase === 'done' && ui.done !== null && <Done m={m} ui={ui} />}

      {ui.toast !== null && now - ui.toast.at < 4000 && (
        <HudSlot name="toasts">
          <div key={ui.toast.at} className="hs-toast absolute left-1/2 top-36 -translate-x-1/2">
            <span>🙈 HIDE &amp; SEEK</span>
            <b>{ui.toast.text}</b>
          </div>
        </HudSlot>
      )}
    </div>
  );
}

function Blindfold({ t, round, rounds }: { t: number; round: number; rounds: number }) {
  return (
    <div className="hs-blind pointer-events-auto absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
      <span className="hs-eyebrow">
        ROUND {round + 1} / {rounds} · YOU&apos;RE IT
      </span>
      <b className="hs-count">{Math.max(0, Math.ceil(t))}</b>
      <p>eyes shut… counting… no peeking 🙈</p>
      <p className="opacity-60">the hiders are running, climbing and sneaking into buildings</p>
    </div>
  );
}

function Hud({
  m,
  ui,
  touch,
  seeking,
}: {
  m: HideSeekMode;
  ui: HsUiState;
  touch: boolean;
  seeking: boolean;
}) {
  const g = ui.game!;
  const role = g.me === 'h' ? '🙈 HIDING' : g.me === 'f' ? '🔎 FOUND · SEEKING' : '👀 SEEKING';
  const phase =
    g.gamePhase === 'hide'
      ? 'HIDE'
      : g.gamePhase === 'seek'
        ? 'SEEK'
        : g.gamePhase === 'reveal'
          ? 'REVEAL'
          : 'OVER';
  const big = touch || coarse();
  return (
    <>
      <HudSlot name="toasts">
        <div
          className={`hs-bar absolute left-1/2 -translate-x-1/2 ${g.me === 'h' ? 'hs-bar-h' : 'hs-bar-s'}`}
        >
          <b>{role}</b>
          <span className="hs-time">
            {phase} {g.gamePhase === 'reveal' ? `· next in ${Math.ceil(g.t)}` : clock(g.t)}
          </span>
          <span>
            hiders left <b>{g.hidersLeft}</b>/{g.hiders}
          </span>
          <span className="opacity-70">
            round {g.round + 1}/{g.rounds}
          </span>
        </div>
      </HudSlot>

      <HudSlot name="modes">
        <button
          type="button"
          className="w2-chip hs-leave pointer-events-auto absolute text-xs"
          onClick={() => m.leave()}
        >
          ✕ leave game
        </button>
      </HudSlot>

      {g.gamePhase === 'hide' && g.me === 'h' && (
        <HudSlot name="toasts">
          <div className="hs-tip absolute left-1/2 -translate-x-1/2">
            run! climb a roof, duck behind something, or slip into a building. your name tag is
            hidden
          </div>
        </HudSlot>
      )}

      {g.gamePhase === 'seek' && (
        <div
          className={`hs-acts pointer-events-auto absolute flex gap-2 ${big ? 'hs-acts-big' : ''}`}
        >
          {seeking && (
            <button
              type="button"
              className={`hs-act ${g.canTag ? 'hs-hot' : ''}`}
              disabled={!g.canTag}
              onClick={() => m.tagNow()}
            >
              ✋ TAG<small>{big ? '' : ' E'}</small>
            </button>
          )}
          {seeking && (
            <button
              type="button"
              className="hs-act"
              disabled={g.pingCd > 0}
              onClick={() => m.pingNow()}
            >
              📡 {g.pingCd > 0 ? `${Math.ceil(g.pingCd)}s` : 'PING'}
              <small>{big ? '' : ' Q'}</small>
              <i style={{ width: `${(1 - g.pingCd / PING_CD) * 100}%` }} />
            </button>
          )}
          {g.me === 'h' && (
            <button
              type="button"
              className="hs-act"
              disabled={g.whistleCd > 0}
              onClick={() => m.whistleNow()}
            >
              🎵 {g.whistleCd > 0 ? `${Math.ceil(g.whistleCd)}s` : 'WHISTLE +2'}
              <small>{big ? '' : ' Q'}</small>
              <i style={{ width: `${(1 - g.whistleCd / WHISTLE_CD) * 100}%` }} />
            </button>
          )}
        </div>
      )}
      {g.me === 'h' && g.blending && (
        <div className="hs-blend absolute left-1/2 -translate-x-1/2">
          🫥 blending in: stay still
        </div>
      )}

      {g.gamePhase === 'reveal' && (
        <Scores
          rows={g.rows}
          title={g.win === 'hiders' ? 'HIDERS WIN' : 'SEEKERS WIN'}
          note="the pillars show where everyone hid"
        />
      )}
    </>
  );
}

function Scores({ rows, title, note }: { rows: HsRow[]; title: string; note?: string }) {
  return (
    <div className="hs-scores w2-panel pointer-events-auto absolute left-1/2 -translate-x-1/2">
      <div className="hs-title">{title}</div>
      {note !== undefined && <div className="mb-2 text-xs opacity-70">{note}</div>}
      <table>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className={r.me ? 'hs-me' : ''}>
              <td>{i + 1}</td>
              <td className="hs-name">
                {r.name}
                {r.cpu ? ' 🤖' : ''}
              </td>
              <td>
                {r.st === 'h' ? (
                  <span className="hs-tag hs-tag-h">HID ✔</span>
                ) : r.st === 'f' ? (
                  <span className="hs-tag hs-tag-f">FOUND</span>
                ) : r.st === 's' ? (
                  <span className="hs-tag hs-tag-s">SEEKER</span>
                ) : (
                  <span className="hs-tag">LEFT</span>
                )}
              </td>
              <td className="hs-pts">{r.score}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Done({ m, ui }: { m: HideSeekMode; ui: HsUiState }) {
  const d = ui.done!;
  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/40">
      <div className="hs-menu w2-panel">
        <div className="hs-title">{d.why === 'over' ? 'GAME OVER' : 'GAME ENDED'}</div>
        {d.respect > 0 && <div className="mb-2 text-sm text-[#3dff8a]">+{d.respect} respect</div>}
        <ScoreTable rows={d.rows} />
        <div className="mt-3 flex gap-2">
          {d.host && (
            <button type="button" className="hs-go flex-1" onClick={() => m.playAgain()}>
              PLAY AGAIN
            </button>
          )}
          {!d.host && d.why === 'over' && ui.roster.length > 0 && (
            <div className="flex-1 self-center text-xs opacity-70">
              waiting for the host to play again…
            </div>
          )}
          <button type="button" className="hs-no" onClick={() => m.closeDone()}>
            CLOSE
          </button>
        </div>
      </div>
    </div>
  );
}

function ScoreTable({ rows }: { rows: HsRow[] }) {
  return (
    <table className="hs-table">
      <tbody>
        {rows.map((r, i) => (
          <tr key={r.id} className={r.me ? 'hs-me' : ''}>
            <td>{i + 1}</td>
            <td className="hs-name">
              {r.name}
              {r.cpu ? ' 🤖' : ''}
            </td>
            <td className="hs-pts">{r.score}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Pills<T>({
  value,
  set,
  options,
}: {
  value: T;
  set: (v: T) => void;
  options: [string, T][];
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map(([label, v]) => (
        <button
          key={label}
          type="button"
          className={`hs-pill ${v === value ? 'hs-on' : ''}`}
          onClick={() => set(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function Menu({ m, ui }: { m: HideSeekMode; ui: HsUiState }) {
  const [tab, setTab] = useState<'cpu' | 'online'>('cpu');
  const [cpu, setCpu] = useState(5);
  const [seekers, setSeekers] = useState(1);
  const [rounds, setRounds] = useState(3);
  const [skill, setSkill] = useState(0.55);
  const [role, setRole] = useState<'random' | 'hide' | 'seek'>('hide');
  const [fill, setFill] = useState(0);
  return (
    <div
      className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/40"
      onClick={() => m.closeMenu()}
    >
      <div className="hs-menu w2-panel" onClick={e => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between">
          <div className="hs-title">🙈 HIDE &amp; SEEK</div>
          <button type="button" className="hs-x" onClick={() => m.closeMenu()} aria-label="close">
            ✕
          </button>
        </div>
        <ul className="hs-how">
          <li>
            <b>seekers</b> count blind while <b>hiders</b> run, climb roofs, duck behind things or
            slip into a building
          </li>
          <li>
            seekers <b>tag</b> hiders up close (E). found hiders <b>join the seekers</b>
          </li>
          <li>hiders win if anyone&apos;s still hidden when time runs out</li>
          <li>hiders&apos; name tags are hidden. hold still to blend in, whistle (Q) for points</li>
        </ul>
        <div className="hs-tabs my-2">
          <button
            type="button"
            className={`hs-tab ${tab === 'cpu' ? 'hs-on' : ''}`}
            onClick={() => setTab('cpu')}
          >
            VS CPU
          </button>
          <button
            type="button"
            className={`hs-tab ${tab === 'online' ? 'hs-on' : ''}`}
            onClick={() => setTab('online')}
          >
            ONLINE
          </button>
        </div>
        {tab === 'cpu' ? (
          <div className="flex flex-col gap-2">
            <Row label="CPU players">
              <Pills
                value={cpu}
                set={setCpu}
                options={[
                  ['3', 3],
                  ['5', 5],
                  ['7', 7],
                  ['11', 11],
                ]}
              />
            </Row>
            <Row label="Seekers">
              <Pills
                value={seekers}
                set={setSeekers}
                options={[
                  ['1', 1],
                  ['2', 2],
                ]}
              />
            </Row>
            <Row label="Rounds">
              <Pills
                value={rounds}
                set={setRounds}
                options={[
                  ['1', 1],
                  ['3', 3],
                  ['5', 5],
                ]}
              />
            </Row>
            <Row label="CPUs">
              <Pills value={skill} set={setSkill} options={SKILLS} />
            </Row>
            <Row label="First round, I">
              <Pills
                value={role}
                set={setRole}
                options={[
                  ['HIDE', 'hide'],
                  ['SEEK', 'seek'],
                  ['RANDOM', 'random'],
                ]}
              />
            </Row>
            <button
              type="button"
              className="hs-go mt-1"
              onClick={() => m.vsCpu({ cpu, seekers, rounds, skill, role })}
            >
              PLAY
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {!ui.online && (
              <div className="text-xs opacity-70">offline: online games need the live room</div>
            )}
            <div className="hs-sub">OPEN GAMES</div>
            <div className="hs-list flex flex-col gap-1">
              {ui.open.length === 0 && (
                <div className="text-xs opacity-60">nobody&apos;s hosting right now</div>
              )}
              {ui.open.map(o => (
                <div key={o.gid} className="hs-game">
                  <div className="min-w-0 flex-1">
                    <b>{o.hostName}&apos;s game</b>
                    <span>
                      {o.n}/{o.max} · {o.state === 'live' ? 'playing' : 'in the lobby'}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="hs-pill hs-on"
                    disabled={o.state !== 'lobby' || o.n >= o.max}
                    onClick={() => m.join(o.gid)}
                  >
                    JOIN
                  </button>
                </div>
              ))}
            </div>
            <div className="hs-sub mt-1">HOST A GAME (2–12 players)</div>
            <Row label="CPU fill">
              <Pills
                value={fill}
                set={setFill}
                options={[
                  ['0', 0],
                  ['2', 2],
                  ['4', 4],
                  ['6', 6],
                ]}
              />
            </Row>
            <Row label="Seekers">
              <Pills
                value={seekers}
                set={setSeekers}
                options={[
                  ['1', 1],
                  ['2', 2],
                ]}
              />
            </Row>
            <Row label="Rounds">
              <Pills
                value={rounds}
                set={setRounds}
                options={[
                  ['1', 1],
                  ['3', 3],
                  ['5', 5],
                ]}
              />
            </Row>
            <button
              type="button"
              className="hs-go mt-1"
              disabled={!ui.online}
              onClick={() => m.hostGame({ cpu: fill, seekers, rounds })}
            >
              HOST
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs opacity-80">{label}</span>
      {children}
    </div>
  );
}

function Lobby({ m, ui }: { m: HideSeekMode; ui: HsUiState }) {
  return (
    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/40">
      <div className="hs-menu w2-panel">
        <div className="hs-title mb-1">🙈 {ui.host ? 'YOUR GAME' : 'JOINED'}</div>
        {ui.waiting !== null ? (
          <div className="text-sm">{ui.waiting}</div>
        ) : (
          <>
            <div className="hs-sub">PLAYERS {ui.roster.length + (ui.host ? ui.fill : 0)}/12</div>
            <div className="hs-list flex flex-col gap-1">
              {ui.roster.map(p => (
                <div key={p.id} className="hs-game">
                  <b className="flex-1">{p.name}</b>
                </div>
              ))}
              {ui.host && ui.fill > 0 && (
                <div className="hs-game opacity-70">
                  <b className="flex-1">+{ui.fill} CPU 🤖</b>
                </div>
              )}
            </div>
            {ui.host ? (
              <>
                <Row label="CPU fill">
                  <Pills
                    value={ui.fill}
                    set={n => m.setFill(n)}
                    options={[
                      ['0', 0],
                      ['2', 2],
                      ['4', 4],
                      ['6', 6],
                    ]}
                  />
                </Row>
                <div className="text-xs opacity-60">
                  anyone in the room can join from their 🙈 menu
                </div>
                <button
                  type="button"
                  className="hs-go mt-2"
                  disabled={ui.roster.length + ui.fill < 2}
                  onClick={() => m.startHosted()}
                >
                  START
                </button>
              </>
            ) : (
              <div className="mt-2 text-xs opacity-70">waiting for the host to start…</div>
            )}
          </>
        )}
        <button type="button" className="hs-no mt-2 w-full" onClick={() => m.leaveLobby()}>
          {ui.host ? 'CLOSE GAME' : 'LEAVE'}
        </button>
      </div>
    </div>
  );
}

const CSS = `
.hs-root{font-family:system-ui,sans-serif}
.hs-prompt{background:#b26bff;color:#fff;padding:12px 20px;font-size:18px;font-weight:900;font-style:italic;box-shadow:6px 6px 0 #2a0b55;white-space:nowrap;max-width:calc(100vw - 32px)}
.hs-chip{left:12px;top:calc(118px + env(safe-area-inset-top));display:flex;align-items:center;gap:2px;background:rgba(20,10,40,.72);border:1px solid #b26bff;color:#fff;border-radius:999px;padding:5px 11px;font-size:12px;font-weight:900;font-style:italic;backdrop-filter:blur(6px)}
.hs-chip-touch{top:calc(150px + env(safe-area-inset-top))}
.hs-chip-touch span{display:none}
.hs-dot{display:block;width:8px;height:8px;border-radius:999px;background:#3dff8a;margin-left:5px;box-shadow:0 0 8px #3dff8a}
.hs-menu{width:420px;max-width:calc(100vw - 32px);max-height:calc(100dvh - 32px);overflow-y:auto}
.hs-title{font-size:26px;font-weight:900;font-style:italic;letter-spacing:.02em;text-shadow:0 3px 0 #6b2bd0}
.hs-sub{font-size:11px;letter-spacing:.2em;font-weight:900;opacity:.7}
.hs-x{width:36px;height:36px;border-radius:999px;background:rgba(255,255,255,.12);font-weight:900}
.hs-how{margin:0;padding-left:18px;list-style:disc;font-size:13px;line-height:1.35;opacity:.9}
.hs-how b{color:#d3b0ff}
.hs-tabs{display:grid;grid-template-columns:1fr 1fr;gap:4px}
.hs-tab{padding:9px 0;border-radius:10px;background:rgba(255,255,255,.08);font-weight:900;font-size:13px;font-style:italic}
.hs-pill{background:rgba(255,255,255,.1);border-radius:999px;padding:6px 12px;font-weight:700;font-size:12px;min-height:32px;min-width:36px}
.hs-pill:disabled{opacity:.4}
.hs-on{background:#b26bff!important;color:#fff!important}
.hs-list{max-height:26vh;overflow-y:auto}
.hs-game{display:flex;align-items:center;gap:8px;background:rgba(255,255,255,.07);border-radius:10px;padding:6px 10px}
.hs-game b{display:block;font-size:14px;font-style:italic;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hs-game span{display:block;font-size:11px;opacity:.7}
.hs-go{background:#b26bff;color:#fff;font-weight:900;font-size:18px;padding:10px 16px;border-radius:10px;box-shadow:0 4px 0 #4b1a94;font-style:italic}
.hs-go:disabled{opacity:.45}
.hs-no{background:rgba(255,255,255,.12);color:#fff;font-weight:800;font-size:14px;padding:10px 14px;border-radius:10px}
.hs-toast{display:flex;flex-direction:column;align-items:center;gap:2px;background:#b26bff;color:#fff;padding:8px 16px;box-shadow:5px 5px 0 #2a0b55;max-width:calc(100vw - 32px);text-align:center;animation:hspop .25s ease-out both}
.hs-toast span{font-size:10px;letter-spacing:.2em;opacity:.85}.hs-toast b{font-size:16px;font-style:italic}
@keyframes hspop{0%{transform:translate(-50%,8px) scale(.94);opacity:0}100%{transform:translate(-50%,0) scale(1);opacity:1}}
.hs-bar{top:calc(10px + env(safe-area-inset-top));display:flex;align-items:center;gap:12px;padding:6px 14px;border-radius:999px;font-size:13px;white-space:nowrap;box-shadow:0 6px 20px rgba(0,0,0,.35);max-width:calc(100vw - 24px)}
.hs-bar-h{background:rgba(20,70,40,.88);border:1px solid #3dff8a}
.hs-bar-s{background:rgba(80,20,20,.88);border:1px solid #ff6b5b}
.hs-bar b{font-style:italic;font-weight:900}
.hs-time{font-variant-numeric:tabular-nums;font-weight:900;font-size:16px}
.hs-leave{left:12px;top:calc(118px + env(safe-area-inset-top))}
.hs-tip{top:calc(54px + env(safe-area-inset-top));background:rgba(0,0,0,.6);padding:5px 12px;border-radius:10px;font-size:12px;max-width:calc(100vw - 32px);text-align:center}
.hs-acts{right:16px;bottom:calc(150px + env(safe-area-inset-bottom))}
.hs-acts-big{bottom:calc(250px + env(safe-area-inset-bottom));flex-direction:column}
.hs-act{position:relative;overflow:hidden;background:rgba(0,0,0,.6);border:2px solid rgba(255,255,255,.3);color:#fff;font-weight:900;font-style:italic;font-size:15px;padding:10px 14px;border-radius:14px;min-width:96px}
.hs-act small{opacity:.6;font-size:11px}
.hs-act i{position:absolute;left:0;bottom:0;height:3px;background:#b26bff}
.hs-act:disabled{opacity:.55}
.hs-hot{background:#ff4d3d;border-color:#fff;box-shadow:0 0 18px #ff4d3d;animation:hshot .6s ease-in-out infinite alternate}
@keyframes hshot{to{transform:scale(1.07)}}
.hs-blend{bottom:calc(120px + env(safe-area-inset-bottom));background:rgba(0,0,0,.55);padding:4px 12px;border-radius:999px;font-size:12px}
.hs-blind{background:#000;z-index:60;color:#fff}
.hs-eyebrow{font-size:12px;letter-spacing:.3em;color:#b26bff;font-weight:900}
.hs-count{font-size:min(34vw,200px);font-weight:900;font-style:italic;line-height:1;color:#fff;text-shadow:0 8px 0 #6b2bd0;font-variant-numeric:tabular-nums}
.hs-blind p{font-size:16px;max-width:min(460px,calc(100vw - 32px))}
.hs-scores{bottom:calc(110px + env(safe-area-inset-bottom));width:min(380px,calc(100vw - 32px));max-height:42vh;overflow-y:auto}
.hs-scores table,.hs-table{width:100%;font-size:13px;border-collapse:collapse}
.hs-scores td,.hs-table td{padding:3px 4px}
.hs-name{max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hs-pts{text-align:right;font-weight:900;font-variant-numeric:tabular-nums}
.hs-me{background:rgba(178,107,255,.25)}
.hs-tag{font-size:10px;font-weight:900;letter-spacing:.06em;padding:1px 6px;border-radius:6px;background:rgba(255,255,255,.12)}
.hs-tag-h{background:#1d6b3c;color:#bfffd6}.hs-tag-f{background:#7a1d16;color:#ffd0cb}.hs-tag-s{background:#6b5a00;color:#fff3a6}
.hs-reveal-tag span{font-weight:700}
`;
