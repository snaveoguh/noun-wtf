import { useState } from 'react';

import { useAccount } from 'wagmi';

import { useCreateListing } from '@/hooks/useSeaport';
import { NOUNS_CONTRACT } from '@/lib/marketplace/nouns-marketplace';

interface NounsListButtonProps {
  nounId: number;
}

export function NounsListButton({ nounId }: NounsListButtonProps) {
  const { address } = useAccount();
  const { list, status, error, reset } = useCreateListing(NOUNS_CONTRACT, String(nounId));
  const [showInput, setShowInput] = useState(false);
  const [priceInput, setPriceInput] = useState('');

  if (!address) return null;

  if (status === 'success') {
    return (
      <span className="font-mono text-[9px] font-bold uppercase tracking-wider text-[var(--ink)]">
        Listed for {priceInput} ETH
      </span>
    );
  }

  if (!showInput && status === 'idle') {
    return (
      <button
        onClick={() => setShowInput(true)}
        className="font-mono text-[9px] uppercase tracking-wider text-[var(--ink-faint)] transition-colors hover:text-[var(--ink)]"
      >
        List for Sale
      </button>
    );
  }

  const isPending =
    status === 'switching' ||
    status === 'approving' ||
    status === 'signing' ||
    status === 'submitting';

  if (isPending) {
    return (
      <span className="font-mono text-[9px] uppercase tracking-wider text-[var(--ink-faint)]">
        {status === 'switching'
          ? 'Switching Chain...'
          : status === 'approving'
            ? 'Approving Nouns Token...'
            : status === 'signing'
              ? 'Signing Order...'
              : 'Storing Order...'}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-col">
      <span className="inline-flex items-center gap-1">
        <input
          type="number"
          step="0.01"
          min="0"
          placeholder="ETH"
          value={priceInput}
          onChange={e => setPriceInput(e.target.value)}
          className="w-24 border border-[var(--rule)] bg-[var(--paper)] px-1 py-0.5 font-mono text-[9px] text-[var(--ink)] outline-none focus:border-[var(--ink)]"
        />
        <button
          onClick={() => list(priceInput)}
          disabled={!priceInput || parseFloat(priceInput) <= 0}
          className="border border-[var(--ink)] bg-[var(--ink)] px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-[var(--paper)] transition-colors hover:bg-[var(--paper)] hover:text-[var(--ink)] disabled:opacity-50"
        >
          List
        </button>
        <button
          onClick={() => {
            setShowInput(false);
            reset();
          }}
          className="font-mono text-[8px] text-[var(--ink-faint)] hover:text-[var(--ink)]"
        >
          &times;
        </button>
      </span>
      {status === 'error' && error && (
        <button
          onClick={reset}
          className="mt-0.5 font-mono text-[7px] text-[var(--accent-red)] hover:underline"
        >
          {error.slice(0, 60)} — retry?
        </button>
      )}
    </span>
  );
}
