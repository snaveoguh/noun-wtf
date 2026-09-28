/**
 * Built-in ABIs for the contracts people actually propose against.
 *
 * The "Function Call" action step used to depend entirely on Etherscan for
 * the ABI: no API key on the deployment, a rate limit, an unverified
 * contract — and the function dropdown sat empty with no explanation. For
 * the Nouns contracts we already ship ABIs (the wagmi-generated files in
 * src/contracts), so resolve those locally first and only fall back to
 * Etherscan for everything else.
 *
 * The Client Rewards contract is hand-written from
 * packages/nouns-contracts/contracts/client-incentives/Rewards.sol — it's
 * the one clients need for `setClientApproval` and there is no generated
 * ABI for it in the repo. Keyed by the *proxy* address, which is what a
 * proposal targets (the DAO is its owner).
 */
import type { Abi } from 'viem';

import {
  nounsAuctionHouseAbi,
  nounsAuctionHouseAddress,
} from '@/contracts/nouns-auction-house.gen';
import { nounsDataAbi, nounsDataAddress } from '@/contracts/nouns-data.gen';
import { nounsDescriptorAbi, nounsDescriptorAddress } from '@/contracts/nouns-descriptor.gen';
import { nounsGovernorAbi, nounsGovernorAddress } from '@/contracts/nouns-governor.gen';
import {
  nounsLegacyTreasuryAbi,
  nounsLegacyTreasuryAddress,
} from '@/contracts/nouns-legacy-treasury.gen';
import { nounsPayerAbi, nounsPayerAddress } from '@/contracts/nouns-payer.gen';
import {
  nounsStreamFactoryAbi,
  nounsStreamFactoryAddress,
} from '@/contracts/nouns-stream-factory.gen';
import { nounsTokenBuyerAbi, nounsTokenBuyerAddress } from '@/contracts/nouns-token-buyer.gen';
import { nounsTokenAbi, nounsTokenAddress } from '@/contracts/nouns-token.gen';
import { nounsTreasuryAbi, nounsTreasuryAddress } from '@/contracts/nouns-treasury.gen';
import {
  NOUNV2_AUCTION_HOUSE_ADDRESS,
  nounV2AuctionHouseAbi,
} from '@/contracts/nounv2-auction-house';
import { NOUNV2_TOKEN_ADDRESS, nounV2TokenAbi } from '@/contracts/nounv2-token';
import { NOUNV2_TREASURY_ADDRESS, nounV2TreasuryAbi } from '@/contracts/nounv2-treasury';

export interface KnownContract {
  name: string;
  abi: Abi;
}

export const NOUNS_CLIENT_REWARDS_ADDRESS = '0x883860178F95d0C82413eDc1D6De530cB4771d55';

/** Governance-relevant surface of Rewards.sol (owner/admin + client functions). */
export const nounsClientRewardsAbi = [
  {
    type: 'function',
    name: 'setClientApproval',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'clientId', type: 'uint32' },
      { name: 'approved', type: 'bool' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setAuctionRewardParams',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'newParams',
        type: 'tuple',
        components: [
          { name: 'auctionRewardBps', type: 'uint16' },
          { name: 'minimumAuctionsBetweenUpdates', type: 'uint8' },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'enableAuctionRewards',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'disableAuctionRewards',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setProposalRewardParams',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'newParams',
        type: 'tuple',
        components: [
          { name: 'minimumRewardPeriod', type: 'uint32' },
          { name: 'numProposalsEnoughForReward', type: 'uint8' },
          { name: 'proposalRewardBps', type: 'uint16' },
          { name: 'votingRewardBps', type: 'uint16' },
        ],
      },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'enableProposalRewards',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'disableProposalRewards',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setAdmin',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newAdmin', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setETHToken',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newToken', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setDescriptor',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'descriptor_', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdrawToken',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  { type: 'function', name: 'pause', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  { type: 'function', name: 'unpause', stateMutability: 'nonpayable', inputs: [], outputs: [] },
  {
    type: 'function',
    name: 'registerClient',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'description', type: 'string' },
    ],
    outputs: [{ name: '', type: 'uint32' }],
  },
  {
    type: 'function',
    name: 'updateClientMetadata',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenId', type: 'uint32' },
      { name: 'name', type: 'string' },
      { name: 'description', type: 'string' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'updateRewardsForAuctions',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'lastNounId', type: 'uint32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdrawClientBalance',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'clientId', type: 'uint32' },
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint96' },
    ],
    outputs: [],
  },
] as const satisfies Abi;

const MAINNET = 1;

const KNOWN: Array<[string, KnownContract]> = [
  [nounsGovernorAddress[MAINNET], { name: 'Nouns DAO Governor', abi: nounsGovernorAbi as Abi }],
  [nounsTokenAddress[MAINNET], { name: 'Nouns Token', abi: nounsTokenAbi as Abi }],
  [
    nounsAuctionHouseAddress[MAINNET],
    { name: 'Nouns Auction House', abi: nounsAuctionHouseAbi as Abi },
  ],
  [nounsDataAddress[MAINNET], { name: 'Nouns DAO Data (candidates)', abi: nounsDataAbi as Abi }],
  [nounsTreasuryAddress[MAINNET], { name: 'Nouns Treasury', abi: nounsTreasuryAbi as Abi }],
  [nounsDescriptorAddress[MAINNET], { name: 'Nouns Descriptor', abi: nounsDescriptorAbi as Abi }],
  [nounsTokenBuyerAddress[MAINNET], { name: 'Nouns Token Buyer', abi: nounsTokenBuyerAbi as Abi }],
  [nounsPayerAddress[MAINNET], { name: 'Nouns Payer', abi: nounsPayerAbi as Abi }],
  [
    nounsStreamFactoryAddress[MAINNET],
    { name: 'Nouns Stream Factory', abi: nounsStreamFactoryAbi as Abi },
  ],
  [
    nounsLegacyTreasuryAddress[MAINNET],
    { name: 'Nouns Treasury V1 (legacy)', abi: nounsLegacyTreasuryAbi as Abi },
  ],
  [
    NOUNS_CLIENT_REWARDS_ADDRESS,
    { name: 'Nouns Client Rewards (proxy)', abi: nounsClientRewardsAbi as Abi },
  ],
  // V2 addresses come from env and may be empty in a dev build — filtered below.
  [NOUNV2_TOKEN_ADDRESS, { name: 'NounV2 Token', abi: nounV2TokenAbi as Abi }],
  [
    NOUNV2_AUCTION_HOUSE_ADDRESS,
    { name: 'NounV2 Auction House', abi: nounV2AuctionHouseAbi as Abi },
  ],
  [NOUNV2_TREASURY_ADDRESS, { name: 'NounV2 Treasury', abi: nounV2TreasuryAbi as Abi }],
];

const byAddress = new Map<string, KnownContract>(
  KNOWN.filter(
    ([a]) =>
      typeof a === 'string' &&
      a.startsWith('0x') &&
      a.length === 42 &&
      a !== '0x0000000000000000000000000000000000000000',
  ).map(([a, c]) => [a.toLowerCase(), c]),
);

/** Look up a bundled ABI by address (case-insensitive). */
export function getKnownContract(address: string): KnownContract | undefined {
  return byAddress.get(address.toLowerCase());
}
