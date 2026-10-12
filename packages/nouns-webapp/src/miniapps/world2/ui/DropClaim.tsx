// ── Drop party claim card ────────────────────────────────────────────────
//
// Opens when you ride or walk into a drop (drops/Drops.ts): connect a
// wallet, show the server the ride that got you here for a voucher, then
// send NounWorldDrops.claim with it. The voucher only works for your
// address, and the first rider with a valid one holds the drop for a few
// minutes; anyone else is told it's taken.

import type { Drops, TouchedDrop } from '../drops/Drops';

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { ConnectKitButton } from 'connectkit';
import { useAccount, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi';

import { buildEtherscanTxLink } from '@/utils/etherscan';
import { defaultChain } from '@/wagmi';

import {
  DROPS_ABI,
  DROPS_ADDRESS,
  gatewayUrl,
  reportClaimed,
  requestVoucher,
  type Voucher,
} from '../drops/contract';

type Phase =
  | { k: 'intro' }
  | { k: 'proving' }
  | { k: 'signing'; voucher: Voucher }
  | { k: 'pending'; hash: `0x${string}` }
  | { k: 'success'; hash: `0x${string}` }
  | { k: 'taken' }
  | { k: 'expired' }
  | { k: 'error'; msg: string; retry: boolean };

const KIND_ICON: Record<string, string> = { eth: '◆', erc20: '●', erc721: '▣', erc1155: '▣' };

function useTouched(drops: Drops): TouchedDrop | null {
  return useSyncExternalStore(
    fn => drops.subscribe(fn),
    () => drops.touched,
  );
}

/** Contract revert → what to tell the rider. */
function explain(err: unknown): Phase {
  const e = err as { shortMessage?: string; message?: string; name?: string };
  const msg = `${e.shortMessage ?? ''} ${e.message ?? ''}`;
  if (/NotOpen/.test(msg)) return { k: 'taken' };
  if (/DropExpired|VoucherExpired/.test(msg)) return { k: 'expired' };
  if (/rejected|denied/i.test(msg))
    return { k: 'error', msg: 'You cancelled the transaction.', retry: true };
  return {
    k: 'error',
    msg: (e.shortMessage ?? e.message ?? String(err)).split('\n')[0].slice(0, 160),
    retry: true,
  };
}

export function DropClaim({ drops }: { drops: Drops }) {
  const touched = useTouched(drops);
  if (touched === null) return null;
  // Fresh card state per drop touched
  return <ClaimCard key={`${touched.drop.dropId}:${touched.at}`} drops={drops} touched={touched} />;
}

function ClaimCard({ drops, touched }: { drops: Drops; touched: TouchedDrop }) {
  const { drop } = touched;
  const [phase, setPhase] = useState<Phase>({ k: 'intro' });
  const { address, chainId, isConnected } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const pendingHash = phase.k === 'pending' ? phase.hash : undefined;
  const receipt = useWaitForTransactionReceipt({
    hash: pendingHash,
    chainId: defaultChain.id,
    query: { enabled: pendingHash !== undefined },
  });
  const busy = phase.k === 'proving' || phase.k === 'signing' || phase.k === 'pending';

  // Free the mouse so the card can be clicked
  useEffect(() => {
    if (document.pointerLockElement) document.exitPointerLock();
  }, []);

  const close = useCallback(() => {
    if (!busy) drops.dismiss();
  }, [busy, drops]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);

  useEffect(() => {
    if (pendingHash === undefined) return;
    if (receipt.isSuccess) {
      if (receipt.data.status === 'success') {
        setPhase({ k: 'success', hash: pendingHash });
        drops.markClaimed(drop.dropId);
        reportClaimed(drop.dropId);
      } else setPhase({ k: 'error', msg: 'The transaction reverted.', retry: false });
    } else if (receipt.isError) setPhase(explain(receipt.error));
  }, [receipt.isSuccess, receipt.isError, receipt.data, receipt.error, pendingHash, drop, drops]);

  const send = async (v: Voucher) => {
    setPhase({ k: 'signing', voucher: v });
    try {
      if (chainId !== defaultChain.id) await switchChainAsync({ chainId: defaultChain.id });
      const hash = await writeContractAsync({
        address: DROPS_ADDRESS!,
        abi: DROPS_ABI,
        chainId: defaultChain.id,
        functionName: 'claim',
        args: [BigInt(v.dropId), BigInt(v.deadline), v.signature],
      });
      setPhase({ k: 'pending', hash });
    } catch (err) {
      setPhase(explain(err));
    }
  };

  const claim = async () => {
    if (address === undefined || DROPS_ADDRESS === null) return;
    setPhase({ k: 'proving' });
    const r = await requestVoucher(drop.dropId, address, touched.proof);
    if (!r.ok) {
      if (r.error === 'taken') setPhase({ k: 'taken' });
      else if (r.error === 'expired') setPhase({ k: 'expired' });
      else if (r.error === 'proof')
        setPhase({
          k: 'error',
          msg: `The server didn't accept your ride (${r.reason || 'bad proof'}). Ride in again from further back.`,
          retry: false,
        });
      else setPhase({ k: 'error', msg: r.reason || 'Something went wrong.', retry: true });
      return;
    }
    if (
      r.contract.toLowerCase() !== DROPS_ADDRESS.toLowerCase() ||
      r.chainId !== defaultChain.id ||
      r.voucher.claimer.toLowerCase() !== address.toLowerCase()
    ) {
      setPhase({ k: 'error', msg: 'Voucher is for another contract or wallet.', retry: false });
      return;
    }
    await send(r.voucher);
  };

  const left = Math.max(0, drop.expiresAt - Date.now());
  const leftLabel =
    left > 86_400_000
      ? `${Math.round(left / 86_400_000)} d`
      : left > 3_600_000
        ? `${Math.round(left / 3_600_000)} h`
        : `${Math.max(1, Math.round(left / 60_000))} min`;

  return (
    <div
      className="w2-drop pointer-events-auto absolute left-1/2 top-1/2 z-40 -translate-x-1/2 -translate-y-1/2"
      onPointerDown={e => e.stopPropagation()}
      role="dialog"
      aria-label="Claim drop"
    >
      <button
        type="button"
        className="w2-drop-x"
        onClick={close}
        disabled={busy}
        aria-label="Close"
      >
        ✕
      </button>
      <div className="w2-drop-head">
        <span>DROP PARTY</span>
        <b>YOU FOUND</b>
      </div>
      <div className="w2-drop-item">
        {drop.asset.image !== undefined ? (
          <img src={gatewayUrl(drop.asset.image)} alt="" />
        ) : (
          <i data-kind={drop.asset.kind}>{KIND_ICON[drop.asset.kind] ?? '◆'}</i>
        )}
        <div>
          <b>{drop.asset.label}</b>
          <small>
            drop #{drop.dropId} · {leftLabel} left
          </small>
        </div>
      </div>

      {phase.k === 'intro' && drop.taken && (
        <p className="w2-drop-note">
          Someone is mid-claim on this one. It frees up if they don&apos;t finish.
        </p>
      )}
      {phase.k === 'intro' && !isConnected && (
        <div className="w2-drop-body">
          <p>Connect a wallet to pick it up. First rider to claim it keeps it.</p>
          <ConnectKitButton.Custom>
            {({ show, isConnecting }) => (
              <button
                type="button"
                className="w2-drop-go"
                disabled={isConnecting}
                onClick={() => show?.()}
              >
                CONNECT WALLET
              </button>
            )}
          </ConnectKitButton.Custom>
        </div>
      )}
      {phase.k === 'intro' && isConnected && (
        <div className="w2-drop-body">
          <p>
            Send it to{' '}
            <code>
              {address?.slice(0, 6)}…{address?.slice(-4)}
            </code>
            . You pay the gas.
          </p>
          <button type="button" className="w2-drop-go" onClick={() => void claim()}>
            CLAIM IT
          </button>
        </div>
      )}
      {phase.k === 'proving' && <Status spin text="Checking your ride…" />}
      {phase.k === 'signing' && <Status spin text="Confirm the claim in your wallet…" />}
      {phase.k === 'pending' && (
        <Status spin text="Picking it up on-chain…" link={buildEtherscanTxLink(phase.hash)} />
      )}
      {phase.k === 'success' && (
        <div className="w2-drop-body">
          <p className="w2-drop-win">IT&apos;S YOURS!</p>
          <a href={buildEtherscanTxLink(phase.hash)} target="_blank" rel="noreferrer">
            view transaction ↗
          </a>
          <button type="button" className="w2-drop-go" onClick={close}>
            KEEP RIDING
          </button>
        </div>
      )}
      {phase.k === 'taken' && (
        <div className="w2-drop-body">
          <p className="w2-drop-bad">TOO SLOW. Someone else is claiming this one.</p>
          <button type="button" className="w2-drop-go" onClick={close}>
            OK
          </button>
        </div>
      )}
      {phase.k === 'expired' && (
        <div className="w2-drop-body">
          <p className="w2-drop-bad">This drop has expired.</p>
          <button type="button" className="w2-drop-go" onClick={close}>
            OK
          </button>
        </div>
      )}
      {phase.k === 'error' && (
        <div className="w2-drop-body">
          <p className="w2-drop-bad">{phase.msg}</p>
          {phase.retry && isConnected ? (
            <button type="button" className="w2-drop-go" onClick={() => void claim()}>
              TRY AGAIN
            </button>
          ) : (
            <button type="button" className="w2-drop-go" onClick={close}>
              OK
            </button>
          )}
        </div>
      )}
      {style}
    </div>
  );
}

function Status({ text, spin, link }: { text: string; spin?: boolean; link?: string }) {
  return (
    <div className="w2-drop-body">
      <p>
        {spin === true && <span className="w2-drop-spin" />} {text}
      </p>
      {link !== undefined && (
        <a href={link} target="_blank" rel="noreferrer">
          view transaction ↗
        </a>
      )}
    </div>
  );
}

const style = (
  <style>{`
.w2-drop{width:min(380px,calc(100vw - 32px));background:#111018;color:#fff;border:3px solid #ffd400;border-radius:16px;box-shadow:8px 8px 0 #d22209,0 18px 50px rgba(0,0,0,.5);font-family:system-ui,sans-serif;animation:w2dropin .28s cubic-bezier(.2,1.4,.5,1)}
@keyframes w2dropin{from{transform:translate(-50%,-50%) scale(.6) rotate(-4deg);opacity:0}}
.w2-drop-x{position:absolute;right:8px;top:8px;width:34px;height:34px;border-radius:50%;background:rgba(255,255,255,.1);color:#fff;font:900 14px system-ui}
.w2-drop-x:disabled{opacity:.3}
.w2-drop-head{display:flex;flex-direction:column;align-items:flex-start;padding:14px 18px 0}
.w2-drop-head span{font:800 11px system-ui;letter-spacing:.16em;color:#ffd400}
.w2-drop-head b{font:900 30px 'Londrina Solid',system-ui;letter-spacing:.03em;line-height:1}
.w2-drop-item{display:flex;align-items:center;gap:14px;margin:12px 18px;padding:10px;background:rgba(255,255,255,.07);border-radius:12px}
.w2-drop-item img,.w2-drop-item i{width:64px;height:64px;border-radius:8px;flex:none;object-fit:cover;border:3px solid #ffc93c;background:#e1d7d5}
.w2-drop-item i{display:flex;align-items:center;justify-content:center;font-style:normal;font-size:34px;color:#fff;border:0;background:#4a55c9}
.w2-drop-item i[data-kind=erc20]{background:#c79100}
.w2-drop-item i[data-kind=erc721],.w2-drop-item i[data-kind=erc1155]{background:#ff3d8b}
.w2-drop-item b{display:block;font:900 22px 'Londrina Solid',system-ui;letter-spacing:.02em}
.w2-drop-item small{opacity:.65;font-size:12px}
.w2-drop-body{display:flex;flex-direction:column;gap:10px;padding:0 18px 18px}
.w2-drop-body p{margin:0;font-size:14px;line-height:1.4}
.w2-drop-body code{background:rgba(255,255,255,.12);padding:1px 6px;border-radius:5px}
.w2-drop-body a{color:#22c7f0;font-size:13px;font-weight:700}
.w2-drop-go:disabled{opacity:.5}
.w2-drop-note{margin:0 18px 10px;font-size:12px;color:#ffd400}
.w2-drop-go{background:#d22209;color:#fff;font:900 24px 'Londrina Solid',system-ui;letter-spacing:.05em;padding:10px;border-radius:12px;box-shadow:0 5px 0 #7a1405}
.w2-drop-go:active{transform:translateY(3px);box-shadow:0 2px 0 #7a1405}
.w2-drop-win{font:900 28px 'Londrina Solid',system-ui !important;color:#b6ef3a}
.w2-drop-bad{color:#ffb4a8}
.w2-drop-spin{display:inline-block;width:14px;height:14px;margin-right:6px;vertical-align:-2px;border:3px solid rgba(255,255,255,.25);border-top-color:#ffd400;border-radius:50%;animation:w2dropspin .7s linear infinite}
@keyframes w2dropspin{to{transform:rotate(360deg)}}
`}</style>
);
