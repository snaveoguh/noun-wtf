import type { Hex } from '@/utils/types';

import { useCallback, useEffect, useMemo, useState } from 'react';

import { t } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { ArrowLeftIcon, Loader2Icon } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { filter } from 'remeda';
import { toast } from 'sonner';
import { useAccount } from 'wagmi';

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

import CampProposalForm from './CampProposalForm';

import CampShell from './index';

/**
 * Camp-themed `/create-proposal` page. Mirrors `pages/CreateProposal/` field
 * shape and submit logic but renders inside the Camp shell with the dark
 * dashboard styling.
 *
 * State and submit code is intentionally kept 1:1 with the canonical creator
 * page so users get the same on-chain behavior — the only thing that's
 * different is the surface chrome.
 */
export default function CampCreateProposal() {
  const navigate = useNavigate();
  const { _ } = useLingui();
  const { address: account } = useAccount();
  const chainId = defaultChain.id;

  const [proposalTransactions, setProposalTransactions] = useState<ProposalTransaction[]>([]);
  const [titleValue, setTitleValue] = useState('');
  const [bodyValue, setBodyValue] = useState('');
  const [totalUSDCPayment, setTotalUSDCPayment] = useState<number>(0);
  const [tokenBuyerTopUpEth, setTokenBuyerTopUpETH] = useState<string>('0');
  const [isProposePending, setProposePending] = useState(false);
  const [isProposeOnV1, setIsProposeOnV1] = useState(false);
  const [isV1OptionVisible, setIsV1OptionVisible] = useState(false);
  const [previousProposalId, setPreviousProposalId] = useState<number | undefined>(undefined);

  const latestProposalId = useProposalCount();
  const latestProposal = useProposal(latestProposalId ?? 0);
  const availableVotes = useUserVotes();
  const proposalThreshold = useProposalThreshold();
  const { propose, proposeState } = usePropose();
  const { proposeOnTimelockV1, proposeOnTimelockV1State } = useProposeOnTimelockV1();
  const ethNeeded = useEthNeeded(
    nounsTokenBuyerAddress[chainId] ?? '',
    totalUSDCPayment,
    nounsTokenBuyerAddress[chainId] == undefined || totalUSDCPayment === 0,
  );
  const isDaoGteV3 = useIsDaoGteV3();
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
        if (transaction.usdcValue != null && transaction.usdcValue !== 0) {
          setTotalUSDCPayment(totalUSDCPayment + transaction.usdcValue);
        }
      });
      setProposalTransactions([...proposalTransactions, ...transactionsArray]);
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
    if (latestProposalId !== undefined && previousProposalId == null) {
      setPreviousProposalId(latestProposalId);
    }
  }, [latestProposalId, previousProposalId]);

  // Token-buyer top-up auto-injection — same logic as canonical CreateProposal.
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
      } else {
        if (Number(ethNeeded) > 0) {
          const indexOfTokenBuyerTopUp =
            proposalTransactions
              .map((txn, index) => (txn.address === nounsTokenBuyerAddress[chainId] ? index : -1))
              .filter(n => n >= 0) ?? [];

          const txns = proposalTransactions;
          if (indexOfTokenBuyerTopUp.length > 0) {
            txns[indexOfTokenBuyerTopUp[0]].value = BigInt(ethNeeded);
            setProposalTransactions(txns);
          }
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
    availableVotes != null && proposalThreshold != null && availableVotes > proposalThreshold,
  );

  const hasActiveOrPendingProposal =
    (latestProposal?.status === ProposalState.ACTIVE ||
      latestProposal?.status === ProposalState.PENDING) &&
    latestProposal?.proposer === account;

  const handleCreateProposal = async () => {
    if (!proposalTransactions?.length) return;
    if (isProposeOnV1) {
      await proposeOnTimelockV1({
        args: [
          proposalTransactions.map(({ address }) => address),
          proposalTransactions.map(({ value }) => value ?? '0'),
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
          proposalTransactions.map(({ value }) => value ?? '0'),
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
          toast.success(_(t`Proposal Created!`));
          setProposePending(false);
          // Take the user to the governance list once the proposal lands. The
          // subgraph indexer takes a few seconds to catch up so we don't try to
          // navigate to the new proposal directly.
          navigate('/');
          break;
        case 'Fail':
        case 'Exception':
          toast.error(errorMessage || _(t`Please try again.`));
          setProposePending(false);
          break;
      }
    },
    [_, navigate],
  );

  useEffect(() => {
    if (isProposeOnV1) {
      handleAddProposalState(proposeOnTimelockV1State);
    } else {
      handleAddProposalState(proposeState);
    }
  }, [proposeState, proposeOnTimelockV1State, isProposeOnV1, handleAddProposalState]);

  const submitDisabled =
    isFormInvalid || hasActiveOrPendingProposal || !hasEnoughVote || isProposePending;

  const submitLabel = (() => {
    if (isProposePending) return 'Submitting…';
    if (hasActiveOrPendingProposal) return 'You already have an active or pending proposal';
    if (!hasEnoughVote) {
      return proposalThreshold != null
        ? `You need ${proposalThreshold + 1} votes to submit a proposal`
        : "You don't have enough votes to submit a proposal";
    }
    return 'Submit proposal';
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
            to="/"
            aria-label="Back to home"
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
          <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700 }}>New proposal</h1>
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
          Add one or more proposal actions and describe your proposal for the community. The
          proposal cannot be modified after submission, so verify all information before submitting.
          The voting period begins after 5 days and lasts for 5 days.
          <br />
          <br />
          You <strong style={{ color: 'var(--theme-text-primary)' }}>must</strong> maintain enough
          voting power to meet the proposal threshold until your proposal is executed, or anyone can
          cancel it.
        </div>

        <CampProposalForm
          title={titleValue}
          onTitleChange={setTitleValue}
          body={bodyValue}
          onBodyChange={setBodyValue}
          transactions={proposalTransactions}
          onAddTransaction={handleAddProposalAction}
          onRemoveTransaction={handleRemoveProposalAction}
        />

        {totalUSDCPayment > 0 && tokenBuyerTopUpEth !== '0' && (
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

        {isDaoGteV3 && config.featureToggles.proposeOnV1 && (
          <div style={{ fontSize: 12, color: 'var(--theme-text-secondary)' }}>
            Looking for treasury v1?{' '}
            <button
              type="button"
              onClick={() => setIsV1OptionVisible(v => !v)}
              style={{
                background: 'transparent',
                border: 'none',
                color: 'var(--theme-accent)',
                cursor: 'pointer',
                padding: 0,
                fontFamily: 'inherit',
                fontSize: 'inherit',
                textDecoration: 'underline',
              }}
            >
              {isV1OptionVisible ? 'Hide option' : 'Show option'}
            </button>
            {isV1OptionVisible && (
              <div
                style={{
                  marginTop: 8,
                  padding: '10px 12px',
                  border: '1px solid var(--theme-border-light, var(--theme-border))',
                  borderRadius: 'var(--theme-radius-md, 6px)',
                  background: 'var(--theme-bg-secondary, var(--theme-bg-card))',
                }}
              >
                <label
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    cursor: 'pointer',
                    color: 'var(--theme-text-primary)',
                    fontSize: 13,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isProposeOnV1}
                    onChange={() => setIsProposeOnV1(v => !v)}
                  />
                  Propose on treasury V1
                </label>
                <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--theme-text-muted)' }}>
                  Used to interact with assets owned by the{' '}
                  <a href={daoEtherscanLink} target="_blank" rel="noreferrer">
                    original treasury
                  </a>
                  . Most proposers can ignore this.
                </p>
              </div>
            )}
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
            to="/"
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
            onClick={handleCreateProposal}
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
