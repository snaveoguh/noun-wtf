// ── TreasureChest Contract Hooks ─────────────────────────────────────

import { parseEther, type Address } from 'viem';
import { useReadContract, useWriteContract } from 'wagmi';

// Contract address — deploy to mainnet and set here
const TREASURE_CHEST_ADDRESS = (import.meta.env.VITE_TREASURE_CHEST_ADDRESS || '') as Address;
const hasContract = Boolean(TREASURE_CHEST_ADDRESS);

// Minimal ABI — only the functions we need
const TREASURE_CHEST_ABI = [
  {
    name: 'depositERC20',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'depositERC721',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'tokenId', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'depositETH',
    type: 'function',
    stateMutability: 'payable',
    inputs: [],
    outputs: [],
  },
  {
    name: 'claim',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'dropId', type: 'uint256' }],
    outputs: [],
  },
  {
    name: 'getPendingDeposits',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: 'count', type: 'uint256' }],
  },
  {
    name: 'getActiveDrops',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
  {
    name: 'getDepositCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getDropCount',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'deposits',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'depositor', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'amountOrId', type: 'uint256' },
      { name: 'itemType', type: 'uint8' },
      { name: 'timestamp', type: 'uint64' },
      { name: 'dropped', type: 'bool' },
    ],
  },
  {
    name: 'drops',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: [
      { name: 'depositIndex', type: 'uint256' },
      { name: 'claimer', type: 'address' },
      { name: 'droppedAt', type: 'uint64' },
      { name: 'claimedAt', type: 'uint64' },
      { name: 'worldX', type: 'int16' },
      { name: 'worldY', type: 'int16' },
    ],
  },
] as const;

// ERC20 approve ABI
const ERC20_APPROVE_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const;

// ERC721 approve ABI
const ERC721_APPROVE_ABI = [
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'tokenId', type: 'uint256' },
    ],
    outputs: [],
  },
] as const;

// ── Read hooks ───────────────────────────────────────────────────────

export function usePendingDeposits() {
  const { data } = useReadContract({
    abi: TREASURE_CHEST_ABI,
    address: TREASURE_CHEST_ADDRESS,
    functionName: 'getPendingDeposits',
    query: { enabled: hasContract, refetchInterval: 30000 },
  });
  return (data as bigint | undefined) ?? 0n;
}

export function useActiveDrops() {
  const { data } = useReadContract({
    abi: TREASURE_CHEST_ABI,
    address: TREASURE_CHEST_ADDRESS,
    functionName: 'getActiveDrops',
    query: { enabled: hasContract, refetchInterval: 10000 },
  });
  return (data as bigint[] | undefined) ?? [];
}

export function useDropDetails(dropId: bigint) {
  const { data } = useReadContract({
    abi: TREASURE_CHEST_ABI,
    address: TREASURE_CHEST_ADDRESS,
    functionName: 'drops',
    args: [dropId],
    query: { enabled: hasContract },
  });
  return data;
}

// ── Write hooks ──────────────────────────────────────────────────────

export function useDepositETH() {
  const { writeContract, isPending, isSuccess, error } = useWriteContract();

  const deposit = (ethAmount: string) => {
    if (!hasContract) return;
    writeContract({
      abi: TREASURE_CHEST_ABI,
      address: TREASURE_CHEST_ADDRESS,
      functionName: 'depositETH',
      value: parseEther(ethAmount),
    });
  };

  return { deposit, isPending, isSuccess, error };
}

export function useDepositERC20() {
  const { writeContract, isPending, isSuccess, error } = useWriteContract();
  const { writeContract: approveWrite, isPending: approvePending } = useWriteContract();

  const approve = (tokenAddress: Address, amount: bigint) => {
    approveWrite({
      abi: ERC20_APPROVE_ABI,
      address: tokenAddress,
      functionName: 'approve',
      args: [TREASURE_CHEST_ADDRESS, amount],
    });
  };

  const deposit = (tokenAddress: Address, amount: bigint) => {
    if (!hasContract) return;
    writeContract({
      abi: TREASURE_CHEST_ABI,
      address: TREASURE_CHEST_ADDRESS,
      functionName: 'depositERC20',
      args: [tokenAddress, amount],
    });
  };

  return { approve, deposit, isPending, isSuccess, error, approvePending };
}

export function useDepositERC721() {
  const { writeContract, isPending, isSuccess, error } = useWriteContract();
  const { writeContract: approveWrite, isPending: approvePending } = useWriteContract();

  const approve = (tokenAddress: Address, tokenId: bigint) => {
    approveWrite({
      abi: ERC721_APPROVE_ABI,
      address: tokenAddress,
      functionName: 'approve',
      args: [TREASURE_CHEST_ADDRESS, tokenId],
    });
  };

  const deposit = (tokenAddress: Address, tokenId: bigint) => {
    if (!hasContract) return;
    writeContract({
      abi: TREASURE_CHEST_ABI,
      address: TREASURE_CHEST_ADDRESS,
      functionName: 'depositERC721',
      args: [tokenAddress, tokenId],
    });
  };

  return { approve, deposit, isPending, isSuccess, error, approvePending };
}

export function useClaimDrop() {
  const { writeContract, isPending, isSuccess, error } = useWriteContract();

  const claim = (dropId: bigint) => {
    if (!hasContract) return;
    writeContract({
      abi: TREASURE_CHEST_ABI,
      address: TREASURE_CHEST_ADDRESS,
      functionName: 'claim',
      args: [dropId],
    });
  };

  return { claim, isPending, isSuccess, error };
}

export { TREASURE_CHEST_ADDRESS, hasContract };
