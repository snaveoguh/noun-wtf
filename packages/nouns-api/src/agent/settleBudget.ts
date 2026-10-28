// ─── Agent NounIRL — Settlement Gas Budget ──────────────────────────────────
//
// One wallet (nounirl.eth on mainnet) pays the gas for every settle, for both
// DAOs: paid reservations AND the owner's standing targets. Nothing is
// ring-fenced per reservation. This module answers "how many settles can the
// balance still pay for, and does that cover what's waiting?" so the chat can
// state the risk with real numbers, reservations can carry a warning, and the
// owner gets told when the wallet runs low. Pure: the watcher supplies the fee
// quote and the balance.

/** Gas a settle actually burns (observed ~250-350k; take the top). */
export const SETTLE_GAS_ESTIMATE = 350_000;

/** Gas a guarded settle burns when it misses its block and reverts. */
export const GUARD_MISS_GAS = 25_000;

export interface GasBudgetInput {
  balanceEth: number;
  /** What the RPC demands up front to accept a settle (gasLimit × maxFee). */
  preflightEth: number;
  /** What one settle is expected to cost at the current fees. */
  settleCostEth: number;
  /** Paid reservations still waiting (active or awaiting tip verification). */
  pendingReservations: number;
  /** Standing trait targets the owner set; they draw on the same wallet. */
  standingTargets: number;
}

export interface GasBudget {
  balanceEth: number;
  preflightEth: number;
  settleCostEth: number;
  /** Settles the wallet can broadcast, one after another, before a refill. */
  settlesCovered: number;
  /** False when the RPC would refuse a settle right now. */
  canSettleNow: boolean;
  pendingReservations: number;
  standingTargets: number;
  /** True when the balance can't settle every pending reservation once. */
  short: boolean;
  /** Short, or down to its last settle: worth telling the owner. */
  low: boolean;
  /** ETH that would let every pending reservation settle once. */
  topUpEth: number;
  summary: string;
}

const round = (eth: number) => Math.round(eth * 1e5) / 1e5;

/**
 * The k-th settle needs the balance left after k-1 settles to still clear the
 * preflight, so the count is 1 + how many full settles fit above it.
 */
export function settlesCovered(
  balanceEth: number,
  preflightEth: number,
  settleCostEth: number,
): number {
  if (!(balanceEth >= preflightEth) || preflightEth <= 0) return 0;
  if (settleCostEth <= 0) return Infinity;
  return Math.floor((balanceEth - preflightEth) / settleCostEth + 1e-9) + 1;
}

export function assessGasBudget(i: GasBudgetInput): GasBudget {
  const covered = settlesCovered(i.balanceEth, i.preflightEth, i.settleCostEth);
  const need = i.pendingReservations;
  const short = covered < need;
  const low = short || covered <= 1;
  // Balance to fire `need` settles: the last one still has to clear the preflight.
  const needEth = need > 0 ? i.preflightEth + (need - 1) * i.settleCostEth : 0;
  const topUpEth = short ? round(Math.max(0, needEth - i.balanceEth)) : 0;

  const covers = covered === Infinity ? 'any number of' : String(covered);
  const parts = [
    `Balance ${round(i.balanceEth)} ETH covers ${covers} settle${covered === 1 ? '' : 's'} ` +
      `(~${round(i.settleCostEth)} ETH each; the RPC won't accept one below ${round(i.preflightEth)} ETH).`,
    `${need} paid reservation${need === 1 ? '' : 's'} waiting` +
      (i.standingTargets > 0
        ? `, plus ${i.standingTargets} standing target${i.standingTargets === 1 ? '' : 's'} on the same wallet.`
        : '.'),
  ];
  if (covered === 0) parts.push('It cannot settle anything until it is topped up.');
  else if (short)
    parts.push(
      `Not enough to settle every pending reservation once; about ${topUpEth} ETH more would.`,
    );
  else if (low) parts.push('After the next settle it will need a top-up before it can fire again.');

  return {
    balanceEth: round(i.balanceEth),
    preflightEth: round(i.preflightEth),
    settleCostEth: round(i.settleCostEth),
    settlesCovered: covered,
    canSettleNow: covered > 0,
    pendingReservations: need,
    standingTargets: i.standingTargets,
    short,
    low,
    topUpEth,
    summary: parts.join(' '),
  };
}

// ─── Owner alert pacing ─────────────────────────────────────────────────────

/** While the wallet stays low, repeat the alert at most this often. */
export const LOW_ALERT_REPEAT_MS = 12 * 60 * 60 * 1000;

export interface AlertState {
  /** When the current low spell was last alerted (0 = not alerted / not low). */
  lastAlertAt: number;
}

/**
 * Alert when the wallet turns low, then at most every LOW_ALERT_REPEAT_MS while
 * it stays low; recovering resets it so the next dip alerts straight away.
 */
export function nextAlert(
  state: AlertState,
  low: boolean,
  now: number,
): { alert: boolean; state: AlertState } {
  if (!low) return { alert: false, state: { lastAlertAt: 0 } };
  if (state.lastAlertAt !== 0 && now - state.lastAlertAt < LOW_ALERT_REPEAT_MS) {
    return { alert: false, state };
  }
  return { alert: true, state: { lastAlertAt: now } };
}

// ─── What the agent says about it ───────────────────────────────────────────

/** Injected into the NounIRL prompt so it states the gas risk accurately. */
export const SETTLEMENT_GAS_KNOWLEDGE = `SETTLEMENT GAS — STATE THE RISK ACCURATELY:
- One wallet (nounirl.eth's settle key, on Ethereum mainnet) pays the gas for every settle on both DAOs: every paid reservation and the owner's standing trait targets draw on the same balance. Nothing is ring-fenced per reservation, and a tip is not escrowed for its own settle.
- Reservations are not a queue. Every block the watcher predicts the next noun for each DAO; whichever reservation (or standing target) matches a block after the auction has ended gets the settle. One settle can satisfy every reservation wanting that noun's traits; the rest stay active for later auctions.
- A settle burns ~250-350k gas (base fee plus a 5 gwei tip), and the RPC refuses to send one unless the balance covers 500k gas × the max fee up front: about 0.003 ETH or more even when gas is cheap. So the wallet stops firing well before it is empty. A guarded settle that misses its exact block reverts for ~25k gas and keeps hunting.
- When the balance can't cover a settle, matching blocks pass: the auction is settled by someone else (or later) and mints a different noun. The reservation stays active and is tried again after a top-up. Reservations don't expire and there is no automatic refund. Never promise a refund, ring-fencing or a top-up date.
- Tips sent on Ethereum mainnet land in nounirl.eth; tips on Base, Optimism, Arbitrum or Zora stay on that chain and pay no mainnet gas.
- Quote numbers only from get_agent_balance (gasBudget: settlesCovered, settleCostEth, preflightEth, pendingReservations, standingTargets, summary); never estimate the balance or gas from memory. Before inviting anyone to tip for a reservation, check it, and if gasBudget.short is true or settlesCovered is 0, tell them plainly before they pay. If create_reservation returns a gasWarning, pass it on. The owner is alerted automatically when the balance runs low.`;
