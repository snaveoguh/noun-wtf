// HSV color wheel: hue ring + lightness square + recent colors + hex input.
// Renders to a canvas for the ring (fast), uses pointer events for picking.
// All CSS is inline so the package has zero style dependencies.

import type { HexColor } from '../core/types.js';

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';

const TAU = Math.PI * 2;

export interface ColorWheelProps {
  color: HexColor;
  onChange: (c: HexColor) => void;
  recent?: readonly HexColor[];
  presets?: readonly HexColor[];
  /** Pixel size of the wheel (square). Defaults to 220. */
  size?: number;
}

export function ColorWheel({
  color,
  onChange,
  recent = [],
  presets = [],
  size = 220,
}: ColorWheelProps) {
  const [h, s, v] = useMemo(() => hexToHsv(color), [color]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sqRef = useRef<HTMLCanvasElement>(null);

  const ringOuter = size / 2;
  const ringInner = size / 2 - Math.max(18, size * 0.1);
  const sqSize = Math.max(80, ringInner * 1.3);

  // Draw hue ring once.
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    c.width = size;
    c.height = size;
    ctx.clearRect(0, 0, size, size);
    const steps = 360;
    const cx = size / 2;
    const cy = size / 2;
    for (let i = 0; i < steps; i++) {
      const a0 = (i / steps) * TAU - TAU / 4;
      const a1 = ((i + 1) / steps) * TAU - TAU / 4;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a0) * ringInner, cy + Math.sin(a0) * ringInner);
      ctx.arc(cx, cy, ringOuter, a0, a1);
      ctx.arc(cx, cy, ringInner, a1, a0, true);
      ctx.closePath();
      ctx.fillStyle = `hsl(${i},100%,50%)`;
      ctx.fill();
    }
  }, [size, ringInner, ringOuter]);

  // Draw saturation/value square each time hue changes.
  useEffect(() => {
    const c = sqRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    c.width = sqSize;
    c.height = sqSize;
    // Base hue
    ctx.fillStyle = `hsl(${h},100%,50%)`;
    ctx.fillRect(0, 0, sqSize, sqSize);
    // White to transparent across X
    const gx = ctx.createLinearGradient(0, 0, sqSize, 0);
    gx.addColorStop(0, 'rgba(255,255,255,1)');
    gx.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gx;
    ctx.fillRect(0, 0, sqSize, sqSize);
    // Black from bottom up
    const gy = ctx.createLinearGradient(0, 0, 0, sqSize);
    gy.addColorStop(0, 'rgba(0,0,0,0)');
    gy.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = gy;
    ctx.fillRect(0, 0, sqSize, sqSize);
  }, [h, sqSize]);

  const onRingPointer = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left - rect.width / 2;
      const y = e.clientY - rect.top - rect.height / 2;
      const dist = Math.hypot(x, y);
      // allow picking anywhere inside the outer radius
      if (dist > ringOuter) return;
      const ang = Math.atan2(y, x) + TAU / 4;
      const hue = ((ang / TAU) * 360 + 360) % 360;
      onChange(hsvToHex(hue, s, v));
    },
    [onChange, ringOuter, s, v],
  );

  const onSqPointer = useCallback(
    (e: ReactPointerEvent<HTMLCanvasElement>) => {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
      const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
      const ns = x / rect.width;
      const nv = 1 - y / rect.height;
      onChange(hsvToHex(h, ns, nv));
    },
    [onChange, h],
  );

  const markerAngle = (h / 360) * TAU - TAU / 4;
  const markerX = size / 2 + Math.cos(markerAngle) * ((ringOuter + ringInner) / 2);
  const markerY = size / 2 + Math.sin(markerAngle) * ((ringOuter + ringInner) / 2);

  const [hexInput, setHexInput] = useState(color);
  useEffect(() => {
    setHexInput(color);
  }, [color]);

  return (
    <div
      style={{ display: 'flex', flexDirection: 'column', gap: 8, width: size, userSelect: 'none' }}
    >
      <div style={{ position: 'relative', width: size, height: size }}>
        <canvas
          ref={canvasRef}
          width={size}
          height={size}
          onPointerDown={e => {
            e.currentTarget.setPointerCapture(e.pointerId);
            onRingPointer(e);
          }}
          onPointerMove={e => {
            if (e.buttons) onRingPointer(e);
          }}
          style={{ display: 'block', borderRadius: '50%', touchAction: 'none' }}
        />
        {/* Hue marker */}
        <div
          style={{
            position: 'absolute',
            left: markerX - 6,
            top: markerY - 6,
            width: 12,
            height: 12,
            borderRadius: '50%',
            border: '2px solid #fff',
            boxShadow: '0 0 0 1px #000',
            pointerEvents: 'none',
          }}
        />
        {/* Saturation/Value square — centered inside the ring */}
        <div
          style={{
            position: 'absolute',
            left: size / 2 - sqSize / 2,
            top: size / 2 - sqSize / 2,
            width: sqSize,
            height: sqSize,
          }}
        >
          <canvas
            ref={sqRef}
            width={sqSize}
            height={sqSize}
            onPointerDown={e => {
              e.currentTarget.setPointerCapture(e.pointerId);
              onSqPointer(e);
            }}
            onPointerMove={e => {
              if (e.buttons) onSqPointer(e);
            }}
            style={{ display: 'block', touchAction: 'none', borderRadius: 6 }}
          />
          {/* SV marker */}
          <div
            style={{
              position: 'absolute',
              left: s * sqSize - 6,
              top: (1 - v) * sqSize - 6,
              width: 12,
              height: 12,
              borderRadius: '50%',
              border: '2px solid #fff',
              boxShadow: '0 0 0 1px #000',
              pointerEvents: 'none',
            }}
          />
        </div>
      </div>

      {/* Hex input + swatch */}
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 4,
            background: color,
            border: '1px solid rgba(255,255,255,0.25)',
            flex: '0 0 auto',
          }}
        />
        <input
          type="text"
          value={hexInput}
          onChange={e => setHexInput(e.target.value)}
          onBlur={() => {
            if (/^#?[\dA-Fa-f]{6}([\dA-Fa-f]{2})?$/.test(hexInput)) {
              const v2 = hexInput.startsWith('#') ? hexInput : `#${hexInput}`;
              onChange(v2);
            } else {
              setHexInput(color);
            }
          }}
          onKeyDown={e => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: 'monospace',
            fontSize: 13,
            padding: '6px 8px',
            borderRadius: 4,
            border: '1px solid rgba(255,255,255,0.2)',
            background: 'rgba(0,0,0,0.4)',
            color: '#fff',
          }}
        />
      </div>

      {recent.length > 0 && (
        <SwatchRow label="Recent" colors={recent} current={color} onPick={onChange} />
      )}
      {presets.length > 0 && (
        <SwatchRow label="Palette" colors={presets} current={color} onPick={onChange} />
      )}
    </div>
  );
}

function SwatchRow({
  label,
  colors,
  current,
  onPick,
}: {
  label: string;
  colors: readonly HexColor[];
  current: HexColor;
  onPick: (c: HexColor) => void;
}) {
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: 1, color: '#aaa', marginBottom: 4 }}>
        {label.toUpperCase()}
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {colors.map((c, i) => (
          <button
            key={`${c}-${i}`}
            onClick={() => onPick(c)}
            style={{
              width: 26,
              height: 26,
              borderRadius: 4,
              background: c,
              border:
                c.toLowerCase() === current.toLowerCase()
                  ? '2px solid #fff'
                  : '1px solid rgba(255,255,255,0.2)',
              cursor: 'pointer',
              padding: 0,
            }}
            aria-label={c}
          />
        ))}
      </div>
    </div>
  );
}

// ── HSV <-> hex conversion ─────────────────────────────────────────────

function hexToHsv(hex: HexColor): [number, number, number] {
  let s = hex.trim();
  if (s.startsWith('#')) s = s.slice(1);
  if (s.length === 3)
    s = s
      .split('')
      .map(c => c + c)
      .join('');
  if (s.length < 6) return [0, 1, 1];
  const r = parseInt(s.slice(0, 2), 16) / 255;
  const g = parseInt(s.slice(2, 4), 16) / 255;
  const b = parseInt(s.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const sat = max === 0 ? 0 : d / max;
  return [h, sat, max];
}

function hsvToHex(h: number, s: number, v: number): HexColor {
  const c = v * s;
  const hp = (h % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (0 <= hp && hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = v - c;
  const rr = Math.round((r + m) * 255);
  const gg = Math.round((g + m) * 255);
  const bb = Math.round((b + m) * 255);
  return `#${rr.toString(16).padStart(2, '0')}${gg.toString(16).padStart(2, '0')}${bb.toString(16).padStart(2, '0')}`;
}
