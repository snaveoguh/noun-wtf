// ── 3D Grand Exchange: who else is on the floor (multiplayer) ───────────
//
// One PartySocket to the Exchange's own room (wire.ts: EXCHANGE_ROOM) on
// the noun.wtf PartyServer worker. Sends my pose ~10 Hz while it changes,
// keeps every other Exchange walker's recent poses for playback, and tells
// the scene when someone pings me with an offer. Plain socket handling;
// the format lives in wire.ts.

import PartySocket from 'partysocket';

import { PARTYKIT_HOST } from '../../world/engine/types';

import { EXCHANGE_ROOM, PeerBuffer, packMove, parseMove, SEND_HZ, type PeerPose } from './wire';

export interface Peer {
  id: string;
  buf: PeerBuffer;
  /** Last offer-ping seq seen from them (a joiner doesn't replay old ones). */
  pingSeq: number;
}

/** Peers silent this long are dropped (the relay also sends world:leave). */
const STALE_MS = 12_000;

export class ExchangeNet {
  private ws: PartySocket | null = null;
  readonly peers = new Map<string, Peer>();
  myId = '';
  connected = false;
  private acc = 0;
  private lastSent = '';
  private keepAlive = 0;
  private pingSeq = 0;
  private ping: { seq: number; to: string } | null = null;
  /** Someone sent me (my tag) an offer: refresh the deals now. */
  onPinged?: (fromPeer: string) => void;
  onPeers?: () => void;

  constructor(
    private readonly myTag: () => string,
    private readonly host: string = PARTYKIT_HOST,
    private readonly room: string = EXCHANGE_ROOM,
  ) {}

  connect() {
    if (this.ws !== null) return;
    const ws = new PartySocket({ host: this.host, room: this.room });
    this.ws = ws;
    ws.addEventListener('open', () => {
      this.myId = ws.id;
      this.connected = true;
      this.lastSent = '';
    });
    ws.addEventListener('close', () => {
      this.connected = false;
    });
    ws.addEventListener('message', ev => {
      let d: Record<string, unknown>;
      try {
        d = JSON.parse(String(ev.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      this.handle(d);
    });
  }

  private handle(d: Record<string, unknown>) {
    if (d.type === 'world:sync') {
      const players = (d.players ?? {}) as Record<string, Record<string, unknown>>;
      for (const [id, p] of Object.entries(players)) if (id !== this.myId) this.ingest(id, p, true);
    } else if (d.type === 'world:player') {
      const id = String(d.id ?? '');
      if (id !== '' && id !== this.myId) this.ingest(id, d, false);
    } else if (d.type === 'world:leave') {
      if (this.peers.delete(String(d.id ?? ''))) this.onPeers?.();
    }
  }

  private ingest(id: string, d: Record<string, unknown>, fromSync: boolean) {
    const pose = parseMove(d);
    if (pose === null) return;
    let peer = this.peers.get(id);
    const isNew = peer === undefined;
    if (peer === undefined) {
      peer = { id, buf: new PeerBuffer(), pingSeq: pose.ping?.seq ?? -1 };
      this.peers.set(id, peer);
    }
    peer.buf.push(performance.now(), pose);
    const me = this.myTag();
    if (pose.ping !== null && pose.ping.seq !== peer.pingSeq) {
      peer.pingSeq = pose.ping.seq;
      if (!fromSync && !isNew && pose.ping.to === me) this.onPinged?.(id);
    }
    if (isNew) this.onPeers?.();
  }

  /** Tell `toTag` (a rider's public tag) to look at their offers now. */
  pingOffer(toTag: string) {
    this.ping = { seq: ++this.pingSeq, to: toTag };
    this.lastSent = '';
  }

  /** Send my pose (rate-limited; unchanged poses only every few seconds). */
  send(dt: number, pose: Omit<PeerPose, 'tag' | 'ping'>) {
    const ws = this.ws;
    if (ws === null || ws.readyState !== WebSocket.OPEN) return;
    this.acc += dt;
    this.keepAlive += dt;
    if (this.acc < 1 / SEND_HZ) return;
    this.acc = 0;
    const msg = packMove({ ...pose, tag: this.myTag(), ping: this.ping });
    if (msg === this.lastSent && this.keepAlive < 4) return;
    this.keepAlive = 0;
    this.lastSent = msg;
    ws.send(msg);
  }

  /** Drop peers that went quiet. */
  tick() {
    const now = performance.now();
    let gone = false;
    for (const [id, p] of this.peers)
      if (now - p.buf.last > STALE_MS) {
        this.peers.delete(id);
        gone = true;
      }
    if (gone) this.onPeers?.();
  }

  dispose() {
    this.ws?.close();
    this.ws = null;
    this.peers.clear();
    this.connected = false;
  }
}
