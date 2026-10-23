import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';

import { NOUNS_TOKEN_ABI, NOUNS_TOKEN_ADDRESS } from '../../agent/constants.js';

// ─── Noun Balance Check (for deploy gating) ────────────────────────────────
export const nounCheckClient = createPublicClient({
  chain: mainnet,
  transport: http(process.env.PONDER_RPC_URL_1 || 'https://ethereum-rpc.publicnode.com'),
});

// ─── Block Timing Helpers ──────────────────────────────────────────────────
const BLOCK_TIME_SECONDS = 12;

export async function getCurrentBlock(): Promise<bigint> {
  return nounCheckClient.getBlockNumber();
}

export function formatBlocksRemaining(
  currentBlock: bigint,
  endBlock: string | bigint | null | undefined,
): { blocksLeft: number; timeLeftHours: number; timeLeftFormatted: string; hasEnded: boolean } {
  if (!endBlock)
    return { blocksLeft: 0, timeLeftHours: 0, timeLeftFormatted: 'unknown', hasEnded: true };
  const end = BigInt(endBlock);
  if (currentBlock >= end) {
    return { blocksLeft: 0, timeLeftHours: 0, timeLeftFormatted: 'ended', hasEnded: true };
  }
  const blocksLeft = Number(end - currentBlock);
  const secondsLeft = blocksLeft * BLOCK_TIME_SECONDS;
  const hoursLeft = secondsLeft / 3600;
  let formatted: string;
  if (hoursLeft < 1) {
    const mins = Math.round(secondsLeft / 60);
    formatted = `~${mins} minutes`;
  } else if (hoursLeft < 24) {
    formatted = `~${hoursLeft.toFixed(1)} hours`;
  } else {
    const days = hoursLeft / 24;
    formatted = `~${days.toFixed(1)} days`;
  }
  return { blocksLeft, timeLeftHours: hoursLeft, timeLeftFormatted: formatted, hasEnded: false };
}

export async function getNounBalance(address: string): Promise<number> {
  try {
    const balance = await nounCheckClient.readContract({
      address: NOUNS_TOKEN_ADDRESS,
      abi: NOUNS_TOKEN_ABI,
      functionName: 'balanceOf',
      args: [address as `0x${string}`],
    });
    return Number(balance);
  } catch (err) {
    console.error('[NounIRL] Failed to check Noun balance:', err);
    return 0;
  }
}
