// ── Noun Breaks UI: cypher prompt, battle menu, invites, countdown, results ─

import type { Game } from '../../Game';
import type { BreakKey, CrewId, CrewSize } from '../contract';
import type { BreakMode, BreakUiState } from './BreakMode';
import type { Difficulty } from './lobby';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { HudSlot } from '../../hud/slots';
import { BreakHud } from '../view/BreakHud';

import {
  CALIB_BPM,
  CALIB_CLICKS,
  CALIB_COUNT_IN,
  calibrate,
  outputLatency,
  type CalibResult,
} from './calibrate';
import { eventMs } from './input';
import { INVITE_MS } from './lobby';
import { ARROW } from './stubView';

const NOOP = () => () => {};
const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];
const CREW_C = ['#ff4d3d', '#4d8bff'] as const;
type Tab = 'cpu' | '1v1' | 'crew' | 'watch';
const TABS: [Tab, string][] = [
  ['cpu', 'VS CPU'],
  ['1v1', '1V1'],
  ['crew', 'CREW'],
  ['watch', 'WATCH'],
];

function useBreaks(b: BreakMode | null): BreakUiState | null {
  return useSyncExternalStore(b ? cb => b.subscribe(cb) : NOOP, () => b?.ui ?? null);
}

/** World2Page: hide the skate HUD + touch pad while a battle owns the screen. */
export function useBreakActive(game: Game | null): boolean {
  const ui = useBreaks(game?.breaks ?? null);
  return (
    ui !== null && (ui.phase === 'countdown' || ui.phase === 'battle' || ui.phase === 'results')
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

const coarse = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches === true;

export function BreakUi({ game }: { game: Game }) {
  const b = game.breaks;
  const ui = useBreaks(b)!;
  const now = performance.now();
  useTick(ui.incoming !== null || ui.outgoing !== null || ui.toast !== null);

  // E at the cypher (capture: the board toggle never sees it)
  useEffect(() => {
    if (!ui.near || ui.phase !== 'idle') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyE' || (e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      e.stopPropagation();
      e.preventDefault();
      b.promptAction();
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [b, ui.near, ui.phase]);

  const fighting = ui.phase === 'countdown' || ui.phase === 'battle';
  // The site's NOUN FM chip sits right where the A button is on phones: hide it mid-battle
  useEffect(() => {
    if (!fighting) return;
    document.body.dataset.breaks = '1';
    return () => {
      delete document.body.dataset.breaks;
    };
  }, [fighting]);
  // The real view's HUD (beat track, prompts, judges' cards, its own touch
  // pad); its store appears when the view chunk lands, so poll while fighting
  useTick(fighting || ui.phase === 'results', 500);
  const hud = fighting || ui.phase === 'results' ? (b.view?.hud() ?? null) : null;
  return (
    <div className="bk-root pointer-events-none absolute inset-0">
      <style>{CSS}</style>
      {/* The view's HUD (beat track, judges, prompts) lives in here */}
      <div
        ref={el => {
          b.hudLayer = el;
        }}
        className="pointer-events-none absolute inset-0"
      />

      {ui.near && ui.phase === 'idle' && ui.incoming === null && (
        <HudSlot name="toasts">
          <button
            type="button"
            className="bk-prompt pointer-events-auto absolute left-1/2 top-[30%] -translate-x-1/2"
            onClick={() => b.promptAction()}
          >
            🕺 BREAK BATTLE — press E / tap
          </button>
        </HudSlot>
      )}

      {ui.phase === 'menu' && <Menu b={b} ui={ui} />}

      {ui.incoming !== null && (
        <div className="bk-card pointer-events-auto absolute left-1/2 top-20 -translate-x-1/2">
          <span>🕺 BREAK BATTLE</span>
          <b>
            {ui.incoming.name} wants a{' '}
            {ui.incoming.crewSize === 1
              ? '1v1'
              : `${ui.incoming.crewSize}v${ui.incoming.crewSize} crew battle`}
            {ui.incoming.crewSize > 1 &&
              (ui.incoming.crew === 0 ? ' (on their crew)' : ' (against them)')}
          </b>
          <div className="bk-bar">
            <i
              style={{ width: `${Math.max(0, 100 - ((now - ui.incoming.at) / INVITE_MS) * 100)}%` }}
            />
          </div>
          <div className="flex gap-2">
            <button type="button" className="bk-go" onClick={() => b.acceptInvite()}>
              ACCEPT
            </button>
            <button type="button" className="bk-no" onClick={() => b.declineInvite()}>
              DECLINE
            </button>
          </div>
        </div>
      )}

      {ui.waiting !== null && ui.phase !== 'countdown' && ui.phase !== 'battle' && (
        <div className="bk-card absolute left-1/2 top-20 -translate-x-1/2">
          <b>{ui.waiting}</b>
        </div>
      )}

      {ui.phase === 'countdown' && ui.countdown !== null && (
        <div className="bk-count absolute inset-0 flex flex-col items-center justify-center gap-4">
          <b key={ui.countdown}>{ui.countdown}</b>
          {ui.role !== 'spectator' && <HowTo coarse={coarse()} />}
        </div>
      )}

      {(fighting || ui.phase === 'results') && (
        <button
          type="button"
          className="w2-chip pointer-events-auto absolute left-4 top-4 text-xs"
          onClick={() => b.leave()}
        >
          {ui.role === 'spectator' || ui.phase === 'results' ? '✕ leave' : '🏳 leave (Esc)'}
        </button>
      )}

      {hud !== null && (
        <BreakHud
          hud={hud}
          onKey={
            fighting && ui.role !== 'spectator'
              ? k => b.reader.press(k, performance.now())
              : undefined
          }
          onGesture={() => b.view?.startAudio()}
          showFinal={false}
        />
      )}
      {hud === null && fighting && ui.role !== 'spectator' && coarse() && <TouchPad b={b} />}

      {ui.phase === 'results' && ui.results !== null && <Results b={b} ui={ui} />}

      {ui.toast !== null && now - ui.toast.at < 4000 && (
        <div key={ui.toast.at} className="w2-nowplaying absolute left-1/2 top-36 -translate-x-1/2">
          <span>🕺 NOUN BREAKS</span>
          <b>{ui.toast.text}</b>
        </div>
      )}
    </div>
  );
}

// ── The menu ──

/** The countdown's three lines. */
function HowTo({ coarse: touch }: { coarse: boolean }) {
  return (
    <div className="bk-howto">
      <span>HOW TO PLAY</span>
      <ol>
        <li>
          hit the arrows <em>on the beat</em>, as each note reaches the ring
          {touch ? ' (the pad)' : ' (← ↑ → ↓ / WASD)'}
        </li>
        <li>chain moves: a few notes make a move, keep them coming for a combo</li>
        <li>
          end your turn on a <em>freeze</em>: A or B on the last beat
          {touch ? '' : ' (A = J / SPACE, B = K)'}
        </li>
      </ol>
    </div>
  );
}

function Menu({ b, ui }: { b: BreakMode; ui: BreakUiState }) {
  const [tab, setTab] = useState<Tab>('cpu');
  const [diff, setDiff] = useState<Difficulty>('normal');
  const [calib, setCalib] = useState(false);
  if (calib) return <Calibrate b={b} ui={ui} onClose={() => setCalib(false)} />;
  return (
    <div className="w2-panel bk-menu pointer-events-auto absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="bk-title">🕺 NOUN BREAKS</div>
        <button type="button" className="bk-x" aria-label="close" onClick={() => b.closeMenu()}>
          ✕
        </button>
      </div>
      {ui.outgoing !== null ? (
        <Challenge b={b} ui={ui} />
      ) : (
        <>
          <div className="bk-tabs">
            {TABS.map(([k, label]) => (
              <button
                key={k}
                type="button"
                className={`bk-tab ${tab === k ? 'bk-on' : ''}`}
                onClick={() => setTab(k)}
              >
                {label}
                {k === 'watch' && ui.live.length > 0 ? ` (${ui.live.length})` : ''}
              </button>
            ))}
          </div>
          {(tab === 'cpu' || tab === 'crew') && (
            <Row label="cpu">
              {DIFFS.map(d => (
                <button
                  key={d}
                  type="button"
                  className={`bk-pill ${diff === d ? 'bk-on' : ''}`}
                  onClick={() => {
                    setDiff(d);
                    b.setDifficulty(d);
                  }}
                >
                  {d === 'easy' ? 'easy · wide timing' : d}
                </button>
              ))}
            </Row>
          )}
          {tab !== 'watch' && <Songs b={b} ui={ui} />}
          {tab !== 'watch' && (
            <Row label="timing">
              <span className="text-xs opacity-80">
                {ui.calibMs === 0
                  ? 'not calibrated'
                  : `${ui.calibMs > 0 ? '+' : ''}${ui.calibMs} ms`}
              </span>
              <button type="button" className="bk-pill" onClick={() => setCalib(true)}>
                calibrate
              </button>
            </Row>
          )}
          {tab === 'cpu' && <VsCpu b={b} diff={diff} />}
          {tab === '1v1' && <OneVOne b={b} ui={ui} diff={diff} />}
          {tab === 'crew' && <Crew b={b} ui={ui} diff={diff} />}
          {tab === 'watch' && <Watch b={b} ui={ui} />}
        </>
      )}
    </div>
  );
}

function VsCpu({ b, diff }: { b: BreakMode; diff: Difficulty }) {
  const [size, setSize] = useState<CrewSize>(1);
  return (
    <>
      <Row label="format">
        {([1, 2, 3] as CrewSize[]).map(s => (
          <button
            key={s}
            type="button"
            className={`bk-pill ${size === s ? 'bk-on' : ''}`}
            onClick={() => setSize(s)}
          >
            {s}v{s}
          </button>
        ))}
      </Row>
      <div className="text-xs opacity-70">
        {size === 1 ? 'you against a CPU b-boy.' : `you + ${size - 1} CPU against a CPU crew.`} hit
        the notes on the beat: arrows / WASD, A = J or Space, B = K (or click / tap the pad).
      </div>
      <button type="button" className="bk-go" onClick={() => b.vsCpu(diff, size)}>
        BATTLE
      </button>
    </>
  );
}

function PlayerList({
  title,
  list,
  empty,
  action,
}: {
  title: string;
  list: { id: string; name: string }[];
  empty: string;
  action: (p: { id: string; name: string }) => React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[11px] uppercase tracking-wider opacity-60">{title}</div>
      {list.length === 0 && <div className="text-xs opacity-50">{empty}</div>}
      <div className="bk-list flex flex-col gap-1">
        {list.map(p => (
          <div key={p.id} className="flex items-center justify-between gap-2">
            <span className="truncate">⌐◨-◨ {p.name}</span>
            {action(p)}
          </div>
        ))}
      </div>
    </div>
  );
}

function OneVOne({ b, ui, diff }: { b: BreakMode; ui: BreakUiState; diff: Difficulty }) {
  if (!ui.online) return <div className="text-sm opacity-70">offline: VS CPU only.</div>;
  const hereIds = new Set(ui.here.map(p => p.id));
  const btn = (p: { id: string }) => (
    <button
      type="button"
      className="bk-pill bk-on shrink-0"
      onClick={() => b.challenge(p.id, diff)}
    >
      challenge
    </button>
  );
  return (
    <>
      <PlayerList title="at the cypher" list={ui.here} empty="no one else here yet" action={btn} />
      <PlayerList
        title="in the room (they come to you)"
        list={ui.room.filter(p => !hereIds.has(p.id))}
        empty="no one else online"
        action={btn}
      />
    </>
  );
}

function Crew({ b, ui, diff }: { b: BreakMode; ui: BreakUiState; diff: Difficulty }) {
  const [size, setSize] = useState<CrewSize>(2);
  const [pick, setPick] = useState<Record<string, CrewId>>({});
  const count = (c: CrewId) => Object.values(pick).filter(x => x === c).length + (c === 0 ? 1 : 0);
  const cycle = (id: string) => {
    const cur = pick[id];
    const next: CrewId | undefined =
      cur === undefined
        ? count(0) < size
          ? 0
          : count(1) < size
            ? 1
            : undefined
        : cur === 0 && count(1) < size
          ? 1
          : undefined;
    const p = { ...pick };
    if (next === undefined) delete p[id];
    else p[id] = next;
    setPick(p);
  };
  const picks = ui.here
    .filter(p => pick[p.id] !== undefined)
    .map(p => ({ id: p.id, name: p.name, crew: pick[p.id] }));
  const cpus = size * 2 - 1 - picks.length;
  return (
    <>
      <Row label="format">
        {([2, 3] as CrewSize[]).map(s => (
          <button
            key={s}
            type="button"
            className={`bk-pill ${size === s ? 'bk-on' : ''}`}
            onClick={() => {
              setSize(s);
              setPick({});
            }}
          >
            {s}v{s}
          </button>
        ))}
      </Row>
      <PlayerList
        title="at the cypher: tap to pick a side"
        list={ui.here}
        empty={
          ui.online ? 'no one else here: CPUs fill both crews' : 'offline: CPUs fill both crews'
        }
        action={p => (
          <button
            type="button"
            className="bk-pill shrink-0"
            style={
              pick[p.id] !== undefined
                ? { background: CREW_C[pick[p.id]], color: '#fff' }
                : undefined
            }
            onClick={() => cycle(p.id)}
          >
            {pick[p.id] === 0 ? 'my crew' : pick[p.id] === 1 ? 'rivals' : '—'}
          </button>
        )}
      />
      <div className="text-[11px] opacity-60">
        {cpus > 0 ? `${cpus} spot${cpus === 1 ? '' : 's'} filled by CPU dancers` : 'all humans'}
      </div>
      <button type="button" className="bk-go" onClick={() => b.crew(size, picks, diff)}>
        {picks.length > 0 ? 'SEND CHALLENGES' : 'BATTLE'}
      </button>
    </>
  );
}

function Watch({ b, ui }: { b: BreakMode; ui: BreakUiState }) {
  if (!ui.online) return <div className="text-sm opacity-70">offline: nothing to watch.</div>;
  return (
    <div className="bk-list flex flex-col gap-1">
      {ui.live.length === 0 && <div className="text-xs opacity-50">no battles on right now</div>}
      {ui.live.map(l => (
        <div key={l.gid} className="flex items-center justify-between gap-2">
          <span className="truncate">
            {l.crewSize}v{l.crewSize} · {l.names.join(', ')}
          </span>
          <button type="button" className="bk-pill bk-on shrink-0" onClick={() => b.watch(l.gid)}>
            watch
          </button>
        </div>
      ))}
    </div>
  );
}

function Challenge({ b, ui }: { b: BreakMode; ui: BreakUiState }) {
  const o = ui.outgoing!;
  const left = Math.max(0, Math.ceil((INVITE_MS - (performance.now() - o.at)) / 1000));
  const label = { me: 'you', waiting: 'waiting…', ok: 'in', no: 'passed', cpu: 'CPU' } as const;
  return (
    <>
      <div className="text-sm">
        {o.crewSize === 1 ? '1V1 challenge' : `${o.crewSize}V${o.crewSize} crew battle`}
        {o.failed === null ? ` · ${left}s` : ''}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {([0, 1] as CrewId[]).map(c => (
          <div key={c} className="rounded-lg bg-white/5 p-2 text-xs">
            <div className="mb-1 font-bold" style={{ color: CREW_C[c] }}>
              {c === 0 ? 'YOUR CREW' : 'RIVALS'}
            </div>
            {o.slots
              .filter(s => s.crew === c)
              .map(s => (
                <div key={s.id} className="flex justify-between gap-1">
                  <span className="truncate">{s.name}</span>
                  <span className="opacity-70">{label[s.status]}</span>
                </div>
              ))}
          </div>
        ))}
      </div>
      {o.failed !== null ? (
        <>
          <div className="text-sm">
            {o.slots.find(s => s.crew === 1)?.name ?? 'they'}{' '}
            {o.failed === 'declined' ? 'passed' : "didn't answer"}
          </div>
          <div className="flex gap-2">
            <button type="button" className="bk-go flex-1" onClick={() => b.cpuInstead()}>
              BATTLE THE CPU
            </button>
            <button type="button" className="bk-no" onClick={() => b.cancelChallenge()}>
              BACK
            </button>
          </div>
        </>
      ) : (
        <div className="flex gap-2">
          {o.crewSize > 1 && (
            <button type="button" className="bk-go flex-1" onClick={() => b.startNow()}>
              START NOW
            </button>
          )}
          <button type="button" className="bk-no flex-1" onClick={() => b.cancelChallenge()}>
            CANCEL
          </button>
        </div>
      )}
    </>
  );
}

/** The song picker (battles I host play it; online, everyone loads the same file). */
function Songs({ b, ui }: { b: BreakMode; ui: BreakUiState }) {
  const cur = ui.tracks.find(t => t.id === ui.track) ?? ui.tracks[0];
  return (
    <div className="flex flex-col gap-1">
      <div className="text-[11px] uppercase tracking-wider opacity-60">song</div>
      <div className="bk-songs flex flex-col gap-1">
        {ui.tracks.map(t => (
          <button
            key={t.id}
            type="button"
            className={`bk-song ${t.id === cur?.id ? 'bk-on' : ''}`}
            onClick={() => b.setTrack(t.id)}
          >
            <b>{t.title}</b>
            <span>
              {t.artist}
              {t.bpm !== null ? ` · ${Math.round(t.bpm)} bpm` : ' · follows the battle'}
            </span>
          </button>
        ))}
      </div>
      {cur !== undefined && (
        <div className="text-[10px] opacity-50">
          {cur.license}
          {cur.source !== undefined && (
            <>
              {' · '}
              <a href={cur.source} target="_blank" rel="noreferrer" className="underline">
                source
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Latency calibration: a one-bar count-in and 8 clicks, scheduled the way
 * the battle schedules its beat (output latency taken off); tap along with
 * any key or the button. The median lateness is taken off every press.
 */
function Calibrate({ b, ui, onClose }: { b: BreakMode; ui: BreakUiState; onClose: () => void }) {
  const [state, setState] = useState<'ready' | 'run' | 'done'>('ready');
  const [res, setRes] = useState<CalibResult | null>(null);
  const [flash, setFlash] = useState(-1);
  const run = useRef<{ clicks: number[]; taps: number[]; end: number; close: () => void } | null>(
    null,
  );
  useEffect(() => {
    if (state !== 'run') return;
    const tap = (ms: number) => run.current?.taps.push(ms);
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape' || e.code === 'Tab' || e.repeat) return;
      e.preventDefault();
      e.stopPropagation();
      tap(eventMs(e.timeStamp));
    };
    window.addEventListener('keydown', onKey, true);
    let raf = 0;
    const tick = () => {
      const r = run.current;
      if (r === null) return;
      const now = performance.now();
      let k = -1;
      r.clicks.forEach((c, i) => {
        if (now >= c && now < c + 160) k = i;
      });
      setFlash(k);
      if (now > r.end) {
        const out = calibrate(r.taps, r.clicks.slice(CALIB_COUNT_IN));
        r.close();
        run.current = null;
        setRes(out);
        setState('done');
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      cancelAnimationFrame(raf);
    };
  }, [state]);
  useEffect(() => () => run.current?.close(), []);
  const start = () => {
    const w = window as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const AC = w.AudioContext ?? w.webkitAudioContext;
    if (AC === undefined) return;
    const ctx = new AC();
    void ctx.resume();
    const spb = 60 / CALIB_BPM;
    const t0 = ctx.currentTime + 0.5;
    const perf0 = performance.now();
    const ctx0 = ctx.currentTime;
    const lat = outputLatency(ctx);
    const clicks: number[] = [];
    for (let i = 0; i < CALIB_COUNT_IN + CALIB_CLICKS; i++) {
      const t = t0 + i * spb;
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = i < CALIB_COUNT_IN ? 1760 : i % 4 === 0 ? 1320 : 990;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.25, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + 0.08);
      // When it's heard, on the performance.now() clock
      clicks.push(perf0 + (t - ctx0 + lat) * 1000);
    }
    run.current = {
      clicks,
      taps: [],
      end: clicks[clicks.length - 1] + spb * 1000,
      close: () => void ctx.close(),
    };
    setRes(null);
    setState('run');
  };
  return (
    <div className="w2-panel bk-menu pointer-events-auto absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="bk-title">⏱ TIMING</div>
        <button type="button" className="bk-x" aria-label="close" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="text-sm opacity-80">
        sound on. four high clicks count you in, then tap along to the next {CALIB_CLICKS}: any key,
        or the button. your average lateness is taken off every press in a battle.
      </div>
      <div className="flex items-center justify-center gap-2 py-1">
        {Array.from({ length: CALIB_COUNT_IN + CALIB_CLICKS }, (_, i) => (
          <i
            key={i}
            className={`bk-dot ${i < CALIB_COUNT_IN ? 'bk-dot-in' : ''} ${flash === i ? 'bk-dot-on' : ''}`}
          />
        ))}
      </div>
      {state === 'run' ? (
        <button
          type="button"
          className="bk-go bk-tap"
          onPointerDown={e => {
            e.preventDefault();
            run.current?.taps.push(eventMs(e.timeStamp));
          }}
        >
          TAP
        </button>
      ) : (
        <button type="button" className="bk-go" onClick={start}>
          {state === 'done' ? 'AGAIN' : 'START'}
        </button>
      )}
      {state === 'done' &&
        (res === null ? (
          <div className="text-sm">not enough taps on the clicks: try again.</div>
        ) : (
          <div className="flex flex-col gap-2 text-sm">
            <div>
              you tap{' '}
              <b>
                {Math.abs(res.offsetMs)} ms {res.offsetMs >= 0 ? 'late' : 'early'}
              </b>{' '}
              (±{res.spreadMs} ms over {res.n} taps)
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="bk-go flex-1"
                onClick={() => {
                  b.setCalib(res.offsetMs);
                  onClose();
                }}
              >
                USE IT
              </button>
              <button type="button" className="bk-no" onClick={onClose}>
                KEEP {ui.calibMs} MS
              </button>
            </div>
          </div>
        ))}
      {ui.calibMs !== 0 && state !== 'run' && (
        <button
          type="button"
          className="text-xs underline opacity-60"
          onClick={() => b.setCalib(0)}
        >
          reset to 0 (now {ui.calibMs} ms)
        </button>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-14 shrink-0 text-xs uppercase opacity-60">{label}</span>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

// ── Touch pad: the four directions + A / B ──

const PAD: [BreakKey, string][] = [
  ['left', 'bk-l'],
  ['up', 'bk-u'],
  ['down', 'bk-d'],
  ['right', 'bk-r'],
  ['a', 'bk-a'],
  ['b', 'bk-b'],
];

function TouchPad({ b }: { b: BreakMode }) {
  const [hot, setHot] = useState<BreakKey | null>(null);
  return (
    <div className="bk-pad pointer-events-none absolute inset-x-0">
      {PAD.map(([k, cls]) => (
        <button
          key={k}
          type="button"
          className={`bk-padkey pointer-events-auto ${cls} ${hot === k ? 'bk-hot' : ''}`}
          onPointerDown={e => {
            e.preventDefault();
            b.reader.press(k, e.timeStamp);
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

function Results({ b, ui }: { b: BreakMode; ui: BreakUiState }) {
  const r = ui.results!;
  const won = r.myCrew !== null && r.myCrew === r.winner;
  const title =
    r.winner === 'tie'
      ? 'TIE'
      : r.myCrew === null
        ? `${r.crews[r.winner]} WIN`
        : won
          ? 'YOU WIN'
          : 'YOU LOSE';
  return (
    <div className="w2-panel bk-menu pointer-events-auto absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3 text-center">
      <div
        className="bk-title"
        style={{
          color: r.winner === 'tie' || r.myCrew === null ? '#ffd400' : won ? '#3ddc84' : '#ff4d3d',
        }}
      >
        {title}
      </div>
      <div className="bk-score">
        <span style={{ color: CREW_C[0] }}>{Math.round(r.totals[0])}</span> —{' '}
        <span style={{ color: CREW_C[1] }}>{Math.round(r.totals[1])}</span>
      </div>
      <div className="text-xs opacity-70">
        {r.crews[0]} vs {r.crews[1]}
      </div>
      {r.respect !== null && r.respect !== 0 && (
        <div className="text-sm">
          {r.respect > 0 ? '+' : ''}
          {r.respect} respect
        </div>
      )}
      <div className="flex w-full gap-2">
        {r.host && (
          <button type="button" className="bk-go flex-1" onClick={() => b.rematch()}>
            RUN IT BACK
          </button>
        )}
        <button type="button" className="bk-no flex-1" onClick={() => b.exit()}>
          BACK TO SKATING
        </button>
      </div>
    </div>
  );
}

const CSS = `
body[data-breaks] [data-nounfm="off"]{display:none!important}
.bk-root{font-family:system-ui,sans-serif}
.bk-prompt{background:#ffd400;color:#000;padding:12px 20px;font-size:18px;font-weight:900;font-style:italic;box-shadow:6px 6px 0 #d22209;white-space:nowrap;max-width:calc(100vw - 32px)}
.bk-menu{width:400px;max-width:calc(100vw - 32px);max-height:calc(100dvh - 32px);overflow-y:auto}
.bk-title{font-size:28px;font-weight:900;font-style:italic;letter-spacing:.02em;text-shadow:0 3px 0 #d22209}
.bk-x{width:36px;height:36px;border-radius:999px;background:rgba(255,255,255,.12);font-weight:900}
.bk-tabs{display:grid;grid-template-columns:repeat(4,1fr);gap:4px}
.bk-tab{padding:9px 0;border-radius:10px;background:rgba(255,255,255,.08);font-weight:900;font-size:13px;font-style:italic}
.bk-pill{background:rgba(255,255,255,.1);border-radius:999px;padding:6px 12px;font-weight:700;font-size:12px;min-height:32px}
.bk-on{background:#ffd400!important;color:#000!important}
.bk-list{max-height:28vh;overflow-y:auto}
.bk-go{background:#d22209;color:#fff;font-weight:900;font-size:18px;padding:10px 16px;border-radius:10px;box-shadow:0 4px 0 #7a1405;font-style:italic}
.bk-no{background:rgba(255,255,255,.12);color:#fff;font-weight:800;font-size:14px;padding:10px 14px;border-radius:10px}
.bk-score{font-size:44px;font-weight:900;font-style:italic;line-height:1}
.bk-card{display:flex;flex-direction:column;align-items:center;gap:6px;background:#ffd400;color:#000;padding:10px 18px;box-shadow:6px 6px 0 #d22209;min-width:260px;max-width:calc(100vw - 32px);text-align:center}
.bk-card span{font-size:10px;letter-spacing:.2em}.bk-card b{font-size:17px;font-style:italic}
.bk-card .bk-no{background:rgba(0,0,0,.15);color:#000}
.bk-bar{width:100%;height:4px;background:rgba(0,0,0,.15)}.bk-bar i{display:block;height:100%;background:#d22209;transition:width .25s linear}
.bk-howto{background:#000;color:#fff;padding:10px 16px 12px;box-shadow:6px 6px 0 #ffd400;max-width:min(460px,calc(100vw - 32px));transform:rotate(-1deg);animation:none}
.bk-howto span{display:block;font-size:12px;letter-spacing:.3em;color:#ffd400;font-weight:900;margin-bottom:4px}
.bk-howto ol{margin:0;padding-left:20px;list-style:decimal;font-size:15px;line-height:1.35}
.bk-howto em{font-style:normal;color:#ffd400}
.bk-songs{max-height:22vh;overflow-y:auto}
.bk-song{display:flex;flex-direction:column;align-items:flex-start;text-align:left;background:rgba(255,255,255,.08);border-radius:10px;padding:6px 10px}
.bk-song b{font-size:13px;font-style:italic}.bk-song span{font-size:11px;opacity:.7}
.bk-dot{display:block;width:14px;height:14px;border-radius:999px;background:rgba(255,255,255,.18);transition:background .05s}
.bk-dot-in{width:10px;height:10px}
.bk-dot-on{background:#ffd400;box-shadow:0 0 12px #ffd400}
.bk-tap{font-size:28px;padding:18px 16px;touch-action:none}
.bk-count b{font-size:min(30vw,180px);font-weight:900;font-style:italic;color:#ffd400;text-shadow:0 8px 0 #d22209;animation:bkpop .9s ease-out both}
@keyframes bkpop{0%{transform:scale(1.6);opacity:0}30%{transform:scale(1);opacity:1}100%{opacity:.2}}
/* Clear of the site's NOUN FM / hoops chips in the bottom corner */
.bk-pad{bottom:calc(84px + env(safe-area-inset-bottom));height:210px}
.bk-padkey{position:absolute;width:64px;height:64px;border-radius:16px;background:rgba(0,0,0,.45);border:2px solid rgba(255,255,255,.35);color:#fff;font-size:26px;font-weight:900;touch-action:none;user-select:none;-webkit-user-select:none}
.bk-hot{background:#ffd400;color:#000}
.bk-l{left:16px;bottom:72px}.bk-u{left:84px;bottom:136px}.bk-d{left:84px;bottom:16px}.bk-r{left:152px;bottom:72px}
.bk-a{right:16px;bottom:40px;width:78px;height:78px;border-radius:999px;background:rgba(210,34,9,.7)}
.bk-b{right:104px;bottom:96px;width:70px;height:70px;border-radius:999px;background:rgba(42,107,255,.7)}
`;
