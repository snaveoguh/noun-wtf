// Candlestick chart in plain SVG: candles, volume, the town fair value and
// the last price. Gaps (minutes nobody traded) carry the close forward.

import type { Candle } from '../engine';

import { useEffect, useMemo, useRef, useState } from 'react';

const MIN = 60_000;
const HOUR = 3_600_000;

function fillGaps(cs: Candle[], step: number, max: number): Candle[] {
  if (cs.length === 0) return [];
  const out: Candle[] = [];
  for (const c of cs) {
    const prev = out[out.length - 1] as Candle | undefined;
    if (prev !== undefined) {
      for (let t = prev.t + step; t < c.t; t += step) {
        out.push({ t, o: prev.c, h: prev.c, l: prev.c, c: prev.c, v: 0 });
        if (out.length > max * 4) break;
      }
    }
    out.push(c);
  }
  return out.slice(-max);
}

const fmtT = (t: number, tf: 'm' | 'h') => {
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return tf === 'h' ? `${hh}h` : `${hh}:${mm}`;
};

export function Chart({
  candles,
  tf,
  fair,
  last,
}: {
  candles: Candle[];
  tf: 'm' | 'h';
  fair: number;
  last: number | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const ro = new ResizeObserver(() => setW(Math.max(260, Math.floor(el.clientWidth))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const h = w < 500 ? 200 : 260;
  const max = w < 500 ? 48 : 90;
  const series = useMemo(() => fillGaps(candles, tf === 'm' ? MIN : HOUR, max), [candles, tf, max]);

  const padR = 44;
  const padT = 10;
  const volH = 36;
  const plotH = h - padT - volH - 18;
  const plotW = w - padR - 4;
  let lo = Infinity;
  let hi = -Infinity;
  let vmax = 1;
  for (const c of series) {
    lo = Math.min(lo, c.l);
    hi = Math.max(hi, c.h);
    vmax = Math.max(vmax, c.v);
  }
  if (fair > 0) {
    lo = Math.min(lo, fair);
    hi = Math.max(hi, fair);
  }
  if (!Number.isFinite(lo)) {
    lo = fair * 0.9;
    hi = fair * 1.1;
  }
  const pad = Math.max(1, (hi - lo) * 0.12);
  lo = Math.max(0, lo - pad);
  hi += pad;
  const y = (p: number) => padT + ((hi - p) / (hi - lo)) * plotH;
  const n = Math.max(series.length, 20);
  const cw = plotW / n;
  const x = (i: number) => 4 + i * cw + cw / 2;
  // Prices are whole COIN, so ticks are whole numbers on a 1-2-5 step
  const raw = Math.max(1, (hi - lo) / 4);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const tickStep = [1, 2, 5, 10].map(k => k * mag).find(v => v >= raw) ?? raw;
  const labels: number[] = [];
  for (let v = Math.ceil(lo / tickStep) * tickStep; v <= hi; v += tickStep) labels.push(v);
  // Time labels at least ~64px apart
  const every = Math.max(1, Math.ceil(64 / cw));

  return (
    <div ref={ref} className="gx-chart">
      <svg width={w} height={h} role="img" aria-label="price chart">
        {labels.map(p => (
          <g key={p}>
            <line x1={4} x2={plotW} y1={y(p)} y2={y(p)} className="gx-grid-line" />
            <text x={w - padR + 4} y={y(p) + 4} className="gx-axis">
              {Math.round(p)}
            </text>
          </g>
        ))}
        {fair > 0 && (
          <g>
            <line x1={4} x2={plotW} y1={y(fair)} y2={y(fair)} className="gx-fair" />
            <text x={8} y={y(fair) - 4} className="gx-fair-label">
              town fair {fair.toFixed(1)}
            </text>
          </g>
        )}
        {series.map((c, i) => {
          const up = c.c >= c.o;
          const flat = c.v === 0;
          const cls = flat ? 'gx-c-flat' : up ? 'gx-c-up' : 'gx-c-down';
          const top = y(Math.max(c.o, c.c));
          const bh = Math.max(1.5, Math.abs(y(c.o) - y(c.c)));
          return (
            <g key={c.t} className={cls}>
              <line x1={x(i)} x2={x(i)} y1={y(c.h)} y2={y(c.l)} />
              <rect
                x={x(i) - Math.max(1, cw * 0.32)}
                width={Math.max(2, cw * 0.64)}
                y={top}
                height={bh}
              />
              {c.v > 0 && (
                <rect
                  className="gx-vol"
                  x={x(i) - Math.max(1, cw * 0.32)}
                  width={Math.max(2, cw * 0.64)}
                  y={h - 18 - (c.v / vmax) * volH}
                  height={(c.v / vmax) * volH}
                />
              )}
            </g>
          );
        })}
        {series.map((c, i) =>
          i % every === 0 ? (
            <text key={`t${c.t}`} x={x(i)} y={h - 4} className="gx-axis" textAnchor="middle">
              {fmtT(c.t, tf)}
            </text>
          ) : null,
        )}
        {last !== null && (
          <g>
            <rect
              x={w - padR}
              y={y(last) - 8}
              width={padR - 2}
              height={16}
              className="gx-last-tag"
            />
            <text x={w - padR + 4} y={y(last) + 4} className="gx-last-text">
              {last}
            </text>
          </g>
        )}
        {series.length === 0 && (
          <text x={w / 2} y={h / 2} textAnchor="middle" className="gx-axis">
            no trades yet
          </text>
        )}
      </svg>
    </div>
  );
}
