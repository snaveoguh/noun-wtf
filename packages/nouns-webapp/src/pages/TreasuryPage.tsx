import { useEffect, useMemo, useState } from 'react';

import { formatEther } from 'viem';

import { useTreasuryStaking, type StakedPosition } from '@/hooks/useTreasuryStaking';

/**
 * Treasury — what the DAO holds and what its staked position earns.
 *
 * The yield figures here read the same LST exchange rates as the `StakingRevenueOracle` in
 * nouns-contracts, so this page doubles as the monitoring surface for Client Incentives V2.
 */

// Categorical slots 1-4 of the dark palette, validated against this page's #050510 surface
// (worst adjacent CVD ΔE 8.4, normal-vision ΔE 19.3, all >= 3:1 contrast).
const SERIES: Record<string, string> = {
  wstETH: '#3987e5',
  stETH: '#d95926',
  rETH: '#199e70',
  mETH: '#c98500',
};

const SECONDS_PER_YEAR = 31_536_000;

// ─── Formatting ──────────────────────────────────────────────────────────────

function eth(wei: bigint, decimals = 2): string {
  const n = Number(formatEther(wei));
  return n.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function pct(fraction: number, decimals = 2): string {
  return `${(fraction * 100).toFixed(decimals)}%`;
}

// ─── Pieces ──────────────────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  unit,
  sub,
}: {
  label: string;
  value: string;
  unit?: string;
  sub?: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4">
      <div className="text-xs uppercase tracking-wide text-white/40">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-white">
        {value}
        {unit && <span className="ml-1 text-base font-medium text-white/50">{unit}</span>}
      </div>
      {sub && <div className="mt-0.5 text-xs text-white/30">{sub}</div>}
    </div>
  );
}

/**
 * The headline: yield accruing in real time. Ticks off the blended annual rate rather than polling,
 * because the underlying exchange rates only move every few hours.
 */
function YieldTicker({ annualYieldWei }: { annualYieldWei: bigint }) {
  const [accrued, setAccrued] = useState(0);
  const perSecond = Number(formatEther(annualYieldWei)) / SECONDS_PER_YEAR;

  useEffect(() => {
    const start = Date.now();
    const id = setInterval(() => setAccrued(((Date.now() - start) / 1000) * perSecond), 100);
    return () => clearInterval(id);
  }, [perSecond]);

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-6">
      <div className="text-xs uppercase tracking-wide text-white/40">
        Earned since you opened this page
      </div>
      <div className="mt-2 text-5xl font-bold tabular-nums text-white">
        {accrued.toFixed(8)}
        <span className="ml-2 text-xl font-medium text-white/50">ETH</span>
      </div>
      <div className="mt-2 text-sm text-white/40">
        {perSecond.toFixed(8)} ETH per second · {eth(annualYieldWei)} ETH per year
      </div>
    </div>
  );
}

/**
 * Horizontal bars, one per staked token. Each bar carries its own label, so identity never rests on
 * colour alone; the table view below repeats every number exactly.
 */
function PositionBars({ positions, max }: { positions: StakedPosition[]; max: bigint }) {
  const [hovered, setHovered] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3">
      {positions.map(p => {
        const width = max > 0n ? Number((p.valueInEth * 10_000n) / max) / 100 : 0;
        return (
          <div
            key={p.symbol}
            className="group"
            onMouseEnter={() => setHovered(p.symbol)}
            onMouseLeave={() => setHovered(null)}
          >
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className="flex items-center gap-2 font-medium text-white/80">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-sm"
                  style={{ background: SERIES[p.symbol] }}
                  aria-hidden
                />
                {p.symbol}
              </span>
              <span className="tabular-nums text-white/60">
                {eth(p.valueInEth)} ETH
                {hovered === p.symbol && (
                  <span className="ml-2 text-white/35">
                    {eth(p.balance, 2)} {p.symbol} @ {Number(formatEther(p.rate)).toFixed(4)}
                  </span>
                )}
              </span>
            </div>
            {/* 6px bar, 4px rounded end, sitting on a recessive track */}
            <div className="h-1.5 w-full overflow-hidden rounded bg-white/5">
              <div
                className="h-full rounded transition-[width] duration-500"
                style={{ width: `${width}%`, background: SERIES[p.symbol] }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function PositionTable({ positions }: { positions: StakedPosition[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-left text-xs uppercase tracking-wide text-white/40">
          <th className="pb-2 font-medium">Token</th>
          <th className="pb-2 text-right font-medium">Balance</th>
          <th className="pb-2 text-right font-medium">ETH per token</th>
          <th className="pb-2 text-right font-medium">Value (ETH)</th>
          <th className="pb-2 text-right font-medium">APR</th>
        </tr>
      </thead>
      <tbody className="text-white/70">
        {positions.map(p => (
          <tr key={p.symbol} className="border-t border-white/5">
            <td className="py-2 font-medium text-white/90">{p.symbol}</td>
            <td className="py-2 text-right tabular-nums">{eth(p.balance)}</td>
            <td className="py-2 text-right tabular-nums">
              {Number(formatEther(p.rate)).toFixed(6)}
            </td>
            <td className="py-2 text-right tabular-nums">{eth(p.valueInEth)}</td>
            <td className="py-2 text-right tabular-nums">{pct(p.apr)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * What the staking yield on this page would fund under Client Incentives V2. `revenueShareBps` is the
 * DAO-set dial; the 1.5% is the existing proposal + voting reward rate.
 */
const REWARD_RATE = 0.015;
const SHARE_OPTIONS = [0.25, 0.5, 1];

function ClientIncentivesPanel({ annualYieldWei }: { annualYieldWei: bigint }) {
  const yearly = Number(formatEther(annualYieldWei));

  return (
    <section className="rounded-lg border border-white/10 bg-white/5 p-5">
      <h2 className="text-sm font-semibold text-white/80">If this funded client incentives</h2>
      <p className="mt-1 max-w-2xl text-xs leading-relaxed text-white/40">
        Client Incentives V2 would let a share of this yield fund proposal and voting rewards, which
        today stop entirely when auctions raise nothing. Figures below apply the existing 1%
        proposal + 0.5% voting reward rate.
      </p>
      <table className="mt-4 w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-white/40">
            <th className="pb-2 font-medium">Share of yield</th>
            <th className="pb-2 text-right font-medium">Counted as revenue</th>
            <th className="pb-2 text-right font-medium">To clients / year</th>
            <th className="pb-2 text-right font-medium">Per 2-week period</th>
          </tr>
        </thead>
        <tbody className="text-white/70">
          {SHARE_OPTIONS.map(share => {
            const revenue = yearly * share;
            const toClients = revenue * REWARD_RATE;
            return (
              <tr key={share} className="border-t border-white/5">
                <td className="py-2 font-medium text-white/90">{pct(share, 0)}</td>
                <td className="py-2 text-right tabular-nums">{revenue.toFixed(2)} ETH</td>
                <td className="py-2 text-right tabular-nums">{toClients.toFixed(2)} ETH</td>
                <td className="py-2 text-right tabular-nums">{(toClients / 26).toFixed(3)} ETH</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function TreasuryPage() {
  const { positions, totalStakedEth, totalLiquidEth, annualYieldWei, isLoading, isError } =
    useTreasuryStaking();
  const [showTable, setShowTable] = useState(false);

  const blendedApr = useMemo(() => {
    if (totalStakedEth === 0n) return 0;
    return Number(formatEther(annualYieldWei)) / Number(formatEther(totalStakedEth));
  }, [annualYieldWei, totalStakedEth]);

  const max = useMemo(
    () => positions.reduce((m, p) => (p.valueInEth > m ? p.valueInEth : m), 0n),
    [positions],
  );

  return (
    <div
      className="min-h-screen w-full px-4 py-10 sm:px-8"
      style={{ fontFamily: "'PT Root UI', sans-serif", background: '#050510', color: '#fff' }}
    >
      <div className="mx-auto flex max-w-4xl flex-col gap-6">
        <header>
          <h1 className="text-3xl font-bold">Treasury staking</h1>
          <p className="mt-1 text-sm text-white/40">
            Live balances and exchange rates for the DAO&rsquo;s liquid staking positions, read
            straight from mainnet.
          </p>
        </header>

        {isError && (
          <div className="rounded-lg border border-red-400/30 bg-red-400/10 p-4 text-sm text-red-200">
            Could not read the treasury right now. The RPC may be rate limiting — this page retries
            on its own.
          </div>
        )}

        {isLoading ? (
          <div className="rounded-lg border border-white/10 bg-white/5 p-10 text-center text-sm text-white/40">
            Reading mainnet…
          </div>
        ) : (
          <>
            <YieldTicker annualYieldWei={annualYieldWei} />

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <StatTile
                label="Staked"
                value={eth(totalStakedEth)}
                unit="ETH"
                sub="Across 4 tokens"
              />
              <StatTile
                label="Annual yield"
                value={eth(annualYieldWei)}
                unit="ETH"
                sub="At published APRs"
              />
              <StatTile
                label="Blended APR"
                value={pct(blendedApr)}
                sub="Weighted by position size"
              />
            </div>

            <section className="rounded-lg border border-white/10 bg-white/5 p-5">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-white/80">Staked positions</h2>
                <button
                  type="button"
                  onClick={() => setShowTable(v => !v)}
                  className="rounded border border-white/10 px-2 py-1 text-xs text-white/50 transition-colors hover:bg-white/5 hover:text-white/80"
                >
                  {showTable ? 'Show chart' : 'Show table'}
                </button>
              </div>
              {showTable ? (
                <PositionTable positions={positions} />
              ) : (
                <PositionBars positions={positions} max={max} />
              )}
              <p className="mt-4 text-xs text-white/30">
                Balances and exchange rates are live. APRs are published figures held as constants —
                they are the one assumption on this page.
                {totalLiquidEth > 0n && (
                  <> Liquid wETH of {eth(totalLiquidEth)} ETH is not counted as staked.</>
                )}
              </p>
            </section>

            <ClientIncentivesPanel annualYieldWei={annualYieldWei} />
          </>
        )}
      </div>
    </div>
  );
}
