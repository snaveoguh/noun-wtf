import type { Address, Hex } from '@/utils/types';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { ArrowLeftIcon, Loader2Icon } from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { useAccount } from 'wagmi';

import { nounsTokenBuyerAddress } from '@/contracts';
import { useEthNeeded } from '@/utils/tokenBuyerContractUtils/tokenBuyer';
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

import CampProposalForm from './CampProposalForm';

import CampShell from './index';

interface CampEditProposalProps {
  /** Optional override for the proposal id when rendered outside a `<Route>`. */
  proposalId?: string;
}

const removeTitleFromDescription = (description: string, title: string) => {
  const titleRegex = new RegExp(`# ${title}\\n\\n`);
  return description.replace(titleRegex, '');
};

const candidateUpdateSlug = (slug: string) => {
  const timestamp = Date.now().toString(36);
  const randomPart = crypto
    .getRandomValues(new Uint8Array(4))
    .reduce((acc, val) => acc + val.toString(36).padStart(2, '0'), '');
  return `${slug}-update-${timestamp}-${randomPart}`;
};

/**
 * Camp-themed `/edit-proposal/:id` page. Mirrors `pages/EditProposal/`'s
 * loading + submit logic verbatim, with Camp's dark dashboard chrome.
 *
 * Like the canonical edit page, this component:
 *  - Loads the proposal once and seeds form state from it
 *  - Dispatches to `updateProposal` / `updateProposalDescription` /
 *    `updateProposalTransactions` depending on what changed
 *  - For proposals created by signers, creates a new candidate
 *
 * Ownership is enforced here too — non-proposers see a banner instead of
 * the form (matches canonical behavior of returning `null`, but more
 * informative).
 */
export default function CampEditProposal({ proposalId }: CampEditProposalProps = {}) {
  const params = useParams<{ id: string }>();
  const id = proposalId ?? params.id;
  const navigate = useNavigate();
  const { address: account } = useAccount();
  const chainId = defaultChain.id;

  const [titleValue, setTitleValue] = useState('');
  const [bodyValue, setBodyValue] = useState('');
  const [originalTitleValue, setOriginalTitleValue] = useState('');
  const [originalBodyValue, setOriginalBodyValue] = useState('');
  const [proposalTransactions, setProposalTransactions] = useState<ProposalTransaction[]>([]);
  const [originalProposalTransactions, setOriginalProposalTransactions] = useState<
    ProposalDetail[]
  >([]);
  const [commitMessage, setCommitMessage] = useState('');
  const [slug, setSlug] = useState('');
  const [isProposalEdited, setIsProposalEdited] = useState(false);
  const [isTitleEdited, setIsTitleEdited] = useState(false);
  const [isBodyEdited, setIsBodyEdited] = useState(false);
  const [isProposePending, setProposePending] = useState(false);
  const [totalUSDCPayment, setTotalUSDCPayment] = useState(0);
  const [tokenBuyerTopUpEth, setTokenBuyerTopUpETH] = useState('0');

  const proposal = useProposal(id ?? '', true);
  const proposalThreshold = useProposalThreshold();
  const availableVotes = useUserVotes();
  const createCandidateCost = useGetCreateCandidateCost();

  const { updateProposal, updateProposalState } = useUpdateProposal();
  const { updateProposalDescription, updateProposalDescriptionState } =
    useUpdateProposalDescription();
  const { updateProposalTransactions, updateProposalTransactionsState } =
    useUpdateProposalTransactions();
  const { createProposalCandidate, createProposalCandidateState } = useCreateProposalCandidate();

  const ethNeeded = useEthNeeded(
    nounsTokenBuyerAddress[chainId],
    totalUSDCPayment,
    nounsTokenBuyerAddress[chainId] == undefined || totalUSDCPayment === 0,
  );

  const isProposedBySigners = !!(proposal?.signers && proposal.signers.length > 0);
  const isProposer = proposal?.proposer?.toLowerCase() === account?.toLowerCase();

  const hasEnoughVote = Boolean(
    availableVotes != null && proposalThreshold != null && availableVotes > proposalThreshold,
  );

  const isolatedDescription = useMemo(() => {
    if (!proposal?.description) return '';
    return removeTitleFromDescription(proposal.description, titleValue);
  }, [proposal?.description, titleValue]);

  const isEditableState =
    proposal?.status === ProposalState.PENDING || proposal?.status === ProposalState.UPDATABLE;

  // Seed the form state from the loaded proposal — only once.
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
        value: BigInt(txn.value ?? '0'),
        calldata: txn.callData as Hex,
        signature: txn.functionSig ?? '',
      }));
      const slugValue = proposal.title
        .toLowerCase()
        .replace(/ /g, '-')
        .replace(/[^\w-]+/g, '');
      setTitleValue(proposal.title);
      setSlug(isProposedBySigners ? candidateUpdateSlug(slugValue) : slugValue);
      setBodyValue(removeTitleFromDescription(proposal.description, proposal.title));
      setProposalTransactions(transactions);
      setOriginalTitleValue(proposal.title);
      setOriginalBodyValue(removeTitleFromDescription(proposal.description, proposal.title));
      setOriginalProposalTransactions(proposal.details);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal]);

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
        if (transaction.usdcValue != null && transaction.usdcValue !== 0) {
          setTotalUSDCPayment(totalUSDCPayment + transaction.usdcValue);
        }
      });
      setProposalTransactions([...proposalTransactions, ...transactionsArray]);
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

  // Token-buyer top-up auto-injection.
  useEffect(() => {
    if (ethNeeded !== undefined && ethNeeded !== tokenBuyerTopUpEth && totalUSDCPayment > 0) {
      const hasTokenBuyerTopUp =
        proposalTransactions.filter(txn => txn.address === nounsTokenBuyerAddress[chainId]).length >
        0;
      if (Number(ethNeeded) > 0 && !hasTokenBuyerTopUp) {
        handleAddProposalAction({
          address: nounsTokenBuyerAddress[chainId],
          value: BigInt(ethNeeded ?? 0),
          calldata: '0x' as Hex,
          signature: '',
        });
      } else if (Number(ethNeeded) > 0) {
        const indexOfTokenBuyerTopUp = proposalTransactions
          .map((txn, index) => (txn.address === nounsTokenBuyerAddress[chainId] ? index : -1))
          .filter(n => n >= 0);
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

  const isTransactionsEdited = useCallback(() => {
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
  }, [originalProposalTransactions, proposalTransactions]);

  const isDescriptionEdited = useCallback(
    () => originalTitleValue !== titleValue || originalBodyValue !== bodyValue,
    [originalTitleValue, originalBodyValue, titleValue, bodyValue],
  );

  // Generic state-handler factory — same toast/spinner pattern the canonical
  // EditProposal uses, but extracted so we can wire all 4 transaction states
  // to it.
  const handleTxState = useCallback(
    (
      state: { status: string; errorMessage?: string },
      successMessage: string,
      onSuccess?: () => void,
    ) => {
      switch (state.status) {
        case 'None':
          setProposePending(false);
          break;
        case 'Mining':
          setProposePending(true);
          break;
        case 'Success':
          toast.success(successMessage);
          setProposePending(false);
          onSuccess?.();
          break;
        case 'Fail':
        case 'Exception':
          toast.error(state.errorMessage || 'Please try again.');
          setProposePending(false);
          break;
      }
    },
    [],
  );

  useEffect(() => {
    handleTxState(updateProposalState, 'Proposal Updated!', () => navigate(`/vote/${id}`));
  }, [updateProposalState, handleTxState, navigate, id]);

  useEffect(() => {
    handleTxState(updateProposalDescriptionState, 'Proposal Updated!', () =>
      navigate(`/vote/${id}`),
    );
  }, [updateProposalDescriptionState, handleTxState, navigate, id]);

  useEffect(() => {
    handleTxState(updateProposalTransactionsState, 'Proposal Updated!', () =>
      navigate(`/vote/${id}`),
    );
  }, [updateProposalTransactionsState, handleTxState, navigate, id]);

  useEffect(() => {
    handleTxState(createProposalCandidateState, 'Proposal Candidate Created!', () => {
      if (slug) window.location.href = `/candidates/${slug}`;
    });
  }, [createProposalCandidateState, handleTxState, slug]);

  const handleUpdateProposal = async () => {
    if (!proposalTransactions?.length || !proposal) return;
    if (isDescriptionEdited() && !isTransactionsEdited()) {
      await updateProposalDescription({
        args: [BigInt(proposal.id ?? 0), `# ${titleValue}\n\n${bodyValue}`, commitMessage],
      });
    } else if (!isDescriptionEdited() && isTransactionsEdited()) {
      await updateProposalTransactions({
        args: [
          BigInt(proposal.id ?? 0),
          proposalTransactions.map(({ address }) => address as `0x${string}`),
          proposalTransactions.map(({ value }) => value ?? '0'),
          proposalTransactions.map(({ signature }) => signature ?? ''),
          proposalTransactions.map(({ calldata }) => calldata),
          commitMessage,
        ],
      });
    } else if (isDescriptionEdited() && isTransactionsEdited()) {
      await updateProposal({
        args: [
          BigInt(proposal.id ?? 0),
          proposalTransactions.map(({ address }) => address as `0x${string}`),
          proposalTransactions.map(({ value }) => value ?? '0'),
          proposalTransactions.map(({ signature }) => signature ?? ''),
          proposalTransactions.map(({ calldata }) => calldata),
          `# ${titleValue}\n\n${bodyValue}`,
          commitMessage,
        ],
      });
    }
  };

  const handleCreateNewCandidate = async () => {
    if (!proposalTransactions?.length || !titleValue || !bodyValue || !slug || !id) return;
    await createProposalCandidate({
      args: [
        proposalTransactions.map(({ address }) => address as `0x${string}`),
        proposalTransactions.map(({ value }) => BigInt(value ?? '0')),
        proposalTransactions.map(({ signature }) => signature),
        proposalTransactions.map(({ calldata }) => calldata as `0x${string}`),
        `# ${titleValue}\n\n${bodyValue}`,
        slug,
        BigInt(id),
      ],
      value: availableVotes! > 0 ? BigInt(0) : createCandidateCost,
    });
  };

  const isFormInvalid =
    !(isProposalEdited || isTransactionsEdited() || isDescriptionEdited()) ||
    !proposalTransactions.length ||
    titleValue === '' ||
    bodyValue === '' ||
    slug === '';

  // Gate the page entirely if the connected user is not the proposer.
  if (!proposal && id) {
    return (
      <CampShell>
        <div
          style={{
            maxWidth: 720,
            margin: '64px auto',
            color: 'var(--theme-text-secondary)',
            textAlign: 'center',
            fontSize: 14,
          }}
        >
          Loading proposal {id}…
        </div>
      </CampShell>
    );
  }

  if (proposal && !isProposer) {
    return (
      <CampShell>
        <div
          style={{
            maxWidth: 720,
            margin: '64px auto',
            padding: 24,
            background: 'var(--theme-bg-card)',
            border: '1px solid var(--theme-border)',
            borderRadius: 'var(--theme-radius-lg, 10px)',
            textAlign: 'center',
          }}
        >
          <h2 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700 }}>
            Only the proposer can edit
          </h2>
          <p style={{ margin: 0, color: 'var(--theme-text-secondary)', fontSize: 13 }}>
            You&apos;re not the proposer of this proposal, so you can&apos;t edit it.
          </p>
          <div style={{ marginTop: 16 }}>
            <Link
              to={`/vote/${id}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                fontSize: 13,
                color: 'var(--theme-text-primary)',
                background: 'transparent',
                border: '1px solid var(--theme-border)',
                borderRadius: 'var(--theme-radius-md, 6px)',
                textDecoration: 'none',
              }}
            >
              <ArrowLeftIcon size={14} aria-hidden /> Back to proposal
            </Link>
          </div>
        </div>
      </CampShell>
    );
  }

  if (proposal && !isEditableState && !isProposedBySigners) {
    return (
      <CampShell>
        <div
          style={{
            maxWidth: 720,
            margin: '64px auto',
            padding: 24,
            background: 'var(--theme-bg-card)',
            border: '1px solid var(--theme-border)',
            borderRadius: 'var(--theme-radius-lg, 10px)',
            textAlign: 'center',
          }}
        >
          <h2 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700 }}>
            Proposal can no longer be edited
          </h2>
          <p style={{ margin: 0, color: 'var(--theme-text-secondary)', fontSize: 13 }}>
            Only proposals in the Pending or Updatable state can be edited.
          </p>
          <div style={{ marginTop: 16 }}>
            <Link
              to={`/vote/${id}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                fontSize: 13,
                color: 'var(--theme-text-primary)',
                background: 'transparent',
                border: '1px solid var(--theme-border)',
                borderRadius: 'var(--theme-radius-md, 6px)',
                textDecoration: 'none',
              }}
            >
              <ArrowLeftIcon size={14} aria-hidden /> Back to proposal
            </Link>
          </div>
        </div>
      </CampShell>
    );
  }

  const submitDisabled = isFormInvalid || isProposePending || (!isProposer && !hasEnoughVote);
  const submitLabel = (() => {
    if (isProposePending) return 'Submitting…';
    if (isProposedBySigners) return 'Update Proposal Candidate';
    return 'Update Proposal';
  })();

  return (
    <CampShell>
      <div
        style={{
          width: '100%',
          maxWidth: 720,
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Link
            to={`/vote/${id}`}
            aria-label={`Back to proposal ${id}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 28,
              height: 28,
              borderRadius: 6,
              border: '1px solid var(--theme-border)',
              background: 'transparent',
              color: 'var(--theme-text-secondary)',
              textDecoration: 'none',
            }}
          >
            <ArrowLeftIcon size={14} aria-hidden />
          </Link>
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>Edit proposal {id}</h1>
        </div>

        <div
          style={{
            padding: '12px 14px',
            background: 'var(--theme-bg-secondary, var(--theme-bg-card))',
            border: '1px solid var(--theme-border-light, var(--theme-border))',
            borderRadius: 'var(--theme-radius-md, 6px)',
            color: 'var(--theme-text-secondary)',
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <strong style={{ color: 'var(--theme-text-primary)' }}>Note:</strong>{' '}
          {isProposedBySigners
            ? 'This proposal was created by candidate signatures. Editing will create a new proposal candidate requiring the original signers to resign to update the on-chain proposal.'
            : 'Editing a proposal will clear all previous feedback.'}
        </div>

        <CampProposalForm
          title={titleValue}
          onTitleChange={handleTitleInput}
          body={bodyValue}
          onBodyChange={handleBodyInput}
          transactions={proposalTransactions}
          onAddTransaction={handleAddProposalAction}
          onRemoveTransaction={handleRemoveProposalAction}
          isProposalUpdate
        />

        {totalUSDCPayment > 0 && (
          <div
            style={{
              padding: '10px 12px',
              background: 'var(--theme-bg-secondary, var(--theme-bg-card))',
              border: '1px solid var(--theme-border-light, var(--theme-border))',
              borderRadius: 'var(--theme-radius-md, 6px)',
              color: 'var(--theme-text-secondary)',
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            <strong style={{ color: 'var(--theme-text-primary)' }}>Note:</strong> because this
            proposal contains a USDC fund transfer, an additional ETH transaction has been added to
            refill the TokenBuyer contract.
          </div>
        )}

        {!isProposedBySigners && (
          <div>
            <label
              htmlFor="camp-prop-commit"
              style={{
                display: 'block',
                fontSize: 11,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: 'var(--theme-text-secondary)',
                marginBottom: 6,
              }}
            >
              Commit message (optional)
            </label>
            <input
              id="camp-prop-commit"
              value={commitMessage}
              onChange={e => setCommitMessage(e.target.value)}
              placeholder="What did you change and why?"
              style={{
                width: '100%',
                padding: '10px 12px',
                background: 'var(--theme-bg-input, var(--theme-bg-tertiary))',
                border: '1px solid var(--theme-border)',
                borderRadius: 'var(--theme-radius-md, 6px)',
                color: 'var(--theme-text-primary)',
                fontFamily: 'inherit',
                outline: 'none',
                fontSize: 13,
              }}
            />
          </div>
        )}

        <div
          style={{
            position: 'sticky',
            bottom: 0,
            paddingTop: 12,
            paddingBottom: 12,
            background: 'linear-gradient(to top, var(--theme-bg-primary) 70%, transparent)',
            display: 'flex',
            gap: 10,
            alignItems: 'center',
            justifyContent: 'flex-end',
          }}
        >
          <Link
            to={`/vote/${id}`}
            style={{
              padding: '9px 14px',
              background: 'transparent',
              border: '1px solid var(--theme-border)',
              borderRadius: 'var(--theme-radius-md, 6px)',
              color: 'var(--theme-text-primary)',
              fontFamily: 'inherit',
              fontSize: 13,
              textDecoration: 'none',
            }}
          >
            Cancel
          </Link>
          <button
            type="button"
            onClick={isProposedBySigners ? handleCreateNewCandidate : handleUpdateProposal}
            disabled={submitDisabled}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '9px 16px',
              fontSize: 13,
              fontWeight: 600,
              color: submitDisabled
                ? 'var(--theme-text-muted, var(--theme-text-secondary))'
                : 'var(--theme-accent-text-inverse, white)',
              background: submitDisabled
                ? 'var(--theme-bg-tertiary, var(--theme-bg-card))'
                : 'var(--theme-accent)',
              border: '1px solid',
              borderColor: submitDisabled ? 'var(--theme-border)' : 'var(--theme-accent)',
              borderRadius: 'var(--theme-radius-md, 6px)',
              cursor: submitDisabled ? 'not-allowed' : 'pointer',
              fontFamily: 'inherit',
            }}
          >
            {isProposePending && <Loader2Icon size={14} className="animate-spin" aria-hidden />}
            {submitLabel}
          </button>
        </div>
      </div>
    </CampShell>
  );
}
