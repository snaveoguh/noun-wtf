import React from 'react';

import { useQuery } from '@apollo/client';
import { Trans } from '@lingui/react/macro';
import clsx from 'clsx';
import { useReadContract } from 'wagmi';

import ShortAddress from '@/components/ShortAddress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { NOUNV2_TOKEN_ADDRESS, nounV2TokenAbi } from '@/contracts/nounv2-token';
import { useAppSelector } from '@/hooks';
import useDaoContext from '@/hooks/useDaoContext';
import { buildEtherscanAddressLink } from '@/utils/etherscan';
import { nounQuery } from '@/wrappers/subgraph';

import classes from './Holder.module.css';

interface HolderProps {
  nounId: bigint;
  isNounders?: boolean;
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const;

const Holder: React.FC<HolderProps> = props => {
  const { nounId, isNounders } = props;

  const isCool = useAppSelector(state => state.application.isCoolBackground);
  const activeAccount = useAppSelector(state => state.account.activeAccount);
  const dao = useDaoContext();

  // Subgraph path (mainnet Nouns). Only enabled when not on v2 — the
  // mainnet subgraph doesn't index v2 tokens, so for v2 noun 0 it'd
  // hand back the mainnet nounders multisig instead of the v2 holder.
  const { query, variables } = nounQuery(nounId.toString());
  const { loading, error, data } = useQuery(query, {
    variables,
    errorPolicy: 'ignore',
    skip: dao.isV2,
  });

  // V2 path: read owner straight from the v2 token contract. There's no
  // ponder indexer for v2 yet so on-chain `ownerOf` is the source of truth.
  const v2Enabled = dao.isV2 && NOUNV2_TOKEN_ADDRESS !== ZERO_ADDRESS;
  const {
    data: v2OwnerData,
    isLoading: v2Loading,
    error: v2Error,
  } = useReadContract({
    address: NOUNV2_TOKEN_ADDRESS,
    abi: nounV2TokenAbi,
    functionName: 'ownerOf',
    args: [nounId],
    query: { enabled: v2Enabled },
  });

  if (dao.isV2) {
    if (v2Loading || v2Error != null) {
      return <></>;
    }
  } else if (loading === true || error != null) {
    return <></>;
  }

  let holder: string | undefined;
  if (dao.isV2) {
    holder = typeof v2OwnerData === 'string' ? v2OwnerData : undefined;
  } else {
    const ownerRaw = data?.noun?.owner;
    holder = typeof ownerRaw === 'string' ? ownerRaw : ownerRaw?.id;
  }

  if (holder == null && isNounders !== true) {
    return <></>;
  }

  const isHolderYou =
    activeAccount !== undefined &&
    holder !== undefined &&
    activeAccount.toLowerCase() === holder.toLowerCase();

  const youContent = (
    <span
      style={{
        color: isCool ? 'var(--brand-cool-dark-text)' : 'var(--brand-warm-dark-text)',
      }}
    >
      <Trans>You</Trans>
    </span>
  );

  // Only built when `holder` is set. The early-return above guarantees this
  // for the !isNounders branch but TS can't narrow across the JSX
  // conditional, so we capture a non-nullable local first.
  let nonNounderNounContent: React.ReactNode = null;
  if (holder != null) {
    const holderAddress = holder as `0x${string}`;
    nonNounderNounContent = isHolderYou ? (
      youContent
    ) : (
      <a
        href={buildEtherscanAddressLink(holderAddress)}
        target={'_blank'}
        rel="noreferrer"
        className={classes.link}
      >
        <Tooltip>
          <TooltipContent id="holder-etherscan-tooltip">
            <Trans>View on Etherscan</Trans>
          </TooltipContent>
          <TooltipTrigger>
            <ShortAddress size={16} address={holderAddress} avatar={true} />
          </TooltipTrigger>
        </Tooltip>
      </a>
    );
  }

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
