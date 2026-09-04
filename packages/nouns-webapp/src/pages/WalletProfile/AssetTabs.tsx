/** Auctions · Nouns · Treasury tabs. */
import type { WalletProfile } from './types';

import { FC, useMemo } from 'react';

import { Link } from 'react-router';

import ClientBadge from '@/components/ClientBadge';
import { useEnsNames } from '@/components/TerminalFeed/useEnsNames';

import { fmtDate, fmtEth, fmtInt, fmtUsd, num, relTime, shortAddr } from './format';
import { AddrLink, Bar, Card, Empty, KV, NounLink, NounSeedImage, Pill } from './ui';

// ─── Auctions ──────────────────────────────────────────────────────────────

export const AuctionsTab: FC<{ profile: WalletProfile }> = ({ profile }) => {
  const a = profile.auctions;
  const won = a?.won ?? [];
  const curated = a?.curated ?? [];
  const heldSeeds = useMemo(() => {
    const m = new Map<
      string,
      NonNullable<NonNullable<WalletProfile['holdings']>['nouns']>[number]['seed']
    >();
    for (const n of profile.holdings?.nouns ?? []) m.set(String(n.nounId), n.seed);
    return m;
  }, [profile.holdings]);

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Card
          title={`Won · ${fmtInt(a?.wonCount ?? won.length)}`}
          right={<span className="wp-muted text-[11px]">spent {fmtEth(a?.totalSpentEth)}</span>}
        >
          {won.length === 0 ? (
            <Empty>No auction wins.</Empty>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-5">
              {won.map(w => (
                <div key={String(w.nounId)} className="min-w-0">
                  <NounLink nounId={w.nounId}>
                    <NounSeedImage
                      nounId={w.nounId}
                      seed={w.seed ?? heldSeeds.get(String(w.nounId))}
                      title={`Noun ${w.nounId}`}
                    />
                  </NounLink>
                  <div className="mt-1 flex items-center justify-between gap-1 text-[11px]">
                    <NounLink nounId={w.nounId}>#{w.nounId}</NounLink>
                    <span className="wp-mono flex items-center">
                      {fmtEth(w.amountEth)}
                      <ClientBadge clientId={w.clientId} size={12} />
                    </span>
                  </div>
                  <div className="wp-muted text-[10px]" title={fmtDate(w.timestamp)}>
                    {relTime(w.timestamp)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
      <div className="grid content-start gap-3">
        <Card title="Bidding">
          <KV k="bids placed" v={fmtInt(a?.bids?.count)} />
          <KV k="total bid" v={fmtEth(a?.bids?.totalEth)} />
          <KV k="nouns bid on" v={fmtInt(a?.bids?.nounsBidOn)} />
          <KV k="auctions extended" v={fmtInt(a?.bids?.extendedCount)} />
          <KV k="settled" v={fmtInt(a?.settled)} />
          {a?.nounderRewards != null && num(a.nounderRewards) > 0 && (
            <KV k="nounder rewards" v={fmtEth(a.nounderRewards)} />
          )}
        </Card>
        <Card title={`Curated · ${curated.length}`}>
          {curated.length === 0 ? (
            <Empty>Never settled the auction that minted the next noun.</Empty>
          ) : (
            <div className="flex flex-wrap gap-1">
              {curated.map(id => (
                <Link key={String(id)} to={`/noun/${id}`} className="wp-pill">
                  #{id}
                </Link>
              ))}
            </div>
          )}
          <div className="wp-muted mt-2 text-[10px]">
            Curated = settled N, so N+1 exists because of this wallet.
          </div>
        </Card>
      </div>
    </div>
  );
};

// ─── Nouns ─────────────────────────────────────────────────────────────────

export const NounsTab: FC<{ profile: WalletProfile }> = ({ profile }) => {
  const h = profile.holdings;
  const nouns = h?.nouns ?? [];
  const history = profile.delegationHistory ?? [];
  const forks = profile.forks ?? [];
  const addrs = useMemo(() => {
    const s = new Set<string>();
    for (const d of history) {
      if (d.fromDelegate) s.add(d.fromDelegate);
      if (d.toDelegate) s.add(d.toDelegate);
    }
    for (const d of h?.delegators ?? []) s.add(d);
    if (h?.delegate) s.add(h.delegate);
    return Array.from(s);
  }, [history, h]);
  const ens = useEnsNames(addrs);

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Card title={`Held · ${fmtInt(h?.count ?? nouns.length)}`}>
          {nouns.length === 0 ? (
            <Empty>Holds no Nouns right now.</Empty>
          ) : (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
              {nouns.map(n => (
                <div key={String(n.nounId)} className="min-w-0">
                  <NounLink nounId={n.nounId}>
                    <NounSeedImage nounId={n.nounId} seed={n.seed} title={`Noun ${n.nounId}`} />
                  </NounLink>
                  <div className="mt-1 flex items-center justify-between text-[11px]">
                    <NounLink nounId={n.nounId}>#{n.nounId}</NounLink>
                    <span className="wp-muted" title={fmtDate(n.since)}>
                      {n.since != null ? relTime(n.since) : ''}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
      <div className="grid content-start gap-3">
        <Card title="Delegation">
          <KV
            k="represents"
            v={`${fmtInt(h?.delegatedVotes ?? h?.representsNouns?.length)} votes`}
          />
          <KV
            k="delegates to"
            v={
              h?.delegate ? (
                <AddrLink address={h.delegate} ens={ens} />
              ) : (
                <span className="wp-muted">self</span>
              )
            }
          />
          {(h?.delegators?.length ?? 0) > 0 && (
            <div className="mt-2">
              <div className="wp-h">Delegators</div>
              <div className="flex flex-wrap gap-1">
                {h?.delegators?.map(d => (
                  <span key={d} className="wp-pill">
                    <AddrLink address={d} ens={ens} />
                  </span>
                ))}
              </div>
            </div>
          )}
          {(h?.representsNouns?.length ?? 0) > 0 && (
            <div className="mt-2">
              <div className="wp-h">Voting with</div>
              <div className="flex flex-wrap gap-1">
                {h?.representsNouns?.map(id => (
                  <Link key={String(id)} to={`/noun/${id}`} className="wp-pill">
                    #{id}
                  </Link>
                ))}
              </div>
            </div>
          )}
        </Card>
        <Card title={`Delegation history · ${history.length}`}>
          {history.length === 0 ? (
            <Empty>No delegation changes.</Empty>
          ) : (
            history.map(d => (
              <div
                key={`${d.kind ?? ''}-${d.fromDelegate ?? ''}-${d.toDelegate ?? ''}-${String(d.timestamp ?? '')}`}
                className="wp-row flex-col !items-stretch text-[11px]"
              >
                <div className="flex items-center gap-2">
                  <Pill tone={d.kind?.includes('in') === true ? 'pos' : 'mid'}>
                    {d.kind ?? 'delegate'}
                  </Pill>
                  <span className="wp-mono">{fmtInt(d.nounCount)}</span>
                  <span className="wp-muted ml-auto">{relTime(d.timestamp)}</span>
                </div>
                <div className="wp-muted mt-1">
                  <AddrLink address={d.fromDelegate} ens={ens} /> →{' '}
                  <AddrLink address={d.toDelegate} ens={ens} />
                </div>
              </div>
            ))
          )}
        </Card>
        {forks.length > 0 && (
          <Card title={`Forks · ${forks.length}`}>
            {forks.map(f => (
              <div
                key={`${f.forkId}-${f.kind ?? ''}-${String(f.timestamp ?? '')}`}
                className="wp-row items-center text-[11px]"
              >
                <Link to={`/fork/${f.forkId}`} className="wp-link">
                  Fork #{f.forkId}
                </Link>
                <Pill>{f.kind ?? 'fork'}</Pill>
                <span className="wp-muted">{fmtInt(f.nounIds?.length)} nouns</span>
                <span className="wp-muted ml-auto">{relTime(f.timestamp)}</span>
              </div>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
};

// ─── Treasury ──────────────────────────────────────────────────────────────

export const TreasuryTab: FC<{ profile: WalletProfile }> = ({ profile }) => {
  const t = profile.treasury;
  const streams = t?.streams ?? [];
  const sales = profile.transfers?.sales ?? [];
  const counterparties = useMemo(
    () =>
      sales
        .map(s => s.counterparty)
        .filter((c): c is string => typeof c === 'string' && c.length > 0),
    [sales],
  );
  const ens = useEnsNames(counterparties);

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <div className="grid gap-3 lg:col-span-2">
        <Card title={`Streams · ${streams.length}`}>
          {streams.length === 0 ? (
            <Empty>No treasury streams to this wallet.</Empty>
          ) : (
            streams.map(s => {
              const total = num(s.totalAmount);
              const done = num(s.withdrawnAmount);
              const pct = total > 0 ? (done / total) * 100 : 0;
              const sym = s.tokenSymbol ?? 'tokens';
              const fmt = (v: number) =>
                sym.toUpperCase() === 'USDC' ? fmtUsd(v) : `${v.toLocaleString()} ${sym}`;
              return (
                <div
                  key={s.streamAddress ?? `${s.proposalId}`}
                  className="wp-row flex-col !items-stretch"
                >
                  <div className="flex items-center gap-2 text-xs">
                    {s.proposalId != null ? (
                      <Link to={`/vote/${s.proposalId}`} className="wp-link">
                        Prop #{s.proposalId}
                      </Link>
                    ) : (
                      <span>Stream</span>
                    )}
                    <Pill tone={s.status === 'active' ? 'pos' : undefined}>
                      {s.status ?? 'stream'}
                    </Pill>
                    <span className="wp-mono ml-auto">
                      {fmt(done)} <span className="wp-muted">/ {fmt(total)}</span>
                    </span>
                  </div>
                  <div className="mt-1">
                    <Bar pct={pct} tone="pos" />
                  </div>
                  {s.streamAddress != null && (
                    <a
                      href={`https://etherscan.io/address/${s.streamAddress}`}
                      target="_blank"
                      rel="noreferrer"
                      className="wp-muted wp-mono mt-1 text-[10px]"
                    >
                      {shortAddr(s.streamAddress)} ↗
                    </a>
                  )}
                </div>
              );
            })
          )}
        </Card>
        <Card title={`Secondary sales · ${sales.length}`}>
          {sales.length === 0 ? (
            <Empty>No secondary sales.</Empty>
          ) : (
            sales.map(s => (
              <div
                key={`${s.nounId}-${String(s.timestamp ?? '')}-${s.side ?? ''}`}
                className="wp-row items-center text-xs"
              >
                <Pill tone={s.side === 'sell' ? 'neg' : 'pos'}>{s.side ?? 'sale'}</Pill>
                <NounLink nounId={s.nounId} />
                <span className="wp-mono">{fmtEth(s.priceEth)}</span>
                {s.marketplace != null && <span className="wp-muted">{s.marketplace}</span>}
                <span className="wp-muted ml-auto flex items-center gap-2">
                  <AddrLink address={s.counterparty} ens={ens} />
                  <span title={fmtDate(s.timestamp)}>{relTime(s.timestamp)}</span>
                </span>
              </div>
            ))
          )}
        </Card>
      </div>
      <div className="grid content-start gap-3">
        <Card title="Received from treasury">
          <KV k="USDC" v={fmtUsd(t?.totalReceivedUsdc)} />
          <KV k="ETH" v={fmtEth(t?.totalReceivedEth)} />
          <KV k="streams" v={fmtInt(streams.length)} />
        </Card>
        <Card title="Small grants">
          <KV k="authored" v={fmtInt(t?.grants?.authored)} />
          <KV k="votes" v={fmtInt(t?.grants?.votes)} />
        </Card>
        <Card title="Transfers">
          <KV k="received" v={fmtInt(profile.transfers?.received)} />
          <KV k="sent" v={fmtInt(profile.transfers?.sent)} />
        </Card>
      </div>
    </div>
  );
};
