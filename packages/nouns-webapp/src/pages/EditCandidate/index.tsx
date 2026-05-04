import { useCallback, useEffect, useMemo, useState } from 'react';

import { t } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import clsx from 'clsx';
import { Alert, Button, Col, FormControl } from 'react-bootstrap';
import { Link, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import { formatEther } from 'viem';
import { useAccount } from 'wagmi';

import ProposalActionModal from '@/components/ProposalActionsModal';
import ProposalEditor from '@/components/ProposalEditor';
import ProposalTransactions from '@/components/ProposalTransactions';
import Section from '@/layout/Section';
import { Hex } from '@/utils/types';
import { ProposalTransaction } from '@/wrappers/nounsDao';
import {
  useCandidateProposal,
  useGetUpdateCandidateCost,
  useUpdateProposalCandidate,
} from '@/wrappers/nounsData';

import classes from '../CreateProposal/CreateProposal.module.css';

import navBarButtonClasses from '@/components/NavBarButton/NavBarButton.module.css';

const EditCandidatePage = () => {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { _ } = useLingui();
  const { address: account } = useAccount();

  const { loading: candidateLoading, data: candidate } = useCandidateProposal(id);
  const { updateProposalCandidate, updateProposalCandidateState } = useUpdateProposalCandidate();
  const updateCandidateCost = useGetUpdateCandidateCost();

  const [proposalTransactions, setProposalTransactions] = useState<ProposalTransaction[]>([]);
  const [titleValue, setTitleValue] = useState('');
  const [bodyValue, setBodyValue] = useState('');
  const [reasonValue, setReasonValue] = useState('');
  const [showTransactionFormModal, setShowTransactionFormModal] = useState(false);
  const [isProposePending, setProposePending] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Hydrate the form once when the candidate loads
  useEffect(() => {
    if (hydrated || !candidate) return;
    const content = candidate.version.content;
    const description = content.description ?? '';
    const firstNewline = description.indexOf('\n');
    const body =
      firstNewline >= 0 ? description.slice(firstNewline + 1).replace(/^\n+/, '') : '';
    setTitleValue(content.title ?? '');
    setBodyValue(body);
    const txs: ProposalTransaction[] = (content.targets ?? []).map((target, i) => ({
      address: target,
      value: BigInt(content.values?.[i] ?? 0),
      signature: content.signatures?.[i] ?? '',
      calldata: (content.calldatas?.[i] ?? '0x') as Hex,
    }));
    setProposalTransactions(txs);
    setHydrated(true);
  }, [candidate, hydrated]);

  const isProposer =
    !!account && !!candidate && candidate.proposer.toLowerCase() === account.toLowerCase();

  const handleAddProposalAction = useCallback(
    (transaction: ProposalTransaction | ProposalTransaction[]) => {
      const txs = Array.isArray(transaction) ? transaction : [transaction];
      const normalized = txs.map(t => ({
        ...t,
        calldata: (t.calldata?.startsWith('0x') ? t.calldata : `0x${t.calldata}`) as Hex,
      }));
      setProposalTransactions(prev => [...prev, ...normalized]);
      setShowTransactionFormModal(false);
    },
    [],
  );

  const handleRemoveProposalAction = useCallback((index: number) => {
    setProposalTransactions(prev => prev.filter((_, i) => i !== index));
  }, []);

  const isFormInvalid = useMemo(
    () => !proposalTransactions.length || titleValue === '' || bodyValue === '',
    [titleValue, bodyValue, proposalTransactions.length],
  );

  const handleSubmit = async () => {
    if (!candidate) return;
    await updateProposalCandidate({
      args: [
        proposalTransactions.map(({ address }) => address as `0x${string}`),
        proposalTransactions.map(({ value }) => BigInt(value ?? '0')),
        proposalTransactions.map(({ signature }) => signature),
        proposalTransactions.map(({ calldata }) => calldata as `0x${string}`),
        `# ${titleValue}\n\n${bodyValue}`,
        candidate.slug,
        BigInt(candidate.proposalIdToUpdate ?? 0),
        reasonValue,
      ],
      value: updateCandidateCost ?? 0n,
    });
  };

  useEffect(() => {
    switch (updateProposalCandidateState.status) {
      case 'None':
        setProposePending(false);
        break;
      case 'Mining':
        setProposePending(true);
        break;
      case 'Success':
        toast.success(_(t`Candidate Updated!`));
        setProposePending(false);
        navigate(`/candidates/${id}`);
        break;
      case 'Fail':
      case 'Exception':
        toast.error(updateProposalCandidateState?.errorMessage || _(t`Please try again.`));
        setProposePending(false);
        break;
    }
  }, [updateProposalCandidateState, _, id, navigate]);

  if (candidateLoading) {
    return (
      <Section fullWidth={false} className={classes.createProposalPage}>
        <Col lg={{ span: 8, offset: 2 }} className={classes.createProposalForm}>
          <p>
            <Trans>Loading candidate…</Trans>
          </p>
        </Col>
      </Section>
    );
  }

  if (!candidate) {
    return (
      <Section fullWidth={false} className={classes.createProposalPage}>
        <Col lg={{ span: 8, offset: 2 }} className={classes.createProposalForm}>
          <Alert variant="danger">
            <Trans>Candidate not found.</Trans>
          </Alert>
          <Link to="/candidates">← Back to candidates</Link>
        </Col>
      </Section>
    );
  }

  if (!account) {
    return (
      <Section fullWidth={false} className={classes.createProposalPage}>
        <Col lg={{ span: 8, offset: 2 }} className={classes.createProposalForm}>
          <Alert variant="info">
            <Trans>Connect your wallet to edit this candidate.</Trans>
          </Alert>
          <Link to={`/candidates/${id}`}>← Back to candidate</Link>
        </Col>
      </Section>
    );
  }

  if (!isProposer) {
    return (
      <Section fullWidth={false} className={classes.createProposalPage}>
        <Col lg={{ span: 8, offset: 2 }} className={classes.createProposalForm}>
          <Alert variant="warning">
            <Trans>Only the original proposer can edit this candidate.</Trans>
          </Alert>
          <Link to={`/candidates/${id}`}>← Back to candidate</Link>
        </Col>
      </Section>
    );
  }

  return (
    <Section fullWidth={false} className={classes.createProposalPage}>
      <ProposalActionModal
        onDismiss={() => setShowTransactionFormModal(false)}
        show={showTransactionFormModal}
        onActionAdd={handleAddProposalAction}
      />

      <Col lg={{ span: 8, offset: 2 }} className={classes.createProposalForm}>
        <div className={classes.wrapper}>
          <Link to={`/candidates/${id}`}>
            <button className={clsx(classes.backButton, navBarButtonClasses.whiteInfo)}>←</button>
          </Link>
          <h3 className={classes.heading}>
            <Trans>Edit Proposal Candidate</Trans>
          </h3>
        </div>

        <Alert variant="warning" className={classes.voterIneligibleAlert}>
          <Trans>
            Editing this candidate will clear all existing sponsor signatures. Each sponsor will
            need to re-sign after the edit.
          </Trans>
          <br />
          <br />
          <strong>
            <Trans>
              Edit fee: {updateCandidateCost ? formatEther(updateCandidateCost) : '0'} ETH
            </Trans>
          </strong>
        </Alert>

        <div className="d-grid">
          <Button
            className={classes.proposalActionButton}
            variant="dark"
            onClick={() => setShowTransactionFormModal(true)}
          >
            <Trans>Add Action</Trans>
          </Button>
        </div>
        <ProposalTransactions
          proposalTransactions={proposalTransactions}
          onRemoveProposalTransaction={handleRemoveProposalAction}
        />

        <ProposalEditor
          title={titleValue}
          body={bodyValue}
          onTitleInput={setTitleValue}
          onBodyInput={setBodyValue}
          isCandidate={true}
        />

        <div style={{ marginTop: 16 }}>
          <label
            htmlFor="edit-reason"
            style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}
          >
            <Trans>Reason for edit (optional)</Trans>
          </label>
          <FormControl
            as="textarea"
            id="edit-reason"
            rows={2}
            value={reasonValue}
            placeholder="e.g. Fixing typo / adjusting transaction value"
            onChange={e => setReasonValue(e.target.value)}
          />
        </div>

        {/* eslint-disable-next-line @typescript-eslint/ban-ts-comment */}
        {/* @ts-ignore — TS2590: react-bootstrap Button union too complex */}
        <Button
          className={classes.createProposalButton}
          disabled={isFormInvalid || isProposePending}
          onClick={handleSubmit}
          style={{ marginTop: 24 }}
        >
          {isProposePending ? <Trans>Submitting…</Trans> : <Trans>Submit Edit</Trans>}
        </Button>
        <p className={classes.feeNotice}>
          <Trans>
            {updateCandidateCost ? formatEther(updateCandidateCost) : '0'} ETH fee upon submission
          </Trans>
        </p>
      </Col>
    </Section>
  );
};

export default EditCandidatePage;
