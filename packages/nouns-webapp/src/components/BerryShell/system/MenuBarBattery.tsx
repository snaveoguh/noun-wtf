/**
 * MenuBarBattery — fake 87% battery indicator with a charging "lightning" anim.
 *
 * Click → tooltip-style popover: "Battery: 87% remaining (Charging)".
 *
 * Drop-in: render alongside MenuBarClock in BerryShell/index.tsx.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';

const PERCENT = 87;

export default function MenuBarBattery(): ReactElement {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Click outside closes the popover.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', height: '100%' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={`Battery ${PERCENT}% (Charging)`}
        title="Battery"
        style={{
          height: '100%',
          padding: '0 6px',
          background: open ? 'var(--theme-accent)' : 'transparent',
          color: open ? '#fff' : 'var(--theme-text-primary)',
          border: 'none',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          fontFamily: 'var(--theme-font-display)',
          fontSize: 11,
        }}
      >
        <BatteryIcon percent={PERCENT} charging color={open ? '#fff' : 'currentColor'} />
        <span>{PERCENT}%</span>
      </button>
      {open && (
        <div
          role="dialog"
          style={{
            position: 'absolute',
            top: 24,
            right: 0,
            minWidth: 220,
            background: 'var(--theme-bg-card)',
            border: '1px solid var(--theme-border-strong)',
            boxShadow: '0 6px 18px rgba(0,0,0,0.32), inset 0 1px 0 rgba(255,255,255,0.85)',
            padding: '8px 12px',
            fontFamily: 'var(--theme-font-display)',
            fontSize: 12,
            color: 'var(--theme-text-primary)',
            zIndex: 1100,
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>Battery</div>
          <div>{PERCENT}% remaining (Charging)</div>
          <div style={{ color: 'var(--theme-text-muted)', marginTop: 6, fontSize: 11 }}>
            Power source: Wall Adapter
          </div>
        </div>
      )}
    </div>
  );
}

function BatteryIcon({
  percent,
  charging,
  color,
}: {
  percent: number;
  charging?: boolean;
  color: string;
}): ReactElement {
  const fillW = Math.max(2, Math.round((percent / 100) * 16));
  return (
    <svg viewBox="0 0 24 12" width={26} height={13} aria-hidden>
      {/* Outer */}
      <rect x="0.5" y="0.5" width="20" height="11" rx="2" ry="2" fill="none" stroke={color} strokeWidth="1" />
      {/* Cap */}
      <rect x="21" y="3" width="2" height="6" rx="0.5" ry="0.5" fill={color} />
      {/* Fill */}
      <rect
        x="2"
        y="2"
        width={fillW}
        height="8"
        rx="1"
        ry="1"
        fill={percent < 20 ? '#e85a5a' : '#4ec76b'}
      />
      {/* Lightning bolt overlay when charging */}
      {charging && (
        <path
          d="M11 1 L7.5 7 L10.5 7 L9 11 L13 5 L10 5 Z"
          fill="#ffd24a"
          stroke="#a07a00"
          strokeWidth="0.4"
        >
          <animate attributeName="opacity" values="1;0.45;1" dur="2.4s" repeatCount="indefinite" />
        </path>
      )}
    </svg>
  );
}
