// ── Noun Football UI: the PLAY chip, menu, pause, results, touch pad ─────
//
// Reads FootballMode.ui (a small store) and calls FootballMode's actions;
// the match HUD itself (scoreboard, radar, power bar, banners) is the
// view's FootballHud (football/view), mounted here while the view exists.

import type { FootballMode, FootballUiState, MatchKind } from './FootballMode';
import type { Game } from '../../Game';
import type { Difficulty, TeamId, TeamSize } from '../contract';
import type { FootballTouchPad } from './input';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { DIFFICULTY_NAMES } from '../contract';
import { KITS } from '../sim/setup';
import { FootballHud } from '../view/FootballHud';

import { fixtureWinner, myFixture, roundName, table } from './cup';
import { INVITE_MS } from './lobby';

const NOOP = () => () => {};
const SIZES: TeamSize[] = [5, 7, 11];
const DIFFS: Difficulty[] = [1, 2, 3, 4];
const HALVES = [2, 4, 6, 8];
type Tab = 'play' | 'cup' | 'watch' | 'online';

function useFootball(f: FootballMode | null): FootballUiState | null {
  return useSyncExternalStore(f !== null ? cb => f.subscribe(cb) : NOOP, () => f?.ui ?? null);
}

/** World2Page: hide the skate HUD + touch pad while football has the frame. */
export function useFootballActive(game: Game | null): boolean {
  const ui = useFootball(game?.football ?? null);
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

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

function Kit({ i }: { i: number }) {
  const k = KITS[i % KITS.length];
  return (
    <span
      className="fb-kit"
      style={{ background: hex(k.shirt), boxShadow: `inset 0 -8px 0 ${hex(k.shorts)}` }}
    >
      {k.short}
    </span>
  );
}

export function FootballUi({ game }: { game: Game }) {
  const f = game.football;
  const ui = useFootball(f)!;
  const now = performance.now();
  useTick(ui.incoming !== null || ui.toast !== null);
  const at = ui.phase !== 'idle';
  useEffect(() => {
    if (!at) return;
    document.body.dataset.football = '1';
    return () => {
      delete document.body.dataset.football;
    };
  }, [at]);
  const showToast = ui.toast !== null && now - ui.toast.at < 3200;
  return (
    <div className="fb-root pointer-events-none absolute inset-0">
      <style>{CSS}</style>
      {ui.incoming !== null && (
        <div className="fb-card pointer-events-auto absolute left-1/2 top-20 -translate-x-1/2">
          <span>⚽ NOUN FOOTBALL</span>
          <b>
            {ui.incoming.name} wants a {ui.incoming.coop ? 'co-op' : '1v1'} {ui.incoming.size}
            -a-side
          </b>
          <div className="fb-bar">
            <i
              style={{
                width: `${Math.max(0, 100 - ((now - (f.lobby.incoming?.t ?? now)) / INVITE_MS) * 100)}%`,
              }}
            />
          </div>
          <div className="flex gap-2">
            <button type="button" className="fb-go" onClick={() => f.acceptInvite()}>
              ACCEPT
            </button>
            <button type="button" className="fb-no" onClick={() => f.declineInvite()}>
              DECLINE
            </button>
          </div>
        </div>
      )}
      {ui.phase === 'idle' && ui.near && (
        <button
          type="button"
          data-fb-play
          className="fb-chip pointer-events-auto absolute left-1/2 -translate-x-1/2"
          onClick={() => f.arrive()}
        >
          ⚽ NOUN STADIUM · PLAY
        </button>
      )}
      {ui.phase === 'loading' && (
        <div className="fb-load absolute inset-0 flex flex-col items-center justify-center">
          <div className="fb-title">NOUN STADIUM</div>
          <div className="fb-bar fb-loadbar">
            <i style={{ width: `${Math.round(ui.progress * 100)}%` }} />
          </div>
          <span className="fb-sub">THE TEAMS ARE IN THE TUNNEL…</span>
        </div>
      )}
      {(ui.phase === 'playing' || ui.phase === 'results') && f.view !== null && (
        <FootballHud hud={f.view.hud} onSkipReplay={() => f.view?.stopReplay()} />
      )}
      {ui.phase === 'playing' && !ui.paused && <MatchButtons f={f} ui={ui} />}
      {ui.phase === 'playing' &&
        !ui.paused &&
        ui.myTeam !== null &&
        (coarse() || ui.device === 'touch') && <TouchPad pad={f.input.touch} />}
      {ui.phase === 'menu' && <Menu f={f} ui={ui} />}
      {ui.phase === 'playing' && ui.paused && <Pause f={f} ui={ui} />}
      {ui.phase === 'results' && ui.results !== null && <Results f={f} ui={ui} />}
      {showToast && (
        <div className="fb-toast absolute left-1/2 top-32 -translate-x-1/2">{ui.toast!.text}</div>
      )}
    </div>
  );
}

function MatchButtons({ f, ui }: { f: FootballMode; ui: FootballUiState }) {
  return (
    <div className="fb-tools pointer-events-auto absolute flex gap-2">
      <button
        type="button"
        className="fb-mini"
        onClick={() => f.cycleCam()}
        title="camera (H / BACK)"
      >
        🎥 {ui.cam.toUpperCase()}
      </button>
      <button
        type="button"
        className="fb-mini"
        onClick={() => f.setPaused(true)}
        title="pause (Esc / START)"
      >
        ⏸
      </button>
    </div>
  );
}

function Pill<T>({ v, on, set, label }: { v: T; on: boolean; set: (v: T) => void; label: string }) {
  return (
    <button type="button" className={`fb-pill ${on ? 'fb-on' : ''}`} onClick={() => set(v)}>
      {label}
    </button>
  );
}

function Options({ f, ui, cpu = true }: { f: FootballMode; ui: FootballUiState; cpu?: boolean }) {
  const step = (k: 'kit' | 'oppKit', d: number) => {
    let v = (ui[k] + d + KITS.length) % KITS.length;
    if (v === (k === 'kit' ? ui.oppKit : ui.kit)) v = (v + d + KITS.length) % KITS.length;
    f.setOption({ [k]: v });
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="fb-row">
        <span>SIDE</span>
        {SIZES.map(s => (
          <Pill
            key={s}
            v={s}
            on={ui.size === s}
            set={v => f.setOption({ size: v })}
            label={`${s}-A-SIDE`}
          />
        ))}
      </div>
      {cpu && (
        <div className="fb-row">
          <span>CPU</span>
          {DIFFS.map(d => (
            <Pill
              key={d}
              v={d}
              on={ui.difficulty === d}
              set={v => f.setOption({ difficulty: v })}
              label={DIFFICULTY_NAMES[d]}
            />
          ))}
        </div>
      )}
      <div className="fb-row">
        <span>HALVES</span>
        {HALVES.map(h => (
          <Pill
            key={h}
            v={h}
            on={ui.halfMinutes === h}
            set={v => f.setOption({ halfMinutes: v })}
            label={`${h} MIN`}
          />
        ))}
      </div>
      <div className="fb-row">
        <span>CLUBS</span>
        <button type="button" className="fb-pill" onClick={() => step('kit', -1)}>
          ◀
        </button>
        <Kit i={ui.kit} />
        <button type="button" className="fb-pill" onClick={() => step('kit', 1)}>
          ▶
        </button>
        <b className="fb-vs">VS</b>
        <button type="button" className="fb-pill" onClick={() => step('oppKit', -1)}>
          ◀
        </button>
        <Kit i={ui.oppKit} />
        <button type="button" className="fb-pill" onClick={() => step('oppKit', 1)}>
          ▶
        </button>
      </div>
    </div>
  );
}

function Menu({ f, ui }: { f: FootballMode; ui: FootballUiState }) {
  const [tab, setTab] = useState<Tab>('play');
  const [help, setHelp] = useState(false);
  return (
    <div className="fb-menu pointer-events-auto absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col gap-3 bg-black/85 p-5 text-white">
      <div className="flex items-center justify-between">
        <div className="fb-title">NOUN FOOTBALL</div>
        <button type="button" className="fb-x" onClick={() => f.leave()} aria-label="leave">
          ✕
        </button>
      </div>
      <div className="fb-tabs">
        {(
          [
            ['play', 'KICK OFF'],
            ['cup', 'CUP'],
            ['watch', 'WATCH'],
            ['online', 'ONLINE'],
          ] as [Tab, string][]
        ).map(([t, l]) => (
          <button
            key={t}
            type="button"
            className={`fb-tab ${tab === t ? 'fb-on' : ''}`}
            onClick={() => setTab(t)}
          >
            {l}
          </button>
        ))}
      </div>
      {tab === 'play' && (
        <>
          <Options f={f} ui={ui} />
          <button type="button" className="fb-go" data-fb-start onClick={() => f.vsCpu()}>
            ⚽ KICK OFF VS CPU
          </button>
        </>
      )}
      {tab === 'cup' && <CupTab f={f} ui={ui} />}
      {tab === 'watch' && (
        <>
          <Options f={f} ui={ui} />
          <button type="button" className="fb-go" onClick={() => f.watch()}>
            📺 WATCH CPU V CPU
          </button>
        </>
      )}
      {tab === 'online' && <OnlineTab f={f} ui={ui} />}
      <button type="button" className="fb-no" onClick={() => setHelp(!help)}>
        {help ? 'HIDE CONTROLS' : 'CONTROLS'}
      </button>
      {help && <Controls />}
    </div>
  );
}

function CupTab({ f, ui }: { f: FootballMode; ui: FootballUiState }) {
  const c = ui.cup;
  if (c === null)
    return (
      <>
        <Options f={f} ui={ui} />
        <div className="flex gap-2">
          <button type="button" className="fb-go flex-1" onClick={() => f.newCup('cup')}>
            🏆 NEW CUP
          </button>
          <button type="button" className="fb-go flex-1" onClick={() => f.newCup('season')}>
            📅 NEW SEASON
          </button>
        </div>
        <span className="fb-sub">
          CUP: 8 clubs, knockout. SEASON: 4 clubs, everyone plays everyone.
        </span>
      </>
    );
  const fx = myFixture(c);
  return (
    <div className="flex flex-col gap-2">
      <div className="fb-row">
        <span>{c.kind === 'cup' ? 'THE CUP' : 'THE SEASON'}</span>
        <Kit i={c.me} />
        <b>{c.done ? 'FINISHED' : roundName(c)}</b>
      </div>
      {c.kind === 'season' ? (
        <table className="fb-table">
          <tbody>
            <tr>
              <th />
              <th>P</th>
              <th>W</th>
              <th>D</th>
              <th>L</th>
              <th>GD</th>
              <th>PTS</th>
            </tr>
            {table(c).map(r => (
              <tr key={r.club} className={r.club === c.me ? 'fb-me' : ''}>
                <td>{KITS[r.club].short}</td>
                <td>{r.p}</td>
                <td>{r.w}</td>
                <td>{r.d}</td>
                <td>{r.l}</td>
                <td>{r.gf - r.ga}</td>
                <td>{r.pts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="fb-bracket">
          {c.rounds.map((r, i) => (
            <div key={i} className="flex flex-col gap-1">
              {r.map((g, k) => (
                <div
                  key={k}
                  className={`fb-fix ${g.home === c.me || g.away === c.me ? 'fb-me' : ''}`}
                >
                  {KITS[g.home].short} {g.score ? `${g.score[0]}–${g.score[1]}` : 'v'}{' '}
                  {KITS[g.away].short}
                  {g.pens ? ` (${g.pens[0]}–${g.pens[1]} p)` : ''}
                  {g.score && fixtureWinner(g) === c.me ? ' ✓' : ''}
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {c.done && (
        <b className="fb-champ">
          {c.winner === c.me ? '🏆 CHAMPIONS!' : `${KITS[c.winner ?? 0].name.toUpperCase()} WON IT`}
        </b>
      )}
      {fx !== null && (
        <button type="button" className="fb-go" onClick={() => f.playCup()}>
          ⚽ PLAY {KITS[fx.home].short} V {KITS[fx.away].short}
        </button>
      )}
      <button type="button" className="fb-no" onClick={() => f.abandonCup()}>
        {c.done ? 'NEW COMPETITION' : 'ABANDON'}
      </button>
    </div>
  );
}

function OnlineTab({ f, ui }: { f: FootballMode; ui: FootballUiState }) {
  if (!ui.online)
    return (
      <span className="fb-sub">
        Not connected to the multiplayer server right now. VS CPU, the cup and WATCH work offline.
      </span>
    );
  if (ui.hosting !== null) {
    const teams: TeamId[] = [0, 1];
    return (
      <div className="flex flex-col gap-2">
        <span className="fb-sub">
          Your lobby ({ui.size}-a-side). Same team = co-op, different teams = versus. The CPU fills
          the rest.
        </span>
        {teams.map(t => (
          <div key={t} className="fb-row">
            <Kit i={t === 0 ? ui.kit : ui.oppKit} />
            {ui
              .hosting!.players.filter(p => p.team === t)
              .map(p => (
                <button
                  key={p.id}
                  type="button"
                  className="fb-pill"
                  onClick={() => f.setLobbyTeam(p.id, (1 - t) as TeamId)}
                >
                  {p.name} ⇄
                </button>
              ))}
          </div>
        ))}
        {ui.nearPlayers.length > 0 && (
          <div className="fb-row">
            <span>INVITE</span>
            {ui.nearPlayers.map(p => (
              <button
                key={p.id}
                type="button"
                className="fb-pill"
                onClick={() => f.challenge(p.id, p.name)}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}
        <button type="button" className="fb-go" onClick={() => f.startOnline()}>
          ⚽ START MATCH
        </button>
        <button type="button" className="fb-no" onClick={() => f.leaveLobby()}>
          CLOSE LOBBY
        </button>
      </div>
    );
  }
  if (ui.joined !== null)
    return (
      <div className="flex flex-col gap-2">
        <span className="fb-sub">
          In the lobby on team {ui.joined.team + 1}. Waiting for the host to start…
        </span>
        <button type="button" className="fb-no" onClick={() => f.leaveLobby()}>
          LEAVE LOBBY
        </button>
      </div>
    );
  return (
    <div className="flex flex-col gap-2">
      <Options f={f} ui={ui} cpu />
      <button type="button" className="fb-go" onClick={() => f.hostLobby()}>
        🏟 HOST A LOBBY
      </button>
      {ui.outgoing !== null && <span className="fb-sub">Waiting for {ui.outgoing.name}…</span>}
      {ui.nearPlayers.length > 0 && (
        <div className="fb-row">
          <span>1V1</span>
          {ui.nearPlayers.map(p => (
            <button
              key={p.id}
              type="button"
              className="fb-pill"
              onClick={() => f.challenge(p.id, p.name)}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
      <div className="fb-list flex flex-col gap-1">
        {ui.lobbies.length === 0 && (
          <span className="fb-sub">No lobbies or live matches right now.</span>
        )}
        {ui.lobbies.map(l => (
          <div key={l.gid} className="fb-row">
            <b>
              {l.hostName} · {l.size}-a-side{' '}
              {l.live ? `· LIVE ${l.score?.[0] ?? 0}–${l.score?.[1] ?? 0}` : ''}
            </b>
            {l.live ? (
              <button type="button" className="fb-pill" onClick={() => f.watchLive(l.gid)}>
                WATCH
              </button>
            ) : (
              <>
                <button type="button" className="fb-pill" onClick={() => f.joinLobby(l.gid, 0)}>
                  JOIN TEAM 1
                </button>
                <button type="button" className="fb-pill" onClick={() => f.joinLobby(l.gid, 1)}>
                  JOIN TEAM 2
                </button>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function Controls() {
  return (
    <div className="fb-help">
      <div>
        <b>GAMEPAD</b> L stick move · A pass · B shoot · X lob / cross · Y through ball · RT sprint
        · LT jockey · RB finesse · LB switch · R stick skill / switch · START pause · BACK camera
      </div>
      <div>
        <b>KEYS</b> WASD move · J pass · SPACE shoot · L lob / cross · I through · SHIFT sprint · Z
        jockey · CTRL finesse · C switch · V skill · ESC pause · H camera
      </div>
      <div>
        <b>TOUCH</b> left stick · A B X Y · SPRINT · SWITCH. Hold a kick button to fill the power
        bar.
      </div>
    </div>
  );
}

function Pause({ f, ui }: { f: FootballMode; ui: FootballUiState }) {
  const online = ui.kind === 'online';
  return (
    <div className="fb-menu pointer-events-auto absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col gap-3 bg-black/85 p-5 text-white">
      <div className="fb-title">{online ? 'MENU' : 'PAUSED'}</div>
      {online && <span className="fb-sub">Online matches keep going.</span>}
      <button type="button" className="fb-go" onClick={() => f.setPaused(false)}>
        ▶ RESUME
      </button>
      <button type="button" className="fb-no" onClick={() => f.cycleCam()}>
        🎥 CAMERA: {ui.cam.toUpperCase()}
      </button>
      <Controls />
      <button type="button" className="fb-no" onClick={() => f.quitMatch()}>
        QUIT MATCH
      </button>
    </div>
  );
}

function Results({ f, ui }: { f: FootballMode; ui: FootballUiState }) {
  const r = ui.results!;
  const kind: MatchKind | null = ui.kind;
  const cupNext =
    (kind === 'cup' || kind === 'season') &&
    ui.cup !== null &&
    !ui.cup.done &&
    myFixture(ui.cup) !== null;
  return (
    <div className="fb-results pointer-events-auto absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2 text-center">
      <span className="fb-sub">{r.reason}</span>
      <div className={`fb-big ${r.won === false ? 'fb-lose' : ''}`}>
        {r.won === true
          ? 'YOU WIN!'
          : r.won === false
            ? 'DEFEAT'
            : r.winner === null
              ? 'DRAW'
              : `${r.names[r.winner].toUpperCase()} WIN`}
      </div>
      <div className="fb-score">
        {r.names[0]} {r.score[0]} – {r.score[1]} {r.names[1]}
        {r.pens ? ` (${r.pens[0]}–${r.pens[1]} on penalties)` : ''}
      </div>
      {r.cupLine !== undefined && <b className="fb-champ">{r.cupLine}</b>}
      {r.respect !== null && r.respect > 0 && (
        <div className="fb-respect">+{r.respect} RESPECT</div>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        {cupNext ? (
          <button type="button" className="fb-go" onClick={() => f.playCup()}>
            NEXT ROUND ▶
          </button>
        ) : (
          kind !== 'online' && (
            <button type="button" className="fb-go" onClick={() => f.rematch()}>
              {kind === 'watch' ? 'ANOTHER' : 'REMATCH'}
            </button>
          )
        )}
        <button type="button" className="fb-no" onClick={() => f.openMenu()}>
          MENU
        </button>
        <button type="button" className="fb-no" onClick={() => f.leave()}>
          LEAVE STADIUM
        </button>
      </div>
    </div>
  );
}

/** Phones / tablets: a stick on the left, the four kick buttons + sprint / switch on the right. */
function TouchPad({ pad }: { pad: FootballTouchPad }) {
  const base = useRef<{ id: number; x: number; y: number } | null>(null);
  const [knob, setKnob] = useState<{ x: number; y: number; bx: number; by: number } | null>(null);
  const R = 52;
  const onDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    base.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
    setKnob({ x: 0, y: 0, bx: e.clientX, by: e.clientY });
  };
  const onMove = (e: React.PointerEvent) => {
    const b = base.current;
    if (b === null || b.id !== e.pointerId) return;
    let dx = e.clientX - b.x;
    let dy = e.clientY - b.y;
    const l = Math.hypot(dx, dy);
    if (l > R) {
      dx = (dx / l) * R;
      dy = (dy / l) * R;
    }
    pad.sx = dx / R;
    pad.sy = -dy / R;
    setKnob({ x: dx, y: dy, bx: b.x, by: b.y });
  };
  const onUp = (e: React.PointerEvent) => {
    if (base.current?.id !== e.pointerId) return;
    base.current = null;
    pad.sx = 0;
    pad.sy = 0;
    setKnob(null);
  };
  useEffect(
    () => () => {
      pad.sx = 0;
      pad.sy = 0;
    },
    [pad],
  );
  const btn = (k: keyof FootballTouchPad, label: string, cls: string, sub?: string) => (
    <button
      type="button"
      className={`fb-tb ${cls}`}
      onPointerDown={e => {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        (pad as unknown as Record<string, boolean>)[k] = true;
      }}
      onPointerUp={() => {
        (pad as unknown as Record<string, boolean>)[k] = false;
      }}
      onPointerCancel={() => {
        (pad as unknown as Record<string, boolean>)[k] = false;
      }}
    >
      <b>{label}</b>
      {sub !== undefined && <i>{sub}</i>}
    </button>
  );
  return (
    <div className="fb-touch pointer-events-none absolute inset-0" data-fb-touch>
      <div
        className="fb-stickzone pointer-events-auto absolute"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        {knob !== null && (
          <div className="fb-stick" style={{ left: knob.bx, top: knob.by }}>
            <i style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
          </div>
        )}
        {knob === null && <span className="fb-stickhint">MOVE</span>}
      </div>
      <div className="fb-btns pointer-events-auto absolute">
        {btn('through', 'Y', 'fb-y', 'THROUGH')}
        {btn('lob', 'X', 'fb-xb', 'LOB')}
        {btn('shoot', 'B', 'fb-b', 'SHOOT · SLIDE')}
        {btn('pass', 'A', 'fb-a', 'PASS · TACKLE')}
      </div>
      <div className="fb-side pointer-events-auto absolute flex flex-col gap-2">
        {btn('sprint', 'SPRINT', 'fb-s')}
        {btn('switchP', 'SWITCH', 'fb-s')}
        {btn('jockey', 'JOCKEY', 'fb-s')}
      </div>
    </div>
  );
}

const CSS = `
body[data-football] [data-nounfm="off"]{display:none!important}
.fb-root{font-family:system-ui,sans-serif}
.fb-menu{width:460px;max-width:calc(100vw - 32px);max-height:calc(100dvh - 32px);overflow-y:auto;box-shadow:8px 8px 0 #1f8a3a;border-radius:4px}
.fb-title{font-size:30px;font-weight:900;font-style:italic;letter-spacing:.02em;text-shadow:0 3px 0 #1f8a3a;color:#fff}
.fb-x{width:36px;height:36px;border-radius:999px;background:rgba(255,255,255,.12);font-weight:900}
.fb-tabs{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}
.fb-tab{padding:9px 0;border-radius:10px;background:rgba(255,255,255,.08);font-weight:900;font-size:12px;font-style:italic}
.fb-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.fb-row>span{font-size:10px;letter-spacing:.16em;opacity:.7;width:52px}
.fb-pill{background:rgba(255,255,255,.1);border-radius:999px;padding:6px 11px;font-weight:800;font-size:11px;min-height:34px}
.fb-on{background:#ffd400!important;color:#000!important}
.fb-kit{display:inline-flex;align-items:center;justify-content:center;width:46px;height:34px;border-radius:8px;font-weight:900;font-size:11px;color:#fff;text-shadow:0 1px 0 #000}
.fb-vs{font-size:11px;opacity:.7}
.fb-go{background:#1f8a3a;color:#fff;font-weight:900;font-size:17px;padding:11px 18px;border-radius:10px;box-shadow:0 4px 0 #0d4a1e;font-style:italic}
.fb-no{background:rgba(255,255,255,.14);color:#fff;font-weight:800;font-size:13px;padding:9px 14px;border-radius:10px}
.fb-sub{font-size:12px;opacity:.8;letter-spacing:.04em}
.fb-help{font-size:11px;line-height:1.5;opacity:.85;display:flex;flex-direction:column;gap:4px}
.fb-help b{color:#ffd400;margin-right:4px}
.fb-list{max-height:28vh;overflow-y:auto}
.fb-table{font-size:12px;border-collapse:collapse;width:100%}
.fb-table th,.fb-table td{padding:2px 6px;text-align:center}
.fb-table td:first-child{text-align:left;font-weight:900}
.fb-me{color:#ffd400;font-weight:900}
.fb-bracket{display:flex;gap:10px;font-size:11px;overflow-x:auto}
.fb-fix{background:rgba(255,255,255,.08);padding:3px 6px;border-radius:6px;white-space:nowrap}
.fb-champ{color:#ffd400;font-style:italic;font-size:16px}
.fb-card{display:flex;flex-direction:column;align-items:center;gap:6px;background:#ffd400;color:#000;padding:10px 18px;box-shadow:6px 6px 0 #1f8a3a;min-width:260px;max-width:calc(100vw - 32px);text-align:center;z-index:5}
.fb-card span{font-size:10px;letter-spacing:.2em}.fb-card b{font-size:16px;font-style:italic}
.fb-card .fb-no{background:rgba(0,0,0,.15);color:#000}
.fb-bar{width:100%;height:4px;background:rgba(0,0,0,.15)}.fb-bar i{display:block;height:100%;background:#1f8a3a;transition:width .25s linear}
.fb-chip{bottom:calc(150px + var(--w2-safe-bottom, env(safe-area-inset-bottom)));background:#ffd400;color:#000;font-weight:900;font-style:italic;padding:12px 20px;border-radius:999px;box-shadow:0 5px 0 #1f8a3a;font-size:16px;letter-spacing:.02em}
.fb-load{background:radial-gradient(circle at 50% 60%,rgba(31,138,58,.55),rgba(0,0,0,.85));color:#fff;gap:14px}
.fb-loadbar{width:min(320px,70vw);height:8px;background:rgba(255,255,255,.15);border-radius:4px;overflow:hidden}
.fb-loadbar i{background:#ffd400}
.fb-toast{background:#000;color:#ffd400;font-weight:900;font-style:italic;padding:8px 14px;box-shadow:4px 4px 0 #1f8a3a;max-width:calc(100vw - 32px);text-align:center;font-size:14px}
.fb-tools{top:calc(12px + var(--w2-safe-top, env(safe-area-inset-top)));right:calc(12px + var(--w2-safe-right, env(safe-area-inset-right)))}
.fb-mini{background:rgba(0,0,0,.65);color:#fff;font-size:11px;font-weight:800;letter-spacing:.08em;padding:7px 11px;border-radius:999px;min-height:34px}
.fb-results{background:rgba(0,0,0,.86);color:#fff;padding:18px 24px;border-radius:16px;box-shadow:8px 8px 0 #1f8a3a;max-width:calc(100vw - 32px)}
.fb-big{font-size:min(13vw,60px);font-weight:900;font-style:italic;color:#ffd400;text-shadow:0 5px 0 #1f8a3a;line-height:1}
.fb-lose{color:#ff6a5a;text-shadow:0 5px 0 #5a0f08}
.fb-score{font-size:18px;font-weight:900}
.fb-respect{font-weight:900;color:#6cf0ff;letter-spacing:.1em}
.fb-stickzone{left:0;bottom:0;width:46vw;height:62vh;touch-action:none}
.fb-stickhint{position:absolute;left:calc(40px + var(--w2-safe-left, env(safe-area-inset-left)));bottom:calc(60px + var(--w2-safe-bottom, env(safe-area-inset-bottom)));width:110px;height:110px;border-radius:999px;border:2px dashed rgba(255,255,255,.35);display:flex;align-items:center;justify-content:center;color:rgba(255,255,255,.6);font-size:11px;font-weight:800;letter-spacing:.12em}
.fb-stick{position:fixed;width:120px;height:120px;margin:-60px 0 0 -60px;border-radius:999px;background:rgba(255,255,255,.12);border:2px solid rgba(255,255,255,.35)}
.fb-stick i{position:absolute;left:35px;top:35px;width:50px;height:50px;border-radius:999px;background:rgba(255,255,255,.7)}
.fb-btns{right:calc(18px + var(--w2-safe-right, env(safe-area-inset-right)));bottom:calc(28px + var(--w2-safe-bottom, env(safe-area-inset-bottom)));width:190px;height:190px;touch-action:none}
.fb-tb{display:flex;flex-direction:column;align-items:center;justify-content:center;border-radius:999px;color:#fff;font-weight:900;touch-action:none;user-select:none;-webkit-user-select:none;box-shadow:0 4px 0 rgba(0,0,0,.45)}
.fb-tb b{font-size:20px;line-height:1}.fb-tb i{font-style:normal;font-size:7px;letter-spacing:.06em;opacity:.9;margin-top:2px}
.fb-btns .fb-tb{position:absolute;width:70px;height:70px}
.fb-a{left:60px;bottom:0;background:#1f8a3a}.fb-b{right:0;top:60px;background:#d22209}
.fb-xb{left:0;top:60px;background:#1f6fe0}.fb-y{left:60px;top:0;background:#e0a40e}
.fb-side{right:calc(222px + var(--w2-safe-right, env(safe-area-inset-right)));bottom:calc(28px + var(--w2-safe-bottom, env(safe-area-inset-bottom)))}
.fb-s{width:78px;height:40px;border-radius:12px;background:rgba(0,0,0,.6);font-size:11px}
.fb-s b{font-size:11px;letter-spacing:.08em}
@media (max-width:640px){
  .fb-btns{width:160px;height:160px;bottom:calc(120px + var(--w2-safe-bottom, env(safe-area-inset-bottom)))}
  .fb-btns .fb-tb{width:60px;height:60px}
  .fb-a{left:50px}.fb-b{top:50px}.fb-xb{top:50px}.fb-y{left:50px}
  .fb-side{right:auto;left:calc(12px + var(--w2-safe-left, env(safe-area-inset-left)));bottom:auto;top:calc(110px + var(--w2-safe-top, env(safe-area-inset-top)))}
  .fb-s{width:70px;height:36px}
  .fb-tabs .fb-tab{font-size:11px}
}
`;
