import React from 'react';
import useTransfer from '../hooks/useTransfer';

const TransferButton = () => {
  const { transferEth } = useTransfer();

  const handleTransfer = async () => {
    await transferEth('0.001');
  };

  return (
    <button onClick={handleTransfer}>Transfer 0.001 ETH</button>
  );
};

export default TransferButton;