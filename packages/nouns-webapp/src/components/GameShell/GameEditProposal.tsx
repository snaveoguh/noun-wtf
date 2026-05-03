import { useCallback, useEffect, useState } from 'react';

import { i18n } from '@lingui/core';
import { Link, useParams } from 'react-router';
import { toast } from 'sonner';
import { useAccount } from 'wagmi';

interface GameEditProposalProps {
  /** Optional override — when rendered outside a <Route>, the App-level
   *  intercept passes the proposal id directly. Falls back to useParams
   *  for the in-route case. */
  proposalId?: string;
}

import ProposalActionModal from '@/components/ProposalActionsModal';
import ProposalEditor from '@/components/ProposalEditor';
import ProposalTransactions from '@/components/ProposalTransactions';
import { nounsTokenBuyerAddress } from '@/contracts';
import { useEthNeeded } from '@/utils/tokenBuyerContractUtils/tokenBuyer';
import { Address, Hex } from '@/utils/types';
import { defaultChain } from '@/wagmi';
import {
  ProposalDetail,
  ProposalState,
  ProposalTransaction,
  useProposal,
  useProposalThreshold,
  useUpdateProposal,
  useUpdateProposalDescription,
  useUpdateProposalTransactions,
} from '@/wrappers/nounsDao';
import { useCreateProposalCandidate, useGetCreateCandidateCost } from '@/wrappers/nounsData';
import { useUserVotes } from '@/wrappers/nounToken';

import classes from './GameShell.module.css';
import GameShell from './index';

/**
 * Game-themed Edit Proposal page.
 *
 * Mirrors `pages/EditProposal/index.tsx` field-by-field — same wagmi update
 * hooks (`useUpdateProposal`, `useUpdateProposalDescription`,
 * `useUpdateProposalTransactions`), same fork to `createProposalCandidate`
 * when the proposal was created via signers, same diff detection between
 * loaded vs current state.
 *
 * Permission gate: the page only renders for the proposer when the proposal
 * is in `Pending` or `Updatable` state. Otherwise we render a friendly gate
 * card explaining why editing is locked.
 */
export default function GameEditProposal({ proposalId }: GameEditProposalProps = {}) {
  const params = useParams<{ id: string }>();
  const id = proposalId ?? params.id;
  const [isProposalEdited, setIsProposalEdited] = useState(false);
  const [isTitleEdited, setIsTitleEdited] = useState(false);
  const [isBodyEdited, setIsBodyEdited] = useState(false);
  const [proposalTransactions, setProposalTransactions] = useState<ProposalTransaction[]>([]);
  const [titleValue, setTitleValue] = useState('');
  const [bodyValue, setBodyValue] = useState('');
  const [commitMessage, setCommitMessage] = useState<string>('');
  const [totalUSDCPayment, setTotalUSDCPayment] = useState<number>(0);
  const [tokenBuyerTopUpEth, setTokenBuyerTopUpETH] = useState<string>('0');
  const [showTransactionFormModal, setShowTransactionFormModal] = useState(false);
  const [isProposePending, setProposePending] = useState(false);
  const [originalTitleValue, setOriginalTitleValue] = useState('');
  const [originalBodyValue, setOriginalBodyValue] = useState('');
  const [slug, setSlug] = useState('');
  const [originalProposalTransactions, setOriginalProposalTransactions] = useState<
    ProposalDetail[]
  >([]);

  const proposal = useProposal(id ?? '', true);
  const proposalThreshold = useProposalThreshold();
  const { address: account } = useAccount();
  const { updateProposal, updateProposalState } = useUpdateProposal();
  const { updateProposalDescription, updateProposalDescriptionState } =
    useUpdateProposalDescription();
  const { updateProposalTransactions, updateProposalTransactionsState } =
    useUpdateProposalTransactions();
  const { createProposalCandidate, createProposalCandidateState } = useCreateProposalCandidate();
  const availableVotes = useUserVotes();
  const createCandidateCost = useGetCreateCandidateCost();
  const hasEnoughVote = Boolean(
    availableVotes && proposalThreshold && availableVotes > proposalThreshold,
  );

  const chainId = defaultChain.id;
  const ethNeeded = useEthNeeded(
    nounsTokenBuyerAddress[chainId],
    totalUSDCPayment,
    nounsTokenBuyerAddress[chainId] == undefined || totalUSDCPayment === 0,
  );

  const removeTitleFromDescription = (description: string, title: string) => {
    const titleRegex = new RegExp(`# ${title}\n\n`);
    return description.replace(titleRegex, '');
  };
  const isolatedDescription =
    proposal?.description && removeTitleFromDescription(proposal?.description, titleValue);
  const isProposedBySigners = !!(proposal?.signers && proposal?.signers?.length > 0);

  const candidateUpdateSlug = (s: string) => {
    const timestamp = Date.now().toString(36);
    const randomPart = crypto
      .getRandomValues(new Uint8Array(4))
      .reduce((acc, val) => acc + val.toString(36).padStart(2, '0'), '');
    return `${s}-update-${timestamp}-${randomPart}`;
  };

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
      setIsProposalEdited(true);
    },
    [proposalTransactions, totalUSDCPayment],
  );

  const handleRemoveProposalAction = useCallback(
    (index: number) => {
      setTotalUSDCPayment(totalUSDCPayment - (proposalTransactions[index].usdcValue ?? 0));
      setProposalTransactions(proposalTransactions.filter((_, i) => i !== index));
      setIsProposalEdited(true);
    },
    [proposalTransactions, totalUSDCPayment],
  );

  // Token-buyer top-up parity with source-of-truth page.
  useEffect(() => {
    if (ethNeeded !== undefined && ethNeeded !== tokenBuyerTopUpEth && totalUSDCPayment > 0) {
      const hasTokenBuyterTopTop =
        proposalTransactions.filter(txn => txn.address === nounsTokenBuyerAddress[chainId]).length >
        0;

      if (Number(ethNeeded) > 0 && !hasTokenBuyterTopTop) {
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

  const handleTitleInput = useCallback(
    (title: string) => {
      setTitleValue(title);
      if (isProposedBySigners && title === proposal?.title) {
        setSlug(candidateUpdateSlug(title));
      } else {
        setSlug(
          title
            .toLowerCase()
            .replace(/ /g, '-')
            .replace(/[^\w-]+/g, ''),
        );
      }
      setIsTitleEdited(title !== proposal?.title);
    },
    [proposal?.title, isProposedBySigners],
  );

  const handleBodyInput = useCallback(
    (body: string) => {
      setBodyValue(body);
      setIsBodyEdited(body !== isolatedDescription);
    },
    [isolatedDescription],
  );

  useEffect(() => {
    setIsProposalEdited(isTitleEdited || isBodyEdited);
  }, [isTitleEdited, isBodyEdited]);

  // Wire each of the three update flows + the candidate-fork flow into toast
  // notifications + a single isProposePending boolean. Same shape as upstream.
  useEffect(() => {
    switch (updateProposalState.status) {
      case 'None':
        setProposePending(false);
        break;
      case 'Mining':
        setProposePending(true);
        break;
      case 'Success':
        toast.success('Proposal Updated!');
        setProposePending(false);
        break;
      case 'Fail':
      case 'Exception':
        toast.error(updateProposalState?.errorMessage || 'Please try again.');
        setProposePending(false);
        break;
    }
  }, [updateProposalState]);

  useEffect(() => {
    switch (updateProposalDescriptionState.status) {
      case 'None':
        setProposePending(false);
        break;
      case 'Mining':
        setProposePending(true);
        break;
      case 'Success':
        toast.success('Proposal Updated!');
        setProposePending(false);
        break;
      case 'Fail':
      case 'Exception':
        toast.error(updateProposalDescriptionState?.errorMessage || 'Please try again.');
        setProposePending(false);
        break;
    }
  }, [updateProposalDescriptionState]);

  useEffect(() => {
    switch (updateProposalTransactionsState.status) {
      case 'None':
        setProposePending(false);
        break;
      case 'Mining':
        setProposePending(true);
        break;
      case 'Success':
        toast.success('Proposal Updated!');
        setProposePending(false);
        break;
      case 'Fail':
      case 'Exception':
        toast.error(updateProposalTransactionsState?.errorMessage || 'Please try again.');
        setProposePending(false);
        break;
    }
  }, [updateProposalTransactionsState]);

  const isProposer = () => proposal?.proposer?.toLowerCase() === account?.toLowerCase();

  const isTransactionsEdited = () => {
    if (originalProposalTransactions.length !== proposalTransactions.length) return true;
    for (let i = 0; i < originalProposalTransactions.length; i++) {
      if (
        originalProposalTransactions[i].target !== proposalTransactions[i].address ||
        originalProposalTransactions[i].value !== proposalTransactions[i].value
      ) {
        return true;
      }
    }
    return false;
  };

  const isDescriptionEdited = () =>
    originalTitleValue !== titleValue || originalBodyValue !== bodyValue;

  const handleUpdateProposal = async () => {
    if (!proposalTransactions?.length) return;
    if (proposal === undefined) return;

    if (isDescriptionEdited() && !isTransactionsEdited()) {
      await updateProposalDescription({
        args: [BigInt(proposal?.id ?? 0), `# ${titleValue}\n\n${bodyValue}`, commitMessage],
      });
    }
    if (!isDescriptionEdited() && isTransactionsEdited()) {
      await updateProposalTransactions({
        args: [
          BigInt(proposal?.id ?? 0),
          proposalTransactions.map(({ address }) => address as `0x${string}`),
          proposalTransactions.map(({ value }) => value ?? 0n),
          proposalTransactions.map(({ signature }) => signature ?? ''),
          proposalTransactions.map(({ calldata }) => calldata),
          commitMessage,
        ],
      });
    }
    if (isDescriptionEdited() && isTransactionsEdited()) {
      await updateProposal({
        args: [
          BigInt(proposal?.id ?? 0),
          proposalTransactions.map(({ address }) => address as `0x${string}`),
          proposalTransactions.map(({ value }) => value ?? 0n),
          proposalTransactions.map(({ signature }) => signature ?? ''),
          proposalTransactions.map(({ calldata }) => calldata),
          `# ${titleValue}\n\n${bodyValue}`,
          commitMessage,
        ],
      });
    }
  };

  // Hydrate the form once the proposal lands. Single-shot — guarded by all
  // local fields being empty so re-renders don't clobber edits.
  useEffect(() => {
    if (
      proposal &&
      !titleValue &&
      !bodyValue &&
      !proposalTransactions.length &&
      !originalTitleValue &&
      !originalBodyValue &&
      !originalProposalTransactions.length
    ) {
      const transactions = proposal.details.map(txn => ({
        address: txn.target as Address,
        value: BigInt(txn.value ?? 0n),
        calldata: txn.callData as Hex,
        signature: txn.functionSig ?? '',
      }));
      const slugValue = proposal.title
        .toLowerCase()
        .replace(/ /g, '-')
        .replace(/[^\w-]+/g, '');
      setTitleValue(proposal.title);
      if (isProposedBySigners) {
        setSlug(candidateUpdateSlug(slugValue));
      } else {
        setSlug(slugValue);
      }
      setBodyValue(removeTitleFromDescription(proposal.description, proposal.title));
      setProposalTransactions(transactions);
      setOriginalTitleValue(proposal.title);
      setOriginalBodyValue(removeTitleFromDescription(proposal.description, proposal.title));
      setOriginalProposalTransactions(proposal.details);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal]);

  const handleCreateNewCandidate = async () => {
    if (!proposalTransactions?.length || !titleValue || !bodyValue || !slug || !id) return;
    await createProposalCandidate({
      args: [
        proposalTransactions.map(({ address }) => address as `0x${string}`),
        proposalTransactions.map(({ value }) => BigInt(value ?? 0n)),
        proposalTransactions.map(({ signature }) => signature),
        proposalTransactions.map(({ calldata }) => calldata as `0x${string}`),
        `# ${titleValue}\n\n${bodyValue}`,
        slug,
        BigInt(id),
      ],
      value: availableVotes! > 0 ? 0n : createCandidateCost,
    });
  };

  useEffect(() => {
    switch (createProposalCandidateState.status) {
      case 'None':
        setProposePending(false);
        break;
      case 'Mining':
        setProposePending(true);
        break;
      case 'Success':
        toast.success('Proposal Candidate Created!', {
          action: {
            label: 'View the candidate',
            onClick: () => (window.location.href = `/candidates/${slug}`),
          },
        });
        setProposePending(false);
        break;
      case 'Fail':
      case 'Exception':
        toast.error(createProposalCandidateState?.errorMessage || 'Please try again.');
        setProposePending(false);
        break;
    }
  }, [createProposalCandidateState, slug]);

  const isFormInvalid =
    !(isProposalEdited || isTransactionsEdited() || isDescriptionEdited()) ||
    !proposalTransactions.length ||
    titleValue === '' ||
    bodyValue === '' ||
    slug === '';

  // Permission + state gate. The proposer can edit only when the proposal is
  // in Pending or Updatable. Anything else (Active / Defeated / Executed /
  // etc) shows a friendly explanation rather than a 404 / blank screen so
  // the user can navigate away.
  const isOwner = isProposer();
  const isEditableState =
    proposal?.status === ProposalState.PENDING || proposal?.status === ProposalState.UPDATABLE;

  if (proposal && !isOwner) {
    return (
      <GameShell>
        <div className={classes.propPage}>
          <main className={classes.propMain}>
            <div className={classes.propBackBar}>
              <Link to={`/vote/${id}`} aria-label="Back" className={classes.propBackBtn}>
                ←
              </Link>
              <h1 className={classes.propHeading}>Edit Proposal</h1>
            </div>
            <div className={classes.propGate}>
              <div className={classes.propGateTitle}>Not the proposer</div>
              Only the original proposer can edit this proposal.
            </div>
          </main>
        </div>
      </GameShell>
    );
  }

  if (proposal && !isEditableState) {
    return (
      <GameShell>
        <div className={classes.propPage}>
          <main className={classes.propMain}>
            <div className={classes.propBackBar}>
              <Link to={`/vote/${id}`} aria-label="Back" className={classes.propBackBtn}>
                ←
              </Link>
              <h1 className={classes.propHeading}>Edit Proposal</h1>
            </div>
            <div className={classes.propGate}>
              <div className={classes.propGateTitle}>Locked</div>
              This proposal is no longer in an editable state. Edits are only allowed while a
              proposal is Pending or Updatable.
            </div>
          </main>
        </div>
      </GameShell>
    );
  }

  // Submit copy + danger flag mirror the Bootstrap EditProposalButton.
  const submitLabel = (() => {
    if (isProposePending) return null;
    if (!hasEnoughVote && !isOwner) {
      if (proposalThreshold) {
        return `Need ${i18n.number((proposalThreshold || 0) + 1)} votes`;
      }
      return 'Insufficient votes';
    }
    if (isProposedBySigners) return 'Update Proposal Candidate';
    return 'Update Proposal';
  })();

  const submitDisabled = isFormInvalid || (!isOwner && !hasEnoughVote);
  const submitDanger = !isOwner && !hasEnoughVote;

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
            <Link to={`/vote/${id}`} aria-label="Back" className={classes.propBackBtn}>
              ←
            </Link>
            <h1 className={classes.propHeading}>Edit Proposal</h1>
          </div>

          <section className={classes.propPanel}>
            <div className={classes.propPanelHeader}>
              <span className={classes.propPanelTitle}>Note</span>
            </div>
            <p className={classes.propTip}>
              {isProposedBySigners
                ? 'This proposal was created by candidate signatures. Editing the proposal will create a new proposal candidate requiring the original signers to resign to update the onchain proposal.'
                : 'Editing a proposal will clear all previous feedback.'}
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
                  No actions — at least one is required.
                </div>
              ) : (
                <ProposalTransactions
                  proposalTransactions={proposalTransactions}
                  onRemoveProposalTransaction={handleRemoveProposalAction}
                  isProposalUpdate
                />
              )}
            </div>
          </section>

          {totalUSDCPayment > 0 && (
            <section className={classes.propPanel}>
              <div className={classes.propPanelHeader}>
                <span className={classes.propPanelTitle}>Token Buyer Note</span>
              </div>
              <p className={classes.propTip}>
                Because this proposal contains a USDC fund transfer action, an additional ETH
                transaction was added to refill the TokenBuyer contract.
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
                onTitleInput={handleTitleInput}
                onBodyInput={handleBodyInput}
              />
            </div>
            {!isProposedBySigners && (
              <div style={{ marginTop: 12 }}>
                <input
                  type="text"
                  value={commitMessage}
                  onChange={e => setCommitMessage(e.target.value)}
                  placeholder="Optional commit message"
                  className={classes.propCommitInput}
                />
              </div>
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
                    isTitleEdited ? classes.propStatusOK : ''
                  }`}
                >
                  {isTitleEdited ? 'Edited' : 'Unchanged'}
                </span>
              </div>
              <div className={classes.propStatusRow}>
                <span className={classes.propStatusLabel}>Body</span>
                <span
                  className={`${classes.propStatusValue} ${
                    isBodyEdited ? classes.propStatusOK : ''
                  }`}
                >
                  {isBodyEdited ? 'Edited' : 'Unchanged'}
                </span>
              </div>
              <div className={classes.propStatusRow}>
                <span className={classes.propStatusLabel}>Actions</span>
                <span
                  className={`${classes.propStatusValue} ${
                    isTransactionsEdited() ? classes.propStatusOK : ''
                  }`}
                >
                  {proposalTransactions.length}
                </span>
              </div>
              <div className={classes.propStatusRow}>
                <span className={classes.propStatusLabel}>State</span>
                <span className={classes.propStatusValue}>
                  {ProposalState[proposal?.status ?? ProposalState.UNDETERMINED]}
                </span>
              </div>
            </div>
          </section>

          <button
            type="button"
            disabled={submitDisabled || isProposePending}
            onClick={isProposedBySigners ? handleCreateNewCandidate : handleUpdateProposal}
            className={`${classes.propSubmitBtn} ${submitDanger ? classes.propSubmitBtnDanger : ''}`}
          >
            {isProposePending ? <span className={classes.propSpinner} /> : submitLabel}
          </button>
        </aside>
      </div>
    </GameShell>
  );
}
