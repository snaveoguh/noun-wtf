import { parseEther, formatEther } from 'viem';
import { useReadContract, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';

import nounDerivativesABI from '@/contracts/nounDerivatives.abi.json';
import { Address } from '@/utils/types';

const abi = nounDerivativesABI;

const rawDerivativesAddress = String(import.meta.env.VITE_NOUN_DERIVATIVES_ADDRESS ?? '');
const NOUN_DERIVATIVES_ADDRESS = rawDerivativesAddress as Address;
const DERIVATIVE_BID_REASON_ENABLED =
  String(import.meta.env.VITE_DERIVATIVE_BID_REASON_ENABLED ?? '').toLowerCase() === 'true';
export const hasDerivativesContract = rawDerivativesAddress.length > 0;
export const hasDerivativeBidReason = hasDerivativesContract && DERIVATIVE_BID_REASON_ENABLED;

// ── Read auction state ──────────────────────────────────────────────────

export interface DerivativeAuction {
  nounId: bigint;
  creator: Address;
  reservePrice: bigint;
  amount: bigint;
  bidder: Address;
  startTime: number;
  endTime: number;
  settled: boolean;
  bidReason: string;
  supportsBidReason: boolean;
}

export const useDerivativeAuction = (tokenId: number | undefined) => {
  const { data, isLoading, refetch } = useReadContract({
    abi,
    address: NOUN_DERIVATIVES_ADDRESS,
    functionName: 'getAuction',
    args: tokenId !== undefined ? [BigInt(tokenId)] : undefined,
    query: { enabled: hasDerivativesContract && tokenId !== undefined },
  });

  const {
    data: bidReasonData,
    isSuccess: bidReasonSupported,
    refetch: refetchBidReason,
  } = useReadContract({
    abi,
    address: NOUN_DERIVATIVES_ADDRESS,
    functionName: 'bidReasons',
    args: tokenId !== undefined ? [BigInt(tokenId)] : undefined,
    query: {
      enabled: hasDerivativeBidReason && tokenId !== undefined,
      retry: false,
    },
  });

  const refetchAuction = async () => {
    await Promise.all([refetch(), refetchBidReason()]);
  };

  if (data === undefined) return { auction: undefined, isLoading, refetch: refetchAuction };

  const [nounId, creator, reservePrice, amount, bidder, startTime, endTime, settled] = data as [
    bigint,
    Address,
    bigint,
    bigint,
    Address,
    number,
    number,
    boolean,
  ];

  const auction: DerivativeAuction = {
    nounId,
    creator,
    reservePrice,
    amount,
    bidder,
    startTime: Number(startTime),
    endTime: Number(endTime),
    settled,
    bidReason: (bidReasonData as string | undefined) ?? '',
    supportsBidReason: hasDerivativeBidReason && bidReasonSupported,
  };

  return { auction, isLoading, refetch: refetchAuction };
};

// ── Create derivative (mint + list) ─────────────────────────────────────

export const useCreateDerivative = () => {
  const { writeContract, isPending, isSuccess, isError, error, data: txHash } = useWriteContract();

  const create = (nounId: number, tokenURI: string, reservePriceEth: string) => {
    if (!hasDerivativesContract) return;
    writeContract({
      abi,
      address: NOUN_DERIVATIVES_ADDRESS,
      functionName: 'createDerivative',
      args: [BigInt(nounId), tokenURI, parseEther(reservePriceEth)],
    });
  };

  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash });

  return { create, isPending, isSuccess, isError, error, txHash, receipt, hasDerivativesContract };
};

// ── Place bid ───────────────────────────────────────────────────────────

export const useCreateDerivativeBid = () => {
  const { writeContract, isPending, isSuccess, isError, error, data: txHash } = useWriteContract();

  const bid = (
    tokenId: number,
    amountEth: string,
    options?: { reason?: string; supportsBidReason?: boolean },
  ) => {
    if (!hasDerivativesContract) return;
    const trimmedReason = options?.reason?.trim() ?? '';
    writeContract({
      abi,
      address: NOUN_DERIVATIVES_ADDRESS,
      functionName:
        trimmedReason.length > 0 && options?.supportsBidReason === true
          ? 'createBidWithReason'
          : 'createBid',
      args:
        trimmedReason.length > 0 && options?.supportsBidReason === true
          ? [BigInt(tokenId), trimmedReason]
          : [BigInt(tokenId)],
      value: parseEther(amountEth),
    });
  };

  return { bid, isPending, isSuccess, isError, error, txHash, hasDerivativesContract };
};

// ── Settle auction ──────────────────────────────────────────────────────

export const useSettleDerivativeAuction = () => {
  const { writeContract, isPending, isSuccess, isError, error, data: txHash } = useWriteContract();

  const settle = (tokenId: number) => {
    if (!hasDerivativesContract) return;
    writeContract({
      abi,
      address: NOUN_DERIVATIVES_ADDRESS,
      functionName: 'settleAuction',
      args: [BigInt(tokenId)],
    });
  };

  return { settle, isPending, isSuccess, isError, error, txHash, hasDerivativesContract };
};

// ── Cancel auction ──────────────────────────────────────────────────────

export const useCancelDerivativeAuction = () => {
  const { writeContract, isPending, isSuccess, isError, error, data: txHash } = useWriteContract();

  const cancel = (tokenId: number) => {
    if (!hasDerivativesContract) return;
    writeContract({
      abi,
      address: NOUN_DERIVATIVES_ADDRESS,
      functionName: 'cancelAuction',
      args: [BigInt(tokenId)],
    });
  };

  return { cancel, isPending, isSuccess, isError, error, txHash, hasDerivativesContract };
};

// ── Helpers ─────────────────────────────────────────────────────────────

export const minBidAmount = (currentAmount: bigint, incrementPct = 5): bigint => {
  return currentAmount + (currentAmount * BigInt(incrementPct)) / 100n;
};

export const formatBidEth = (amount: bigint): string => {
  return parseFloat(formatEther(amount)).toFixed(4);
};
