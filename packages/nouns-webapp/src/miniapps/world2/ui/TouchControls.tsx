// ── Touch controls: left stick + right flick pad + action buttons ───────

import type { Game } from '../Game';

import { useEffect, useRef, useState } from 'react';

const R = 56;

function useIsTouch() {
  const [touch, setTouch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia?.('(pointer: coarse)');
    setTouch(!!mq?.matches || 'ontouchstart' in window);
  }, []);
  return touch;
}

export function TouchControls({ game }: { game: Game }) {
  const isTouch = useIsTouch();
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const [knobL, setKnobL] = useState<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [knobR, setKnobR] = useState<{ x: number; y: number; ox: number; oy: number } | null>(null);

  if (!isTouch) return null;
  const t = game.input.touch;

  const stickHandlers = (side: 'L' | 'R') => {
    let id: number | null = null;
    let ox = 0;
    let oy = 0;
    const set = side === 'L' ? setKnobL : setKnobR;
    return {
      onPointerDown: (e: React.PointerEvent) => {
        id = e.pointerId;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        ox = e.clientX;
        oy = e.clientY;
        set({ x: 0, y: 0, ox, oy });
        game.input.mode = 'touch';
        game.unlockAudio();
      },
      onPointerMove: (e: React.PointerEvent) => {
        if (e.pointerId !== id) return;
        let dx = (e.clientX - ox) / R;
        let dy = -(e.clientY - oy) / R;
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
        set({ x: dx, y: dy, ox, oy });
      },
      onPointerUp: (e: React.PointerEvent) => {
        if (e.pointerId !== id) return;
        id = null;
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
  });

  return (
    <div className="absolute inset-0" style={{ touchAction: 'none' }}>
      <div
        ref={leftRef}
        className="absolute bottom-0 left-0 h-[55%] w-1/2"
        {...L}
        onPointerCancel={L.onPointerUp}
      />
      <div
        ref={rightRef}
        className="absolute bottom-0 right-0 h-[55%] w-1/2"
        {...Rh}
        onPointerCancel={Rh.onPointerUp}
      />
      {knobL && <Knob k={knobL} />}
      {knobR && <Knob k={knobR} accent />}
      {!knobR && (
        <div className="pointer-events-none absolute bottom-40 right-10 text-center text-[11px] opacity-60">
          swipe ↓ then ↑ to ollie
          <br />↓ then ↖ / ↗ to flip
        </div>
      )}
      <div className="absolute bottom-6 right-4 flex gap-2">
        <button type="button" className="w2-tbtn" {...hold('spray')}>
          🎨
        </button>
        <button className="w2-tbtn" {...hold('grab')}>
          GRAB
        </button>
        <button className="w2-tbtn" {...hold('brake')}>
          STOP
        </button>
        <button className="w2-tbtn w2-tbtn-main" {...hold('push')}>
          PUSH
        </button>
      </div>
      <div className="absolute right-4 top-28 flex flex-col gap-2">
        <button
          className="w2-tbtn"
          onPointerDown={e => {
            e.stopPropagation();
            t.boardToggle = true;
          }}
        >
          🛹
        </button>
        <button
          className="w2-tbtn"
          onPointerDown={e => {
            e.stopPropagation();
            t.jump = true;
            game.input.queueTrick('ollie');
          }}
        >
          ⤒
        </button>
      </div>
      <style>{`.w2-tbtn{background:rgba(10,12,20,.55);border:1px solid rgba(255,255,255,.25);color:#fff;border-radius:16px;min-width:58px;height:58px;padding:0 10px;font-weight:800;font-size:13px;backdrop-filter:blur(6px)}.w2-tbtn:active{background:rgba(255,212,0,.5)}.w2-tbtn-main{background:rgba(210,34,9,.75)}`}</style>
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
