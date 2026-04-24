// Minimal ABI for NounV2Token (standard Nouns ERC721 interface).
// Address is injected via VITE_NOUNV2_TOKEN_ADDRESS after deployment.

export const nounV2TokenAbi = [
  {
    type: 'function',
    name: 'balanceOf',
    inputs: [{ name: 'owner', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'ownerOf',
    inputs: [{ name: 'tokenId', type: 'uint256', internalType: 'uint256' }],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'tokenURI',
    inputs: [{ name: 'tokenId', type: 'uint256', internalType: 'uint256' }],
    outputs: [{ name: '', type: 'string', internalType: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getPriorVotes',
    inputs: [
      { name: 'account', type: 'address', internalType: 'address' },
      { name: 'blockNumber', type: 'uint256', internalType: 'uint256' },
    ],
    outputs: [{ name: '', type: 'uint96', internalType: 'uint96' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getCurrentVotes',
    inputs: [{ name: 'account', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'uint96', internalType: 'uint96' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'totalSupply',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'delegates',
    inputs: [{ name: 'delegator', type: 'address', internalType: 'address' }],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'delegate',
    inputs: [{ name: 'delegatee', type: 'address', internalType: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

// Injected via env after deploy — zero address is a safe no-op default.
export const NOUNV2_TOKEN_ADDRESS = ((import.meta.env.VITE_NOUNV2_TOKEN_ADDRESS as
  | string
  | undefined) ?? '0x0000000000000000000000000000000000000000') as `0x${string}`;
