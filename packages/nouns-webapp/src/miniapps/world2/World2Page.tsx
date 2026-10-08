// ── Noun World v2 — skate the plaza as your Noun ───────────────────────

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { useNavigate, useSearchParams } from 'react-router';

import { useAppSelector } from '@/hooks';

import { parseSeedKey, randomSeed, type NounSeed } from './character/NounAppearance';
import { Game, type HudState } from './Game';
import { CharacterSelect, loadSavedCharacter, type SavedCharacter } from './ui/CharacterSelect';
import { TouchControls } from './ui/TouchControls';

const CONTROLS: { k: string; v: string }[] = [
  { k: 'W', v: 'push' },
  { k: 'A / D', v: 'carve · spin in air' },
  { k: 'S', v: 'brake · powerslide' },
  { k: 'SPACE', v: 'hold to crouch, release to ollie' },
  { k: 'J / L / K / U', v: 'kickflip · heelflip · shove-it · 360 flip' },
  { k: 'RMB drag', v: 'flick-it: pull down, flick up (diagonals = flips)' },
  { k: 'SHIFT / Q', v: 'manual · nose manual' },
  { k: 'I / O', v: 'grab' },
  { k: 'F', v: 'get on / off board' },
  { k: 'C', v: 'camera' },
  { k: 'V', v: 'mic' },
  { k: 'R', v: 'respawn' },
  { k: 'ENTER', v: 'chat' },
];

const PAD: { k: string; v: string }[] = [
  { k: 'L stick', v: 'carve · spin' },
  { k: 'R stick', v: 'flick-it tricks (down → up = ollie)' },
  { k: 'A / X', v: 'push' },
  { k: 'B', v: 'brake' },
  { k: 'LT / RT', v: 'grabs' },
  { k: 'Y', v: 'board on / off' },
];

export default function World2Page() {
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

  // Keyboard: chat + help
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT';
      if (gameRef.current?.showroom === true) return;
      if (e.code === 'Enter' && !typing) {
        e.preventDefault();
        setChatOpen(true);
        if (document.pointerLockElement) document.exitPointerLock();
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
      <div className="mt-1 text-sm tracking-[0.35em] opacity-70">SKATE THE PLAZA · v2</div>
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
        gamepad recommended · headphones on · mic optional
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
      {/* Top-left: session */}
      <div className="absolute left-4 top-4 flex flex-col gap-1">
        <div className="w2-chip">
          <b>{hud.session.toLocaleString()}</b> pts{' '}
          <span className="opacity-60">· best {hud.best.toLocaleString()}</span>
        </div>
        <div className="w2-chip text-xs opacity-80">
          {hud.connected ? '●' : '○'} {hud.players} online · {hud.mode === 'board' ? '🛹' : '🚶'}{' '}
          {Math.round(hud.speed * 3.6)} km/h
        </div>
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
          {hud.fps} fps · {hud.quality}
          {hud.baked ? ' · baked GI' : ''} · cam {hud.camMode}
        </div>
        <button className="w2-chip text-xs" onClick={onHelp}>
          {showHelp ? 'hide controls (H)' : 'controls (H)'}
        </button>
      </div>

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
          <div className="mt-2 h-2 w-48 rounded-full bg-white/20">
            <div
              className="h-2 w-2 rounded-full bg-[#ffd400]"
              style={{
                transform: `translateX(${(Math.max(-1, Math.min(1, hud.manualBalance)) + 1) * 92}px)`,
              }}
            />
          </div>
        )}
      </div>

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
.w2-chip{background:rgba(10,12,20,.5);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.12);border-radius:999px;padding:4px 12px;font-family:system-ui,sans-serif;white-space:nowrap}
.w2-on{border-color:#3ddc84}
.w2-live{border-color:#3ddc84;background:rgba(61,220,132,.35)}
.w2-btn{pointer-events:auto;background:#d22209;color:#fff;font-size:22px;letter-spacing:.06em;padding:12px 28px;border-radius:14px;box-shadow:0 6px 0 #7a1405,0 10px 30px rgba(0,0,0,.4);transition:transform .08s}
.w2-btn:active{transform:translateY(4px);box-shadow:0 2px 0 #7a1405}
.w2-pulse{animation:w2pulse 1.6s ease-in-out infinite}
@keyframes w2pulse{50%{transform:scale(1.05)}}
.w2-splash{background:radial-gradient(ellipse at 50% 40%,rgba(30,40,70,.55),rgba(5,6,12,.92))}
.w2-title{font-size:clamp(56px,11vw,140px);line-height:.85;font-weight:900;letter-spacing:-.02em;text-shadow:0 8px 0 #d22209,0 16px 40px rgba(0,0,0,.6);font-style:italic}
.w2-title span{display:block;color:#ffd400;font-size:.55em;text-align:right}
.w2-spinner{width:18px;height:18px;border:3px solid rgba(255,255,255,.25);border-top-color:#ffd400;border-radius:50%;animation:w2spin .8s linear infinite}
@keyframes w2spin{to{transform:rotate(360deg)}}
.w2-combo-label{font-size:clamp(16px,2.4vw,26px);font-style:italic;font-weight:800;text-shadow:0 2px 0 #000,0 0 18px rgba(0,0,0,.6);max-width:90vw}
.w2-combo-score{font-size:clamp(28px,4.4vw,52px);font-weight:900;color:#ffd400;font-style:italic;text-shadow:0 3px 0 #7a5a00,0 0 24px rgba(0,0,0,.5)}
.w2-combo-score span{color:#fff;font-size:.6em}
.w2-banked{font-size:clamp(30px,5vw,60px);font-weight:900;color:#3ddc84;font-style:italic;text-shadow:0 3px 0 #0b5a2f;animation:w2bank 2.6s ease-out forwards}
.w2-bailed{color:#ff4d3d;text-shadow:0 3px 0 #6a0f06}
@keyframes w2bank{0%{transform:scale(.6);opacity:0}10%{transform:scale(1.1);opacity:1}20%{transform:scale(1)}80%{opacity:1}100%{opacity:0;transform:translateY(-20px)}}
.w2-nametag{position:absolute;left:0;top:0;text-align:center;font-family:system-ui,sans-serif;font-size:12px;white-space:nowrap}
.w2-nametag span{background:rgba(0,0,0,.55);padding:2px 8px;border-radius:999px}
.w2-said{background:#fff;color:#111;border-radius:10px;padding:3px 8px;margin-bottom:4px;max-width:220px;white-space:normal;font-size:12px}
.w2-trick{color:#ffd400;font-style:italic;font-weight:700;margin-bottom:2px;text-shadow:0 1px 0 #000}
`;
