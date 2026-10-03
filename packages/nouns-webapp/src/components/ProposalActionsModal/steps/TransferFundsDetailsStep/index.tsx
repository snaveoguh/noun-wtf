import React, { useEffect, useState } from 'react';

import { Trans } from '@lingui/react/macro';
import { isAddress, parseUnits } from 'viem';

import BrandDropdown from '@/components/BrandDropdown';
import BrandNumericEntry from '@/components/BrandNumericEntry';
import BrandTextEntry from '@/components/BrandTextEntry';
import ModalBottomButtonRow from '@/components/ModalBottomButtonRow';
import ModalTitle from '@/components/ModalTitle';
import {
  findShortfalls,
  formatAssetAmount,
  TREASURY_ASSETS,
  type TreasuryAssetSymbol,
  useLilNounsTreasury,
} from '@/lib/lilNounsTreasury';
import { Address } from '@/utils/types';

import { ProposalActionModalStepProps } from '../..';

export enum SupportedCurrency {
  ETH = 'ETH',
  WETH = 'WETH',
  STETH = 'STETH',
  USDC = 'USDC',
}

const LIL_CURRENCIES = [
  SupportedCurrency.USDC,
  SupportedCurrency.STETH,
  SupportedCurrency.ETH,
  SupportedCurrency.WETH,
] as const;

const CURRENCY_TO_ASSET: Record<SupportedCurrency, TreasuryAssetSymbol> = {
  [SupportedCurrency.ETH]: 'ETH',
  [SupportedCurrency.WETH]: 'WETH',
  [SupportedCurrency.STETH]: 'stETH',
  [SupportedCurrency.USDC]: 'USDC',
};

const assetFor = (c: SupportedCurrency) =>
  TREASURY_ASSETS.find(a => a.symbol === CURRENCY_TO_ASSET[c]) ?? TREASURY_ASSETS[0];

function lilOptionLabel(
  c: SupportedCurrency,
  balances: ReturnType<typeof useLilNounsTreasury>['balances'],
) {
  const asset = assetFor(c);
  const bal = balances?.[asset.symbol];
  return bal === undefined
    ? asset.symbol
    : `${asset.symbol} — ${formatAssetAmount(bal, asset)} in treasury`;
}

function lilShortfallText(
  c: SupportedCurrency,
  amount: string,
  balances: ReturnType<typeof useLilNounsTreasury>['balances'],
): string | null {
  const asset = assetFor(c);
  let want: bigint;
  try {
    want = parseUnits(amount === '' ? '0' : amount, asset.decimals);
  } catch {
    return null;
  }
  const [short] = findShortfalls({ [asset.symbol]: want }, balances);
  if (short === undefined) return null;
  return `The Lil Nouns treasury only holds ${formatAssetAmount(short.have, asset)} ${asset.symbol}. This transfer would fail at execution.`;
}

const TransferFundsDetailsStep: React.FC<ProposalActionModalStepProps> = props => {
  const { onNextBtnClick, onPrevBtnClick, state, setState, dao } = props;
  const isLil = dao === 'lil-nouns';
  // Lil Nouns: show what the treasury actually holds next to each currency so
  // nobody requests ETH the treasury doesn't have (it's mostly stETH + USDC).
  const { balances } = useLilNounsTreasury(isLil);

  const [currency, setCurrency] = useState<SupportedCurrency>(
    state.TransferFundsCurrency ?? SupportedCurrency.USDC,
  );
  const [amount, setAmount] = useState<string>(state.amount ?? '');
  const [formattedAmount, setFormattedAmount] = useState<string>(state.amount ?? '');
  const [address, setAddress] = useState<Address>((state.address as Address) ?? ('0x' as Address));
  const [isValidForNextStage, setIsValidForNextStage] = useState(false);

  useEffect(() => {
    if (isAddress(address) && parseFloat(amount) > 0 && !isValidForNextStage) {
      setIsValidForNextStage(true);
    }
  }, [amount, address, isValidForNextStage]);

  const isValidNumber = (value: string): boolean => {
    try {
      return value.trim() !== '' && !isNaN(parseFloat(value));
    } catch {
      return false;
    }
  };

  return (
    <div>
      <ModalTitle>
        <Trans>Add Transfer Funds Action</Trans>
      </ModalTitle>

      <BrandDropdown
        label={'Currency'}
        value={currency}
        onChange={e => setCurrency(SupportedCurrency[e.target.value as SupportedCurrency])}
        chevronTop={38}
      >
        {isLil ? (
          LIL_CURRENCIES.map(c => (
            <option key={c} value={c}>
              {lilOptionLabel(c, balances)}
            </option>
          ))
        ) : (
          <>
            <option value="USDC">USDC</option>
            <option value="ETH">ETH</option>
            <option value="STETH">Lido Staked ETH</option>
          </>
        )}
      </BrandDropdown>

      <BrandNumericEntry
        label={'Amount'}
        value={formattedAmount}
        onValueChange={e => {
          setAmount(e.value);
          setFormattedAmount(e.formattedValue);
        }}
        placeholder={`0 ${currency}`}
        isInvalid={parseFloat(amount) > 0 && !isValidNumber(amount)}
      />

      {isLil && lilShortfallText(currency, amount, balances) !== null && (
        <div style={{ color: '#e5484d', fontSize: 13, margin: '-4px 0 10px' }}>
          {lilShortfallText(currency, amount, balances)}
        </div>
      )}

      <BrandTextEntry
        label={'Recipient'}
        onChange={e => setAddress(e.target.value as Address)}
        value={address}
        type="string"
        placeholder="0x..."
        isInvalid={address.length === 0 ? false : !isAddress(address)}
      />

      <ModalBottomButtonRow
        prevBtnText={<Trans>Back</Trans>}
        onPrevBtnClick={onPrevBtnClick}
        nextBtnText={<Trans>Review and Add</Trans>}
        isNextBtnDisabled={!isValidForNextStage}
        onNextBtnClick={() => {
          setState(x => ({
            ...x,
            amount,
            address,
            TransferFundsCurrency: currency,
          }));
          onNextBtnClick();
        }}
      />
    </div>
  );
};

export default TransferFundsDetailsStep;
