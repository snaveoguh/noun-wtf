import { useAccount } from 'wagmi';

import { useFulfillOrder } from '@/hooks/useSeaport';

interface NounsBuyButtonProps {
  orderHash: string;
  priceEth: string;
  /** Extra classes for the wrapper (e.g. full width below md on the detail page). */
  className?: string;
}

export function NounsBuyButton({ orderHash, priceEth, className }: NounsBuyButtonProps) {
  const { address } = useAccount();
  const { buy, status, error, reset } = useFulfillOrder(orderHash);

  if (!address) return null;

  if (status === 'success') {
    return (
      <span className="font-mono text-xs font-bold uppercase tracking-wider text-[var(--ink)]">
        Purchased
      </span>
    );
  }

  const isPending = status === 'switching' || status === 'confirming' || status === 'signing';

  return (
    <span className={`inline-flex flex-col ${className ?? ''}`}>
      <button
        type="button"
        onClick={buy}
        disabled={isPending}
        className="border border-[var(--ink)] bg-[var(--ink)] px-2 py-0.5 font-mono text-xs font-bold uppercase tracking-wider text-[var(--paper)] transition-colors hover:bg-[var(--paper)] hover:text-[var(--ink)] disabled:opacity-50 [@media(pointer:coarse)]:min-h-10"
      >
        {status === 'switching'
          ? 'Switch Chain...'
          : status === 'confirming'
            ? 'Loading Order...'
            : status === 'signing'
              ? 'Sign Tx...'
              : `Buy ${parseFloat(priceEth).toFixed(4)} ETH`}
      </button>
      {status === 'error' && error && (
        <button
          type="button"
          onClick={reset}
          className="mt-0.5 font-mono text-xs text-[var(--accent-red)] hover:underline"
        >
          {error.slice(0, 60)} — retry?
        </button>
      )}
    </span>
  );
}
