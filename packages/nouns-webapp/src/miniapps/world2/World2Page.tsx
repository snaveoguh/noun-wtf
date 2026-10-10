// ── Noun World v2 — skate the plaza as your Noun ───────────────────────

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { useNavigate, useSearchParams } from 'react-router';

import { useAppSelector } from '@/hooks';

import { parseSeedKey, randomSeed, type NounSeed } from './character/NounAppearance';
import { BUILDS } from './character/NounCharacter';
import { Game, type HudState } from './Game';
import { CharacterSelect, loadSavedCharacter, type SavedCharacter } from './ui/CharacterSelect';
import { TouchControls } from './ui/TouchControls';
import { worldPause } from './worldPause';

const CONTROLS: { k: string; v: string }[] = [
  { k: 'W', v: 'push' },
  { k: 'A / D', v: 'carve, spin in air' },
  { k: 'S', v: 'brake, powerslide' },
  { k: 'SPACE', v: 'hold to crouch, release to ollie' },
  { k: 'J / L / K / U', v: 'kickflip, heelflip, shove-it, 360 flip' },
  { k: 'RMB drag', v: 'flick-it: pull down, flick up (diagonals = flips)' },
  { k: 'SHIFT / Q', v: 'manual, nose manual (hold, W/S to keep the balance dot centred)' },
  { k: 'I / O', v: 'grab' },
  { k: 'F', v: 'get on / off board' },
  {
    k: 'CLIMB',
    v: 'walk / jump into any building (or hold W mid-air), W/S up/down, A/D along, SHIFT faster, SPACE wall-jump, F let go',
  },
  { k: 'C', v: 'camera' },
  { k: 'P', v: 'time of day' },
  { k: 'M / .', v: 'radio station, next track' },
  { k: 'V', v: 'mic' },
  { k: 'CLICK+DRAG / G', v: 'spray where the mouse points (on foot), T colour' },
  { k: 'RIGHT-DRAG', v: 'look around (on foot)' },
  {
    k: 'MOUNTAIN',
    v: 'ride out any of the three arched alleys: the city is a peak with endless downhill all round it, and the longer you stay on the faster you go (a bail resets it)',
  },
  { k: 'R', v: 'respawn at the fountain or ice cream van (back up from the mountain)' },
  { k: 'ENTER', v: 'chat' },
];

const PAD: { k: string; v: string }[] = [
  { k: 'L stick', v: 'carve, spin' },
  { k: 'R stick', v: 'flick-it tricks (down → up = ollie)' },
  { k: 'A / X', v: 'push' },
  { k: 'B', v: 'brake' },
  { k: 'LT / RT', v: 'grabs' },
  { k: 'Y', v: 'board on / off' },
  { k: 'Climb', v: 'walk or jump into any wall, L stick climbs, A wall-jump, Y let go' },
  { k: 'RT (on foot)', v: 'spray paint, R3 colour' },
  {
    k: 'Mountain',
    v: 'the arched alleys lead out to endless downhill, stay on to keep speeding up, B brakes',
  },
];

export interface World2PageProps {
  /** Backgrounded behind the NounOS desk: freeze sim + render, release input. */
  paused?: boolean;
}

export default function World2Page({ paused = false }: World2PageProps = {}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const [game, setGame] = useState<Game | null>(null);
  // title → select (character select over the live showroom) → play
  const [phase, setPhase] = useState<'title' | 'select' | 'play'>('title');
  const started = phase === 'play';
  const saved = useMemo(() => loadSavedCharacter(), []);
  const [error, setError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState('');
  const [showHelp, setShowHelp] = useState(true);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const auctionSeed = useAppSelector(
    state => (state as { onDisplayAuction?: { seed?: NounSeed } }).onDisplayAuction?.seed,
  );
  const urlSeed = useMemo(() => parseSeedKey(searchParams.get('seed')), [searchParams]);
  const initialChar = useMemo<SavedCharacter>(
    () => ({
      seed: urlSeed ?? saved?.seed ?? auctionSeed ?? randomSeed(),
      name: searchParams.get('name') ?? saved?.name ?? '',
      board: searchParams.get('board') === 'hover' ? 'hover' : (saved?.board ?? 'skate'),
      build: saved?.build ?? 2,
    }),
    // Only the first resolution matters; the select screen owns it after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const seedRef = useRef<NounSeed>(initialChar.seed);

  useEffect(() => {
    const host = hostRef.current;
    const labels = labelsRef.current;
    if (!host || !labels) return;
    // Fresh canvas per mount: StrictMode double-mounts, and a WebGL context
    // torn down by the first renderer can't be reused by the second.
    const canvas = document.createElement('canvas');
    canvas.className = 'absolute inset-0 h-full w-full block';
    host.appendChild(canvas);
    let disposed = false;
    let g: Game;
    try {
      g = new Game({
        canvas,
        labelLayer: labels,
        seed: seedRef.current,
        offline: searchParams.get('offline') === '1',
        quality: (searchParams.get('q') as 'low' | 'medium' | 'high' | null) ?? undefined,
        name: initialChar.name !== '' ? initialChar.name : undefined,
      });
      g.showroom = searchParams.get('skip') !== '1';
      g.boardType = initialChar.board ?? 'skate';
      g.weight = BUILDS[initialChar.build ?? 2]?.w ?? 0;
    } catch (e) {
      setError((e as Error).message || 'WebGL unavailable');
      canvas.remove();
      return;
    }
    gameRef.current = g;
    setGame(g);
    (window as unknown as { __w2?: Game }).__w2 = g;
    const resize = () => g.resize(canvas.clientWidth, canvas.clientHeight);
    resize();
    window.addEventListener('resize', resize);
    g.start().catch(e => {
      if (!disposed) setError((e as Error).message);
    });
    return () => {
      disposed = true;
      window.removeEventListener('resize', resize);
      g.dispose();
      canvas.remove();
      gameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  useEffect(() => {
    worldPause.set(paused);
    game?.setPaused(paused);
    if (paused) setChatOpen(false);
  }, [game, paused]);

  // Keyboard: chat + help
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT';
      if (pausedRef.current || gameRef.current?.showroom === true) return;
      if (e.code === 'Enter' && !typing) {
        e.preventDefault();
        setChatOpen(true);
        if (document.pointerLockElement) document.exitPointerLock();
      } else if (e.code === 'KeyM' && !typing) {
        gameRef.current?.cycleRadio();
      } else if (e.code === 'Period' && !typing) {
        gameRef.current?.nextRadioTrack();
      } else if (e.code === 'KeyP' && !typing) {
        gameRef.current?.cycleTimeOfDay();
      } else if (e.code === 'KeyH' && !typing) {
        setShowHelp(s => !s);
      } else if (e.code === 'Escape' && typing) {
        setChatOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const begin = () => {
    gameRef.current?.unlockAudio();
    if (gameRef.current?.showroom === true) setPhase('select');
    else setPhase('play');
  };

  const confirmCharacter = (c: SavedCharacter) => {
    const g = gameRef.current;
    if (!g) return;
    g.setSeed(c.seed);
    g.setBoardType(c.board ?? 'skate');
    g.setWeight(BUILDS[c.build ?? 2]?.w ?? 0);
    g.name = c.name;
    g.enterWorld();
    setPhase('play');
  };

  return (
    <div
      className="fixed inset-0 select-none overflow-hidden bg-[#0d1117] text-white"
      style={{
        touchAction: 'none',
        fontFamily: "'Londrina Solid', 'PT Root UI', system-ui, sans-serif",
      }}
      onPointerDown={() => gameRef.current?.unlockAudio()}
    >
      <style>{CSS}</style>
      <div ref={hostRef} className="absolute inset-0" />
      <div ref={labelsRef} className="pointer-events-none absolute inset-0" />
      {game && started && (
        <Hud game={game} showHelp={showHelp} onHelp={() => setShowHelp(s => !s)} />
      )}
      {game && started && <TouchControls game={game} />}

      {chatOpen && (
        <form
          className="absolute bottom-24 left-1/2 w-[min(520px,90vw)] -translate-x-1/2"
          onSubmit={e => {
            e.preventDefault();
            gameRef.current?.sendChat(chatText);
            setChatText('');
            setChatOpen(false);
          }}
        >
          <input
            autoFocus
            maxLength={140}
            value={chatText}
            onChange={e => setChatText(e.target.value)}
            onBlur={() => setChatOpen(false)}
            placeholder="say something…"
            className="w-full rounded-xl border border-white/20 bg-black/60 px-4 py-3 text-lg text-white outline-none backdrop-blur"
          />
        </form>
      )}

      {game && phase === 'select' && (
        <CharacterSelect
          game={game}
          initial={initialChar}
          auctionSeed={auctionSeed ?? null}
          onConfirm={confirmCharacter}
        />
      )}
      {(phase === 'title' || !game) && !error && <SplashGate game={game} onStart={begin} />}
      {game && searchParams.get('diag') === '1' && <Diagnostics game={game} />}

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/80 p-6 text-center">
          <div className="text-3xl">couldn&apos;t start the world</div>
          <div className="opacity-70">{error}</div>
          <button className="w2-btn" onClick={() => navigate('/world/classic')}>
            play classic world
          </button>
        </div>
      )}
    </div>
  );
}

function useHud(game: Game): HudState {
  return useSyncExternalStore(
    cb => game.subscribe(cb),
    () => game.hud,
  );
}

function Diagnostics({ game }: { game: Game }) {
  const [shots, setShots] = useState<{ label: string; url: string }[] | null>(null);
  const gpu = useMemo(() => {
    try {
      const gl = document.createElement('canvas').getContext('webgl2');
      const ext = gl?.getExtension('WEBGL_debug_renderer_info');
      return ext ? String(gl!.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown GPU';
    } catch {
      return 'unknown GPU';
    }
  }, []);
  return (
    <div className="absolute left-3 top-3 z-50" style={{ fontFamily: 'ui-monospace, monospace' }}>
      <button
        type="button"
        className="rounded bg-[#d4ff3a] px-3 py-2 text-sm font-bold text-black"
        onClick={() => setShots(game.runDiagnostics())}
      >
        RUN DIAGNOSTIC
      </button>
      {shots && (
        <div className="fixed inset-0 overflow-auto bg-black p-3 text-white">
          <div className="mb-2 text-xs">
            {gpu}, {navigator.userAgent.slice(0, 120)}{' '}
            <button type="button" className="ml-2 underline" onClick={() => setShots(null)}>
              close
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {shots.map(s => (
              <figure key={s.label} className="m-0">
                <img src={s.url} alt={s.label} className="w-full" />
                <figcaption className="text-sm">{s.label}</figcaption>
              </figure>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SplashGate({ game, onStart }: { game: Game | null; onStart: () => void }) {
  if (!game) return <Splash loading="booting" ready={false} onStart={onStart} />;
  return <SplashLive game={game} onStart={onStart} />;
}

function SplashLive({ game, onStart }: { game: Game; onStart: () => void }) {
  const hud = useHud(game);
  return <Splash loading={hud.loading} ready={!hud.loading} onStart={onStart} />;
}

function Splash({
  loading,
  ready,
  onStart,
}: {
  loading: string | null;
  ready: boolean;
  onStart: () => void;
}) {
  useEffect(() => {
    if (!ready) return;
    const k = (e: KeyboardEvent) => {
      if (worldPause.get()) return;
      if (e.code === 'Enter' || e.code === 'Space') onStart();
    };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [ready, onStart]);
  return (
    <div className="w2-splash absolute inset-0 flex flex-col items-center justify-center">
      <div className="w2-title">
        NOUN<span>WORLD</span>
      </div>
      <div className="mt-1 text-sm tracking-[0.35em] opacity-70">SKATE THE PLAZA</div>
      <div className="mt-10 h-12">
        {ready ? (
          <button className="w2-btn w2-pulse" onClick={onStart}>
            PRESS START ⌐◨-◨
          </button>
        ) : (
          <div className="flex items-center gap-3 text-lg opacity-80">
            <span className="w2-spinner" /> {loading}…
          </div>
        )}
      </div>
      <div className="absolute bottom-6 text-xs opacity-50">
        gamepad recommended, headphones on, mic optional
      </div>
    </div>
  );
}

function Hud({ game, showHelp, onHelp }: { game: Game; showHelp: boolean; onHelp: () => void }) {
  const hud = useHud(game);
  const now = performance.now();
  const banked = hud.banked && now - hud.banked.at < 2600 ? hud.banked : null;
  const pad = hud.inputMode === 'gamepad';
  return (
    <div className="pointer-events-none absolute inset-0">
      {/* Speed lines once a mountain run outpaces the plaza (CSS only) */}
      {hud.mode === 'board' && hud.speed > 20 && (
        <div className="w2-speedlines" style={{ opacity: Math.min(0.75, (hud.speed - 20) / 45) }} />
      )}
      {/* Top-left: session */}
      <div className="absolute left-4 top-4 flex flex-col gap-1">
        <div className="w2-chip">
          <b>{hud.session.toLocaleString()}</b> pts{' '}
          <span className="opacity-60">best {hud.best.toLocaleString()}</span>
        </div>
        <div className="w2-chip text-xs opacity-80">
          {hud.connected ? '●' : '○'} {hud.players} online, {hud.mode === 'board' ? '🛹' : '🚶'}{' '}
          {Math.round(hud.speed * 3.6)} km/h
        </div>
        {hud.mountain !== null && (
          <div className="w2-chip text-xs opacity-80">
            ⛰ {(hud.mountain.down / 1000).toFixed(2)} km out, {hud.mountain.surface}, streak{' '}
            {hud.mountain.streak}s
          </div>
        )}
      </div>

      {/* Top-centre: landmarks compass */}
      <div className="absolute left-1/2 top-3 flex -translate-x-1/2 gap-3 text-xs">
        {hud.landmarks.slice(0, 4).map(l => {
          const deg = (((((l.bearing * 180) / Math.PI) % 360) + 540) % 360) - 180;
          if (Math.abs(deg) > 70) return null;
          return (
            <div key={l.name} className="w2-chip" style={{ transform: `translateX(${deg * 3}px)` }}>
              {l.name} <span className="opacity-60">{l.dist}m</span>
            </div>
          );
        })}
      </div>

      {/* Top-right: voice + system */}
      <div className="pointer-events-auto absolute right-4 top-4 flex flex-col items-end gap-2">
        <button
          className={`w2-chip ${hud.mic === 'on' ? (hud.speaking ? 'w2-live' : 'w2-on') : ''}`}
          onClick={() => void game.toggleMic()}
          title="Toggle mic (V)"
        >
          {hud.mic === 'off'
            ? '🎙️ join voice'
            : hud.mic === 'muted'
              ? '🔇 muted'
              : hud.speaking
                ? '🔊 talking'
                : '🎙️ live'}
        </button>
        <div className="w2-chip text-[10px] opacity-60">
          {hud.fps} fps, {hud.quality}
          {hud.baked ? ', baked GI' : ''}, cam {hud.camMode}
        </div>
        <button className="w2-chip text-xs" onClick={onHelp}>
          {showHelp ? 'hide controls (H)' : 'controls (H)'}
        </button>
        <button
          type="button"
          className="w2-chip text-xs"
          onClick={() => game.cycleTimeOfDay()}
          title="Time of day (P)"
        >
          {{
            afternoon: '☀️ afternoon',
            golden: '🌇 golden hour',
            blue: '🌆 blue hour',
            night: '🌙 night',
          }[hud.timeOfDay] ?? hud.timeOfDay}
        </button>
        <button
          type="button"
          className={`w2-chip text-xs ${hud.radio.on ? 'w2-on' : ''}`}
          onClick={() => (hud.radio.on ? game.nextRadioTrack() : game.cycleRadio())}
          onContextMenu={e => {
            e.preventDefault();
            game.cycleRadio();
          }}
          title="Radio: M station, . next track (right-click: change station)"
        >
          📻 {hud.radio.on ? hud.radio.label : 'radio off'}
        </button>
      </div>

      {/* Now playing toast (JSR-style station card) */}
      {hud.radio.on && now - hud.radio.at < 4500 && (
        <div key={hud.radio.at} className="w2-nowplaying absolute left-1/2 top-16 -translate-x-1/2">
          <span>📻 NOW PLAYING</span>
          <b>{hud.radio.label}</b>
        </div>
      )}

      {/* Chat feed */}
      <div className="absolute bottom-28 left-4 flex max-w-[60vw] flex-col gap-1">
        {hud.chat
          .filter(c => now - c.at < 12000)
          .map((c, i) => (
            <div key={i} className="w2-chip text-sm">
              <b>{c.name}</b> {c.text}
            </div>
          ))}
      </div>

      {/* Combo */}
      <div className="absolute bottom-16 left-1/2 flex w-[90vw] -translate-x-1/2 flex-col items-center text-center">
        {hud.combo && (
          <>
            <div className="w2-combo-label">{hud.combo.label}</div>
            <div className="w2-combo-score">
              {hud.combo.score.toLocaleString()}
              {hud.combo.multiplier > 1 && <span> ×{hud.combo.multiplier}</span>}
            </div>
          </>
        )}
        {!hud.combo && banked && (
          <div key={banked.at} className={`w2-banked ${banked.bailed ? 'w2-bailed' : ''}`}>
            {banked.bailed ? 'BAILED' : `+${banked.points.toLocaleString()}`}
            <div className="text-sm opacity-80">{banked.label}</div>
          </div>
        )}
        {hud.manualBalance !== null && (
          <div className="mt-2 flex flex-col items-center gap-1">
            <div className="flex items-center gap-2 text-xs font-bold">
              <span className="text-[#ffd400]">W ◀</span>
              <div className="h-2 w-48 rounded-full bg-white/20">
                <div
                  className="h-2 w-2 rounded-full bg-[#ffd400]"
                  style={{
                    transform: `translateX(${(Math.max(-1, Math.min(1, hud.manualBalance)) + 1) * 92}px)`,
                  }}
                />
              </div>
              <span className="text-[#ffd400]">▶ S</span>
            </div>
            <div className="text-xs opacity-80">W / S to balance, keep the dot centred</div>
          </div>
        )}
      </div>

      {(hud.mode === 'foot' || hud.spray.active) && (
        <div className="w2-chip absolute bottom-4 right-4 flex items-center gap-2 text-xs">
          <span
            className="inline-block h-4 w-4 rounded-full border border-white/50"
            style={{ background: hud.spray.color }}
          />
          {hud.spray.aiming
            ? 'click and drag to spray, T colour'
            : 'point at a wall to tag it, right-drag to look'}
        </div>
      )}

      {/* Controls */}
      {showHelp && hud.inputMode !== 'touch' && (
        <div className="absolute bottom-4 left-4 hidden rounded-xl bg-black/45 p-3 text-xs backdrop-blur md:block">
          {(pad ? PAD : CONTROLS).map(c => (
            <div key={c.k} className="flex gap-3">
              <span className="w-24 text-right font-bold text-[#ffd400]">{c.k}</span>
              <span className="opacity-85">{c.v}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const CSS = `
.w2-speedlines{position:absolute;inset:-10%;background:repeating-conic-gradient(from 0deg at 50% 52%,rgba(255,255,255,0) 0deg 5deg,rgba(255,255,255,.55) 5deg 5.4deg,rgba(255,255,255,0) 5.4deg 9deg,rgba(255,255,255,.35) 9deg 9.25deg);-webkit-mask-image:radial-gradient(ellipse at 50% 52%,transparent 38%,#000 78%);mask-image:radial-gradient(ellipse at 50% 52%,transparent 38%,#000 78%);animation:w2lines .24s steps(3) infinite;transition:opacity .3s}
@keyframes w2lines{0%{transform:rotate(0)}100%{transform:rotate(3deg)}}
.w2-chip{background:rgba(10,12,20,.5);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:4px 12px;font-family:system-ui,sans-serif;white-space:nowrap}
.w2-on{border-color:#3ddc84}
.w2-live{border-color:#3ddc84;background:rgba(61,220,132,.35)}
.w2-btn{pointer-events:auto;background:#d22209;color:#fff;font-size:22px;letter-spacing:.06em;padding:12px 28px;border-radius:14px;box-shadow:0 6px 0 #7a1405,0 10px 30px rgba(0,0,0,.4);transition:transform .08s}
.w2-btn:active{transform:translateY(4px);box-shadow:0 2px 0 #7a1405}
.w2-pulse{animation:w2pulse 1.6s ease-in-out infinite}
@keyframes w2pulse{50%{transform:scale(1.05)}}
.w2-splash{background:radial-gradient(ellipse at 50% 40%,rgba(30,40,70,.55),rgba(5,6,12,.92))}
/* Site themes force *{font-family:...!important}; out-specify it for the title only */
.w2-splash .w2-title,.w2-splash .w2-title *{font-family:'Pip3',system-ui,sans-serif !important;text-transform:uppercase !important}
.w2-splash .w2-btn{font-family:'Londrina Solid',system-ui,sans-serif !important;font-size:30px;letter-spacing:.04em;font-weight:900}
.w2-title{font-family:'Pip3',system-ui,sans-serif;text-transform:uppercase;font-size:clamp(64px,13vw,170px);line-height:.85;font-weight:400;letter-spacing:.01em;text-shadow:0 8px 0 #d22209,0 16px 40px rgba(0,0,0,.6);font-style:italic}
.w2-title span{display:block;color:#ffd400;font-size:.55em;text-align:right}
.w2-spinner{width:18px;height:18px;border:3px solid rgba(255,255,255,.25);border-top-color:#ffd400;border-radius:50%;animation:w2spin .8s linear infinite}
@keyframes w2spin{to{transform:rotate(360deg)}}
.w2-combo-label{font-size:clamp(16px,2.4vw,26px);font-style:italic;font-weight:800;text-shadow:0 2px 0 #000,0 0 18px rgba(0,0,0,.6);max-width:90vw}
.w2-combo-score{font-size:clamp(28px,4.4vw,52px);font-weight:900;color:#ffd400;font-style:italic;text-shadow:0 3px 0 #7a5a00,0 0 24px rgba(0,0,0,.5)}
.w2-combo-score span{color:#fff;font-size:.6em}
.w2-banked{font-size:clamp(30px,5vw,60px);font-weight:900;color:#3ddc84;font-style:italic;text-shadow:0 3px 0 #0b5a2f;animation:w2bank 2.6s ease-out forwards}
.w2-bailed{color:#ff4d3d;text-shadow:0 3px 0 #6a0f06}
@keyframes w2bank{0%{transform:scale(.6);opacity:0}10%{transform:scale(1.1);opacity:1}20%{transform:scale(1)}80%{opacity:1}100%{opacity:0;transform:translateY(-20px)}}
.w2-nowplaying{display:flex;flex-direction:column;align-items:center;gap:2px;background:#ffd400;color:#000;padding:8px 18px;transform-origin:center;box-shadow:6px 6px 0 #d22209;font-family:system-ui,sans-serif;animation:w2np 4.5s ease-out forwards}.w2-nowplaying span{font-size:10px;letter-spacing:.2em}.w2-nowplaying b{font-size:18px;font-style:italic}@keyframes w2np{0%{opacity:0;transform:translate(-50%,-20px) rotate(-3deg)}8%{opacity:1;transform:translate(-50%,0) rotate(-3deg)}85%{opacity:1}100%{opacity:0}}
.w2-nametag{position:absolute;left:0;top:0;text-align:center;font-family:system-ui,sans-serif;font-size:12px;white-space:nowrap}
.w2-nametag span{background:rgba(0,0,0,.55);padding:2px 8px;border-radius:999px}
.w2-said{background:#fff;color:#111;border-radius:10px;padding:3px 8px;margin-bottom:4px;max-width:220px;white-space:normal;font-size:12px}
.w2-trick{color:#ffd400;font-style:italic;font-weight:700;margin-bottom:2px;text-shadow:0 1px 0 #000}
`;
