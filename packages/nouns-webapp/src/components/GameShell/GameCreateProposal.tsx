import type { Hex } from '@/utils/types';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { i18n } from '@lingui/core';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { filter } from 'remeda';
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

import classes from './GameShell.module.css';
import GameShell from './index';

/**
 * Game-themed Create Proposal page.
 *
 * Mirrors the field-by-field behaviour of `pages/CreateProposal/index.tsx` —
 * same wagmi hooks, same submit shape, same token-buyer top-up dance — but
 * laid out in the synthwave dashboard chrome: 760px content column on the
 * left, 320px sticky actions rail on the right with a status panel + neon
 * gradient submit pill.
 *
 * Reuses upstream form bits (`ProposalEditor`, `ProposalTransactions`,
 * `ProposalActionModal`) and re-skins them via `:global([class*='…'])`
 * selectors in `GameShell.module.css`. Bootstrap-flavoured markup is left
 * intact because rewriting it would diverge from the source-of-truth pages.
 */
export default function GameCreateProposal() {
  const [proposalTransactions, setProposalTransactions] = useState<ProposalTransaction[]>([]);
  const [titleValue, setTitleValue] = useState('');
  const [bodyValue, setBodyValue] = useState('');
  const [totalUSDCPayment, setTotalUSDCPayment] = useState<number>(0);
  const [tokenBuyerTopUpEth, setTokenBuyerTopUpETH] = useState<string>('0');
  const [showTransactionFormModal, setShowTransactionFormModal] = useState(false);
  const [isProposePending, setProposePending] = useState(false);
  const [isProposeOnV1, setIsProposeOnV1] = useState(false);
  const [isV1OptionVisible, setIsV1OptionVisible] = useState(false);
  const [previousProposalId, setPreviousProposalId] = useState<number | undefined>(undefined);

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
        if (transaction.usdcValue) {
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

  // Lock in the latest proposal id once at mount so we can later detect a new
  // proposal landing onchain (used by upstream as a routing signal — kept here
  // for parity even if not currently consumed).
  useEffect(() => {
    if (latestProposalId !== undefined && !previousProposalId) {
      setPreviousProposalId(latestProposalId);
    }
  }, [latestProposalId, previousProposalId]);

  // Token-buyer top-up: when a proposal includes USDC payments, we auto-add
  // (or update) an ETH transfer to the TokenBuyer contract so it can keep
  // trustlessly acquiring USDC. Logic mirrors the source-of-truth page.
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

  const hasEnoughVote = Boolean(
    availableVotes && proposalThreshold && availableVotes > proposalThreshold,
  );

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
          break;
        case 'Fail':
        case 'Exception':
          toast.error(errorMessage || 'Please try again.');
          setProposePending(false);
          break;
      }
    },
    [],
  );

  useEffect(() => {
    if (isProposeOnV1) {
      handleAddProposalState(proposeOnTimelockV1State);
    } else {
      handleAddProposalState(proposeState);
    }
  }, [proposeState, proposeOnTimelockV1State, isProposeOnV1, handleAddProposalState]);

  // Submit-button copy mirrors `CreateProposalButton` so the user sees the
  // same gating reasons (active/pending proposal, insufficient votes, etc).
  const submitLabel = (() => {
    if (isProposePending) return null;
    if (hasActiveOrPendingProposal) return 'Active proposal exists';
    if (!hasEnoughVote) {
      if (proposalThreshold) {
        return `Need ${i18n.number((proposalThreshold || 0) + 1)} votes`;
      }
      return 'Insufficient votes';
    }
    return 'Create Proposal';
  })();

  const submitDisabled = isFormInvalid || hasActiveOrPendingProposal || !hasEnoughVote;
  const submitDanger = hasActiveOrPendingProposal || !hasEnoughVote;

  return (
    <GameShell>
      <ProposalActionModal
        onDismiss={() => setShowTransactionFormModal(false)}
        show={showTransactionFormModal}
        onActionAdd={handleAddProposalAction}
      />

      <div className={classes.propPage}>
        <main className={classes.propMain}>
          <div className={classes.propBackBar}>
            <Link to="/vote" aria-label="Back to governance" className={classes.propBackBtn}>
              ←
            </Link>
            <h1 className={classes.propHeading}>Create Proposal</h1>
          </div>

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
            <div className={classes.propEditorWrap}>
              <ProposalEditor
                title={titleValue}
                body={bodyValue}
                onTitleInput={setTitleValue}
                onBodyInput={setBodyValue}
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
                    <a href={daoEtherscanLink} target="_blank" rel="noreferrer" style={{ color: 'var(--gs-cyan)' }}>
                      original treasury
                    </a>
                    .
                  </label>
                )}
              </>
            )}
          </section>
        </main>

        <aside className={classes.propRail}>
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
    </GameShell>
  );
}
