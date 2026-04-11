import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { t } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';
import { Trans } from '@lingui/react/macro';
import clsx from 'clsx';
import { Alert, Button, Col } from 'react-bootstrap';
import { Link, useSearchParams } from 'react-router';
import { withStepProgress } from 'react-stepz';
import { toast } from 'sonner';
import { formatEther } from 'viem';
import { useAccount, useSignMessage } from 'wagmi';

import CreateCandidateButton from '@/components/CreateCandidateButton';
import ProposalActionModal from '@/components/ProposalActionsModal';
import ProposalEditor from '@/components/ProposalEditor';
import ProposalTransactions from '@/components/ProposalTransactions';
import { nounsTokenBuyerAddress } from '@/contracts';
import Section from '@/layout/Section';
import { useEthNeeded } from '@/utils/tokenBuyerContractUtils/tokenBuyer';
import { Hex } from '@/utils/types';
import { defaultChain } from '@/wagmi';
import { ProposalTransaction, useProposalThreshold } from '@/wrappers/nounsDao';
import { useCreateProposalCandidate, useGetCreateCandidateCost } from '@/wrappers/nounsData';
import { useUserVotes } from '@/wrappers/nounToken';

import classes from '../CreateProposal/CreateProposal.module.css';

import navBarButtonClasses from '@/components/NavBarButton/NavBarButton.module.css';

const CreateCandidatePage = () => {
  const [proposalTransactions, setProposalTransactions] = useState<ProposalTransaction[]>([]);
  const [titleValue, setTitleValue] = useState('');
  const [bodyValue, setBodyValue] = useState('');
  const [slug, setSlug] = useState('');
  const [totalUSDCPayment, setTotalUSDCPayment] = useState<number>(0);
  const [tokenBuyerTopUpEth, setTokenBuyerTopUpETH] = useState<string>('0');
  const { createProposalCandidate, createProposalCandidateState } = useCreateProposalCandidate();
  const availableVotes = useUserVotes();
  const proposalThreshold = useProposalThreshold();
  const chainId = defaultChain.id;
  const ethNeeded = useEthNeeded(nounsTokenBuyerAddress[chainId], totalUSDCPayment);
  const createCandidateCost = useGetCreateCandidateCost();
  const [showTransactionFormModal, setShowTransactionFormModal] = useState(false);
  const [isProposePending, setProposePending] = useState(false);
  const { _ } = useLingui();

  const hasVotes = availableVotes && availableVotes > 0;
  const [searchParams] = useSearchParams();
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();

  // Dream trait pre-fill state
  const dreamId = searchParams.get('dreamId');
  const traitLayer = searchParams.get('traitLayer');
  const traitImage = searchParams.get('traitImage');
  const traitName = searchParams.get('traitName');
  const isDreamProposal = !!dreamId && !!traitLayer;
  const [artworkAgreementSigned, setArtworkAgreementSigned] = useState(false);
  const [artworkSignature, setArtworkSignature] = useState('');
  const dreamInitRef = useRef(false);

  // NounsDescriptor address
  const DESCRIPTOR_ADDRESS = '0x33a9c445fb4fb21f2c030a6b2d3e2f12d017bfac' as const;

  // Auto-add trait TX when coming from a dream
  useEffect(() => {
    if (!isDreamProposal || dreamInitRef.current) return;
    dreamInitRef.current = true;

    // Pre-fill title and slug
    const name = traitName ?? 'Custom Trait';
    const layerLabel = traitLayer === 'head' ? 'Head' : traitLayer === 'body' ? 'Body' : traitLayer === 'accessory' ? 'Accessory' : 'Glasses';
    handleTitleInput(`Add ${name} ${layerLabel} to Nouns Collection`);
    setBodyValue(
      `## Summary\n\nThis proposal adds a new ${layerLabel.toLowerCase()} trait "${name}" to the Nouns collection.\n\n## Artwork\n\n${traitImage ? `![${name}](${traitImage})` : ''}\n\n### Proposed via noun.wtf/probe`,
    );
    setSlug(`nounwtf-dream-${dreamId}`);

    // Build the addHeads/addBodies/etc. calldata
    // For now, add a placeholder TX targeting the descriptor
    // The actual RLE encoding happens when the trait image is loaded
    if (traitImage) {
      (async () => {
        try {
          // Load the trait image and encode to RLE
          const { fileToImageData, encodeImageToRLE } = await import('@/lib/rleEncode');
          const response = await fetch(traitImage);
          const blob = await response.blob();
          const file = new File([blob], `${name}.png`, { type: 'image/png' });
          const imgData = await fileToImageData(file);
          const encoded = encodeImageToRLE(imgData, name);

          // Build the descriptor function signature based on layer
          const fnName = traitLayer === 'head' ? 'addHeads' : traitLayer === 'body' ? 'addBodies' : traitLayer === 'accessory' ? 'addAccessories' : 'addGlasses';
          const signature = `${fnName}(bytes,uint80,uint16)`;

          // Match probe.wtf encoding: ABI-encode the RLE as bytes[], then compress
          const { encodeAbiParameters: encodeParams, hexToBytes, bytesToHex } = await import('viem');

          // Step 1: ABI-encode the raw RLE data as bytes[] (array of 1 element)
          const abiEncodedArtwork = encodeParams(
            [{ type: 'bytes[]' }],
            [[encoded.data as `0x${string}`]],
          );

          // Step 2: Compress the ABI-encoded bytes with deflateRaw
          const uncompressedBytes = hexToBytes(abiEncodedArtwork);
          const decompressedLength = uncompressedBytes.length;

          const cs = new CompressionStream('deflate-raw');
          const writer = cs.writable.getWriter();
          writer.write(uncompressedBytes);
          writer.close();
          const compressedBuf = await new Response(cs.readable).arrayBuffer();
          const compressedHex = bytesToHex(new Uint8Array(compressedBuf));

          // ABI-encode: compressed bytes + original length + image count
          const { encodeAbiParameters } = await import('viem');
          const calldata = encodeAbiParameters(
            [
              { name: 'encodedCompressed', type: 'bytes' },
              { name: 'decompressedLength', type: 'uint80' },
              { name: 'imageCount', type: 'uint16' },
            ],
            [compressedHex as `0x${string}`, BigInt(decompressedLength), 1],
          );

          handleAddProposalAction({
            address: DESCRIPTOR_ADDRESS,
            value: 0n,
            signature,
            calldata,
          });
        } catch (err) {
          console.error('Failed to encode trait:', err);
          toast.error('Failed to encode trait artwork');
        }
      })();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDreamProposal]);

  // Artwork agreement signing
  const handleSignArtworkAgreement = async () => {
    if (!address) { toast.error('Connect wallet first'); return; }
    const message = `I, ${address}, agree to contribute the artwork "${traitName ?? 'Custom Trait'}" under the CC0 1.0 Universal Public Domain Dedication.\n\nThis artwork is my original creation, and I waive all copyright and related rights.\n\nhttps://creativecommons.org/publicdomain/zero/1.0/`;
    try {
      const sig = await signMessageAsync({ message });
      setArtworkSignature(sig);
      setArtworkAgreementSigned(true);
      // Append agreement to proposal body
      setBodyValue(prev => `${prev}\n\n---\n\n### Artwork Contribution Agreement\n\nSigned by: ${address}\nSignature: ${sig}\n\nCC0 1.0 Universal Public Domain Dedication`);
      toast.success('Artwork agreement signed!');
    } catch (err) {
      toast.error('Failed to sign agreement');
    }
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
    if (ethNeeded !== undefined && ethNeeded !== tokenBuyerTopUpEth && totalUSDCPayment > 0) {
      const hasTokenBuyerTopTop =
        proposalTransactions.filter(txn => txn.address === nounsTokenBuyerAddress[chainId]).length >
        0;

      // Add a new top-up txn if one isn't there already, else add to the existing one
      if (Number(ethNeeded) > 0 && !hasTokenBuyerTopTop) {
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
              .map((txn, index: number) => {
                if (txn.address === nounsTokenBuyerAddress[chainId]) {
                  return index;
                } else {
                  return -1;
                }
              })
              .filter(n => n >= 0) ?? new Array<number>();

          const transactionsList = proposalTransactions;
          if (indexOfTokenBuyerTopUp.length > 0) {
            transactionsList[indexOfTokenBuyerTopUp[0]].value = BigInt(ethNeeded);
            setProposalTransactions(transactionsList);
          }
        }
      }

      setTokenBuyerTopUpETH(ethNeeded ?? '0');
    }
  }, [
    chainId,
    ethNeeded,
    handleAddProposalAction,
    handleRemoveProposalAction,
    proposalTransactions,
    tokenBuyerTopUpEth,
    totalUSDCPayment,
  ]);

  const handleTitleInput = useCallback(
    (title: string) => {
      setTitleValue(title);
      setSlug(
        title
          .toLowerCase()
          .replace(/ /g, '-')
          .replace(/[^\w-]+/g, ''),
      );
    },
    [setTitleValue],
  );

  const handleBodyInput = useCallback(
    (body: string) => {
      setBodyValue(body);
    },
    [setBodyValue],
  );

  const isFormInvalid = useMemo(
    () => !proposalTransactions.length || titleValue === '' || bodyValue === '',
    [titleValue, bodyValue, proposalTransactions.length],
  );

  const handleCreateProposal = async () => {
    await createProposalCandidate({
      args: [
        proposalTransactions.map(({ address }) => address as `0x${string}`), // Targets
        proposalTransactions.map(({ value }) => BigInt(value ?? '0')), // Values
        proposalTransactions.map(({ signature }) => signature), // Signatures
        proposalTransactions.map(({ calldata }) => calldata as `0x${string}`), // Calldatas
        `# ${titleValue}\n\n${bodyValue}`, // Description
        slug, // Slug
        0n, // proposalIdToUpdate - use 0 for new proposals
      ],
      value: hasVotes ? 0n : createCandidateCost, // Fee for non-nouners
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
        toast.success(_(t`Candidate Created!`));
        setProposePending(false);
        break;
      case 'Fail':
      case 'Exception':
        toast.error(createProposalCandidateState?.errorMessage || _(t`Please try again.`));
        setProposePending(false);
        break;
    }
  }, [createProposalCandidateState, _]);

  return (
    <Section fullWidth={false} className={classes.createProposalPage}>
      <ProposalActionModal
        onDismiss={() => setShowTransactionFormModal(false)}
        show={showTransactionFormModal}
        onActionAdd={handleAddProposalAction}
      />

      <Col lg={{ span: 8, offset: 2 }} className={classes.createProposalForm}>
        <div className={classes.wrapper}>
          <Link to={'/candidates'}>
            <button className={clsx(classes.backButton, navBarButtonClasses.whiteInfo)}>←</button>
          </Link>
          <h3 className={classes.heading}>
            <Trans>Create Proposal Candidate</Trans>
          </h3>
        </div>

        <Alert variant="secondary" className={classes.voterIneligibleAlert}>
          <Trans>
            Proposal candidates can be created by anyone. If a candidate receives enough signatures
            by Nouns voters, it can be promoted to a proposal.{' '}
          </Trans>
          <br />
          <br />

          <strong>
            <Trans>
              Submissions are free for Nouns voters. Non-voters can submit for a{' '}
              {createCandidateCost ? formatEther(createCandidateCost) : '0'} ETH fee.
            </Trans>
          </strong>
        </Alert>
        <div className="d-grid">
          {/* @ts-expect-error — react-bootstrap union type too complex */}
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
        {totalUSDCPayment > 0 && (
          <Alert variant="secondary" className={classes.tokenBuyerNotif}>
            <b>
              <Trans>Note</Trans>
            </b>
            :{' '}
            <Trans>
              Because this proposal contains a USDC fund transfer action we&apos;ve added an
              additional ETH transaction to refill the TokenBuyer contract. This action allows to
              DAO to continue to trustlessly acquire USDC to fund proposals like this.
            </Trans>
          </Alert>
        )}
        <ProposalEditor
          title={titleValue}
          body={bodyValue}
          onTitleInput={handleTitleInput}
          onBodyInput={handleBodyInput}
          isCandidate={true}
        />
        {/* Artwork Agreement — only for dream proposals */}
        {isDreamProposal && (
          <div style={{
            margin: '20px 0',
            padding: '16px 20px',
            borderRadius: 12,
            border: artworkAgreementSigned ? '2px solid #22c55e' : '2px solid #f59e0b',
            background: artworkAgreementSigned ? '#f0fdf4' : '#fffbeb',
          }}>
            <h4 style={{ fontWeight: 700, fontSize: '0.9rem', marginBottom: 8 }}>
              {artworkAgreementSigned ? '✓ Artwork Agreement Signed' : 'Artwork Contribution Agreement'}
            </h4>
            <p style={{ fontSize: '0.75rem', color: '#6b7280', marginBottom: 12 }}>
              By signing, you confirm this artwork is your original creation and you agree to release it
              under the <a href="https://creativecommons.org/publicdomain/zero/1.0/" target="_blank" rel="noreferrer" style={{ color: '#3b82f6' }}>CC0 1.0 Universal Public Domain Dedication</a>.
            </p>
            {traitImage && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                <img
                  src={traitImage}
                  alt={traitName ?? 'Trait'}
                  style={{ width: 48, height: 48, imageRendering: 'pixelated', borderRadius: 8, border: '1px solid #e5e7eb' }}
                />
                <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{traitName ?? 'Custom Trait'}</span>
              </div>
            )}
            {!artworkAgreementSigned ? (
              <Button
                variant="warning"
                size="sm"
                onClick={handleSignArtworkAgreement}
                disabled={!address}
                style={{ fontWeight: 700 }}
              >
                {address ? 'Sign Agreement with Wallet' : 'Connect Wallet to Sign'}
              </Button>
            ) : (
              <p style={{ fontSize: '0.65rem', color: '#22c55e', fontFamily: 'monospace', wordBreak: 'break-all' }}>
                Sig: {artworkSignature.slice(0, 20)}...{artworkSignature.slice(-8)}
              </p>
            )}
          </div>
        )}

        <CreateCandidateButton
          className={classes.createProposalButton}
          isLoading={isProposePending}
          proposalThreshold={proposalThreshold ?? undefined}
          hasActiveOrPendingProposal={false}
          isFormInvalid={isFormInvalid || (isDreamProposal && !artworkAgreementSigned)}
          handleCreateProposal={handleCreateProposal}
        />
        <p className={classes.feeNotice}>
          {!hasVotes && (
            <Trans>
              {createCandidateCost ? formatEther(createCandidateCost) : '0'} ETH fee upon submission
            </Trans>
          )}
        </p>
      </Col>
    </Section>
  );
};

export default withStepProgress(CreateCandidatePage);
