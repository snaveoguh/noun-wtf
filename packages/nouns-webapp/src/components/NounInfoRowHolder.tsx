import React from 'react';

import { Trans } from '@lingui/react/macro';
import { useQuery } from '@tanstack/react-query';
import { ExternalLinkIcon } from 'lucide-react';

import ShortAddress from '@/components/ShortAddress';
import { VoterHoverCard } from '@/components/VoterHoverCard';
import { nounsAuctionHouseAddress } from '@/contracts';
import useDaoContext from '@/hooks/useDaoContext';
import { cn } from '@/lib/utils';
import { execute } from '@/subgraphs/execute';
import { buildEtherscanAddressLink } from '@/utils/etherscan';
import { Address } from '@/utils/types';
import { defaultChain } from '@/wagmi';
import { auctionQuery } from '@/wrappers/subgraph';

interface NounInfoRowHolderProps {
  nounId: bigint;
  className?: string;
}

const NounInfoRowHolder: React.FC<NounInfoRowHolderProps> = props => {
  const { nounId, className } = props;
  const dao = useDaoContext();

  // V2 has no Ponder indexer for AuctionSettled events yet, so the only
  // reliable source for the winning bidder is the on-chain `auction()`
  // tuple — and that's already overwritten with the next noun once the
  // current auction settles. Querying the mainnet subgraph would happily
  // return the V1 auction with the same numeric id, so the "WINNER" line
  // would surface a totally different person (or, if they happen to also
  // hold the V2 noun now, look misleadingly like the current holder is
  // the auction winner).
  //
  // Until the V2 indexer ships, skip the row entirely on V2 — the
  // "Held by" row in <AuctionActivity> already shows current ownership.
  const { isLoading, error, data } = useQuery({
    queryKey: ['auction', nounId],
    queryFn: () => {
      const { query, variables } = auctionQuery(nounId.toString());
      return execute<{
        auction: {
          nounId: string;
          winner: string | null;
        } | null;
      }>(query, variables);
    },
    enabled: !dao.isV2,
  });

  if (dao.isV2) {
    return <></>;
  }

  const winner = data?.auction?.winner;

  if (isLoading) {
    return (
      <span className={cn('text-muted-foreground block', className)}>
        <Trans>Loading...</Trans>
      </span>
    );
  }

  if (error || !winner) {
    return <></>;
  }

  const etherscanURL = buildEtherscanAddressLink(winner);
  const shortAddressComponent = <ShortAddress address={winner as Address} />;
  const chainId = defaultChain.id;
  const isAuctionHouse =
    winner?.toLowerCase() === nounsAuctionHouseAddress[chainId]?.toLowerCase();

  return (
    <span className={cn('text-muted-foreground block', className)}>
      <Trans>Winner</Trans>{' '}
      {isAuctionHouse ? (
        <a className="text-muted-foreground" href={etherscanURL} target={'_blank'} rel="noreferrer">
          <Trans>Nouns Auction House</Trans>
          <ExternalLinkIcon className="text-muted-foreground ml-0.5 inline-block size-3" />
        </a>
      ) : (
        // VoterHoverCard wraps the rendered name with a rich tooltip on hover
        // (avatar, owned nouns, vote / proposal counts, multisig signers).
        // `asChild` makes Radix reuse the etherscan anchor as the trigger so
        // we don't end up with nested <a> elements.
        <VoterHoverCard address={winner as Address} asChild>
          <a
            className="text-muted-foreground"
            href={etherscanURL}
            target={'_blank'}
            rel="noreferrer"
          >
            {shortAddressComponent}
            <ExternalLinkIcon className="text-muted-foreground ml-0.5 inline-block size-3" />
          </a>
        </VoterHoverCard>
      )}
    </span>
  );
};

export default NounInfoRowHolder;
