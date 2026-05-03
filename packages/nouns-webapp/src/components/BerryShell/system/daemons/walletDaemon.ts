/**
 * Wallet daemon — bridges wagmi connection state onto the BerryOS bus.
 *
 * Subscribes to wagmi's account state via `watchAccount` and re-emits
 * `system:walletConnected` / `system:walletDisconnected` on `berryBus` so
 * any app can observe wallet state without taking a wagmi dependency.
 *
 * Exposes the current address synchronously via the manager pattern:
 *   const rec = serviceManager.get('wallet');
 *   const addr = (rec?.service as WalletDaemon).address;
 *
 * Requests `wallet:read` permission on start. If denied the service still
 * starts but doesn't emit address payloads — the bus events fire with an
 * empty address so consumers know the wallet is gated.
 */

import { getAccount, watchAccount } from '@wagmi/core';

import { config as wagmiConfig } from '@/wagmi';

import { berryBus } from '../eventBus';
import { hasPermission, requestPermission } from '../permissions';
import type { BerryService } from '../services';

const APP_ID = 'wallet';

interface WalletDaemonShape extends BerryService {
  /** Current connected address (or undefined when disconnected/gated). */
  readonly address: string | undefined;
}

let unwatch: (() => void) | undefined;
let currentAddress: string | undefined;
let lastEmittedAddress: string | undefined;

function emitFromAccount(address: `0x${string}` | undefined): void {
  const allowed = hasPermission(APP_ID, 'wallet:read');
  // When permission is denied we still observe state internally — but we
  // emit empty addresses so apps know the user has revoked access. This
  // mirrors macOS Location Services: the service runs, the data is gated.
  const safeAddress = allowed ? address : undefined;
  currentAddress = safeAddress;

  if (safeAddress && safeAddress !== lastEmittedAddress) {
    berryBus.emit('system:walletConnected', { address: safeAddress });
    lastEmittedAddress = safeAddress;
  } else if (!safeAddress && lastEmittedAddress) {
    berryBus.emit('system:walletDisconnected', {});
    lastEmittedAddress = undefined;
  }
}

export const walletDaemon: WalletDaemonShape = {
  id: APP_ID,
  name: 'Wallet bridge',
  autoStart: true,
  description: 'Mirrors wagmi account state onto the BerryOS bus.',

  get address() {
    return currentAddress;
  },

  async start() {
    // Best-effort: ask for wallet:read so the user understands a system
    // service is reading their address. Trusted apps auto-grant.
    await requestPermission(APP_ID, 'wallet:read');

    const initial = getAccount(wagmiConfig);
    emitFromAccount(initial.address);

    unwatch = watchAccount(wagmiConfig, {
      onChange(account) {
        emitFromAccount(account.address);
      },
    });
  },

  async stop() {
    unwatch?.();
    unwatch = undefined;
    if (lastEmittedAddress) {
      berryBus.emit('system:walletDisconnected', {});
      lastEmittedAddress = undefined;
    }
    currentAddress = undefined;
  },

  status() {
    return unwatch ? 'running' : 'stopped';
  },
};

export type WalletDaemon = typeof walletDaemon;
