// ── GTA-style map: minimap bottom-left, click (or B) for the full map ───
//
// The minimap turns with the camera and zooms out with speed. The full map
// is north-up: drag to pan, scroll / pinch to zoom, double-click (or
// long-press) to drop a waypoint, which then shows on the minimap.

import type { Game } from '../Game';

import { useEffect, useRef, useState } from 'react';

import { createPortal } from 'react-dom';

import { drawMap, secretSpot, toWorld, type MapScene, type MapView } from './mapDraw';

const S_MIN = 0.012;
const S_MAX = 10;

function sceneOf(game: Game, waypoint: MapScene['waypoint'], full = false): MapScene {
  const p = game.player.pos;
  const riders = [];
  for (const [id, r] of game.remotes) {
    // Hide & seek: no dot for a hider (hideseek/policy.ts)
    if (game.hideseek.labelFor(id) !== 'show') continue;
    const pos = r.character.root.position;
    riders.push({ x: pos.x, z: pos.z, name: game.net.players.get(id)?.name || 'noun' });
  }
  return {
    me: { x: p.x, z: p.z, yaw: game.cam.controlYaw },
    riders,
    waypoint,
    mountain: game.mountain !== null,
    drops: game.drops?.mapPoints(),
    towns: game.towns?.mapPoints(full),
    landmarks: game.landmarks?.mapPoints(full),
    taxi: game.taxi.mapPoints(),
  };
}

function fit(canvas: HTMLCanvasElement) {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(r.width));
  const h = Math.max(1, Math.round(r.height));
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  return { w, h, dpr };
}

/**
 * Minimap redraws a second (it moves with the rider, not the display). A
 * redraw is a whole Canvas 2D map: ~160 ms on a weak phone at 6x CPU, so
 * touch screens also keep to every other frame, as before.
 */
const MINI_FPS = 30;
const MINI_FPS_TOUCH = 12;
/** The full map while it's open (dragging and zooming it). */
const MAP_FPS = 60;

export function WorldMap({
  game,
  touch,
  docked = false,
}: {
  game: Game;
  touch: boolean;
  /** Round, inside the ring HUD (hud/RingHud), which places it. */
  docked?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [waypoint, setWaypoint] = useState<{ x: number; z: number } | null>(null);
  const miniRef = useRef<HTMLCanvasElement>(null);
  const bigRef = useRef<HTMLCanvasElement>(null);
  const way = useRef(waypoint);
  way.current = waypoint;
  const view = useRef<MapView>({ cx: 0, cz: 0, s: 0.5, rot: 0 });
  const miniS = useRef(1.4);

  // B toggles, Esc closes (ahead of the pause menu's own Esc)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing =
        el !== null && (/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) || el.isContentEditable);
      if (typing || game.paused) return;
      if (e.code === 'KeyB') {
        setOpen(o => !o);
      } else if (e.code === 'Escape' && open) {
        e.preventDefault();
        e.stopImmediatePropagation();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, game]);

  // Opening: free the mouse and centre on the rider at a readable zoom
  useEffect(() => {
    if (!open) return;
    if (document.pointerLockElement) document.exitPointerLock();
    const p = game.player.pos;
    view.current = { cx: p.x, cz: p.z, s: touch ? 0.6 : 0.9, rot: 0 };
    // Resolve the secret spot now (grows one line ~19 km) rather than mid-draw
    if (game.mountain !== null) secretSpot();
  }, [open, game, touch]);

  // The full map hides the game completely: stop drawing the world behind it
  useEffect(() => (open ? game.coverGame('map', true) : undefined), [open, game]);

  // Draw loop: the minimap always, the full map while open. Paced (it was
  // redrawn on every vsync, 144 a second on fast screens, and behind the desk)
  useEffect(() => {
    let raf = 0;
    let last = -Infinity;
    let frame = 0;
    const fps = open ? MAP_FPS : touch ? MINI_FPS_TOUCH : MINI_FPS;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (game.paused || (!open && touch && ++frame % 2 === 1)) return;
      if (now - last < 1000 / fps - 2) return;
      last = now;
      const scene = sceneOf(game, way.current, open);
      const mini = miniRef.current;
      if (!open && mini !== null) {
        const ctx = mini.getContext('2d');
        if (ctx !== null) {
          const { w, h, dpr } = fit(mini);
          // Zoom out with speed: ~150 m across at rest, km at full tilt
          const want = (touch ? 0.9 : 1.5) / (1 + game.player.speed / 12);
          miniS.current += (want - miniS.current) * 0.05;
          drawMap(
            ctx,
            w,
            h,
            dpr,
            { cx: scene.me.x, cz: scene.me.z, s: miniS.current, rot: Math.PI + scene.me.yaw },
            scene,
            { full: false, edgeMarkers: true, round: docked },
          );
        }
      }
      const big = bigRef.current;
      if (open && big !== null) {
        const ctx = big.getContext('2d');
        if (ctx !== null) {
          const { w, h, dpr } = fit(big);
          drawMap(ctx, w, h, dpr, view.current, scene, { full: true, edgeMarkers: false });
        }
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [game, open, touch, docked]);

  // ── Full map gestures ──
  const ptrs = useRef(new Map<number, { x: number; y: number }>());
  const press = useRef<{ t: number; x: number; y: number; moved: boolean } | null>(null);
  const holdTimer = useRef(0);

  const zoomAt = (sx: number, sy: number, k: number) => {
    const c = bigRef.current;
    if (c === null) return;
    const r = c.getBoundingClientRect();
    const v = view.current;
    const before = toWorld(v, r.width, r.height, sx - r.left, sy - r.top);
    v.s = Math.min(S_MAX, Math.max(S_MIN, v.s * k));
    const after = toWorld(v, r.width, r.height, sx - r.left, sy - r.top);
    v.cx += before.x - after.x;
    v.cz += before.z - after.z;
  };

  const dropWaypoint = (sx: number, sy: number) => {
    const c = bigRef.current;
    if (c === null) return;
    const r = c.getBoundingClientRect();
    const p = toWorld(view.current, r.width, r.height, sx - r.left, sy - r.top);
    setWaypoint(cur =>
      cur !== null && Math.hypot(cur.x - p.x, cur.z - p.z) * view.current.s < 16 ? null : p,
    );
  };

  const goTo = (x: number, z: number, s?: number) => {
    view.current.cx = x;
    view.current.cz = z;
    if (s !== undefined) view.current.s = s;
  };

  const legend = (
    <div className="w2-map-legend">
      <button type="button" onClick={() => goTo(game.player.pos.x, game.player.pos.z)}>
        <i style={{ background: '#ffd400' }} /> you
      </button>
      <button type="button" onClick={() => goTo(0, 0, 1.2)}>
        <i style={{ background: '#2d313c' }} /> noun city
      </button>
      {game.mountain !== null && (
        <button
          type="button"
          onClick={() => {
            const sp = secretSpot();
            if (sp !== null) goTo(sp.x, sp.z, 0.9);
          }}
        >
          <i style={{ background: '#ff3d8b' }} /> secret spot
        </button>
      )}
      {waypoint !== null && (
        <button type="button" onClick={() => goTo(waypoint.x, waypoint.z)}>
          <i style={{ background: '#b6ef3a' }} /> waypoint
        </button>
      )}
      <span>
        <i style={{ background: '#ff7a1a' }} /> mega ramp
      </span>
      <span>
        <i style={{ background: '#22c7f0' }} /> riders
      </span>
      {game.drops !== null && (
        <span>
          <i style={{ background: '#8f9cff', borderRadius: 2, transform: 'rotate(45deg)' }} /> drops
        </span>
      )}
    </div>
  );

  return (
    <>
      {!open && (
        <button
          type="button"
          className={
            docked
              ? 'w2-minimap w2-minimap-dock pointer-events-auto'
              : `w2-minimap pointer-events-auto absolute z-30 ${touch ? 'w2-minimap-touch' : ''}`
          }
          onPointerDown={e => e.stopPropagation()}
          onClick={() => setOpen(true)}
          title="Map (B)"
        >
          <canvas ref={miniRef} />
          {!touch && <span className="w2-minimap-key">{docked ? 'B' : 'B · MAP'}</span>}
        </button>
      )}
      {open &&
        createPortal(
          <div
            className="w2-map pointer-events-auto fixed inset-0 z-[1000]"
            onPointerDown={e => e.stopPropagation()}
          >
            <canvas
              ref={bigRef}
              style={{ touchAction: 'none' }}
              onWheel={e => zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015))}
              onDoubleClick={e => dropWaypoint(e.clientX, e.clientY)}
              onContextMenu={e => {
                e.preventDefault();
                dropWaypoint(e.clientX, e.clientY);
              }}
              onPointerDown={e => {
                (e.target as HTMLElement).setPointerCapture(e.pointerId);
                ptrs.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
                if (ptrs.current.size === 1) {
                  press.current = {
                    t: performance.now(),
                    x: e.clientX,
                    y: e.clientY,
                    moved: false,
                  };
                  // Long-press drops a waypoint (touch has no double-click to spare)
                  window.clearTimeout(holdTimer.current);
                  const x = e.clientX;
                  const y = e.clientY;
                  holdTimer.current = window.setTimeout(() => {
                    if (press.current !== null && !press.current.moved) dropWaypoint(x, y);
                    press.current = null;
                  }, 550);
                } else {
                  press.current = null;
                  window.clearTimeout(holdTimer.current);
                }
              }}
              onPointerMove={e => {
                const prev = ptrs.current.get(e.pointerId);
                if (prev === undefined) return;
                const cur = { x: e.clientX, y: e.clientY };
                if (ptrs.current.size === 1) {
                  const v = view.current;
                  v.cx -= (cur.x - prev.x) / v.s;
                  v.cz -= (cur.y - prev.y) / v.s;
                  if (
                    press.current !== null &&
                    Math.hypot(cur.x - press.current.x, cur.y - press.current.y) > 8
                  )
                    press.current.moved = true;
                } else if (ptrs.current.size === 2) {
                  // Pinch: scale by the change in finger spread, about their midpoint
                  const [a, b] = [...ptrs.current.entries()];
                  const other = a[0] === e.pointerId ? b[1] : a[1];
                  const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
                  const d1 = Math.hypot(cur.x - other.x, cur.y - other.y);
                  if (d0 > 4) zoomAt((cur.x + other.x) / 2, (cur.y + other.y) / 2, d1 / d0);
                }
                ptrs.current.set(e.pointerId, cur);
              }}
              onPointerUp={e => {
                ptrs.current.delete(e.pointerId);
                window.clearTimeout(holdTimer.current);
                press.current = null;
              }}
              onPointerCancel={e => {
                ptrs.current.delete(e.pointerId);
                window.clearTimeout(holdTimer.current);
              }}
            />
            <div className="w2-map-top">
              <b>NOUN WORLD</b>
              <span>
                {touch
                  ? 'drag · pinch to zoom · hold to drop a waypoint'
                  : 'drag · scroll to zoom · double-click for a waypoint · B / Esc to close'}
              </span>
              <button type="button" className="w2-map-x" onClick={() => setOpen(false)}>
                ✕
              </button>
            </div>
            <div className="w2-map-zoom">
              <button type="button" onClick={() => zoomAt(innerWidth / 2, innerHeight / 2, 1.6)}>
                +
              </button>
              <button
                type="button"
                onClick={() => zoomAt(innerWidth / 2, innerHeight / 2, 1 / 1.6)}
              >
                −
              </button>
              <button
                type="button"
                title="Centre on you"
                onClick={() => goTo(game.player.pos.x, game.player.pos.z)}
              >
                ⌖
              </button>
            </div>
            {legend}
            {style}
          </div>,
          document.body,
        )}
      {style}
    </>
  );
}

const style = (
  <style>{`
.w2-minimap{left:calc(16px + var(--w2-safe-left, env(safe-area-inset-left)));bottom:calc(16px + var(--w2-safe-bottom, env(safe-area-inset-bottom)));width:260px;height:176px;padding:0;border:3px solid #111018;border-radius:10px;overflow:hidden;box-shadow:0 0 0 2px rgba(255,255,255,.55),0 6px 18px rgba(0,0,0,.35);background:#86b86a;cursor:zoom-in}
.w2-minimap canvas{display:block;width:100%;height:100%}
.w2-minimap-touch{width:92px;height:92px;border-radius:50%;bottom:calc(10px + var(--w2-safe-bottom, env(safe-area-inset-bottom)));left:calc(10px + var(--w2-safe-left, env(safe-area-inset-left)));border-width:2px}
.w2-minimap-key{position:absolute;right:6px;top:5px;font:800 9px ui-sans-serif,system-ui;letter-spacing:.08em;color:#fff;background:rgba(17,16,24,.75);padding:2px 5px;border-radius:4px}
.w2-map{background:#5f8f52}
.w2-map canvas{display:block;width:100%;height:100%;cursor:grab}
.w2-map canvas:active{cursor:grabbing}
.w2-map-top{position:absolute;left:12px;right:12px;top:calc(10px + var(--w2-safe-top, env(safe-area-inset-top)));display:flex;align-items:center;gap:12px;pointer-events:none}
.w2-map-top b{font:900 18px ui-sans-serif,system-ui;letter-spacing:.06em;background:#111018;color:#ffd400;padding:6px 12px;border-radius:6px}
.w2-map-top span{font:700 12px ui-sans-serif,system-ui;color:#fff;text-shadow:0 1px 2px #000;flex:1}
.w2-map-x{pointer-events:auto;width:44px;height:44px;border-radius:50%;background:#111018;color:#fff;font:900 18px ui-sans-serif,system-ui;border:2px solid rgba(255,255,255,.6)}
.w2-map-zoom{position:absolute;right:calc(14px + var(--w2-safe-right, env(safe-area-inset-right)));bottom:calc(16px + var(--w2-safe-bottom, env(safe-area-inset-bottom)));display:flex;flex-direction:column;gap:8px}
.w2-map-zoom button{width:46px;height:46px;border-radius:10px;background:#111018;color:#fff;font:900 22px ui-sans-serif,system-ui;border:2px solid rgba(255,255,255,.5)}
.w2-map-legend{position:absolute;left:calc(14px + var(--w2-safe-left, env(safe-area-inset-left)));bottom:calc(16px + var(--w2-safe-bottom, env(safe-area-inset-bottom)));display:flex;flex-wrap:wrap;gap:6px;max-width:calc(100vw - 100px)}
.w2-map-legend button,.w2-map-legend span{display:flex;align-items:center;gap:6px;font:800 12px ui-sans-serif,system-ui;color:#fff;background:rgba(17,16,24,.82);padding:7px 10px;border-radius:8px;border:0}
.w2-map-legend i{width:11px;height:11px;border-radius:50%;border:2px solid #fff;display:inline-block}
@media (max-width:640px){.w2-map-top span{display:none}}
`}</style>
);
