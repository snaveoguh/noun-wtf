import { useState } from 'react';

import { parseEther } from 'viem';
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi';

import {
  PREDICTION_MARKET_ADDRESS,
  PREDICTION_MARKET_ABI,
  PREDICTION_MARKET_CHAIN_ID,
} from '@/lib/marketplace/contracts';
import { calculatePotentialPayout, type ParsedMarketData } from '@/lib/marketplace/market-utils';
import { formatEth } from '@/lib/marketplace/market-utils';

interface StakePanelProps {
  dao: string;
  proposalId: string;
  market: ParsedMarketData;
}

const QUICK_AMOUNTS = ['0.001', '0.005', '0.01', '0.05'];

export function StakePanel({ dao, proposalId, market }: StakePanelProps) {
  const { isConnected } = useAccount();
  const [side, setSide] = useState<'for' | 'against'>('for');
  const [amount, setAmount] = useState('');

  const { writeContract, data: txHash, isPending, error } = useWriteContract();
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({
    hash: txHash,
    chainId: PREDICTION_MARKET_CHAIN_ID,
    query: { enabled: !!txHash },
  });

  const amountWei = amount ? parseEther(amount) : BigInt(0);
  const payout =
    amountWei > BigInt(0) ? calculatePotentialPayout(amountWei, side === 'for', market) : BigInt(0);
  const multiplier = amountWei > BigInt(0) ? Number(payout) / Number(amountWei) : 0;

  function handleStake() {
    if (!amount || !isConnected) return;
    writeContract({
      chainId: PREDICTION_MARKET_CHAIN_ID,
      address: PREDICTION_MARKET_ADDRESS,
      abi: PREDICTION_MARKET_ABI,
      functionName: 'stake',
      args: [dao, proposalId, side === 'for'],
      value: parseEther(amount),
    });
  }

  if (!isConnected) {
    return (
      <p className="font-body-serif text-center text-sm italic text-[var(--ink-faint)]">
        Connect wallet to stake.
      </p>
    );
  }

  if (isSuccess) {
    return (
      <div className="border border-[var(--rule-light)] p-3 text-center">
        <p className="font-mono text-[11px] font-bold text-[var(--ink)]">
          Stake placed successfully.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Side selector */}
      <div className="flex gap-2">
        <button
          onClick={() => setSide('for')}
          className={`flex-1 border py-1.5 font-mono text-[9px] uppercase tracking-wider transition-colors ${
            side === 'for'
              ? 'border-[var(--ink)] bg-[var(--ink)] text-[var(--paper)]'
              : 'border-[var(--rule-light)] text-[var(--ink-faint)] hover:border-[var(--rule)]'
          }`}
        >
          For (Pass)
        </button>
        <button
          onClick={() => setSide('against')}
          className={`flex-1 border py-1.5 font-mono text-[9px] uppercase tracking-wider transition-colors ${
            side === 'against'
              ? 'border-[var(--accent-red)] bg-[var(--accent-red)] text-[var(--paper)]'
              : 'border-[var(--rule-light)] text-[var(--ink-faint)] hover:border-[var(--rule)]'
          }`}
        >
          Against (Fail)
        </button>
      </div>

      {/* Amount input */}
      <div>
        <input
          type="text"
          value={amount}
          onChange={e => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
          placeholder="ETH amount"
          className="w-full border border-[var(--rule-light)] bg-[var(--paper)] px-3 py-2 font-mono text-sm text-[var(--ink)] placeholder-[var(--ink-faint)] focus:border-[var(--rule)] focus:outline-none"
        />
        <div className="mt-1 flex gap-1">
          {QUICK_AMOUNTS.map(qa => (
            <button
              key={qa}
              onClick={() => setAmount(qa)}
              className="border border-[var(--rule-light)] px-2 py-0.5 font-mono text-[8px] text-[var(--ink-faint)] transition-colors hover:border-[var(--rule)] hover:text-[var(--ink)]"
            >
              {qa}
            </button>
          ))}
        </div>
      </div>

      {/* Payout preview */}
      {amountWei > BigInt(0) && (
        <div className="border border-[var(--rule-light)] p-2 font-mono text-[9px]">
          <div className="flex justify-between">
            <span className="text-[var(--ink-faint)]">Potential payout:</span>
            <span className="font-bold text-[var(--ink)]">{formatEth(payout)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-[var(--ink-faint)]">Multiplier:</span>
            <span className="text-[var(--ink-light)]">{multiplier.toFixed(2)}x</span>
          </div>
        </div>
      )}

      {/* Submit */}
      <button
        onClick={handleStake}
        disabled={!amount || isPending || isConfirming}
        className="w-full border border-[var(--rule)] bg-[var(--ink)] py-2 font-mono text-[9px] uppercase tracking-wider text-[var(--paper)] transition-colors hover:bg-[var(--paper)] hover:text-[var(--ink)] disabled:opacity-50"
      >
        {isPending
          ? 'Signing...'
          : isConfirming
            ? 'Confirming...'
            : `Stake ${side === 'for' ? 'FOR' : 'AGAINST'}`}
      </button>

      {error && (
        <p className="font-mono text-[9px] text-[var(--accent-red)]">
          {(error as { shortMessage?: string }).shortMessage || error.message}
        </p>
      )}
    </div>
  );
}
