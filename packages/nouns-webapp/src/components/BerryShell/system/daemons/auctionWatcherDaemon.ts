/**
 * Auction watcher daemon — re-emits Nouns auction events onto the BerryOS bus.
 *
 * Subscribes to the existing Redux store (which the global ChainSubscriber +
 * Ponder hooks already keep in sync with on-chain state) and watches:
 *   - active auction nounId / bidder / amount → emits `auction:newBid` on
 *     each new high bid
 *   - active auction settled flag flipping true → emits `auction:settled`
 *
 * Subscribing to Redux instead of trying to set up our own contract watchers
 * means zero duplication: we piggyback on the same single source of truth
 * the rest of the webapp uses, and we don't need RPC budget for our own
 * subscriptions — and crucially, no network capability of our own.
 */

import { store } from '@/store';

import { extendedBus } from '../extendedBus';
import type { BerryService } from '../services';

const APP_ID = 'auction-watcher';

interface SnapshotShape {
  nounId: string | undefined;
  bidder: string | undefined;
  amount: string | undefined;
  settled: boolean;
}

let unsubscribe: (() => void) | undefined;
let lastSnapshot: SnapshotShape | undefined;

function readSnapshot(): SnapshotShape | undefined {
  const a = store.getState().auction.activeAuction;
  if (!a) return undefined;
  return {
    nounId: a.nounId?.toString(),
    bidder: a.bidder ?? undefined,
    amount: a.amount?.toString(),
    settled: Boolean(a.settled),
  };
}

function diffAndEmit(prev: SnapshotShape | undefined, next: SnapshotShape): void {
  if (!next.nounId) return;

  // New auction or new high bid → bid event. We treat amount changes as bids,
  // not bidder-only changes (a bidder change without an amount change is a
  // data inconsistency we don't want to spam events about).
  const isNewBid =
    prev === undefined ||
    prev.nounId !== next.nounId ||
    (next.amount !== undefined && next.amount !== prev.amount && Boolean(next.bidder));

  if (isNewBid && next.amount && next.bidder) {
    extendedBus.emit('auction:newBid', {
      nounId: next.nounId,
      amountWei: next.amount,
      bidder: next.bidder,
    });
  }

  // Settlement edge: false → true, same nounId.
  const justSettled =
    prev?.nounId === next.nounId && next.settled === true && prev?.settled === false;
  if (justSettled) {
    extendedBus.emit('auction:settled', {
      nounId: next.nounId,
      // Empty string winner means burned (no bidder met reserve).
      winner: next.bidder ?? '',
    });
  }
}

export const auctionWatcherDaemon: BerryService = {
  id: APP_ID,
  name: 'Auction watcher',
  autoStart: true,
  description:
    'Watches the active Nouns auction and emits auction:newBid / auction:settled events.',

  async start() {
    if (unsubscribe) return;
    // Prime the snapshot but don't emit on initial load — apps that want
    // current state can read serviceManager.get('auction-watcher') or pull
    // from Redux themselves. We only emit on transitions.
    lastSnapshot = readSnapshot();

    unsubscribe = store.subscribe(() => {
      const next = readSnapshot();
      if (!next) return;
      // Cheap structural compare — all fields are primitives.
      if (
        lastSnapshot &&
        next.nounId === lastSnapshot.nounId &&
        next.amount === lastSnapshot.amount &&
        next.bidder === lastSnapshot.bidder &&
        next.settled === lastSnapshot.settled
      ) {
        return;
      }
      diffAndEmit(lastSnapshot, next);
      lastSnapshot = next;
    });
  },

  async stop() {
    unsubscribe?.();
    unsubscribe = undefined;
    lastSnapshot = undefined;
  },

  status() {
    return unsubscribe ? 'running' : 'stopped';
  },
};
