// ── A round HUD icon button: tooltip on hover, its meaning on long-press ──
//
// Desktop: the label shows as a tooltip (CSS, from `data-tip`) and `title`.
// Touch: a long-press (LONG_MS) shows the label as a bubble instead of
// pressing the button, so every icon can be asked what it does.

import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';

import { HudIcon, type IconName } from './icons';

/** Hold this long on a touch screen to see what an icon means. */
export const LONG_MS = 450;
/** How long the long-press bubble stays. */
const TIP_MS = 1800;

export function IconButton({
  icon,
  label,
  onClick,
  onContextMenu,
  on = false,
  live = false,
  size = 20,
  badge,
  className = '',
  data,
  children,
}: {
  icon: IconName;
  /** What it does (tooltip, long-press bubble, aria-label). */
  label: string;
  onClick: () => void;
  onContextMenu?: () => void;
  /** Lit ring (a toggle that is on). */
  on?: boolean;
  /** Pulsing ring (mic picking up your voice). */
  live?: boolean;
  size?: number;
  /** A tiny count / tag on the icon's corner. */
  badge?: ReactNode;
  className?: string;
  /** Extra data-* hooks, e.g. { 'data-fm': 'open' }. */
  data?: Record<`data-${string}`, string>;
  children?: ReactNode;
}) {
  const [tip, setTip] = useState(false);
  const timer = useRef(0);
  const longPressed = useRef(false);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!tip) return;
    const t = window.setTimeout(() => setTip(false), TIP_MS);
    return () => window.clearTimeout(t);
  }, [tip]);
  return (
    <button
      type="button"
      className={`w2h-ib ${on ? 'w2h-on' : ''} ${live ? 'w2h-live' : ''} ${className}`}
      data-tip={label}
      title={label}
      aria-label={label}
      aria-pressed={on || undefined}
      {...data}
      onPointerDown={e => {
        // The touch sticks underneath must not see HUD taps
        e.stopPropagation();
        longPressed.current = false;
        if (e.pointerType !== 'touch') return;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          longPressed.current = true;
          setTip(true);
        }, LONG_MS);
      }}
      onPointerUp={() => window.clearTimeout(timer.current)}
      onPointerCancel={() => window.clearTimeout(timer.current)}
      onPointerLeave={() => window.clearTimeout(timer.current)}
      onClick={() => {
        if (longPressed.current) {
          longPressed.current = false;
          return;
        }
        onClick();
      }}
      onContextMenu={e => {
        e.preventDefault();
        if (!longPressed.current) onContextMenu?.();
      }}
    >
      <HudIcon name={icon} size={size} />
      {badge !== undefined && badge !== null && badge !== '' && (
        <span className="w2h-badge">{badge}</span>
      )}
      {children}
      {tip && (
        <span className="w2h-bubble" role="tooltip">
          {label}
        </span>
      )}
    </button>
  );
}
