// ── Touch controls: left stick + right flick pad + action buttons ───────

import type { Game } from '../Game';

import { useEffect, useRef, useState } from 'react';

import { SprayTouch } from '../graffiti/SprayPanel';
import { useParkourLabels } from '../parkour/game/ParkourUi';

const R = 56;

export function useIsTouch() {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.('(pointer: coarse)');
    setTouch(!!mq?.matches || 'ontouchstart' in window);
  }, []);
  return touch;
}

export function TouchControls({ game }: { game: Game }) {
  const isTouch = useIsTouch();
  // On foot the pad is parkour's: JUMP, RUN and a context DUCK (slide / drop / roll)
  const footLabels = useParkourLabels(game);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const [knobL, setKnobL] = useState<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [knobR, setKnobR] = useState<{ x: number; y: number; ox: number; oy: number } | null>(null);
  // Drag state lives in a ref: the knob's setState re-renders on touch-down,
  // and handler-local state would reset to "no finger" on every render, so
  // every move after the first was ignored and the stick never moved
  const drag = useRef({
    L: { id: null as number | null, ox: 0, oy: 0 },
    R: { id: null as number | null, ox: 0, oy: 0 },
  });

  if (!isTouch) return null;
  const t = game.input.touch;
  const foot = footLabels;

  const stickHandlers = (side: 'L' | 'R') => {
    const d = drag.current[side];
    const set = side === 'L' ? setKnobL : setKnobR;
    return {
      onPointerDown: (e: React.PointerEvent) => {
        d.id = e.pointerId;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        d.ox = e.clientX;
        d.oy = e.clientY;
        set({ x: 0, y: 0, ox: d.ox, oy: d.oy });
        game.input.mode = 'touch';
        game.unlockAudio();
      },
      onPointerMove: (e: React.PointerEvent) => {
        if (e.pointerId !== d.id) return;
        let dx = (e.clientX - d.ox) / R;
        let dy = -(e.clientY - d.oy) / R;
        const m = Math.hypot(dx, dy);
        if (m > 1) {
          dx /= m;
          dy /= m;
        }
        if (side === 'L') {
          t.moveX = dx;
          t.moveY = dy;
        } else {
          t.stickX = dx;
          t.stickY = dy;
        }
        set({ x: dx, y: dy, ox: d.ox, oy: d.oy });
      },
      onPointerUp: (e: React.PointerEvent) => {
        if (e.pointerId !== d.id) return;
        d.id = null;
        if (side === 'L') t.moveX = t.moveY = 0;
        else t.stickX = t.stickY = 0;
        set(null);
      },
    };
  };
  const L = stickHandlers('L');
  const Rh = stickHandlers('R');

  const hold = (key: 'push' | 'brake' | 'grab' | 'spray') => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      t[key] = true;
      game.input.mode = 'touch';
    },
    onPointerUp: () => (t[key] = false),
    onPointerLeave: () => (t[key] = false),
    onPointerCancel: () => (t[key] = false),
  });

  // Hold to crouch (load the pop), release to ollie, like Space on a keyboard
  const ollie = {
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      t.crouch = true;
      game.input.mode = 'touch';
      game.unlockAudio();
    },
    onPointerUp: () => {
      if (!t.crouch) return;
      t.crouch = false;
      t.jump = true;
      game.input.queueTrick('ollie');
    },
    onPointerCancel: () => (t.crouch = false),
  };
  const tap = (fn: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      game.input.mode = 'touch';
      fn();
    },
  });

  return (
    // The layer itself lets taps through to the HUD (mic, stats, map…);
    // only the stick areas and buttons catch touches
    <div className="pointer-events-none absolute inset-0" style={{ touchAction: 'none' }}>
      <div
        ref={leftRef}
        className="pointer-events-auto absolute bottom-0 left-0 h-[55%] w-1/2"
        {...L}
        onPointerCancel={L.onPointerUp}
      />
      <div
        ref={rightRef}
        className="pointer-events-auto absolute bottom-0 right-0 h-[55%] w-1/2"
        {...Rh}
        onPointerCancel={Rh.onPointerUp}
      />
      {knobL && <Knob k={knobL} />}
      {knobR && <Knob k={knobR} accent />}
      {!knobL && !knobR && (
        <div className="w2-thint pointer-events-none absolute text-center text-[11px] opacity-60">
          left: drag to steer · right: swipe ↓↑ to ollie, ↓↖ / ↓↗ to flip
        </div>
      )}

      {/* Board / spray: left edge, above the steering area */}
      <div className="w2-tside pointer-events-auto absolute left-3 flex flex-col gap-2">
        <button type="button" className="w2-tbtn" {...tap(() => (t.boardToggle = true))}>
          🛹
        </button>
        <button type="button" className="w2-tbtn" {...hold('spray')}>
          🎨
        </button>
        <button type="button" className="w2-tbtn" {...tap(() => (t.respawn = true))}>
          ↺
        </button>
        {/* Last, so in the landscape row it sits clear of the NOUN FM deck screen */}
        <SprayTouch game={game} />
      </div>

      {/* Thumb cluster: everything the right thumb needs within reach */}
      <div className="w2-tpad pointer-events-auto absolute">
        <button
          type="button"
          className="w2-tbtn w2-t-flip"
          {...tap(() => game.input.queueTrick('kickflip'))}
        >
          FLIP
        </button>
        <button type="button" className="w2-tbtn w2-t-grab" {...hold('grab')}>
          GRAB
        </button>
        <button type="button" className="w2-tbtn w2-t-stop" {...hold('brake')}>
          {foot?.duck ?? 'STOP'}
        </button>
        <button type="button" className="w2-tbtn w2-tbtn-main w2-t-push" {...hold('push')}>
          {foot !== null ? 'RUN' : 'PUSH'}
        </button>
        <button type="button" className="w2-tbtn w2-t-ollie" {...ollie}>
          {foot?.jump ?? 'OLLIE'}
        </button>
      </div>
      <style>{`
.w2-tbtn{position:relative;background:rgba(10,12,20,.55);border:1px solid rgba(255,255,255,.25);color:#fff;border-radius:16px;min-width:54px;height:54px;padding:0 8px;font-weight:800;font-size:12px;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);touch-action:none;-webkit-user-select:none;user-select:none}
.w2-tbtn:active{background:rgba(255,212,0,.5)}
.w2-tbtn-main{background:rgba(210,34,9,.75)}
.w2-tpad{right:calc(10px + env(safe-area-inset-right));bottom:calc(12px + env(safe-area-inset-bottom));width:196px;height:178px}
.w2-tpad .w2-tbtn{position:absolute}
.w2-t-ollie{right:0;bottom:0;width:86px;height:86px;border-radius:50%;background:rgba(255,212,0,.82);color:#111;font-size:14px}
.w2-t-ollie:active{background:#fff}
.w2-t-push{right:96px;bottom:0;width:64px;height:64px;border-radius:50%}
.w2-t-flip{right:14px;bottom:98px;width:58px;height:58px;border-radius:50%}
.w2-t-stop{right:132px;bottom:72px;width:54px}
.w2-t-grab{right:76px;bottom:120px;width:54px}
.w2-tside{top:38%}
.w2-thint{right:12px;left:50%;bottom:calc(196px + env(safe-area-inset-bottom))}
@media (orientation:landscape) and (max-height:520px){
  .w2-tside{top:auto;bottom:calc(14px + env(safe-area-inset-bottom));left:calc(112px + env(safe-area-inset-left));flex-direction:row}
  .w2-thint{display:none}
}`}</style>
    </div>
  );
}

function Knob({
  k,
  accent,
}: {
  k: { x: number; y: number; ox: number; oy: number };
  accent?: boolean;
}) {
  return (
    <div
      className="pointer-events-none fixed"
      style={{ left: k.ox - R, top: k.oy - R, width: R * 2, height: R * 2 }}
    >
      <div className="absolute inset-0 rounded-full border-2 border-white/30 bg-black/20" />
      <div
        className="absolute h-12 w-12 rounded-full"
        style={{
          left: R - 24 + k.x * R,
          top: R - 24 - k.y * R,
          background: accent === true ? 'rgba(255,212,0,.8)' : 'rgba(255,255,255,.7)',
        }}
      />
    </div>
  );
}
