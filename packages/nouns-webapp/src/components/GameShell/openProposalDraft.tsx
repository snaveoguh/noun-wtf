import type { Hex } from '@/utils/types';

import { miniWindowStore } from '@/components/MiniWindow';
import type { ProposalTransaction } from '@/wrappers/nounsDao';

import ProposalDraftPanel from './ProposalDraftPanel';

/**
 * Wire-format prefill payload exchanged with NounIRL (or any external agent).
 * `value` is serialized as a decimal string to survive JSON; we coerce to
 * bigint internally before handing it to the panel.
 */
export interface ProposalDraftPrefill {
  title?: string;
  body?: string;
  transactions?: Array<{
    address: string;
    value?: string;
    signature: string;
    calldata: string;
    usdcValue?: number;
  }>;
  /**
   * Optional dedupe key. When two `open` calls share an id the second one
   * focuses + replaces content of the first instead of stacking.
   */
  draftId?: string;
}

const WINDOW_ID = 'proposal-draft';

function coerceTransactions(
  txs: ProposalDraftPrefill['transactions'],
): ProposalTransaction[] | undefined {
  if (!txs?.length) return undefined;
  return txs.map(tx => ({
    address: (tx.address.startsWith('0x') ? tx.address : `0x${tx.address}`) as `0x${string}`,
    value: tx.value ? BigInt(tx.value) : 0n,
    signature: tx.signature,
    calldata: (tx.calldata.startsWith('0x') ? tx.calldata : `0x${tx.calldata}`) as Hex,
    usdcValue: tx.usdcValue,
  }));
}

/**
 * Open (or focus) the proposal-draft mini-window with the supplied prefill.
 * Designed as the single entry point for NounIRL: the agent posts a message
 * with a prefill payload, the terminal CTA calls this, and the user lands
 * inside a draft they can review and sign.
 */
export function openProposalDraft(payload: ProposalDraftPrefill = {}): string {
  return miniWindowStore.open({
    id: payload.draftId ?? WINDOW_ID,
    title: payload.title?.trim() ? `Draft — ${payload.title}` : 'Draft Proposal',
    width: 880,
    height: 720,
    content: (
      <ProposalDraftPanel
        initialTitle={payload.title ?? ''}
        initialBody={payload.body ?? ''}
        initialTransactions={coerceTransactions(payload.transactions)}
        onProposeSuccess={() => miniWindowStore.close(payload.draftId ?? WINDOW_ID)}
      />
    ),
  });
}

export function closeProposalDraft(draftId: string = WINDOW_ID) {
  miniWindowStore.close(draftId);
}
