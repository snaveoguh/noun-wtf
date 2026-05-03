/**
 * MenuBarWifi — wifi-arc icon that pops a "Connected to: NounsDAO Network"
 * dropdown on click.
 *
 * Drop-in: render alongside MenuBarBattery in BerryShell/index.tsx.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';

const SSID = 'NounsDAO Network';

export default function MenuBarWifi(): ReactElement {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

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
        aria-label={`Wi-Fi: connected to ${SSID}`}
        title="Wi-Fi"
        style={{
          height: '100%',
          padding: '0 6px',
          background: open ? 'var(--theme-accent)' : 'transparent',
          color: open ? '#fff' : 'var(--theme-text-primary)',
          border: 'none',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
        }}
      >
        <WifiIcon color={open ? '#fff' : 'currentColor'} />
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
            <span style={{ display: 'inline-flex' }}>
              <WifiIcon color="var(--theme-text-primary)" />
            </span>
            <span style={{ fontWeight: 600 }}>Wi-Fi: On</span>
          </div>
          <div style={{ paddingLeft: 22 }}>
            <div>
              Connected to: <strong>{SSID}</strong>
            </div>
            <div style={{ color: 'var(--theme-text-muted)', marginTop: 4, fontSize: 11 }}>
              IP: 10.0.42.1 · Signal: Excellent
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WifiIcon({ color }: { color: string }): ReactElement {
  return (
    <svg viewBox="0 0 18 14" width={18} height={14} aria-hidden>
      {/* Outer arc */}
      <path d="M1 5 A 12 12 0 0 1 17 5" fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
      {/* Middle arc */}
      <path d="M3.5 8 A 8 8 0 0 1 14.5 8" fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
      {/* Inner arc */}
      <path d="M6 11 A 4 4 0 0 1 12 11" fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" />
      {/* Dot */}
      <circle cx="9" cy="13" r="1.1" fill={color} />
    </svg>
  );
}
