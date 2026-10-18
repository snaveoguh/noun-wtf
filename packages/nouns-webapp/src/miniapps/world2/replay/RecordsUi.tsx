// ── Records UI: record cards, instant replay, appeals (rider + admin) ──

import type { Game } from '../Game';

import { useEffect, useState, useSyncExternalStore } from 'react';

import { appealsAdmin, type AppealInfo } from '../net/Appeals';
import { fetchStats, type RideRun } from '../net/Stats';

import { fmtRecord, type RecordCard } from './Records';
import { loadRuns } from './replayStore';
import { REPLAY_RATES, type ReplayReadout } from './ReplayView';

const ADMIN_TOKEN_KEY = 'noun-world-admin-token';

function useCard(game: Game): RecordCard | null {
  return useSyncExternalStore(
    fn => game.records.subscribe(fn),
    () => game.records.card,
  );
}

/** Is a replay playing? (The HUD hides meanwhile.) */
export function useReplayActive(game: Game | null): boolean {
  return useSyncExternalStore(
    fn => game?.replay.subscribe(fn) ?? (() => undefined),
    () => game?.replay.active ?? false,
  );
}

function useReadout(game: Game): ReplayReadout | null {
  const [r, setR] = useState<ReplayReadout | null>(() => game.replay.readout());
  useEffect(() => game.replay.subscribe(() => setR(game.replay.readout())), [game]);
  return r;
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function RecordsUi({ game, admin }: { game: Game; admin: boolean }) {
  const replaying = useReplayActive(game);
  const [menu, setMenu] = useState(false);

  // Y: replay the last run. Appeals decided since the last visit show once.
  useEffect(() => {
    if (game.stats.isLive()) void game.records.checkAppeals();
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyY' || (e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      if (game.replay.active || game.paused) return;
      game.records.replayLast();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [game]);

  return (
    <>
      {!replaying && <RecordCardView game={game} />}
      {!replaying && (
        <div className="pointer-events-auto absolute left-4 top-[10rem] z-10 flex flex-col items-start gap-1">
          <button
            type="button"
            className="w2-chip text-xs"
            title="Replay your last run in slow motion (Y)"
            onClick={() => setMenu(m => !m)}
          >
            ⟲ REPLAY
          </button>
          {menu && <ReplayMenu game={game} onClose={() => setMenu(false)} />}
        </div>
      )}
      {replaying && <ReplayOverlay game={game} />}
      {admin && (
        <div className={replaying ? 'hidden' : ''}>
          <AppealsAdmin game={game} />
        </div>
      )}
    </>
  );
}

/** How long a record toast stays (ms): good news is quick, a refusal lingers so APPEAL can be tapped. */
const TOAST_MS = { saved: 3500, appeal: 6000, refused: 9000 } as const;
const FADE_MS = 600;

/**
 * Record news as a small toast bottom-left that fades on its own: it never
 * covers the road or needs closing (a dialogue on every new top speed made
 * phones unplayable). A newer record replaces it. Refused rides keep tiny
 * REPLAY / APPEAL taps; every kept ride is also in the ⟲ REPLAY menu.
 */
function RecordCardView({ game }: { game: Game }) {
  const card = useCard(game);
  const touch = typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches;
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    if (card === null) return;
    const id = setInterval(() => setNow(performance.now()), 200);
    return () => clearInterval(id);
  }, [card]);
  if (card === null) return null;
  const age = Math.max(0, now - card.at);
  // An appeal in flight stays until it has an answer
  const busy = card.appeal?.state === 'sending';
  const life = TOAST_MS[card.kind];
  if (!busy && age > life) return null;
  const opacity = busy ? 1 : Math.min(1, Math.max(0, (life - age) / FADE_MS));
  const refused = card.kind === 'refused';
  const bad = refused || card.appeal?.state === 'rejected';
  const what = fmtRecord(card.key, card.value);
  const tag = card.kind === 'saved' ? '★ NEW RECORD' : refused ? '⚠ NOT SAVED' : '⚖ APPEAL';
  return (
    <div
      key={card.id}
      data-testid="record-card"
      style={{ opacity, transition: 'opacity 200ms linear' }}
      className={`pointer-events-none absolute z-20 rounded-lg border-2 border-black px-2.5 py-1.5 text-xs text-black shadow-[3px_3px_0_#000] ${
        touch ? 'bottom-[156px] left-3 max-w-[180px]' : 'bottom-[60px] left-[292px] max-w-[300px]'
      } ${bad ? 'bg-[#ff5a4a]' : 'bg-[#ffd400]'}`}
    >
      <div className="font-black leading-tight">
        <span className="tracking-wider">{tag}</span> <span className="italic">{what}</span>
        {card.reason ? <span className="font-bold">: {card.reason}</span> : null}
      </div>
      {card.appeal && <div className="mt-0.5 font-bold leading-tight">{card.appeal.text}</div>}
      {refused && card.run && (
        <div className="mt-1 flex gap-1.5">
          <button
            type="button"
            className="pointer-events-auto rounded bg-black px-2 py-0.5 font-black italic text-[#ffd400]"
            onClick={() => game.records.replayCard()}
          >
            ▶ REPLAY
          </button>
          {(!card.appeal || card.appeal.state === 'error') && (
            <button
              type="button"
              className="pointer-events-auto rounded bg-white px-2 py-0.5 font-black italic text-black"
              title="Send it again with its ride; if it's still refused, an admin reviews it"
              onClick={() => void game.records.appeal()}
            >
              ⚖ APPEAL
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ReplayMenu({ game, onClose }: { game: Game; onClose: () => void }) {
  const [kept, setKept] = useState<RideRun[] | null>(null);
  useEffect(() => {
    let live = true;
    void loadRuns().then(r => live && setKept(r));
    return () => {
      live = false;
    };
  }, []);
  const last = game.records.lastRun();
  const len = (r: RideRun) => {
    const n = r.samples.length / 6;
    return n >= 2 ? r.samples[(n - 1) * 6] - r.samples[0] : 0;
  };
  return (
    <div
      className="w-64 rounded-xl bg-black/75 p-2 text-xs backdrop-blur"
      data-testid="replay-menu"
    >
      <button
        type="button"
        disabled={last === null}
        className="block w-full rounded px-2 py-1 text-left hover:bg-white/10 disabled:opacity-40"
        onClick={() => {
          onClose();
          game.records.replayLast();
        }}
      >
        ▶ LAST RUN {last ? <span className="opacity-60">{mmss(len(last))}</span> : '(ride first)'}
      </button>
      {(kept ?? []).slice(0, 6).map(r => (
        <button
          key={r.id}
          type="button"
          className="block w-full rounded px-2 py-1 text-left hover:bg-white/10"
          onClick={() => {
            onClose();
            game.records.showRun(r);
            game.records.replayCard();
          }}
        >
          ▶ {r.key && r.value !== undefined ? fmtRecord(r.key, r.value) : 'ride'}{' '}
          <span className={r.status === 'refused' ? 'text-[#ff8a7a]' : 'opacity-60'}>
            {r.status === 'refused' ? 'not saved' : 'saved'} · {new Date(r.at).toLocaleDateString()}
          </span>
        </button>
      ))}
    </div>
  );
}

function ReplayOverlay({ game }: { game: Game }) {
  const r = useReadout(game);
  const rp = game.replay;
  // Esc leaves, space pauses, 1/2/3 pick the speed. Capture phase: the
  // paused game never sees these keys
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const map: Record<string, () => void> = {
        Escape: () => rp.stop(),
        Space: () => rp.togglePlay(),
        Digit1: () => rp.setRate(0.25),
        Digit2: () => rp.setRate(0.5),
        Digit3: () => rp.setRate(1),
      };
      const f = map[e.code];
      if (f === undefined) return;
      e.preventDefault();
      e.stopPropagation();
      f();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [rp]);
  if (r === null) return null;
  const inAir = r.state === 'AIR';
  return (
    <div className="pointer-events-none absolute inset-0 z-30" data-testid="replay-overlay">
      <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/70 to-transparent" />
      <div className="pointer-events-auto absolute left-1/2 top-3 flex w-[min(720px,94vw)] -translate-x-1/2 flex-col gap-2">
        <div className="flex items-center gap-2">
          <span className="bg-[#d22209] px-2 py-0.5 text-xs font-black italic tracking-widest">
            ⟲ REPLAY
          </span>
          <span className="min-w-0 flex-1 truncate text-sm font-bold">{r.title}</span>
          <button
            type="button"
            className="bg-[#ffd400] px-3 py-1 text-sm font-black italic text-black"
            onClick={() => rp.stop()}
          >
            EXIT (Esc)
          </button>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            className="w2-chip w-10 text-center"
            onClick={() => rp.togglePlay()}
            aria-label={r.playing ? 'Pause' : 'Play'}
          >
            {r.playing ? '❚❚' : '▶'}
          </button>
          {REPLAY_RATES.map(x => (
            <button
              key={x}
              type="button"
              className={`w2-chip ${r.rate === x ? 'w2-on' : ''}`}
              onClick={() => rp.setRate(x)}
            >
              {x}×
            </button>
          ))}
          <input
            type="range"
            min={0}
            max={r.length}
            step={0.01}
            value={r.t}
            onChange={e => rp.seek(Number(e.target.value))}
            className="min-w-0 flex-1 accent-[#ffd400]"
            aria-label="Scrub"
          />
          <span className="w-24 text-right tabular-nums opacity-80">
            {mmss(r.t)} / {mmss(r.length)}
          </span>
        </div>
      </div>

      {/* Readout */}
      <div className="absolute bottom-[12%] left-1/2 flex -translate-x-1/2 items-end gap-3">
        <div className="w2-speedo">
          <b>{Math.round(r.kmh)}</b>
          <span>km/h</span>
        </div>
        <div className="flex flex-col gap-1 text-xs">
          <span className={`w2-chip font-black ${inAir ? 'w2-on' : ''}`}>{r.state}</span>
          <span className="w2-chip tabular-nums">
            {inAir ? `AIR ${r.airM.toFixed(1)} m · ${r.airS.toFixed(2)} s` : 'ON THE BOARD'}
          </span>
          <span className="w2-chip tabular-nums opacity-80">
            best air {r.peakM.toFixed(1)} m · {r.peakS.toFixed(2)} s
          </span>
        </div>
      </div>
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 text-[11px] opacity-60">
        {r.rate}× slow motion · game paused · Esc to go back
      </div>
    </div>
  );
}

// ── Admin: review appeals (WORLD_ADMIN_TOKEN, asked for here, kept for the tab only) ──

function AppealsAdmin({ game }: { game: Game }) {
  const [token, setToken] = useState(() => {
    try {
      return sessionStorage.getItem(ADMIN_TOKEN_KEY) ?? '';
    } catch {
      return '';
    }
  });
  const [draft, setDraft] = useState('');
  const [list, setList] = useState<AppealInfo[] | null>(null);
  const [msg, setMsg] = useState('');
  const [notes, setNotes] = useState<Record<string, string>>({});

  const refresh = async (t = token) => {
    if (!t) return;
    const r = await appealsAdmin.list(t);
    if (!r.ok) {
      setMsg(r.error);
      setList(null);
      return;
    }
    setList(r.appeals);
  };
  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const replay = async (a: AppealInfo) => {
    setMsg('loading the ride…');
    const r = await appealsAdmin.trace(token, a.id);
    if (!r.ok) return setMsg(r.error);
    setMsg('');
    game.records.play(
      { id: a.id, at: a.at, samples: r.samples, key: a.key, value: a.value },
      `APPEAL · ${a.name} · ${fmtRecord(a.key, a.value)} (${a.reason})`,
    );
  };

  const decide = async (a: AppealInfo, decision: 'approve' | 'reject') => {
    const r = await appealsAdmin.decide(token, a.id, decision, notes[a.id] ?? '');
    if (!r.ok) return setMsg(r.error);
    let line = `${decision === 'approve' ? 'Approved' : 'Rejected'} ${a.name} ${fmtRecord(a.key, a.value)}`;
    if (decision === 'approve') {
      const s = await fetchStats();
      const rows = s?.boards[a.key] ?? [];
      const i = rows.findIndex(x => x.name === a.name);
      line +=
        i >= 0
          ? `: board #${i + 1} at ${fmtRecord(a.key, rows[i].value)}`
          : ': not on the board yet';
    }
    setMsg(line);
    void refresh();
  };

  return (
    <div
      className="pointer-events-auto absolute right-2 top-2 z-40 flex max-h-[calc(100%-1rem)] w-[min(420px,96vw)] flex-col rounded-xl bg-black/85 p-3 text-sm backdrop-blur"
      data-testid="appeals-admin"
    >
      <div className="mb-2 flex items-center justify-between">
        <b className="font-black italic tracking-wide text-[#ffd400]">⚖ RECORD APPEALS</b>
        {token && (
          <button
            type="button"
            className="text-xs opacity-60"
            onClick={() => {
              try {
                sessionStorage.removeItem(ADMIN_TOKEN_KEY);
              } catch {
                // private mode
              }
              setToken('');
              setList(null);
            }}
          >
            sign out
          </button>
        )}
      </div>
      {!token ? (
        <form
          className="flex gap-2"
          onSubmit={e => {
            e.preventDefault();
            try {
              sessionStorage.setItem(ADMIN_TOKEN_KEY, draft);
            } catch {
              // private mode: this page only
            }
            setToken(draft);
            setDraft('');
          }}
        >
          <input
            type="password"
            autoComplete="off"
            placeholder="admin token"
            value={draft}
            onChange={e => setDraft(e.target.value)}
            className="min-w-0 flex-1 rounded bg-white/10 px-2 py-1 outline-none"
          />
          <button type="submit" className="bg-[#ffd400] px-3 py-1 font-black text-black">
            OPEN
          </button>
        </form>
      ) : null}
      {msg && <div className="mb-2 text-xs text-[#ffd400]">{msg}</div>}
      {list !== null && list.length === 0 && <div className="text-xs opacity-60">No appeals.</div>}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {(list ?? []).map(a => (
          <div key={a.id} className="mb-2 rounded-lg bg-white/5 p-2" data-testid="appeal-row">
            <div className="flex justify-between gap-2">
              <b>
                {a.name} · {fmtRecord(a.key, a.value)}
              </b>
              <span
                className={
                  a.status === 'pending'
                    ? 'text-[#ffd400]'
                    : a.status === 'approved'
                      ? 'text-[#7dffa1]'
                      : 'text-[#ff8a7a]'
                }
              >
                {a.status}
              </span>
            </div>
            <div className="text-xs opacity-70">
              {a.reason} · {new Date(a.at).toLocaleString()} · {Math.round(a.chars / 1000)}k
              {a.note ? ` · note: ${a.note}` : ''}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <button type="button" className="w2-chip text-xs" onClick={() => void replay(a)}>
                ▶ REPLAY
              </button>
              {a.status === 'pending' && (
                <>
                  <button
                    type="button"
                    className="w2-chip text-xs text-[#7dffa1]"
                    onClick={() => void decide(a, 'approve')}
                  >
                    APPROVE
                  </button>
                  <input
                    placeholder="reason (rider sees it)"
                    value={notes[a.id] ?? ''}
                    onChange={e => setNotes(n => ({ ...n, [a.id]: e.target.value }))}
                    className="min-w-0 flex-1 rounded bg-white/10 px-2 py-0.5 text-xs outline-none"
                  />
                  <button
                    type="button"
                    className="w2-chip text-xs text-[#ff8a7a]"
                    onClick={() => void decide(a, 'reject')}
                  >
                    REJECT
                  </button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
