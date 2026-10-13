// ── How hoops messages travel ────────────────────────────────────────────
//
// In the game: the world v2 PartySocket (net/Net.ts `sendHoops` / `onHoops`),
// relayed by packages/nouns-party/src/hoopsRelay.ts. Offline: nowhere.

import type { Net } from '../../net/Net';
import type { HoopsMsg } from '../contract';

export interface HoopsTransport {
  /** My connection id ('' offline). */
  readonly id: string;
  readonly online: boolean;
  send(m: HoopsMsg): void;
  /** Set by HoopsMode. */
  onMessage: ((m: HoopsMsg) => void) | null;
}

export class NetTransport implements HoopsTransport {
  onMessage: ((m: HoopsMsg) => void) | null = null;

  constructor(
    private net: Net,
    private offline: boolean,
  ) {
    net.onHoops = m => this.onMessage?.(m);
  }

  get id() {
    return this.offline ? 'me' : this.net.myId || 'me';
  }

  get online() {
    return !this.offline && this.net.connected;
  }

  send(m: HoopsMsg) {
    if (this.online) this.net.sendHoops(m);
  }
}
