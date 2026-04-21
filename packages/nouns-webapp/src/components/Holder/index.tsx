import React from 'react';

import { useQuery } from '@apollo/client';
import { Trans } from '@lingui/react/macro';
import clsx from 'clsx';

import ShortAddress from '@/components/ShortAddress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAppSelector } from '@/hooks';
import { buildEtherscanAddressLink } from '@/utils/etherscan';
import { nounQuery } from '@/wrappers/subgraph';

import classes from './Holder.module.css';

interface HolderProps {
  nounId: bigint;
  isNounders?: boolean;
}

const Holder: React.FC<HolderProps> = props => {
  const { nounId, isNounders } = props;

  const isCool = useAppSelector(state => state.application.isCoolBackground);

  const { query, variables } = nounQuery(nounId.toString());
  const { loading, error, data } = useQuery(query, { variables, errorPolicy: 'ignore' });

  if (loading === true || error != null) {
    return <></>;
  }

  const ownerRaw = data?.noun?.owner;
  const holder = typeof ownerRaw === 'string' ? ownerRaw : ownerRaw?.id;

  if (holder == null && isNounders !== true) {
    return <></>;
  }

  const nonNounderNounContent = (
    <a
      href={buildEtherscanAddressLink(holder)}
      target={'_blank'}
      rel="noreferrer"
      className={classes.link}
    >
      <Tooltip>
        <TooltipContent id="holder-etherscan-tooltip">
          <Trans>View on Etherscan</Trans>
        </TooltipContent>
        <TooltipTrigger>
          <ShortAddress size={16} address={holder} avatar={true} />
        </TooltipTrigger>
      </Tooltip>
    </a>
  );

  const nounderNounContent = 'nounders.eth';

  return (
    <div className={clsx(classes.wrapper, classes.section, classes.inlineRow)}>
      <h4
        style={{
          color: isCool ? 'var(--brand-cool-light-text)' : 'var(--brand-warm-light-text)',
        }}
        className={classes.holderCopy}
      >
        <Trans>Held by</Trans>
      </h4>
      <h2
        className={classes.holderContent}
        style={{
          color: isCool ? 'var(--brand-cool-dark-text)' : 'var(--brand-warm-dark-text)',
        }}
      >
        {isNounders === true ? nounderNounContent : nonNounderNounContent}
      </h2>
    </div>
  );
};

export default Holder;
