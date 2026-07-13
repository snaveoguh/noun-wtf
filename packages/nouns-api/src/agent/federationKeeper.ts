// ─── Federation Keeper — auto-mirror V1 props, auto-relay to V1 ──────────────
//
// The trust-minimised half of the NounsFederation flow. This keeper only
// *triggers* the two permissionless entrypoints on schedule; it can never
// choose a vote (the contract derives that from the on-chain tally):
//
//   1. mirror(v1ProposalId)  — opened once a live V1 proposal drops inside the
//      lead window (~26h out). The contract rejects too-early / too-late / dupes,
//      so the keeper reads state first and only sends when it will land.
//   2. relay(mirrorId)       — sent once a mirror's voting window closes and the
//      contract reports isRelayable(). Casts the aggregated V2 tally to V1.
//
// Governance moves in ~12s blocks over hours, so this polls slowly (default
// 10min) — nothing like the settlement hot path in blockWatcher.ts. Every write
// is gated on a contract read (v1ToMirror==0 / isRelayable==true) so a failing
// precondition is skipped, never broadcast as a reverting tx.
//
// Why not once a day: V1 proposals are rare, but the two actions have hard block
// windows. A mirror must open while the V1 prop still has between ~26h and the
// contract's MIN_LEAD_BLOCKS (~13h) remaining; a relay must land after the ~12h
// V2 vote closes but before the V1 deadline (~14h window). A 24h poll can drift
// past the mirror floor or skip clean over the relay window — so we keep it to
// minutes. 10min gives dozens of checks inside every window at negligible cost.
//
// Disabled unless BOTH are set: NOUNS_FEDERATION_ADDRESS and a keeper key
// (FEDERATION_KEEPER_PRIVATE_KEY, falling back to NOUNIRL_PRIVATE_KEY).

import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
  type Hex,
} from 'viem';
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';

import { nounsFederationAbi } from '../abi/NounsFederation.js';

import { AGENT_RPC_URL } from './constants.js';

// ─── Config ──────────────────────────────────────────────────────────────────

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const FEDERATION_ADDRESS = (process.env.NOUNS_FEDERATION_ADDRESS ?? ZERO_ADDRESS) as `0x${string}`;

// Nouns DAO V1 governor (mainnet) — same address the indexer uses for NounsDAOV4.
const V1_GOVERNOR_ADDRESS = (process.env.FEDERATION_V1_GOVERNOR ??
  '0x6f3E6272A167e8AcCb32072d08E0957F9c79223d') as `0x${string}`;

const KEEPER_PRIVATE_KEY =
  process.env.FEDERATION_KEEPER_PRIVATE_KEY ?? process.env.NOUNIRL_PRIVATE_KEY;

const POLL_INTERVAL_MS = Number(process.env.FEDERATION_POLL_INTERVAL_MS ?? 600_000);

// Fire mirror() once a V1 proposal has <= this many blocks remaining. ~26h at
// 12s blocks. The contract enforces the hard [MIN_LEAD_BLOCKS, maxLeadBlocks]
// window; this is just when the keeper starts *trying*.
const TARGET_LEAD_BLOCKS = Number(process.env.FEDERATION_TARGET_LEAD_BLOCKS ?? 7_800);

// How many of the most recent V1 proposals to scan each tick.
const SCAN_RECENT_V1 = Number(process.env.FEDERATION_SCAN_RECENT_V1 ?? 12);

const V1_STATE_ACTIVE = 1; // NounsDAO ProposalState.Active

// ─── Minimal V1 governor ABI (only what discovery needs) ─────────────────────

const V1_GOVERNOR_ABI = [
  {
    type: 'function',
    name: 'proposalCount',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'state',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'proposals',
    inputs: [{ name: 'proposalId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'id', type: 'uint256' },
          { name: 'proposer', type: 'address' },
          { name: 'proposalThreshold', type: 'uint256' },
          { name: 'quorumVotes', type: 'uint256' },
          { name: 'eta', type: 'uint256' },
          { name: 'startBlock', type: 'uint256' },
          { name: 'endBlock', type: 'uint256' },
          { name: 'forVotes', type: 'uint256' },
          { name: 'againstVotes', type: 'uint256' },
          { name: 'abstainVotes', type: 'uint256' },
          { name: 'canceled', type: 'bool' },
          { name: 'vetoed', type: 'bool' },
          { name: 'executed', type: 'bool' },
          { name: 'totalSupply', type: 'uint256' },
          { name: 'creationBlock', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const;

// ─── State ─────────────────────────────────────────────────────────────────

interface KeeperState {
  running: boolean;
  configured: boolean;
  keeperAddress: string | null;
  lastTickAt: number;
  lastBlock: number;
  mirrorsOpened: number;
  votesRelayed: number;
  errors: string[];
}

const state: KeeperState = {
  running: false,
  configured: false,
  keeperAddress: null,
  lastTickAt: 0,
  lastBlock: 0,
  mirrorsOpened: 0,
  votesRelayed: 0,
  errors: [],
};

let publicClient: PublicClient | null = null;
let walletClient: WalletClient | null = null;
let account: PrivateKeyAccount | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let ticking = false;

function pushError(msg: string): void {
  console.warn(`[Federation] ${msg}`);
  state.errors.push(msg);
  if (state.errors.length > 50) state.errors.shift();
}

// ─── Discovery + actions ─────────────────────────────────────────────────────

/** Scan recent V1 proposals; open a mirror for any active one inside the window. */
async function scanAndMirror(currentBlock: bigint): Promise<void> {
  if (!publicClient || !walletClient || !account) return;

  const count = (await publicClient.readContract({
    address: V1_GOVERNOR_ADDRESS,
    abi: V1_GOVERNOR_ABI,
    functionName: 'proposalCount',
  })) as bigint;

  const newest = Number(count);
  const oldest = Math.max(1, newest - SCAN_RECENT_V1 + 1);

  for (let id = newest; id >= oldest; id--) {
    const propId = BigInt(id);
    try {
      const st = Number(
        await publicClient.readContract({
          address: V1_GOVERNOR_ADDRESS,
          abi: V1_GOVERNOR_ABI,
          functionName: 'state',
          args: [propId],
        }),
      );
      if (st !== V1_STATE_ACTIVE) continue;

      // Already mirrored? (contract also guards, but skip the tx.)
      const existingMirror = (await publicClient.readContract({
        address: FEDERATION_ADDRESS,
        abi: nounsFederationAbi,
        functionName: 'v1ToMirror',
        args: [propId],
      })) as bigint;
      if (existingMirror !== 0n) continue;

      const prop = (await publicClient.readContract({
        address: V1_GOVERNOR_ADDRESS,
        abi: V1_GOVERNOR_ABI,
        functionName: 'proposals',
        args: [propId],
      })) as { endBlock: bigint };
      const endBlock = prop.endBlock;
      if (endBlock <= currentBlock) continue;
      const blocksRemaining = endBlock - currentBlock;

      // Wait until the proposal is inside the target lead window. The contract's
      // hard MIN_LEAD_BLOCKS floor is checked on-chain; if we're past it the send
      // reverts and is caught below (rare edge — we normally fire well before).
      if (blocksRemaining > BigInt(TARGET_LEAD_BLOCKS)) continue;

      console.log(
        `[Federation] Opening mirror for V1 prop #${id} (${blocksRemaining} blocks remaining)`,
      );
      const hash = await walletClient.writeContract({
        address: FEDERATION_ADDRESS,
        abi: nounsFederationAbi,
        functionName: 'mirror',
        args: [propId],
        account,
        chain: mainnet,
      });
      state.mirrorsOpened++;
      console.log(`[Federation] mirror(${id}) tx ${hash}`);
    } catch (err) {
      pushError(`mirror scan for V1 #${id} failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}

/** Relay any mirror whose window has closed and the contract reports relayable. */
async function scanAndRelay(): Promise<void> {
  if (!publicClient || !walletClient || !account) return;

  const count = (await publicClient.readContract({
    address: FEDERATION_ADDRESS,
    abi: nounsFederationAbi,
    functionName: 'mirrorCount',
  })) as bigint;

  const newest = Number(count);
  const oldest = Math.max(1, newest - SCAN_RECENT_V1 + 1);

  for (let id = newest; id >= oldest; id--) {
    const mirrorId = BigInt(id);
    try {
      const relayable = (await publicClient.readContract({
        address: FEDERATION_ADDRESS,
        abi: nounsFederationAbi,
        functionName: 'isRelayable',
        args: [mirrorId],
      })) as boolean;
      if (!relayable) continue;

      console.log(`[Federation] Relaying mirror #${id} to V1`);
      const hash = await walletClient.writeContract({
        address: FEDERATION_ADDRESS,
        abi: nounsFederationAbi,
        functionName: 'relay',
        args: [mirrorId],
        account,
        chain: mainnet,
      });
      state.votesRelayed++;
      console.log(`[Federation] relay(${id}) tx ${hash}`);
    } catch (err) {
      pushError(`relay for mirror #${id} failed: ${err instanceof Error ? err.message : err}`);
    }
  }
}

async function tick(): Promise<void> {
  if (ticking || !publicClient) return;
  ticking = true;
  try {
    const currentBlock = await publicClient.getBlockNumber();
    state.lastBlock = Number(currentBlock);
    state.lastTickAt = Date.now();
    await scanAndMirror(currentBlock);
    await scanAndRelay();
  } catch (err) {
    pushError(`tick failed: ${err instanceof Error ? err.message : err}`);
  } finally {
    ticking = false;
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function startFederationKeeper(): void {
  if (state.running) return;

  if (FEDERATION_ADDRESS === ZERO_ADDRESS) {
    console.log('[Federation] NOUNS_FEDERATION_ADDRESS unset — keeper disabled');
    return;
  }
  if (!KEEPER_PRIVATE_KEY) {
    console.log('[Federation] No keeper key — federation runs read-only (no auto mirror/relay)');
    return;
  }

  try {
    account = privateKeyToAccount(KEEPER_PRIVATE_KEY as Hex);
    publicClient = createPublicClient({ chain: mainnet, transport: http(AGENT_RPC_URL) });
    walletClient = createWalletClient({
      chain: mainnet,
      transport: http(AGENT_RPC_URL),
      account,
    });
  } catch (err) {
    pushError(`init failed: ${err instanceof Error ? err.message : err}`);
    return;
  }

  state.configured = true;
  state.running = true;
  state.keeperAddress = account.address;
  console.log(
    `[Federation] ⌐◨-◨ Keeper started — federation=${FEDERATION_ADDRESS} keeper=${account.address} poll=${POLL_INTERVAL_MS}ms`,
  );

  void tick();
  timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
}

export function stopFederationKeeper(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  state.running = false;
  console.log('[Federation] Keeper stopped');
}

export function getFederationKeeperState(): KeeperState {
  return { ...state };
}
