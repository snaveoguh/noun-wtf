// Downhill mode for the app: drop in under the DOWNHILL arch and ride out
// onto the endless mountain. The mountain, the arches and the streak logic
// all live in the game; this only
//   1. moves the player to the arch once the level is up,
//   2. tracks a run (distance out, time, points, top speed) until a bail,
//   3. shows the result and offers another drop-in.

import type { Game } from '@/miniapps/world2/Game';

import { useEffect, useRef, useState } from 'react';

import {
  ALLEYS,
  ALLEY_O0,
  alleyToWorld,
  edgeDistance,
} from '@/miniapps/world2/world/mountain/config';

import { type DownhillBest, loadBest, saveBest } from '../controls/settings';

/** The +Z alley ("DOWNHILL" banner). */
const ALLEY = ALLEYS.find(a => a.label === 'DOWNHILL') ?? ALLEYS[0];

function archSpawn() {
  // Just inside the arch beam, on the plaza floor, facing out of the city.
  const w = alleyToWorld(ALLEY, ALLEY.a, ALLEY_O0 + 1.6, { x: 0, z: 0 });
  return { x: w.x, y: 0.1, z: w.z, yaw: ALLEY.angle };
}

function dropIn(g: Game) {
  const s = archSpawn();
  const p = g.player;
  const pos = p.pos.clone().set(s.x, s.y, s.z);
  p.spawn(pos, s.yaw);
  p.safePos.copy(pos);
  p.safeFwd.set(Math.sin(s.yaw), 0, Math.cos(s.yaw));
  g.cam.snap(p);
}

type Phase = 'loading' | 'ready' | 'running' | 'over' | 'free';

export interface RunStats {
  out: number;
  time: number;
  points: number;
  topSpeed: number;
  reason: 'bailed' | 'fell';
}

export function DownhillRun({ game, onMenu }: { game: Game | null; onMenu: () => void }) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [live, setLive] = useState({ out: 0, time: 0, points: 0, speed: 0 });
  const [result, setResult] = useState<RunStats | null>(null);
  const [best, setBest] = useState<DownhillBest>(() => loadBest());
  const phaseRef = useRef<Phase>('loading');
  phaseRef.current = phase;

  useEffect(() => {
    if (!game) return;
    let raf = 0;
    let placed = false;
    let t0 = 0;
    let points0 = 0;
    let top = 0;
    let lastX = 0;
    let lastZ = 0;
    let lastHud = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const p = game.player;
      if (game.level === null) return;
      if (!placed) {
        placed = true;
        dropIn(game);
        lastX = p.pos.x;
        lastZ = p.pos.z;
        setPhase('ready');
        return;
      }
      if (game.showroom) return;
      const ph = phaseRef.current;
      const jumped = Math.hypot(p.pos.x - lastX, p.pos.z - lastZ) > 20;
      lastX = p.pos.x;
      lastZ = p.pos.z;

      if (ph === 'ready') {
        if (p.mode === 'board' && p.state !== 'bail' && p.speed > 1.2) {
          t0 = performance.now();
          points0 = game.hud.session;
          top = 0;
          setPhase('running');
        }
        return;
      }
      if (ph !== 'running') return;

      const now = performance.now();
      top = Math.max(top, p.speed);
      const out = edgeDistance(p.pos.x, p.pos.z);
      const time = (now - t0) / 1000;
      const points = game.hud.session - points0;
      if (now - lastHud > 100) {
        lastHud = now;
        setLive({ out, time, points, speed: p.speed });
      }
      if (p.state === 'bail' || jumped) {
        const stats: RunStats = {
          out: Math.round(out),
          time,
          points,
          topSpeed: top,
          reason: jumped ? 'fell' : 'bailed',
        };
        setResult(stats);
        setBest(prev => {
          const next = {
            survival: Math.max(prev.survival, time),
            clear: Math.max(prev.clear, stats.out),
          };
          saveBest(next);
          return next;
        });
        setPhase('over');
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [game]);

  if (!game) return null;

  const again = () => {
    const p = game.player;
    const s = archSpawn();
    p.safePos.set(s.x, s.y, s.z);
    p.safeFwd.set(Math.sin(s.yaw), 0, Math.cos(s.yaw));
    p.respawnSafe();
    game.cam.snap(p);
    setResult(null);
    setPhase('ready');
  };

  const kmh = (v: number) => Math.round(v * 3.6);

  return (
    <div className="nw-run">
      {phase === 'ready' && (
        <div className="nw-run-hint">
          <div className="nw-run-big">DROP IN</div>
          <div>tap left to push · tilt to steer · stay on the board</div>
          {best.clear > 0 && (
            <div className="opacity-70">
              best {best.clear} m out · {best.survival.toFixed(1)} s
            </div>
          )}
        </div>
      )}
      {phase === 'running' && (
        <div className="nw-run-live">
          <span className="nw-run-big">{Math.round(live.out)} m</span>
          <span>{live.time.toFixed(1)} s</span>
          <span>{kmh(live.speed)} km/h</span>
          <span>{live.points} pts</span>
        </div>
      )}
      {phase === 'over' && result && (
        <div className="nw-card">
          <div className="nw-card-title">{result.reason === 'fell' ? 'FELL OFF' : 'BAILED'}</div>
          <div className="nw-card-stat">
            <b>{result.out} m</b> out
          </div>
          <div className="nw-card-row">
            <span>{result.time.toFixed(1)} s on board</span>
            <span>{result.points} pts</span>
            <span>top {kmh(result.topSpeed)} km/h</span>
          </div>
          <div className="nw-card-row opacity-70">
            best {best.clear} m · {best.survival.toFixed(1)} s
          </div>
          <div className="nw-card-btns">
            <button type="button" className="nw-tbtn nw-tbtn-main" onClick={again}>
              DROP IN AGAIN
            </button>
            <button type="button" className="nw-tbtn" onClick={() => setPhase('free')}>
              keep riding
            </button>
            <button type="button" className="nw-tbtn" onClick={onMenu}>
              menu
            </button>
          </div>
        </div>
      )}
      {phase === 'free' && (
        <button type="button" className="nw-tbtn nw-run-again" onClick={again}>
          ⛰ drop in again
        </button>
      )}
    </div>
  );
}
