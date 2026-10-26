// ── How break messages travel ───────────────────────────────────────────
//
// In the game: the world v2 PartySocket (net/Net.ts `sendBreak` / `onBreak`),
// relayed by packages/nouns-party/src/breakRelay.ts. Offline: nowhere.
// Everything that arrives goes through the codec's readMsg first.

import type { Net } from '../../net/Net';
import type { BreakMsg } from '../contract';

import { readMsg } from './codec';

export interface BreakTransport {
  /** My connection id ('me' offline). */
  readonly id: string;
  readonly online: boolean;
  send(m: BreakMsg): void;
  /** Set by BreakMode. */
  onMessage: ((m: BreakMsg) => void) | null;
}

export class NetTransport implements BreakTransport {
  onMessage: ((m: BreakMsg) => void) | null = null;

  constructor(
    private net: Net,
    private offline: boolean,
  ) {
    net.onBreak = raw => {
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

  send(m: BreakMsg) {
    if (this.online) this.net.sendBreak(m);
  }
}
