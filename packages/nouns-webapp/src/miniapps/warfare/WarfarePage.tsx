// ── Noun Warfare — paintball arena shooter starring Nouns ──────────────
//
// Mounted by NounOS on /warfare (same full-screen treatment as Noun World).
// sim/     pure deterministic game state (modes, weapons, bots, nav, maps)
// client/  three.js renderer, input, audio and the HUD store
// ui/      React: lobby, HUD, touch controls

import type { Difficulty, MapId, ModeId, TeamSize } from './sim/types';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { seedKey } from '@/miniapps/world2/character/NounAppearance';
import { loadSavedCharacter } from '@/miniapps/world2/ui/CharacterSelect';

import { WarfareGame, isTouchDevice } from './client/WarfareGame';
import { MAP_ORDER } from './sim/maps';
import { MODE_ORDER } from './sim/modes';
import {
  localProgress,
  unlockedWeapons,
  type Profile,
  type ProgressStore,
} from './sim/progression';
import { Hud } from './ui/Hud';
import { Lobby, type LobbyChoice } from './ui/Lobby';
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
        },
        step(n = 1, inp?: Record<string, unknown>) {
          g.stepTicks(n, inp);
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
}) {
  const h = useHud(game);
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
        />
      )}
      {(h.phase === 'play' || h.phase === 'results') && (
        <>
          {touch && h.phase === 'play' && h.alive && <TouchControls game={game} />}
          <Hud
            game={game}
            onLeave={() => game.toLobby()}
            onLobby={() => game.toLobby()}
            onAgain={start}
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
