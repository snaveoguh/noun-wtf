import React from 'react';

import { useQuery } from '@apollo/client';
import { Trans } from '@lingui/react/macro';
import clsx from 'clsx';
import { Link } from 'react-router';

import ShortAddress from '@/components/ShortAddress';
import { relativeTimestamp } from '@/utils/timeUtils';
import { PartialProposal } from '@/wrappers/nounsDao';
import { ProposalCandidate } from '@/wrappers/nounsData';
import { delegateNounsAtBlockQuery } from '@/wrappers/subgraph';

import classes from './CandidateCard.module.css';
import CandidateSponsors from './CandidateSponsors';

type CandidateCardProps = {
  candidate: ProposalCandidate;
  nounsRequired: number;
  latestProposal?: PartialProposal;
  currentBlock?: bigint;
};

const CandidateCard: React.FC<Readonly<CandidateCardProps>> = ({
  candidate,
  nounsRequired,
  currentBlock,
}) => {
  const signers = candidate.version.content.contentSignatures;

  const nowSec = Math.floor(Date.now() / 1000);
  const activeSigners =
    signers?.filter(
      s =>
        s.signer?.id &&
        s.canceled !== true &&
        Number(s.expirationTimestamp ?? 0) > nowSec,
    ) ?? [];
  const signerIds = activeSigners.map(s => s.signer.id.toLowerCase());
  const proposerLower = candidate.proposer?.toLowerCase() ?? '';
  // Query proposer + signers in one shot — the subgraph delegate snapshot returns delegatedVotes per address
  const queryAddresses = Array.from(new Set([proposerLower, ...signerIds].filter(Boolean)));
  const { query, variables } = delegateNounsAtBlockQuery(
    queryAddresses,
    currentBlock ? currentBlock - 1n : 0n,
  );
  const { data: delegateData } = useQuery<{
    delegates: { items: Array<{ id: string; delegatedVotes: number }> };
  }>(query, { variables, skip: queryAddresses.length === 0 });

  let proposerVotes = 0;
  let signerNounCount = 0;
  delegateData?.delegates?.items?.forEach(d => {
    const votes = Number(d.delegatedVotes ?? 0);
    if (d.id.toLowerCase() === proposerLower) {
      proposerVotes = votes;
    } else {
      signerNounCount += votes;
    }
  });
  const totalSupport = proposerVotes + signerNounCount;
  const signerNounIds = Array.from({ length: signerNounCount }, (_, i) => String(i));

  return (
    <Link
      className={clsx(classes.candidateLink, classes.candidateLinkWithCountdown)}
      to={`/candidates/${candidate.id}`}
    >
      <div className={classes.title}>
        <span className={classes.candidateTitle}>
          <span>{candidate.version.content.title}</span>
        </span>
        <p className={classes.proposer}>
          by{' '}
          <span className={classes.proposerAddress}>
            <ShortAddress address={candidate.proposer || ''} avatar={false} />
          </span>
        </p>

        <div className={classes.footer}>
          <div className={classes.candidateSponsors}>
            <CandidateSponsors
              signers={signers}
              nounIds={signerNounIds}
              nounsRequired={candidate.requiredVotes}
              isThresholdMetByProposer={proposerVotes >= candidate.requiredVotes}
            />
            <span
              className={clsx(
                classes.sponsorCount,
                totalSupport >= candidate.requiredVotes && classes.sponsorCountOverflow,
              )}
            >
              <strong>
                {totalSupport} / {candidate.requiredVotes || nounsRequired}
              </strong>{' '}
              <Trans>noun votes</Trans>
            </span>
          </div>
          <p className={classes.timestamp}>
            {relativeTimestamp(Number(candidate.lastUpdatedTimestamp))}
          </p>
        </div>
      </div>
    </Link>
  );
};

export default CandidateCard;
