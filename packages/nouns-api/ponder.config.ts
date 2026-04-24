// dRPC free tier: 210M CUs/mo, ~100 RPS, flat 20 CU per method (incl. eth_getLogs)
// Free public RPCs (publicnode, llamarpc) can't handle 38+ address Stream factory queries
import { nounsAuctionHouseAbi } from '@nouns/sdk/auction-house';
import { nounsTokenAbi } from '@nouns/sdk/token';
import { nounsGovernorAbi } from '@nouns/sdk/governor';
import { nounsDataAbi } from '@nouns/sdk/data';
import { nounsStreamFactoryAbi } from '@nouns/sdk/stream-factory';
import { nounsStreamAbi } from '@nouns/sdk/stream';
import { smallGrantsTreasuryAbi } from './src/abi/SmallGrantsTreasury';
import { nounV2AuctionHouseAbi } from './src/abi/NounV2AuctionHouse';
import { nounV2TreasuryAbi } from './src/abi/NounV2Treasury';
import { createConfig, factory } from 'ponder';
import { getAbiItem } from 'viem';
import dotenv from 'dotenv';

dotenv.config();

// Primary: dRPC endpoint from env var
// NOTE: Do NOT add free public RPCs — they reject multi-address eth_getLogs
// (Stream factory creates 38+ addresses which publicnode/llamarpc can't handle)
const rpcUrls = (process.env.PONDER_RPC_URL_1 ?? '').split(',').filter(Boolean);

// ── NounV2 addresses / startBlock ──────────────────────────────────────────
// Placeholder zero addresses are a no-op until deploy; then flip the env vars.
// startBlock default "latest" tells Ponder to index only future blocks.
const NOUNV2_AUCTION_HOUSE_ADDRESS =
  (process.env.NOUNV2_AUCTION_HOUSE_ADDRESS as `0x${string}` | undefined) ??
  '0x0000000000000000000000000000000000000000';
const NOUNV2_TREASURY_ADDRESS =
  (process.env.NOUNV2_TREASURY_ADDRESS as `0x${string}` | undefined) ??
  '0x0000000000000000000000000000000000000000';

// Ponder accepts a block number or the literal "latest". Coerce numeric strings
// to number; leave "latest" as-is.
const nounV2StartBlockRaw = process.env.NOUNV2_START_BLOCK ?? 'latest';
const nounV2StartBlock: number | 'latest' =
  nounV2StartBlockRaw === 'latest' ? 'latest' : Number(nounV2StartBlockRaw);

const mainnetConfig = createConfig({
  chains: {
    mainnet: {
      id: 1,
      rpc: rpcUrls,
      ws: process.env.PONDER_WS_URL_1,
      ethGetLogsBlockRange: 500,
      maxRpcRequestsPerSecond: 8,
    },
  },
  contracts: {
    NounsAuctionHouseV2: {
      chain: 'mainnet',
      address: '0x830BD73E4184ceF73443C15111a1DF14e495C706',
      abi: nounsAuctionHouseAbi,
      startBlock: 12985451,
    },
    NounsToken: {
      chain: 'mainnet',
      address: '0x9C8fF314C9Bc7F6e59A9d9225Fb22946427eDC03',
      abi: nounsTokenAbi,
      startBlock: 12985438,
    },
    NounsDAOV4: {
      chain: 'mainnet',
      address: '0x6f3E6272A167e8AcCb32072d08E0957F9c79223d',
      abi: nounsGovernorAbi,
      startBlock: 12985453,
    },
    NounsDAOData: {
      chain: 'mainnet',
      address: '0xf790A5f59678dd733fb3De93493A91f472ca1365',
      abi: nounsDataAbi,
      startBlock: 17812145,
    },
    StreamFactory: {
      chain: 'mainnet',
      address: '0x0fd206FC7A7dBcD5661157eDCb1FFDD0D02A61ff',
      abi: nounsStreamFactoryAbi,
      startBlock: 16576500,
    },

    Stream: {
      chain: 'mainnet',
      address: factory({
        address: '0x0fd206FC7A7dBcD5661157eDCb1FFDD0D02A61ff',
        event: getAbiItem({ abi: nounsStreamFactoryAbi, name: 'StreamCreated' }),
        parameter: getAbiItem({ abi: nounsStreamFactoryAbi, name: 'StreamCreated' }).inputs[7].name,
      }),
      abi: nounsStreamAbi,
      startBlock: 16576500,
    },

    // Small Grants Treasury — noun.wtf exclusive governance
    SmallGrantsTreasury: {
      chain: 'mainnet',
      address: '0xBAc9233725440c595b19d975309CC98cb259253a',
      abi: smallGrantsTreasuryAbi,
      startBlock: 24650190,
    },

    // NounV2 fork — addresses come from env vars (placeholders until mainnet deploy)
    NounV2AuctionHouse: {
      chain: 'mainnet',
      address: NOUNV2_AUCTION_HOUSE_ADDRESS,
      abi: nounV2AuctionHouseAbi,
      startBlock: nounV2StartBlock,
    },
    NounV2Treasury: {
      chain: 'mainnet',
      address: NOUNV2_TREASURY_ADDRESS,
      abi: nounV2TreasuryAbi,
      startBlock: nounV2StartBlock,
    },
  },
});

const sepoliaConfig = createConfig({
  chains: {
    sepolia: {
      id: 11155111,
      rpc: process.env.PONDER_RPC_URL_11155111,
      ws: process.env.PONDER_WS_URL_11155111,
    },
  },
  contracts: {
    NounsAuctionHouseV2: {
      chain: 'sepolia',
      address: '0x488609b7113FCf3B761A05956300d605E8f6BcAf',
      abi: nounsAuctionHouseAbi,
      startBlock: 3594847,
    },
    NounsToken: {
      chain: 'sepolia',
      address: '0x4C4674bb72a096855496a7204962297bd7e12b85',
      abi: nounsTokenAbi,
      startBlock: 3594846,
    },
    NounsDAOV4: {
      chain: 'sepolia',
      address: '0x35d2670d7C8931AACdd37C89Ddcb0638c3c44A57',
      abi: nounsGovernorAbi,
      startBlock: 3594849,
    },
    NounsDAOData: {
      chain: 'sepolia',
      address: '0x9040f720AA8A693f950b9cF94764b4b06079D002',
      abi: nounsDataAbi,
      startBlock: 3594900,
    },
    StreamFactory: {
      chain: 'sepolia',
      address: '0xb78ccF3BD015f209fb9B2d3d132FD8784Df78DF5',
      abi: nounsStreamFactoryAbi,
      startBlock: 2564095,
    },

    Stream: {
      chain: 'sepolia',
      address: factory({
        address: '0xb78ccF3BD015f209fb9B2d3d132FD8784Df78DF5',
        event: getAbiItem({ abi: nounsStreamFactoryAbi, name: 'StreamCreated' }),
        parameter: getAbiItem({ abi: nounsStreamFactoryAbi, name: 'StreamCreated' }).inputs[7].name,
      }),
      abi: nounsStreamAbi,
      startBlock: 2564095,
    },
  },
});

export default process.env.PONDER_CHAIN === 'sepolia' ? sepoliaConfig : mainnetConfig;
