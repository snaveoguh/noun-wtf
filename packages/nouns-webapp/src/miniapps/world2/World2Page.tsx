// ── Noun World v2 — skate the plaza as your Noun ───────────────────────

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { useNavigate, useSearchParams } from 'react-router';

import { useAppSelector } from '@/hooks';

import { bindUiSounds } from './audio/sfx/uiSounds';
import { parseSeedKey, randomSeed, type NounSeed } from './character/NounAppearance';
import { BUILDS, parseBoardType } from './character/NounCharacter';
import { CUTSCENE_CSS, CutsceneUi } from './cutscene/CutsceneUi';
import { DragonHud } from './dragon/DragonHud';
import { Game, type HudState } from './Game';
import { SprayPanel } from './graffiti/SprayPanel';
import { HoopsUi, useHoopsActive } from './hoops/net/HoopsUi';
import { MISSIONS_CSS, MissionsUi } from './missions/MissionsUi';
import {
  shortAddr,
  STAT_INFO,
  walletLink,
  type MyBests,
  type StatKey,
  type StatRow,
  type WorldStats,
} from './net/Stats';
import { applyWorldManifest, registerWorldSw } from './pwa/install';
import { InstallButton } from './pwa/InstallButton';
import { FM_CSS, FmPanel, FmScreen } from './radio/FmPanel';
import { introAllowed, introEnabled } from './radio/FmSpots';
import { FmSpotsUi } from './radio/FmSpotsUi';
import { RecordsUi, useReplayActive } from './replay/RecordsUi';
import { bindSettings } from './settings/bind';
import { SETTINGS_CSS } from './settings/hudCss';
import { HudPrefsStyle, SettingsCog } from './settings/SettingsPanel';
import { bootQuality } from './settings/store';
import { TradeUi } from './trade/TradeUi';
import { CharacterSelect, loadSavedCharacter, type SavedCharacter } from './ui/CharacterSelect';
import { DeckDesigner, useDeckWallet } from './ui/DeckDesigner';
import { DropClaim } from './ui/DropClaim';
import { HudDrag } from './ui/HudDrag';
import { TouchControls, useIsTouch } from './ui/TouchControls';
import { WalletLink } from './ui/WalletLink';
import { WorldMap } from './ui/WorldMap';
import { useVanDriving } from './van/useVan';
import { VanHud } from './van/VanHud';
import { worldPause } from './worldPause';

/** The radio stations in M-cycle order, for the HUD's station strip. */
const RADIO_STATIONS: { mode: 'fm' | 'beats'; name: string }[] = [
  { mode: 'fm', name: 'COMMUNITY RADIO' },
  { mode: 'beats', name: 'NOUN BEATS (hip-hop)' },
];

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
  { k: 'B', v: 'map' },
  { k: 'M', v: 'radio station: COMMUNITY RADIO → NOUN BEATS (hip-hop) → off' },
  { k: '.', v: 'next track (NOUN BEATS: a fresh beat)' },
  { k: 'E (in the van)', v: 'COMMUNITY RADIO decks: queue a track, book a DJ set' },
  {
    k: 'E (cab door)',
    v: 'drive the ice cream van: W/S gas, brake, A/D steer, SPACE drift, SHIFT boost, H horn, R flip, E out',
  },
  {
    k: 'ALT hold',
    v: 'free the mouse: drag the HUD (speedometer, chips) anywhere, double-click resets',
  },
  { k: 'V', v: 'mic' },
  { k: 'CLICK+DRAG / G', v: 'spray where the mouse points (on foot)' },
  {
    k: 'SPRAY TOOLS',
    v: 'T / ⇧T colour, 1–0 swatch (aiming at a wall), [ ] or wheel while spraying nozzle, ⇧click straight line, Ctrl/⌘Z undo, ALT+click pick colour',
  },
  { k: 'RIGHT-DRAG', v: 'look around (on foot)' },
  {
    k: 'MOUNTAIN',
    v: 'ride out any of the three arched alleys: the city is a peak with endless downhill all round it, and the longer you keep riding fast (30 km/h+) the faster you go (a bail resets it)',
  },
  { k: 'R', v: 'respawn at the fountain or ice cream van (back up from the mountain)' },
  { k: 'E (by a character)', v: 'talk: the Oracle by the fountain hands out missions' },
  { k: 'X', v: 'missions journal' },
  { k: 'Y', v: 'replay your last run in slow motion (Esc to come back)' },
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
  const rootRef = useRef<HTMLDivElement>(null);
  // Installable as an app on /world: Noun World's manifest + offline worker
  useEffect(() => {
    registerWorldSw(window.location.pathname);
    return applyWorldManifest(window.location.pathname);
  }, []);
  // Every HUD / panel button clicks (audio/sfx/uiSounds)
  useEffect(() => {
    const root = rootRef.current;
    if (game === null || root === null) return;
    return bindUiSounds(root, game.sfx);
  }, [game]);
  // title → select (character select over the live showroom) → play
  const [phase, setPhase] = useState<'title' | 'select' | 'play'>('title');
  const started = phase === 'play';
  const saved = useMemo(() => loadSavedCharacter(), []);
  const [error, setError] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatText, setChatText] = useState('');
  // Phones start without the keyboard controls sheet (it covers the screen)
  const [showHelp, setShowHelp] = useState(
    () => window.matchMedia?.('(pointer: coarse)').matches !== true,
  );
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
      board: searchParams.has('board')
        ? parseBoardType(searchParams.get('board'))
        : parseBoardType(saved?.board),
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
        quality: bootQuality(searchParams.get('q')),
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
    const unbindSettings = bindSettings(g);
    // Console handle for local testing only (dev server, or ?debug, which
    // also stops the session posting stats)
    if (import.meta.env.DEV || new URLSearchParams(window.location.search).has('debug'))
      (window as unknown as { __w2?: Game }).__w2 = g;
    const resize = () => g.resize(canvas.clientWidth, canvas.clientHeight);
    resize();
    window.addEventListener('resize', resize);
    g.start().catch(e => {
      if (!disposed) setError((e as Error).message);
    });
    return () => {
      disposed = true;
      unbindSettings();
      window.removeEventListener('resize', resize);
      g.dispose();
      canvas.remove();
      gameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hoopsOn = useHoopsActive(game);
  // (flying the dragon keeps the skate stick: it turns and sets the speed)
  const driving = useVanDriving(game);
  const replaying = useReplayActive(game);

  // NOUN FM's start-of-game intro: from PRESS START, so it plays over character
  // select (once per page load; ?fmintro=1 forces it offline)
  useEffect(() => {
    if (!game || phase === 'title') return;
    const ok = introAllowed({
      enabled: introEnabled(),
      played: game.spots.introPlayed,
      offline: searchParams.get('offline') === '1',
      forced: searchParams.get('fmintro') === '1',
      replay: game.replay.active,
      fmMode: game.radio.mode === 'fm',
    });
    game.spots.introPlayed = true;
    if (ok) void game.spots.intro();
  }, [game, phase, searchParams]);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  useEffect(() => {
    worldPause.set(paused);
    game?.setPaused(paused);
    if (paused) setChatOpen(false);
  }, [game, paused]);

  // Board shop (deck designer): from the Noun Jersey shop door or the select screen
  useDeckWallet();
  const [deckOpen, setDeckOpen] = useState(false);
  const openDeck = () => {
    gameRef.current?.setPaused(true);
    setDeckOpen(true);
  };
  const closeDeck = () => {
    setDeckOpen(false);
    gameRef.current?.setPaused(pausedRef.current);
  };
  useEffect(() => {
    if (!game || phase !== 'play' || deckOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyE' || !game.hud.shop || pausedRef.current) return;
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      // Capture phase: the game's own E (board on/off) never sees it
      e.stopPropagation();
      e.preventDefault();
      game.setPaused(true);
      setDeckOpen(true);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [game, phase, deckOpen]);

  // NOUN FM decks (inside the ice cream van)
  const [fmOpen, setFmOpen] = useState(false);
  const touchPage = useIsTouch();
  useEffect(() => {
    if (!game || phase !== 'play' || fmOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'KeyE' || !game.hud.fmDecks || pausedRef.current) return;
      if ((e.target as HTMLElement | null)?.tagName === 'INPUT') return;
      e.stopPropagation();
      e.preventDefault();
      setFmOpen(true);
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [game, phase, fmOpen]);

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
      ref={rootRef}
      className="w2-root fixed inset-0 select-none overflow-hidden bg-[#0d1117] text-white"
      style={{
        touchAction: 'none',
        fontFamily: "'Londrina Solid', 'PT Root UI', system-ui, sans-serif",
      }}
      onPointerDown={() => gameRef.current?.unlockAudio()}
    >
      <style>{CSS + FM_CSS + SETTINGS_CSS + MISSIONS_CSS + CUTSCENE_CSS}</style>
      <HudPrefsStyle />
      <div ref={hostRef} data-w2keep="" className="absolute inset-0" />
      <div ref={labelsRef} className="pointer-events-none absolute inset-0" />
      {game && started && !hoopsOn && !replaying && (
        <Hud
          game={game}
          showHelp={showHelp}
          onHelp={() => setShowHelp(s => !s)}
          onShop={openDeck}
          onFm={() => setFmOpen(true)}
        />
      )}
      {/* NOUN FM from PRESS START: its screen and the intro's skip chip show over character select too */}
      {game && phase !== 'title' && <FmScreen fm={game.fm} touch={touchPage} />}
      {game && phase !== 'title' && <FmSpotsUi spots={game.spots} />}
      {game && started && fmOpen && <FmPanel game={game} onClose={() => setFmOpen(false)} />}
      {game && started && !hoopsOn && !driving && <TouchControls game={game} />}
      {game && started && !hoopsOn && !replaying && <VanHud game={game} touch={touchPage} />}
      {game && started && !hoopsOn && !replaying && <DragonHud game={game} touch={touchPage} />}
      {game && started && !hoopsOn && <MissionsUi game={game} touch={touchPage} />}
      {game && started && !hoopsOn && !replaying && <TradeUi game={game} touch={touchPage} />}
      {game && started && <HoopsUi game={game} />}
      {game && started && !hoopsOn && (
        <RecordsUi game={game} admin={searchParams.get('appeals') === '1'} />
      )}
      {game?.drops && started && <DropClaim drops={game.drops} />}
      {game && started && <CutsceneUi game={game} touch={touchPage} />}

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
          onDesignDeck={openDeck}
        />
      )}
      {game && deckOpen && <DeckDesigner game={game} onClose={closeDeck} />}
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
      <InstallButton className="mt-6" />
      <div className="absolute bottom-6 text-xs opacity-50">
        gamepad recommended, headphones on, mic optional
      </div>
    </div>
  );
}

function Hud({
  game,
  showHelp,
  onHelp,
  onShop,
  onFm,
}: {
  game: Game;
  showHelp: boolean;
  onHelp: () => void;
  onShop: () => void;
  onFm: () => void;
}) {
  const hud = useHud(game);
  const now = performance.now();
  const banked = hud.banked && now - hud.banked.at < 2600 ? hud.banked : null;
  const pad = hud.inputMode === 'gamepad';
  // Phones: sit below the compact site tray and drop desktop-only chips
  const touch = useIsTouch();
  const top = touch ? 'top-12' : 'top-4';
  return (
    <div className="pointer-events-none absolute inset-0">
      {/* Speed lines once a mountain run outpaces the plaza (CSS only) */}
      {hud.mode === 'board' && hud.speed > 20 && (
        <div className="w2-speedlines" style={{ opacity: Math.min(0.75, (hud.speed - 20) / 45) }} />
      )}
      {/* Speedometer: just under the rider by default, drag it anywhere */}
      {hud.mode === 'board' && (
        <HudDrag id="speed" className="absolute left-1/2 top-[64%] -translate-x-1/2">
          <div className="w2-speedo">
            <b>{Math.round(hud.speed * 3.6)}</b>
            <span>km/h</span>
          </div>
        </HudDrag>
      )}

      {/* Top-left: session */}
      <HudDrag id="session" className={`absolute left-4 ${top} flex flex-col gap-1`}>
        <div className="w2-chip">
          <b>{hud.session.toLocaleString()}</b> pts{' '}
          <span className="opacity-60">
            best {Math.max(hud.best, hud.mineCombo ?? 0).toLocaleString()}
          </span>
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
      </HudDrag>

      {/* Top-centre: landmarks compass (no room for it on phones) */}
      <div
        data-w2hud="compass"
        className={`absolute left-1/2 top-3 -translate-x-1/2 gap-3 text-xs ${touch ? 'hidden' : 'flex'}`}
      >
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
      <HudDrag id="system" className={`absolute right-4 ${top} flex flex-col items-end gap-2`}>
        <div data-w2cogrow="" className="flex items-center gap-2">
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
          <SettingsCog game={game} />
        </div>
        {!touch && (
          <div data-w2hud="fps" className="w2-chip text-[10px] opacity-60">
            {hud.fps} fps, {hud.quality}
            {hud.baked ? ', baked GI' : ''}, cam {hud.camMode}
          </div>
        )}
        {!touch && (
          <button className="w2-chip text-xs" onClick={onHelp}>
            {showHelp ? 'hide controls (H)' : 'controls (H)'}
          </button>
        )}
        {touch && (
          <div className="flex gap-2">
            <button
              type="button"
              className={`w2-chip text-base ${hud.radio.on ? 'w2-on' : ''}`}
              onClick={() => (hud.radio.on ? game.nextRadioTrack() : game.cycleRadio())}
              title="Radio: tap for the next track"
            >
              📻
            </button>
            {hud.radio.on && (
              <button
                type="button"
                className="w2-chip text-xs"
                onClick={() => game.cycleRadio()}
                title="Change station"
              >
                {hud.radio.label}
              </button>
            )}
            <button
              type="button"
              className="w2-chip text-base"
              onClick={() => game.cycleTimeOfDay()}
              title="Time of day"
            >
              {{ afternoon: '☀️', golden: '🌇', blue: '🌆', night: '🌙' }[hud.timeOfDay] ?? '☀️'}
            </button>
          </div>
        )}
        {!touch && (
          <>
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
              onClick={() => game.cycleRadio()}
              onContextMenu={e => {
                e.preventDefault();
                game.nextRadioTrack();
              }}
              title={`Change station (M): ${RADIO_STATIONS.map(r => r.name).join(' → ')} → off`}
            >
              📻 {hud.radio.on ? hud.radio.label : 'radio off'}
            </button>
            {hud.radio.on && (
              <button
                type="button"
                className="w2-chip text-xs"
                onClick={() => game.nextRadioTrack()}
                title={hud.radio.mode === 'beats' ? 'Fresh beat (.)' : 'Next track (.)'}
              >
                ⏭
              </button>
            )}
          </>
        )}
        <StatsChip
          stats={hud.stats}
          mine={hud.mine}
          me={game.name}
          players={hud.players}
          onOpen={() => void game.refreshStats()}
        />
      </HudDrag>

      {/* Now playing toast (JSR-style station card) */}
      {hud.radio.on && now - hud.radio.at < 4500 && (
        <div
          key={hud.radio.at}
          data-w2hud="toasts"
          className="w2-nowplaying absolute left-1/2 top-16 -translate-x-1/2"
        >
          <span>
            📻 NOW PLAYING
            {hud.radio.label.startsWith('COMMUNITY RADIO') ? ' ON COMMUNITY RADIO' : ''}
          </span>
          <b>{hud.radio.label}</b>
          <span className="w2-np-stations">
            {RADIO_STATIONS.map(r => (
              <i key={r.mode} className={r.mode === hud.radio.mode ? 'w2-np-cur' : ''}>
                {r.name}
              </i>
            ))}
            <i>{touch ? 'tap the station to switch' : 'M to switch'}</i>
          </span>
        </div>
      )}

      {/* One-off banner (secret spot found…) */}
      {hud.toast !== null && now - hud.toast.at < 5000 && (
        <div
          key={hud.toast.at}
          data-w2hud="toasts"
          className="w2-nowplaying absolute left-1/2 top-28 -translate-x-1/2"
        >
          <span>{hud.toast.tag ?? '⌐◨-◨ 19 km out'}</span>
          <b>{hud.toast.text}</b>
        </div>
      )}

      {/* Noun Jersey board shop door */}
      {hud.shop && (
        <button
          type="button"
          className="pointer-events-auto absolute left-1/2 top-[34%] -translate-x-1/2 bg-[#ffd400] px-5 py-3 text-lg font-black italic text-black shadow-[6px_6px_0_#d22209]"
          onClick={onShop}
        >
          ENTER BOARD SHOP — {touch ? 'TAP' : 'E / tap'}
        </button>
      )}

      {/* NOUN FM decks in the ice cream van */}
      {hud.fmDecks && (
        <button
          type="button"
          className="pointer-events-auto absolute left-1/2 top-[34%] -translate-x-1/2 bg-[#ffd400] px-5 py-3 text-lg font-black italic text-black shadow-[6px_6px_0_#d22209]"
          onClick={onFm}
          data-fm="open"
        >
          COMMUNITY RADIO DECKS — {touch ? 'TAP' : 'E / tap'}
        </button>
      )}

      {/* GTA-style map: minimap bottom-left, opens the full map */}
      <WorldMap game={game} touch={touch} />

      {/* Chat feed (above the minimap on desktop) */}
      <div
        data-w2hud="chat"
        className={`absolute left-4 flex max-w-[60vw] flex-col gap-1 ${touch ? 'bottom-28' : 'bottom-[210px]'}`}
      >
        {hud.chat
          .filter(c => now - c.at < 12000)
          .map((c, i) => (
            <div key={i} className="w2-chip text-sm">
              <b>{c.name}</b> {c.text}
            </div>
          ))}
      </div>

      {/* Combo */}
      <div
        data-w2hud="combo"
        className="absolute bottom-16 left-1/2 flex w-[90vw] -translate-x-1/2 flex-col items-center text-center"
      >
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

      {!touch && !game.van2.driving && <SprayPanel game={game} />}

      {/* Controls */}
      {showHelp && hud.inputMode !== 'touch' && (
        <div className="absolute bottom-4 left-[292px] hidden rounded-xl bg-black/45 p-3 text-xs backdrop-blur md:block">
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
.w2-speedo{display:flex;align-items:baseline;gap:6px;padding:4px 14px 6px;border-radius:14px;background:rgba(10,12,20,.45);backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,.14);font-family:system-ui,sans-serif;cursor:grab;user-select:none}
.w2-speedo b{font-size:30px;font-weight:900;font-style:italic;line-height:1;font-variant-numeric:tabular-nums;color:#fff;text-shadow:0 2px 0 rgba(0,0,0,.5)}
.w2-speedo span{font-size:11px;font-weight:700;letter-spacing:.12em;opacity:.7}
@media (pointer:coarse){.w2-speedo b{font-size:22px}}
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
.w2-nowplaying{display:flex;flex-direction:column;align-items:center;gap:2px;background:#ffd400;color:#000;padding:8px 18px;transform-origin:center;box-shadow:6px 6px 0 #d22209;font-family:system-ui,sans-serif;animation:w2np 4.5s ease-out forwards}.w2-nowplaying span{font-size:10px;letter-spacing:.2em}.w2-nowplaying b{font-size:18px;font-style:italic}.w2-np-stations{display:flex;flex-wrap:wrap;justify-content:center;gap:4px 10px;margin-top:2px}.w2-np-stations i{font-style:normal;opacity:.55}.w2-np-stations i.w2-np-cur{opacity:1;font-weight:800;text-decoration:underline}@keyframes w2np{0%{opacity:0;transform:translate(-50%,-20px) rotate(-3deg)}8%{opacity:1;transform:translate(-50%,0) rotate(-3deg)}85%{opacity:1}100%{opacity:0}}
.w2-nametag{position:absolute;left:0;top:0;text-align:center;font-family:system-ui,sans-serif;font-size:12px;white-space:nowrap}
.w2-nametag span{background:rgba(0,0,0,.55);padding:2px 8px;border-radius:999px}
.w2-panel{background:rgba(10,12,20,.88);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:12px;font-family:system-ui,sans-serif;white-space:normal;box-shadow:0 12px 40px rgba(0,0,0,.45)}
.w2-pointer{position:absolute;left:0;top:0;display:none;text-align:center;font-family:system-ui,sans-serif;font-size:11px;font-weight:700;white-space:nowrap;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.8)}
.w2-pointer i{display:block;font-style:normal;color:#ffd400;font-size:14px;line-height:1}
.w2-pointer span{background:rgba(0,0,0,.55);padding:1px 7px;border-radius:999px}
.w2-pointer.w2-edge i{font-size:20px}
.w2-said{background:#fff;color:#111;border-radius:10px;padding:3px 8px;margin-bottom:4px;max-width:220px;white-space:normal;font-size:12px}
.w2-trick{color:#ffd400;font-style:italic;font-weight:700;margin-bottom:2px;text-shadow:0 1px 0 #000}
`;

/** Fastest of all time (room leaderboard): the record on the chip, top 10 on click. */
const STAT_TABS: StatKey[] = [
  'kmh',
  'combo',
  'session',
  'airM',
  'airS',
  'grindM',
  'downM',
  'km',
  'tricks',
  'playS',
];

function StatsChip({
  stats,
  mine,
  me,
  players,
  onOpen,
}: {
  stats: WorldStats | null;
  mine: MyBests;
  me: string;
  players: number;
  onOpen: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<StatKey>('kmh');
  const speed = stats?.boards.kmh ?? [];
  const top = speed.length > 0 ? speed[0] : undefined;
  const rows = stats?.boards[tab] ?? [];
  const info = STAT_INFO[tab];
  // A linked rider is their address's row, whatever name they play under
  const link = useSyncExternalStore(walletLink.subscribe, walletLink.get);
  const isMe = (e: StatRow) =>
    link !== null && e.addr !== undefined
      ? e.addr.toLowerCase() === link.address.toLowerCase()
      : link === null && e.name === me;
  const myRank = rows.findIndex(isMe);
  const myBest = tab in mine.best ? mine.best[tab as keyof MyBests['best']] : undefined;
  const today = stats?.days[new Date().toISOString().slice(0, 10)] ?? 0;
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        className="w2-chip text-xs"
        onClick={() => {
          if (!open) onOpen();
          setOpen(o => !o);
        }}
        title="All-time stats"
      >
        🏁 {top !== undefined ? `${Math.round(top.value)} km/h ${top.name}` : 'stats & records'}
      </button>
      {open && (
        <div className="w2-panel relative z-30 flex w-[300px] max-w-[calc(100vw-32px)] flex-col gap-1.5 text-xs">
          <div className="flex items-baseline justify-between font-bold">
            <span>NOUN WORLD STATS</span>
            <span className="text-[10px] opacity-60">{players} online now</span>
          </div>
          {stats !== null && (
            <div className="grid grid-cols-3 gap-1 text-center">
              <div className="rounded-lg bg-white/10 p-1">
                <b className="block text-sm">{stats.riders.toLocaleString()}</b>
                <span className="text-[10px] opacity-60">players ever</span>
              </div>
              <div className="rounded-lg bg-white/10 p-1">
                <b className="block text-sm">{stats.sessions.toLocaleString()}</b>
                <span className="text-[10px] opacity-60">sessions</span>
              </div>
              <div className="rounded-lg bg-white/10 p-1">
                <b className="block text-sm">{today.toLocaleString()}</b>
                <span className="text-[10px] opacity-60">today</span>
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-1">
            {STAT_TABS.map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${tab === t ? 'bg-[#ffd400] text-black' : 'bg-white/10'}`}
              >
                {STAT_INFO[t].tab}
              </button>
            ))}
          </div>
          <div className="font-bold">{info.title}</div>
          {stats === null && <div className="opacity-70">loading…</div>}
          {stats !== null && rows.length === 0 && (
            <div className="opacity-70">no records yet, go set one</div>
          )}
          <div className="flex max-h-[40vh] flex-col gap-1 overflow-y-auto pr-1">
            {rows.map((e, i) => (
              <div key={i} className={isMe(e) ? 'font-bold text-[#ffd400]' : ''}>
                <div className="flex justify-between gap-3">
                  <span className="truncate" title={e.addr}>
                    {i + 1}. {e.name}
                    {e.addr !== undefined && (
                      <span className="text-[10px] opacity-60">
                        {' '}
                        <span className="text-[#5be37d]">✓</span> {shortAddr(e.addr)}
                      </span>
                    )}
                  </span>
                  <b className="shrink-0">{info.fmt(e.value)}</b>
                </div>
                {e.label !== undefined && e.label !== '' && (
                  <div className="truncate pl-4 text-[10px] opacity-60">{e.label}</div>
                )}
              </div>
            ))}
          </div>
          <div className="mt-1 opacity-70">
            you:{' '}
            {myBest !== undefined
              ? info.fmt(myBest)
              : myRank >= 0
                ? info.fmt(rows[myRank]!.value)
                : '–'}
            {myRank >= 0 ? ` (#${myRank + 1})` : ''}
          </div>
          <WalletLink me={me} />
        </div>
      )}
    </div>
  );
}
