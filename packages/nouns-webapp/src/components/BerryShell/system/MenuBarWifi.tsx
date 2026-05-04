/**
 * MenuBarWifi — monoline wifi icon that pops a glass dropdown on click.
 *
 * Liquid Sand chrome: monoline `<Wifi>` icon, glass popover with "Connected
 * to: NounsDAO Network".
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { GlassPanel } from '@/liquid-sand/glass';
import { Wifi } from '@/liquid-sand/icons';
import { BlendIcon } from '@/liquid-sand/inversion';

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
    <div
      ref={ref}
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        height: '100%',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={`Wi-Fi: connected to ${SSID}`}
        title="Wi-Fi"
        style={{
          height: '100%',
          padding: '0 6px',
          background: open ? 'var(--ls-glass-light-strong)' : 'transparent',
          color: 'var(--ls-fg-primary)',
          border: 'none',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          borderRadius: 'var(--ls-r-sm)',
          transition: 'background var(--ls-dur-fast) var(--ls-ease-soft)',
        }}
      >
        <BlendIcon mode="difference">
          <Wifi size={16} />
        </BlendIcon>
      </button>
      {open && (
        <GlassPanel
          role="dialog"
          blur="heavy"
          radius="md"
          style={{
            position: 'absolute',
            top: 28,
            right: 0,
            minWidth: 220,
            padding: '10px 14px',
            fontFamily: 'var(--ls-font-sans)',
            fontSize: 12,
            color: 'var(--ls-fg-primary)',
            zIndex: 1100,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginBottom: 4,
            }}
          >
            <Wifi size={14} />
            <span style={{ fontWeight: 600 }}>Wi-Fi: On</span>
          </div>
          <div style={{ paddingLeft: 22 }}>
            <div>
              Connected to: <strong>{SSID}</strong>
            </div>
            <div
              style={{
                color: 'var(--ls-fg-muted)',
                marginTop: 4,
                fontSize: 11,
              }}
            >
              IP: 10.0.42.1 · Signal: Excellent
            </div>
          </div>
        </GlassPanel>
      )}
    </div>
  );
}
