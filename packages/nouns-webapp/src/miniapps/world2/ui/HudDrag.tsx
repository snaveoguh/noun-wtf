// ── Draggable HUD pieces ─────────────────────────────────────────────────
//
// Wrap a HUD block to let riders move it: drag it anywhere, double-click
// (double-tap) to put it back. The block keeps its usual placement classes;
// a drag only adds an offset, stored per device as a share of the screen so
// it survives resizes and rotations. A drag never fires the buttons inside.

import type { CSSProperties, ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

const KEY = 'noun-world-hud-pos';
/** Pixels a press must travel before it counts as a drag (taps stay taps). */
const SLOP = 6;

type Offsets = Record<string, { x: number; y: number }>;

function load(): Offsets {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as unknown;
    return v !== null && typeof v === 'object' ? (v as Offsets) : {};
  } catch {
    return {};
  }
}
function save(all: Offsets) {
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // private mode: positions just don't persist
  }
}

export function HudDrag({
  id,
  className,
  style,
  children,
}: {
  /** Storage key: one saved position per id. */
  id: string;
  /** Default placement (absolute positioning classes). */
  className: string;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const [off, setOff] = useState(() => load()[id] ?? { x: 0, y: 0 });
  const offRef = useRef(off);
  offRef.current = off;
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(
    null,
  );
  const justDragged = useRef(false);

  const commit = useCallback(
    (o: { x: number; y: number }) => {
      const all = load();
      if (o.x === 0 && o.y === 0) delete all[id];
      else all[id] = o;
      save(all);
    },
    [id],
  );

  // Keep a moved block on screen after a resize / rotation
  useEffect(() => {
    const fit = () => {
      const el = ref.current;
      if (el === null) return;
      const r = el.getBoundingClientRect();
      const W = window.innerWidth;
      const H = window.innerHeight;
      let dx = 0;
      let dy = 0;
      if (r.right > W) dx = W - r.right;
      if (r.left + dx < 0) dx = -r.left;
      if (r.bottom > H) dy = H - r.bottom;
      if (r.top + dy < 0) dy = -r.top;
      if (dx !== 0 || dy !== 0) setOff(o => ({ x: o.x + dx / W, y: o.y + dy / H }));
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const W = typeof window === 'undefined' ? 1 : window.innerWidth;
  const H = typeof window === 'undefined' ? 1 : window.innerHeight;

  return (
    <div
      ref={ref}
      className={`${className} pointer-events-auto`}
      style={{ ...style, translate: `${off.x * W}px ${off.y * H}px`, touchAction: 'none' }}
      title="Drag to move · double-click to reset"
      onPointerDown={e => {
        if (e.button !== 0) return;
        drag.current = { sx: e.clientX, sy: e.clientY, ox: off.x, oy: off.y, moved: false };
      }}
      onPointerMove={e => {
        const d = drag.current;
        if (d === null) return;
        const mx = e.clientX - d.sx;
        const my = e.clientY - d.sy;
        if (!d.moved) {
          if (Math.hypot(mx, my) < SLOP) return;
          d.moved = true;
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }
        // Clamp so the block can't leave the screen
        const el = ref.current!;
        const r = el.getBoundingClientRect();
        const curX = off.x * W;
        const curY = off.y * H;
        const baseL = r.left - curX;
        const baseT = r.top - curY;
        let nx = d.ox * W + mx;
        let ny = d.oy * H + my;
        nx = Math.min(Math.max(nx, -baseL), W - r.width - baseL);
        ny = Math.min(Math.max(ny, -baseT), H - r.height - baseT);
        setOff({ x: nx / W, y: ny / H });
      }}
      onPointerUp={e => {
        const d = drag.current;
        drag.current = null;
        if (d?.moved === true) {
          justDragged.current = true;
          (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
          commit(offRef.current);
        }
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      // A drag that ends over a button must not press it
      onClickCapture={e => {
        if (justDragged.current) {
          justDragged.current = false;
          e.stopPropagation();
          e.preventDefault();
        }
      }}
      onDoubleClick={() => {
        setOff({ x: 0, y: 0 });
        commit({ x: 0, y: 0 });
      }}
    >
      {children}
    </div>
  );
}
