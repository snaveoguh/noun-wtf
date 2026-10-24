/**
 * NONSENSE — where Nouns DAO's money comes from and where it goes.
 *
 * Data: GET /api/treasury/flows (packages/nouns-api/src/api/treasury/*): every
 * winning auction bid in, every executed proposal's decoded payout and every
 * fork payout out. This page only filters and lays it out (model.ts).
 *
 * Layout, top to bottom: IN / OUT / NET, a flow summary (Sankey), money per
 * year (click to filter), then who got what (sortable) with a detail panel.
 * The 3D view is an optional "explore" mode.
 */
import type { ExploreNode } from './Explore3D';
import type { EntityType, FlowKind, TreasuryFlowsResponse } from './types';

import { lazy, Suspense, useCallback, useMemo, useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import { SearchIcon as Search } from 'lucide-react';

import { apiFetch } from '@/lib/api';

import DetailPanel from './DetailPanel';
import FlowSummary from './FlowSummary';
import {
  KIND_META,
  OUT_KINDS,
  TYPE_META,
  fmtDate,
  fmtEth,
  fmtUsd,
  recipientRows,
  bidderRows,
  viewTotals,
  type ViewFilter,
} from './model';
import { NONSENSE_CSS } from './styles';
import { BiddersTable, RecipientsTable } from './Tables';
import YearBars from './YearBars';

const Explore3D = lazy(() => import('./Explore3D'));

const FILTER_TYPES: EntityType[] = [
  'person',
  'multisig',
  'contract',
  'subdao',
  'nounders',
  'bidder',
];

function useTreasuryFlows() {
  return useQuery<TreasuryFlowsResponse>({
    queryKey: ['treasury-flows-v2'],
    queryFn: async () => {
      const d = await apiFetch<TreasuryFlowsResponse>('/api/treasury/flows');
      if (d?.version !== 2) throw new Error('The API is still serving the old treasury format.');
      return d;
    },
    staleTime: 5 * 60_000,
    // While the API is still backfilling, check again every minute so an
    // open tab moves on from "catching up" by itself once indexing is done
    // (the app never refetches on focus).
    refetchInterval: q => (q.state.data?.indexing.complete === false ? 60_000 : false),
    retry: 1,
  });
}

function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

function Tip({ text }: { text: string }) {
  return (
    <span className="nz-tip" tabIndex={0} role="note" aria-label={text} data-tip={text}>
      ?
    </span>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="nz">
      <style>{NONSENSE_CSS}</style>
      <header className="nz-head">
        <h1 data-keep-font>NONSENSE</h1>
        <p>
          where nouns money comes from, and where it goes. every auction in, every executed proposal
          out, read straight off the chain. it&apos;s exactly what it says.
        </p>
      </header>
      {children}
    </div>
  );
}

export default function TreasuryFlowSection() {
  const q = useTreasuryFlows();
  const [year, setYear] = useState<number | null>(null);
  const [types, setTypes] = useState<Set<EntityType>>(() => new Set());
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'recipients' | 'bidders'>('recipients');
  const [selected, setSelected] = useState<string | null>(null);
  const [explore, setExplore] = useState(false);
  const webgl = useMemo(() => hasWebGL(), []);
  const close = useCallback(() => setSelected(null), []);

  const filter: ViewFilter = useMemo(() => ({ year, types, query }), [year, types, query]);
  const data = q.data;
  const totals = useMemo(() => (data ? viewTotals(data, year) : null), [data, year]);

  const exploreItems: ExploreNode[] = useMemo(() => {
    if (!data || !explore) return [];
    const rec = recipientRows(data, filter)
      .map(r => {
        const kinds = r.kinds.filter(k => k !== 'auction');
        // main kind = the one that carried the most value to them
        const main = kinds
          .map(k => ({
            k,
            v: data.flows
              .filter(f => f.to === r.node.id && f.kind === k)
              .reduce((s, f) => s + f.eth + f.usd / 2500, 0),
          }))
          .sort((a, b) => b.v - a.v)[0]?.k;
        return { node: r.node, eth: r.eth, usd: r.usd, kind: (main ?? 'direct') as FlowKind };
      })
      .sort((a, b) => b.eth + b.usd / 2500 - (a.eth + a.usd / 2500))
      .slice(0, 160);
    const bid =
      types.size === 0 || types.has('bidder')
        ? bidderRows(data, filter)
            .filter(b => b.node.type === 'bidder')
            .sort((a, b) => b.eth - a.eth)
            .slice(0, 40)
            .map(b => ({ node: b.node, eth: b.eth, usd: 0, kind: 'auction' as FlowKind }))
        : [];
    return [...rec, ...bid];
  }, [data, filter, explore, types]);

  if (q.isPending) {
    return (
      <Shell>
        <div className="nz-loading" aria-busy="true">
          <div className="nz-tiles">
            {[0, 1, 2].map(i => (
              <div key={i} className="nz-tile is-skel" />
            ))}
          </div>
          <div className="nz-skel-block" />
          <p>adding up every auction since 2021…</p>
        </div>
      </Shell>
    );
  }

  if (q.isError || !data || !totals) {
    return (
      <Shell>
        <div className="nz-state">
          <h2 data-keep-font>COULDN&apos;T LOAD THE MONEY</h2>
          <p>{q.error instanceof Error ? q.error.message : 'The treasury API did not answer.'}</p>
          <button type="button" className="nz-chip is-acid" onClick={() => void q.refetch()}>
            try again
          </button>
        </div>
      </Shell>
    );
  }

  const indexing = !data.indexing.complete;
  if (data.flows.length === 0) {
    return (
      <Shell>
        <div className="nz-state">
          <h2 data-keep-font>NOTHING HERE YET</h2>
          <p>
            {indexing
              ? `the indexer is re-reading the chain from the start${data.indexing.timestamp !== null ? ` (up to ${fmtDate(data.indexing.timestamp)} so far)` : ''}. check back in a few minutes.`
              : 'the API returned no flows at all.'}
          </p>
          <button type="button" className="nz-chip" onClick={() => void q.refetch()}>
            check again
          </button>
        </div>
      </Shell>
    );
  }

  const s = data.stats;
  const toggleType = (t: EntityType) =>
    setTypes(prev => {
      const n = new Set(prev);
      if (n.has(t)) n.delete(t);
      else n.add(t);
      return n;
    });
  const period = year === null ? 'since 2021' : `in ${year}`;
  const forks = totals.byKind.fork.count;

  return (
    <Shell>
      {indexing && (
        <div className="nz-banner" role="status">
          the indexer is catching up
          {data.indexing.timestamp !== null
            ? `: figures cover up to ${fmtDate(data.indexing.timestamp)}`
            : ''}
          . they will grow as it syncs.
        </div>
      )}

      <section className="nz-tiles" aria-label="totals">
        <div className="nz-tile is-in">
          <span className="nz-tile-k">
            <span data-keep-font>IN</span> <Tip text={KIND_META.auction.explain} />
          </span>
          <span className="nz-tile-v">{fmtEth(totals.inEth)}</span>
          <span className="nz-tile-s">
            from {totals.auctions.toLocaleString()} noun auctions {period}
          </span>
        </div>
        <div className="nz-tile is-out">
          <span className="nz-tile-k">
            <span data-keep-font>OUT</span>{' '}
            <Tip text="ETH, WETH and stETH paid out (direct, streams, contract calls, forks). USDC is shown separately in dollars; ETH can't be added to dollars without a price." />
          </span>
          <span className="nz-tile-v">
            {fmtEth(totals.outEth)} <small>+ {fmtUsd(totals.outUsd)}</small>
          </span>
          <span className="nz-tile-s">
            to {totals.recipients.toLocaleString()} recipients via{' '}
            {totals.proposals.toLocaleString()} proposals
            {forks > 0 ? ' and fork exits' : ''}
          </span>
        </div>
        <div className={`nz-tile ${totals.netEth >= 0 ? 'is-net-pos' : 'is-net-neg'}`}>
          <span className="nz-tile-k">
            <span data-keep-font>NET</span>{' '}
            <Tip text="Auction ETH in, minus ETH paid out, minus ETH swapped into USDC (via the Token Buyer) to pay USDC bills. Ignores staking yield and other income." />
          </span>
          <span className="nz-tile-v">{fmtEth(totals.netEth, { sign: true })}</span>
          <span className="nz-tile-s">after {fmtEth(totals.ethToUsdc)} swapped to USDC</span>
        </div>
      </section>

      <section className="nz-card">
        <h2 className="nz-h" data-keep-font>
          WHERE IT WENT {year !== null && <span className="nz-h-year">{year}</span>}
        </h2>
        <FlowSummary totals={totals} />
        <ul className="nz-facts">
          <li>
            <b>{s.nounderNouns}</b> nouns went to the founders (every 10th noun for the first five
            years), no ETH involved
          </li>
          <li>
            <b>{s.nounsGiven}</b> nouns were given away by proposals
          </li>
          <li>
            <b>{s.streams.vesting}</b> streams still vesting, <b>{s.streams.ended}</b> finished,{' '}
            <b>{s.streams.cancelled}</b> cancelled
          </li>
          <li>
            <b>{fmtEth(s.convertedEth)}</b> was wrapped, staked or swapped inside the treasury (not
            spending)
          </li>
          {s.nounsToTreasury > 0 && (
            <li>
              <b>{s.nounsToTreasury}</b> unsold nouns went to the treasury, <b>{s.nounsBurned}</b>{' '}
              were burned
            </li>
          )}
          {Object.keys(s.otherTokens).length > 0 && (
            <li>
              also out, not priced:{' '}
              {Object.entries(s.otherTokens)
                .filter(([k]) => !k.startsWith('0x'))
                .map(([k, v]) => `${v.toLocaleString('en-US', { maximumFractionDigits: 1 })} ${k}`)
                .join(', ')}
            </li>
          )}
        </ul>
      </section>

      <section className="nz-card">
        <h2 className="nz-h" data-keep-font>
          YEAR BY YEAR
        </h2>
        <YearBars data={data} year={year} onYear={setYear} />
      </section>

      <section className="nz-card nz-who-card">
        <div className="nz-who-head">
          <div className="nz-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'recipients'}
              className={tab === 'recipients' ? 'is-on' : ''}
              onClick={() => setTab('recipients')}
              data-keep-font
            >
              WHO GOT PAID
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'bidders'}
              className={tab === 'bidders' ? 'is-on' : ''}
              onClick={() => setTab('bidders')}
              data-keep-font
            >
              WHO PAID IN
            </button>
          </div>
          <label className="nz-search">
            <Search size={15} />
            <input
              type="search"
              placeholder="name, address, prop # or title"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
          </label>
        </div>
        <div className="nz-filters">
          <button
            type="button"
            className={`nz-chip ${year === null ? 'is-on' : ''}`}
            onClick={() => setYear(null)}
          >
            all years
          </button>
          {data.years.map(y => (
            <button
              key={y.year}
              type="button"
              className={`nz-chip ${year === y.year ? 'is-on' : ''}`}
              onClick={() => setYear(year === y.year ? null : y.year)}
            >
              {y.year}
            </button>
          ))}
        </div>
        <div className="nz-filters">
          {FILTER_TYPES.filter(t => (tab === 'bidders' ? true : t !== 'bidder')).map(t => (
            <button
              key={t}
              type="button"
              className={`nz-chip ${types.has(t) ? 'is-on' : ''}`}
              onClick={() => toggleType(t)}
              title={TYPE_META[t].explain}
              aria-pressed={types.has(t)}
            >
              {TYPE_META[t].glyph} {TYPE_META[t].label}
            </button>
          ))}
          {types.size > 0 && (
            <button type="button" className="nz-chip is-clear" onClick={() => setTypes(new Set())}>
              clear
            </button>
          )}
        </div>
        {tab === 'recipients' ? (
          <RecipientsTable data={data} filter={filter} selected={selected} onSelect={setSelected} />
        ) : (
          <BiddersTable data={data} filter={filter} selected={selected} onSelect={setSelected} />
        )}
      </section>

      <section className="nz-card">
        <div className="nz-explore-head">
          <h2 className="nz-h" data-keep-font>
            EXPLORE
          </h2>
          {webgl ? (
            <button
              type="button"
              className={`nz-chip ${explore ? 'is-on' : 'is-acid'}`}
              onClick={() => setExplore(e => !e)}
            >
              {explore ? 'hide the 3D view' : 'open the 3D view'}
            </button>
          ) : (
            <span className="nz-muted">
              the 3D view needs WebGL, which this browser doesn&apos;t have. everything above is the
              same data.
            </span>
          )}
        </div>
        {explore && webgl && (
          <Suspense fallback={<div className="nz-3d nz-3d-loading">loading the 3D view…</div>}>
            <Explore3D items={exploreItems} selected={selected} onSelect={setSelected} />
          </Suspense>
        )}
        {!explore && (
          <p className="nz-muted">
            the top {Math.min(200, data.nodes.length)} addresses as a 3D map: shape is what they
            are, colour is how they were paid, filters above apply.
          </p>
        )}
      </section>

      <section className="nz-legend-card" aria-label="what the words mean">
        <h2 className="nz-h" data-keep-font>
          WHAT THE WORDS MEAN
        </h2>
        <dl>
          {(['auction', ...OUT_KINDS] as FlowKind[]).map(k => (
            <div key={k}>
              <dt>
                <i style={{ background: KIND_META[k].color }} /> {KIND_META[k].label}
              </dt>
              <dd>{KIND_META[k].explain}</dd>
            </div>
          ))}
          {FILTER_TYPES.map(t => (
            <div key={t}>
              <dt>
                {TYPE_META[t].glyph} {TYPE_META[t].label}
              </dt>
              <dd>{TYPE_META[t].explain}</dd>
            </div>
          ))}
        </dl>
        <p className="nz-muted">
          sources: the noun.wtf indexer (auction settlements, proposal actions, streams, fork
          payouts from nouns.eth). updated {fmtDate(data.generatedAt)}.
        </p>
      </section>

      {selected && <DetailPanel data={data} id={selected} year={year} onClose={close} />}
    </Shell>
  );
}
