import type { DraftDao } from '@/components/GameShell/draftDao';

import React from 'react';

import { Trans } from '@lingui/react/macro';
import { encodeAbiParameters, parseEther, parseUnits } from 'viem';

import ModalBottomButtonRow from '@/components/ModalBottomButtonRow';
import ModalTitle from '@/components/ModalTitle';
import ShortAddress from '@/components/ShortAddress';
import { nounsPayerAddress, stEthAddress, usdcAddress, wethAddress } from '@/contracts';
import { Address, Hex } from '@/utils/types';
import { defaultChain } from '@/wagmi';

import { FinalProposalActionStepProps, ProposalActionModalState } from '../..';
import { SupportedCurrency } from '../TransferFundsDetailsStep';

import classes from './TransferFundsReviewStep.module.css';

type ProposalAction = {
  address: Address;
  value: bigint;
  signature: string;
  calldata: Hex;
  usdcValue?: number;
  decodedCalldata?: string;
};

const TRANSFER_SIG = 'transfer(address,uint256)';
const transferArgs = (to: Address, amount: bigint) =>
  encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [to, amount]);

/**
 * Build the proposal action for a funds transfer.
 *
 * `calldata` is args-only: the timelock prepends the selector for `signature`
 * itself, so encoding it here too (encodeFunctionData) made the call carry the
 * selector twice and revert at execution.
 *
 * Nouns DAO pays USDC through its payer contract (with TokenBuyer top-ups);
 * Lil Nouns has no payer, so its USDC / stETH / WETH go out as plain ERC20
 * transfers straight from the treasury.
 */
export const handleActionAdd = (
  state: ProposalActionModalState,
  onActionAdd: (action: ProposalAction) => void,
  dao: DraftDao | undefined,
) => {
  const chainId = defaultChain.id;
  const amountStr = (state.amount ?? '0').toString();
  const tokenTransfer = (token: Address, decimals: number) => {
    const amount = parseUnits(amountStr, decimals);
    onActionAdd({
      address: token,
      value: 0n,
      signature: TRANSFER_SIG,
      decodedCalldata: JSON.stringify([state.address, amount.toString()]),
      calldata: transferArgs(state.address, amount),
    });
  };

  switch (state.TransferFundsCurrency) {
    case SupportedCurrency.ETH:
      onActionAdd({
        address: state.address,
        value: parseEther(amountStr),
        signature: '',
        calldata: '0x' as Hex,
      });
      return;
    case SupportedCurrency.STETH:
      tokenTransfer(stEthAddress[chainId], 18);
      return;
    case SupportedCurrency.WETH:
      tokenTransfer(wethAddress[chainId], 18);
      return;
    case SupportedCurrency.USDC: {
      if (dao === 'lil-nouns') {
        tokenTransfer(usdcAddress[chainId], 6);
        return;
      }
      const usdcAmount = parseUnits(amountStr, 6);
      onActionAdd({
        address: nounsPayerAddress[chainId],
        value: 0n,
        usdcValue: Number(usdcAmount),
        signature: 'sendOrRegisterDebt(address,uint256)',
        decodedCalldata: JSON.stringify([state.address, usdcAmount.toString()]),
        calldata: transferArgs(state.address, usdcAmount),
      });
      return;
    }
    default:
      // This should never happen
      alert('Unsupported currency selected');
  }
};

const TransferFundsReviewStep: React.FC<FinalProposalActionStepProps> = props => {
  const { onNextBtnClick, onPrevBtnClick, state, onDismiss, dao } = props;

  return (
    <div>
      <ModalTitle>
        <Trans>Review Transfer Funds Action</Trans>
      </ModalTitle>

      <span className={classes.label}>Pay</span>
      <div className={classes.text}>
        {Intl.NumberFormat(undefined, { maximumFractionDigits: 18 }).format(Number(state.amount))}{' '}
        {state.TransferFundsCurrency}
      </div>
      <span className={classes.label}>To</span>
      <div className={classes.text}>
        <ShortAddress address={state.address} />
      </div>

      <ModalBottomButtonRow
        prevBtnText={<Trans>Back</Trans>}
        onPrevBtnClick={onPrevBtnClick}
        nextBtnText={<Trans>Add Transfer Funds Action</Trans>}
        onNextBtnClick={() => {
          handleActionAdd(state, onNextBtnClick, dao);
          onDismiss();
        }}
      />
    </div>
  );
};

export default TransferFundsReviewStep;
