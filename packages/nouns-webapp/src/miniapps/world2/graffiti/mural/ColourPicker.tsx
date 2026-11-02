// Mural mode's colour picker: saturation/value square + hue strip, hex box,
// recent colours and the house palette. Big touch targets, pen-friendly
// (drags capture the pointer, so a stroke off the square keeps steering).

import type { Graffiti, SprayTools } from '../Graffiti';

import { useEffect, useRef, useState } from 'react';

import { SPRAY_PALETTE } from '../Graffiti';
import { intToHex } from '../strokes';

import { type Hsv, hsvToRgb, parseHex, rgbToHsv } from './colour';

function useDrag(onAt: (x: number, y: number) => void) {
  const el = useRef<HTMLDivElement | null>(null);
  const at = (e: React.PointerEvent) => {
    const r = el.current!.getBoundingClientRect();
    onAt(
      Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    );
  };
  return {
    ref: el,
    onPointerDown: (e: React.PointerEvent) => {
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      at(e);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) at(e);
    },
  };
}

export function ColourPicker({
  g,
  t,
  onClose,
}: {
  g: Graffiti;
  t: SprayTools;
  onClose: () => void;
}) {
  // Hue survives greys (rgb → hsv loses it at s = 0)
  const [hsv, setHsv] = useState<Hsv>(() => rgbToHsv(t.color));
  const [hex, setHex] = useState(t.hex);
  const mine = useRef(t.color);
  useEffect(() => {
    if (t.color === mine.current) return;
    mine.current = t.color;
    setHsv(rgbToHsv(t.color));
    setHex(t.hex);
  }, [t.color, t.hex]);

  const apply = (next: Hsv) => {
    setHsv(next);
    const c = hsvToRgb(next);
    mine.current = c;
    setHex(intToHex(c));
    g.setColor(c);
  };
  const sv = useDrag((x, y) => apply({ h: hsv.h, s: x, v: 1 - y }));
  const hue = useDrag(x => apply({ ...hsv, h: x * 360 }));

  return (
    <div className="mu-pop mu-picker" data-mural="picker" onPointerDown={e => e.stopPropagation()}>
      <div className="mu-pop-head">
        <span>COLOUR</span>
        <span className="mu-now" style={{ background: t.hex }} />
        <button type="button" className="mu-x" onClick={onClose} aria-label="close colour picker">
          ✕
        </button>
      </div>
      <div
        {...sv}
        className="mu-sv"
        style={{ background: `hsl(${hsv.h} 100% 50%)` }}
        data-mural="sv"
      >
        <div className="mu-sv-w" />
        <div className="mu-sv-b" />
        <div
          className="mu-knob"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: t.hex }}
        />
      </div>
      <div {...hue} className="mu-hue" data-mural="hue">
        <div className="mu-knob mu-knob-h" style={{ left: `${(hsv.h / 360) * 100}%` }} />
      </div>
      <div className="mu-row">
        <input
          className="mu-hex"
          value={hex}
          spellCheck={false}
          autoCapitalize="off"
          aria-label="hex colour"
          onChange={e => {
            setHex(e.target.value);
            const c = parseHex(e.target.value);
            if (c !== null) {
              mine.current = c;
              setHsv(rgbToHsv(c));
              g.setColor(c);
            }
          }}
          onKeyDown={e => {
            e.stopPropagation();
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
        />
        <button
          type="button"
          className={`mu-btn ${t.picking ? 'mu-on' : ''}`}
          onClick={() => g.setPicking(!t.picking)}
          aria-label="pick a colour off the wall"
        >
          💧 PICK
        </button>
      </div>
      {t.recent.length > 0 && (
        <div className="mu-sw-row" aria-label="recent colours">
          {t.recent.map(c => (
            <button
              key={c}
              type="button"
              className={`mu-sw ${c === t.color ? 'mu-sw-on' : ''}`}
              style={{ background: intToHex(c) }}
              aria-label={intToHex(c)}
              onClick={() => g.setColor(c)}
            />
          ))}
        </div>
      )}
      <div className="mu-sw-grid">
        {SPRAY_PALETTE.map((h, i) => (
          <button
            key={h}
            type="button"
            className={`mu-sw ${h === t.hex ? 'mu-sw-on' : ''}`}
            style={{ background: h }}
            aria-label={h}
            onClick={() => g.pickSwatch(i)}
          />
        ))}
      </div>
    </div>
  );
}
