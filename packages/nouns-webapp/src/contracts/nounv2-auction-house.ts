// Minimal ABI for NounV2AuctionHouse (V1-style fork of NounsAuctionHouse
// with an additional `beneficiary`/`setBeneficiary` pair).
// Address is injected via VITE_NOUNV2_AUCTION_HOUSE_ADDRESS after deployment.

export const nounV2AuctionHouseAbi = [
  {
    type: 'function',
    name: 'auction',
    inputs: [],
    outputs: [
      { name: 'nounId', type: 'uint256', internalType: 'uint256' },
      { name: 'amount', type: 'uint256', internalType: 'uint256' },
      { name: 'startTime', type: 'uint256', internalType: 'uint256' },
      { name: 'endTime', type: 'uint256', internalType: 'uint256' },
      { name: 'bidder', type: 'address', internalType: 'address payable' },
      { name: 'settled', type: 'bool', internalType: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'createBid',
    inputs: [{ name: 'nounId', type: 'uint256', internalType: 'uint256' }],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    name: 'settleCurrentAndCreateNewAuction',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'settleAuction',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'reservePrice',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'duration',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'timeBuffer',
    inputs: [],
    outputs: [{ name: '', type: 'uint256', internalType: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'minBidIncrementPercentage',
    inputs: [],
    outputs: [{ name: '', type: 'uint8', internalType: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'beneficiary',
    inputs: [],
    outputs: [{ name: '', type: 'address', internalType: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'setBeneficiary',
    inputs: [{ name: '_beneficiary', type: 'address', internalType: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setReservePrice',
    inputs: [{ name: '_reservePrice', type: 'uint256', internalType: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setTimeBuffer',
    inputs: [{ name: '_timeBuffer', type: 'uint256', internalType: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setMinBidIncrementPercentage',
    inputs: [{ name: '_minBidIncrementPercentage', type: 'uint8', internalType: 'uint8' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'pause',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'unpause',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    name: 'AuctionCreated',
    inputs: [
      { name: 'nounId', type: 'uint256', indexed: true, internalType: 'uint256' },
      { name: 'startTime', type: 'uint256', indexed: false, internalType: 'uint256' },
      { name: 'endTime', type: 'uint256', indexed: false, internalType: 'uint256' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'AuctionBid',
    inputs: [
      { name: 'nounId', type: 'uint256', indexed: true, internalType: 'uint256' },
      { name: 'sender', type: 'address', indexed: false, internalType: 'address' },
      { name: 'value', type: 'uint256', indexed: false, internalType: 'uint256' },
      { name: 'extended', type: 'bool', indexed: false, internalType: 'bool' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'AuctionExtended',
    inputs: [
      { name: 'nounId', type: 'uint256', indexed: true, internalType: 'uint256' },
      { name: 'endTime', type: 'uint256', indexed: false, internalType: 'uint256' },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'AuctionSettled',
    inputs: [
      { name: 'nounId', type: 'uint256', indexed: true, internalType: 'uint256' },
      { name: 'winner', type: 'address', indexed: false, internalType: 'address' },
      { name: 'amount', type: 'uint256', indexed: false, internalType: 'uint256' },
    ],
    anonymous: false,
  },
] as const;

export const NOUNV2_AUCTION_HOUSE_ADDRESS = ((import.meta.env
  .VITE_NOUNV2_AUCTION_HOUSE_ADDRESS as string | undefined) ??
  '0x0000000000000000000000000000000000000000') as `0x${string}`;
