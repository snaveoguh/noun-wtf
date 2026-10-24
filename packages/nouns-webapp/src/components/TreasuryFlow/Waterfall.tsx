// WHERE IT CAME FROM / WHERE IT WENT — the reconciliation as a horizontal
// waterfall: auction proceeds, each way ETH left, the derived staking yield,
// and what's held now. One ETH scale; every row says what it is in words.
import type { Reconciliation } from './types';

import { fmtEth, fmtUsd, waterfallSteps } from './model';
import Tip from './Tip';

export default function Waterfall({ r }: { r: Reconciliation }) {
  const steps = waterfallSteps(r);
  const max = Math.max(1, ...steps.flatMap(s => [s.from, s.to]));
  const pct = (v: number) => `${(Math.max(0, v) / max) * 100}%`;
  return (
    <div className="nz-wf">
      <ol className="nz-wf-list">
        {steps.map(s => {
          const lo = Math.min(s.from, s.to);
          const hi = Math.max(s.from, s.to);
          return (
            <li
              key={s.key}
              className={[
                'nz-wf-row',
                s.total === true ? 'is-total' : '',
                s.derived === true ? 'is-derived' : '',
              ].join(' ')}
            >
              <div className="nz-wf-top">
                <span className="nz-wf-label">
                  <i
                    style={{ background: s.color }}
                    className={s.derived === true ? 'is-hatch' : ''}
                  />
                  {s.label} <Tip text={s.tip} />
                </span>
                <span className="nz-wf-val">
                  {s.total === true ? fmtEth(s.eth) : fmtEth(s.eth, { sign: true })}
                  {s.key === 'now' && r.nowUsd > 0 && <em> + {fmtUsd(r.nowUsd)} USDC</em>}
                </span>
              </div>
              <div className="nz-wf-track" aria-hidden="true">
                <b
                  className={s.derived === true ? 'is-hatch' : ''}
                  style={{ left: pct(lo), width: `max(2px, ${pct(hi - lo)})`, background: s.color }}
                />
              </div>
              <small>{s.explain}</small>
            </li>
          );
        })}
      </ol>
      <p className="nz-muted">
        the counted steps leave {fmtEth(r.flowNetEth)}; the treasury actually holds{' '}
        {fmtEth(r.nowEth)}, so{' '}
        {r.residualEth >= 0
          ? `${fmtEth(r.residualEth)} came from somewhere the flows don't count, mostly staking.`
          : `${fmtEth(-r.residualEth)} left in ways the flows don't count.`}
        {!r.complete && ' some balance reads failed, so the derived step is a floor.'}
      </p>
    </div>
  );
}
