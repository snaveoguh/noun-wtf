// ── How hide & seek messages travel ─────────────────────────────────────
//
// In the game: the world v2 PartySocket (net/Net.ts `sendHideSeek` /
// `onHideSeek`), relayed by packages/nouns-party/src/hideseekRelay.ts.
// Offline (`?offline=1`, vs CPU on its own): nowhere. Everything that
// arrives goes through the codec's readMsg first.

import type { Net } from '../../net/Net';
import type { HsMsg } from '../contract';

import { readMsg } from './codec';

export interface HsTransport {
  /** My connection id ('me' offline). */
  readonly id: string;
  readonly online: boolean;
  send(m: HsMsg): void;
  onMessage: ((m: HsMsg) => void) | null;
}

export class NetTransport implements HsTransport {
  onMessage: ((m: HsMsg) => void) | null = null;

  constructor(
    private net: Net,
    private offline: boolean,
  ) {
    net.onHideSeek = raw => {
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

  send(m: HsMsg) {
    if (this.online) this.net.sendHideSeek(m);
  }
}
