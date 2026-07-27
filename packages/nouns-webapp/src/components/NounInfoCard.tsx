import React from 'react';

import { Trans } from '@lingui/react/macro';

import _AddressIcon from '@/assets/icons/Address.svg';
import _BidsIcon from '@/assets/icons/Bids.svg';
import NounInfoRowButton from '@/components/NounInfoRowButton';
import NounInfoRowHolder from '@/components/NounInfoRowHolder';
import { nounsTokenAddress } from '@/contracts';
import { NOUNV2_TOKEN_ADDRESS } from '@/contracts/nounv2-token';
import { useAppSelector } from '@/hooks';
import useDaoContext from '@/hooks/useDaoContext';
import { buildEtherscanTokenLink } from '@/utils/etherscan';
import { defaultChain } from '@/wagmi';

interface NounInfoCardProps {
  nounId: bigint;
  bidHistoryOnClickHandler: () => void;
}

const NounInfoCard: React.FC<NounInfoCardProps> = props => {
  const { nounId, bidHistoryOnClickHandler } = props;
  const chainId = defaultChain.id;
  const dao = useDaoContext();

  // V2 nouns live on the NounV2 token contract — link there, not the V1 token
  // (otherwise the Etherscan button opens the V1 noun of the same id).
  const tokenAddress = dao.isV2 ? NOUNV2_TOKEN_ADDRESS : nounsTokenAddress[chainId];
  const etherscanButtonClickHandler = () =>
    window.open(buildEtherscanTokenLink(tokenAddress, Number(nounId)));

  const lastAuctionNounId = useAppSelector(state => state.onDisplayAuction.lastAuctionNounId);

  return (
    <>
      <NounInfoRowHolder nounId={nounId} className="mb-3" />

      <NounInfoRowButton
        iconImgSource={_BidsIcon}
        btnText={
          lastAuctionNounId !== undefined && BigInt(lastAuctionNounId) === nounId ? (
            <Trans>Bids</Trans>
          ) : (
            <Trans>Bid history</Trans>
          )
        }
        onClickHandler={bidHistoryOnClickHandler}
      />
      <NounInfoRowButton
        iconImgSource={_AddressIcon}
        btnText={<Trans>Etherscan</Trans>}
        onClickHandler={etherscanButtonClickHandler}
      />
    </>
  );
};

export default NounInfoCard;
