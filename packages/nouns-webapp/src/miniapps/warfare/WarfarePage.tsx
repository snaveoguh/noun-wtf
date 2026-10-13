// ── Noun Warfare — paintball arena shooter starring Nouns ──────────────
//
// Mounted by NounOS on /warfare (same full-screen treatment as Noun World).
// sim/     pure deterministic game state (modes, weapons, bots, nav, maps)
// client/  three.js renderer, input, audio and the HUD store
// ui/      React: lobby, HUD, touch controls
// net/     online play: host-authoritative sessions over PartyKit

import type { NetMatchCfg } from './net/protocol';
import type { WarfareSession } from './net/session';
import type { Difficulty, MapId, ModeId, TeamSize } from './sim/types';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { seedKey } from '@/miniapps/world2/character/NounAppearance';
import { loadSavedCharacter } from '@/miniapps/world2/ui/CharacterSelect';

import { WarfareGame, isTouchDevice } from './client/WarfareGame';
import { WarfareLobby } from './net/lobby';
import { PartyTransport, warfarePartyHost } from './net/partyTransport';
import { MAP_ORDER } from './sim/maps';
import { MODE_ORDER } from './sim/modes';
import {
  localProgress,
  unlockedWeapons,
  type Profile,
  type ProgressStore,
} from './sim/progression';
import { Hud } from './ui/Hud';
import { Lobby, type LobbyChoice, type OnlineProps } from './ui/Lobby';
import { WF_CSS } from './ui/styles';
import { TouchControls } from './ui/TouchControls';
import { useHud } from './ui/useHud';

export interface WarfarePageProps {
  /** Backgrounded behind the NounOS desk: freeze sim + render, release input. */
  paused?: boolean;
  /** Persistence seam (phase 2: wallet-linked server store). */
  progress?: ProgressStore;
}

const SENS_KEY = 'noun-warfare-sens';

function initialChoice(p: Profile): LobbyChoice {
  const l = p.last ?? {};
  const mode = MODE_ORDER.includes(l.mode as ModeId) ? (l.mode as ModeId) : 'tdm';
  const map = MAP_ORDER.includes(l.map as MapId) ? (l.map as MapId) : 'nouncity';
  const size = ([2, 4, 6] as TeamSize[]).includes(l.size as TeamSize) ? (l.size as TeamSize) : 4;
  const difficulty = ([0, 1, 2] as Difficulty[]).includes(l.difficulty as Difficulty)
    ? (l.difficulty as Difficulty)
    : 1;
  return { mode, map, size, difficulty };
}

export default function WarfarePage({
  paused = false,
  progress = localProgress,
}: WarfarePageProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const [game, setGame] = useState<WarfareGame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile>(() => progress.load());
  const [choice, setChoice] = useState<LobbyChoice>(() => initialChoice(profile));
  const [sens, setSens] = useState(() => {
    try {
      const v = Number(localStorage.getItem(SENS_KEY));
      return Number.isFinite(v) && v > 0.2 ? v : 1;
    } catch {
      return 1;
    }
  });
  const touch = useMemo(() => isTouchDevice(), []);
  const me = useMemo(() => {
    const saved = loadSavedCharacter();
    return {
      name:
        (saved?.name ?? '').trim() !== '' ? saved!.name.trim().toUpperCase().slice(0, 14) : 'YOU',
      look: saved !== null ? seedKey(saved.seed) : '0-12-40-123-7',
    };
  }, []);
  const profileRef = useRef(profile);
  profileRef.current = profile;

  // ── Online: one socket to the `noun-warfare` room while mounted ─────
  const [lobby, setLobby] = useState<WarfareLobby | null>(null);
  const [, setLobbyVer] = useState(0);
  const [netBusy, setNetBusy] = useState<string | null>(null);
  const [netError, setNetError] = useState<string | null>(null);
  const autoJoin = useRef<string | null>(
    (() => {
      const c = new URLSearchParams(window.location.search).get('join');
      return c !== null && /^[\dA-Za-z]{3,8}$/.test(c) ? c.toUpperCase() : null;
    })(),
  );
  useEffect(() => {
    const host = warfarePartyHost();
    if (host === null) return;
    const t = new PartyTransport(host);
    const l = new WarfareLobby(t);
    const bump = () => setLobbyVer(v => v + 1);
    t.onStatus = () => {
      if (t.connected) l.refresh();
      bump();
    };
    const unsub = l.subscribe(bump);
    setLobby(l);
    return () => {
      unsub();
      l.dispose();
      t.close();
      setLobby(null);
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    const labels = labelsRef.current;
    if (!host || !labels) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'absolute inset-0 h-full w-full block';
    host.appendChild(canvas);
    let g: WarfareGame;
    try {
      g = new WarfareGame({ canvas, labelLayer: labels });
    } catch (e) {
      setError((e as Error).message || 'WebGL unavailable');
      canvas.remove();
      return;
    }
    setGame(g);
    const resize = () => g.resize(canvas.clientWidth, canvas.clientHeight);
    resize();
    window.addEventListener('resize', resize);
    g.start().catch(e => setError((e as Error).message));
    g.onResults = (r, p, finished) => {
      const cur = profileRef.current;
      const next: Profile = {
        ...cur,
        rep: cur.rep + r.rep.total,
        matches: cur.matches + (finished ? 1 : 0),
        wins: cur.wins + (r.won ? 1 : 0),
        kills: cur.kills + p.stats.kills,
      };
      progress.save(next);
      setProfile(next);
      void progress
        .sync?.(next)
        .then(setProfile)
        .catch(() => undefined);
    };
    if (import.meta.env.DEV) {
      (window as unknown as { __warfare?: unknown }).__warfare = {
        game: g,
        get sim() {
          return g.sim;
        },
        /** Freeze real-time stepping; drive with step(). */
        manual(on = true) {
          g.manual = on;
        },
        /** Keep playing without pointer lock (headless tests). */
        noLock(on = true) {
          g.debugNoLock = on;
          g.input.unlockedMouse = on;
        },
        step(n = 1, inp?: Record<string, unknown>) {
          g.stepTicks(n, inp);
        },
        /** Merge a partial input into every frame (null clears). */
        hold(inp: Record<string, unknown> | null) {
          g.devHold = inp;
        },
        get net() {
          return g.net;
        },
      };
    }
    return () => {
      window.removeEventListener('resize', resize);
      g.dispose();
      canvas.remove();
      if (import.meta.env.DEV) delete (window as unknown as { __warfare?: unknown }).__warfare;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    game?.setPaused(paused);
  }, [game, paused]);

  useEffect(() => {
    if (game !== null) game.sensitivity = sens;
    try {
      localStorage.setItem(SENS_KEY, String(sens));
    } catch {
      // ignore
    }
  }, [game, sens]);

  // Lobby map preview follows the selection
  useEffect(() => {
    if (game !== null && game.sim === null) game.setMap(choice.map);
  }, [game, choice.map]);

  // Tab = scoreboard
  useEffect(() => {
    if (game === null) return;
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Tab' && game.sim !== null) {
        e.preventDefault();
        game.setBoard(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Tab') game.setBoard(false);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [game]);

  const meInfo = useCallback(
    () => ({ name: me.name, look: me.look, weapons: unlockedWeapons(profileRef.current.rep) }),
    [me],
  );

  const netCfg = useCallback(
    (): NetMatchCfg => ({
      mode: choice.mode,
      map: choice.map,
      teamSize: choice.size,
      difficulty: choice.difficulty,
      seed: (Math.floor(Math.random() * 0x7fffffff) ^ Date.now()) >>> 0,
    }),
    [choice],
  );

  const goOnline = useCallback(
    (s: WarfareSession) => {
      if (game === null) return;
      game.unlockAudio();
      game.startOnline(s);
      setNetBusy(null);
      setNetError(null);
    },
    [game],
  );

  const netRun = useCallback(
    (label: string, f: () => Promise<WarfareSession> | WarfareSession) => {
      if (game === null || !game.ready || lobby === null) return;
      setNetBusy(label);
      setNetError(null);
      Promise.resolve()
        .then(f)
        .then(goOnline)
        .catch((e: Error) => {
          setNetBusy(null);
          setNetError(e.message || "couldn't join");
        });
    },
    [game, lobby, goOnline],
  );

  const online: OnlineProps = {
    state: lobby === null ? 'offline' : lobby.online ? 'online' : 'connecting',
    matches: lobby?.matches ?? [],
    busy: netBusy,
    error: netError,
    onQuick: () => netRun('finding a match…', () => lobby!.quickPlay(netCfg(), meInfo())),
    onHost: pub => netRun('hosting…', () => lobby!.host(netCfg(), meInfo(), pub)),
    onJoinCode: code => netRun(`joining ${code}…`, () => lobby!.join({ code }, meInfo())),
    onJoinGid: gid => netRun('joining…', () => lobby!.join({ gid }, meInfo())),
  };

  // /warfare?join=CODE: straight in once the socket and the nouns are ready
  const lobbyOnline = lobby?.online === true;
  const gameReady = game?.ready === true && game.hud.phase === 'lobby';
  useEffect(() => {
    const code = autoJoin.current;
    if (code === null || !lobbyOnline || !gameReady) return;
    autoJoin.current = null;
    online.onJoinCode(code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lobbyOnline, gameReady]);

  // Keep the open-match list fresh while browsing
  useEffect(() => {
    if (lobby === null || !lobbyOnline) return;
    const id = setInterval(() => {
      if (game?.net === null) lobby.refresh();
    }, 5000);
    return () => clearInterval(id);
  }, [lobby, lobbyOnline, game]);

  const leaveOnline = useCallback(() => {
    game?.toLobby();
    lobby?.leave();
    lobby?.refresh();
  }, [game, lobby]);

  const netStart = useCallback(() => {
    const n = game?.net ?? null;
    if (n === null || game === null) return;
    n.start();
    game.unlockAudio();
    if (!touch) game.input.requestLock();
  }, [game, touch]);

  const start = useCallback(() => {
    if (game === null || !game.ready) return;
    game.unlockAudio();
    const weapons = unlockedWeapons(profileRef.current.rep);
    const next: Profile = {
      ...profileRef.current,
      last: {
        mode: choice.mode,
        map: choice.map,
        size: choice.size,
        difficulty: choice.difficulty,
      },
    };
    progress.save(next);
    setProfile(next);
    game.startMatch({
      mode: choice.mode,
      map: choice.map,
      teamSize: choice.size,
      difficulty: choice.difficulty,
      name: me.name,
      look: me.look,
      weapons,
    });
    if (!touch) game.input.requestLock();
  }, [game, choice, me, progress, touch]);

  return (
    <div
      className="wf-root fixed inset-0 select-none overflow-hidden bg-[#0b0d18]"
      style={{ touchAction: 'none' }}
      onPointerDown={() => game?.unlockAudio()}
    >
      <style>{WF_CSS}</style>
      <div ref={hostRef} className="absolute inset-0" />
      <div ref={labelsRef} className="pointer-events-none absolute inset-0 overflow-hidden" />
      {game !== null && (
        <Screens
          game={game}
          choice={choice}
          setChoice={setChoice}
          start={start}
          profile={profile}
          name={me.name}
          sens={sens}
          setSens={setSens}
          touch={touch}
          online={online}
          onLeaveOnline={leaveOnline}
          onNetStart={netStart}
        />
      )}
      {error !== null && (
        <div className="wf-overlay">
          <div className="text-3xl">couldn&apos;t start the paint</div>
          <div className="opacity-70">{error}</div>
        </div>
      )}
    </div>
  );
}

function Screens({
  game,
  choice,
  setChoice,
  start,
  profile,
  name,
  sens,
  setSens,
  touch,
  online,
  onLeaveOnline,
  onNetStart,
}: {
  game: WarfareGame;
  choice: LobbyChoice;
  setChoice: (c: LobbyChoice) => void;
  start: () => void;
  profile: Profile;
  name: string;
  sens: number;
  setSens: (v: number) => void;
  touch: boolean;
  online: OnlineProps;
  onLeaveOnline: () => void;
  onNetStart: () => void;
}) {
  const h = useHud(game);
  const isOnline = h.net !== null;
  return (
    <>
      {(h.phase === 'lobby' || h.phase === 'loading') && (
        <Lobby
          choice={choice}
          onChange={setChoice}
          onStart={start}
          profile={profile}
          name={name}
          ready={h.phase === 'lobby'}
          sensitivity={sens}
          onSensitivity={setSens}
          touch={touch}
          online={online}
        />
      )}
      {(h.phase === 'play' || h.phase === 'results') && (
        <>
          {touch && h.phase === 'play' && h.alive && <TouchControls game={game} />}
          <Hud
            game={game}
            onLeave={isOnline ? onLeaveOnline : () => game.toLobby()}
            onLobby={isOnline ? onLeaveOnline : () => game.toLobby()}
            onAgain={start}
            onNetStart={onNetStart}
          />
          {h.phase === 'play' && (
            <div
              className="absolute bottom-1 left-1/2 -translate-x-1/2 text-[10px] opacity-40"
              style={{ fontFamily: 'system-ui' }}
            >
              {h.fps} fps
            </div>
          )}
        </>
      )}
    </>
  );
}
