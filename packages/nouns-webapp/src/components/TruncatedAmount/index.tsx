import React from 'react';

import { formatEth } from '@/lib/format';

interface TruncatedAmountProps {
  amount: bigint;
}

const TruncatedAmount: React.FC<TruncatedAmountProps> = ({ amount }) => {
  const formattedEth = formatEth(BigInt(amount.toString()), 2);
  return <>Ξ {formattedEth}</>;
};
export default TruncatedAmount;
