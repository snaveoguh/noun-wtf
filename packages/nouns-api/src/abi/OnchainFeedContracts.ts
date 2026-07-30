// Minimal ABIs for the homepage onchain feed — only the events we index.
// Addresses/events verified against mainnet 2026-07-30:
// - CryptoPunksMarket PunkBought (native marketplace, price on-chain)
// - ENS ETHRegistrarController 0x59E16fcCd424… emits the 7-arg NameRegistered
//   (with referrer) — confirmed by decoding a live registration receipt.
// - ENS BaseRegistrar + CrypToadz: plain ERC721 Transfer.

export const cryptoPunksMarketAbi = [
  {
    type: 'event',
    name: 'PunkBought',
    inputs: [
      { name: 'punkIndex', type: 'uint256', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
      { name: 'fromAddress', type: 'address', indexed: true },
      { name: 'toAddress', type: 'address', indexed: true },
    ],
  },
] as const;

export const ensRegistrarControllerAbi = [
  {
    type: 'event',
    name: 'NameRegistered',
    inputs: [
      { name: 'name', type: 'string', indexed: false },
      { name: 'label', type: 'bytes32', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'baseCost', type: 'uint256', indexed: false },
      { name: 'premium', type: 'uint256', indexed: false },
      { name: 'expires', type: 'uint256', indexed: false },
      { name: 'referrer', type: 'bytes32', indexed: false },
    ],
  },
] as const;

export const erc721TransferAbi = [
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'tokenId', type: 'uint256', indexed: true },
    ],
  },
] as const;
