import type { Hono } from 'hono';

import { desc } from 'drizzle-orm';
import { db } from 'ponder:api';
import schema from 'ponder:schema';
import { createWalletClient, type Hex, http, verifyTypedData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { mainnet } from 'viem/chains';

import { smallGrantsTreasuryAbi } from '../../abi/SmallGrantsTreasury.js';
import { nounCheckClient } from '../lib/chain.js';
import { getLatestBlockCached } from '../lib/latestBlock.js';
import { computeDerivedGrantStatus } from '../lib/proposalStatus.js';

/** Extract original signer from description tag, strip the tag */
function extractSigner(desc: string): { signer: string | null; description: string } {
  const match = desc.match(/^<!--\s*signer:(0x[\dA-Fa-f]{40})\s*-->\n?/);
  if (match) {
    return { signer: match[1], description: desc.slice(match[0].length) };
  }
  return { signer: null, description: desc };
}

// ============================================================
// Gasless grant proposals — relayer submits on behalf of users
// ============================================================

const SMALL_GRANTS_ADDRESS = '0xBAc9233725440c595b19d975309CC98cb259253a' as const;

// EIP-712 domain and types for grant proposal signing
const GRANT_PROPOSAL_DOMAIN = {
  name: 'NounGrants',
  version: '1',
  chainId: 1,
  verifyingContract: SMALL_GRANTS_ADDRESS,
} as const;

const GRANT_PROPOSAL_TYPES = {
  Proposal: [
    { name: 'targets', type: 'address[]' },
    { name: 'values', type: 'uint256[]' },
    { name: 'signatures', type: 'string[]' },
    { name: 'calldatas', type: 'bytes[]' },
    { name: 'description', type: 'string' },
  ],
} as const;

// Rate limiting: 1 proposal per address per hour
const proposalRateLimit = new Map<string, number>();

// Relayer wallet (nounirl)
const relayerPrivateKey = process.env.NOUNIRL_PRIVATE_KEY;
const relayerRpcUrl = process.env.NOUNIRL_RPC_URL || process.env.PONDER_RPC_URL_1;
const relayerAccount = relayerPrivateKey ? privateKeyToAccount(relayerPrivateKey as Hex) : null;
const relayerWallet =
  relayerAccount && relayerRpcUrl
    ? createWalletClient({
        chain: mainnet,
        transport: http(relayerRpcUrl),
        account: relayerAccount,
      })
    : null;

export function registerGrantRoutes(app: Hono) {
  /** All grants — single JSON response, with derived status (DEFEATED/SUCCEEDED) */
  app.get('/api/grants', async c => {
    const grants = await db.select().from(schema.grant).orderBy(desc(schema.grant.id));
    const latestBlock = await getLatestBlockCached();
    const items = grants.map(g => {
      const { signer, description } = extractSigner(g.description);
      const item: Record<string, unknown> = {
        ...g,
        id: String(g.id),
        description,
        signer,
        snapshotBlock: String(g.snapshotBlock),
        startBlock: String(g.startBlock),
        endBlock: String(g.endBlock),
        createdAtBlock: String(g.createdAtBlock),
        executionETA: g.executionETA != null ? String(g.executionETA) : null,
        createdAt: String(new Date(g.createdAt).getTime()),
      };
      if (latestBlock > 0n) {
        item.status = computeDerivedGrantStatus(item, latestBlock);
      }
      return item;
    });
    return c.json(items);
  });

  /** Single grant with votes and status changes — bypasses GraphQL truncation */
  app.get('/api/grants/:id', async c => {
    const idParam = c.req.param('id');
    const allGrants = await db.select().from(schema.grant);
    const g = allGrants.find(gr => String(gr.id) === idParam);
    if (!g) return c.json({ error: 'not found' }, 404);

    const allVotes = await db
      .select()
      .from(schema.grantVote)
      .orderBy(desc(schema.grantVote.createdAtBlock));
    const votes = allVotes.filter(v => String(v.grantId) === idParam);

    const allChanges = await db
      .select()
      .from(schema.grantStatusChange)
      .orderBy(schema.grantStatusChange.createdAtBlock);
    const changes = allChanges.filter(sc => String(sc.grantId) === idParam);

    const latestBlock = await getLatestBlockCached();

    const { signer, description } = extractSigner(g.description);
    const item: Record<string, unknown> = {
      ...g,
      id: String(g.id),
      description,
      signer,
      snapshotBlock: String(g.snapshotBlock),
      startBlock: String(g.startBlock),
      endBlock: String(g.endBlock),
      createdAtBlock: String(g.createdAtBlock),
      executionETA: g.executionETA != null ? String(g.executionETA) : null,
      createdAt: String(new Date(g.createdAt).getTime()),
    };
    if (latestBlock > 0n) {
      item.status = computeDerivedGrantStatus(item, latestBlock);
    }

    return c.json({
      grant: item,
      votes: votes.map(v => ({
        voter: v.voter,
        support: v.support,
        votes: v.votes,
        reason: v.reason,
        createdAtTransaction: v.createdAtTransaction,
      })),
      statusChanges: changes.map(sc => ({
        status: sc.status,
        createdAtBlock: String(sc.createdAtBlock),
        createdAtTransaction: sc.createdAtTransaction,
      })),
    });
  });
}

export function registerGrantProposeRoutes(app: Hono) {
  app.post('/api/grants/propose', async c => {
    if (!relayerWallet || !relayerAccount) {
      return c.json({ error: 'Relayer not configured' }, 503);
    }

    const body = await c.req.json();
    const { proposer, targets, values, signatures, calldatas, description, signature } = body;

    // Validate required fields
    if (!proposer || !targets?.length || !values?.length || !description || !signature) {
      return c.json({ error: 'Missing required fields' }, 400);
    }
    if (targets.length > 10) {
      return c.json({ error: 'Max 10 transactions' }, 400);
    }
    if (
      targets.length !== values.length ||
      targets.length !== signatures.length ||
      targets.length !== calldatas.length
    ) {
      return c.json({ error: 'Array length mismatch' }, 400);
    }

    // Rate limiting
    const addr = proposer.toLowerCase();
    const lastProposal = proposalRateLimit.get(addr);
    if (lastProposal && Date.now() - lastProposal < 3600_000) {
      return c.json({ error: 'Rate limited — 1 proposal per hour' }, 429);
    }

    // Verify EIP-712 signature
    try {
      const valid = await verifyTypedData({
        address: proposer as Hex,
        domain: GRANT_PROPOSAL_DOMAIN,
        types: GRANT_PROPOSAL_TYPES,
        primaryType: 'Proposal',
        message: { targets, values, signatures, calldatas, description },
        signature: signature as Hex,
      });
      if (!valid) {
        return c.json({ error: 'Invalid signature' }, 401);
      }
    } catch {
      return c.json({ error: 'Signature verification failed' }, 401);
    }

    // Embed original signer in description so we can attribute correctly
    const taggedDescription = `<!-- signer:${proposer} -->\n${description}`;

    // Submit proposal on-chain via relayer wallet.
    // We MUST wait for the receipt before declaring success — RPC load balancers
    // (dRPC) can accept eth_sendRawTransaction and return a hash but fail to
    // propagate, leaving the tx unbroadcast. Without confirmation, the user
    // sees a fake success page with a dead etherscan link. We also set explicit
    // gas params because viem's auto-fee selection through dRPC has produced
    // underpriced txs that get dropped from the mempool.
    let txHash: Hex | undefined;
    try {
      const fees = await nounCheckClient.estimateFeesPerGas();
      // Floor priority fee at 1.5 gwei; if the network is busier, viem's
      // estimate already accounts for it.
      const minPriority = 1_500_000_000n;
      const maxPriorityFeePerGas =
        fees.maxPriorityFeePerGas && fees.maxPriorityFeePerGas > minPriority
          ? fees.maxPriorityFeePerGas
          : minPriority;
      // maxFee = base*2 + tip, with a sane floor.
      const baseGuess = fees.maxFeePerGas
        ? fees.maxFeePerGas - (fees.maxPriorityFeePerGas ?? 0n)
        : 5_000_000_000n;
      const maxFeePerGas = baseGuess * 2n + maxPriorityFeePerGas;

      txHash = await relayerWallet.writeContract({
        address: SMALL_GRANTS_ADDRESS,
        abi: smallGrantsTreasuryAbi,
        functionName: 'propose',
        args: [
          targets as Hex[],
          values.map((v: string) => BigInt(v)),
          signatures as string[],
          calldatas as Hex[],
          taggedDescription,
        ],
        maxPriorityFeePerGas,
        maxFeePerGas,
      });

      console.log(
        `[Relayer] Grant tx broadcast by ${proposer} — hash: ${txHash}, awaiting receipt...`,
      );

      // Block until mined (or timeout). If the tx never lands we return an
      // error so the frontend can show it and the user can retry.
      const receipt = await nounCheckClient.waitForTransactionReceipt({
        hash: txHash,
        timeout: 120_000,
        pollingInterval: 4_000,
      });

      if (receipt.status !== 'success') {
        console.error(`[Relayer] Grant tx reverted: ${txHash}`);
        return c.json(
          { error: 'Transaction reverted on-chain', txHash, details: 'Status: reverted' },
          500,
        );
      }

      // Only commit rate limit after confirmation so failed attempts don't lock
      // the user out for an hour.
      proposalRateLimit.set(addr, Date.now());

      console.log(`[Relayer] Grant proposal confirmed by ${proposer} — tx: ${txHash}`);
      return c.json({ txHash, relayer: relayerAccount.address });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Unknown error';
      console.error(`[Relayer] Grant proposal failed (txHash=${txHash ?? 'none'}):`, msg);
      return c.json(
        {
          error: 'Transaction failed',
          details: msg,
          ...(txHash ? { txHash } : {}),
        },
        500,
      );
    }
  });
}
