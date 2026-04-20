// Brush type picker + size slider. Mobile-friendly 44px touch targets.

import type { BrushKind } from '../core/types.js';

const BRUSHES: { kind: BrushKind; glyph: string }[] = [
  { kind: 'spray', glyph: 'SPR' },
  { kind: 'marker', glyph: 'MRK' },
  { kind: 'skinny', glyph: 'SKN' },
];

export interface BrushTrayProps {
  brush: BrushKind;
  size: number;
  onBrushChange: (b: BrushKind) => void;
  onSizeChange: (n: number) => void;
  /** min/max logical brush radius in surface pixels */
  minSize?: number;
  maxSize?: number;
}

export function BrushTray({
  brush,
  size,
  onBrushChange,
  onSizeChange,
  minSize = 4,
  maxSize = 80,
}: BrushTrayProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 10, letterSpacing: 1, color: '#aaa' }}>BRUSH</div>
      <div style={{ display: 'flex', gap: 6 }}>
        {BRUSHES.map(b => {
          const active = b.kind === brush;
          return (
            <button
              key={b.kind}
              onClick={() => onBrushChange(b.kind)}
              style={{
                flex: 1,
                height: 44,
                minWidth: 44,
                fontFamily: 'monospace',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 1,
                background: active ? '#fff' : 'rgba(255,255,255,0.08)',
                color: active ? '#000' : '#fff',
                border: active ? '1px solid #fff' : '1px solid rgba(255,255,255,0.2)',
                borderRadius: 6,
                cursor: 'pointer',
              }}
              aria-pressed={active}
            >
              {b.glyph}
            </button>
          );
        })}
      </div>
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <span style={{ fontSize: 10, letterSpacing: 1, color: '#aaa' }}>SIZE</span>
          <span style={{ fontSize: 11, color: '#fff', fontFamily: 'monospace' }}>
            {Math.round(size)}
          </span>
        </div>
        <input
          type="range"
          min={minSize}
          max={maxSize}
          step={1}
          value={size}
          onChange={e => onSizeChange(Number(e.target.value))}
          style={{ width: '100%', accentColor: '#fff', height: 28, touchAction: 'none' }}
        />
      </div>
    </div>
  );
}
