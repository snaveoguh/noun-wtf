// ── Noun Hoops UI: court prompt, lobby, challenges, invite, results ─────

import type { Game } from '../../Game';
import type { TeamSize } from '../contract';
import type { HoopsMode, HoopsUiState } from './HoopsMode';

import { useEffect, useState, useSyncExternalStore } from 'react';

import { HudSlot } from '../../hud/slots';
const NOOP = () => () => {};
const MODES: TeamSize[] = [1, 2, 3, 5];
const DIFF = ['', 'easy', 'normal', 'hard'] as const;
const TEAM = ['RED', 'BLUE'] as const;
const TEAM_C = ['#d22209', '#2a6bff'] as const;

function useHoops(h: HoopsMode | null): HoopsUiState | null {
  return useSyncExternalStore(h ? cb => h.subscribe(cb) : NOOP, () => h?.ui ?? null);
}

/** World2Page: hide the skate HUD + touch pad while hoops owns the screen. */
export function useHoopsActive(game: Game | null): boolean {
  const ui = useHoops(game?.hoops ?? null);
  return (
    ui !== null && (ui.phase === 'teleport' || ui.phase === 'playing' || ui.phase === 'results')
  );
}

/** Re-render every `ms` while `on` (countdowns). */
function useTick(on: boolean, ms = 250) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const t = setInterval(() => set(n => n + 1), ms);
    return () => clearInterval(t);
  }, [on, ms]);
}

export function HoopsUi({ game }: { game: Game }) {
  const h = game.hoops;
  const ui = useHoops(h)!;
  const now = performance.now();
  useTick(ui.invite !== null || ui.challenge !== null || ui.toast !== null);

  // E on the court prompt (capture: the board toggle never sees it)
  useEffect(() => {
    if (ui.prompt === null || ui.phase !== 'idle') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyE' || (e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      e.stopPropagation();
      e.preventDefault();
      h.promptAction();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [h, ui.prompt, ui.phase]);

  const playing = ui.phase === 'playing' || ui.phase === 'teleport';
  return (
    <div className="pointer-events-none absolute inset-0">
      <style>{CSS}</style>
      {/* The view's HUD (score, meter, touch overlay) lives in here */}
      <div
        ref={el => {
          h.hudLayer = el;
        }}
        className="pointer-events-none absolute inset-0"
      />

      {ui.prompt !== null && ui.phase === 'idle' && ui.invite === null && (
        <HudSlot name="toasts">
          <button
            type="button"
            className="hp-prompt pointer-events-auto absolute left-1/2 top-[34%] -translate-x-1/2"
            onClick={() => h.promptAction()}
          >
            🏀{' '}
            {ui.prompt.kind === 'play'
              ? 'PLAY BALL'
              : `${ui.prompt.kind === 'join' ? 'JOIN' : 'WATCH'} ${ui.prompt.hostName.toUpperCase()}'S ${ui.prompt.size}v${ui.prompt.size}`}{' '}
            — E / tap
          </button>
        </HudSlot>
      )}

      {ui.phase === 'lobby' && ui.lobby !== null && <Lobby h={h} ui={ui} />}

      {ui.phase === 'idle' && <ChallengeChip game={game} ui={ui} />}

      {ui.invite !== null && (
        <div className="hp-card pointer-events-auto absolute left-1/2 top-24 -translate-x-1/2">
          <span>🏀 CHALLENGE</span>
          <b>
            {ui.invite.fromName} wants a {ui.invite.size}v{ui.invite.size}
          </b>
          <div className="hp-bar">
            <i style={{ width: `${Math.max(0, 100 - (now - ui.invite.at) / 200)}%` }} />
          </div>
          <div className="flex gap-2">
            <button type="button" className="hp-go" onClick={() => h.acceptInvite()}>
              ACCEPT
            </button>
            <button type="button" className="hp-no" onClick={() => h.declineInvite()}>
              DECLINE
            </button>
          </div>
        </div>
      )}

      {ui.challenge !== null && (
        <div className="hp-card pointer-events-auto absolute left-1/2 top-24 -translate-x-1/2">
          <span>
            🏀 {ui.challenge.size}v{ui.challenge.size} CHALLENGE
          </span>
          <b>
            {ui.challenge.status === 'waiting'
              ? `waiting for ${ui.challenge.toName}… ${Math.max(0, Math.ceil(20 - (now - ui.challenge.at) / 1000))}s`
              : ui.challenge.status === 'declined'
                ? `${ui.challenge.toName} passed`
                : `${ui.challenge.toName} didn't answer`}
          </b>
          <button type="button" className="hp-no" onClick={() => h.cancelChallenge()}>
            {ui.challenge.status === 'waiting' ? 'CANCEL' : 'OK'}
          </button>
        </div>
      )}

      {ui.teleport !== null && (
        <div className="hp-teleport absolute inset-0 flex items-center justify-center">
          <b>{ui.teleport}</b>
        </div>
      )}

      {playing && (
        <button
          type="button"
          className="w2-chip pointer-events-auto absolute left-4 top-4 text-xs"
          onClick={() => h.forfeit()}
        >
          {ui.role === 'spectator' ? '✕ stop watching' : '🏳 forfeit (Esc)'}
        </button>
      )}

      {ui.phase === 'results' && ui.results !== null && <Results h={h} ui={ui} />}

      {ui.toast !== null && now - ui.toast.at < 4000 && (
        <div key={ui.toast.at} className="w2-nowplaying absolute left-1/2 top-40 -translate-x-1/2">
          <span>🏀 NOUN HOOPS</span>
          <b>{ui.toast.text}</b>
        </div>
      )}
    </div>
  );
}

function Lobby({ h, ui }: { h: HoopsMode; ui: HoopsUiState }) {
  const l = ui.lobby!;
  const bots = l.size * 2 - l.players.length;
  return (
    <div className="w2-panel hp-lobby pointer-events-auto absolute left-1/2 top-1/2 flex w-[360px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col gap-3">
      <div className="hp-title">🏀 NOUN HOOPS</div>
      <div className="text-xs opacity-70">
        {l.mine ? 'your court. pick a game, anyone here can join' : `${l.hostName}'s game`}
      </div>
      <Row label="mode">
        {MODES.map(m => (
          <button
            key={m}
            type="button"
            disabled={!l.mine}
            className={`hp-pill ${l.size === m ? 'hp-on' : ''}`}
            onClick={() => h.setMode(m)}
          >
            {m}v{m}
          </button>
        ))}
      </Row>
      {l.mine && (
        <Row label="bots">
          {([1, 2, 3] as const).map(d => (
            <button
              key={d}
              type="button"
              className={`hp-pill ${l.difficulty === d ? 'hp-on' : ''}`}
              onClick={() => h.setDifficulty(d)}
            >
              {DIFF[d]}
            </button>
          ))}
        </Row>
      )}
      <Row label="first to">
        {l.mine && (
          <button type="button" className="hp-pill" onClick={() => h.setTarget(l.target - 2)}>
            −
          </button>
        )}
        <b className="w-8 text-center text-lg">{l.target}</b>
        {l.mine && (
          <button type="button" className="hp-pill" onClick={() => h.setTarget(l.target + 2)}>
            +
          </button>
        )}
      </Row>
      <div className="grid grid-cols-2 gap-2">
        {([0, 1] as const).map(t => (
          <div key={t} className="rounded-lg bg-white/5 p-2 text-xs">
            <div className="mb-1 font-bold" style={{ color: TEAM_C[t] }}>
              {TEAM[t]}
            </div>
            {l.players
              .filter(p => p.team === t)
              .map(p => (
                <button
                  key={p.id}
                  type="button"
                  disabled={!l.mine}
                  className="block w-full truncate text-left"
                  title={l.mine ? 'swap team' : undefined}
                  onClick={() => h.swapTeam(p.id)}
                >
                  ⌐◨-◨ {p.name || 'noun'}
                </button>
              ))}
            {Array.from({
              length: Math.max(0, l.size - l.players.filter(p => p.team === t).length),
            }).map((_, i) => (
              <div key={i} className="opacity-50">
                🤖 jersey crew
              </div>
            ))}
          </div>
        ))}
      </div>
      <div className="text-[11px] opacity-60">
        {bots > 0
          ? `${bots} spot${bots === 1 ? '' : 's'} filled by the Noun Jersey crew`
          : 'full court, all humans'}
      </div>
      <div className="flex gap-2">
        {l.mine ? (
          <button type="button" className="hp-go flex-1" onClick={() => h.startLobby()}>
            START
          </button>
        ) : l.joined ? (
          <div className="flex-1 self-center text-sm opacity-80">waiting for {l.hostName}…</div>
        ) : (
          <button type="button" className="hp-go flex-1" onClick={() => h.joinLobby()}>
            JOIN
          </button>
        )}
        <button type="button" className="hp-no" onClick={() => h.cancelLobby()}>
          {l.mine ? 'CANCEL' : 'LEAVE'}
        </button>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-16 text-xs uppercase opacity-60">{label}</span>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

function ChallengeChip({ game, ui }: { game: Game; ui: HoopsUiState }) {
  const [open, setOpen] = useState(false);
  const [size, setSize] = useState<TeamSize>(1);
  useTick(open, 1000);
  if (!ui.hasCourt || ui.challenge !== null) return null;
  const others = [...game.net.players.values()];
  return (
    <div className="pointer-events-auto absolute bottom-14 right-4 flex flex-col items-end gap-1">
      {open && (
        <div className="w2-panel flex w-[240px] flex-col gap-2 text-xs">
          <div className="font-bold">🏀 CHALLENGE TO HOOPS</div>
          <div className="flex gap-1">
            {MODES.map(m => (
              <button
                key={m}
                type="button"
                className={`hp-pill ${size === m ? 'hp-on' : ''}`}
                onClick={() => setSize(m)}
              >
                {m}v{m}
              </button>
            ))}
          </div>
          {others.length === 0 && <div className="opacity-60">no one else online right now</div>}
          <div className="flex max-h-[30vh] flex-col gap-1 overflow-y-auto">
            {others.map(p => (
              <div key={p.id} className="flex items-center justify-between gap-2">
                <span className="truncate">{p.name || 'noun'}</span>
                <button
                  type="button"
                  className="hp-pill hp-on shrink-0"
                  onClick={() => {
                    game.hoops.challenge(p.id, size);
                    setOpen(false);
                  }}
                >
                  🏀 challenge
                </button>
              </div>
            ))}
          </div>
          <div className="text-[10px] opacity-50">
            you both teleport to the Noun Jersey court; spare spots get bots
          </div>
        </div>
      )}
      <button type="button" className="w2-chip text-xs" onClick={() => setOpen(o => !o)}>
        🏀 hoops
      </button>
    </div>
  );
}

function Results({ h, ui }: { h: HoopsMode; ui: HoopsUiState }) {
  const r = ui.results!;
  const won = r.myTeam !== null && r.myTeam === r.winner;
  return (
    <div className="w2-panel hp-lobby pointer-events-auto absolute left-1/2 top-1/2 flex w-[340px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3 text-center">
      <div
        className="hp-title"
        style={{ color: r.myTeam === null ? '#ffd400' : won ? '#3ddc84' : '#ff4d3d' }}
      >
        {r.myTeam === null ? 'FINAL' : won ? 'YOU WIN' : 'YOU LOSE'}
      </div>
      <div className="hp-score">
        <span style={{ color: TEAM_C[0] }}>{r.score[0]}</span> —{' '}
        <span style={{ color: TEAM_C[1] }}>{r.score[1]}</span>
      </div>
      {r.mvp !== null && (
        <div className="text-sm">
          ⭐ MVP <b>{r.mvp.name}</b> <span className="opacity-70">{r.mvp.points} pts</span>
        </div>
      )}
      <div className="flex w-full gap-2">
        {ui.role !== 'spectator' && (
          <button
            type="button"
            className="hp-go flex-1"
            disabled={r.waiting}
            onClick={() => h.playAgain()}
          >
            {r.waiting ? 'WAITING FOR HOST…' : 'PLAY AGAIN'}
          </button>
        )}
        <button type="button" className="hp-no flex-1" onClick={() => h.backToSkating()}>
          BACK TO SKATING
        </button>
      </div>
    </div>
  );
}

const CSS = `
.hp-prompt{background:#ff7a1a;color:#000;padding:12px 20px;font-size:18px;font-weight:900;font-style:italic;box-shadow:6px 6px 0 #d22209;white-space:nowrap}
.hp-title{font-size:30px;font-weight:900;font-style:italic;letter-spacing:.02em;text-shadow:0 3px 0 #d22209}
.hp-score{font-size:44px;font-weight:900;font-style:italic;line-height:1}
.hp-pill{background:rgba(255,255,255,.1);border-radius:999px;padding:3px 10px;font-weight:700;font-size:12px}
.hp-pill:disabled{opacity:.6}
.hp-on{background:#ffd400;color:#000}
.hp-go{background:#d22209;color:#fff;font-weight:900;font-size:18px;padding:8px 16px;border-radius:10px;box-shadow:0 4px 0 #7a1405}
.hp-go:disabled{opacity:.6}
.hp-no{background:rgba(255,255,255,.12);color:#fff;font-weight:800;font-size:14px;padding:8px 14px;border-radius:10px}
.hp-card{display:flex;flex-direction:column;align-items:center;gap:6px;background:#ffd400;color:#000;padding:10px 18px;box-shadow:6px 6px 0 #d22209;font-family:system-ui,sans-serif;min-width:260px}
.hp-card span{font-size:10px;letter-spacing:.2em}.hp-card b{font-size:17px;font-style:italic}
.hp-card .hp-no{background:rgba(0,0,0,.15);color:#000}
.hp-bar{width:100%;height:4px;background:rgba(0,0,0,.15)}.hp-bar i{display:block;height:100%;background:#d22209;transition:width .25s linear}
.hp-teleport{background:radial-gradient(ellipse at 50% 50%,rgba(255,122,26,.35),rgba(5,6,12,.92));animation:hpfade 1.4s ease-in-out forwards}
.hp-teleport b{font-size:clamp(24px,4vw,44px);font-style:italic;font-weight:900;text-shadow:0 4px 0 #d22209}
@keyframes hpfade{0%{opacity:0}25%{opacity:1}80%{opacity:1}100%{opacity:0}}
`;
