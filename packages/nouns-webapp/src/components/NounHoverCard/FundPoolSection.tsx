import { FC } from 'react';

import { Lock } from 'lucide-react';

interface FundPoolSectionProps {
  nounId: bigint;
}

/**
 * Locked fund pool placeholder.
 * Phase 2 will connect this to an onchain NounFundPool contract.
 * For now, displays static placeholder data.
 */
export const FundPoolSection: FC<FundPoolSectionProps> = ({ nounId: _nounId }) => {
  return (
    <div className="border-t-2 border-black bg-gray-50 px-3 py-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Lock className="size-3 text-gray-500" />
          <span className="font-mono text-[9px] font-bold uppercase tracking-[0.15em] text-gray-400">
            Fund Pool
          </span>
        </div>
        <span className="text-[10px] text-gray-400">Locked &mdash; no withdrawals</span>
      </div>
      <div className="mt-1 flex items-baseline justify-between">
        <span className="text-sm font-bold">0.00 ETH</span>
        <span className="text-[10px] text-gray-400">0 contributors</span>
      </div>
      <button
        className="mt-1.5 w-full rounded border border-gray-300 bg-white py-1 text-xs font-semibold text-gray-600 transition-colors hover:bg-gray-100"
        onClick={() => {
          // Phase 2: open contribute modal
          // Will use wagmi writeContract to interact with NounFundPool.sol
        }}
      >
        Contribute ETH
      </button>
    </div>
  );
};
