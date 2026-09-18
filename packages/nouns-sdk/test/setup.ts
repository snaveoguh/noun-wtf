import FetchAdapter from '@pollyjs/adapter-fetch';
import { Polly } from '@pollyjs/core';
import FSPersister from '@pollyjs/persister-fs';
import { mainnet, sepolia } from 'viem/chains';

// Register Polly adapters
Polly.register(FetchAdapter);
Polly.register(FSPersister);

// The tests build their transports with `http(process.env.X_RPC_URL)`, so when the env var is unset
// viem's own default endpoint for the chain is what gets hit. Those defaults move between viem
// releases (sepolia went from drpc.org to thirdweb.com in the 2.4x line), and recordings are
// matched on URL, so derive the fallback from the chain definition instead of hardcoding it.
function normalizeRpcUrl(url: string): string {
  return url
    .replace(
      process.env.MAINNET_RPC_URL ?? mainnet.rpcUrls.default.http[0],
      'https://mainnet.rpc.local',
    )
    .replace(
      process.env.SEPOLIA_RPC_URL ?? sepolia.rpcUrls.default.http[0],
      'https://sepolia.rpc.local',
    );
}

export function setupPolly(testName: string) {
  const polly = new Polly(testName, {
    adapters: ['fetch'],
    persister: 'fs',
    mode: 'replay',
    recordIfMissing: !process.env.CI,
    recordFailedRequests: false,
    logLevel: 'WARN',
    persisterOptions: {
      fs: {
        recordingsDir: './test/__recordings__',
      },
    },
    matchRequestsBy: {
      method: true,
      url: (url: string) => normalizeRpcUrl(url),
      headers: false,
      body: true,
      order: false,
    },
  });

  polly.server.any().on('beforePersist', (_req, recording) => {
    recording.request.url = normalizeRpcUrl(recording.request.url);
    console.log('Recording HTTP request:', recording.request.url);
  });

  return polly;
}
