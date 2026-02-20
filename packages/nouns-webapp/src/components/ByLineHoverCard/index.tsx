import React from 'react';

import { useQuery } from '@apollo/client';
import { ScaleIcon } from '@heroicons/react/solid';
import { Trans } from '@lingui/react/macro';
import { Spinner } from 'react-bootstrap';
import ShortAddress from '@/components/ShortAddress';
import { Address } from '@/utils/types';
import { currentlyDelegatedNouns } from '@/wrappers/subgraph';

// Ponder delegate response shape
interface PonderDelegateResponse {
  delegates: {
    items: Array<{
      id: string;
      delegatedVotes: number;
    }>;
  };
}

import classes from './ByLineHoverCard.module.css';

interface ByLineHoverCardProps {
  proposerAddress: string;
}

const ByLineHoverCard: React.FC<ByLineHoverCardProps> = props => {
  const { proposerAddress } = props;

  const { query, variables } = currentlyDelegatedNouns(proposerAddress);
  const { data, loading, error } = useQuery<PonderDelegateResponse>(query, { variables });

  const delegate = data?.delegates?.items?.[0];

  if (loading || !delegate) {
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

  const delegatedVotes = Number(delegate.delegatedVotes ?? 0);

  return (
    <div className={classes.wrapper}>
      <div className={classes.address}>
        <ShortAddress address={delegate.id as Address} />
      </div>

      <div className={classes.nounsRepresented}>
        <div>
          <ScaleIcon height={15} width={15} className={classes.icon} />
          <Trans>
            <span>Delegated Votes: </span>
          </Trans>
          <span className={classes.bold}>{delegatedVotes}</span>
        </div>
      </div>
    </div>
  );
};

export default ByLineHoverCard;
