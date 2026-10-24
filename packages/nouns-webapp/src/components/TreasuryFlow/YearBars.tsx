// Money in vs out per year: one bar for auction ETH, one stacked bar for what
// went out (by kind, ETH) plus the ETH swapped to USDC. Click a year to filter.
import type { TreasuryFlowsResponse } from './types';

import { useState } from 'react';

import { KIND_META, OUT_KINDS, fmtEth, fmtUsd, inYear } from './model';

interface Props {
  data: TreasuryFlowsResponse;
  year: number | null;
  onYear: (y: number | null) => void;
}

export default function YearBars({ data, year, onYear }: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const years = data.years.map(y => {
    const kinds = Object.fromEntries(OUT_KINDS.map(k => [k, 0])) as Record<string, number>;
    for (const f of data.flows)
      if (f.kind !== 'auction' && inYear(f, y.year)) kinds[f.kind]! += f.eth;
    return { ...y, kinds };
  });
  const max = Math.max(1, ...years.map(y => Math.max(y.inEth, y.outEth + y.ethToUsdc)));
  const H = 150;
  const px = (eth: number) => (eth / max) * H;
  const shown = years.find(y => y.year === (hover ?? year));

  return (
    <div className="nz-years">
      <div className="nz-years-plot" role="group" aria-label="money in and out per year">
        {years.map(y => {
          const segs = [
            ...OUT_KINDS.filter(k => k !== 'payer').map(k => ({
              k,
              eth: y.kinds[k]!,
              color: KIND_META[k].color,
            })),
            { k: 'usdc', eth: y.ethToUsdc, color: KIND_META.payer.color },
          ];
          const active = year === y.year;
          return (
            <button
              key={y.year}
              type="button"
              className={`nz-year ${active ? 'is-active' : ''} ${year !== null && !active ? 'is-dim' : ''}`}
              onClick={() => onYear(active ? null : y.year)}
              onMouseEnter={() => setHover(y.year)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(y.year)}
              onBlur={() => setHover(null)}
              aria-pressed={active}
              aria-label={`${y.year}: in ${fmtEth(y.inEth)}, out ${fmtEth(y.outEth)} and ${fmtUsd(y.outUsd)}`}
            >
              <span className="nz-year-bars" style={{ height: H }}>
                <span
                  className="nz-bar"
                  style={{ height: px(y.inEth), background: KIND_META.auction.color }}
                />
                <span
                  className="nz-bar nz-bar-stack"
                  style={{ height: px(y.outEth + y.ethToUsdc) }}
                >
                  {segs
                    .filter(s => s.eth > 0)
                    .map(s => (
                      <i
                        key={s.k}
                        style={{
                          height: `${(s.eth / (y.outEth + y.ethToUsdc)) * 100}%`,
                          background: s.color,
                        }}
                      />
                    ))}
                </span>
              </span>
              <span className="nz-year-label">{y.year}</span>
            </button>
          );
        })}
      </div>
      <div className="nz-years-readout" aria-live="polite">
        {shown ? (
          <>
            <b>{shown.year}</b> in {fmtEth(shown.inEth)} from {shown.auctions} auctions; out{' '}
            {fmtEth(shown.outEth)} + {fmtUsd(shown.outUsd)} across {shown.props} proposals
            {shown.ethToUsdc > 0 && (
              <>; {fmtEth(shown.ethToUsdc)} sold for USDC to pay grants in dollars</>
            )}
          </>
        ) : (
          <>
            left bar: auction ETH in. right bar: ETH out by kind, plus ETH sold for USDC to pay
            grants in dollars. tap a year to filter the page.
          </>
        )}
      </div>
    </div>
  );
}
