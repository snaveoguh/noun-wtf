// Activity-feed external sources (Lil Nouns subgraph, on-chain sale detection)
// moved to ./activityFeed.ts — `checkTxForSale` is imported from there.

/**
 * Auction price prediction market stats.
 * Returns current live auction + last 7 settled auctions (skipping nounder/empty)
 * and their trailing average.
 */
// Direct contract reads so current bid + settlement data are always fresh,
// not gated on Ponder indexing latency (which was showing stale #1877 with
// amount=0 while #1878 was live at 0.57 ETH).
export const NOUNS_AUCTION_HOUSE = '0x830BD73E4184ceF73443C15111a1DF14e495C706' as const;
export const AUCTION_HOUSE_ABI = [
  {
    type: 'function',
    name: 'auction',
    inputs: [],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'nounId', type: 'uint96' },
          { name: 'amount', type: 'uint128' },
          { name: 'startTime', type: 'uint40' },
          { name: 'endTime', type: 'uint40' },
          { name: 'bidder', type: 'address' },
          { name: 'settled', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getSettlements',
    inputs: [
      { name: 'auctionCount', type: 'uint256' },
      { name: 'skipEmptyValues', type: 'bool' },
    ],
    outputs: [
      {
        type: 'tuple[]',
        components: [
          { name: 'blockTimestamp', type: 'uint32' },
          { name: 'amount', type: 'uint256' },
          { name: 'winner', type: 'address' },
          { name: 'nounId', type: 'uint256' },
          { name: 'clientId', type: 'uint32' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const;
