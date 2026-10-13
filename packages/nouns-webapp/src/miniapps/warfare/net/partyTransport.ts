// ── The real socket: PartyKit room `noun-warfare` ──────────────────────
//
// Host: VITE_PARTYKIT_HOST (e.g. `localhost:1999` for `npx partykit dev`),
// else the deployed noun-wtf PartyKit. `?offline=1` never opens a socket,
// and neither do dev builds / automated browsers unless a host is set
// explicitly or the URL says `?online=1` — so local checks and tests can't
// wander into the live room.

import PartySocket from 'partysocket';

import { WF_ROOM, type WfMsg, type WfTransport } from './protocol';

const LIVE_HOST = 'noun-wtf-saber.snaveoguh.partykit.dev';

export function warfarePartyHost(search: string = window.location.search): string | null {
  const q = new URLSearchParams(search);
  if (q.get('offline') === '1') return null;
  const env = (import.meta.env.VITE_PARTYKIT_HOST as string | undefined) ?? '';
  if (env !== '') return env;
  const automated = typeof navigator !== 'undefined' && navigator.webdriver === true;
  if ((import.meta.env.DEV || automated) && q.get('online') !== '1') return null;
  return LIVE_HOST;
}

export class PartyTransport implements WfTransport {
  onMessage: ((m: WfMsg) => void) | null = null;
  onStatus: (() => void) | null = null;
  readonly ws: PartySocket;
  connected = false;

  constructor(host: string) {
    this.ws = new PartySocket({ host, room: WF_ROOM });
    this.ws.addEventListener('open', () => {
      this.connected = true;
      this.onStatus?.();
    });
    this.ws.addEventListener('close', () => {
      this.connected = false;
      this.onStatus?.();
    });
    this.ws.addEventListener('message', ev => {
      if (typeof ev.data !== 'string' || ev.data.length > 64_000) return;
      let m: WfMsg;
      try {
        m = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (m !== null && typeof m === 'object' && typeof m.type === 'string') this.onMessage?.(m);
    });
  }

  get id() {
    return this.ws.id;
  }

  get online() {
    return this.connected;
  }

  send(m: WfMsg) {
    if (this.connected) this.ws.send(JSON.stringify(m));
  }

  close() {
    this.ws.close();
  }
}
