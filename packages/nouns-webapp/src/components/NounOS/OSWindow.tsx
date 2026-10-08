import { useRef, useState, type ReactNode } from 'react';

import { cx, isMobile, os, type OSWin } from './osStore';

interface Props {
  win: OSWin;
  /** 0 = front-most; each step back pushes the window deeper into the scene */
  rank: number;
  title: string;
  /** Short status text on the right of the title bar */
  status?: ReactNode;
  /** Address-bar style row under the title (navigator) */
  toolbar?: ReactNode;
  onClose?: () => void;
  /** Applied to the content box, e.g. data-theme for the terminal */
  contentProps?: Record<string, string>;
  dark?: boolean;
  children: ReactNode;
}

const DEPTH = 110; // px per rank

export default function OSWindow({
  win,
  rank,
  title,
  status,
  toolbar,
  onClose,
  contentProps,
  dark = false,
  children,
}: Props) {
  const [dragging, setDragging] = useState(false);
  const start = useRef({ px: 0, py: 0, x: 0, y: 0, w: 0, h: 0 });
  const mobile = isMobile();
  const focused = rank === 0 && !win.minimized;

  const beginDrag = (e: React.PointerEvent, kind: 'move' | 'size') => {
    if (mobile || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    os.focus(win.id);
    start.current = { px: e.clientX, py: e.clientY, x: win.x, y: win.y, w: win.w, h: win.h };
    setDragging(true);
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - start.current.px;
      const dy = ev.clientY - start.current.py;
      if (kind === 'move') {
        os.move(win.id, {
          x: Math.round(
            Math.max(
              -start.current.w + 120,
              Math.min(window.innerWidth - 120, start.current.x + dx),
            ),
          ),
          y: Math.round(Math.max(0, Math.min(window.innerHeight - 60, start.current.y + dy))),
        });
      } else {
        os.move(win.id, {
          w: Math.round(Math.max(320, start.current.w + dx)),
          h: Math.round(Math.max(200, start.current.h + dy)),
        });
      }
    };
    const onUp = () => {
      setDragging(false);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
  };

  const z = -rank * DEPTH;
  const style: React.CSSProperties = mobile
    ? { zIndex: 100 - rank }
    : {
        left: 0,
        top: 0,
        width: win.w,
        height: win.h,
        transform: win.minimized
          ? `translate3d(${win.x}px, ${window.innerHeight * 0.92}px, -420px) rotateX(-70deg)`
          : `translate3d(${win.x}px, ${win.y}px, ${z}px)`,
        zIndex: 100 - rank,
        transition: dragging
          ? 'none'
          : 'transform 520ms cubic-bezier(.2,.9,.25,1), opacity 400ms ease',
      };

  return (
    <section
      className={cx(
        'nos-win',
        focused && 'is-focused',
        win.minimized && 'is-sunk',
        mobile && 'is-mobile',
        dark && 'is-dark',
      )}
      style={style}
      data-nos-win={win.id}
      data-nos-rank={rank}
      onPointerDownCapture={() => os.focus(win.id)}
      aria-label={title}
    >
      <header className="nos-titlebar" onPointerDown={e => beginDrag(e, 'move')}>
        <span className="nos-title">{title}</span>
        {status !== undefined && <span className="nos-status">{status}</span>}
        <span className="nos-ctrls">
          {!mobile && (
            <button
              type="button"
              title="sink (minimise)"
              onPointerDown={e => e.stopPropagation()}
              onClick={() => os.minimize(win.id)}
            >
              _
            </button>
          )}
          <button
            type="button"
            title="close"
            onPointerDown={e => e.stopPropagation()}
            onClick={() => (onClose ? onClose() : os.close(win.id))}
          >
            ×
          </button>
        </span>
      </header>
      {toolbar}
      <div className="nos-content" {...contentProps}>
        {children}
      </div>
      {/* Depth haze: windows further back sink into the dark */}
      <div className="nos-haze" style={{ opacity: Math.min(0.62, rank * 0.2) }} />
      {!mobile && (
        <div className="nos-resize" onPointerDown={e => beginDrag(e, 'size')} aria-hidden />
      )}
    </section>
  );
}
