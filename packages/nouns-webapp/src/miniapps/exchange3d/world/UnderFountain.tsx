// ── The Grand Exchange under the Noggles Fountain (Noun World hook) ─────
//
// Mounted by World2Page while you play. Watches for the secret (secret.ts):
// E at the loose tile, three knocks on it, or N-O-U-N-S near the fountain.
// Then: the descent (Game.camHook flies the camera down through the
// draining basin), the world pauses exactly as it is (player, van, clock;
// the same as the board shop does), and the 3D exchange mounts over it as
// an underground hall. ↑ PLAZA / Esc unmounts it, unpauses the world and
// flies the camera back up out of the fountain into the gameplay view.

import type { Game } from '../../world2/Game';

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';

import { createPortal } from 'react-dom';
import * as THREE from 'three';

import ExchangeFloor from '../../exchange/ui/ExchangeFloor';
import { worldPause } from '../../world2/worldPause';

import { FountainHatch } from './FountainHatch';
import {
  ASCENT_S,
  ascentPose,
  CODE_DIST,
  CodeMatcher,
  darkness,
  DESCENT_S,
  descentPose,
  drainAt,
  FOUND_KEY,
  fountainDist,
  Knock,
  PRESS_DIST,
  sparkle,
  TILE,
  tileDist,
  type Pose,
} from './secret';

import './underFountain.css';

const Exchange3D = lazy(() => import('../ui/Exchange3D'));

type Stage = 'idle' | 'down' | 'below' | 'up';

const readFound = () => {
  try {
    return localStorage.getItem(FOUND_KEY) === '1';
  } catch {
    return false;
  }
};

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();

function poseOf(cam: THREE.Camera): Pose {
  cam.getWorldDirection(_d);
  const p = cam.position;
  return {
    pos: { x: p.x, y: p.y, z: p.z },
    look: { x: p.x + _d.x * 10, y: p.y + _d.y * 10, z: p.z + _d.z * 10 },
  };
}

function apply(cam: THREE.Camera, p: Pose) {
  cam.position.set(p.pos.x, p.pos.y, p.pos.z);
  cam.lookAt(p.look.x, p.look.y, p.look.z);
}

/** Is the plaza's fountain here (the baked plaza level, not the fallback park)? */
function hasFountain(game: Game): boolean {
  const hit = game.world.raycast(_v.set(0, 20, 0.01), _d.set(0, -1, 0), 40);
  return hit !== null && hit !== undefined && hit.point.y > 3;
}

export default function UnderFountain({ game, touch }: { game: Game; touch: boolean }) {
  const [stage, setStage] = useState<Stage>('idle');
  const found = useRef(readFound());
  const [book, setBook] = useState(false);
  const stageRef = useRef<Stage>('idle');
  stageRef.current = stage;
  const hatch = useRef<FountainHatch | null>(null);
  const dark = useRef<HTMLDivElement>(null);
  const sign = useRef<HTMLDivElement | null>(null);
  const wasPaused = useRef(false);

  const setDark = (k: number) => {
    if (dark.current !== null) dark.current.style.opacity = String(k);
  };

  // ── Down ──
  const enter = useCallback(() => {
    if (stageRef.current !== 'idle' || game.paused || worldPause.get()) return;
    found.current = true;
    try {
      localStorage.setItem(FOUND_KEY, '1');
    } catch {
      // private mode: it just isn't remembered
    }
    stageRef.current = 'down';
    setStage('down');
    game.input.setEnabled(false);
    let t = 0;
    let start: Pose | null = null;
    game.camHook = (cam, dt) => {
      start ??= poseOf(cam);
      t += dt;
      apply(cam, descentPose(Math.min(t, DESCENT_S), start));
      hatch.current?.setDrain(drainAt(t));
      setDark(darkness('down', t));
      if (t >= DESCENT_S && stageRef.current === 'down') {
        game.camHook = null;
        wasPaused.current = worldPause.get();
        worldPause.set(true);
        game.setPaused(true);
        stageRef.current = 'below';
        setStage('below');
      }
    };
  }, [game]);

  // ── Up ──
  const exit = useCallback(() => {
    if (stageRef.current !== 'below') return;
    setBook(false);
    stageRef.current = 'up';
    setStage('up');
    worldPause.set(wasPaused.current);
    game.setPaused(wasPaused.current);
    game.input.setEnabled(false);
    let t = 0;
    game.camHook = (cam, dt) => {
      t += dt;
      // The gameplay camera has just been placed for this frame: blend into it
      apply(cam, ascentPose(Math.min(t, ASCENT_S), poseOf(cam)));
      hatch.current?.setDrain(1 - drainAt(Math.min(1.6, t * 1.2) + 0.5));
      setDark(darkness('up', t));
      if (t >= ASCENT_S) {
        game.camHook = null;
        hatch.current?.setDrain(0);
        setDark(0);
        game.input.setEnabled(true);
        stageRef.current = 'idle';
        setStage('idle');
      }
    };
  }, [game]);

  // The tile, its sparkle, the hint sign; the code and the knocks
  useEffect(() => {
    if (!hasFountain(game)) return;
    const h = new FountainHatch();
    hatch.current = h;
    game.gfx.scene.add(h.group);
    const layer = game.labelLayerEl;
    const el = document.createElement('div');
    el.className = 'gx3d-sign';
    el.textContent = '↓ EXCHANGE';
    el.style.display = 'none';
    el.addEventListener('click', () => enter());
    layer.appendChild(el);
    sign.current = el;

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (game.paused) return;
      const p = game.player.pos;
      const known = found.current;
      h.update(dt, Math.max(sparkle(tileDist(p.x, p.z)), known ? 0.25 : 0));
      // Once found: a small sign over the tile, near the fountain only
      const show = known && stageRef.current === 'idle' && fountainDist(p.x, p.z) < 26;
      if (!show) {
        if (el.style.display !== 'none') el.style.display = 'none';
        return;
      }
      _v.set(TILE.x, TILE.y + 1.1, TILE.z).project(game.gfx.camera);
      if (_v.z > 1 || Math.abs(_v.x) > 1.1 || Math.abs(_v.y) > 1.1) {
        el.style.display = 'none';
        return;
      }
      const c = game.gfx.renderer.domElement;
      el.style.display = '';
      el.style.transform = `translate(${((_v.x + 1) / 2) * c.clientWidth}px, ${((1 - _v.y) / 2) * c.clientHeight}px) translate(-50%, -100%)`;
    };
    raf = requestAnimationFrame(tick);

    const code = new CodeMatcher();
    const onKey = (e: KeyboardEvent) => {
      if (stageRef.current !== 'idle' || game.paused || worldPause.get()) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const p = game.player.pos;
      if (fountainDist(p.x, p.z) < CODE_DIST && code.push(e.key, performance.now())) {
        enter();
        return;
      }
      if (e.code === 'KeyE' && !e.repeat && tileDist(p.x, p.z) < PRESS_DIST) {
        // Capture phase: the game's own E never sees this one
        e.preventDefault();
        e.stopPropagation();
        enter();
      }
    };
    document.addEventListener('keydown', onKey, true);

    const knock = new Knock();
    const ray = new THREE.Raycaster();
    const canvas = game.gfx.renderer.domElement;
    const onDown = (e: PointerEvent) => {
      if (stageRef.current !== 'idle' || game.paused) return;
      const r = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((e.clientX - r.left) / r.width) * 2 - 1,
        -((e.clientY - r.top) / r.height) * 2 + 1,
      );
      ray.setFromCamera(ndc, game.gfx.camera);
      if (ray.intersectObject(h.hit, false).length === 0) return;
      if (knock.tap(performance.now())) enter();
    };
    canvas.addEventListener('pointerdown', onDown, true);

    if (import.meta.env.DEV)
      (window as unknown as { __gxFountain?: unknown }).__gxFountain = {
        enter,
        exit,
        stage: () => stageRef.current,
        hatch: h,
        knock: (x: number, y: number) =>
          canvas.dispatchEvent(
            new PointerEvent('pointerdown', { clientX: x, clientY: y, bubbles: true }),
          ),
      };

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener('keydown', onKey, true);
      canvas.removeEventListener('pointerdown', onDown, true);
      el.remove();
      h.dispose();
      hatch.current = null;
      if (stageRef.current === 'down' || stageRef.current === 'up') {
        game.camHook = null;
        game.input.setEnabled(true);
      }
    };
  }, [game, enter, exit]);

  // Leaving the page while below: give the world back
  useEffect(
    () => () => {
      if (stageRef.current === 'below') {
        worldPause.set(wasPaused.current);
        game.setPaused(wasPaused.current);
        game.input.setEnabled(true);
      }
    },
    [game],
  );

  void touch; // knocks are taps on touch, clicks on desktop: same handler
  // On <body>: the world sits in its own stacking context under the NounOS dock
  return createPortal(
    <>
      <div ref={dark} className="gx3d-dark" />
      {stage === 'below' && (
        <div className="gx3d-under">
          <Suspense
            fallback={<div style={{ position: 'absolute', inset: 0, background: '#000' }} />}
          >
            <Exchange3D
              intro="descent"
              onExit={exit}
              onFlat={() => setBook(b => !b)}
              bookOpen={book}
              onBook={setBook}
            >
              {book && (
                <div className="gx3d-book">
                  <ExchangeFloor />
                </div>
              )}
            </Exchange3D>
          </Suspense>
        </div>
      )}
    </>,
    document.body,
  );
}
