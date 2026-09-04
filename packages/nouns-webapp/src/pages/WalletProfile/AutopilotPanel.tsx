/**
 * Autopilot — voting preferences the owner signs into the API, plus the AI's
 * per-proposal recommendations that the owner confirms with one click.
 *
 * noun.wtf never holds a key: the vote is cast from the connected wallet via
 * the governor's castRefundableVote(WithReason), same path as the terminal.
 */
import { FC, useEffect, useMemo, useState } from 'react';

import { Loader2Icon, SparklesIcon } from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { type Address } from 'viem';
import { useWriteContract } from 'wagmi';

import { NOUN_WTF_CLIENT_ID } from '@/config';
import { nounsGovernorAbi, nounsGovernorAddress } from '@/contracts';

import { useAutopilot, useSaveAutopilot } from './api';
import { fmtDate, isAddr, relTime, supportLabel } from './format';
import {
  type AutopilotPrefs,
  type AutopilotRecommendation,
  DEFAULT_PREFS,
  STANCE_KEYS,
  STANCE_LABELS,
  type StanceKey,
} from './types';
import { Bar, Card, Empty, Pill, Skeleton, SupportChip } from './ui';

const DISMISS_KEY = 'noun-wtf-autopilot-dismissed';

function readDismissed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(DISMISS_KEY);
    return new Set(raw != null ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function parseAddrList(s: string): string[] {
  return s
    .split(/[\s,]+/)
    .map(x => x.trim())
    .filter(x => x.length > 0);
}

const STANCE_HINT: Record<number, string> = {
  [-2]: 'fund much less',
  [-1]: 'fund less',
  0: 'neutral',
  1: 'fund more',
  2: 'fund much more',
};

// ─── Recommendation row ────────────────────────────────────────────────────

const RecommendationRow: FC<{
  rec: AutopilotRecommendation;
  onDismiss: () => void;
  onVoted: () => void;
}> = ({ rec, onDismiss, onVoted }) => {
  const { writeContractAsync, isPending } = useWriteContract();
  const support = rec.support;
  const confidence = Math.round(Math.max(0, Math.min(1, rec.confidence ?? 0)) * 100);
  const reason = typeof rec.reason === 'string' ? rec.reason.trim() : '';

  const vote = async () => {
    if (support == null) return;
    try {
      const pid = BigInt(rec.proposalId);
      const hash =
        reason.length > 0
          ? await writeContractAsync({
              abi: nounsGovernorAbi,
              address: nounsGovernorAddress[1] as Address,
              functionName: 'castRefundableVoteWithReason',
              args: [pid, support, reason, NOUN_WTF_CLIENT_ID],
            })
          : await writeContractAsync({
              abi: nounsGovernorAbi,
              address: nounsGovernorAddress[1] as Address,
              functionName: 'castRefundableVote',
              args: [pid, support, NOUN_WTF_CLIENT_ID],
            });
      toast.success(`Vote ${supportLabel(support)} on #${rec.proposalId} submitted`, {
        description: hash,
        duration: 6000,
      });
      onVoted();
    } catch (err) {
      const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
      toast.error(`Vote failed: ${msg.slice(0, 140)}`);
    }
  };

  return (
    <div className="wp-row flex-col !items-stretch">
      <div className="flex items-center gap-2 text-xs">
        <SupportChip support={support} />
        <Link to={`/vote/${rec.proposalId}`} className="wp-link wp-ellipsis">
          <span className="wp-muted">#{rec.proposalId}</span>{' '}
          {rec.title ?? `Proposal ${rec.proposalId}`}
        </Link>
        <span className="wp-muted ml-auto shrink-0 text-[11px]" title={fmtDate(rec.generatedAt)}>
          {relTime(rec.generatedAt)}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2 text-[11px]">
        <span className="wp-muted w-20 shrink-0">confidence</span>
        <div className="flex-1">
          <Bar pct={confidence} tone={confidence >= 75 ? 'pos' : 'accent'} />
        </div>
        <span className="wp-mono w-9 text-right">{confidence}%</span>
      </div>
      {reason.length > 0 && <div className="wp-reason">{reason}</div>}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {rec.alreadyVoted === true ? (
          <Pill tone="pos">already voted</Pill>
        ) : (
          <button
            type="button"
            className="wp-btn wp-btn-primary wp-btn-sm"
            disabled={support == null || isPending || rec.pending === true}
            onClick={() => void vote()}
          >
            {isPending ? <Loader2Icon size={12} className="animate-spin" /> : null}
            Vote {supportLabel(support)} as suggested
          </button>
        )}
        <button type="button" className="wp-btn wp-btn-sm" onClick={onDismiss}>
          Dismiss
        </button>
      </div>
    </div>
  );
};

// ─── Panel ─────────────────────────────────────────────────────────────────

export const AutopilotPanel: FC<{
  address: string | undefined;
  isOwner: boolean;
  enabledHint?: boolean;
}> = ({ address, isOwner, enabledHint }) => {
  const q = useAutopilot(address, isOwner);
  const { save, isPending: saving } = useSaveAutopilot(address);

  const [enabled, setEnabled] = useState(false);
  const [prefs, setPrefs] = useState<AutopilotPrefs>(DEFAULT_PREFS);
  const [blocked, setBlocked] = useState('');
  const [trusted, setTrusted] = useState('');
  const [dirty, setDirty] = useState(false);
  const [dismissed, setDismissed] = useState<Set<string>>(() => readDismissed());
  const [voted, setVoted] = useState<Set<string>>(new Set());

  // Hydrate the form from the server state once (or when it changes and the
  // form is clean).
  useEffect(() => {
    if (!q.data || dirty) return;
    // eslint-disable-next-line @eslint-react/hooks-extra/no-direct-set-state-in-use-effect
    setEnabled(q.data.enabled === true);
    const p = { ...DEFAULT_PREFS, ...(q.data.prefs ?? {}) };
    p.stances = { ...DEFAULT_PREFS.stances, ...(q.data.prefs?.stances ?? {}) };
    setPrefs(p);
    setBlocked(p.blockedProposers.join(', '));
    setTrusted(p.trustedProposers.join(', '));
  }, [q.data, dirty]);

  const recs = useMemo(
    () => (q.data?.recommendations ?? []).filter(r => !dismissed.has(String(r.proposalId))),
    [q.data, dismissed],
  );

  if (!isOwner) {
    return (
      <div className="wp-muted flex items-center gap-2 text-[11px]">
        <SparklesIcon size={12} />
        Autopilot: {enabledHint === true ? <span className="wp-pos">on</span> : 'off'}
        <span className="opacity-70">
          — only the wallet owner can see preferences and recommendations.
        </span>
      </div>
    );
  }

  const set = <K extends keyof AutopilotPrefs>(k: K, v: AutopilotPrefs[K]) => {
    setDirty(true);
    setPrefs(p => ({ ...p, [k]: v }));
  };
  const setStance = (k: StanceKey, v: number) => {
    setDirty(true);
    setPrefs(p => ({ ...p, stances: { ...p.stances, [k]: v } }));
  };

  const onSave = async () => {
    const next: AutopilotPrefs = {
      ...prefs,
      philosophy: prefs.philosophy.trim(),
      blockedProposers: parseAddrList(blocked).map(a => (isAddr(a) ? a.toLowerCase() : a)),
      trustedProposers: parseAddrList(trusted).map(a => (isAddr(a) ? a.toLowerCase() : a)),
    };
    try {
      await save(next, enabled);
      setDirty(false);
      toast.success(enabled ? 'Autopilot preferences saved' : 'Autopilot switched off');
    } catch (err) {
      const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
      toast.error(`Save failed: ${msg.slice(0, 140)}`);
    }
  };

  const dismiss = (id: string) => {
    setDismissed(prev => {
      const n = new Set(prev);
      n.add(id);
      try {
        window.localStorage.setItem(DISMISS_KEY, JSON.stringify(Array.from(n)));
      } catch {
        /* ignore */
      }
      return n;
    });
  };

  return (
    <div className="grid gap-3 lg:grid-cols-5">
      <Card
        className="lg:col-span-3"
        title={
          <span className="flex items-center gap-2">
            <SparklesIcon size={12} /> Autopilot
            {q.data?.updatedAt != null && (
              <span className="hidden normal-case opacity-60 sm:inline">
                · saved {relTime(q.data.updatedAt)}
              </span>
            )}
          </span>
        }
        right={
          <label className="flex cursor-pointer items-center gap-2 text-[11px]">
            <span className={enabled ? 'wp-pos' : 'wp-muted'}>{enabled ? 'ON' : 'OFF'}</span>
            <input
              type="checkbox"
              checked={enabled}
              onChange={e => {
                setDirty(true);
                setEnabled(e.target.checked);
              }}
              className="wp-slider h-4 w-4"
            />
          </label>
        }
      >
        {q.isLoading ? (
          <div className="grid gap-2">
            <Skeleton h={80} />
            <Skeleton />
            <Skeleton />
          </div>
        ) : (
          <div className="grid gap-3">
            <div>
              <div className="wp-h">Philosophy</div>
              <textarea
                className="wp-textarea"
                value={prefs.philosophy}
                placeholder="How should the DAO spend? What do you always back, what do you never back? Write it the way you would explain it to a new voter."
                onChange={e => set('philosophy', e.target.value)}
              />
            </div>

            <div>
              <div className="wp-h">Stances</div>
              <div className="grid gap-2 sm:grid-cols-2">
                {STANCE_KEYS.map(k => {
                  const v = prefs.stances[k] ?? 0;
                  return (
                    <div key={k} className="text-[11px]">
                      <div className="flex justify-between">
                        <span>{STANCE_LABELS[k]}</span>
                        <span
                          className={`wp-mono ${v > 0 ? 'wp-pos' : v < 0 ? 'wp-neg' : 'wp-muted'}`}
                        >
                          {v > 0 ? `+${v}` : v} · {STANCE_HINT[v] ?? ''}
                        </span>
                      </div>
                      <input
                        type="range"
                        min={-2}
                        max={2}
                        step={1}
                        value={v}
                        onChange={e => setStance(k, Number(e.target.value))}
                        className="wp-slider"
                        aria-label={STANCE_LABELS[k]}
                      />
                      <div className="wp-muted flex justify-between text-[9px] uppercase tracking-wide">
                        <span>fund less</span>
                        <span>fund more</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <div className="wp-h">Max ask (ETH)</div>
                <input
                  type="number"
                  min={0}
                  step="any"
                  className="wp-input"
                  placeholder="no cap"
                  value={prefs.maxAskEth ?? ''}
                  onChange={e =>
                    set('maxAskEth', e.target.value === '' ? null : Number(e.target.value))
                  }
                />
              </div>
              <div>
                <div className="wp-h">When unsure</div>
                <select
                  className="wp-select"
                  value={prefs.defaultWhenUnsure}
                  onChange={e =>
                    set('defaultWhenUnsure', e.target.value as AutopilotPrefs['defaultWhenUnsure'])
                  }
                >
                  <option value="abstain">abstain</option>
                  <option value="skip">skip (no recommendation)</option>
                  <option value="against">against</option>
                </select>
              </div>
              <div>
                <div className="wp-h">Reason style</div>
                <select
                  className="wp-select"
                  value={prefs.voteReasonStyle}
                  onChange={e =>
                    set('voteReasonStyle', e.target.value as AutopilotPrefs['voteReasonStyle'])
                  }
                >
                  <option value="none">none</option>
                  <option value="short">short (one line)</option>
                  <option value="full">full</option>
                </select>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <div className="wp-h">Blocked proposers</div>
                <input
                  className="wp-input"
                  placeholder="0x…, name.eth"
                  value={blocked}
                  onChange={e => {
                    setDirty(true);
                    setBlocked(e.target.value);
                  }}
                />
              </div>
              <div>
                <div className="wp-h">Trusted proposers</div>
                <input
                  className="wp-input"
                  placeholder="0x…, name.eth"
                  value={trusted}
                  onChange={e => {
                    setDirty(true);
                    setTrusted(e.target.value);
                  }}
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                className="wp-btn wp-btn-primary"
                disabled={saving || !address}
                onClick={() => void onSave()}
              >
                {saving ? <Loader2Icon size={12} className="animate-spin" /> : null}
                Save (sign)
              </button>
              {dirty && <span className="wp-muted text-[11px]">unsaved changes</span>}
              {q.isError && (
                <span className="wp-neg text-[11px]">
                  could not load saved prefs: {q.error.message}
                </span>
              )}
            </div>
            <p className="wp-muted m-0 text-[10px] leading-snug">
              noun.wtf can&apos;t vote from your wallet — Autopilot drafts, you confirm. Saving
              signs a message (no transaction, no gas) that binds these preferences to your address.
            </p>
          </div>
        )}
      </Card>

      <Card className="lg:col-span-2" title={`Recommendations · ${recs.length}`}>
        {q.isLoading && (
          <div className="grid gap-2">
            <Skeleton h={60} />
            <Skeleton h={60} />
          </div>
        )}
        {!q.isLoading && !enabled && recs.length === 0 && (
          <Empty>
            Switch Autopilot on and save — recommendations appear here for every active proposal.
          </Empty>
        )}
        {!q.isLoading && enabled && recs.length === 0 && (
          <Empty>No active proposals need your vote right now.</Empty>
        )}
        {recs.map(r => {
          const id = String(r.proposalId);
          return (
            <RecommendationRow
              key={id}
              rec={voted.has(id) ? { ...r, alreadyVoted: true } : r}
              onDismiss={() => dismiss(id)}
              onVoted={() => setVoted(prev => new Set(prev).add(id))}
            />
          );
        })}
        {recs.length > 0 && (
          <p className="wp-muted mb-0 mt-2 text-[10px] leading-snug">
            Each vote is a normal on-chain transaction from your connected wallet, cast through
            noun.wtf (client #{NOUN_WTF_CLIENT_ID}) with the drafted reason. Gas is refunded by the
            DAO.
          </p>
        )}
      </Card>
    </div>
  );
};
