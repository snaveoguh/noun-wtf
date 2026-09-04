/**
 * Autopilot — voting preferences the owner signs into the API, plus the AI's
 * per-proposal recommendations, for Nouns DAO and Lil Nouns DAO.
 *
 * Two modes:
 *  - Draft: noun.wtf drafts, the owner confirms each vote from their wallet
 *    (castRefundableVote(WithReason), same path as the terminal).
 *  - Auto: the owner turns their EOA into a MetaMask Smart Account (EIP-7702)
 *    and signs a scoped ERC-7710 delegation that lets the noun.wtf relayer
 *    call ONLY the governor's vote functions, with 0 ETH value, until an
 *    expiry / max-votes cap. noun.wtf still never holds a key.
 */
import { FC, ReactNode, useCallback, useEffect, useMemo, useState } from 'react';

import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangleIcon,
  CheckIcon,
  ExternalLinkIcon,
  Loader2Icon,
  SparklesIcon,
} from 'lucide-react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { type Address, type Hex } from 'viem';
import {
  useAccount,
  usePublicClient,
  useSendTransaction,
  useSignTypedData,
  useWriteContract,
} from 'wagmi';

import { NOUN_WTF_CLIENT_ID } from '@/config';
import { nounsGovernorAbi, nounsGovernorAddress } from '@/contracts';
import { LIL_NOUNS_GOVERNOR, LIL_NOUNS_GOVERNOR_ABI } from '@/lib/marketplace/governance';

import {
  readCachedDelegation,
  useAutopilot,
  useMarkOnchainDisabled,
  useRevokeDelegation,
  useSaveAutopilot,
  useSaveDelegation,
} from './api';
import { fmtDate, isAddr, relTime, shortAddr, supportLabel } from './format';
import {
  AUTOPILOT_DAO_LABEL,
  AUTOPILOT_DAOS,
  type AutopilotAutoVote,
  type AutopilotDao,
  type AutopilotDelegation,
  type AutopilotMode,
  type AutopilotPrefs,
  type AutopilotRecommendation,
  type AutopilotRelayer,
  DEFAULT_PREFS,
  STANCE_KEYS,
  STANCE_LABELS,
  type StanceKey,
} from './types';
import { Bar, Card, Empty, EtherscanTx, Pill, Skeleton, SupportChip } from './ui';
import {
  type BuildVoteDelegationResult,
  FRAMEWORK,
  GOVERNORS,
  loadVotePermit,
  parse7702Code,
} from './votePermitShim';
import { profileFixtureEnabled } from './walletProfileFixtures';

const DISMISS_KEY = 'noun-wtf-autopilot-dismissed';
const METAMASK_SMART_ACCOUNT_HELP =
  'https://support.metamask.io/configure/accounts/switch-to-or-revert-from-a-smart-account/';
const EXPIRY_OPTIONS = [30, 90, 180] as const;

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

const errMsg = (err: unknown) =>
  (err instanceof Error ? err.message.split('\n')[0] : String(err)).slice(0, 140);

const isUserRejection = (err: unknown) =>
  /rejected|denied|cancel/i.test(err instanceof Error ? err.message : String(err));

const normDao = (d: string | null | undefined): AutopilotDao =>
  d === 'lil-nouns' || d === 'lil' || d === 'lilnouns' ? 'lil-nouns' : 'nouns';

const propHref = (dao: AutopilotDao, id: number | string) =>
  dao === 'lil-nouns' ? `https://lilnouns.wtf/vote/${id}` : `/vote/${id}`;

// ─── Small shared bits ─────────────────────────────────────────────────────

const DaoPill: FC<{ dao: AutopilotDao | string | null | undefined }> = ({ dao }) => {
  const d = normDao(dao);
  return <Pill tone={d === 'lil-nouns' ? 'mid' : 'accent'}>{AUTOPILOT_DAO_LABEL[d]}</Pill>;
};

const PropRef: FC<{ dao: AutopilotDao; id: number | string; title?: string | null }> = ({
  dao,
  id,
  title,
}) => {
  const label = (
    <>
      <span className="wp-muted">#{id}</span> {title ?? `Proposal ${id}`}
    </>
  );
  if (dao === 'lil-nouns') {
    return (
      <a
        href={propHref(dao, id)}
        target="_blank"
        rel="noreferrer"
        className="wp-link wp-ellipsis"
        title="opens lilnouns.wtf"
      >
        {label}
      </a>
    );
  }
  return (
    <Link to={propHref(dao, id)} className="wp-link wp-ellipsis">
      {label}
    </Link>
  );
};

const StepNumber: FC<{ n: number; state: 'todo' | 'done' | 'warn' }> = ({ n, state }) => (
  <span className={`wp-step-n ${state}`}>
    {state === 'done' ? <CheckIcon size={12} /> : state === 'warn' ? '!' : n}
  </span>
);

const Step: FC<{
  n: number;
  state: 'todo' | 'done' | 'warn';
  title: string;
  children: ReactNode;
}> = ({ n, state, title, children }) => (
  <div className="wp-step">
    <StepNumber n={n} state={state} />
    <div className="min-w-0">
      <div className="mb-1 text-xs font-bold">{title}</div>
      <div className="text-[11px]">{children}</div>
    </div>
  </div>
);

// ─── Step 1: smart account detection ───────────────────────────────────────

function useSmartAccount(address: string | undefined) {
  const fixture = profileFixtureEnabled();
  const publicClient = usePublicClient({ chainId: 1 });
  const { connector } = useAccount();
  const connectorLabel = connector?.name ?? connector?.id ?? null;
  const isMetaMask =
    fixture ||
    /metamask/i.test(`${connector?.id ?? ''} ${connector?.name ?? ''}`) ||
    (typeof window !== 'undefined' &&
      connector?.id === 'injected' &&
      (window as { ethereum?: { isMetaMask?: boolean } }).ethereum?.isMetaMask === true);

  const code = useQuery({
    queryKey: ['eip7702-code', address?.toLowerCase(), fixture],
    queryFn: async () => {
      if (fixture) return `0xef0100${FRAMEWORK.metamask7702Delegator.slice(2)}` as Hex;
      if (publicClient == null || !address) return '0x' as Hex;
      const c = await publicClient.getCode({ address: address as Address });
      return c ?? ('0x' as Hex);
    },
    enabled: !!address && (fixture || publicClient != null),
    staleTime: 30_000,
    retry: 1,
  });

  const parsed = useMemo(() => parse7702Code(code.data), [code.data]);
  return {
    ...parsed,
    isMetaMask,
    connectorLabel: fixture ? 'MetaMask (fixture)' : connectorLabel,
    loading: code.isLoading,
    error: code.error,
    refresh: () => void code.refetch(),
  };
}

// ─── Step 2: grant per DAO ─────────────────────────────────────────────────

interface GrantDraft {
  days: (typeof EXPIRY_OPTIONS)[number];
  maxVotes: string;
}

const DAO_GOVERNOR: Record<AutopilotDao, (typeof GOVERNORS)['nouns' | 'lilNouns']> = {
  nouns: GOVERNORS.nouns,
  'lil-nouns': GOVERNORS.lilNouns,
};

const GrantRow: FC<{
  dao: AutopilotDao;
  address: string;
  relayer: AutopilotRelayer | null | undefined;
  ready: boolean;
  activeCount: number;
}> = ({ dao, address, relayer, ready, activeCount }) => {
  const fixture = profileFixtureEnabled();
  const [draft, setDraft] = useState<GrantDraft>({ days: 90, maxVotes: '' });
  const [built, setBuilt] = useState<BuildVoteDelegationResult | null>(null);
  const [building, setBuilding] = useState(false);
  const { signTypedDataAsync, isPending: signing } = useSignTypedData();
  const save = useSaveDelegation(address);

  const relayerAddr =
    typeof relayer?.address === 'string' && isAddr(relayer.address)
      ? (relayer.address as Address)
      : null;
  const maxVotes = draft.maxVotes.trim() === '' ? undefined : Math.max(1, Number(draft.maxVotes));
  const expiresAt = Math.floor(Date.now() / 1000) + draft.days * 86_400;

  const review = async () => {
    if (!relayerAddr) {
      toast.error('Relayer address not available yet — reload and try again.');
      return;
    }
    setBuilding(true);
    try {
      const vp = await loadVotePermit();
      const gov = DAO_GOVERNOR[dao];
      const args = {
        chainId: 1,
        governor: gov.address,
        governorKind: gov.kind,
        delegator: address as Address,
        redeemer: relayerAddr,
        expiresAt,
        maxVotes,
      };
      const res: BuildVoteDelegationResult = vp.buildVoteDelegation(args);
      setBuilt(res);
    } catch (err) {
      toast.error(`Could not build permission: ${errMsg(err)}`);
    } finally {
      setBuilding(false);
    }
  };

  const sign = async () => {
    if (!built) return;
    try {
      const vp = await loadVotePermit();
      let signature: Hex = '0x';
      if (!fixture) {
        signature = await signTypedDataAsync({
          domain: built.typedData.domain,
          types: built.typedData.types,
          primaryType: built.typedData.primaryType,
          message: built.typedData.message,
        } as Parameters<typeof signTypedDataAsync>[0]);
      }
      const signed = { ...built.delegation, signature };
      const serialized = vp.serializeDelegation(signed);
      const hash = vp.getDelegationHash(signed);
      await save.mutateAsync({
        dao,
        serialized,
        hash,
        expiresAt: built.summary.expiresAt,
        maxVotes: built.summary.maxVotes,
      });
      toast.success(`${AUTOPILOT_DAO_LABEL[dao]} vote permission granted`, {
        description: `expires ${fmtDate(built.summary.expiresAt)}${
          built.summary.maxVotes != null ? ` · max ${built.summary.maxVotes} votes` : ''
        }`,
        duration: 6000,
      });
      setBuilt(null);
    } catch (err) {
      if (isUserRejection(err)) toast('Signature cancelled — nothing was granted.');
      else toast.error(`Grant failed: ${errMsg(err)}`);
    }
  };

  const busy = building || signing || save.isPending;

  return (
    <div className="wp-row flex-col !items-stretch">
      <div className="flex flex-wrap items-center gap-2">
        <DaoPill dao={dao} />
        <span className="wp-mono wp-muted text-[10px]" title={DAO_GOVERNOR[dao].address}>
          governor {shortAddr(DAO_GOVERNOR[dao].address)}
        </span>
        {activeCount > 0 && <Pill tone="pos">{activeCount} active</Pill>}
        <span className="ml-auto flex flex-wrap items-center gap-2">
          <label className="wp-muted flex items-center gap-1 text-[10px]">
            expiry
            <select
              className="wp-select !w-auto !py-1 !text-[11px]"
              value={draft.days}
              onChange={e =>
                setDraft(d => ({ ...d, days: Number(e.target.value) as GrantDraft['days'] }))
              }
              disabled={busy}
            >
              {EXPIRY_OPTIONS.map(d => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </select>
          </label>
          <label className="wp-muted flex items-center gap-1 text-[10px]">
            max votes
            <input
              type="number"
              min={1}
              step={1}
              className="wp-input !w-20 !py-1 !text-[11px]"
              placeholder="∞"
              value={draft.maxVotes}
              onChange={e => setDraft(d => ({ ...d, maxVotes: e.target.value }))}
              disabled={busy}
            />
          </label>
          <button
            type="button"
            className="wp-btn wp-btn-primary wp-btn-sm"
            disabled={!ready || busy || built != null}
            onClick={() => void review()}
            title={ready ? undefined : 'Finish step 1 first'}
          >
            {building ? <Loader2Icon size={12} className="animate-spin" /> : null}
            Review &amp; sign
          </button>
        </span>
      </div>

      {built != null && (
        <div className="wp-sheet">
          <div className="mb-2 font-bold">What you are signing</div>
          <dl>
            <dt>governor</dt>
            <dd>
              {AUTOPILOT_DAO_LABEL[dao]} DAO ·{' '}
              <span className="wp-mono">{built.summary.governor}</span>
            </dd>
            <dt>allowed calls</dt>
            <dd className="wp-mono">
              {built.summary.allowedFunctions.length > 0
                ? built.summary.allowedFunctions.join(', ')
                : '—'}
            </dd>
            <dt>redeemer</dt>
            <dd className="wp-mono">{built.summary.redeemer} (noun.wtf relayer)</dd>
            <dt>expires</dt>
            <dd>
              {fmtDate(built.summary.expiresAt)} ({relTime(built.summary.expiresAt)})
            </dd>
            <dt>max votes</dt>
            <dd>{built.summary.maxVotes ?? 'unlimited until expiry'}</dd>
            <dt>value</dt>
            <dd>0 ETH — cannot move assets</dd>
            <dt>via</dt>
            <dd className="wp-mono">DelegationManager {FRAMEWORK.delegationManager}</dd>
          </dl>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="wp-btn wp-btn-primary wp-btn-sm"
              disabled={busy}
              onClick={() => void sign()}
            >
              {signing || save.isPending ? (
                <Loader2Icon size={12} className="animate-spin" />
              ) : null}
              Sign permission
            </button>
            <button
              type="button"
              className="wp-btn wp-btn-sm"
              disabled={busy}
              onClick={() => setBuilt(null)}
            >
              Cancel
            </button>
            <span className="wp-muted text-[10px]">
              Two signatures: the typed permission, then a plain message proving this wallet posted
              it. No transaction, no gas.
            </span>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Active delegations ────────────────────────────────────────────────────

const delegationTone = (status: string | undefined): 'pos' | 'neg' | 'mid' | undefined => {
  if (status === 'active') return 'pos';
  if (status === 'revoked' || status === 'expired') return 'neg';
  if (status === 'exhausted') return 'mid';
  return undefined;
};

const DelegationRow: FC<{ row: AutopilotDelegation; address: string }> = ({ row, address }) => {
  const fixture = profileFixtureEnabled();
  const { sendTransactionAsync, isPending: sending } = useSendTransaction();
  const revoke = useRevokeDelegation(address);
  const markDisabled = useMarkOnchainDisabled(address);
  const [confirm, setConfirm] = useState(false);

  const serialized = row.delegation ?? readCachedDelegation(row.hash);
  const status = row.status ?? 'active';
  const canRevoke = status === 'active' || status === 'exhausted';

  const doRevoke = async () => {
    let onchain: 'sent' | 'skipped' | 'failed' = 'skipped';
    if (serialized != null && row.onchainDisabled !== true) {
      try {
        const vp = await loadVotePermit();
        const call = vp.buildRevokeCall(vp.deserializeDelegation(serialized));
        if (!fixture) {
          const hash = await sendTransactionAsync({ to: call.to, data: call.data, chainId: 1 });
          toast.success('On-chain revoke sent', { description: hash, duration: 6000 });
        }
        markDisabled(row.id);
        onchain = 'sent';
      } catch (err) {
        onchain = 'failed';
        if (isUserRejection(err)) toast('On-chain revoke cancelled.');
        else toast.error(`On-chain revoke failed: ${errMsg(err)}`);
      }
    }
    try {
      await revoke.mutateAsync({ id: row.id });
      toast.success(
        onchain === 'sent'
          ? 'Permission revoked on-chain and with the relayer'
          : 'Relayer will no longer use this permission',
        {
          description:
            onchain === 'sent'
              ? undefined
              : 'The signed permission still exists on-chain. Send the revoke tx or turn off Smart Account in MetaMask to be certain.',
          duration: 8000,
        },
      );
      setConfirm(false);
    } catch (err) {
      if (isUserRejection(err)) toast('Signature cancelled.');
      else toast.error(`Could not tell the relayer: ${errMsg(err)}`);
    }
  };

  const busy = sending || revoke.isPending;

  return (
    <div className="wp-row flex-col !items-stretch">
      <div className="flex flex-wrap items-center gap-2 text-[11px]">
        <DaoPill dao={row.dao} />
        <Pill tone={delegationTone(status)}>{status}</Pill>
        {row.onchainDisabled === true && <Pill tone="neg">disabled on-chain</Pill>}
        <span className="wp-muted">
          expires <span className="wp-mono">{fmtDate(row.expiresAt)}</span> (
          {relTime(row.expiresAt)})
        </span>
        <span className="wp-muted">
          used <span className="wp-mono">{row.uses ?? 0}</span>
          {row.maxVotes != null ? <span className="wp-mono"> / {row.maxVotes}</span> : ' · no cap'}
        </span>
        {row.hash != null && (
          <span className="wp-mono wp-muted text-[10px]" title={row.hash}>
            {shortAddr(row.hash)}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {canRevoke && !confirm && (
            <button
              type="button"
              className="wp-btn wp-btn-danger wp-btn-sm"
              onClick={() => setConfirm(true)}
            >
              Revoke
            </button>
          )}
        </span>
      </div>
      {confirm && (
        <div className="wp-sheet">
          <div className="mb-1 font-bold">Revoke this permission</div>
          <p className="wp-muted m-0 mb-2">
            Two steps happen: (1) a transaction to DelegationManager that disables the signed
            permission on-chain, so nobody can redeem it again, and (2) a signed message telling the
            noun.wtf relayer to stop. Step 1 costs gas
            {serialized == null
              ? ' — unavailable here because the signed permission is not stored on this device; the relayer will still stop, and turning off Smart Account in MetaMask kills every permission at once.'
              : '.'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="wp-btn wp-btn-danger wp-btn-sm"
              disabled={busy}
              onClick={() => void doRevoke()}
            >
              {busy ? <Loader2Icon size={12} className="animate-spin" /> : null}
              {serialized != null && row.onchainDisabled !== true
                ? 'Send revoke tx + notify relayer'
                : 'Notify relayer'}
            </button>
            <button
              type="button"
              className="wp-btn wp-btn-sm"
              disabled={busy}
              onClick={() => setConfirm(false)}
            >
              Keep
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Auto-mode setup card ──────────────────────────────────────────────────

const AutoSetupCard: FC<{
  address: string;
  relayer: AutopilotRelayer | null | undefined;
  delegations: AutopilotDelegation[];
}> = ({ address, relayer, delegations }) => {
  const sa = useSmartAccount(address);
  const step1: 'todo' | 'done' | 'warn' = sa.isDelegated
    ? sa.isMetaMaskDelegator
      ? 'done'
      : 'warn'
    : sa.isMetaMask
      ? 'todo'
      : 'warn';
  const active = delegations.filter(d => (d.status ?? 'active') === 'active');
  const activeByDao = (dao: AutopilotDao) => active.filter(d => normDao(d.dao) === dao).length;
  const relayerBalance = typeof relayer?.balanceEth === 'number' ? relayer.balanceEth : null;
  const relayerLow = relayerBalance != null && relayerBalance < 0.01;
  const relayerAddr = typeof relayer?.address === 'string' ? relayer.address : null;

  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          Auto-vote setup
          {active.length > 0 && (
            <span className="wp-pos normal-case">· {active.length} active permission(s)</span>
          )}
        </span>
      }
    >
      <p className="wp-muted m-0 mb-1 text-[11px] leading-snug">
        Votes are cast from your address by the noun.wtf relayer, only through the scoped permission
        you signed. It can&apos;t move nouns or ETH. Revoke anytime.
      </p>

      <Step n={1} state={step1} title="Smart account">
        {sa.loading ? (
          <Skeleton />
        ) : sa.isDelegated && sa.isMetaMaskDelegator ? (
          <span className="wp-pos">
            <span className="wp-mono">{shortAddr(address)}</span> is a MetaMask Smart Account
            (EIP-7702 → <span className="wp-mono">{shortAddr(sa.implementation)}</span>).
          </span>
        ) : sa.isDelegated ? (
          <span className="wp-neg">
            This address is delegated to <span className="wp-mono">{sa.implementation}</span>, which
            is not MetaMask&apos;s delegator — unsupported. Revert it in the wallet that set it,
            then switch to a MetaMask Smart Account.
          </span>
        ) : (
          <>
            Not a smart account yet. In MetaMask open the account menu → Account details → Smart
            account, turn it on for Ethereum, then{' '}
            <button type="button" className="wp-link" onClick={sa.refresh}>
              refresh
            </button>
            .{' '}
            <a
              href={METAMASK_SMART_ACCOUNT_HELP}
              target="_blank"
              rel="noreferrer"
              className="wp-link inline-flex items-center gap-1"
            >
              MetaMask guide <ExternalLinkIcon size={10} />
            </a>
          </>
        )}
        {!sa.isMetaMask && (
          <div className="wp-neg mt-1 flex items-start gap-1">
            <AlertTriangleIcon size={12} className="mt-0.5 shrink-0" />
            <span>
              Connected via {sa.connectorLabel ?? 'a non-MetaMask wallet'}. Only MetaMask smart
              accounts can grant this today. Nouns in a Safe: use Zodiac Roles instead (guide coming
              to /docs).
            </span>
          </div>
        )}
        {sa.error != null && (
          <div className="wp-muted mt-1">could not read account code: {errMsg(sa.error)}</div>
        )}
      </Step>

      <Step n={2} state={active.length > 0 ? 'done' : 'todo'} title="Grant vote permission">
        <div className="wp-muted mb-1">
          One permission per DAO. Each one allows the relayer to call only the governor&apos;s
          <span className="wp-mono"> castRefundableVote*</span> functions from your address.
        </div>
        {AUTOPILOT_DAOS.map(dao => (
          <GrantRow
            key={dao}
            dao={dao}
            address={address}
            relayer={relayer}
            ready={step1 === 'done'}
            activeCount={activeByDao(dao)}
          />
        ))}
      </Step>

      <Step
        n={3}
        state={relayer?.enabled === true && !relayerLow ? 'done' : relayerLow ? 'warn' : 'todo'}
        title="Relayer"
      >
        {relayerAddr != null ? (
          <span>
            <span className="wp-mono" title={relayerAddr}>
              {relayerAddr}
            </span>{' '}
            · balance{' '}
            <span className={`wp-mono ${relayerLow ? 'wp-neg' : ''}`}>
              {relayerBalance != null ? `${relayerBalance.toFixed(4)} ETH` : '—'}
            </span>
            {relayer?.enabled === false && <Pill tone="neg">paused</Pill>}
          </span>
        ) : (
          <span className="wp-muted">relayer address not published by the API yet</span>
        )}
        {relayerLow && (
          <div className="wp-muted mt-1">
            The relayer needs ETH to pay for redemptions (the DAO refunds most of it). Votes pause
            while it is empty.
          </div>
        )}
      </Step>

      {delegations.length > 0 && (
        <div className="mt-2">
          <div className="wp-h">Permissions</div>
          {delegations.map(d => (
            <DelegationRow key={d.id} row={d} address={address} />
          ))}
        </div>
      )}
      <p className="wp-muted m-0 mt-2 text-[10px] leading-snug">
        Nuclear option: turn off Smart Account in MetaMask (same screen as step 1). That reverts the
        address to a plain account and every permission stops working at once.
      </p>
    </Card>
  );
};

// ─── Autopilot log ─────────────────────────────────────────────────────────

const autoVoteTone = (s: string | undefined): 'pos' | 'neg' | 'mid' | undefined =>
  s === 'confirmed' ? 'pos' : s === 'failed' ? 'neg' : s === 'sent' ? 'mid' : undefined;

/** Read-only summary rows — used on the Overview tab for everyone. */
export const AutopilotLogCard: FC<{
  votes: AutopilotAutoVote[];
  compact?: boolean;
  title?: ReactNode;
}> = ({ votes, compact = false, title = 'Autopilot log' }) => {
  if (compact) {
    return (
      <Card title={title}>
        {votes.length === 0 ? (
          <Empty>No auto-cast votes yet.</Empty>
        ) : (
          votes.slice(0, 5).map(v => {
            const dao = normDao(v.dao);
            return (
              <div key={v.id} className="wp-row !py-1.5 text-[11px]">
                <span className="wp-ellipsis flex-1">
                  <SparklesIcon size={10} className="mr-1 inline" />
                  Autopilot cast <b>{supportLabel(v.support)}</b> on{' '}
                  <PropRef dao={dao} id={v.proposalId} title={v.title} />
                  {dao === 'lil-nouns' && <span className="wp-muted"> (Lil)</span>}
                </span>
                {v.status === 'failed' && <Pill tone="neg">failed</Pill>}
                <span className="wp-muted shrink-0" title={fmtDate(v.castAt)}>
                  {relTime(v.castAt)}
                </span>
                <EtherscanTx hash={v.txHash} />
              </div>
            );
          })
        )}
      </Card>
    );
  }
  return (
    <Card title={title}>
      {votes.length === 0 ? (
        <Empty>Nothing cast yet. Rows appear here as the relayer votes.</Empty>
      ) : (
        <div className="wp-table-wrap">
          <table className="wp-table">
            <thead>
              <tr>
                <th>DAO</th>
                <th>Proposal</th>
                <th>Vote</th>
                <th>Reason</th>
                <th>Tx</th>
                <th>Status</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {votes.map(v => {
                const dao = normDao(v.dao);
                const reason = typeof v.reason === 'string' ? v.reason.trim() : '';
                return (
                  <tr key={v.id}>
                    <td>
                      <DaoPill dao={dao} />
                    </td>
                    <td className="max-w-[260px]">
                      <PropRef dao={dao} id={v.proposalId} title={v.title} />
                    </td>
                    <td>
                      <SupportChip support={v.support} />
                    </td>
                    <td className="wp-muted max-w-[320px]" title={reason}>
                      <span className="line-clamp-2">{reason.length > 0 ? reason : '—'}</span>
                    </td>
                    <td>
                      <EtherscanTx hash={v.txHash} />
                    </td>
                    <td>
                      <Pill tone={autoVoteTone(v.status)}>{v.status ?? '—'}</Pill>
                      {typeof v.error === 'string' && v.error.length > 0 && (
                        <div className="wp-neg mt-1 max-w-[240px] text-[10px]" title={v.error}>
                          {v.error.slice(0, 120)}
                        </div>
                      )}
                    </td>
                    <td className="wp-muted whitespace-nowrap" title={fmtDate(v.castAt)}>
                      {relTime(v.castAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
};

// ─── Recommendation row ────────────────────────────────────────────────────

const RecommendationRow: FC<{
  rec: AutopilotRecommendation;
  prefs: AutopilotPrefs;
  enabled: boolean;
  onDismiss: () => void;
  onVoted: () => void;
}> = ({ rec, prefs, enabled, onDismiss, onVoted }) => {
  const { writeContractAsync, isPending } = useWriteContract();
  const dao = normDao(rec.dao);
  const support = rec.support;
  const confidence = Math.round(Math.max(0, Math.min(1, rec.confidence ?? 0)) * 100);
  const reason = typeof rec.reason === 'string' ? rec.reason.trim() : '';

  const willAutoCast =
    enabled &&
    prefs.mode === 'auto' &&
    prefs.daos.includes(dao) &&
    (rec.confidence ?? 0) >= prefs.minConfidence &&
    (!prefs.autoVoteOnlyWithReason || reason.length > 0) &&
    support != null;

  const vote = async () => {
    if (support == null) return;
    try {
      const pid = BigInt(rec.proposalId);
      let hash: string;
      if (dao === 'lil-nouns') {
        // Lil Nouns governor: same refundable vote functions, no clientId arg.
        hash =
          reason.length > 0
            ? await writeContractAsync({
                abi: LIL_NOUNS_GOVERNOR_ABI,
                address: LIL_NOUNS_GOVERNOR,
                functionName: 'castRefundableVoteWithReason',
                args: [pid, support, reason],
              })
            : await writeContractAsync({
                abi: LIL_NOUNS_GOVERNOR_ABI,
                address: LIL_NOUNS_GOVERNOR,
                functionName: 'castRefundableVote',
                args: [pid, support],
              });
      } else {
        hash =
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
      }
      toast.success(
        `Vote ${supportLabel(support)} on ${AUTOPILOT_DAO_LABEL[dao]} #${rec.proposalId} submitted`,
        { description: hash, duration: 6000 },
      );
      onVoted();
    } catch (err) {
      if (isUserRejection(err)) toast('Vote cancelled.');
      else toast.error(`Vote failed: ${errMsg(err)}`);
    }
  };

  return (
    <div className="wp-row flex-col !items-stretch">
      <div className="flex items-center gap-2 text-xs">
        <DaoPill dao={dao} />
        <SupportChip support={support} />
        <PropRef dao={dao} id={rec.proposalId} title={rec.title} />
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
          <>
            <button
              type="button"
              className="wp-btn wp-btn-primary wp-btn-sm"
              disabled={support == null || isPending || rec.pending === true}
              onClick={() => void vote()}
            >
              {isPending ? <Loader2Icon size={12} className="animate-spin" /> : null}
              Vote {supportLabel(support)} as suggested
            </button>
            {prefs.mode === 'auto' &&
              enabled &&
              (willAutoCast ? (
                <Pill tone="accent" title="the relayer casts this unless you vote or dismiss first">
                  <SparklesIcon size={10} /> auto-casts in ~{prefs.autoVoteDelayHours}h
                </Pill>
              ) : (
                <Pill title="below your auto-vote threshold or DAO not enabled">draft only</Pill>
              ))}
          </>
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
    if (!Array.isArray(p.daos)) p.daos = [...DEFAULT_PREFS.daos];
    setPrefs(p);
    setBlocked(p.blockedProposers.join(', '));
    setTrusted(p.trustedProposers.join(', '));
  }, [q.data, dirty]);

  const recs = useMemo(
    () =>
      (q.data?.recommendations ?? []).filter(
        r => !dismissed.has(`${normDao(r.dao)}:${String(r.proposalId)}`),
      ),
    [q.data, dismissed],
  );
  const recsByDao = useMemo(
    () =>
      AUTOPILOT_DAOS.map(dao => ({ dao, rows: recs.filter(r => normDao(r.dao) === dao) })).filter(
        g => g.rows.length > 0,
      ),
    [recs],
  );
  const delegations = q.data?.delegations ?? [];
  const autoVotes = q.data?.autoVotes ?? [];

  const set = useCallback(<K extends keyof AutopilotPrefs>(k: K, v: AutopilotPrefs[K]) => {
    setDirty(true);
    setPrefs(p => ({ ...p, [k]: v }));
  }, []);

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

  const setStance = (k: StanceKey, v: number) => {
    setDirty(true);
    setPrefs(p => ({ ...p, stances: { ...p.stances, [k]: v } }));
  };
  const toggleDao = (dao: AutopilotDao, on: boolean) => {
    const next = on ? Array.from(new Set([...prefs.daos, dao])) : prefs.daos.filter(d => d !== dao);
    set('daos', next);
  };

  const onSave = async () => {
    const next: AutopilotPrefs = {
      ...prefs,
      philosophy: prefs.philosophy.trim(),
      blockedProposers: parseAddrList(blocked).map(a => (isAddr(a) ? a.toLowerCase() : a)),
      trustedProposers: parseAddrList(trusted).map(a => (isAddr(a) ? a.toLowerCase() : a)),
      minConfidence: Math.max(0, Math.min(1, prefs.minConfidence)),
      autoVoteDelayHours: Math.max(0, prefs.autoVoteDelayHours),
    };
    try {
      await save(next, enabled);
      setDirty(false);
      toast.success(
        enabled
          ? `Autopilot saved · ${next.mode === 'auto' ? 'auto-vote' : 'draft'} mode`
          : 'Autopilot switched off',
      );
    } catch (err) {
      if (isUserRejection(err)) toast('Signature cancelled — nothing saved.');
      else toast.error(`Save failed: ${errMsg(err)}`);
    }
  };

  const dismiss = (key: string) => {
    setDismissed(prev => {
      const n = new Set(prev);
      n.add(key);
      try {
        window.localStorage.setItem(DISMISS_KEY, JSON.stringify(Array.from(n)));
      } catch {
        /* ignore */
      }
      return n;
    });
  };

  const mode: AutopilotMode = prefs.mode === 'auto' ? 'auto' : 'draft';
  const saveButton = (
    <button
      type="button"
      className="wp-btn wp-btn-primary"
      disabled={saving || !address}
      onClick={() => void onSave()}
    >
      {saving ? <Loader2Icon size={12} className="animate-spin" /> : null}
      Save (sign)
    </button>
  );

  return (
    <div className="grid gap-3">
      <Card
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
          <Skeleton h={40} />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <div className="wp-seg" role="tablist" aria-label="Autopilot mode">
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'draft'}
                className={mode === 'draft' ? 'active' : ''}
                onClick={() => set('mode', 'draft')}
              >
                Draft
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={mode === 'auto'}
                className={mode === 'auto' ? 'active' : ''}
                onClick={() => set('mode', 'auto')}
              >
                Auto
              </button>
            </div>
            <span className="wp-muted text-[11px] leading-snug">
              {mode === 'draft'
                ? 'noun.wtf drafts a vote for every active proposal; you confirm each one from your wallet.'
                : 'Votes are cast from your address by the noun.wtf relayer, only through the scoped permission you signed. It can’t move nouns or ETH. Revoke anytime.'}
            </span>
            {dirty && (
              <span className="ml-auto flex items-center gap-2">
                <span className="wp-muted text-[11px]">unsaved</span>
                {saveButton}
              </span>
            )}
          </div>
        )}
      </Card>

      {mode === 'auto' && address != null && !q.isLoading && (
        <AutoSetupCard address={address} relayer={q.data?.relayer} delegations={delegations} />
      )}

      <div className="grid gap-3 lg:grid-cols-5">
        <Card className="lg:col-span-3" title="Preferences">
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
                      set(
                        'defaultWhenUnsure',
                        e.target.value as AutopilotPrefs['defaultWhenUnsure'],
                      )
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

              {mode === 'auto' && (
                <div
                  className="grid gap-3 border-t pt-3"
                  style={{ borderColor: 'var(--theme-border)' }}
                >
                  <div className="wp-h !mb-0">Auto-vote rules</div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <div className="wp-muted mb-1 text-[11px]">DAOs to auto-vote</div>
                      <div className="flex flex-wrap gap-3">
                        {AUTOPILOT_DAOS.map(dao => (
                          <label
                            key={dao}
                            className="flex cursor-pointer items-center gap-2 text-[11px]"
                          >
                            <input
                              type="checkbox"
                              className="wp-checkbox"
                              checked={prefs.daos.includes(dao)}
                              onChange={e => toggleDao(dao, e.target.checked)}
                            />
                            {AUTOPILOT_DAO_LABEL[dao]}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="wp-muted mb-1 flex justify-between text-[11px]">
                        <span>Min confidence</span>
                        <span className="wp-mono">{Math.round(prefs.minConfidence * 100)}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={prefs.minConfidence}
                        onChange={e => set('minConfidence', Number(e.target.value))}
                        className="wp-slider"
                        aria-label="Minimum confidence to auto-vote"
                      />
                      <div className="wp-muted text-[9px] uppercase tracking-wide">
                        below this → draft only
                      </div>
                    </div>
                    <div>
                      <div className="wp-muted mb-1 text-[11px]">Delay before casting (hours)</div>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        className="wp-input"
                        value={prefs.autoVoteDelayHours}
                        onChange={e => set('autoVoteDelayHours', Number(e.target.value))}
                      />
                      <div className="wp-muted mt-1 text-[10px]">
                        your window to veto a draft before it is cast
                      </div>
                    </div>
                    <label className="flex cursor-pointer items-center gap-2 self-center text-[11px]">
                      <input
                        type="checkbox"
                        className="wp-checkbox"
                        checked={prefs.autoVoteOnlyWithReason}
                        onChange={e => set('autoVoteOnlyWithReason', e.target.checked)}
                      />
                      Only cast when a reason was drafted
                    </label>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                {saveButton}
                {dirty && <span className="wp-muted text-[11px]">unsaved changes</span>}
                {q.isError && (
                  <span className="wp-neg text-[11px]">
                    could not load saved prefs: {q.error.message}
                  </span>
                )}
              </div>
              <p className="wp-muted m-0 text-[10px] leading-snug">
                {mode === 'draft'
                  ? "noun.wtf can't vote from your wallet in draft mode — it drafts, you confirm. "
                  : 'In auto mode the relayer casts only what passes these rules, inside the permission you signed. '}
                Saving signs a message (no transaction, no gas) that binds these preferences to your
                address.
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
          {recsByDao.map(g => (
            <div key={g.dao} className="mb-2">
              {recsByDao.length > 1 && (
                <div className="wp-h flex items-center gap-2">
                  {AUTOPILOT_DAO_LABEL[g.dao]} · {g.rows.length}
                </div>
              )}
              {g.rows.map(r => {
                const key = `${g.dao}:${String(r.proposalId)}`;
                return (
                  <RecommendationRow
                    key={key}
                    rec={voted.has(key) ? { ...r, alreadyVoted: true } : r}
                    prefs={prefs}
                    enabled={enabled}
                    onDismiss={() => dismiss(key)}
                    onVoted={() => setVoted(prev => new Set(prev).add(key))}
                  />
                );
              })}
            </div>
          ))}
          {recs.length > 0 && (
            <p className="wp-muted mb-0 mt-2 text-[10px] leading-snug">
              &quot;Vote as suggested&quot; is a normal on-chain transaction from your connected
              wallet — Nouns via noun.wtf (client #{NOUN_WTF_CLIENT_ID}), Lil Nouns via its own
              governor. Gas is refunded by the DAO.
            </p>
          )}
        </Card>
      </div>

      {(mode === 'auto' || autoVotes.length > 0) && !q.isLoading && (
        <AutopilotLogCard
          votes={autoVotes}
          title={
            <span>
              Autopilot log
              {autoVotes.length > 0 && (
                <span className="normal-case opacity-60"> · last {autoVotes.length}</span>
              )}
            </span>
          }
        />
      )}
    </div>
  );
};
