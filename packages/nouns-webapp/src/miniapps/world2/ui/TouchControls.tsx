// ── Touch controls: left stick + right flick pad + action buttons ───────
//
// Laid out by hud/thumbLayout.ts so the middle of the screen stays clear:
// the right thumb gets an L round the bottom-right corner (OLLIE in the
// corner, PUSH / STOP along the bottom, FLIP / GRAB up the edge), the left
// thumb the board / spray / respawn column above the round minimap. Each
// button is an icon with a tiny label under it (they're held, so a
// long-press can't be spent on explaining them).

import type { Game } from '../Game';
import type { IconName } from '../hud/icons';
import type { PadId } from '../hud/thumbLayout';

import { useEffect, useRef, useState } from 'react';

import { SprayTouch } from '../graffiti/SprayPanel';
import { useParkourLabels } from '../parkour/game/ParkourUi';
import { HudIcon } from '../hud/icons';
import { sideColumn, thumbPad } from '../hud/thumbLayout';
import { useViewport } from '../hud/useViewport';

const R = 56;
/** The first-run steering hint fades after this (ms). */
const HINT_MS = 7000;

export function useIsTouch() {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.('(pointer: coarse)');
    setTouch(!!mq?.matches || 'ontouchstart' in window);
  }, []);
  return touch;
}

const PAD: Record<PadId, { icon: IconName; label: string; cls: string }> = {
  ollie: { icon: 'ollie', label: 'OLLIE', cls: 'w2-t-ollie' },
  push: { icon: 'push', label: 'PUSH', cls: 'w2-tbtn-main w2-t-push' },
  stop: { icon: 'stop', label: 'STOP', cls: 'w2-t-stop' },
  flip: { icon: 'flip', label: 'FLIP', cls: 'w2-t-flip' },
  grab: { icon: 'grab', label: 'GRAB', cls: 'w2-t-grab' },
};

export function TouchControls({ game }: { game: Game }) {
  const isTouch = useIsTouch();
  // On foot the pad is parkour's: JUMP, RUN and a context DUCK (slide / drop / roll)
  const footLabels = useParkourLabels(game);
  const vp = useViewport();
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const [knobL, setKnobL] = useState<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [knobR, setKnobR] = useState<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [hint, setHint] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setHint(false), HINT_MS);
    return () => window.clearTimeout(t);
  }, []);
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
        setHint(false);
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
  const handlers: Record<PadId, object> = {
    ollie,
    push: hold('push'),
    stop: hold('brake'),
    flip: tap(() => game.input.queueTrick('kickflip')),
    grab: hold('grab'),
  };

  const pad = thumbPad(vp.w, vp.h);
  const side = sideColumn(vp.w, vp.h);
  const sideStyle = (i: number) => {
    const s = side[i]!;
    return {
      position: 'absolute' as const,
      left: `calc(${s.left}px + env(safe-area-inset-left))`,
      bottom: `calc(${s.bottom}px + env(safe-area-inset-bottom))`,
    };
  };

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
      {hint && !knobL && !knobR && (
        <div className="w2-thint w2h-hint pointer-events-none absolute left-1/2 -translate-x-1/2">
          left: drag to steer · right: swipe ↓↑ to ollie, ↓↖ / ↓↗ to flip
        </div>
      )}

      {/* Board / spray / respawn: the left column above the map */}
      <div className="w2-tside pointer-events-auto">
        <button
          type="button"
          className="w2-tbtn w2-tsm"
          style={sideStyle(0)}
          aria-label="Board on / off"
          {...tap(() => (t.boardToggle = true))}
        >
          <HudIcon name="board" size={22} />
        </button>
        <button
          type="button"
          className="w2-tbtn w2-tsm"
          style={sideStyle(1)}
          aria-label="Spray (hold)"
          {...hold('spray')}
        >
          <HudIcon name="spray" size={22} />
        </button>
        <button
          type="button"
          className="w2-tbtn w2-tsm"
          style={sideStyle(2)}
          aria-label="Respawn"
          {...tap(() => (t.respawn = true))}
        >
          <HudIcon name="respawn" size={22} />
        </button>
        <div className="w2-tcan" style={sideStyle(3)}>
          <SprayTouch game={game} />
        </div>
      </div>

      {/* Thumb cluster: everything the right thumb needs within reach */}
      <div className="w2-tpad pointer-events-none absolute inset-0">
        {pad.map(b => {
          const p = PAD[b.id];
          // On foot the pad is parkour's (JUMP, RUN, a context DUCK)
          const label =
            (b.id === 'stop'
              ? foot?.duck
              : b.id === 'push' && foot !== null
                ? 'RUN'
                : b.id === 'ollie'
                  ? foot?.jump
                  : undefined) ?? p.label;
          return (
            <button
              key={b.id}
              type="button"
              aria-label={label}
              className={`w2-tbtn w2-tround ${p.cls}`}
              style={{
                width: b.size,
                height: b.size,
                right: `calc(${b.right}px + env(safe-area-inset-right))`,
                bottom: `calc(${b.bottom}px + env(safe-area-inset-bottom))`,
              }}
              {...handlers[b.id]}
            >
              <HudIcon name={p.icon} size={Math.round(b.size * 0.42)} />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
      <style>{`
.w2-tbtn{position:relative;background:rgba(11,11,18,.58);border:2px solid #0b0b12;box-shadow:0 0 0 1.5px rgba(255,255,255,.3);color:#fff;border-radius:16px;min-width:44px;height:44px;padding:0;font-weight:800;font-size:12px;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);touch-action:none;-webkit-user-select:none;user-select:none;display:flex;align-items:center;justify-content:center}
.w2-tbtn:active{background:rgba(255,212,0,.55)}
.w2-tsm{width:44px;border-radius:50%}
.w2-tround{position:absolute;pointer-events:auto;border-radius:50%;flex-direction:column;gap:1px}
.w2-tround>span{font:900 8px/1 system-ui,sans-serif;letter-spacing:.08em;opacity:.9}
.w2-tbtn-main{background:rgba(255,47,142,.78)}
.w2-t-ollie{background:rgba(255,212,0,.88);color:#0b0b12;box-shadow:0 0 0 2px rgba(255,255,255,.5),0 4px 0 rgba(0,0,0,.35)}
.w2-t-ollie>span{font-size:10px}
.w2-t-ollie:active{background:#fff}
.w2-t-flip{background:rgba(32,214,255,.35)}
.w2-tcan .w2-tbtn{width:44px;height:44px;min-width:44px;border-radius:50%}
.w2-thint{bottom:calc(132px + env(safe-area-inset-bottom))}
@media (orientation:landscape) and (max-height:520px){.w2-thint{display:none}}`}</style>
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
