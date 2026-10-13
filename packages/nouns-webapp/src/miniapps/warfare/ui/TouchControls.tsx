// ── Phone controls: left stick moves, right side drags to look, buttons ──
//
// The FIRE button also steers (drag while holding it), so you can shoot
// and track with one thumb while the other moves.

import type { TouchState } from '../client/FpsInput';
import type { WarfareGame } from '../client/WarfareGame';

import { useEffect, useRef, useState } from 'react';

type Btn = 'fire' | 'jump' | 'crouch' | 'reload' | 'scope' | 'grenade' | 'swap';

const BTNS: { id: Btn; label: string; right: number; bottom: number; size: number }[] = [
  { id: 'fire', label: 'FIRE', right: 22, bottom: 92, size: 86 },
  { id: 'jump', label: 'JUMP', right: 118, bottom: 30, size: 58 },
  { id: 'crouch', label: 'DUCK', right: 186, bottom: 22, size: 50 },
  { id: 'reload', label: 'R', right: 22, bottom: 20, size: 54 },
  { id: 'scope', label: 'AIM', right: 120, bottom: 160, size: 52 },
  { id: 'grenade', label: 'NADE', right: 30, bottom: 192, size: 52 },
  { id: 'swap', label: '⇄', right: 182, bottom: 92, size: 50 },
];

export function TouchControls({ game }: { game: WarfareGame }) {
  const t = game.input.touch;
  const [stick, setStick] = useState<{ x: number; y: number; dx: number; dy: number } | null>(null);
  const [held, setHeld] = useState<Set<Btn>>(() => new Set());
  const stickId = useRef<number | null>(null);
  const lookId = useRef<number | null>(null);
  const lookLast = useRef({ x: 0, y: 0 });
  const btnTouch = useRef(new Map<number, Btn>());

  useEffect(() => {
    game.input.mode = 'touch';
    return () => {
      const s: TouchState = t;
      s.moveX = s.moveY = 0;
      s.fire = s.jump = s.crouch = s.reload = s.scope = s.grenade = false;
    };
  }, [game, t]);

  const setBtn = (b: Btn, on: boolean) => {
    if (b === 'swap') {
      if (on) game.input.cycleWeapon(1);
    } else t[b] = on;
    setHeld(prev => {
      const n = new Set(prev);
      if (on) n.add(b);
      else n.delete(b);
      return n;
    });
  };

  const onDown = (e: React.PointerEvent) => {
    game.unlockAudio();
    game.input.mode = 'touch';
    const x = e.clientX;
    const y = e.clientY;
    if (x < window.innerWidth * 0.42 && stickId.current === null) {
      stickId.current = e.pointerId;
      setStick({ x, y, dx: 0, dy: 0 });
    } else if (lookId.current === null) {
      lookId.current = e.pointerId;
      lookLast.current = { x, y };
    }
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onMove = (e: React.PointerEvent) => {
    if (e.pointerId === stickId.current && stick !== null) {
      const R = 56;
      let dx = e.clientX - stick.x;
      let dy = e.clientY - stick.y;
      const l = Math.hypot(dx, dy);
      if (l > R) {
        dx *= R / l;
        dy *= R / l;
      }
      t.moveX = dx / R;
      t.moveY = -dy / R;
      setStick({ ...stick, dx, dy });
    } else if (e.pointerId === lookId.current) {
      t.lookDX += e.clientX - lookLast.current.x;
      t.lookDY += e.clientY - lookLast.current.y;
      lookLast.current = { x: e.clientX, y: e.clientY };
    }
  };
  const onUp = (e: React.PointerEvent) => {
    if (e.pointerId === stickId.current) {
      stickId.current = null;
      t.moveX = t.moveY = 0;
      setStick(null);
    }
    if (e.pointerId === lookId.current) lookId.current = null;
  };

  const btnDown = (b: Btn) => (e: React.PointerEvent) => {
    e.stopPropagation();
    game.unlockAudio();
    game.input.mode = 'touch';
    btnTouch.current.set(e.pointerId, b);
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setBtn(b, true);
    if (b === 'fire') lookLast.current = { x: e.clientX, y: e.clientY };
  };
  const btnMove = (b: Btn) => (e: React.PointerEvent) => {
    if (b !== 'fire' || btnTouch.current.get(e.pointerId) !== 'fire') return;
    e.stopPropagation();
    // Fire doubles as a look pad
    t.lookDX += e.clientX - lookLast.current.x;
    t.lookDY += e.clientY - lookLast.current.y;
    lookLast.current = { x: e.clientX, y: e.clientY };
  };
  const btnUp = (b: Btn) => (e: React.PointerEvent) => {
    e.stopPropagation();
    btnTouch.current.delete(e.pointerId);
    setBtn(b, false);
  };

  return (
    <div className="wf-touch" data-testid="wf-touch">
      <div
        className="absolute inset-0"
        style={{ pointerEvents: 'auto', touchAction: 'none' }}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      />
      {stick !== null ? (
        <div
          className="wf-stick"
          style={{ left: stick.x - 64, top: stick.y - 64, width: 128, height: 128 }}
        >
          <i style={{ transform: `translate(${stick.dx}px, ${stick.dy}px)` }} />
        </div>
      ) : (
        <div
          className="wf-stick"
          style={{ left: 28, bottom: 36, width: 128, height: 128, opacity: 0.55 }}
        >
          <i />
        </div>
      )}
      {BTNS.map(b => (
        <div
          key={b.id}
          className={`wf-tbtn ${b.id === 'fire' ? 'fire' : ''} ${held.has(b.id) ? 'on' : ''}`}
          style={{ right: b.right, bottom: b.bottom, width: b.size, height: b.size }}
          onPointerDown={btnDown(b.id)}
          onPointerMove={btnMove(b.id)}
          onPointerUp={btnUp(b.id)}
          onPointerCancel={btnUp(b.id)}
        >
          {b.label}
        </div>
      ))}
      <div
        className="wf-tbtn"
        style={{ left: 8, top: 88, width: 40, height: 40, borderRadius: 12, fontSize: 11 }}
        onPointerDown={e => {
          e.stopPropagation();
          game.setBoard(!game.hud.showBoard);
        }}
      >
        TAB
      </div>
      <div
        className="wf-tbtn"
        style={{ left: 54, top: 88, width: 40, height: 40, borderRadius: 12, fontSize: 11 }}
        onPointerDown={e => {
          e.stopPropagation();
          game.toggleView();
        }}
      >
        VIEW
      </div>
      <div
        className="wf-tbtn"
        style={{ left: 100, top: 88, width: 40, height: 40, borderRadius: 12, fontSize: 13 }}
        onPointerDown={e => {
          e.stopPropagation();
          game.pause();
        }}
      >
        ❚❚
      </div>
    </div>
  );
}
