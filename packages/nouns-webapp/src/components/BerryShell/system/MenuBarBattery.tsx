/**
 * MenuBarBattery — fake 87% battery indicator with a charging "lightning" anim.
 *
 * Liquid Sand chrome: monoline `<BatteryCharging>` icon over a glass popover.
 * Click → glass panel: "Battery: 87% remaining (Charging)".
 *
 * Drop-in: render alongside MenuBarClock in BerryShell/index.tsx.
 */
import { useEffect, useRef, useState, type ReactElement } from 'react';

import { GlassPanel } from '@/liquid-sand/glass';
import { BatteryCharging, BatteryLow } from '@/liquid-sand/icons';
import { BlendIcon } from '@/liquid-sand/inversion';

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

  const Icon = PERCENT < 20 ? BatteryLow : BatteryCharging;

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
        aria-label={`Battery ${PERCENT}% (Charging)`}
        title="Battery"
        style={{
          height: '100%',
          padding: '0 6px',
          background: open ? 'var(--ls-glass-light-strong)' : 'transparent',
          color: 'var(--ls-fg-primary)',
          border: 'none',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          fontFamily: 'var(--ls-font-sans)',
          fontSize: 11,
          borderRadius: 'var(--ls-r-sm)',
          transition: 'background var(--ls-dur-fast) var(--ls-ease-soft)',
        }}
      >
        <BlendIcon mode="difference">
          <Icon size={16} />
        </BlendIcon>
        <span style={{ fontVariantNumeric: 'tabular-nums' }}>{PERCENT}%</span>
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
              fontWeight: 600,
              marginBottom: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Icon size={14} /> Battery
          </div>
          <div>{PERCENT}% remaining (Charging)</div>
          <div
            style={{
              color: 'var(--ls-fg-muted)',
              marginTop: 6,
              fontSize: 11,
            }}
          >
            Power source: Wall Adapter
          </div>
        </GlassPanel>
      )}
    </div>
  );
}
