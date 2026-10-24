// Sortable "who got what" and "who paid in" lists.
import type { FlowKind, TreasuryFlowsResponse } from './types';

import { useMemo, useState } from 'react';

import { Link } from 'react-router';

import {
  KIND_META,
  TYPE_META,
  bidderRows,
  fmtDate,
  fmtEth,
  fmtUsd,
  recipientRows,
  sortRows,
  type BidderRow,
  type RecipientRow,
  type SortKey,
  type ViewFilter,
} from './model';

const PAGE = 40;

export function KindBadge({ kind }: { kind: FlowKind }) {
  const m = KIND_META[kind];
  return (
    <span className="nz-kind" title={m.explain}>
      <i style={{ background: m.color }} />
      {m.label}
    </span>
  );
}

export function TypeTag({ type }: { type: keyof typeof TYPE_META }) {
  const m = TYPE_META[type];
  return (
    <span className={`nz-type nz-type-${type}`} title={m.explain}>
      {m.glyph} {m.label}
    </span>
  );
}

function SortTh({
  k,
  label,
  sort,
  setSort,
  className,
}: {
  k: SortKey;
  label: string;
  sort: { key: SortKey; dir: 1 | -1 };
  setSort: (s: { key: SortKey; dir: 1 | -1 }) => void;
  className?: string;
}) {
  const active = sort.key === k;
  return (
    <th
      className={className}
      aria-sort={active ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
    >
      <button
        type="button"
        onClick={() =>
          setSort({ key: k, dir: active ? (sort.dir === 1 ? -1 : 1) : k === 'name' ? 1 : -1 })
        }
      >
        {label}
        {active ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
      </button>
    </th>
  );
}

interface Props {
  data: TreasuryFlowsResponse;
  filter: ViewFilter;
  selected: string | null;
  onSelect: (id: string) => void;
}

export function RecipientsTable({ data, filter, selected, onSelect }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'eth', dir: -1 });
  const [limit, setLimit] = useState(PAGE);
  const rows = useMemo(() => {
    const pick = (r: RecipientRow, k: SortKey) =>
      k === 'eth' ? r.eth : k === 'usd' ? r.usd : k === 'proposals' ? r.proposals.length : r.lastT;
    return sortRows(recipientRows(data, filter), sort.key, sort.dir, pick);
  }, [data, filter, sort]);

  if (rows.length === 0)
    return <p className="nz-empty-inline">nobody matches. try another search, type or year.</p>;

  return (
    <>
      <table className="nz-table">
        <thead>
          <tr>
            <SortTh k="name" label="who" sort={sort} setSort={setSort} />
            <SortTh k="eth" label="ETH" sort={sort} setSort={setSort} className="num" />
            <SortTh k="usd" label="USDC" sort={sort} setSort={setSort} className="num" />
            <th className="hide-sm">how</th>
            <SortTh
              k="proposals"
              label="props"
              sort={sort}
              setSort={setSort}
              className="num hide-sm"
            />
            <SortTh
              k="lastT"
              label="last paid"
              sort={sort}
              setSort={setSort}
              className="num hide-sm"
            />
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, limit).map(r => (
            <tr
              key={r.node.id}
              className={selected === r.node.id ? 'is-selected' : ''}
              onClick={() => onSelect(r.node.id)}
            >
              <td>
                <button type="button" className="nz-who" onClick={() => onSelect(r.node.id)}>
                  <span className="nz-who-name">{r.node.name}</span>
                  <TypeTag type={r.node.type} />
                </button>
                <span className="nz-row-meta show-sm">
                  {r.kinds.map(k => (
                    <KindBadge key={k} kind={k} />
                  ))}
                </span>
              </td>
              <td className="num">
                {r.eth > 0
                  ? fmtEth(r.eth)
                  : r.nouns > 0
                    ? `${r.nouns} Noun${r.nouns > 1 ? 's' : ''}`
                    : ''}
              </td>
              <td className="num">{r.usd > 0 ? fmtUsd(r.usd) : ''}</td>
              <td className="hide-sm">
                {r.kinds.map(k => (
                  <KindBadge key={k} kind={k} />
                ))}
              </td>
              <td className="num hide-sm">
                {r.proposals.slice(0, 3).map(id => (
                  <Link
                    key={id}
                    to={`/vote/${id}`}
                    onClick={e => e.stopPropagation()}
                    className="nz-prop"
                  >
                    #{id}
                  </Link>
                ))}
                {r.proposals.length > 3 && (
                  <span className="nz-more"> +{r.proposals.length - 3}</span>
                )}
              </td>
              <td className="num hide-sm">{fmtDate(r.lastT)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <TableFooter
        shown={Math.min(limit, rows.length)}
        total={rows.length}
        onMore={() => setLimit(l => l + PAGE * 2)}
      />
    </>
  );
}

export function BiddersTable({ data, filter, selected, onSelect }: Props) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'eth', dir: -1 });
  const [limit, setLimit] = useState(PAGE);
  const rows = useMemo(() => {
    const pick = (r: BidderRow, k: SortKey) =>
      k === 'eth' ? r.eth : k === 'proposals' ? r.auctions : r.lastT;
    return sortRows(bidderRows(data, filter), sort.key, sort.dir, pick);
  }, [data, filter, sort]);

  if (rows.length === 0) return <p className="nz-empty-inline">no auction winners match.</p>;
  return (
    <>
      <table className="nz-table">
        <thead>
          <tr>
            <SortTh k="name" label="who" sort={sort} setSort={setSort} />
            <SortTh k="eth" label="paid" sort={sort} setSort={setSort} className="num" />
            <SortTh k="proposals" label="nouns won" sort={sort} setSort={setSort} className="num" />
            <SortTh
              k="lastT"
              label="last win"
              sort={sort}
              setSort={setSort}
              className="num hide-sm"
            />
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, limit).map(r => (
            <tr
              key={r.node.id}
              className={selected === r.node.id ? 'is-selected' : ''}
              onClick={() => onSelect(r.node.id)}
            >
              <td>
                <button type="button" className="nz-who" onClick={() => onSelect(r.node.id)}>
                  <span className="nz-who-name">{r.node.name}</span>
                  <TypeTag type={r.node.type} />
                </button>
              </td>
              <td className="num">{fmtEth(r.eth)}</td>
              <td className="num">{r.auctions}</td>
              <td className="num hide-sm">{fmtDate(r.lastT)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <TableFooter
        shown={Math.min(limit, rows.length)}
        total={rows.length}
        onMore={() => setLimit(l => l + PAGE * 2)}
      />
    </>
  );
}

function TableFooter({
  shown,
  total,
  onMore,
}: {
  shown: number;
  total: number;
  onMore: () => void;
}) {
  return (
    <div className="nz-table-foot">
      <span>
        {shown} of {total}
      </span>
      {shown < total && (
        <button type="button" className="nz-chip" onClick={onMore}>
          show more
        </button>
      )}
    </div>
  );
}
