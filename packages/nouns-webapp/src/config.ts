import { hardhat, mainnet, sepolia } from 'viem/chains';

import { getSubgraphUrl } from '@/lib/subgraphSettings';

interface ContractParameters {
  executor: {
    GRACE_PERIOD_SECONDS: number;
  };
}
interface AppConfig {
  jsonRpcUri: string;
  wsRpcUri: string;
  subgraphApiUri: string;
  enableHistory: boolean;
}

type SupportedChains = typeof mainnet.id | typeof hardhat.id | typeof sepolia.id;

interface CacheBucket {
  name: string;
  version: string;
}

export const cache: Record<string, CacheBucket> = {
  seed: {
    name: 'seed',
    version: 'v1',
  },
  ens: {
    name: 'ens',
    version: 'v1',
  },
};

export const cacheKey = (bucket: CacheBucket, ...parts: (string | number)[]) => {
  return [bucket.name, bucket.version, ...parts].join('-').toLowerCase();
};

export const CHAIN_ID: SupportedChains = import.meta.env.VITE_CHAIN_ID ?? sepolia.id;

export const ETHERSCAN_API_KEY = import.meta.env.VITE_ETHERSCAN_API_KEY ?? '';

/** noun.wtf client ID for DAO client incentive rewards (bidding, voting, proposing) */
export const NOUN_WTF_CLIENT_ID = 37;

export const WALLET_CONNECT_V2_PROJECT_ID = import.meta.env.VITE_WALLET_CONNECT_V2_PROJECT_ID ?? '';

export const createNetworkHttpUrl = (_network: string): string => {
  const custom = import.meta.env.VITE_MAINNET_JSONRPC as string;
  return custom || 'https://ethereum-rpc.publicnode.com';
};

export const createNetworkWsUrl = (_network: string): string => {
  const custom = import.meta.env.VITE_MAINNET_WSRPC as string;
  return custom || 'wss://ethereum-rpc.publicnode.com';
};

const app: Record<SupportedChains, AppConfig> = {
  [sepolia.id]: {
    jsonRpcUri: createNetworkHttpUrl('sepolia'),
    wsRpcUri: createNetworkWsUrl('sepolia'),
    subgraphApiUri: import.meta.env.VITE_SEPOLIA_SUBGRAPH ?? '',
    enableHistory: import.meta.env.VITE_ENABLE_HISTORY === 'true',
  },
  [mainnet.id]: {
    jsonRpcUri: createNetworkHttpUrl('mainnet'),
    wsRpcUri: createNetworkWsUrl('mainnet'),
    subgraphApiUri: getSubgraphUrl(),
    enableHistory: import.meta.env.VITE_ENABLE_HISTORY === 'true',
  },
  [hardhat.id]: {
    jsonRpcUri: 'http://localhost:8545',
    wsRpcUri: 'ws://localhost:8545',
    subgraphApiUri: 'http://localhost:8000/subgraphs/name/nounsdao/nouns-subgraph',
    enableHistory: import.meta.env.VITE_ENABLE_HISTORY === 'true',
  },
};

const contractParameters: Record<SupportedChains, ContractParameters> = {
  [sepolia.id]: {
    executor: {
      GRACE_PERIOD_SECONDS: 1814400,
    },
  },
  [mainnet.id]: {
    executor: {
      GRACE_PERIOD_SECONDS: 1814400,
    },
  },
  [hardhat.id]: {
    executor: {
      GRACE_PERIOD_SECONDS: 1814400,
    },
  },
};

const config = {
  app: app[CHAIN_ID],
  contractParameters: contractParameters[CHAIN_ID],
  featureToggles: {
    daoGteV3: false,
    proposeOnV1: true,
    candidates: true,
    fork: true,
  },
};

export default config;
