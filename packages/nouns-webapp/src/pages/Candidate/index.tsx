import { useCallback, useEffect, useMemo, useState } from 'react';

import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import clsx from 'clsx';
import dayjs from 'dayjs';
import advanced from 'dayjs/plugin/advancedFormat';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';
import { Alert, Button, Col, Row, Spinner } from 'react-bootstrap';
import { Link, useParams } from 'react-router';
import { first, isNonNullish } from 'remeda';
import { toast } from 'sonner';
import { encodePacked, encodeAbiParameters, keccak256, stringToBytes, type Hex } from 'viem';
import { useAccount, useBlockNumber, useSignTypedData } from 'wagmi';

import { CandidateVersionSlider } from '@/components/CandidateVersionSlider';
import ProposalCandidateContent from '@/components/ProposalContent/ProposalCandidateContent';
import CandidateHeader from '@/components/ProposalHeader/CandidateHeader';
import VoteSignals from '@/components/VoteSignals/VoteSignals';
import { NOUN_WTF_CLIENT_ID } from '@/config';
import { nounsGovernorAddress } from '@/contracts/nouns-governor.gen';
import { useAppSelector } from '@/hooks';
import { useCandidateVersionsFromLogs } from '@/hooks/useCandidatesFromLogs';
import useModalBodyLock from '@/hooks/useModalBodyLock';
import Section from '@/layout/Section';
import { checkHasActiveOrPendingProposalOrCandidate } from '@/utils/proposals';
import {
  formatProposalTransactionDetails,
  ProposalState,
  useProposal,
  useProposalCount,
  useProposalThreshold,
  usePropose,
} from '@/wrappers/nounsDao';
import {
  useAddSignature,
  useCancelCandidate,
  useCandidateFeedback,
  useCandidateProposal,
  useProposeBySigs,
} from '@/wrappers/nounsData';
import { useUserVotes } from '@/wrappers/nounToken';

import classes from './Candidate.module.css';

dayjs.extend(utc);
dayjs.extend(timezone);
dayjs.extend(advanced);

// ─── Sponsor Modal ────────────────────────────────────────────────────────────

/* eslint-disable react/prop-types */
const SponsorModal: React.FC<{
  onClose: () => void;
  onSubmit: (expirationTimestamp: number, reason: string) => void;
  isPending: boolean;
}> = ({ onClose, onSubmit, isPending }) => {
  useModalBodyLock(true);
  // Default expiration: 7 days from now
  const defaultDate = dayjs().add(7, 'day').format('YYYY-MM-DD');
  const [expirationDate, setExpirationDate] = useState(defaultDate);
  const [reason, setReason] = useState('');

  const handleSubmit = () => {
    const expiry = Math.floor(new Date(expirationDate).getTime() / 1000);
    if (expiry <= Math.floor(Date.now() / 1000)) {
      toast.error('Expiration date must be in the future');
      return;
    }
    onSubmit(expiry, reason);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.6)',
      }}
      onClick={e => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        style={{
          background: '#1a1a2e',
          borderRadius: 16,
          padding: '28px 32px',
          maxWidth: 480,
          width: '90%',
          color: '#fff',
        }}
      >
        <h3 style={{ fontWeight: 700, fontSize: '1.3rem', marginBottom: 20, color: '#fff' }}>
          Sponsor candidate
        </h3>

        <label style={{ display: 'block', marginBottom: 6, color: '#aaa', fontSize: '0.9rem' }}>
          Signature expiration date
        </label>
        <input
          type="date"
          value={expirationDate}
          onChange={e => setExpirationDate(e.target.value)}
          min={dayjs().add(1, 'day').format('YYYY-MM-DD')}
          style={{
            width: '100%',
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid #333',
            background: '#0d0d1a',
            color: '#fff',
            fontSize: '1rem',
            marginBottom: 16,
          }}
        />

        <label style={{ display: 'block', marginBottom: 6, color: '#aaa', fontSize: '0.9rem' }}>
          Optional message
        </label>
        <textarea
          value={reason}
          onChange={e => setReason(e.target.value)}
          placeholder="..."
          rows={4}
          style={{
            width: '100%',
            padding: '10px 14px',
            borderRadius: 10,
            border: '1px solid #333',
            background: '#0d0d1a',
            color: '#fff',
            fontSize: '0.95rem',
            resize: 'vertical',
            marginBottom: 16,
          }}
        />

        <p style={{ color: '#999', fontSize: '0.85rem', lineHeight: 1.5, marginBottom: 20 }}>
          Note that once the candidate is promoted to a proposal, sponsors will need to wait until
          the proposal is queued or defeated before they can author or sponsor other proposals.
        </p>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '10px 24px',
              borderRadius: 10,
              border: '1px solid #444',
              background: 'transparent',
              color: '#fff',
              cursor: 'pointer',
              fontSize: '0.95rem',
            }}
          >
            Close
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending}
            style={{
              padding: '10px 24px',
              borderRadius: 10,
              border: 'none',
              background: '#3b82f6',
              color: '#fff',
              cursor: isPending ? 'not-allowed' : 'pointer',
              fontSize: '0.95rem',
              fontWeight: 600,
              opacity: isPending ? 0.6 : 1,
            }}
          >
            {isPending ? 'Signing...' : 'Submit signature'}
          </button>
        </div>
      </div>
    </div>
  );
};
/* eslint-enable react/prop-types */

// ─── Helper: compute encodedProp for addSignature ─────────────────────────────

function calcProposalEncodeData({
  proposer,
  targets,
  values,
  signatures,
  calldatas,
  description,
  proposalIdToUpdate,
}: {
  proposer: Hex;
  targets: Hex[];
  values: bigint[];
  signatures: string[];
  calldatas: Hex[];
  description: string;
  proposalIdToUpdate?: number;
}): Hex {
  const signatureHashes = signatures.map(sig => keccak256(stringToBytes(sig)));
  const calldatasHashes = calldatas.map(cd => keccak256(cd));

  const params: [string, unknown][] = [];

  if (proposalIdToUpdate != null && proposalIdToUpdate > 0) {
    params.push(['uint256', BigInt(proposalIdToUpdate)]);
  }

  params.push(
    ['address', proposer],
    ['bytes32', keccak256(encodePacked(['address[]'], [targets]))],
    ['bytes32', keccak256(encodePacked(['uint256[]'], [values]))],
    ['bytes32', keccak256(encodePacked(['bytes32[]'], [signatureHashes as Hex[]]))],
    ['bytes32', keccak256(encodePacked(['bytes32[]'], [calldatasHashes as Hex[]]))],
    ['bytes32', keccak256(stringToBytes(description))],
  );

  return encodeAbiParameters(
    params.map(([type]) => ({ type: type as string })),
    params.map(p => p[1]),
  );
}

// ─── Candidate Page ───────────────────────────────────────────────────────────

const CandidatePage = () => {
  // '*' splat param, not `id` — candidate ids embed the slug, which can contain "/"
  const { '*': id } = useParams();
  const [isProposer, setIsProposer] = useState<boolean>(false);
  const [isCancelPending, setCancelPending] = useState<boolean>(false);
  const [dataFetchPollInterval, setDataFetchPollInterval] = useState<number>(0);
  const [, setIsSignerWithActiveOrPendingProposal] = useState<boolean | undefined>(undefined);
  const { cancelCandidate, cancelCandidateState } = useCancelCandidate();
  const { proposeBySigs, proposeBySigsState } = useProposeBySigs();
  const { propose, proposeState } = usePropose();
  const { addSignature, addSignatureState } = useAddSignature();
  const { signTypedDataAsync } = useSignTypedData();
  const [isPromotePending, setPromotePending] = useState(false);
  const [isSponsorPending, setSponsorPending] = useState(false);
  const [showSponsorModal, setShowSponsorModal] = useState(false);
  const activeAccount = useAppSelector(state => state.account.activeAccount);
  const isWalletConnected = activeAccount !== undefined;
  const { data: currentBlock } = useBlockNumber();
  const { data: candidate, refetch: candidateRefetch } = useCandidateProposal(
    id ?? '',
    dataFetchPollInterval,
    false,
    currentBlock,
  );
  const { address: account } = useAccount();
  const proposalThreshold = (useProposalThreshold() ?? 0) + 1;
  const userVotes = useUserVotes();
  const latestProposalId = useProposalCount();
  const latestProposal = useProposal(latestProposalId ?? 0);
  const feedback = useCandidateFeedback(id ?? '', dataFetchPollInterval);
  const { versions, loading: versionsLoading } = useCandidateVersionsFromLogs(id ?? '');
  const [activeVersionIdx, setActiveVersionIdx] = useState<number>(-1); // -1 = latest
  const [isProposal, setIsProposal] = useState<boolean>(false);
  const [isUpdateToProposal, setIsUpdateToProposal] = useState<boolean>(false);
  const originalProposal = useProposal(candidate?.proposalIdToUpdate ?? 0);
  const isParentProposalUpdatable = originalProposal?.status === ProposalState.UPDATABLE;

  const handleRefetchData = () => {
    feedback.refetch();
  };

  useEffect(() => {
    if (candidate && account) {
      setIsProposer(candidate.proposer.toLowerCase() === account.toLowerCase());
    }
    if (candidate?.isProposal === true) {
      setIsProposal(true);
    }
    if (candidate?.proposalIdToUpdate != null && +candidate.proposalIdToUpdate > 0) {
      setIsUpdateToProposal(true);
    }
  }, [candidate, account]);

  useEffect(() => {
    if (latestProposal && account) {
      const status = checkHasActiveOrPendingProposalOrCandidate(
        latestProposal.status,
        latestProposal.proposer,
        account,
      );
      setIsSignerWithActiveOrPendingProposal(status);
    }
  }, [latestProposal, account]);

  const { _ } = useLingui();

  const onTransactionStateChange = useCallback(
    (
      { errorMessage, status }: { errorMessage?: string; status: string },
      successMessage?: string,
      setPending?: (isPending: boolean) => void,
      getErrorMessage?: (error?: string) => string | undefined,
      onFinalState?: () => void,
    ) => {
      switch (status) {
        case 'None':
          setPending?.(false);
          break;
        case 'Mining':
          setPending?.(true);
          break;
        case 'Success':
          toast.success(successMessage || _(`Transaction Successful!`));
          setPending?.(false);
          onFinalState?.();
          break;
        case 'Fail':
          toast.error(errorMessage || _(`Please try again.`));
          setPending?.(false);
          onFinalState?.();
          break;
        case 'Exception':
          toast.error(getErrorMessage?.(errorMessage) || _(`Please try again.`));
          setPending?.(false);
          onFinalState?.();
          break;
      }
    },
    [_],
  );

  // handle cancel candidate
  useEffect(
    () =>
      onTransactionStateChange(
        cancelCandidateState,
        _(`Proposal Candidate Canceled!`),
        setCancelPending,
      ),
    [cancelCandidateState, onTransactionStateChange, _],
  );

  // handle promote to proposal (works for both propose and proposeBySigs)
  useEffect(
    () =>
      onTransactionStateChange(
        proposeBySigsState,
        _(`Candidate promoted to on-chain proposal!`),
        setPromotePending,
      ),
    [proposeBySigsState, onTransactionStateChange, _],
  );
  useEffect(
    () =>
      onTransactionStateChange(
        proposeState,
        _(`Candidate promoted to on-chain proposal!`),
        setPromotePending,
      ),
    [proposeState, onTransactionStateChange, _],
  );

  // handle sponsor (addSignature) tx state
  useEffect(
    () =>
      onTransactionStateChange(
        addSignatureState,
        _(`Signature submitted! You are now sponsoring this candidate.`),
        setSponsorPending,
        undefined,
        () => {
          setShowSponsorModal(false);
          // Ponder lags the confirmed block — retry until it indexes the new signature.
          let tries = 0;
          const retryRefetch = () => {
            candidateRefetch();
            if (++tries < 6) setTimeout(retryRefetch, 4000);
          };
          retryRefetch();
        },
      ),
    [addSignatureState, onTransactionStateChange, _, candidateRefetch],
  );

  const destructiveStateAction = (() => {
    return () => {
      if (candidate?.id) {
        return cancelCandidate({ args: [candidate.slug] });
      }
    };
  })();

  // ── Promote handler (proposer-only or has enough sigs) ────────────────────

  const handlePromote = useCallback(() => {
    if (!candidate) return;
    const content = candidate.version.content;
    const description = content.description ?? '';
    const callerHasEnoughVotes = (userVotes ?? 0) >= proposalThreshold;

    if (callerHasEnoughVotes) {
      return propose({
        args: [
          content.targets ?? [],
          (content.values ?? []).map(v => BigInt(v)),
          content.signatures ?? [],
          (content.calldatas ?? []) as `0x${string}`[],
          description,
          NOUN_WTF_CLIENT_ID,
        ],
      });
    }

    // Need signatures via proposeBySigs
    const nowSec = Math.floor(Date.now() / 1000);
    const activeSignatures = (content.contentSignatures ?? [])
      .filter(s => !s.canceled && s.expirationTimestamp > nowSec)
      .map(s => ({
        sig: s.sig as `0x${string}`,
        signer: s.signer.id as `0x${string}`,
        expirationTimestamp: BigInt(s.expirationTimestamp),
      }));

    if (activeSignatures.length === 0) {
      toast.error('No valid signatures to submit. Signatures may be expired or canceled.');
      return;
    }

    return proposeBySigs({
      args: [
        activeSignatures,
        content.targets ?? [],
        (content.values ?? []).map(v => BigInt(v)),
        content.signatures ?? [],
        (content.calldatas ?? []) as `0x${string}`[],
        description,
        NOUN_WTF_CLIENT_ID,
      ],
    });
  }, [candidate, proposeBySigs, propose, userVotes, proposalThreshold]);

  // ── Sponsor handler (EIP-712 sign + addSignature tx) ──────────────────────

  const handleSponsor = useCallback(
    async (expirationTimestamp: number, reason: string) => {
      if (!candidate || !account) return;
      const content = candidate.version.content;
      const description = content.description ?? '';
      const proposer = candidate.proposer as Hex;
      const targets = (content.targets ?? []) as Hex[];
      const values = (content.values ?? []).map(v => BigInt(v));
      const sigs = content.signatures ?? [];
      const calldatas = (content.calldatas ?? []) as Hex[];
      const proposalIdToUpdate = candidate.proposalIdToUpdate ?? 0;

      const isUpdate = proposalIdToUpdate > 0;

      setSponsorPending(true);
      try {
        // Step 1: EIP-712 typed data signature
        const daoAddress = nounsGovernorAddress[1]; // mainnet

        const typesBase = [
          { name: 'proposer', type: 'address' },
          { name: 'targets', type: 'address[]' },
          { name: 'values', type: 'uint256[]' },
          { name: 'signatures', type: 'string[]' },
          { name: 'calldatas', type: 'bytes[]' },
          { name: 'description', type: 'string' },
          { name: 'expiry', type: 'uint256' },
        ];

        const typesUpdate = [{ name: 'proposalId', type: 'uint256' }, ...typesBase];

        const messageBase = {
          proposer,
          targets,
          values,
          signatures: sigs,
          calldatas,
          description,
          expiry: BigInt(expirationTimestamp),
        };

        const signature = await signTypedDataAsync({
          domain: {
            name: 'Nouns DAO',
            chainId: 1,
            verifyingContract: daoAddress,
          },
          types: isUpdate ? { UpdateProposal: typesUpdate } : { Proposal: typesBase },
          primaryType: isUpdate ? 'UpdateProposal' : 'Proposal',
          message: isUpdate
            ? { proposalId: BigInt(proposalIdToUpdate), ...messageBase }
            : messageBase,
        });

        // Step 2: Compute encodedProp for the addSignature contract call
        const encodedProp = calcProposalEncodeData({
          proposer,
          targets,
          values,
          signatures: sigs,
          calldatas,
          description,
          proposalIdToUpdate: isUpdate ? proposalIdToUpdate : undefined,
        });

        // Step 3: Submit to NounsDAOData contract
        await addSignature({
          args: [
            signature,
            BigInt(expirationTimestamp),
            proposer,
            candidate.slug,
            BigInt(proposalIdToUpdate),
            encodedProp,
            reason,
          ],
        });
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Sponsor failed';
        if (!msg.includes('User rejected') && !msg.includes('user rejected')) {
          toast.error(msg);
        }
        setSponsorPending(false);
      }
    },
    [candidate, account, signTypedDataAsync, addSignature],
  );

  // ── Eligibility flags ─────────────────────────────────────────────────────

  const nowSec = Math.floor(Date.now() / 1000);
  const activeSignatureCount = (candidate?.version?.content?.contentSignatures ?? []).filter(
    s => !s.canceled && s.expirationTimestamp > nowSec,
  ).length;

  const callerVotes = userVotes ?? 0;
  const estimatedTotalPower = callerVotes + activeSignatureCount;

  // Promote: visible to proposer (if they have enough power or sigs) OR anyone with enough combined power
  const canPromote =
    candidate != null &&
    !isProposal &&
    !candidate.canceled &&
    isProposer &&
    estimatedTotalPower >= proposalThreshold;

  // Sponsor: visible to non-proposer Noun holders on active candidates
  const canSponsor =
    candidate != null && !isProposal && !candidate.canceled && !isProposer && callerVotes > 0;

  const primaryProposalId = first(candidate?.matchingProposalIds ?? []);

  // ── Version slider: build a virtual ProposalCandidate for the selected version ──
  const hasVersions = versions != null && versions.length > 1;
  const effectiveVersionIdx =
    activeVersionIdx < 0 && versions != null ? versions.length - 1 : activeVersionIdx;

  const displayCandidate = useMemo(() => {
    if (candidate == null) return undefined;
    if (!hasVersions || effectiveVersionIdx < 0) return candidate;
    const v = versions![effectiveVersionIdx];
    if (v == null) return candidate;
    // If viewing latest version, just use the candidate as-is
    if (effectiveVersionIdx === versions!.length - 1) return candidate;
    // Build virtual candidate with version's content
    const details = formatProposalTransactionDetails({
      targets: v.targets,
      signatures: v.signatures,
      values: v.values,
      calldatas: v.calldatas,
    });
    return {
      ...candidate,
      version: {
        content: {
          ...candidate.version.content,
          title: v.title,
          description: v.description,
          details,
          targets: v.targets,
          values: v.values,
          signatures: v.signatures,
          calldatas: v.calldatas,
        },
      },
    };
  }, [candidate, hasVersions, versions, effectiveVersionIdx]);

  return (
    <Section fullWidth={false} className={classes.votePage}>
      {/* notice for proposal updates */}
      {isNonNullish(candidate?.proposalIdToUpdate) &&
        candidate?.proposalIdToUpdate > 0 &&
        !isProposer && (
          <Alert variant="warning">
            <Trans>
              <strong>Note: </strong>
              This candidate is an update to{' '}
              <Link to={`/vote/${candidate?.proposalIdToUpdate}`}>
                Proposal {candidate?.proposalIdToUpdate}
              </Link>
              .
            </Trans>
          </Alert>
        )}
      {isProposal && (
        <Alert variant="success">
          <Trans>
            <strong>Note: </strong>
            This proposal candidate has been proposed onchain.
          </Trans>{' '}
          {primaryProposalId != null && (
            <Link to={`/vote/${primaryProposalId}`}>View the proposal here</Link>
          )}
        </Alert>
      )}
      <Col lg={12} className={classes.wrapper}>
        {!candidate && (
          <div
            className="d-flex justify-content-center align-items-center"
            style={{ minHeight: '100vh' }}
          >
            <Spinner animation="border" />
          </div>
        )}
        {candidate && (
          <CandidateHeader
            title={candidate.version.content.title}
            id={candidate.id}
            proposer={candidate.proposer}
            versionsCount={versions ? versions.length : candidate.versionsCount}
            createdTransactionHash={candidate.createdTransactionHash}
            lastUpdatedTimestamp={Number(candidate.lastUpdatedTimestamp)}
            isCandidate={true}
            isWalletConnected={isWalletConnected}
            isUpdateToProposal={isUpdateToProposal}
            submitButtonClickHandler={() => {}}
          />
        )}
      </Col>

      {/* ── Proposer functions (edit/cancel) ─────────────────────────────── */}
      {isProposer && !isProposal && (
        <Row>
          <Col lg={12}>
            <div className={classes.editCandidate}>
              <p>
                <span className={classes.proposerOptionsHeader}>
                  <Trans>Proposer functions</Trans>
                </span>
                <Trans>
                  Editing a proposal candidate will clear any previous sponsors and require each
                  sponsor to re-sign
                </Trans>
              </p>
              <div className={classes.buttons}>
                {/* eslint-disable-next-line @typescript-eslint/ban-ts-comment */}
                {/* @ts-ignore — TS2590: react-bootstrap Button union too complex */}
                <Button
                  onClick={destructiveStateAction}
                  disabled={isCancelPending}
                  variant="danger"
                  className={clsx(classes.destructiveTransitionStateButton, classes.button)}
                >
                  {isCancelPending ? (
                    <Spinner animation="border" />
                  ) : (
                    <Trans>Cancel candidate</Trans>
                  )}
                </Button>
                <Link
                  to={`/candidates/${id}/edit`}
                  className={clsx(classes.primaryButton, classes.button)}
                >
                  <Trans>Edit</Trans>
                </Link>
              </div>
            </div>
          </Col>
        </Row>
      )}

      {/* ── Promote to Proposal (proposer only) ─────────────────────────── */}
      {canPromote && isWalletConnected && (
        <Row>
          <Col lg={12}>
            <div className={classes.editCandidate} style={{ borderColor: '#43b369' }}>
              <p>
                <span className={classes.proposerOptionsHeader} style={{ color: '#43b369' }}>
                  Ready to promote
                </span>
                {activeSignatureCount > 0
                  ? `This candidate has ${activeSignatureCount} sponsor${activeSignatureCount !== 1 ? 's' : ''} (threshold: ${proposalThreshold}). `
                  : `You have enough voting power to promote this candidate (threshold: ${proposalThreshold}). `}
                Promote it to an on-chain proposal.
              </p>
              <div className={classes.buttons}>
                <Button
                  onClick={handlePromote}
                  disabled={isPromotePending}
                  variant="success"
                  className={clsx(classes.primaryButton, classes.button)}
                  style={{ background: '#43b369', borderColor: '#43b369', color: '#fff' }}
                >
                  {isPromotePending ? (
                    <Spinner animation="border" size="sm" />
                  ) : (
                    'Promote to Proposal'
                  )}
                </Button>
              </div>
            </div>
          </Col>
        </Row>
      )}

      {/* ── Sponsor button (non-proposer Noun holders) ───────────────────── */}
      {canSponsor && isWalletConnected && (
        <Row>
          <Col lg={12}>
            <div className={classes.editCandidate} style={{ borderColor: '#3b82f6' }}>
              <p>
                <span className={classes.proposerOptionsHeader} style={{ color: '#3b82f6' }}>
                  Sponsor this candidate
                </span>
                Add your signature to help this candidate reach the {proposalThreshold} vote
                threshold needed to become an on-chain proposal.
                {activeSignatureCount > 0 &&
                  ` Currently ${activeSignatureCount} sponsor${activeSignatureCount !== 1 ? 's' : ''}.`}
              </p>
              <div className={classes.buttons}>
                <Button
                  onClick={() => setShowSponsorModal(true)}
                  variant="primary"
                  className={clsx(classes.primaryButton, classes.button)}
                  style={{ background: '#3b82f6', borderColor: '#3b82f6', color: '#fff' }}
                >
                  Sponsor
                </Button>
              </div>
            </div>
          </Col>
        </Row>
      )}

      {candidate && (
        <Row>
          {/* Version timeline slider */}
          {hasVersions && (
            <Col lg={12}>
              <CandidateVersionSlider
                versions={versions!}
                activeVersion={effectiveVersionIdx}
                onChange={setActiveVersionIdx}
              />
            </Col>
          )}
          {!hasVersions && versionsLoading && candidate.versionsCount > 1 && (
            <Col lg={12}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 16px',
                  borderRadius: 12,
                  background: 'rgba(255,255,255,0.95)',
                  border: '1px solid rgba(0,0,0,0.1)',
                  marginBottom: 16,
                  fontSize: '0.8rem',
                  color: '#6b7280',
                  fontFamily: "'PT Root UI', sans-serif",
                }}
              >
                <Spinner animation="border" size="sm" /> Loading {candidate.versionsCount} versions
                from chain...
              </div>
            </Col>
          )}
          <Col lg={12}>
            <a className={classes.jump} href="#feedback">
              Jump to Sponsored Votes and Feedback
            </a>
          </Col>
          <Col lg={8} className={clsx(classes.proposal, classes.wrapper)}>
            <ProposalCandidateContent proposal={displayCandidate} />
          </Col>
          <Col id="feedback" lg={4} className={classes.sidebar}>
            <VoteSignals
              proposalId={candidate.id}
              proposer={candidate.proposer}
              versionTimestamp={BigInt(candidate?.lastUpdatedTimestamp ?? 0)}
              feedback={feedback.data}
              userVotes={userVotes}
              isCandidate={true}
              candidateSlug={candidate.slug}
              setDataFetchPollInterval={setDataFetchPollInterval}
              handleRefetch={handleRefetchData}
              isFeedbackClosed={isUpdateToProposal && !isParentProposalUpdatable}
            />
          </Col>
        </Row>
      )}

      {/* ── Sponsor Modal ────────────────────────────────────────────────── */}
      {showSponsorModal && (
        <SponsorModal
          onClose={() => setShowSponsorModal(false)}
          onSubmit={handleSponsor}
          isPending={isSponsorPending}
        />
      )}
    </Section>
  );
};

export default CandidatePage;
