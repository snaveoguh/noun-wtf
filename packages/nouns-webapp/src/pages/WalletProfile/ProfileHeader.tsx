/** Identity header + stat tile row + AI overview card. */
import type { WalletProfile } from './types';

import { FC, useMemo } from 'react';

import { Loader2Icon, RefreshCwIcon, SparklesIcon } from 'lucide-react';

import { useEnsNames } from '@/components/TerminalFeed/useEnsNames';

import { useRefreshOverview } from './api';
import { fmtDate, fmtEth, fmtInt, fmtPct, fmtUsd, num, relTime, shortAddr, toDate } from './format';
import { AddrLink, Card, CopyButton, NounSeedImage, Pill, Skeleton, TriBar } from './ui';

export const ProfileHeader: FC<{ profile: WalletProfile; identity: string; isOwner: boolean }> = ({
  profile,
  identity,
  isOwner,
}) => {
  const id = profile.identity ?? {};
  const address = id.address ?? (identity.startsWith('0x') ? identity : undefined);
  const primary = id.ens ?? (address != null ? shortAddr(address) : identity);
  const h = profile.holdings ?? {};
  const first = h.nouns?.[0];
  const badges = profile.badges ?? [];
  const fc = id.farcaster;
  const ens = useEnsNames(h.delegate != null ? [h.delegate] : []);
  const represents = num(h.delegatedVotes ?? h.representsNouns?.length);

  return (
    <div className="wp-card flex flex-col gap-4 sm:flex-row sm:items-start">
      <div className="wp-avatar">
        {first != null && first.seed != null ? (
          <NounSeedImage nounId={first.nounId} seed={first.seed} title={`Noun ${first.nounId}`} />
        ) : (
          <span>⌐◨-◨</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h1
            className="wp-ellipsis m-0 text-xl font-bold leading-tight sm:text-2xl"
            title={address}
          >
            {primary}
          </h1>
          {isOwner && <Pill tone="accent">this is you</Pill>}
          {profile.autopilot?.enabled === true && (
            <Pill tone="pos" title={`Autopilot on · ${relTime(profile.autopilot.updatedAt)}`}>
              <SparklesIcon size={10} /> autopilot on
            </Pill>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px]">
          {address != null && (
            <span className="wp-muted wp-mono flex items-center gap-1" title={address}>
              {shortAddr(address)} <CopyButton text={address} label="address" />
            </span>
          )}
          {address != null && (
            <a
              href={`https://etherscan.io/address/${address}`}
              target="_blank"
              rel="noreferrer"
              className="wp-link"
            >
              etherscan ↗
            </a>
          )}
          {fc != null && fc.username != null && fc.username !== '' && (
            <a
              href={`https://warpcast.com/${fc.username}`}
              target="_blank"
              rel="noreferrer"
              className="wp-link"
              title={fc.fid != null ? `fid ${fc.fid}` : undefined}
            >
              @{fc.username} on farcaster ↗
            </a>
          )}
          {(id.aliases?.length ?? 0) > 0 && (
            <span className="wp-muted">aka {id.aliases?.join(', ')}</span>
          )}
        </div>
        {(badges.length > 0 || (id.tags?.length ?? 0) > 0) && (
          <div className="mt-2 flex flex-wrap gap-1">
            {badges.map(b => (
              <Pill key={b} tone="accent">
                {b}
              </Pill>
            ))}
            {id.tags?.map(t => (
              <Pill key={`tag-${t}`}>{t}</Pill>
            ))}
          </div>
        )}
        <div className="wp-muted mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
          <span title={fmtDate(id.firstSeen?.timestamp)}>
            first seen{' '}
            {toDate(id.firstSeen?.timestamp) != null ? relTime(id.firstSeen?.timestamp) : '—'}
          </span>
          <span title={fmtDate(id.lastActive?.timestamp)}>
            last active{' '}
            {toDate(id.lastActive?.timestamp) != null ? relTime(id.lastActive?.timestamp) : '—'}
          </span>
          <span>
            represents <span className="wp-secondary wp-mono">{fmtInt(represents)}</span> votes
          </span>
          <span>
            delegates to{' '}
            {h.delegate != null && h.delegate.toLowerCase() !== (address ?? '').toLowerCase() ? (
              <AddrLink address={h.delegate} ens={ens} />
            ) : (
              <span className="wp-secondary">self</span>
            )}
          </span>
          {(h.delegators?.length ?? 0) > 0 && (
            <span>{fmtInt(h.delegators?.length)} delegators</span>
          )}
        </div>
        {typeof id.summary === 'string' && id.summary.trim().length > 0 && (
          <p className="wp-secondary mb-0 mt-2 text-xs">{id.summary}</p>
        )}
      </div>
    </div>
  );
};

// ─── Stat tiles ────────────────────────────────────────────────────────────

export const StatTiles: FC<{ profile: WalletProfile }> = ({ profile }) => {
  const v = profile.voting ?? {};
  const p = profile.proposals ?? {};
  const a = profile.auctions ?? {};
  const t = profile.treasury ?? {};
  const treasuryUsd = num(t.totalReceivedUsdc);
  const treasuryEth = num(t.totalReceivedEth);
  const treasuryLabel = useMemo(() => {
    if (treasuryUsd === 0 && treasuryEth === 0) return '—';
    const parts: string[] = [];
    if (treasuryUsd > 0) parts.push(fmtUsd(treasuryUsd));
    if (treasuryEth > 0) parts.push(fmtEth(treasuryEth));
    return parts.join(' + ');
  }, [treasuryUsd, treasuryEth]);

  const tiles: { v: string; l: string; s?: React.ReactNode }[] = [
    { v: fmtInt(profile.holdings?.count ?? profile.holdings?.nouns?.length), l: 'Nouns held' },
    {
      v: fmtInt(v.total),
      l: 'Votes cast',
      s: <TriBar forN={v.for} againstN={v.against} abstainN={v.abstain} height={4} />,
    },
    {
      v: fmtPct(v.participationPct),
      l: 'Participation',
      s: v.streakCurrent != null ? `streak ${fmtInt(v.streakCurrent)}` : undefined,
    },
    {
      v: fmtInt(p.authored?.length),
      l: 'Proposals',
      s: p.passRate != null ? `${fmtPct(p.passRate)} passed` : undefined,
    },
    {
      v: fmtInt(profile.candidates?.sponsored?.length),
      l: 'Sponsored',
      s: `${fmtInt(p.signed?.length)} signed props`,
    },
    { v: fmtInt(a.wonCount ?? a.won?.length), l: 'Auctions won', s: fmtEth(a.totalSpentEth) },
    { v: fmtInt(a.settled), l: 'Settled', s: `${fmtInt(a.curated?.length)} curated` },
    { v: treasuryLabel, l: 'Treasury received', s: `${fmtInt(t.streams?.length)} streams` },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
      {tiles.map(tile => (
        <div key={tile.l} className="wp-stat">
          <div className="wp-stat-v" title={tile.v}>
            {tile.v}
          </div>
          <div className="wp-stat-l">{tile.l}</div>
          {tile.s != null && <div className="wp-stat-s">{tile.s}</div>}
        </div>
      ))}
    </div>
  );
};

export const StatTilesSkeleton: FC = () => (
  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
    {Array.from({ length: 8 }, (_, i) => `s${i}`).map(k => (
      <div key={k} className="wp-stat">
        <Skeleton h={22} w="60%" />
        <Skeleton h={10} w="80%" className="mt-2" />
      </div>
    ))}
  </div>
);

// ─── AI overview ───────────────────────────────────────────────────────────

const RATE_LIMIT_MS = 20 * 60 * 1000;

export const OverviewCard: FC<{ profile: WalletProfile; identity: string }> = ({
  profile,
  identity,
}) => {
  const ov = profile.overview;
  const refresh = useRefreshOverview(identity);
  const generated = toDate(ov?.generatedAt);
  const rateLimited = generated != null && Date.now() - generated.getTime() < RATE_LIMIT_MS;
  const hasText = typeof ov?.text === 'string' && ov.text.trim().length > 0;

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <SparklesIcon size={12} /> AI overview
          {hasText && (
            <span className="hidden normal-case opacity-60 sm:inline">
              · generated {relTime(ov?.generatedAt)}
              {ov?.model != null && ov.model !== '' ? ` · ${ov.model}` : ''}
              {refresh.data?.cached === true ? ' · rate-limited, showing cached' : ''}
            </span>
          )}
        </span>
      }
      right={
        <button
          type="button"
          className="wp-btn wp-btn-sm"
          disabled={refresh.isPending || rateLimited}
          title={
            rateLimited ? 'One refresh per 20 minutes' : 'Regenerate from the latest on-chain data'
          }
          onClick={() => refresh.mutate()}
        >
          {refresh.isPending ? (
            <Loader2Icon size={12} className="animate-spin" />
          ) : (
            <RefreshCwIcon size={12} />
          )}
          {hasText ? 'Refresh' : 'Generate overview'}
        </button>
      }
    >
      {hasText ? (
        <p className="m-0 whitespace-pre-wrap text-[13px] leading-relaxed">{ov?.text}</p>
      ) : (
        <div className="wp-muted text-xs">
          {refresh.isPending
            ? 'Reading every vote, proposal, bid and stream…'
            : "No overview yet. Generate one — the model reads this wallet's full governance record and writes a plain-English summary."}
        </div>
      )}
      {refresh.isError && (
        <div className="wp-neg mt-2 text-[11px]">Refresh failed: {refresh.error.message}</div>
      )}
    </Card>
  );
};
