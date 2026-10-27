// ── A touch joystick for walking the floor (phones) ─────────────────────
//
// Bottom-left thumb pad: push to walk, push all the way to run. Reports
// (side, fwd) in -1 … 1 (up = forward) and (0, 0) on release.

import { useRef, useState, type PointerEvent as RPointerEvent } from 'react';

const R = 46;

export function Stick({ onMove }: { onMove: (side: number, fwd: number) => void }) {
  const base = useRef<HTMLDivElement>(null);
  const id = useRef<number | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const at = (e: RPointerEvent) => {
    const r = base.current!.getBoundingClientRect();
    let x = e.clientX - (r.left + r.width / 2);
    let y = e.clientY - (r.top + r.height / 2);
    const m = Math.hypot(x, y);
    if (m > R) {
      x = (x / m) * R;
      y = (y / m) * R;
    }
    setKnob({ x, y });
    onMove(x / R, -y / R);
  };
  const end = () => {
    id.current = null;
    setKnob({ x: 0, y: 0 });
    onMove(0, 0);
  };

  return (
    <div
      ref={base}
      className="gx3d-stick"
      onPointerDown={e => {
        id.current = e.pointerId;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // the pointer's already gone (lifted mid-event): still steer
        }
        at(e);
      }}
      onPointerMove={e => {
        if (id.current === e.pointerId) at(e);
      }}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div
        className="gx3d-stick-knob"
        style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }}
      />
    </div>
  );
}
