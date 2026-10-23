import type { Hono } from 'hono';

import { graphql } from 'ponder';
import { db } from 'ponder:api';
import schema from 'ponder:schema';

import { getLatestBlockCached } from '../lib/latestBlock.js';
import { computeDerivedGrantStatus, computeDerivedStatus } from '../lib/proposalStatus.js';

/** Recursively walk a JSON value and patch any proposal-like objects with computed status */
function patchProposalStatuses(data: unknown, latestBlock: bigint): void {
  if (!data || typeof data !== 'object') return;
  if (Array.isArray(data)) {
    for (const item of data) patchProposalStatuses(item, latestBlock);
    return;
  }
  const obj = data as Record<string, unknown>;
  // A proposal-like object has status + endBlock + forVotes
  if (typeof obj.status === 'string' && obj.endBlock !== undefined && obj.forVotes !== undefined) {
    obj.status = computeDerivedStatus(
      {
        status: obj.status as string,
        forVotes: Number(obj.forVotes),
        againstVotes: Number(obj.againstVotes ?? 0),
        quorumVotes: BigInt(obj.quorumVotes ?? 0),
        endBlock: BigInt(obj.endBlock ?? 0),
        objectionPeriodEndBlock: obj.objectionPeriodEndBlock
          ? BigInt(obj.objectionPeriodEndBlock as string)
          : null,
        executionETA: obj.executionETA ? BigInt(obj.executionETA as string) : null,
        onTimelockV1: obj.onTimelockV1 === true,
        startBlock: BigInt(obj.startBlock ?? 0),
      },
      latestBlock,
    );
  }
  // A grant-like object has status + endBlock + forVotes but NO quorumVotes
  if (
    typeof obj.status === 'string' &&
    obj.endBlock !== undefined &&
    obj.forVotes !== undefined &&
    obj.quorumVotes === undefined &&
    obj.snapshotBlock !== undefined
  ) {
    obj.status = computeDerivedGrantStatus(obj, latestBlock);
  }

  // Recurse into nested objects (items, proposals, node, edges, etc.)
  for (const val of Object.values(obj)) {
    if (val && typeof val === 'object') patchProposalStatuses(val, latestBlock);
  }
}

/**
 * Middleware that:
 * 1. Buffers Yoga's response fully to avoid Railway/Fastly chunked-transfer truncation
 * 2. Computes derived proposal statuses
 * 3. Re-emits with explicit Content-Length (no chunked encoding)
 */
async function graphqlWithDerivedStatus(
  c: { res: Response; [key: string]: unknown },
  next: () => Promise<void>,
) {
  await next();
  const ct = c.res.headers.get('content-type') || '';
  if (!ct.includes('json')) return;

  // Read full body as text first — works even if JSON is malformed
  let text: string;
  try {
    text = await c.res.text();
  } catch {
    return; // stream error — pass through
  }

  // Try to parse, patch statuses, re-stringify
  try {
    const body = JSON.parse(text);
    if (body?.data) {
      const latestBlock = await getLatestBlockCached();
      if (latestBlock > 0n) patchProposalStatuses(body.data, latestBlock);
    }
    text = JSON.stringify(body);
  } catch {
    // Malformed JSON — still re-emit the raw text with proper headers
  }

  // Re-emit with explicit Content-Length and no chunked transfer-encoding
  const headers = new Headers(c.res.headers);
  headers.delete('transfer-encoding');
  headers.set('content-length', String(new TextEncoder().encode(text).byteLength));
  if (!headers.has('content-type')) {
    headers.set('content-type', 'application/json; charset=utf-8');
  }
  c.res = new Response(text, { status: 200, headers });
}

export function registerGraphqlRoutes(app: Hono) {
  app.use('/', graphqlWithDerivedStatus, graphql({ db, schema }));
  app.use('/graphql', graphqlWithDerivedStatus, graphql({ db, schema }));
}
