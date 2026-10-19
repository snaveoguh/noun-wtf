// ── Noun Trade: CASH OUT / DEPOSIT panel (the market's BASE tab) ──
//
// CASH OUT: pick goods / coin from the game balance → the server debits it and signs a
// voucher → the player's wallet submits NounTradeGoods.claim on Base.
// DEPOSIT: pick tokens held on-chain → the wallet burns them with deposit(…, riderTag)
// → the server reads the receipt and credits the game balance.
//
// Renders nothing unless VITE_TRADE_ONCHAIN=true and a contract address is configured.
// Mounted by TradeUi's market panel; onLedgerChange reloads the van's books. Starter
// coins and ICECREAM (it melts) can't be cashed out, so their maxima here are what the
// server will actually take.

import type { GoodId, TradeState } from '../contract';
import type { Address, Hash } from 'viem';

import { useCallback, useEffect, useState } from 'react';

import { useAccount } from 'wagmi';

import { CHAIN_LOCKED, RULES } from '../ledger';

import {
  fetchPending,
  readHoldings,
  reportDeposit,
  requestClaim,
  submitClaim,
  submitDeposit,
  tradeChain,
  tradeWallet,
  waitForTx,
} from './client';
import { TRADE_GOODS_ADDRESS, TRADE_ONCHAIN_ENABLED } from './flags';
import { ALL_GOODS, EXPLORER, TRADE_COIN, type SignedClaim } from './tokens';

export interface CashOutPanelProps {
  /** The game rider id (the ledger account). */
  rider: string;
  /** The rider's server balance, for the CASH OUT maxima. */
  balance?: TradeState | null;
  /** Called after the server ledger changed (cash-out debit, deposit credit, refund). */
  onLedgerChange?: () => void;
}

type Amounts = Partial<Record<GoodId | 'COIN', number>>;

const txLink = (hash: Hash) => {
  const base = EXPLORER[tradeChain().id];
  return base ? `${base}/tx/${hash}` : null;
};

function AmountRow({
  label,
  max,
  value,
  onChange,
}: {
  label: string;
  max: number;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs">
      <span className="w-20 font-bold tracking-wide">{label}</span>
      <span className="opacity-60">/{max}</span>
      <input
        type="number"
        min={0}
        max={max}
        value={value || ''}
        placeholder="0"
        disabled={max === 0}
        onChange={e =>
          onChange(Math.max(0, Math.min(max, Math.floor(Number(e.target.value) || 0))))
        }
        className="w-20 rounded border border-black/20 bg-white px-1 py-0.5 text-right disabled:opacity-40"
      />
    </label>
  );
}

const split = (a: Amounts) => {
  const goods: Partial<Record<GoodId, number>> = {};
  for (const g of ALL_GOODS) if ((a[g] ?? 0) > 0) goods[g] = a[g];
  return { goods, coin: a.COIN ?? 0 };
};

export function CashOutPanel({ rider, balance, onLedgerChange }: CashOutPanelProps) {
  const { address, connector, isConnected } = useAccount();
  const [tab, setTab] = useState<'out' | 'in'>('out');
  const [out, setOut] = useState<Amounts>({});
  const [inn, setInn] = useState<Amounts>({});
  const [held, setHeld] = useState<{ goods: Partial<Record<GoodId, number>>; coin: number } | null>(
    null,
  );
  const [pending, setPending] = useState<SignedClaim | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ text: string; link?: string | null; bad?: boolean } | null>(
    null,
  );

  const refreshHeld = useCallback(async () => {
    if (!address) return;
    try {
      setHeld(await readHoldings(address as Address));
    } catch {
      setHeld(null);
    }
  }, [address]);

  useEffect(() => {
    if (!TRADE_ONCHAIN_ENABLED || !rider) return;
    void fetchPending(rider)
      .then(p => {
        setPending(p.pending);
        if (p.refunded) {
          setMsg({ text: 'An expired cash-out was refunded to your van.' });
          onLedgerChange?.();
        }
      })
      .catch(() => undefined);
  }, [rider, onLedgerChange]);

  useEffect(() => {
    if (TRADE_ONCHAIN_ENABLED) void refreshHeld();
  }, [refreshHeld]);

  if (!TRADE_ONCHAIN_ENABLED || !TRADE_GOODS_ADDRESS) return null;

  const wallet = async () => {
    if (!connector || !address) throw new Error('Connect a wallet first');
    return tradeWallet(connector, address as Address);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({
        text: (e as { shortMessage?: string }).shortMessage ?? (e as Error).message,
        bad: true,
      });
    } finally {
      setBusy(false);
    }
  };

  const doSubmit = async (signed: SignedClaim) => {
    const w = await wallet();
    const hash = await submitClaim(w, signed);
    setMsg({ text: 'Claim sent, waiting for Base…', link: txLink(hash) });
    const r = await waitForTx(hash);
    if (r.status !== 'success') throw new Error('Claim transaction failed');
    setPending(null);
    setMsg({ text: 'Cashed out! The tokens are in your wallet.', link: txLink(hash) });
    void refreshHeld();
  };
  const submit = (signed: SignedClaim) => run(() => doSubmit(signed));

  const cashOut = () =>
    run(async () => {
      if (!address) throw new Error('Connect a wallet first');
      const { goods, coin } = split(out);
      const r = await requestClaim(rider, address as Address, goods, coin);
      if (!r.ok) {
        if (r.pending) setPending(r.pending);
        throw new Error(r.error);
      }
      setOut({});
      setPending(r.claim);
      onLedgerChange?.();
      await doSubmit(r.claim);
    });

  const deposit = () =>
    run(async () => {
      const { goods, coin } = split(inn);
      const w = await wallet();
      const hash = await submitDeposit(w, rider, goods, coin);
      setMsg({ text: 'Deposit sent, waiting for Base…', link: txLink(hash) });
      const rec = await waitForTx(hash);
      if (rec.status !== 'success') throw new Error('Deposit transaction failed');
      const r = await reportDeposit(rider, hash);
      if (!r.ok) throw new Error(r.error);
      setInn({});
      setMsg({ text: 'Deposited! Your van has the goods back.', link: txLink(hash) });
      onLedgerChange?.();
      void refreshHeld();
    });

  const outMax = (k: GoodId | 'COIN') =>
    k === 'COIN'
      ? Math.max(0, (balance?.coin ?? 0) - RULES.STARTER_COIN)
      : CHAIN_LOCKED.has(k)
        ? 0
        : (balance?.cargo[k] ?? 0);
  const inMax = (k: GoodId | 'COIN') => (k === 'COIN' ? (held?.coin ?? 0) : (held?.goods[k] ?? 0));
  const keys: (GoodId | 'COIN')[] = [...ALL_GOODS, 'COIN'];
  const label = (k: GoodId | 'COIN') => (k === 'COIN' ? TRADE_COIN.symbol : k);
  const amounts = tab === 'out' ? out : inn;
  const setAmounts = tab === 'out' ? setOut : setInn;
  const any = keys.some(k => (amounts[k] ?? 0) > 0);

  return (
    <div className="w-72 rounded-lg border-2 border-black bg-[#fff6e0] p-3 font-mono text-black shadow-lg">
      <div className="mb-2 flex gap-1">
        {(['out', 'in'] as const).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={`flex-1 rounded px-2 py-1 text-xs font-bold ${tab === t ? 'bg-black text-white' : 'bg-black/10'}`}
          >
            {t === 'out' ? 'CASH OUT' : 'DEPOSIT'}
          </button>
        ))}
      </div>
      <p className="mb-2 text-[10px] opacity-70">
        {tab === 'out'
          ? `Van stock → tokens on ${tradeChain().name}. Leaves your game balance now. Starter coins and ice cream (it melts) stay in the game.`
          : `Tokens on ${tradeChain().name} → back into your van (burned on-chain).`}
      </p>
      {held !== null && (
        <p data-trade="onchain-held" className="mb-2 text-[10px]">
          In your wallet:{' '}
          {[
            ...ALL_GOODS.filter(g => (held.goods[g] ?? 0) > 0).map(g => `${held.goods[g]} ${g}`),
            ...(held.coin > 0 ? [`${held.coin} ${TRADE_COIN.symbol}`] : []),
          ].join(' · ') || 'nothing yet'}
        </p>
      )}
      {!isConnected ? (
        <p className="text-xs font-bold">Connect a wallet to use this.</p>
      ) : (
        <>
          {pending && tab === 'out' && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void submit(pending)}
              className="mb-2 w-full rounded bg-yellow-300 px-2 py-1 text-xs font-bold disabled:opacity-50"
            >
              FINISH PENDING CASH-OUT
            </button>
          )}
          <div className="flex flex-col gap-1">
            {keys.map(k => (
              <AmountRow
                key={k}
                label={label(k)}
                max={tab === 'out' ? outMax(k) : inMax(k)}
                value={amounts[k] ?? 0}
                onChange={n => setAmounts(a => ({ ...a, [k]: n }))}
              />
            ))}
          </div>
          <button
            type="button"
            disabled={busy || !any || (tab === 'out' && !!pending)}
            onClick={() => void (tab === 'out' ? cashOut() : deposit())}
            className="mt-3 w-full rounded bg-black px-2 py-1.5 text-sm font-bold text-white disabled:opacity-40"
          >
            {busy ? '…' : tab === 'out' ? 'CASH OUT' : 'DEPOSIT'}
          </button>
        </>
      )}
      {msg && (
        <p className={`mt-2 text-[11px] ${msg.bad === true ? 'text-red-700' : ''}`}>
          {msg.text}{' '}
          {msg.link && (
            <a href={msg.link} target="_blank" rel="noreferrer" className="underline">
              tx
            </a>
          )}
        </p>
      )}
    </div>
  );
}

export default CashOutPanel;
