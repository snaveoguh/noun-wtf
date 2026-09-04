/** Overview · Votes · Proposals · Candidates tabs. */
import type { AutopilotAutoVote, RecentVote, WalletProfile } from './types';

import { FC, useMemo, useState } from 'react';

import { ChevronDownIcon, ChevronUpIcon } from 'lucide-react';
import { Link } from 'react-router';

import ClientBadge from '@/components/ClientBadge';

import { AutopilotLogCard } from './AutopilotPanel';
import { fmtDate, fmtEth, fmtInt, fmtPct, num, relTime } from './format';
import {
  Card,
  Empty,
  EtherscanTx,
  NounLink,
  NounSeedImage,
  Pill,
  PropLink,
  StatusPill,
  SupportChip,
  TriBar,
} from './ui';

const NO_AUTO_VOTES: AutopilotAutoVote[] = [];

// ─── Vote row ──────────────────────────────────────────────────────────────

export const VoteRow: FC<{ vote: RecentVote; isV2?: boolean }> = ({ vote, isV2 = false }) => {
  const [open, setOpen] = useState(false);
  const reason = typeof vote.reason === 'string' ? vote.reason.trim() : '';
  const hasReason = reason.length > 0;
  const long = reason.length > 160;
  const aligned = vote.alignedWithOutcome;

  return (
    <div className="wp-row flex-col !items-stretch">
      <div className="flex items-center gap-2">
        <SupportChip support={vote.support} />
        <PropLink id={vote.proposalId} title={vote.title} isV2={isV2} />
        <span className="ml-auto flex shrink-0 items-center gap-2 text-[11px]">
          {vote.votes != null && (
            <span className="wp-muted wp-mono" title="voting weight">
              ×{fmtInt(vote.votes)}
            </span>
          )}
          {aligned === true && (
            <Pill tone="pos" title="Voted with the outcome">
              ✓
            </Pill>
          )}
          {aligned === false && (
            <Pill tone="neg" title="Voted against the outcome">
              ✗
            </Pill>
          )}
          {vote.proposalStatus != null && <StatusPill status={vote.proposalStatus} />}
          <ClientBadge clientId={vote.clientId} size={14} />
          <span className="wp-muted" title={fmtDate(vote.timestamp)}>
            {relTime(vote.timestamp)}
          </span>
          <EtherscanTx hash={vote.txHash} />
        </span>
      </div>
      {hasReason && (
        <div className="wp-reason">
          {long && !open ? `${reason.slice(0, 160)}…` : reason}
          {long && (
            <button
              type="button"
              className="wp-link ml-2 inline-flex items-center gap-1 text-[11px]"
              onClick={() => setOpen(o => !o)}
            >
              {open ? <ChevronUpIcon size={11} /> : <ChevronDownIcon size={11} />}
              {open ? 'less' : 'more'}
            </button>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Overview ──────────────────────────────────────────────────────────────

export const OverviewTab: FC<{
  profile: WalletProfile;
  onTab: (t: string) => void;
  /** Relayer-cast votes (owner: live autopilot state; visitor: the profile's public copy). */
  autoVotes?: AutopilotAutoVote[];
}> = ({ profile, onTab, autoVotes = NO_AUTO_VOTES }) => {
  const votes = profile.voting?.recent ?? [];
  const authored = profile.proposals?.authored ?? [];
  const nouns = profile.holdings?.nouns ?? [];
  const v2 = profile.v2;
  const hasV2 = v2 != null && (num(v2.votes) > 0 || num(v2.auctionsWon) > 0 || num(v2.bids) > 0);

  return (
    <div className="grid gap-3 lg:grid-cols-3">
      <div className="grid gap-3 lg:col-span-2">
        <Card
          title="Recent votes"
          right={
            <button type="button" className="wp-link text-[11px]" onClick={() => onTab('votes')}>
              all {fmtInt(profile.voting?.total)} →
            </button>
          }
        >
          {votes.length === 0 ? (
            <Empty>No votes on record.</Empty>
          ) : (
            votes
              .slice(0, 8)
              .map(v => <VoteRow key={`${v.proposalId}-${v.txHash ?? ''}`} vote={v} />)
          )}
        </Card>

        <Card
          title="Authored proposals"
          right={
            <button
              type="button"
              className="wp-link text-[11px]"
              onClick={() => onTab('proposals')}
            >
              all {authored.length} →
            </button>
          }
        >
          {authored.length === 0 ? (
            <Empty>Never proposed. Yet.</Empty>
          ) : (
            authored.slice(0, 5).map(p => (
              <div key={String(p.id)} className="wp-row flex-col !items-stretch">
                <div className="flex items-center gap-2">
                  <PropLink id={p.id} title={p.title} />
                  <span className="ml-auto flex shrink-0 items-center gap-2 text-[11px]">
                    <StatusPill status={p.status} />
                    <span className="wp-muted">{relTime(p.createdAt)}</span>
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2 text-[11px]">
                  <div className="flex-1">
                    <TriBar forN={p.forVotes} againstN={p.againstVotes} abstainN={p.abstainVotes} />
                  </div>
                  <span className="wp-mono wp-muted shrink-0">
                    <span className="wp-pos">{fmtInt(p.forVotes)}</span> /{' '}
                    <span className="wp-neg">{fmtInt(p.againstVotes)}</span> /{' '}
                    <span className="wp-mid">{fmtInt(p.abstainVotes)}</span>
                  </span>
                </div>
              </div>
            ))
          )}
        </Card>

        {autoVotes.length > 0 && <AutopilotLogCard compact votes={autoVotes} />}
      </div>

      <div className="grid content-start gap-3">
        <Card
          title={`Held nouns · ${fmtInt(profile.holdings?.count ?? nouns.length)}`}
          right={
            <button type="button" className="wp-link text-[11px]" onClick={() => onTab('nouns')}>
              detail →
            </button>
          }
        >
          {nouns.length === 0 ? (
            <Empty>Holds no Nouns right now.</Empty>
          ) : (
            <div className="grid grid-cols-4 gap-2 sm:grid-cols-5 lg:grid-cols-3">
              {nouns.slice(0, 12).map(n => (
                <NounLink key={String(n.nounId)} nounId={n.nounId}>
                  <NounSeedImage nounId={n.nounId} seed={n.seed} title={`Noun ${n.nounId}`} />
                </NounLink>
              ))}
            </div>
          )}
        </Card>

        {profile.voting != null && (
          <Card title="Voting profile">
            <TriBar
              forN={profile.voting.for}
              againstN={profile.voting.against}
              abstainN={profile.voting.abstain}
              height={8}
            />
            <div className="mt-2 grid grid-cols-3 gap-1 text-center text-[11px]">
              <div>
                <div className="wp-pos wp-mono text-sm font-bold">{fmtInt(profile.voting.for)}</div>
                <div className="wp-muted">for</div>
              </div>
              <div>
                <div className="wp-neg wp-mono text-sm font-bold">
                  {fmtInt(profile.voting.against)}
                </div>
                <div className="wp-muted">against</div>
              </div>
              <div>
                <div className="wp-mid wp-mono text-sm font-bold">
                  {fmtInt(profile.voting.abstain)}
                </div>
                <div className="wp-muted">abstain</div>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-3 text-[11px]">
              <Row
                k="with reason"
                v={`${fmtInt(profile.voting.withReason)} (${fmtPct(
                  num(profile.voting.total) > 0
                    ? (num(profile.voting.withReason) / num(profile.voting.total)) * 100
                    : null,
                )})`}
              />
              <Row k="participation" v={fmtPct(profile.voting.participationPct)} />
              <Row
                k="avg weight"
                v={
                  profile.voting.avgWeight != null ? num(profile.voting.avgWeight).toFixed(1) : '—'
                }
              />
              <Row k="streak" v={fmtInt(profile.voting.streakCurrent)} />
              <Row k="revotes" v={fmtInt(profile.voting.revotes)} />
              <Row k="first vote" v={fmtDate(profile.voting.firstVote)} />
            </div>
            {(profile.voting.byClient?.length ?? 0) > 0 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {profile.voting.byClient?.map(c => (
                  <Pill key={String(c.clientId)} title="votes by client">
                    <ClientBadge clientId={c.clientId} size={13} /> {fmtInt(c.count)}
                  </Pill>
                ))}
              </div>
            )}
          </Card>
        )}

        {hasV2 && v2 != null && (
          <Card title="NounV2">
            <div className="grid grid-cols-2 gap-x-3 text-[11px]">
              <Row k="votes" v={fmtInt(v2.votes)} />
              <Row k="for / against" v={`${fmtInt(v2.for)} / ${fmtInt(v2.against)}`} />
              <Row k="proposals" v={fmtInt(v2.proposalsAuthored)} />
              <Row k="auctions won" v={fmtInt(v2.auctionsWon)} />
              <Row k="bids" v={fmtInt(v2.bids)} />
              <Row k="settled" v={fmtInt(v2.settled)} />
            </div>
            <Link to="/v2" className="wp-link mt-2 inline-block text-[11px]">
              V2 auction →
            </Link>
          </Card>
        )}
      </div>
    </div>
  );
};

const Row: FC<{ k: string; v: string }> = ({ k, v }) => (
  <div className="flex justify-between gap-2 py-0.5">
    <span className="wp-muted">{k}</span>
    <span className="wp-mono">{v}</span>
  </div>
);

// ─── Votes ─────────────────────────────────────────────────────────────────

type VoteFilter = 'all' | 'for' | 'against' | 'abstain' | 'reason';

export const VotesTab: FC<{ profile: WalletProfile }> = ({ profile }) => {
  const [filter, setFilter] = useState<VoteFilter>('all');
  const all = profile.voting?.recent ?? [];
  const list = useMemo(() => {
    switch (filter) {
      case 'for':
        return all.filter(v => v.support === 1);
      case 'against':
        return all.filter(v => v.support === 0);
      case 'abstain':
        return all.filter(v => v.support === 2);
      case 'reason':
        return all.filter(v => typeof v.reason === 'string' && v.reason.trim().length > 0);
      default:
        return all;
    }
  }, [all, filter]);

  const aligned = all.filter(v => v.alignedWithOutcome === true).length;
  const judged = all.filter(v => v.alignedWithOutcome != null).length;

  const filters: { key: VoteFilter; label: string; n: number }[] = [
    { key: 'all', label: 'All', n: all.length },
    { key: 'for', label: 'For', n: all.filter(v => v.support === 1).length },
    { key: 'against', label: 'Against', n: all.filter(v => v.support === 0).length },
    { key: 'abstain', label: 'Abstain', n: all.filter(v => v.support === 2).length },
    {
      key: 'reason',
      label: 'With reason',
      n: all.filter(v => typeof v.reason === 'string' && v.reason.trim().length > 0).length,
    },
  ];

  return (
    <Card
      title={`Votes · ${fmtInt(profile.voting?.total ?? all.length)}`}
      right={
        judged > 0 ? (
          <span className="wp-muted text-[11px]">
            with outcome {fmtPct((aligned / judged) * 100)} of {judged}
          </span>
        ) : null
      }
    >
      <div className="mb-2 flex flex-wrap gap-1">
        {filters.map(f => (
          <button
            key={f.key}
            type="button"
            className={`wp-tab ${filter === f.key ? 'active' : ''}`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
            <span className="wp-tab-count">{f.n}</span>
          </button>
        ))}
      </div>
      {list.length === 0 ? (
        <Empty>Nothing here.</Empty>
      ) : (
        list.map(v => <VoteRow key={`${v.proposalId}-${v.txHash ?? ''}`} vote={v} />)
      )}
      {all.length > 0 && num(profile.voting?.total) > all.length && (
        <div className="wp-muted mt-2 text-[11px]">
          Showing the {all.length} most recent of {fmtInt(profile.voting?.total)}.
        </div>
      )}
    </Card>
  );
};

// ─── Proposals ─────────────────────────────────────────────────────────────

export const ProposalsTab: FC<{ profile: WalletProfile }> = ({ profile }) => {
  const authored = profile.proposals?.authored ?? [];
  const signed = profile.proposals?.signed ?? [];
  const p = profile.proposals;
  return (
    <div className="grid gap-3">
      <Card
        title={`Authored · ${authored.length}`}
        right={
          <span className="wp-muted text-[11px]">
            {p?.passRate != null && <>pass rate {fmtPct(p.passRate)} · </>}
            {p?.totalRequestedEth != null && <>asked {fmtEth(p.totalRequestedEth)}</>}
          </span>
        }
      >
        {authored.length === 0 ? (
          <Empty>No proposals authored.</Empty>
        ) : (
          authored.map(pr => (
            <div key={String(pr.id)} className="wp-row flex-col !items-stretch">
              <div className="flex items-center gap-2">
                <PropLink id={pr.id} title={pr.title} />
                <span className="ml-auto flex shrink-0 items-center gap-2 text-[11px]">
                  {pr.executed === true && <Pill tone="pos">executed</Pill>}
                  <StatusPill status={pr.status} />
                  <span className="wp-muted" title={fmtDate(pr.createdAt)}>
                    {relTime(pr.createdAt)}
                  </span>
                </span>
              </div>
              <div className="mt-1 flex items-center gap-2 text-[11px]">
                <div className="flex-1">
                  <TriBar
                    forN={pr.forVotes}
                    againstN={pr.againstVotes}
                    abstainN={pr.abstainVotes}
                  />
                </div>
                <span className="wp-mono shrink-0">
                  <span className="wp-pos">{fmtInt(pr.forVotes)}</span>
                  <span className="wp-muted"> / </span>
                  <span className="wp-neg">{fmtInt(pr.againstVotes)}</span>
                  <span className="wp-muted"> / </span>
                  <span className="wp-mid">{fmtInt(pr.abstainVotes)}</span>
                </span>
              </div>
            </div>
          ))
        )}
      </Card>
      <Card title={`Signed as sponsor · ${signed.length}`}>
        {signed.length === 0 ? (
          <Empty>No sponsor signatures on proposals.</Empty>
        ) : (
          signed.map(s => (
            <div key={String(s.id)} className="wp-row items-center">
              <PropLink id={s.id} title={s.title} />
              <span className="ml-auto shrink-0">
                <StatusPill status={s.status} />
              </span>
            </div>
          ))
        )}
      </Card>
    </div>
  );
};

// ─── Candidates ────────────────────────────────────────────────────────────

export const CandidatesTab: FC<{ profile: WalletProfile }> = ({ profile }) => {
  const c = profile.candidates;
  const authored = c?.authored ?? [];
  const sponsored = c?.sponsored ?? [];
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <Pill>candidate feedback {fmtInt(c?.feedbackGiven)}</Pill>
        <Pill>proposal feedback {fmtInt(c?.proposalFeedbackGiven)}</Pill>
      </div>
      <Card title={`Authored candidates · ${authored.length}`}>
        {authored.length === 0 ? (
          <Empty>No candidates authored.</Empty>
        ) : (
          authored.map(cd => (
            <div key={cd.id} className="wp-row items-center">
              <Link to={`/candidates/${encodeURIComponent(cd.id)}`} className="wp-link wp-ellipsis">
                {cd.title ?? cd.slug ?? cd.id}
              </Link>
              <span className="ml-auto flex shrink-0 items-center gap-2 text-[11px]">
                <span className="wp-muted">{fmtInt(cd.sponsorCount)} sponsors</span>
                {cd.promotedToProposalId != null && (
                  <Link to={`/vote/${cd.promotedToProposalId}`} className="wp-pill wp-pill-pos">
                    → prop #{cd.promotedToProposalId}
                  </Link>
                )}
                {cd.canceled === true && <Pill tone="neg">canceled</Pill>}
                <span className="wp-muted">{relTime(cd.createdAt)}</span>
              </span>
            </div>
          ))
        )}
      </Card>
      <Card title={`Sponsored · ${sponsored.length}`}>
        {sponsored.length === 0 ? (
          <Empty>No candidate sponsorships.</Empty>
        ) : (
          sponsored.map(sp => {
            const exp = sp.expirationTimestamp;
            const expired = exp != null && num(exp) > 0 && num(exp) * 1000 < Date.now();
            return (
              <div key={sp.candidateId} className="wp-row flex-col !items-stretch">
                <div className="flex items-center gap-2">
                  <Link
                    to={`/candidates/${encodeURIComponent(sp.candidateId)}`}
                    className="wp-link wp-ellipsis"
                  >
                    {sp.title ?? sp.candidateId}
                  </Link>
                  <span className="ml-auto flex shrink-0 items-center gap-2 text-[11px]">
                    {sp.canceled === true && <Pill tone="neg">canceled</Pill>}
                    {exp != null &&
                      (expired ? (
                        <Pill tone="mid">sig expired</Pill>
                      ) : (
                        <Pill tone="pos">sig live · {relTime(exp)}</Pill>
                      ))}
                    <span className="wp-muted">{relTime(sp.createdAt)}</span>
                  </span>
                </div>
                {typeof sp.reason === 'string' && sp.reason.trim().length > 0 && (
                  <div className="wp-reason">{sp.reason}</div>
                )}
              </div>
            );
          })
        )}
      </Card>
    </div>
  );
};
