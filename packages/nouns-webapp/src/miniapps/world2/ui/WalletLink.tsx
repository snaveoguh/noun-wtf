// ── Link wallet: one rider identity per ETH address (prizes are paid to it) ──
//
// Lives in the stats panel. Not connected → the site's ConnectKit modal;
// connected → sign "Noun World: link rider …" (no gas) and the server ties
// this browser's row to the address. Once linked, the name only changes with
// another signature, so a game name that differs offers a "rename" signature.

import { useState, useSyncExternalStore } from 'react';

import { ConnectKitButton } from 'connectkit';
import { useAccount, useSignMessage } from 'wagmi';

import { linkWallet, shortAddr, walletLink } from '../net/Stats';

const btn =
  'rounded-full bg-[#ffd400] px-2 py-0.5 text-[10px] font-bold text-black disabled:opacity-50';

export function WalletLink({ me }: { me: string }) {
  const link = useSyncExternalStore(walletLink.subscribe, walletLink.get);
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sameWallet =
    link !== null && address !== undefined && link.address.toLowerCase() === address.toLowerCase();

  const sign = async () => {
    if (!address) return;
    setBusy(true);
    setError(null);
    const res = await linkWallet(address, me, message => signMessageAsync({ message }));
    setBusy(false);
    if (!res.ok) setError(res.error);
  };

  return (
    <div className="mt-1 flex flex-col gap-1 border-t border-white/15 pt-1.5">
      {link !== null && (
        <div className="flex items-center justify-between gap-2" title={link.address}>
          <span className="truncate">
            <span className="text-[#5be37d]">✓</span> verified as <b>{link.name}</b>
          </span>
          <span className="shrink-0 font-mono text-[10px] opacity-70">
            {shortAddr(link.address)}
          </span>
        </div>
      )}
      {!isConnected ? (
        <ConnectKitButton.Custom>
          {({ show }) => (
            <button type="button" className={btn} onClick={() => show?.()}>
              🔗 {link === null ? 'connect wallet to verify for prizes' : 'connect wallet'}
            </button>
          )}
        </ConnectKitButton.Custom>
      ) : link === null || !sameWallet ? (
        <button type="button" className={btn} disabled={busy} onClick={() => void sign()}>
          {busy ? 'sign in your wallet…' : `🔗 link ${shortAddr(address!)} as ${me}`}
        </button>
      ) : link.name !== me ? (
        <button type="button" className={btn} disabled={busy} onClick={() => void sign()}>
          {busy ? 'sign in your wallet…' : `✍️ sign to rename to ${me}`}
        </button>
      ) : null}
      {link === null && (
        <div className="text-[10px] opacity-60">
          Prizes (top speed, air, hang time) go to linked wallets. Signing is free, no gas.
        </div>
      )}
      {error !== null && <div className="text-[10px] text-[#ff6b6b]">{error}</div>}
    </div>
  );
}
