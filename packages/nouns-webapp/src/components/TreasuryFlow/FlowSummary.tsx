// "Where the money went" — a two-step Sankey (auctions → treasury → buckets)
// on wide screens, the same numbers as labelled bars on narrow ones.
import type { FlowKind } from './types';

import { useLayoutEffect, useRef, useState } from 'react';

import { KIND_META, OUT_KINDS, fmtEth, fmtUsd, type ViewTotals } from './model';

interface Bucket {
  key: string;
  label: string;
  color: string;
  eth: number;
  usd: number;
  explain: string;
  hatch?: boolean;
}

function buckets(t: ViewTotals): { inSide: Bucket[]; outSide: Bucket[] } {
  const inSide: Bucket[] = [
    {
      key: 'auction',
      label: 'auctions',
      color: KIND_META.auction.color,
      eth: t.inEth,
      usd: 0,
      explain: `${t.auctions.toLocaleString()} winning bids. ${KIND_META.auction.explain}`,
    },
  ];
  const outSide: Bucket[] = OUT_KINDS.filter(k => k !== 'payer').map(k => ({
    key: k,
    label: KIND_META[k as FlowKind].label,
    color: KIND_META[k as FlowKind].color,
    eth: t.byKind[k].eth,
    usd: t.byKind[k].usd,
    explain: KIND_META[k as FlowKind].explain,
  }));
  outSide.push({
    key: 'usdc',
    label: 'swapped to USDC',
    color: KIND_META.payer.color,
    eth: t.ethToUsdc,
    usd: t.byKind.payer.usd,
    explain:
      'ETH the DAO sold for USDC (via its Token Buyer) to fund USDC payments. The $ figure is what the USDC Payer paid out in this period.',
  });
  if (t.netEth > 0) {
    outSide.push({
      key: 'kept',
      label: 'kept',
      color: '#5c5c58',
      eth: t.netEth,
      usd: 0,
      explain: 'Auction ETH that has not been paid out or swapped (as far as these flows go).',
      hatch: true,
    });
  } else if (t.netEth < 0) {
    inSide.push({
      key: 'reserves',
      label: 'from reserves',
      color: '#5c5c58',
      eth: -t.netEth,
      usd: 0,
      explain:
        'More went out than came in from auctions in this period: the rest came from ETH the treasury already held.',
      hatch: true,
    });
  }
  return { inSide, outSide: outSide.filter(b => b.eth > 0 || b.usd > 0) };
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(800);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    const ro = new ResizeObserver(([e]) => {
      if (e !== undefined) setW(e.contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

export default function FlowSummary({ totals }: { totals: ViewTotals }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<Bucket | null>(null);
  const { inSide, outSide } = buckets(totals);
  const inTotal = inSide.reduce((s, b) => s + b.eth, 0);
  const outTotal = outSide.reduce((s, b) => s + b.eth, 0);
  const narrow = width < 640;

  if (inTotal === 0 && outTotal === 0) {
    return (
      <div ref={ref} className="nz-empty-inline">
        no money moved in this period.
      </div>
    );
  }

  if (narrow) {
    const max = Math.max(inTotal, outTotal) || 1;
    const row = (b: Bucket) => (
      <li key={b.key} title={b.explain}>
        <span className="nz-bl-label">
          <i style={{ background: b.color }} className={b.hatch === true ? 'is-hatch' : ''} />
          {b.label}
        </span>
        <span className="nz-bl-val">
          {b.eth > 0 && fmtEth(b.eth)}
          {b.usd > 0 && (
            <em>
              {' '}
              {b.eth > 0 ? '+ ' : ''}
              {fmtUsd(b.usd)}
            </em>
          )}
        </span>
        <span className="nz-bl-bar">
          <b
            style={{ width: `${(b.eth / max) * 100}%`, background: b.color }}
            className={b.hatch === true ? 'is-hatch' : ''}
          />
        </span>
        <small>{b.explain}</small>
      </li>
    );
    return (
      <div ref={ref} className="nz-flow-narrow">
        <h4>came in</h4>
        <ul className="nz-barlist">{inSide.map(row)}</ul>
        <h4>went out</h4>
        <ul className="nz-barlist">{outSide.map(row)}</ul>
      </div>
    );
  }

  // ── Sankey geometry (px in a viewBox = container width) ──
  const H = 300;
  const gap = 10;
  const W = width;
  const scale =
    (H - gap * Math.max(outSide.length - 1, inSide.length - 1)) / Math.max(inTotal, outTotal);
  const minH = 3;
  const hOf = (b: Bucket) => Math.max(minH, b.eth * scale);
  const xIn = 8;
  const xT = Math.round(W * 0.34);
  const xOut = Math.round(W * 0.58);
  const nodeW = 14;

  const tH = Math.max(
    inSide.reduce((s, b) => s + hOf(b), 0),
    outSide.reduce((s, b) => s + hOf(b), 0),
  );
  const tY = 0;

  let yi = (tH - inSide.reduce((s, b) => s + hOf(b), 0) - gap * (inSide.length - 1)) / 2;
  let ti = tY;
  const inShapes = inSide.map(b => {
    const h = hOf(b);
    const s = { b, y: Math.max(0, yi), ty: ti, h };
    yi += h + gap;
    ti += h;
    return s;
  });
  let yo = 0;
  let to = tY;
  const outShapes = outSide.map(b => {
    const h = hOf(b);
    const s = { b, y: yo, ty: to, h };
    yo += h + gap;
    to += h;
    return s;
  });
  const totalH = Math.max(yo - gap, tH, yi - gap);
  // Labels sit at their band's middle, nudged apart so small bands don't overlap.
  const LABEL_GAP = 18;
  const labelY: number[] = [];
  outShapes.forEach((o, i) => {
    const want = o.y + Math.max(o.h, 14) / 2 + 1;
    labelY.push(i === 0 ? want : Math.max(want, labelY[i - 1]! + LABEL_GAP));
  });
  for (let i = labelY.length - 1, limit = totalH; i >= 0; i--) {
    labelY[i] = Math.min(labelY[i]!, limit);
    limit = labelY[i]! - LABEL_GAP;
  }

  const ribbon = (x0: number, y0: number, x1: number, y1: number, h: number) => {
    const mx = (x0 + x1) / 2;
    return `M${x0},${y0} C${mx},${y0} ${mx},${y1} ${x1},${y1} L${x1},${y1 + h} C${mx},${y1 + h} ${mx},${y0 + h} ${x0},${y0 + h} Z`;
  };

  return (
    <div ref={ref} className="nz-sankey">
      <svg
        width={W}
        height={totalH + 8}
        viewBox={`0 -4 ${W} ${totalH + 8}`}
        role="img"
        aria-label="Where Nouns treasury ETH came from and went"
      >
        <defs>
          <pattern
            id="nz-hatch"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <rect width="6" height="6" fill="#3a3a37" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="#77776f" strokeWidth="2" />
          </pattern>
        </defs>
        {inShapes.map(({ b, y, ty, h }) => (
          <g key={b.key} onMouseEnter={() => setHover(b)} onMouseLeave={() => setHover(null)}>
            <path
              d={ribbon(xIn + nodeW, y, xT, ty, h)}
              fill={b.hatch === true ? 'url(#nz-hatch)' : b.color}
              opacity={hover && hover !== b ? 0.18 : 0.42}
            />
            <rect
              x={xIn}
              y={y}
              width={nodeW}
              height={h}
              rx={3}
              fill={b.hatch === true ? 'url(#nz-hatch)' : b.color}
            />
          </g>
        ))}
        {outShapes.map(({ b, y, ty, h }, i) => (
          <g key={b.key} onMouseEnter={() => setHover(b)} onMouseLeave={() => setHover(null)}>
            <path
              d={ribbon(xT + nodeW, ty, xOut, y, h)}
              fill={b.hatch === true ? 'url(#nz-hatch)' : b.color}
              opacity={hover && hover !== b ? 0.18 : 0.42}
            />
            <rect
              x={xOut}
              y={y}
              width={nodeW}
              height={h}
              rx={3}
              fill={b.hatch === true ? 'url(#nz-hatch)' : b.color}
            />
            <text x={xOut + nodeW + 10} y={labelY[i]} className="nz-sk-label">
              <tspan className="nz-sk-name">{b.label}</tspan>
              <tspan dx="10" className="nz-sk-val">
                {b.eth > 0 ? fmtEth(b.eth) : ''}
                {b.usd > 0 ? `${b.eth > 0 ? '  + ' : ''}${fmtUsd(b.usd)}` : ''}
              </tspan>
            </text>
          </g>
        ))}
        <rect x={xT} y={tY} width={nodeW} height={tH} rx={3} fill="#d4ff3a" />
        <text x={xT - 10} y={tY + 14} textAnchor="end" className="nz-sk-name">
          treasury
        </text>
        {inShapes.map(({ b, y, h }) => (
          <text
            key={`l-${b.key}`}
            x={xIn + nodeW + 10}
            y={y + Math.max(h, 14) / 2 + 1}
            className="nz-sk-label"
          >
            <tspan className="nz-sk-name">{b.label}</tspan>
            <tspan dx="10" className="nz-sk-val">
              {fmtEth(b.eth)}
            </tspan>
          </text>
        ))}
      </svg>
      <p className="nz-sk-explain" aria-live="polite">
        {hover ? (
          <>
            <b>{hover.label}:</b> {hover.explain}
          </>
        ) : (
          'band widths are ETH. USDC amounts are shown as $ next to them. hover a band for what it means.'
        )}
      </p>
    </div>
  );
}
