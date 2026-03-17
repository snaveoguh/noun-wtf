import React from 'react';

import { useQuery } from '@apollo/client';
import { ScaleIcon } from '@heroicons/react/solid';
import { Trans } from '@lingui/react/macro';
import { Spinner } from 'react-bootstrap';

import HorizontalStackedNouns from '@/components/HorizontalStackedNouns';
import ShortAddress from '@/components/ShortAddress';
import { delegateNounsAtBlockQuery } from '@/wrappers/subgraph';

import classes from './DelegateHoverCard.module.css';

interface DelegateHoverCardProps {
  delegateId: string;
  proposalCreationBlock: bigint;
}

const DelegateHoverCard: React.FC<DelegateHoverCardProps> = props => {
  const { delegateId, proposalCreationBlock } = props;

  const unwrappedDelegateId = delegateId ? delegateId.replace('delegate-', '') : '';

  const { query, variables } = delegateNounsAtBlockQuery(
    [unwrappedDelegateId],
    proposalCreationBlock,
  );
  const { data, loading, error } = useQuery(query, { variables });

  // Ponder wraps results in { items: [...] }
  const delegateItems = data?.delegates?.items ?? data?.delegates ?? [];
  const delegate = delegateItems[0];

  if (loading || !data || !delegate) {
    return (
      <div className={classes.spinnerWrapper}>
        <div className={classes.spinner}>
          <Spinner animation="border" />
        </div>
      </div>
    );
  }

  if (error) {
    return <>Error fetching Vote info</>;
  }

  // Ponder doesn't index nounsRepresented — synthesize from delegatedVotes count
  const numVotesForProp = delegate.nounsRepresented?.length ?? Number(delegate.delegatedVotes ?? 0);
  const nounIds = delegate.nounsRepresented
    ? delegate.nounsRepresented.map((noun: { id: string }) => noun.id)
    : Array.from({ length: numVotesForProp }, (_, i) => String(i));

  return (
    <div className={classes.wrapper}>
      <div className={classes.stackedNounWrapper}>
        <HorizontalStackedNouns nounIds={nounIds} />
      </div>

      <div className={classes.address}>
        <ShortAddress address={delegate.id ?? ''} />
      </div>

      <div className={classes.nounInfoWrapper}>
        <ScaleIcon height={20} width={20} className={classes.icon} />
        {numVotesForProp === 1 ? (
          <Trans>
            Voted with<span className={classes.bold}>{numVotesForProp}</span>Noun
          </Trans>
        ) : (
          <Trans>
            Voted with<span className={classes.bold}>{numVotesForProp}</span>Nouns
          </Trans>
        )}
      </div>
    </div>
  );
};

export default DelegateHoverCard;
