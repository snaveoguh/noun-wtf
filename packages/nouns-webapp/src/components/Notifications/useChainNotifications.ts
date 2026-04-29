import React, { useCallback, useRef } from 'react';

import { formatEther } from 'viem';
import { mainnet } from 'wagmi/chains';
import { toast } from 'sonner';

import {
  useWatchNounsAuctionHouseAuctionBidEvent,
  useWatchNounsAuctionHouseAuctionSettledEvent,
  useWatchNounsGovernorProposalCreatedEvent,
  useWatchNounsGovernorVoteCastEvent,
} from '@/contracts';
import { CHAIN_ID } from '@/config';
import { Address } from '@/utils/types';

import { AddressToast, NounToast } from './ChainToast';

/**
 * Watch the live mainnet contracts for noteworthy actions and pop a sonner
 * toast for each. The hook is render-only — it returns nothing and is meant to
 * be mounted exactly once in the app shell (see `ChainNotificationsMount`).
 *
 * Mainnet-only by design: the wagmi config in `wagmi.ts` only registers the
 * `activeChain`, so on a sepolia build these watchers would point at testnet.
 * We early-out instead of toasting bogus testnet activity.
 *
 * Dedupe + throttle:
 *  - Each log carries a `(transactionHash, logIndex)` pair that uniquely
 *    identifies it across reorg-driven re-emissions. We keep a Set of seen
 *    keys and skip any log we've already toasted.
 *  - When a flurry of bids lands in a single block, sonner would otherwise
 *    stack 5+ identical toasts. We rate-limit to one toast per
 *    `THROTTLE_WINDOW_MS` per event-class, dropping the rest.
 *
 * This file is intentionally a `.ts` (not `.tsx`) — toast bodies are built
 * with `React.createElement` so the hook can sit alongside utils. The actual
 * presentational components live in `ChainToast.tsx`.
 */

const THROTTLE_WINDOW_MS = 1500;
const TOAST_DURATION_MS = 6000;
const SEEN_CACHE_LIMIT = 500;

type ToastClass = 'bid' | 'settled' | 'vote' | 'proposal';

const h = React.createElement;

const formatBidEth = (wei: bigint): string => {
  // Trim to 4 decimals for the toast — the auction page itself shows the
  // canonical value, this is a quick glance.
  const eth = Number(formatEther(wei));
  if (eth >= 100) return eth.toFixed(2);
  if (eth >= 1) return eth.toFixed(3);
  return eth.toFixed(4);
};

const SUPPORT_LABEL = ['AGAINST', 'FOR', 'ABSTAIN'] as const;

const extractProposalTitle = (description: string): string => {
  // Nouns proposals conventionally start with `# Title\n…`. Strip the heading
  // marker and clamp to a reasonable toast length.
  const firstLine = description.split('\n').find(line => line.trim().length > 0) ?? '';
  const title = firstLine.replace(/^#+\s*/, '').trim();
  return title.length > 60 ? `${title.slice(0, 57)}…` : title || 'Untitled proposal';
};

export const useChainNotifications = () => {
  const enabled = Number(CHAIN_ID) === mainnet.id;

  const seenRef = useRef<Set<string>>(new Set());
  const lastToastAtRef = useRef<Record<ToastClass, number>>({
    bid: 0,
    settled: 0,
    vote: 0,
    proposal: 0,
  });

  const shouldShow = useCallback(
    (cls: ToastClass, txHash: string | undefined, logIndex: number | undefined) => {
      // Dedupe by log identity. logIndex can be null when wagmi emits an
      // optimistic log; fall back to txHash alone in that case.
      const key = `${cls}:${txHash ?? 'pending'}:${logIndex ?? 'null'}`;
      if (seenRef.current.has(key)) return false;
      seenRef.current.add(key);
      // Crude bounded LRU — once we cross the limit, dump the oldest entries.
      if (seenRef.current.size > SEEN_CACHE_LIMIT) {
        const trimmed = Array.from(seenRef.current).slice(-SEEN_CACHE_LIMIT / 2);
        seenRef.current = new Set(trimmed);
      }

      // Per-class throttle so a single block of bids doesn't carpet-bomb.
      const now = Date.now();
      if (now - lastToastAtRef.current[cls] < THROTTLE_WINDOW_MS) return false;
      lastToastAtRef.current[cls] = now;

      return true;
    },
    [],
  );

  useWatchNounsAuctionHouseAuctionBidEvent({
    enabled,
    onLogs: logs => {
      for (const log of logs) {
        const { nounId, sender, value } = log.args;
        if (nounId === undefined || sender === undefined || value === undefined) continue;
        if (!shouldShow('bid', log.transactionHash, log.logIndex ?? undefined)) continue;
        const eth = formatBidEth(value);
        toast(
          h(AddressToast, {
            address: sender as Address,
            text: (name: string) =>
              h('span', null, h('strong', null, name), ` bid ${eth} Ξ on Noun #${nounId.toString()}`),
          }),
          { duration: TOAST_DURATION_MS },
        );
      }
    },
  });

  useWatchNounsAuctionHouseAuctionSettledEvent({
    enabled,
    onLogs: logs => {
      for (const log of logs) {
        const { nounId, winner, amount } = log.args;
        if (nounId === undefined || winner === undefined) continue;
        if (!shouldShow('settled', log.transactionHash, log.logIndex ?? undefined)) continue;
        const eth = amount !== undefined ? formatBidEth(amount) : '?';
        toast(
          h(NounToast, {
            nounId,
            text: h(
              'span',
              null,
              `Noun #${nounId.toString()} settled `,
              h('span', { className: 'opacity-70' }, `for ${eth} Ξ`),
            ),
          }),
          { duration: TOAST_DURATION_MS },
        );
      }
    },
  });

  useWatchNounsGovernorVoteCastEvent({
    enabled,
    onLogs: logs => {
      for (const log of logs) {
        const { voter, proposalId, support, votes } = log.args;
        if (voter === undefined || proposalId === undefined || support === undefined) continue;
        if (!shouldShow('vote', log.transactionHash, log.logIndex ?? undefined)) continue;
        const label = SUPPORT_LABEL[Number(support)] ?? 'VOTED';
        const weight = votes !== undefined ? `(${votes.toString()})` : '';
        toast(
          h(AddressToast, {
            address: voter as Address,
            text: (name: string) =>
              h(
                'span',
                null,
                h('strong', null, name),
                ` voted ${label} on Prop #${proposalId.toString()} ${weight}`,
              ),
          }),
          { duration: TOAST_DURATION_MS },
        );
      }
    },
  });

  useWatchNounsGovernorProposalCreatedEvent({
    enabled,
    onLogs: logs => {
      for (const log of logs) {
        const { id, proposer, description } = log.args;
        if (id === undefined || proposer === undefined) continue;
        if (!shouldShow('proposal', log.transactionHash, log.logIndex ?? undefined)) continue;
        const title = extractProposalTitle(description ?? '');
        toast(
          h(AddressToast, {
            address: proposer as Address,
            text: (name: string) =>
              h(
                'span',
                null,
                h('strong', null, `Prop #${id.toString()}: `),
                title,
                h('span', { className: 'opacity-70' }, ` — by ${name}`),
              ),
          }),
          { duration: TOAST_DURATION_MS + 2000 },
        );
      }
    },
  });
};

/**
 * Mount component that runs `useChainNotifications` once. Render-only — keeps
 * the watcher hook out of `App.tsx` so the component tree stays declarative.
 */
export const ChainNotificationsMount: React.FC = () => {
  useChainNotifications();
  return null;
};
