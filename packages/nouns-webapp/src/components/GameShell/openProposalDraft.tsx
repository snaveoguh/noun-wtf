import type { Hex } from '@/utils/types';
import type { ProposalTransaction } from '@/wrappers/nounsDao';

import { miniWindowStore } from '@/components/MiniWindow';

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

/**
 * Size the window to the viewport. MiniWindow isn't resizable, so a fixed
 * 880px meant a long pasted proposal sat in a narrow column with the rest of
 * a wide screen unused. Cap so it never overflows small windows.
 */
function draftWindowSize(): { width: number; height: number } {
  if (typeof window === 'undefined') return { width: 1280, height: 840 };
  // No lower bound: a floor wider than the viewport pushes the (fixed-position)
  // window off the right edge on phones. 32px leaves a 16px gutter each side
  // once MiniWindow centres it.
  return {
    width: Math.min(1320, window.innerWidth - 32),
    height: Math.min(860, window.innerHeight - 32),
  };
}

function coerceTransactions(
  txs: ProposalDraftPrefill['transactions'],
): ProposalTransaction[] | undefined {
  if (txs === undefined || txs.length === 0) return undefined;
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
  const { width, height } = draftWindowSize();
  return miniWindowStore.open({
    id: payload.draftId ?? WINDOW_ID,
    title: payload.title?.trim() ? `Draft — ${payload.title}` : 'Draft Proposal',
    width,
    height,
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
