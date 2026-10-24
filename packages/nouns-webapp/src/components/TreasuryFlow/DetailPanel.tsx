// The selected address: what it is, its totals and every flow, with links to
// the proposal on noun.wtf and the transaction on Etherscan.
import type { Flow, TreasuryFlowsResponse } from './types';

import { useEffect, useMemo, useRef } from 'react';

import { ExternalLinkIcon as ExternalLink, XIcon as X } from 'lucide-react';
import { Link } from 'react-router';

import {
  TYPE_META,
  etherscanAddr,
  etherscanTx,
  fmtAmount,
  fmtDate,
  fmtEth,
  fmtUsd,
  flowsOf,
} from './model';
import { KindBadge, TypeTag } from './Tables';

const MAX_ROWS = 120;

function StreamBar({ f }: { f: Flow }) {
  const s = f.stream!;
  const vested = Math.round(s.progress * 100);
  return (
    <div className="nz-stream">
      <div className="nz-stream-bar" aria-label={`${vested}% of the vesting period elapsed`}>
        <span style={{ width: `${vested}%` }} />
      </div>
      <small>
        {s.state === 'cancelled'
          ? `cancelled at ${vested}% of its schedule. paid ${s.paidOut.toLocaleString('en-US', { maximumFractionDigits: 2 })}, ${s.refunded.toLocaleString('en-US', { maximumFractionDigits: 2 })} returned or never funded`
          : s.state === 'not-started'
            ? `starts ${fmtDate(s.start)}`
            : `${s.state === 'ended' ? 'fully vested' : `${vested}% vested`} (${fmtDate(s.start)} to ${fmtDate(s.stop)}), withdrawn ${s.paidOut.toLocaleString('en-US', { maximumFractionDigits: 2 })} of ${s.total.toLocaleString('en-US', { maximumFractionDigits: 2 })}`}
      </small>
    </div>
  );
}

interface Props {
  data: TreasuryFlowsResponse;
  id: string;
  year: number | null;
  onClose: () => void;
}

export default function DetailPanel({ data, id, year, onClose }: Props) {
  const node = data.nodes.find(n => n.id === id);
  const flows = useMemo(() => flowsOf(data, id, year), [data, id, year]);
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  // Sticky to the bottom of whatever scrolls the page (the NounOS window's
  // content box, or the document), sized to fit inside it.
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return;
    const scroller = el.closest<HTMLElement>('.nos-content');
    const fit = () => {
      const h = scroller ? scroller.clientHeight : window.innerHeight;
      el.style.maxHeight = `${Math.max(240, Math.min(640, h - 24))}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    if (scroller) ro.observe(scroller);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id, onClose]);
  if (!node) return null;
  const isTreasury = node.id === 'treasury';
  const received = flows.filter(f => f.kind !== 'auction' && f.to === id);
  const paid = flows.filter(f => f.kind === 'auction' && f.from === id);
  const sum = (fs: Flow[], k: 'eth' | 'usd') => fs.reduce((s, f) => s + f[k], 0);

  return (
    <aside ref={panelRef} className="nz-panel" role="dialog" aria-label={`${node.name} details`}>
      <header>
        <div>
          <h3>{node.name}</h3>
          <TypeTag type={node.type} />
        </div>
        <button
          ref={closeRef}
          type="button"
          className="nz-icon-btn"
          onClick={onClose}
          aria-label="close"
        >
          <X size={18} />
        </button>
      </header>
      <p className="nz-panel-what">
        {node.description ?? TYPE_META[node.type].explain}
        {node.codeUnknown === true &&
          ' (contract check failed, so person vs contract is unverified.)'}
      </p>
      {!isTreasury && (
        <p className="nz-panel-addr">
          <a href={etherscanAddr(node.id)} target="_blank" rel="noreferrer">
            {node.id} <ExternalLink size={12} />
          </a>
          {node.ens && node.ens !== node.name && <span> {node.ens}</span>}
        </p>
      )}
      <dl className="nz-panel-stats">
        {(received.length > 0 || isTreasury) && (
          <div>
            <dt>{isTreasury ? 'paid out' : 'received'}</dt>
            <dd>
              {fmtEth(
                isTreasury
                  ? sum(
                      flows.filter(f => f.kind !== 'auction'),
                      'eth',
                    )
                  : sum(received, 'eth'),
              )}
              {(isTreasury ? sum(flows, 'usd') : sum(received, 'usd')) > 0 && (
                <em> + {fmtUsd(isTreasury ? sum(flows, 'usd') : sum(received, 'usd'))}</em>
              )}
            </dd>
          </div>
        )}
        {(paid.length > 0 || isTreasury) && (
          <div>
            <dt>{isTreasury ? 'auctions in' : 'paid at auction'}</dt>
            <dd>
              {fmtEth(sum(isTreasury ? flows.filter(f => f.kind === 'auction') : paid, 'eth'))}
              <em>
                {' '}
                {isTreasury ? flows.filter(f => f.kind === 'auction').length : paid.length} nouns
              </em>
            </dd>
          </div>
        )}
        {node.id === '0x2573c60a6d127755aa2dc85e342f7da2378a0cc5' && (
          <div>
            <dt>founders&apos; reward</dt>
            <dd>{data.stats.nounderNouns} Nouns</dd>
          </div>
        )}
        {year !== null && (
          <div>
            <dt>showing</dt>
            <dd>{year} only</dd>
          </div>
        )}
      </dl>
      <h4>{isTreasury ? 'latest flows' : 'every flow'}</h4>
      {flows.length === 0 && <p className="nz-empty-inline">no flows in this period.</p>}
      <ol className="nz-flowlist">
        {flows.slice(0, MAX_ROWS).map(f => {
          const p = f.proposalId !== undefined ? data.proposals[f.proposalId] : undefined;
          const other = f.kind === 'auction' ? f.from : f.to;
          const otherNode = isTreasury ? data.nodes.find(n => n.id === other) : undefined;
          return (
            <li key={f.id}>
              <div className="nz-fl-top">
                <KindBadge kind={f.kind} />
                <b>{fmtAmount(f)}</b>
                <span className="nz-fl-date">{fmtDate(f.t)}</span>
              </div>
              {otherNode && (
                <div className="nz-fl-who">
                  {f.kind === 'auction' ? 'from' : 'to'} {otherNode.name}
                </div>
              )}
              {f.kind === 'auction' && f.nounId !== undefined && (
                <div className="nz-fl-sub">
                  <Link to={`/noun/${f.nounId}`}>Noun {f.nounId}</Link>
                </div>
              )}
              {p && (
                <div className="nz-fl-sub">
                  <Link to={`/vote/${p.id}`}>
                    #{p.id} {p.title}
                  </Link>
                </div>
              )}
              {f.kind === 'fork' && (
                <div className="nz-fl-sub">
                  {(f.count ?? 1) > 1 ? `${f.count} fork sends that day` : 'fork send'}
                </div>
              )}
              {f.kind === 'call' && f.fn && <div className="nz-fl-sub">sent with {f.fn}()</div>}
              {f.asset === 'NOUN' && f.nounId !== undefined && (
                <div className="nz-fl-sub">
                  <Link to={`/noun/${f.nounId}`}>Noun {f.nounId}</Link>
                </div>
              )}
              {f.stream && <StreamBar f={f} />}
              {f.txHash && (
                <a
                  className="nz-fl-tx"
                  href={etherscanTx(f.txHash)}
                  target="_blank"
                  rel="noreferrer"
                >
                  tx <ExternalLink size={11} />
                </a>
              )}
            </li>
          );
        })}
      </ol>
      {flows.length > MAX_ROWS && (
        <p className="nz-empty-inline">
          showing the latest {MAX_ROWS} of {flows.length}. pick a year to narrow it down.
        </p>
      )}
    </aside>
  );
}
