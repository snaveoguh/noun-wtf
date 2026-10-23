/** Compute derived grant status — grants have no quorum, simple majority wins */
export function computeDerivedGrantStatus(g: Record<string, unknown>, latestBlock: bigint): string {
  const status = g.status as string;
  if (['CANCELED', 'EXECUTED'].includes(status)) return status;

  if (status === 'QUEUED') {
    if (g.executionETA) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const gracePeriod = 14 * 86400;
      if (nowSeconds >= Number(g.executionETA) + gracePeriod) return 'EXPIRED';
    }
    return 'QUEUED';
  }

  // ACTIVE grants past endBlock: check votes
  if (status === 'ACTIVE') {
    const endBlock = BigInt(g.endBlock as string | number);
    if (latestBlock > endBlock) {
      const forVotes = Number(g.forVotes);
      const againstVotes = Number(g.againstVotes ?? 0);
      if (forVotes === 0 || forVotes <= againstVotes) return 'DEFEATED';
      return 'SUCCEEDED';
    }
  }

  return status;
}

// ─── Compute derived proposal status ─────────────────────────────────────
// Ponder only stores PENDING/ACTIVE/CANCELLED/VETOED/QUEUED/EXECUTED.
// We compute DEFEATED/EXPIRED/SUCCEEDED from vote counts + block data.
export function computeDerivedStatus(
  p: {
    status: string;
    forVotes: number;
    againstVotes: number;
    quorumVotes: bigint;
    endBlock: bigint;
    objectionPeriodEndBlock: bigint | null;
    executionETA: bigint | null;
    onTimelockV1: boolean;
    startBlock: bigint;
  },
  latestBlock: bigint,
): string {
  // Terminal statuses are authoritative
  if (['CANCELLED', 'VETOED', 'EXECUTED'].includes(p.status)) return p.status;

  // QUEUED proposals may be EXPIRED (past grace period)
  if (p.status === 'QUEUED') {
    if (p.executionETA) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      const gracePeriod = p.onTimelockV1 ? 14 * 86400 : 21 * 86400;
      if (nowSeconds >= Number(p.executionETA) + gracePeriod) return 'EXPIRED';
    }
    return 'QUEUED';
  }

  // ACTIVE/PENDING proposals past endBlock may be DEFEATED or SUCCEEDED
  if (p.status === 'ACTIVE' || p.status === 'PENDING') {
    const effectiveEnd =
      p.objectionPeriodEndBlock && p.objectionPeriodEndBlock > p.endBlock
        ? p.objectionPeriodEndBlock
        : p.endBlock;

    if (latestBlock > effectiveEnd) {
      const forVotes = BigInt(p.forVotes);
      if (forVotes <= BigInt(p.againstVotes) || forVotes < p.quorumVotes) {
        return 'DEFEATED';
      }
      return 'SUCCEEDED';
    }

    if (latestBlock <= p.startBlock) return 'PENDING';
    return 'ACTIVE';
  }

  return p.status;
}
