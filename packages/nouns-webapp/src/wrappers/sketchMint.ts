import { parseEther } from 'viem';
import { useReadContract, useWriteContract } from 'wagmi';

import sketchMintABI from '@/contracts/sketchMint.abi.json';
import { Address } from '@/utils/types';

const abi = sketchMintABI;

const SKETCH_MINT_ADDRESS = (import.meta.env.VITE_SKETCH_MINT_ADDRESS || '') as Address;
const hasContract = Boolean(SKETCH_MINT_ADDRESS);

export const useSketchAvailable = (nounId: number) => {
  const { data } = useReadContract({
    abi,
    address: SKETCH_MINT_ADDRESS,
    functionName: 'isAvailable',
    args: [BigInt(nounId)],
    query: { enabled: hasContract && nounId > 0 },
  });
  return data as boolean | undefined;
};

export const useSketchSoldOut = (nounId: number) => {
  const { data } = useReadContract({
    abi,
    address: SKETCH_MINT_ADDRESS,
    functionName: 'isSoldOut',
    args: [BigInt(nounId)],
    query: { enabled: hasContract && nounId > 0 },
  });
  return data as boolean | undefined;
};

export const useMintSketch = () => {
  const { writeContract, isPending, isSuccess, isError, error, data: txHash } = useWriteContract();

  const mintSketch = (nounId: number, priceEth: string) => {
    if (!hasContract) return;
    writeContract({
      abi,
      address: SKETCH_MINT_ADDRESS,
      functionName: 'mint',
      args: [BigInt(nounId)],
      value: parseEther(priceEth),
    });
  };

  return { mintSketch, isPending, isSuccess, isError, error, txHash, hasContract };
};
