// ── How pool messages travel ────────────────────────────────────────────
//
// In the game: the world v2 PartySocket (net/Net.ts `sendPool` / `onPool`),
// relayed by packages/nouns-party/src/poolRelay.ts. Offline: nowhere.
// Everything that arrives goes through the codec's readMsg first.

import type { Net } from '../../net/Net';
import type { PoolMsg } from '../contract';

import { readMsg } from './codec';

export interface PoolTransport {
  /** My connection id ('me' offline). */
  readonly id: string;
  readonly online: boolean;
  send(m: PoolMsg): void;
  /** Set by PoolMode. */
  onMessage: ((m: PoolMsg) => void) | null;
}

export class NetTransport implements PoolTransport {
  onMessage: ((m: PoolMsg) => void) | null = null;

  constructor(
    private net: Net,
    private offline: boolean,
  ) {
    net.onPool = raw => {
      const m = readMsg(raw);
      if (m !== null) this.onMessage?.(m);
    };
  }

  get id() {
    return this.offline ? 'me' : this.net.myId || 'me';
  }

  get online() {
    return !this.offline && this.net.connected;
  }

  send(m: PoolMsg) {
    if (this.online) this.net.sendPool(m);
  }
}
