/* eslint-disable @typescript-eslint/strict-boolean-expressions */
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
    const layerLabel =
      traitLayer === 'head'
        ? 'Head'
        : traitLayer === 'body'
          ? 'Body'
          : traitLayer === 'accessory'
            ? 'Accessory'
            : 'Glasses';
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
          const fnName =
            traitLayer === 'head'
              ? 'addHeads'
              : traitLayer === 'body'
                ? 'addBodies'
                : traitLayer === 'accessory'
                  ? 'addAccessories'
                  : 'addGlasses';
          const signature = `${fnName}(bytes,uint80,uint16)`;

          // Match probe.wtf encoding: ABI-encode the RLE as bytes[], then compress
          const {
            encodeAbiParameters: encodeParams,
            hexToBytes,
            bytesToHex,
          } = await import('viem');

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
          writer.write(uncompressedBytes as unknown as Uint8Array<ArrayBuffer>);
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

  // Artwork agreement — matches probe.wtf legal format exactly
  const AGREEMENT_URL =
    'https://ern3fbtsj23a2achuj5kqa4xtp2yvplqjy2r6cemo6ep52lfn2cq.arweave.net/JFuyhnJOtg0AR6J6qAOXm_WKvXBONR8IjHeI_ullboU';

  const agreementMessage = useMemo(() => {
    if (!address || !traitName) return '';
    return `I, the individual controlling Ethereum address ${address}, hereby waive all copyright and all related or neighboring rights, together with any associated claims or causes of action, to the extent permitted by law. I have read and understand the terms and intended legal effect of the Nouns Art Contribution Agreement, available at ${AGREEMENT_URL}, and hereby voluntarily elect to apply it to this contribution. Contribution name: ${traitName}. Contribution specification: ${traitImage ?? 'N/A'}.`;
  }, [address, traitName, traitImage]);

  const handleSignArtworkAgreement = async () => {
    if (!address) {
      toast.error('Connect wallet first');
      return;
    }
    try {
      const sig = await signMessageAsync({ message: agreementMessage });
      setArtworkSignature(sig);
      setArtworkAgreementSigned(true);
      // Append beautifully formatted legal agreement to proposal description
      setBodyValue(
        prev =>
          `${prev}\n\n---\n\n## CC0 Artwork Contribution Agreement\n\n> ${agreementMessage}\n\n| | |\n|---|---|\n| **Signer** | \`${address}\` |\n| **Signature** | \`${sig.slice(0, 32)}...${sig.slice(-8)}\` |\n| **Full Agreement** | [Nouns Art Contribution Agreement](${AGREEMENT_URL}) |\n| **License** | [CC0 1.0 Universal](https://creativecommons.org/publicdomain/zero/1.0/) |`,
      );
      toast.success('CC0 waiver signed!');
    } catch {
      toast.error('Failed to sign waiver');
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
        {/* CC0 Artwork Waiver — only for dream proposals */}
        {isDreamProposal && (
          <div
            style={{
              margin: '24px 0',
              borderRadius: 16,
              overflow: 'hidden',
              border: artworkAgreementSigned ? '2px solid #22c55e' : '2px solid #1a1a2e',
            }}
          >
            {/* Header */}
            <div
              style={{
                background: artworkAgreementSigned ? '#22c55e' : '#1a1a2e',
                padding: '14px 20px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ fontSize: '1.1rem' }}>
                  {artworkAgreementSigned ? '\u2713' : '\uD83D\uDD12'}
                </span>
                <span
                  style={{
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: '0.85rem',
                    letterSpacing: '0.02em',
                  }}
                >
                  {artworkAgreementSigned ? 'CC0 Waiver Signed' : 'CC0 Artwork Waiver Required'}
                </span>
              </div>
              {traitImage && (
                <img
                  src={traitImage}
                  alt={traitName ?? ''}
                  style={{
                    width: 32,
                    height: 32,
                    imageRendering: 'pixelated',
                    borderRadius: 6,
                    border: '2px solid rgba(255,255,255,0.3)',
                  }}
                />
              )}
            </div>

            {/* Body */}
            <div
              style={{
                padding: '16px 20px',
                background: artworkAgreementSigned ? '#f0fdf4' : '#fafafa',
              }}
            >
              {!artworkAgreementSigned ? (
                <>
                  <p
                    style={{
                      fontSize: '0.78rem',
                      color: '#374151',
                      lineHeight: 1.6,
                      marginBottom: 12,
                    }}
                  >
                    To add <strong>{traitName ?? 'this trait'}</strong> to the Nouns collection, you
                    must sign a CC0 waiver confirming this is your original work and releasing all
                    rights to the public domain.
                  </p>
                  <p style={{ fontSize: '0.7rem', color: '#6b7280', marginBottom: 16 }}>
                    This is a legal requirement for all artwork contributions to Nouns DAO.{' '}
                    <a
                      href={AGREEMENT_URL}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: '#3b82f6', textDecoration: 'underline' }}
                    >
                      Read the full Nouns Art Contribution Agreement
                    </a>
                  </p>

                  <button
                    type="button"
                    onClick={handleSignArtworkAgreement}
                    disabled={!address}
                    style={{
                      width: '100%',
                      padding: '12px 0',
                      borderRadius: 10,
                      border: 'none',
                      background: address ? '#1a1a2e' : '#d1d5db',
                      color: address ? '#fff' : '#9ca3af',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      cursor: address ? 'pointer' : 'not-allowed',
                      transition: 'all 0.15s',
                    }}
                  >
                    {address
                      ? '\uD83D\uDD0F Sign CC0 Waiver with Wallet'
                      : 'Connect Wallet to Sign'}
                  </button>
                </>
              ) : (
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <img
                      src={traitImage ?? ''}
                      alt={traitName ?? ''}
                      style={{
                        width: 40,
                        height: 40,
                        imageRendering: 'pixelated',
                        borderRadius: 8,
                        border: '1px solid #e5e7eb',
                      }}
                    />
                    <div>
                      <p style={{ fontWeight: 700, fontSize: '0.8rem', margin: 0 }}>
                        {traitName ?? 'Custom Trait'}
                      </p>
                      <p style={{ fontSize: '0.65rem', color: '#22c55e', margin: 0 }}>
                        Released under CC0 1.0
                      </p>
                    </div>
                  </div>
                  <div
                    style={{
                      background: '#ecfdf5',
                      borderRadius: 8,
                      padding: '8px 12px',
                      marginTop: 8,
                    }}
                  >
                    <p
                      style={{
                        fontSize: '0.6rem',
                        color: '#6b7280',
                        margin: '0 0 4px',
                        fontWeight: 600,
                      }}
                    >
                      SIGNATURE
                    </p>
                    <p
                      style={{
                        fontSize: '0.6rem',
                        color: '#374151',
                        fontFamily: 'monospace',
                        wordBreak: 'break-all',
                        margin: 0,
                      }}
                    >
                      {artworkSignature}
                    </p>
                  </div>
                  <a
                    href={AGREEMENT_URL}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      display: 'block',
                      textAlign: 'center',
                      marginTop: 10,
                      fontSize: '0.65rem',
                      color: '#3b82f6',
                    }}
                  >
                    View Full Agreement on Arweave &rarr;
                  </a>
                </div>
              )}
            </div>
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
