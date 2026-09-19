import type { Hex } from '@/utils/types';

import { type CSSProperties, useCallback, useEffect, useMemo, useState } from 'react';

import { i18n } from '@lingui/core';
import { filter } from 'remeda';
import { toast } from 'sonner';
import { useAccount } from 'wagmi';

import ProposalActionModal from '@/components/ProposalActionsModal';
import ProposalEditor from '@/components/ProposalEditor';
import ProposalTransactions from '@/components/ProposalTransactions';
import config, { NOUN_WTF_CLIENT_ID } from '@/config';
import { nounsLegacyTreasuryAddress, nounsTokenBuyerAddress } from '@/contracts';
import { buildEtherscanHoldingsLink } from '@/utils/etherscan';
import { useEthNeeded } from '@/utils/tokenBuyerContractUtils/tokenBuyer';
import { defaultChain } from '@/wagmi';
import {
  ProposalState,
  ProposalTransaction,
  useIsDaoGteV3,
  useProposal,
  useProposalCount,
  useProposalThreshold,
  usePropose,
  useProposeOnTimelockV1,
} from '@/wrappers/nounsDao';
import { useUserVotes } from '@/wrappers/nounToken';

import {
  DRAFT_FONT_GROUPS,
  DRAFT_FONTS,
  ensureDraftFontLoaded,
  getDraftFont,
  loadDraftFontId,
  saveDraftFontId,
} from './draftFonts';
import classes from './GameShell.module.css';

export interface ProposalDraftPanelProps {
  initialTitle?: string;
  initialBody?: string;
  initialTransactions?: ProposalTransaction[];
  /** Called after the propose() tx successfully lands. Use to close a host window. */
  onProposeSuccess?: () => void;
}

/**
 * Body of the game-themed proposal builder, lifted out of `GameCreateProposal`
 * so it can be mounted in two places:
 *   1. The page route (`GameCreateProposal` wraps this in `<GameShell>` and a
 *      back-bar header).
 *   2. A floating mini-window over the terminal feed (the agent-draft flow),
 *      seeded with `initialTitle` / `initialBody` / `initialTransactions`.
 *
 * Behaviour matches `pages/CreateProposal/index.tsx` field-for-field — same
 * wagmi hooks, same submit shape, same TokenBuyer top-up logic. Only the
 * surrounding chrome is host-specific.
 */
export default function ProposalDraftPanel({
  initialTitle = '',
  initialBody = '',
  initialTransactions,
  onProposeSuccess,
}: ProposalDraftPanelProps) {
  const [proposalTransactions, setProposalTransactions] = useState<ProposalTransaction[]>(
    () => initialTransactions ?? [],
  );
  const [titleValue, setTitleValue] = useState(initialTitle);
  const [bodyValue, setBodyValue] = useState(initialBody);
  const [totalUSDCPayment, setTotalUSDCPayment] = useState<number>(0);
  const [tokenBuyerTopUpEth, setTokenBuyerTopUpETH] = useState<string>('0');
  const [showTransactionFormModal, setShowTransactionFormModal] = useState(false);
  const [isProposePending, setProposePending] = useState(false);
  const [isProposeOnV1, setIsProposeOnV1] = useState(false);
  const [isV1OptionVisible, setIsV1OptionVisible] = useState(false);
  const [previousProposalId, setPreviousProposalId] = useState<number | undefined>(undefined);

  // Window font — see draftFonts.ts. The choice is
  // remembered across windows and page loads. Defaults to Figtree. `font` is a stable reference
  // from the registry array, so it's a safe effect dependency.
  const [fontId, setFontId] = useState<string>(() => loadDraftFontId());
  const font = getDraftFont(fontId);
  useEffect(() => {
    ensureDraftFontLoaded(font);
    saveDraftFontId(font.id);
  }, [font]);
  const fontScopeStyle = {
    '--draft-font': font.stack,
    '--draft-transform': font.uppercase === true ? 'uppercase' : 'none',
  } as CSSProperties;

  const latestProposalId = useProposalCount();
  const latestProposal = useProposal(latestProposalId ?? 0);
  const availableVotes = useUserVotes();
  const proposalThreshold = useProposalThreshold();
  const { address: account } = useAccount();
  const { propose, proposeState } = usePropose();
  const { proposeOnTimelockV1, proposeOnTimelockV1State } = useProposeOnTimelockV1();
  const isDaoGteV3 = useIsDaoGteV3();

  const chainId = defaultChain.id;
  const ethNeeded = useEthNeeded(
    nounsTokenBuyerAddress[chainId] ?? '',
    totalUSDCPayment,
    nounsTokenBuyerAddress[chainId] == undefined || totalUSDCPayment === 0,
  );
  const daoEtherscanLink = buildEtherscanHoldingsLink(nounsLegacyTreasuryAddress[chainId]);

  const handleAddProposalAction = useCallback(
    (transactions: ProposalTransaction | ProposalTransaction[]) => {
      const transactionsArray = Array.isArray(transactions) ? transactions : [transactions];
      transactionsArray.forEach(transaction => {
        if (!transaction.address.startsWith('0x')) {
          transaction.address = `0x${transaction.address}`;
        }
        if (!transaction.calldata.startsWith('0x')) {
          transaction.calldata = `0x${transaction.calldata}`;
        }
        if (transaction.usdcValue !== undefined && transaction.usdcValue !== 0) {
          setTotalUSDCPayment(totalUSDCPayment + transaction.usdcValue);
        }
      });
      setProposalTransactions([...proposalTransactions, ...transactionsArray]);
      setShowTransactionFormModal(false);
    },
    [proposalTransactions, totalUSDCPayment],
  );

  const handleRemoveProposalAction = useCallback(
    (index: number) => {
      setTotalUSDCPayment(totalUSDCPayment - (proposalTransactions[index].usdcValue ?? 0));
      setProposalTransactions(proposalTransactions.filter((_, i) => i !== index));
    },
    [proposalTransactions, totalUSDCPayment],
  );

  useEffect(() => {
    if (
      latestProposalId !== undefined &&
      (previousProposalId === undefined || previousProposalId === 0)
    ) {
      setPreviousProposalId(latestProposalId);
    }
  }, [latestProposalId, previousProposalId]);

  useEffect(() => {
    if (ethNeeded !== undefined && ethNeeded !== tokenBuyerTopUpEth && totalUSDCPayment > 0) {
      const hasTokenBuyerTopUp =
        filter(
          proposalTransactions,
          txn => txn.address.toLowerCase() === nounsTokenBuyerAddress[chainId].toLowerCase(),
        ).length > 0;

      if (Number(ethNeeded) > 0 && !hasTokenBuyerTopUp) {
        handleAddProposalAction({
          address: nounsTokenBuyerAddress[chainId],
          value: BigInt(ethNeeded ?? 0),
          calldata: '0x' as Hex,
          signature: '',
        });
      } else if (Number(ethNeeded) > 0) {
        const indexOfTokenBuyerTopUp =
          proposalTransactions
            .map((txn, index: number) =>
              txn.address === nounsTokenBuyerAddress[chainId] ? index : -1,
            )
            .filter(n => n >= 0) ?? new Array<number>();

        const txns = proposalTransactions;
        if (indexOfTokenBuyerTopUp.length > 0) {
          txns[indexOfTokenBuyerTopUp[0]].value = BigInt(ethNeeded);
          setProposalTransactions(txns);
        }
      }

      setTokenBuyerTopUpETH(ethNeeded ?? '0');
    }
  }, [
    ethNeeded,
    handleAddProposalAction,
    proposalTransactions,
    tokenBuyerTopUpEth,
    totalUSDCPayment,
    chainId,
  ]);

  const isFormInvalid = useMemo(
    () => !proposalTransactions.length || titleValue === '' || bodyValue === '',
    [proposalTransactions, titleValue, bodyValue],
  );

  // Explicit nullish/zero checks keep the original truthiness semantics
  // (a 0 threshold or 0 votes reads as "not enough") while satisfying lint.
  const hasEnoughVote =
    availableVotes != null &&
    availableVotes !== 0 &&
    proposalThreshold != null &&
    proposalThreshold !== 0 &&
    availableVotes > proposalThreshold;

  const hasActiveOrPendingProposal =
    (latestProposal?.status === ProposalState.ACTIVE ||
      latestProposal?.status === ProposalState.PENDING) &&
    latestProposal.proposer === account;

  const handleCreateProposal = async () => {
    if (!proposalTransactions?.length) return;
    if (isProposeOnV1) {
      await proposeOnTimelockV1({
        args: [
          proposalTransactions.map(({ address }) => address),
          proposalTransactions.map(({ value }) => value ?? 0n),
          proposalTransactions.map(({ signature }) => signature),
          proposalTransactions.map(({ calldata }) => calldata),
          `# ${titleValue}\n\n${bodyValue}`,
          NOUN_WTF_CLIENT_ID,
        ],
      });
    } else {
      await propose({
        args: [
          proposalTransactions.map(({ address }) => address),
          proposalTransactions.map(({ value }) => value ?? 0n),
          proposalTransactions.map(({ signature }) => signature),
          proposalTransactions.map(({ calldata }) => calldata),
          `# ${titleValue}\n\n${bodyValue}`,
          NOUN_WTF_CLIENT_ID,
        ],
      });
    }
  };

  const handleAddProposalState = useCallback(
    ({ errorMessage, status }: { status: string; errorMessage?: string }) => {
      switch (status) {
        case 'None':
          setProposePending(false);
          break;
        case 'Mining':
          setProposePending(true);
          break;
        case 'Success':
          toast.success('Proposal Created!');
          setProposePending(false);
          onProposeSuccess?.();
          break;
        case 'Fail':
        case 'Exception':
          toast.error(errorMessage || 'Please try again.');
          setProposePending(false);
          break;
      }
    },
    [onProposeSuccess],
  );

  useEffect(() => {
    if (isProposeOnV1) {
      handleAddProposalState(proposeOnTimelockV1State);
    } else {
      handleAddProposalState(proposeState);
    }
  }, [proposeState, proposeOnTimelockV1State, isProposeOnV1, handleAddProposalState]);

  const submitLabel = (() => {
    if (isProposePending) return null;
    if (hasActiveOrPendingProposal) return 'Active proposal exists';
    if (!hasEnoughVote) {
      if (proposalThreshold != null && proposalThreshold !== 0) {
        return `Need ${i18n.number(proposalThreshold + 1)} votes`;
      }
      return 'Insufficient votes';
    }
    return 'Create Proposal';
  })();

  const submitDisabled = isFormInvalid || hasActiveOrPendingProposal || !hasEnoughVote;
  const submitDanger = hasActiveOrPendingProposal || !hasEnoughVote;

  return (
    <>
      <ProposalActionModal
        onDismiss={() => setShowTransactionFormModal(false)}
        show={showTransactionFormModal}
        onActionAdd={handleAddProposalAction}
      />

      <div
        className={`${classes.propPage} ${classes.propPageSplit} proposal-draft-font-scope`}
        style={fontScopeStyle}
      >
        <div className={classes.propToolbar}>
          <span className={classes.propToolbarLabel}>Font</span>
          <select
            className={classes.propFontSelect}
            value={font.id}
            onChange={e => setFontId(e.target.value)}
            aria-label="Draft window font"
          >
            {DRAFT_FONT_GROUPS.map(g => (
              <optgroup key={g.key} label={g.label}>
                {DRAFT_FONTS.filter(f => f.group === g.key).map(f => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <span className={classes.propToolbarHint}>This window only · remembered</span>
        </div>

        <main className={classes.propMain}>
          <section className={classes.propPanel}>
            <div className={classes.propPanelHeader}>
              <span className={classes.propPanelTitle}>Tip</span>
            </div>
            <p className={classes.propTip}>
              Add one or more proposal actions and describe your proposal for the community. The
              proposal cannot be modified after submission, so verify all info before submitting.
              The voting period begins after 5 days and lasts 5 days.
            </p>
            <p className={classes.propTipNote}>
              You <strong>MUST</strong> maintain enough voting power to meet the proposal threshold
              until your proposal is executed. If you fail to do so, anyone can cancel.
            </p>
          </section>

          <section className={classes.propPanel}>
            <div className={classes.propPanelHeader}>
              <span className={classes.propPanelTitle}>Actions</span>
              <span className={classes.propStatusValue}>{proposalTransactions.length}</span>
            </div>
            <button
              type="button"
              onClick={() => setShowTransactionFormModal(true)}
              className={classes.propAddActionBtn}
            >
              + Add Action
            </button>
            <div style={{ marginTop: 12 }}>
              {proposalTransactions.length === 0 ? (
                <div className={classes.propTxEmpty}>
                  No actions yet — add one to enable submission.
                </div>
              ) : (
                <ProposalTransactions
                  proposalTransactions={proposalTransactions}
                  onRemoveProposalTransaction={handleRemoveProposalAction}
                />
              )}
            </div>
          </section>

          {totalUSDCPayment > 0 && tokenBuyerTopUpEth !== '0' && (
            <section className={classes.propPanel}>
              <div className={classes.propPanelHeader}>
                <span className={classes.propPanelTitle}>Token Buyer Note</span>
              </div>
              <p className={classes.propTip}>
                Because this proposal contains a USDC fund transfer action, an additional ETH
                transaction was added to refill the TokenBuyer contract. This lets the DAO continue
                to trustlessly acquire USDC.
              </p>
            </section>
          )}

          <section className={classes.propPanel}>
            <div className={classes.propPanelHeader}>
              <span className={classes.propPanelTitle}>Proposal</span>
            </div>
            <div className={classes.propEditorWrapFull}>
              <ProposalEditor
                title={titleValue}
                body={bodyValue}
                onTitleInput={setTitleValue}
                onBodyInput={setBodyValue}
                layout="split"
              />
            </div>

            {isDaoGteV3 && config.featureToggles.proposeOnV1 && (
              <>
                <p style={{ margin: '14px 0 0', fontSize: 12, color: 'var(--gs-text-muted)' }}>
                  Looking for treasury v1?{' '}
                  <button
                    type="button"
                    className={classes.propInlineLink}
                    onClick={() => setIsV1OptionVisible(!isV1OptionVisible)}
                  >
                    Toggle v1 option
                  </button>
                </p>
                {isV1OptionVisible && (
                  <label className={classes.propV1Toggle}>
                    <input
                      type="checkbox"
                      checked={isProposeOnV1}
                      onChange={() => setIsProposeOnV1(!isProposeOnV1)}
                    />
                    Propose on treasury V1 — interacts with assets owned by the{' '}
                    <a
                      href={daoEtherscanLink}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: 'var(--gs-cyan)' }}
                    >
                      original treasury
                    </a>
                    .
                  </label>
                )}
              </>
            )}
          </section>
        </main>

        <aside className={`${classes.propRail} ${classes.propRailSticky}`}>
          <section className={classes.propPanel}>
            <div className={classes.propPanelHeader}>
              <span className={classes.propPanelTitle}>Status</span>
            </div>
            <div className={classes.propStatusList}>
              <div className={classes.propStatusRow}>
                <span className={classes.propStatusLabel}>Title</span>
                <span
                  className={`${classes.propStatusValue} ${
                    titleValue ? classes.propStatusOK : classes.propStatusBad
                  }`}
                >
                  {titleValue ? 'OK' : 'Empty'}
                </span>
              </div>
              <div className={classes.propStatusRow}>
                <span className={classes.propStatusLabel}>Body</span>
                <span
                  className={`${classes.propStatusValue} ${
                    bodyValue ? classes.propStatusOK : classes.propStatusBad
                  }`}
                >
                  {bodyValue ? 'OK' : 'Empty'}
                </span>
              </div>
              <div className={classes.propStatusRow}>
                <span className={classes.propStatusLabel}>Actions</span>
                <span
                  className={`${classes.propStatusValue} ${
                    proposalTransactions.length ? classes.propStatusOK : classes.propStatusBad
                  }`}
                >
                  {proposalTransactions.length}
                </span>
              </div>
              <div className={classes.propStatusRow}>
                <span className={classes.propStatusLabel}>Votes</span>
                <span
                  className={`${classes.propStatusValue} ${
                    hasEnoughVote ? classes.propStatusOK : classes.propStatusBad
                  }`}
                >
                  {availableVotes ?? 0} / {(proposalThreshold ?? 0) + 1}
                </span>
              </div>
              {totalUSDCPayment > 0 && (
                <div className={classes.propStatusRow}>
                  <span className={classes.propStatusLabel}>USDC</span>
                  <span className={classes.propStatusValue}>${totalUSDCPayment.toFixed(2)}</span>
                </div>
              )}
            </div>
          </section>

          <button
            type="button"
            disabled={submitDisabled || isProposePending}
            onClick={handleCreateProposal}
            className={`${classes.propSubmitBtn} ${submitDanger ? classes.propSubmitBtnDanger : ''}`}
          >
            {isProposePending ? <span className={classes.propSpinner} /> : submitLabel}
          </button>
        </aside>
      </div>
    </>
  );
}
